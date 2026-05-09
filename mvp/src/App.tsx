import {
  Bug,
  EyeOff,
  Mic,
  Pause,
  Play,
  RefreshCw,
  SkipForward,
  Square,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { clientConfig } from './teleprompter/config'
import { phaseZeroFixture } from './teleprompter/fixtures'
import type { GeneratedParagraph, StreamChunk, StreamSource, VisualCue } from './teleprompter/types'

type PlanningState = 'idle' | 'generating' | 'ready' | 'reading' | 'consumed' | 'failed'
type ConnectionState = 'idle' | 'connecting' | 'listening' | 'error'
type DisplayTone = 'green' | 'blue' | 'red' | 'gold'
type ScriptFeedback = 'idle' | 'matched' | 'diverged'

type TimingEntry = {
  id: number
  label: string
  atMs: number
  detail?: string
}

type AudienceDisplay = {
  text: string
  emphasis: string[]
  tone: DisplayTone
  sourceChunkId?: string
}

type ServerEvent = {
  type?: string
  delta?: string
  transcript?: string
  item_id?: string
  response_id?: string
  message?: string
  error?: {
    message?: string
  }
  response?: {
    id?: string
    metadata?: Record<string, string>
    output?: Array<{
      content?: Array<{
        text?: string
        transcript?: string
      }>
    }>
  }
}

type RealtimeHandles = {
  peer: RTCPeerConnection
  channel: RTCDataChannel
  stream: MediaStream
}

const visualCueMarker = '---VISUAL_CUES_JSON---'
const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'for',
  'from',
  'i',
  'in',
  'into',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'so',
  'the',
  'this',
  'to',
  'we',
  'while',
  'with',
])

function eventResponseId(event: ServerEvent) {
  return event.response?.id || event.response_id || ''
}

function eventTopic(event: ServerEvent) {
  return event.response?.metadata?.topic || ''
}

function textFromResponseDone(event: ServerEvent) {
  return (
    event.response?.output
      ?.flatMap((item) => item.content || [])
      .map((content) => content.text || content.transcript || '')
      .join('') || ''
  )
}

function splitPlanningResponse(text: string) {
  const markerIndex = text.indexOf(visualCueMarker)

  if (markerIndex === -1) {
    return {
      paragraph: text.trim(),
      visualCueText: '',
    }
  }

  return {
    paragraph: text.slice(0, markerIndex).trim(),
    visualCueText: text.slice(markerIndex + visualCueMarker.length).trim(),
  }
}

function stripJsonFence(raw: string) {
  return raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim()
}

function normalizeDisplayWord(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function meaningfulWords(value: string) {
  return normalizeSpaces(value)
    .split(' ')
    .map(normalizeDisplayWord)
    .filter((word) => word.length > 2 && !stopWords.has(word))
}

function normalizeSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function lastMeaningfulWords(value: string, count: number) {
  return meaningfulWords(value).slice(-count)
}

function hasLastTwoWordMatch(spoken: string, script: string) {
  const target = lastMeaningfulWords(script, 2)
  const spokenWords = meaningfulWords(spoken)

  if (target.length < 2 || spokenWords.length < 2) return false

  const spokenTail = spokenWords.slice(-2)

  return target.every((word, index) => word === spokenTail[index])
}

function spokenScriptOverlap(spoken: string, script: string) {
  const spokenWords = meaningfulWords(spoken)
  const scriptWords = new Set(meaningfulWords(script))

  if (!spokenWords.length || !scriptWords.size) return 0

  const overlapCount = spokenWords.filter((word) => scriptWords.has(word)).length

  return overlapCount / spokenWords.length
}

function isLikelyTopicChange(spoken: string, script: string) {
  const spokenWords = meaningfulWords(spoken)

  if (spokenWords.length < 4) return false

  return spokenScriptOverlap(spoken, script) < 0.18
}

function isProbablyEnglish(value: string) {
  const text = normalizeSpaces(value)

  if (!text) return false

  const latinChars = text.match(/[a-z]/gi)?.length || 0
  const blockedChars = text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g)?.length || 0

  return latinChars >= 2 && blockedChars === 0
}

function createLocalDisplay(text: string, sourceChunkId?: string): AudienceDisplay {
  const words = normalizeSpaces(text)
    .split(' ')
    .map((word) => word.replace(/^["'([{]+|[)"'\]},.!?:;]+$/g, ''))
    .filter(Boolean)

  if (!words.length) {
    return {
      text: 'Speak to begin',
      emphasis: ['begin'],
      tone: 'green',
      sourceChunkId,
    }
  }

  let bestIndex = 0
  let bestScore = -1

  words.forEach((word, index) => {
    const normalized = normalizeDisplayWord(word)
    const score =
      normalized.length +
      (stopWords.has(normalized) ? -8 : 0) +
      (index === 0 ? -1 : 0) +
      (/demo|teleprompter|product|visual|stage|speech|voice|scene|energy|drink/.test(normalized)
        ? 8
        : 0)

    if (score > bestScore) {
      bestIndex = index
      bestScore = score
    }
  })

  const start = Math.max(0, bestIndex - 2)
  const end = Math.min(words.length, start + 5)
  const phrase = words.slice(Math.max(0, end - 5), end).join(' ')
  const emphasis = words[bestIndex]

  return {
    text: phrase || words.slice(0, 5).join(' '),
    emphasis: emphasis ? [emphasis] : [],
    tone: 'green',
    sourceChunkId,
  }
}

function parseDisplayResponse(raw: string, fallbackText: string, sourceChunkId?: string) {
  try {
    const parsed = JSON.parse(stripJsonFence(raw))
    const display = normalizeSpaces(String(parsed.display || ''))
    const emphasis = Array.isArray(parsed.emphasis)
      ? parsed.emphasis.map((item: unknown) => String(item)).filter(Boolean).slice(0, 2)
      : []
    const tone = ['green', 'blue', 'red', 'gold'].includes(parsed.color)
      ? (parsed.color as DisplayTone)
      : 'green'

    if (!isProbablyEnglish(display)) {
      return createLocalDisplay(fallbackText, sourceChunkId)
    }

    return {
      text: display.split(' ').slice(0, 6).join(' '),
      emphasis: emphasis.length ? emphasis : [display.split(' ').at(-1) || display],
      tone,
      sourceChunkId,
    }
  } catch {
    return createLocalDisplay(fallbackText, sourceChunkId)
  }
}

function parseVisualCues(raw: string): VisualCue[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(stripJsonFence(raw))
    const list = Array.isArray(parsed) ? parsed : parsed.visualCues

    if (!Array.isArray(list)) return []

    return list.slice(0, 3).map((cue, index) => ({
      id: String(cue.id || `cue-${index + 1}`),
      phrase: String(cue.phrase || ''),
      prompt: String(cue.prompt || ''),
      targetTiming: {
        paragraphIndex: Number(cue.targetTiming?.paragraphIndex || 0),
        phraseMatch: String(cue.targetTiming?.phraseMatch || cue.phrase || ''),
        wordIndex:
          cue.targetTiming?.wordIndex === undefined
            ? undefined
            : Number(cue.targetTiming.wordIndex),
      },
      sceneType: ['glyph-scene', 'force-field', 'canvas-effect', 'pretext-effect'].includes(
        cue.sceneType,
      )
        ? cue.sceneType
        : 'glyph-scene',
      status: 'pending',
    }))
  } catch {
    return []
  }
}

function App() {
  const initialDisplay = useMemo(
    () => createLocalDisplay(phaseZeroFixture.typedInput.at(-1)?.text || ''),
    [],
  )
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [status, setStatus] = useState('Ready.')
  const [presentationBrief, setPresentationBrief] = useState(
    phaseZeroFixture.presentationBrief,
  )
  const [partialTranscript, setPartialTranscript] = useState('')
  const [, setFinalizedChunks] = useState<StreamChunk[]>(
    phaseZeroFixture.typedInput,
  )
  const [audienceDisplay, setAudienceDisplay] = useState<AudienceDisplay>(initialDisplay)
  const [planningState, setPlanningState] = useState<PlanningState>('idle')
  const [planningDraft, setPlanningDraft] = useState('')
  const [generatedParagraph, setGeneratedParagraph] =
    useState<GeneratedParagraph | null>(null)
  const [scriptFeedback, setScriptFeedback] = useState<ScriptFeedback>('idle')
  const [timings, setTimings] = useState<TimingEntry[]>([])
  const [lastError, setLastError] = useState('')
  const [overlayVisible, setOverlayVisible] = useState(true)
  const [debugVisible, setDebugVisible] = useState(false)
  const [streamPaused, setStreamPaused] = useState(false)

  const handlesRef = useRef<RealtimeHandles | null>(null)
  const partialByItemRef = useRef(new Map<string, string>())
  const responsePurposesRef = useRef(new Map<string, string>())
  const responseRequestIdsRef = useRef(new Map<string, number>())
  const responseChunkIdsRef = useRef(new Map<string, string>())
  const responseFallbackTextRef = useRef(new Map<string, string>())
  const displayExtractionRawRef = useRef(new Map<string, string>())
  const planningRawRef = useRef('')
  const finalizedChunksRef = useRef(phaseZeroFixture.typedInput)
  const finalizedTextRef = useRef(phaseZeroFixture.typedInput.map((item) => item.text).join(' '))
  const audienceDisplayRef = useRef(initialDisplay)
  const planningStartedAtRef = useRef<number | null>(null)
  const lastFinalizedAtRef = useRef<number | null>(null)
  const timingIdRef = useRef(0)
  const planningRequestIdRef = useRef(0)
  const hasGeneratedRef = useRef(false)
  const generatedParagraphRef = useRef<GeneratedParagraph | null>(null)
  const acceptedScriptsRef = useRef<string[]>([])
  const skippedScriptsRef = useRef<string[]>([])
  const planningStateRef = useRef<PlanningState>('idle')
  const presentationBriefRef = useRef(presentationBrief)
  const streamPausedRef = useRef(false)
  const feedbackTimerRef = useRef<number | null>(null)
  const autoGenerationTimerRef = useRef<number | null>(null)

  useEffect(() => {
    planningStateRef.current = planningState
  }, [planningState])

  useEffect(() => {
    presentationBriefRef.current = presentationBrief
  }, [presentationBrief])

  useEffect(() => {
    streamPausedRef.current = streamPaused
  }, [streamPaused])

  useEffect(() => {
    audienceDisplayRef.current = audienceDisplay
  }, [audienceDisplay])

  useEffect(() => {
    generatedParagraphRef.current = generatedParagraph
  }, [generatedParagraph])

  const clearFeedbackTimer = useCallback(() => {
    if (feedbackTimerRef.current != null) {
      window.clearTimeout(feedbackTimerRef.current)
      feedbackTimerRef.current = null
    }
  }, [])

  const clearAutoGenerationTimer = useCallback(() => {
    if (autoGenerationTimerRef.current != null) {
      window.clearTimeout(autoGenerationTimerRef.current)
      autoGenerationTimerRef.current = null
    }
  }, [])

  const showTemporaryScriptFeedback = useCallback(
    (feedback: ScriptFeedback) => {
      clearFeedbackTimer()
      setScriptFeedback(feedback)

      feedbackTimerRef.current = window.setTimeout(() => {
        setScriptFeedback('idle')
        feedbackTimerRef.current = null
      }, 1600)
    },
    [clearFeedbackTimer],
  )

  const mark = useCallback((label: string, detail?: string) => {
    timingIdRef.current += 1
    setTimings((current) =>
      [
        {
          id: timingIdRef.current,
          label,
          atMs: Math.round(performance.now()),
          detail,
        },
        ...current,
      ].slice(0, 18),
    )
  }, [])

  const sendEvent = useCallback(
    (event: Record<string, unknown>) => {
      const channel = handlesRef.current?.channel

      if (!channel || channel.readyState !== 'open') {
        mark('send skipped', String(event.type || 'unknown'))
        return false
      }

      channel.send(JSON.stringify(event))
      return true
    },
    [mark],
  )

  const requestDisplayExtraction = useCallback(
    (transcript: string, chunkId: string) => {
      const sent = sendEvent({
        type: 'response.create',
        response: {
          conversation: 'none',
          metadata: {
            topic: 'display-extract',
            chunkId,
          },
          output_modalities: ['text'],
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: [
                    'Create a slide-like audience display from finalized speech.',
                    'Use quick reasoning silently. Return English only.',
                    'Return strict JSON only: {"display":"2-6 word phrase","emphasis":["one meaningful word"],"color":"green|blue|red|gold"}.',
                    'Choose the emphasized word by meaning, not by position.',
                    'Avoid raw transcript fragments and avoid non-English output.',
                    '',
                    `Presentation goal:\n${presentationBriefRef.current || '(no explicit brief)'}`,
                    '',
                    `Finalized speech:\n${transcript}`,
                  ].join('\n'),
                },
              ],
            },
          ],
        },
      })

      if (sent) {
        mark('display extraction requested', chunkId)
      }
    },
    [mark, sendEvent],
  )

  const appendFinalizedChunk = useCallback(
    (text: string, source: StreamSource) => {
      const trimmed = normalizeSpaces(text)

      if (!trimmed) return null

      const chunk: StreamChunk = {
        id: `${source}-${Date.now()}`,
        text: trimmed,
        timestamp: new Date().toISOString(),
        source,
        status: 'final',
      }

      finalizedChunksRef.current = [...finalizedChunksRef.current, chunk]
      finalizedTextRef.current = `${finalizedTextRef.current} ${trimmed}`.trim()
      lastFinalizedAtRef.current = performance.now()
      setFinalizedChunks(finalizedChunksRef.current)
      setAudienceDisplay(createLocalDisplay(trimmed, chunk.id))
      mark('sentence or phrase finalized', trimmed)

      if (source !== 'generated') {
        requestDisplayExtraction(trimmed, chunk.id)
      }

      return chunk
    },
    [mark, requestDisplayExtraction],
  )

  const buildPlannerPrompt = useCallback(() => {
    const recentContext = finalizedTextRef.current.trim() || '(none yet)'
    const acceptedScripts = acceptedScriptsRef.current.slice(-3)
    const skippedScripts = skippedScriptsRef.current.slice(-2)

    return [
      'You are writing the next thing I should say in an improvised live demo.',
      'Use the presentation goal and recent transcript. Stay specific to the speaker topic.',
      'If the presenter went off script, follow the latest spoken topic instead of forcing the old script.',
      'Write in English only. Return one short paragraph first. No bullets and no label before the paragraph.',
      'After the paragraph, include a newline, the exact marker ---VISUAL_CUES_JSON---, then strict JSON for 1-2 lightweight visual cues.',
      'The visual cues should target a glyph-particle scene, not an image. Keep them compact.',
      'JSON shape: [{"phrase":"living teleprompter","prompt":"glyph particles form a responsive stage","sceneType":"glyph-scene","targetTiming":{"paragraphIndex":0,"phraseMatch":"living teleprompter","wordIndex":3}}]',
      '',
      `Presentation goal:\n${presentationBriefRef.current || '(no explicit brief)'}`,
      '',
      `Recent finalized speaker transcript:\n${recentContext}`,
      '',
      `Accepted/read generated scripts:\n${acceptedScripts.length ? acceptedScripts.join('\n') : '(none yet)'}`,
      '',
      `Skipped or superseded scripts:\n${skippedScripts.length ? skippedScripts.join('\n') : '(none yet)'}`,
    ].join('\n')
  }, [])

  const requestPlanning = useCallback(
    (reason: string) => {
      if (planningStateRef.current === 'generating') {
        mark('planning skipped', 'already generating')
        return
      }

      const channel = handlesRef.current?.channel

      if (!channel || channel.readyState !== 'open') {
        mark('planning skipped', 'data channel not open')
        return
      }

      const context = finalizedTextRef.current.trim()

      if (!context) {
        mark('planning skipped', 'no finalized transcript')
        return
      }

      planningRawRef.current = ''
      planningStartedAtRef.current = performance.now()
      setPlanningDraft('')
      setGeneratedParagraph(null)
      generatedParagraphRef.current = null
      setPlanningState('generating')
      planningStateRef.current = 'generating'
      setScriptFeedback('idle')
      mark('llm request started', reason)
      planningRequestIdRef.current += 1

      sendEvent({
        type: 'response.create',
        response: {
          conversation: 'none',
          metadata: {
            topic: 'teleprompter-plan',
            requestId: String(planningRequestIdRef.current),
          },
          output_modalities: ['text'],
          input: [
            {
              type: 'message',
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: buildPlannerPrompt(),
                },
              ],
            },
          ],
        },
      })
    },
    [buildPlannerPrompt, mark, sendEvent],
  )

  const configureSession = useCallback(() => {
    sendEvent({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions:
          'You are a silent live presentation planner. Do not speak out loud unless explicitly asked. Always produce English text. Generate concise presenter script quickly.',
        audio: {
          input: {
            transcription: {
              model: 'gpt-realtime-whisper',
              language: 'en',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: false,
              interrupt_response: false,
            },
          },
        },
      },
    })
    mark('session.update sent')
  }, [mark, sendEvent])

  const handlePlanningDelta = useCallback(
    (event: ServerEvent) => {
      const delta = event.delta || ''
      const hadText = Boolean(splitPlanningResponse(planningRawRef.current).paragraph)

      planningRawRef.current += delta

      const split = splitPlanningResponse(planningRawRef.current)

      if (!hadText && split.paragraph) {
        const elapsedFromFinal =
          lastFinalizedAtRef.current == null
            ? 'n/a'
            : `${Math.round(performance.now() - lastFinalizedAtRef.current)}ms after final`
        const elapsedFromRequest =
          planningStartedAtRef.current == null
            ? 'n/a'
            : `${Math.round(performance.now() - planningStartedAtRef.current)}ms after request`

        mark('first generated text', `${elapsedFromFinal}, ${elapsedFromRequest}`)
      }

      setPlanningDraft(split.paragraph)
    },
    [mark],
  )

  const finishPlanning = useCallback(
    (event: ServerEvent) => {
      const responseId = eventResponseId(event)
      const responseRequestId = responseRequestIdsRef.current.get(responseId)

      if (responseRequestId && responseRequestId !== planningRequestIdRef.current) {
        mark('stale planning ignored', `request ${responseRequestId}`)
        return
      }

      const raw = planningRawRef.current || textFromResponseDone(event)
      const split = splitPlanningResponse(raw)
      const paragraph = split.paragraph
      const visualCues = parseVisualCues(split.visualCueText)

      if (!paragraph || !isProbablyEnglish(paragraph)) {
        setPlanningState('failed')
        planningStateRef.current = 'failed'
        setLastError('Planning response finished without usable English paragraph text.')
        mark('generation failed', 'empty paragraph')
        return
      }

      const generated: GeneratedParagraph = {
        id: `generated-${Date.now()}`,
        sourceContextIds: finalizedChunksRef.current.map((chunk) => chunk.id),
        text: paragraph,
        createdAt: new Date().toISOString(),
        visualCues,
      }

      hasGeneratedRef.current = true
      generatedParagraphRef.current = generated
      setGeneratedParagraph(generated)
      setPlanningDraft(paragraph)
      setPlanningState('ready')
      planningStateRef.current = 'ready'
      mark(
        'usable paragraph received',
        planningStartedAtRef.current == null
          ? undefined
          : `${Math.round(performance.now() - planningStartedAtRef.current)}ms`,
      )

      if (visualCues.length) {
        mark('visual cue received', visualCues.map((cue) => cue.phrase).join(', '))
      }
    },
    [mark],
  )

  const clearVisibleScript = useCallback(() => {
    generatedParagraphRef.current = null
    setGeneratedParagraph(null)
    setPlanningDraft('')
  }, [])

  const completeCurrentScript = useCallback(
    (spokenTranscript: string) => {
      const currentScript = generatedParagraphRef.current?.text

      if (!currentScript) return

      acceptedScriptsRef.current = [...acceptedScriptsRef.current, currentScript].slice(-5)
      hasGeneratedRef.current = false
      planningStateRef.current = 'consumed'
      setPlanningState('consumed')
      showTemporaryScriptFeedback('matched')
      mark('script completed', `matched after: ${spokenTranscript}`)
      clearAutoGenerationTimer()

      autoGenerationTimerRef.current = window.setTimeout(() => {
        clearVisibleScript()
        planningStateRef.current = 'idle'
        setPlanningState('idle')
        requestPlanning('last two words matched')
        autoGenerationTimerRef.current = null
      }, 650)
    },
    [clearAutoGenerationTimer, clearVisibleScript, mark, requestPlanning, showTemporaryScriptFeedback],
  )

  const handleScriptDivergence = useCallback(
    (spokenTranscript: string) => {
      const currentScript = generatedParagraphRef.current?.text

      if (!currentScript) return

      skippedScriptsRef.current = [...skippedScriptsRef.current, currentScript].slice(-5)
      hasGeneratedRef.current = false
      planningStateRef.current = 'idle'
      setPlanningState('idle')
      showTemporaryScriptFeedback('diverged')
      mark('script diverged', spokenTranscript)
      clearAutoGenerationTimer()

      autoGenerationTimerRef.current = window.setTimeout(() => {
        clearVisibleScript()
        requestPlanning('topic changed')
        autoGenerationTimerRef.current = null
      }, 300)
    },
    [clearAutoGenerationTimer, clearVisibleScript, mark, requestPlanning, showTemporaryScriptFeedback],
  )

  const finishDisplayExtraction = useCallback(
    (event: ServerEvent) => {
      const responseId = eventResponseId(event)
      const chunkId = responseChunkIdsRef.current.get(responseId)
      const fallbackText = responseFallbackTextRef.current.get(responseId) || ''
      const raw = displayExtractionRawRef.current.get(responseId) || textFromResponseDone(event)

      responsePurposesRef.current.delete(responseId)
      responseChunkIdsRef.current.delete(responseId)
      responseFallbackTextRef.current.delete(responseId)
      displayExtractionRawRef.current.delete(responseId)

      if (!chunkId || audienceDisplayRef.current.sourceChunkId !== chunkId) return

      setAudienceDisplay(parseDisplayResponse(raw, fallbackText, chunkId))
      mark('display extraction received', chunkId)
    },
    [mark],
  )

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      const responseId = eventResponseId(event)
      const topic = eventTopic(event)

      if (responseId && topic) {
        responsePurposesRef.current.set(responseId, topic)
        const requestId = Number(event.response?.metadata?.requestId)
        const chunkId = event.response?.metadata?.chunkId

        if (Number.isFinite(requestId)) {
          responseRequestIdsRef.current.set(responseId, requestId)
        }

        if (chunkId) {
          responseChunkIdsRef.current.set(responseId, chunkId)
          const sourceText =
            finalizedChunksRef.current.find((chunk) => chunk.id === chunkId)?.text || ''
          responseFallbackTextRef.current.set(responseId, sourceText)
        }
      }

      if (event.type === 'session.created') {
        setStatus('Connected. Speak naturally.')
        setConnectionState('listening')
        mark('session created')
        return
      }

      if (event.type === 'conversation.item.input_audio_transcription.delta') {
        if (streamPausedRef.current) return

        const itemId = event.item_id || 'current'
        const previous = partialByItemRef.current.get(itemId) || ''

        if (!previous) {
          mark('speech partial received', itemId)
        }

        partialByItemRef.current.set(itemId, `${previous}${event.delta || ''}`)
        setPartialTranscript(
          Array.from(partialByItemRef.current.values())
            .join(' ')
            .trim()
            .split(/\s+/)
            .slice(-18)
            .join(' '),
        )
        return
      }

      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        const itemId = event.item_id || 'current'
        const transcript = (event.transcript || '').trim()

        partialByItemRef.current.delete(itemId)
        setPartialTranscript(
          Array.from(partialByItemRef.current.values()).join(' ').trim(),
        )

        if (!transcript || streamPausedRef.current) return

        appendFinalizedChunk(transcript, 'speech')

        const currentScript = generatedParagraphRef.current?.text
        const canEvaluateScript =
          currentScript &&
          (planningStateRef.current === 'ready' || planningStateRef.current === 'reading')

        if (canEvaluateScript && hasLastTwoWordMatch(transcript, currentScript)) {
          completeCurrentScript(transcript)
          return
        }

        if (canEvaluateScript && isLikelyTopicChange(transcript, currentScript)) {
          handleScriptDivergence(transcript)
          return
        }

        if (!hasGeneratedRef.current && planningStateRef.current === 'idle') {
          requestPlanning('first finalized speech')
        }
        return
      }

      if (
        event.type === 'response.output_text.delta' ||
        event.type === 'response.text.delta'
      ) {
        const purpose = responsePurposesRef.current.get(responseId)

        if (purpose === 'teleprompter-plan') {
          handlePlanningDelta(event)
        }

        if (purpose === 'display-extract') {
          displayExtractionRawRef.current.set(
            responseId,
            `${displayExtractionRawRef.current.get(responseId) || ''}${event.delta || ''}`,
          )
        }
        return
      }

      if (
        event.type === 'response.output_text.done' ||
        event.type === 'response.done'
      ) {
        const purpose = responsePurposesRef.current.get(responseId) || eventTopic(event)

        if (purpose === 'teleprompter-plan') {
          responsePurposesRef.current.delete(responseId)
          responseRequestIdsRef.current.delete(responseId)
          finishPlanning(event)
        }

        if (purpose === 'display-extract') {
          finishDisplayExtraction(event)
        }
        return
      }

      if (event.type === 'error' || event.error) {
        const message = event.error?.message || event.message || 'Realtime error'
        setConnectionState('error')
        setStatus('Realtime error.')
        setLastError(message)
        mark('error', message)
      }
    },
    [
      appendFinalizedChunk,
      completeCurrentScript,
      finishDisplayExtraction,
      finishPlanning,
      handlePlanningDelta,
      handleScriptDivergence,
      mark,
      requestPlanning,
    ],
  )

  const closeRealtimeHandles = useCallback(() => {
    handlesRef.current?.channel.close()
    handlesRef.current?.peer.close()
    handlesRef.current?.stream.getTracks().forEach((track) => track.stop())
    handlesRef.current = null
    partialByItemRef.current.clear()
  }, [])

  const stopRealtime = useCallback(() => {
    closeRealtimeHandles()
    setPartialTranscript('')
    setConnectionState('idle')
    setStatus('Stopped.')
    mark('session stopped')
  }, [closeRealtimeHandles, mark])

  const startRealtime = useCallback(async () => {
    try {
      if (handlesRef.current) {
        stopRealtime()
      }

      setLastError('')
      setConnectionState('connecting')
      setStatus('Requesting microphone...')
      mark('start clicked')

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mark('microphone ready')

      const peer = new RTCPeerConnection()

      for (const track of stream.getTracks()) {
        peer.addTrack(track, stream)
      }

      const remoteAudio = document.createElement('audio')
      remoteAudio.autoplay = true
      remoteAudio.muted = true
      peer.ontrack = (trackEvent) => {
        remoteAudio.srcObject = trackEvent.streams[0]
      }

      const channel = peer.createDataChannel('oai-events')
      handlesRef.current = { peer, channel, stream }

      channel.addEventListener('open', () => {
        mark('data channel open')
        configureSession()
        setStatus('Listening.')
        setConnectionState('listening')
      })

      channel.addEventListener('message', (message) => {
        handleServerEvent(JSON.parse(String(message.data)) as ServerEvent)
      })

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      mark('webrtc offer created')

      const response = await fetch(clientConfig.realtimeSessionPath, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          'Content-Type': 'application/sdp',
        },
      })

      const answerSdp = await response.text()

      if (!response.ok) {
        throw new Error(answerSdp)
      }

      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      mark('webrtc answer applied')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start Realtime'
      closeRealtimeHandles()
      setConnectionState('error')
      setStatus('Unable to start Realtime.')
      setLastError(message)
      mark('start failed', message)
    }
  }, [closeRealtimeHandles, configureSession, handleServerEvent, mark, stopRealtime])

  const skipCurrentScript = useCallback(() => {
    const currentScript = generatedParagraphRef.current?.text

    if (currentScript) {
      skippedScriptsRef.current = [...skippedScriptsRef.current, currentScript].slice(-5)
    }

    hasGeneratedRef.current = false
    planningStateRef.current = 'idle'
    planningRawRef.current = ''
    clearVisibleScript()
    setPlanningState('idle')
    mark('script skipped')
  }, [clearVisibleScript, mark])

  const regenerateScript = useCallback(() => {
    skipCurrentScript()
    requestPlanning('manual regenerate')
  }, [requestPlanning, skipCurrentScript])

  const clearSession = useCallback(() => {
    setPartialTranscript('')
    finalizedChunksRef.current = []
    finalizedTextRef.current = ''
    hasGeneratedRef.current = false
    acceptedScriptsRef.current = []
    skippedScriptsRef.current = []
    planningStateRef.current = 'idle'
    planningRawRef.current = ''
    setFinalizedChunks([])
    setAudienceDisplay(createLocalDisplay(''))
    clearVisibleScript()
    setPlanningState('idle')
    setScriptFeedback('idle')
    setTimings([])
    setLastError('')
    mark('session cleared')
  }, [clearVisibleScript, mark])

  useEffect(() => {
    return () => {
      closeRealtimeHandles()
      clearFeedbackTimer()
      clearAutoGenerationTimer()
    }
  }, [clearAutoGenerationTimer, clearFeedbackTimer, closeRealtimeHandles])

  const canGenerate =
    connectionState === 'listening' &&
    planningState !== 'generating' &&
    !generatedParagraph
  const canRegenerate = connectionState === 'listening' && planningState !== 'generating'
  const visibleScript = planningDraft || generatedParagraph?.text || ''
  const emphasisSet = new Set(audienceDisplay.emphasis.map(normalizeDisplayWord))

  return (
    <main className={`app-shell ${overlayVisible ? '' : 'overlay-hidden'}`}>
      <section className="stage" aria-label="Audience teleprompter">
        <p className={`stage-phrase tone-${audienceDisplay.tone}`}>
          {audienceDisplay.text.split(' ').map((word, index) => {
            const emphasized = emphasisSet.has(normalizeDisplayWord(word))

            return (
              <span key={`${word}-${index}`} className={emphasized ? 'emphasized' : undefined}>
                {word}
                {index === audienceDisplay.text.split(' ').length - 1 ? '' : ' '}
              </span>
            )
          })}
        </p>
        <p className={`live-transcript ${partialTranscript ? 'active' : ''}`}>
          {partialTranscript || 'listening text appears here'}
        </p>
      </section>

      {!overlayVisible ? (
        <button
          type="button"
          className="overlay-toggle floating"
          onClick={() => setOverlayVisible(true)}
        >
          Controls
        </button>
      ) : null}

      {overlayVisible ? (
        <aside className="presenter-panel" aria-label="Presenter controls">
          <section className="control-section">
            <div className="section-heading-row">
              <h2>Realtime</h2>
              <button
                type="button"
                className="icon-button secondary"
                onClick={() => setOverlayVisible(false)}
                aria-label="Hide controls"
                title="Hide controls"
              >
                <EyeOff aria-hidden="true" />
              </button>
            </div>
            <p className={`status-pill ${connectionState}`}>{status}</p>
            <div className="icon-row">
              <button
                type="button"
                className="icon-button"
                onClick={startRealtime}
                disabled={connectionState === 'connecting' || connectionState === 'listening'}
                aria-label="Start microphone"
                title="Start microphone"
              >
                <Mic aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button secondary"
                onClick={stopRealtime}
                disabled={connectionState !== 'listening'}
                aria-label="Stop microphone"
                title="Stop microphone"
              >
                <Square aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button secondary"
                onClick={() => setStreamPaused((current) => !current)}
                aria-label={streamPaused ? 'Resume streaming' : 'Pause streaming'}
                title={streamPaused ? 'Resume streaming' : 'Pause streaming'}
              >
                {streamPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="icon-button secondary"
                onClick={clearSession}
                aria-label="Clear session"
                title="Clear session"
              >
                <Trash2 aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button secondary"
                onClick={() => setDebugVisible((current) => !current)}
                aria-label={debugVisible ? 'Hide debug' : 'Show debug'}
                title={debugVisible ? 'Hide debug' : 'Show debug'}
              >
                <Bug aria-hidden="true" />
              </button>
            </div>
            {lastError ? <p className="error-text">{lastError}</p> : null}
          </section>

          {connectionState === 'idle' || connectionState === 'error' ? (
            <section>
              <h2>Presentation brief</h2>
              <textarea
                value={presentationBrief}
                onChange={(event) => setPresentationBrief(event.target.value)}
                rows={4}
              />
            </section>
          ) : null}

          <section className={`next-script ${scriptFeedback}`}>
            <div className="section-heading-row">
              <h2>Generated next script</h2>
              <span className={`script-state ${planningState}`}>
                {planningState === 'generating' && debugVisible ? '...' : planningState}
              </span>
            </div>
            <p className={visibleScript ? '' : 'muted'}>
              {visibleScript || 'Speak a sentence, or click Next after context exists.'}
            </p>
            <div className="button-row">
              <button
                type="button"
                className="text-button"
                onClick={() => requestPlanning('manual')}
                disabled={!canGenerate}
              >
                Next
              </button>
              <button
                type="button"
                className="icon-button secondary"
                onClick={regenerateScript}
                disabled={!canRegenerate}
                aria-label="Regenerate"
                title="Regenerate"
              >
                <RefreshCw aria-hidden="true" />
              </button>
              <button
                type="button"
                className="icon-button secondary"
                onClick={skipCurrentScript}
                disabled={!generatedParagraph}
                aria-label="Skip"
                title="Skip"
              >
                <SkipForward aria-hidden="true" />
              </button>
            </div>
          </section>

          {debugVisible ? (
            <section>
              <h2>Timing log</h2>
              <ol className="timing-list">
                {timings.map((timing) => (
                  <li key={timing.id}>
                    <span>{timing.label}</span>
                    <code>{timing.atMs}ms</code>
                    {timing.detail ? <p>{timing.detail}</p> : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </aside>
      ) : null}
    </main>
  )
}

export default App

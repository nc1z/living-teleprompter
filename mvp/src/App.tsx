import {
  Bug,
  Eye,
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
import { GlyphStage } from './glyph/GlyphStage'
import {
  generateGlyphSceneConfig,
  requestGlyphSceneConfig,
} from './glyph/localSceneGenerator'
import { clientConfig } from './teleprompter/config'
import { phaseZeroFixture } from './teleprompter/fixtures'
import type {
  GeneratedParagraph,
  GlyphSceneConfig,
  SpeechSignals,
  StreamChunk,
  StreamSource,
  VisualCue,
} from './teleprompter/types'

type PlanningState = 'idle' | 'generating' | 'ready' | 'reading' | 'consumed' | 'failed'
type ConnectionState = 'idle' | 'connecting' | 'listening' | 'error'
type DisplayTone = 'green' | 'blue' | 'red' | 'gold'
type ScriptFeedback = 'idle' | 'matched' | 'diverged'
type ReferenceLayoutVariant = 'text-left-art-right' | 'text-right-art-left' | 'text-top-art-bottom'
type PlanningOptions = {
  retry?: boolean
}

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

type VisualReference = {
  provider: 'asciiart.eu'
  status: 'ready' | 'missing' | 'missing-key' | 'failed'
  query?: string
  title?: string
  artist?: string
  art?: string
  url?: string
  credit?: string
  message?: string
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
const visualQueryMarker = '---VISUAL_SEARCH_QUERY---'
const experimentalAsciiVisuals =
  import.meta.env.VITE_EXPERIMENTAL_ASCII_VISUALS !== 'false'
const referenceLayoutVariants: ReferenceLayoutVariant[] = [
  'text-left-art-right',
  'text-right-art-left',
  'text-top-art-bottom',
]
const defaultAudienceText = 'The Presentation'
const maxPlanningRetries = 1
const storyBeatIdeas = [
  'set up the promise in one clear line',
  'show what the audience sees on screen',
  'explain how speech becomes a clean headline',
  'show how the next line helps the presenter keep moving',
  'bring in a fun visual moment, prop, or scene',
  'show a product example or live demo example',
  'handle a surprise topic change and make it feel intentional',
  'wrap the demo with a simple audience takeaway',
]
const defaultSpeechSignals: SpeechSignals = {
  volume: 0,
  pace: 0,
  pitch: 0.5,
  pauseDurationMs: 0,
  emphasis: 0,
  confidence: 0.7,
  topicShift: 0,
  sentiment: 'neutral',
  currentWordIndex: 0,
}
const fillerWords = new Set([
  'actually',
  'basically',
  'cool',
  'great',
  'hmm',
  'just',
  'like',
  'okay',
  'ok',
  'right',
  'so',
  'uh',
  'um',
  'well',
  'yeah',
  'yes',
])
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
  const visualMarkerIndex = text.indexOf(visualCueMarker)
  const queryMarkerIndex = text.indexOf(visualQueryMarker)
  const markerIndexes = [visualMarkerIndex, queryMarkerIndex].filter((index) => index !== -1)
  const firstMarkerIndex = markerIndexes.length ? Math.min(...markerIndexes) : -1

  if (firstMarkerIndex === -1) {
    return {
      paragraph: text.trim(),
      visualCueText: '',
      visualQuery: '',
    }
  }

  const rangeAfterMarker = (markerIndex: number, markerLength: number) => {
    const start = markerIndex + markerLength
    const laterMarkers = markerIndexes.filter((index) => index > markerIndex)

    return {
      start,
      end: laterMarkers.length ? Math.min(...laterMarkers) : undefined,
    }
  }
  const visualRange =
    visualMarkerIndex === -1
      ? null
      : rangeAfterMarker(visualMarkerIndex, visualCueMarker.length)
  const queryRange =
    queryMarkerIndex === -1
      ? null
      : rangeAfterMarker(queryMarkerIndex, visualQueryMarker.length)
  const visualCueText =
    visualRange === null ? '' : text.slice(visualRange.start, visualRange.end).trim()
  const visualQuery =
    queryRange === null ? '' : normalizeSpaces(text.slice(queryRange.start, queryRange.end))

  return {
    paragraph: text.slice(0, firstMarkerIndex).trim(),
    visualCueText,
    visualQuery,
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

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function nextStoryBeat(deliveredCount: number) {
  return storyBeatIdeas[Math.min(deliveredCount, storyBeatIdeas.length - 1)]
}

function speechSignalsFromText(text: string, topicShift = 0): SpeechSignals {
  const words = normalizeSpaces(text).split(' ').filter(Boolean)
  const wordCount = words.length
  const longWords = words.filter((word) => normalizeDisplayWord(word).length > 7).length

  return {
    volume: clampNumber(wordCount / 14, 0.12, 1),
    pace: clampNumber(wordCount / 18, 0, 1),
    pitch: clampNumber(0.45 + longWords / Math.max(8, wordCount + 1), 0.35, 0.8),
    pauseDurationMs: 0,
    emphasis: clampNumber(longWords / Math.max(1, wordCount), 0.05, 0.8),
    confidence: 0.76,
    topicShift,
    sentiment: topicShift > 0 ? 'playful' : 'positive',
    currentWordIndex: Math.max(0, wordCount - 1),
  }
}

function sceneFromQuery() {
  try {
    const encodedScene = new URLSearchParams(window.location.search).get('evalScene')

    if (!encodedScene) return null

    const normalizedScene = encodedScene
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(encodedScene.length / 4) * 4, '=')
    const bytes = Uint8Array.from(window.atob(normalizedScene), (char) => char.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    const parsed = JSON.parse(json) as GlyphSceneConfig

    if (!parsed.id || !parsed.palette) return null

    return parsed
  } catch {
    return null
  }
}

function shouldPromoteToDisplay(value: string) {
  const text = normalizeSpaces(value)
  const normalizedWords = text.split(' ').map(normalizeDisplayWord).filter(Boolean)
  const meaningful = normalizedWords.filter(
    (word) => word.length > 2 && !stopWords.has(word) && !fillerWords.has(word),
  )

  if (!text) return false
  if (normalizedWords.length <= 2 && meaningful.length < 2) return false
  if (text.length < 14 && meaningful.length < 2) return false
  if (meaningful.length === 0) return false

  return true
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

  if (spokenWords.length < 2) return false

  const overlap = spokenScriptOverlap(spoken, script)

  if (spokenWords.length >= 4) return overlap < 0.42

  return overlap === 0 && normalizeSpaces(spoken).length >= 10
}

function isProbablyEnglish(value: string) {
  const text = normalizeSpaces(value)

  if (!text) return false

  const latinChars = text.match(/[a-z]/gi)?.length || 0
  const blockedScriptRanges = [
    /[\u0400-\u04ff]/,
    /[\u0590-\u05ff]/,
    /[\u0600-\u06ff]/,
    /[\u0900-\u097f]/,
    /[\u0e00-\u0e7f]/,
    /[\u3040-\u30ff]/,
    /[\u3400-\u9fff]/,
    /[\uac00-\ud7af]/,
  ]
  const hasBlockedScript = blockedScriptRanges.some((pattern) => pattern.test(text))

  return latinChars >= 2 && !hasBlockedScript
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
      sceneType: ['glyph-scene', 'force-field', 'canvas-effect', 'pretext-effect', 'image'].includes(
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

function createBlankSceneConfig(): GlyphSceneConfig {
  const now = new Date().toISOString()

  return {
    id: 'ascii-experiment-blank-scene',
    cueId: 'ascii-experiment',
    status: 'ready',
    sourcePhrase: '',
    targetTiming: {
      paragraphIndex: 0,
      phraseMatch: '',
    },
    sceneType: 'glyph-scene',
    palette: {
      background: 'transparent',
      primary: '#111827',
      accent: '#078a55',
      muted: '#e5e7eb',
      glyphs: [],
    },
    clusters: [],
    mood: 'abstract',
    creatures: [],
    forceFields: [],
    speechMappings: {
      volume: 'none',
      pace: 'none',
      emphasis: 'none',
      topicShift: 'none',
    },
    reducedMotion: true,
    createdAt: now,
    updatedAt: now,
  }
}

function App() {
  const evalScene = useMemo(() => sceneFromQuery(), [])
  const isEvalMode = Boolean(evalScene)
  const initialDisplay = useMemo(
    () =>
      createLocalDisplay(
        evalScene?.sourcePhrase || defaultAudienceText,
      ),
    [evalScene],
  )
  const initialScene = useMemo(
    () =>
      evalScene ||
      (experimentalAsciiVisuals
        ? createBlankSceneConfig()
        : generateGlyphSceneConfig(
            phaseZeroFixture.generatedParagraphs[0]?.visualCues[0],
            phaseZeroFixture.generatedParagraphs[0],
          )),
    [evalScene],
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
  const [scriptOverlayVisible, setScriptOverlayVisible] = useState(true)
  const [debugVisible, setDebugVisible] = useState(false)
  const [streamPaused, setStreamPaused] = useState(false)
  const [activeSceneConfig, setActiveSceneConfig] =
    useState<GlyphSceneConfig>(initialScene)
  const [speechSignals, setSpeechSignals] =
    useState<SpeechSignals>(defaultSpeechSignals)
  const [visualReferences, setVisualReferences] = useState<VisualReference[]>([])
  const [referenceLayoutVariant, setReferenceLayoutVariant] =
    useState<ReferenceLayoutVariant>('text-left-art-right')

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
  const planningRetryCountRef = useRef(0)
  const lastPlanningReasonRef = useRef('')
  const hasGeneratedRef = useRef(false)
  const generatedParagraphRef = useRef<GeneratedParagraph | null>(null)
  const acceptedScriptsRef = useRef<string[]>([])
  const skippedScriptsRef = useRef<string[]>([])
  const topicDriftRef = useRef<string[]>([])
  const planningStateRef = useRef<PlanningState>('idle')
  const presentationBriefRef = useRef(presentationBrief)
  const streamPausedRef = useRef(false)
  const feedbackTimerRef = useRef<number | null>(null)
  const autoGenerationTimerRef = useRef<number | null>(null)
  const displayBufferTimerRef = useRef<number | null>(null)
  const pendingDisplayTextRef = useRef('')
  const pendingDisplayChunkIdRef = useRef<string | null>(null)

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
                    'If the transcript contains non-English words, translate the meaning to simple English before creating the display.',
                    'Return strict JSON only: {"display":"2-6 word phrase","emphasis":["one meaningful word"],"color":"green|blue|red|gold"}.',
                    'Choose the emphasized word by meaning, not by position.',
                    'Never copy non-English transcript fragments. Do not output any non-English characters or words.',
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

  const clearDisplayBufferTimer = useCallback(() => {
    if (displayBufferTimerRef.current) {
      window.clearTimeout(displayBufferTimerRef.current)
      displayBufferTimerRef.current = null
    }
  }, [])

  const promoteDisplayCandidate = useCallback(
    (candidate: string, chunkId: string) => {
      const normalized = normalizeSpaces(candidate)

      if (!normalized) return
      if (!isProbablyEnglish(normalized)) {
        mark('display rejected', 'non-English candidate')
        return
      }

      setAudienceDisplay(createLocalDisplay(normalized, chunkId))
      requestDisplayExtraction(normalized, chunkId)
      mark('display promoted', normalized)
    },
    [mark, requestDisplayExtraction],
  )

  const queueDisplayCandidate = useCallback(
    (text: string, chunkId: string, source: StreamSource) => {
      if (source === 'generated') return

      const candidate = normalizeSpaces(
        [pendingDisplayTextRef.current, text].filter(Boolean).join(' '),
      )

      clearDisplayBufferTimer()

      if (shouldPromoteToDisplay(candidate)) {
        pendingDisplayTextRef.current = ''
        pendingDisplayChunkIdRef.current = null
        promoteDisplayCandidate(candidate, chunkId)
        return
      }

      pendingDisplayTextRef.current = candidate
      pendingDisplayChunkIdRef.current = chunkId
      mark('display buffered', candidate)

      displayBufferTimerRef.current = window.setTimeout(() => {
        const dropped = pendingDisplayTextRef.current
        pendingDisplayTextRef.current = ''
        pendingDisplayChunkIdRef.current = null
        displayBufferTimerRef.current = null
        mark('display buffer dropped', dropped)
      }, 2800)
    },
    [clearDisplayBufferTimer, mark, promoteDisplayCandidate],
  )

  const appendFinalizedChunk = useCallback(
    (text: string, source: StreamSource) => {
      const trimmed = normalizeSpaces(text)

      if (!trimmed) return null
      if (!isProbablyEnglish(trimmed)) {
        mark('finalized text rejected', 'non-English text')
        return null
      }

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
      mark('sentence or phrase finalized', trimmed)
      queueDisplayCandidate(trimmed, chunk.id, source)

      return chunk
    },
    [mark, queueDisplayCandidate],
  )

  const buildPlannerPrompt = useCallback(() => {
    const recentChunks = finalizedChunksRef.current.slice(-5)
    const currentFinalizedSpeech =
      [...finalizedChunksRef.current]
        .reverse()
        .find((chunk) => chunk.source === 'speech' || chunk.source === 'typed')?.text ||
      '(none yet)'
    const recentContext = recentChunks.length
      ? recentChunks.map((chunk) => `${chunk.source}: ${chunk.text}`).join('\n')
      : finalizedTextRef.current.trim() || '(none yet)'
    const acceptedScripts = acceptedScriptsRef.current.slice(-5)
    const skippedScripts = skippedScriptsRef.current.slice(-3)
    const topicDrift = topicDriftRef.current.slice(-3)
    const deliveredCount = acceptedScripts.length
    const suggestedBeat = topicDrift.length
      ? 'bridge the latest user topic back to the main presentation'
      : nextStoryBeat(deliveredCount)
    const visualInstructions = experimentalAsciiVisuals
      ? [
          'After the paragraph, include a newline, the exact marker ---VISUAL_SEARCH_QUERY---, then one short concrete visual search phrase of 1-4 words.',
          'The visual search phrase should name one clear creature, object, product, plant, place, or visual prop from the next paragraph or latest speaker topic.',
          'Prefer words likely to exist in an ASCII art archive, such as horse, tree, plants, drink, robot, apple, forest, can, flower, mountain, or stage.',
          'Do not generate ASCII art yourself. The app will fetch a credited reference from ASCII Art Archive.',
        ]
      : [
          'After the paragraph, include a newline, the exact marker ---VISUAL_CUES_JSON---, then strict JSON for 1-2 lightweight visual cues.',
          'The visual cues should target a glyph-particle scene, not an image. Keep cue words simple too.',
          'If the presenter pivots to a concrete object, place, creature, product, or scene, the visual cue must name that subject directly.',
          'JSON shape: [{"phrase":"living demo","prompt":"bright glyphs form a live stage","sceneType":"glyph-scene","targetTiming":{"paragraphIndex":0,"phraseMatch":"living demo","wordIndex":2}}]',
        ]

    return [
      'You are writing the next thing I should say in an improvised live demo.',
      `This is beat ${deliveredCount + 1} of the talk. Continue the presentation from what was already said.`,
      `The next story job is: ${suggestedBeat}.`,
      'Do not restart the demo. Do not recap the same idea in new words.',
      'Do not repeat accepted/read generated scripts, skipped scripts, or the latest speaker transcript.',
      'Move the story forward by adding one new concrete beat: a quick example, a product moment, a playful surprise, a live audience payoff, or a simple closing step.',
      'Think of the flow as A then B then C then D. If B was just delivered, C must be a new next topic, not another version of B.',
      'If the last script mentioned text, voice, glyphs, or the living demo, the next script should add a new angle instead of saying those same benefits again.',
      'Write like a friendly person talking on stage, not like a product document.',
      'Use very simple English words that are easy to hear, catch, and pronounce out loud.',
      'Keep it casual, fun, and demo-like. It should sound natural when spoken.',
      'Use short sentences. Prefer clear words over clever words.',
      'Avoid jargon, buzzwords, dense technical terms, long clauses, and tongue-twister phrases.',
      'Do not say things like leverage, enable, facilitate, optimize, paradigm, robust, seamless, architecture, pipeline, interface, infrastructure, orchestration, or stakeholders unless the presenter already said that exact word.',
      'Use the presentation goal and recent transcript. Stay specific to the speaker topic.',
      'If the presenter went off script, follow the latest spoken topic instead of forcing the old script.',
      'Write in English only. If recent transcript contains non-English text, translate or summarize its meaning in simple English; never copy non-English words or characters.',
      'Return one short spoken paragraph first, about 2-4 short sentences. No bullets and no label before the paragraph.',
      ...visualInstructions,
      '',
      `Presentation goal:\n${presentationBriefRef.current || '(no explicit brief)'}`,
      '',
      `User topic drift to weave in without losing the original goal:\n${topicDrift.length ? topicDrift.join('\n') : '(none yet)'}`,
      '',
      `Current finalized speaker speech:\n${currentFinalizedSpeech}`,
      '',
      `Recent chronological context:\n${recentContext}`,
      '',
      `Already said by generated script. Do not repeat these ideas:\n${acceptedScripts.length ? acceptedScripts.join('\n') : '(none yet)'}`,
      '',
      `Rejected or skipped directions. Avoid repeating these too:\n${skippedScripts.length ? skippedScripts.join('\n') : '(none yet)'}`,
    ].join('\n')
  }, [])

  const requestPlanning = useCallback(
    (reason: string, options: PlanningOptions = {}) => {
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

      if (!options.retry) {
        planningRetryCountRef.current = 0
        lastPlanningReasonRef.current = reason
      }

      planningRawRef.current = ''
      planningStartedAtRef.current = performance.now()
      setPlanningDraft('')
      setGeneratedParagraph(null)
      generatedParagraphRef.current = null
      setPlanningState('generating')
      planningStateRef.current = 'generating'
      setScriptFeedback('idle')
      mark(
        'llm request started',
        options.retry ? `${reason} (retry ${planningRetryCountRef.current})` : reason,
      )
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
          'You are a silent live demo writer. Do not speak out loud unless explicitly asked. Always produce English text only. If the user speech includes non-English text, translate or summarize it into simple English before using it. Never output non-English words or characters. Write casual, fun presenter script with very simple words, short sentences, and no jargon. Make every line easy to pronounce live.',
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

  const cleanupPlanningResponse = useCallback((responseId: string) => {
    if (!responseId) return

    responsePurposesRef.current.delete(responseId)
    responseRequestIdsRef.current.delete(responseId)
  }, [])

  const failOrRetryPlanning = useCallback(
    (message: string) => {
      if (planningRetryCountRef.current < maxPlanningRetries) {
        planningRetryCountRef.current += 1
        planningStateRef.current = 'idle'
        setPlanningState('idle')
        setPlanningDraft('')
        planningRawRef.current = ''
        mark('generation retrying', message)
        requestPlanning(lastPlanningReasonRef.current || 'retry', { retry: true })
        return
      }

      setPlanningState('failed')
      planningStateRef.current = 'failed'
      setPlanningDraft('')
      setLastError(message)
      mark('generation failed', message)
    },
    [mark, requestPlanning],
  )

  const applyGeneratedScene = useCallback(
    (paragraph: GeneratedParagraph) => {
      if (experimentalAsciiVisuals) {
        mark('glyph scene skipped for reference visual experiment', paragraph.text)
        return
      }

      const cue = paragraph.visualCues[0]
      const fallbackScene = generateGlyphSceneConfig(cue, paragraph)

      setActiveSceneConfig(fallbackScene)
      mark('glyph scene fallback ready', fallbackScene.sourcePhrase)
      void requestGlyphSceneConfig(cue, paragraph).then((sceneConfig) => {
        setActiveSceneConfig(sceneConfig)
        mark('glyph scene ready', sceneConfig.sourcePhrase)
      })
    },
    [mark],
  )

  const requestVisualReferences = useCallback(
    async (paragraph: GeneratedParagraph) => {
      if (!experimentalAsciiVisuals) return

      const visualQuery = normalizeSpaces(paragraph.visualQuery || paragraph.text)

      setVisualReferences([
        {
          provider: 'asciiart.eu',
          status: 'missing',
          query: visualQuery,
          message: 'Loading ASCII Art Archive...',
        },
      ])

      try {
        const response = await fetch('/api/visual-references', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            visualQuery,
            paragraph: paragraph.text,
          }),
        })
        const payload = (await response.json()) as {
          references?: VisualReference[]
        }
        const readyReferenceExists = Boolean(
          payload.references?.some((reference) => reference.status === 'ready' && reference.art),
        )

        setVisualReferences(payload.references || [])
        if (readyReferenceExists) {
          setReferenceLayoutVariant(
            referenceLayoutVariants[
              Math.floor(Math.random() * referenceLayoutVariants.length)
            ],
          )
        }
        mark('visual references ready', visualQuery)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Visual reference lookup failed'

        setVisualReferences([
          {
            provider: 'asciiart.eu',
            status: 'failed',
            query: visualQuery,
            message,
          },
        ])
        mark('visual references failed', message)
      }
    },
    [mark],
  )

  const applySpokenScene = useCallback(
    (spokenTranscript: string, topicShift = 0) => {
      if (experimentalAsciiVisuals) {
        setSpeechSignals(speechSignalsFromText(spokenTranscript, topicShift))
        mark('glyph scene skipped for ascii experiment', spokenTranscript)
        return
      }

      const paragraph = {
        id: `spoken-${Date.now()}`,
        text: spokenTranscript,
      }
      const fallbackScene = generateGlyphSceneConfig(undefined, paragraph)

      setActiveSceneConfig(fallbackScene)
      setSpeechSignals(speechSignalsFromText(spokenTranscript, topicShift))
      mark('glyph scene retargeted from speech', fallbackScene.sourcePhrase)
      void requestGlyphSceneConfig(undefined, paragraph).then((sceneConfig) => {
        setActiveSceneConfig(sceneConfig)
        mark('dynamic glyph scene ready', sceneConfig.sourcePhrase)
      })
    },
    [mark],
  )

  const handlePlanningDelta = useCallback(
    (event: ServerEvent) => {
      const responseId = eventResponseId(event)
      const responseRequestId = responseRequestIdsRef.current.get(responseId)

      if (responseRequestId && responseRequestId !== planningRequestIdRef.current) {
        mark('stale planning delta ignored', `request ${responseRequestId}`)
        return
      }

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
        cleanupPlanningResponse(responseId)
        return
      }

      const raw = planningRawRef.current || textFromResponseDone(event)
      const split = splitPlanningResponse(raw)
      const paragraph = split.paragraph
      const visualCues = parseVisualCues(split.visualCueText)
      const visualQuery = normalizeSpaces(split.visualQuery)

      if (!paragraph || !isProbablyEnglish(paragraph)) {
        cleanupPlanningResponse(responseId)
        failOrRetryPlanning(
          'Planning response finished without usable English paragraph text.',
        )
        return
      }

      const generated: GeneratedParagraph = {
        id: `generated-${Date.now()}`,
        sourceContextIds: finalizedChunksRef.current.map((chunk) => chunk.id),
        text: paragraph,
        createdAt: new Date().toISOString(),
        visualCues,
        visualQuery,
      }

      hasGeneratedRef.current = true
      generatedParagraphRef.current = generated
      setGeneratedParagraph(generated)
      setPlanningDraft(paragraph)
      setPlanningState('ready')
      planningStateRef.current = 'ready'
      applyGeneratedScene(generated)
      void requestVisualReferences(generated)
      mark(
        'usable paragraph received',
        planningStartedAtRef.current == null
          ? undefined
          : `${Math.round(performance.now() - planningStartedAtRef.current)}ms`,
      )

      if (visualCues.length) {
        mark('visual cue received', visualCues.map((cue) => cue.phrase).join(', '))
      }

      planningRetryCountRef.current = 0
      cleanupPlanningResponse(responseId)
    },
    [applyGeneratedScene, cleanupPlanningResponse, failOrRetryPlanning, mark, requestVisualReferences],
  )

  const clearVisibleScript = useCallback(() => {
    generatedParagraphRef.current = null
    setGeneratedParagraph(null)
    setPlanningDraft('')
    setVisualReferences([])
  }, [])

  const completeCurrentScript = useCallback(
    (spokenTranscript: string) => {
      const currentScript = generatedParagraphRef.current?.text

      if (!currentScript) return

      acceptedScriptsRef.current = [...acceptedScriptsRef.current, currentScript].slice(-5)
      appendFinalizedChunk(currentScript, 'generated')
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
    [
      appendFinalizedChunk,
      clearAutoGenerationTimer,
      clearVisibleScript,
      mark,
      requestPlanning,
      showTemporaryScriptFeedback,
    ],
  )

  const handleScriptDivergence = useCallback(
    (spokenTranscript: string) => {
      const currentScript = generatedParagraphRef.current?.text

      if (!currentScript) return

      skippedScriptsRef.current = [...skippedScriptsRef.current, currentScript].slice(-5)
      topicDriftRef.current = [...topicDriftRef.current, spokenTranscript].slice(-5)
      applySpokenScene(spokenTranscript, 1)
      hasGeneratedRef.current = false
      planningStateRef.current = 'idle'
      setPlanningState('idle')
      showTemporaryScriptFeedback('diverged')
      mark('script diverged', spokenTranscript)
      clearAutoGenerationTimer()
      clearVisibleScript()
      requestPlanning('topic changed')
    },
    [
      applySpokenScene,
      clearAutoGenerationTimer,
      clearVisibleScript,
      mark,
      requestPlanning,
      showTemporaryScriptFeedback,
    ],
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
        const liveText = Array.from(partialByItemRef.current.values())
            .join(' ')
            .trim()
        const visibleLiveText = liveText.split(/\s+/).slice(-18).join(' ')

        setPartialTranscript(
          !visibleLiveText || isProbablyEnglish(visibleLiveText) ? visibleLiveText : '',
        )
        setSpeechSignals(speechSignalsFromText(visibleLiveText))
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
        if (!isProbablyEnglish(transcript)) {
          mark('speech transcript rejected', 'non-English transcript')
          return
        }

        appendFinalizedChunk(transcript, 'speech')
        setSpeechSignals(speechSignalsFromText(transcript))

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
          finishPlanning(event)
        }

        if (purpose === 'display-extract') {
          finishDisplayExtraction(event)
        }
        return
      }

      if (event.type === 'error' || event.error) {
        const message = event.error?.message || event.message || 'Realtime error'
        const purpose = responsePurposesRef.current.get(responseId) || eventTopic(event)

        if (purpose === 'teleprompter-plan') {
          cleanupPlanningResponse(responseId)
          failOrRetryPlanning(message)
          return
        }

        setConnectionState('error')
        setStatus('Realtime error.')
        setLastError(message)
        mark('error', message)
      }
    },
    [
      appendFinalizedChunk,
      cleanupPlanningResponse,
      completeCurrentScript,
      failOrRetryPlanning,
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
    clearDisplayBufferTimer()
    setPartialTranscript('')
    finalizedChunksRef.current = []
    finalizedTextRef.current = ''
    pendingDisplayTextRef.current = ''
    pendingDisplayChunkIdRef.current = null
    hasGeneratedRef.current = false
    planningRetryCountRef.current = 0
    lastPlanningReasonRef.current = ''
    acceptedScriptsRef.current = []
    skippedScriptsRef.current = []
    topicDriftRef.current = []
    planningStateRef.current = 'idle'
    planningRawRef.current = ''
    setFinalizedChunks([])
    setAudienceDisplay(createLocalDisplay(''))
    setActiveSceneConfig(initialScene)
    setSpeechSignals(defaultSpeechSignals)
    setReferenceLayoutVariant('text-left-art-right')
    clearVisibleScript()
    setVisualReferences([])
    setPlanningState('idle')
    setScriptFeedback('idle')
    setScriptOverlayVisible(true)
    setTimings([])
    setLastError('')
    mark('session cleared')
  }, [clearDisplayBufferTimer, clearVisibleScript, initialScene, mark])

  useEffect(() => {
    return () => {
      closeRealtimeHandles()
      clearFeedbackTimer()
      clearAutoGenerationTimer()
      clearDisplayBufferTimer()
    }
  }, [
    clearAutoGenerationTimer,
    clearDisplayBufferTimer,
    clearFeedbackTimer,
    closeRealtimeHandles,
  ])

  const canGenerate =
    connectionState === 'listening' &&
    planningState !== 'generating' &&
    !generatedParagraph
  const canRegenerate = connectionState === 'listening' && planningState !== 'generating'
  const visibleScript = planningDraft || generatedParagraph?.text || ''
  const emphasisSet = new Set(audienceDisplay.emphasis.map(normalizeDisplayWord))
  const hasReadyReference = visualReferences.some(
    (reference) => reference.status === 'ready' && reference.art,
  )

  return (
    <main className={`app-shell ${overlayVisible && !isEvalMode ? '' : 'overlay-hidden'} ${isEvalMode ? 'eval-mode' : ''} ${experimentalAsciiVisuals ? 'ascii-mode' : ''} ${hasReadyReference ? 'reference-art-visible' : ''} ${hasReadyReference ? `reference-layout-${referenceLayoutVariant}` : ''}`}>
      <section className="stage" aria-label="Audience teleprompter">
        {experimentalAsciiVisuals ? null : (
          <GlyphStage sceneConfig={activeSceneConfig} speechSignals={speechSignals} />
        )}
        {experimentalAsciiVisuals && hasReadyReference ? (
          <div className="reference-visuals" aria-label="Reference visuals">
            {visualReferences
              .filter((reference) => reference.status === 'ready' && reference.art)
              .map((reference) => (
              <article
                className="reference-card asciiart-card"
                key={reference.provider}
              >
                <pre>{reference.art}</pre>
              </article>
            ))}
          </div>
        ) : null}
        {experimentalAsciiVisuals ? (
          <div className="reference-credit" aria-live="polite">
            {visualReferences
              .filter((reference) => reference.status === 'ready' && reference.art && reference.credit)
              .map((reference) => reference.credit)
              .join('')}
          </div>
        ) : null}
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

      {!overlayVisible && !isEvalMode ? (
        <>
          <button
            type="button"
            className="overlay-toggle floating"
            onClick={() => setOverlayVisible(true)}
          >
            Controls
          </button>
          <button
            type="button"
            className="script-toggle floating icon-button secondary"
            onClick={() => setScriptOverlayVisible((current) => !current)}
            disabled={!visibleScript}
            aria-label={scriptOverlayVisible ? 'Hide generated script' : 'Show generated script'}
            title={scriptOverlayVisible ? 'Hide generated script' : 'Show generated script'}
          >
            {scriptOverlayVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </>
      ) : null}

      {!overlayVisible && !isEvalMode && scriptOverlayVisible && visibleScript ? (
        <aside className="script-overlay" aria-label="Generated next script">
          {visibleScript}
        </aside>
      ) : null}

      {overlayVisible && !isEvalMode ? (
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

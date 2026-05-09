import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { clientConfig } from './teleprompter/config'
import { phaseZeroFixture } from './teleprompter/fixtures'
import type { GeneratedParagraph, StreamChunk, VisualCue } from './teleprompter/types'

type PlanningState = 'idle' | 'generating' | 'ready' | 'failed'
type ConnectionState = 'idle' | 'connecting' | 'listening' | 'error'

type TimingEntry = {
  id: number
  label: string
  atMs: number
  detail?: string
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

function parseVisualCues(raw: string): VisualCue[] {
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim())
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
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [status, setStatus] = useState('Ready for Phase 0.5 Realtime spike.')
  const [presentationBrief, setPresentationBrief] = useState(
    phaseZeroFixture.presentationBrief,
  )
  const [partialTranscript, setPartialTranscript] = useState('')
  const [finalizedChunks, setFinalizedChunks] = useState<StreamChunk[]>(
    phaseZeroFixture.typedInput,
  )
  const [planningState, setPlanningState] = useState<PlanningState>('idle')
  const [planningDraft, setPlanningDraft] = useState('')
  const [generatedParagraph, setGeneratedParagraph] =
    useState<GeneratedParagraph | null>(phaseZeroFixture.generatedParagraphs[0])
  const [timings, setTimings] = useState<TimingEntry[]>([])
  const [lastError, setLastError] = useState('')

  const handlesRef = useRef<RealtimeHandles | null>(null)
  const partialByItemRef = useRef(new Map<string, string>())
  const responsePurposesRef = useRef(new Map<string, string>())
  const responseRequestIdsRef = useRef(new Map<string, number>())
  const planningRawRef = useRef('')
  const finalizedTextRef = useRef(phaseZeroFixture.typedInput.map((item) => item.text).join(' '))
  const planningStartedAtRef = useRef<number | null>(null)
  const lastFinalizedAtRef = useRef<number | null>(null)
  const timingIdRef = useRef(0)
  const planningRequestIdRef = useRef(0)
  const hasGeneratedRef = useRef(true)
  const planningStateRef = useRef<PlanningState>('idle')
  const presentationBriefRef = useRef(presentationBrief)

  useEffect(() => {
    planningStateRef.current = planningState
  }, [planningState])

  useEffect(() => {
    presentationBriefRef.current = presentationBrief
  }, [presentationBrief])

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

  const buildPlannerPrompt = useCallback(() => {
    const recentContext = finalizedTextRef.current.trim() || '(none yet)'

    return [
      'You are writing the next thing I should say in an improvised live demo.',
      'Use the presentation goal and recent transcript. Stay specific to the speaker topic.',
      'Write in English only. Return one short paragraph first. No bullets and no label before the paragraph.',
      'After the paragraph, include a newline, the exact marker ---VISUAL_CUES_JSON---, then strict JSON for 1-2 lightweight visual cues.',
      'The visual cues should target a glyph-particle scene, not an image. Keep them compact.',
      'JSON shape: [{"phrase":"living teleprompter","prompt":"glyph particles form a responsive stage","sceneType":"glyph-scene","targetTiming":{"paragraphIndex":0,"phraseMatch":"living teleprompter","wordIndex":3}}]',
      '',
      `Presentation goal:\n${presentationBriefRef.current || '(no explicit brief)'}`,
      '',
      `Recent finalized speaker transcript:\n${recentContext}`,
    ].join('\n')
  }, [])

  const requestPlanning = useCallback(
    (reason: string) => {
      if (planningStateRef.current === 'generating') {
        mark('planning skipped', 'already generating')
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
      setPlanningState('generating')
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

      if (!paragraph) {
        setPlanningState('failed')
        setLastError('Planning response finished without usable paragraph text.')
        mark('generation failed', 'empty paragraph')
        return
      }

      const generated: GeneratedParagraph = {
        id: `generated-${Date.now()}`,
        sourceContextIds: finalizedChunks.map((chunk) => chunk.id),
        text: paragraph,
        createdAt: new Date().toISOString(),
        visualCues,
      }

      hasGeneratedRef.current = true
      setGeneratedParagraph(generated)
      setPlanningDraft(paragraph)
      setPlanningState('ready')
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
    [finalizedChunks, mark],
  )

  const handleServerEvent = useCallback(
    (event: ServerEvent) => {
      const responseId = eventResponseId(event)
      const topic = eventTopic(event)

      if (responseId && topic) {
        responsePurposesRef.current.set(responseId, topic)
        const requestId = Number(event.response?.metadata?.requestId)

        if (Number.isFinite(requestId)) {
          responseRequestIdsRef.current.set(responseId, requestId)
        }
      }

      if (event.type === 'session.created') {
        setStatus('Connected. Speak a sentence to test real generation.')
        setConnectionState('listening')
        mark('session created')
        return
      }

      if (event.type === 'conversation.item.input_audio_transcription.delta') {
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

        if (!transcript) return

        lastFinalizedAtRef.current = performance.now()
        finalizedTextRef.current = `${finalizedTextRef.current} ${transcript}`.trim()
        setFinalizedChunks((current) => [
          ...current,
          {
            id: `speech-${Date.now()}`,
            text: transcript,
            timestamp: new Date().toISOString(),
            source: 'speech',
            status: 'final',
          },
        ])
        mark('sentence or phrase finalized', transcript)

        if (!hasGeneratedRef.current || planningStateRef.current === 'idle') {
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
    [finishPlanning, handlePlanningDelta, mark, requestPlanning],
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
        setStatus('Listening. Speak a short sentence.')
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

  useEffect(() => closeRealtimeHandles, [closeRealtimeHandles])

  const canGenerate = connectionState === 'listening' && planningState !== 'generating'
  const latestDisplay =
    finalizedChunks[finalizedChunks.length - 1]?.text || 'Speak to begin'
  const visibleScript = planningDraft || generatedParagraph?.text || ''
  const cue = generatedParagraph?.visualCues[0]

  return (
    <main className="app-shell">
      <section className="stage" aria-labelledby="stage-title">
        <p className="stage-label">Phase 0.5 Realtime spike</p>
        <h1 id="stage-title">
          <span>living</span> teleprompter
        </h1>
        <p className="stage-phrase">{latestDisplay}</p>
        <p className={`live-transcript ${partialTranscript ? 'active' : ''}`}>
          {partialTranscript
            ? `listening: ${partialTranscript}`
            : 'partial transcript will render here while you speak'}
        </p>
      </section>

      <aside className="presenter-panel" aria-label="Presenter controls">
        <section className="control-section">
          <h2>Realtime</h2>
          <p className={`status-pill ${connectionState}`}>{status}</p>
          <div className="button-row">
            <button
              type="button"
              onClick={startRealtime}
              disabled={connectionState === 'connecting' || connectionState === 'listening'}
            >
              Start mic
            </button>
            <button
              type="button"
              onClick={stopRealtime}
              disabled={connectionState !== 'listening'}
            >
              Stop
            </button>
          </div>
          {lastError ? <p className="error-text">{lastError}</p> : null}
        </section>

        <section>
          <h2>Presentation brief</h2>
          <textarea
            value={presentationBrief}
            onChange={(event) => setPresentationBrief(event.target.value)}
            disabled={connectionState === 'listening' || connectionState === 'connecting'}
            rows={4}
          />
        </section>

        <section className="next-script">
          <div className="section-heading-row">
            <h2>Generated next script</h2>
            <span className={`script-state ${planningState}`}>{planningState}</span>
          </div>
          <p className={visibleScript ? '' : 'muted'}>
            {visibleScript || 'Speak a sentence, or click Generate next after context exists.'}
          </p>
          <button type="button" onClick={() => requestPlanning('manual')} disabled={!canGenerate}>
            Generate next
          </button>
        </section>

        <section className="system-grid">
          <div>
            <h2>Endpoint</h2>
            <code>{clientConfig.realtimeSessionPath}</code>
          </div>
          <div>
            <h2>Visual cue</h2>
            <code>{cue?.sceneType || 'waiting'}</code>
            <p>{cue?.phrase || 'No cue received yet.'}</p>
          </div>
        </section>

        <section>
          <h2>Finalized context</h2>
          <ol className="chunk-list">
            {finalizedChunks.slice(-5).map((chunk) => (
              <li key={chunk.id}>{chunk.text}</li>
            ))}
          </ol>
        </section>

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
      </aside>
    </main>
  )
}

export default App

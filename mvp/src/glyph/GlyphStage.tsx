import { useEffect, useRef } from 'react'
import { GlyphSceneEngine } from './GlyphSceneEngine'
import type { GlyphSceneConfig, SpeechSignals } from '../teleprompter/types'

type GlyphStageProps = {
  sceneConfig: GlyphSceneConfig
  speechSignals: SpeechSignals
}

export function GlyphStage({ sceneConfig, speechSignals }: GlyphStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<GlyphSceneEngine | null>(null)
  const initialSceneRef = useRef(sceneConfig)

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) return

    const engine = new GlyphSceneEngine(canvas, initialSceneRef.current)

    engineRef.current = engine
    engine.start()

    const resizeObserver = new ResizeObserver(() => engine.resize())

    resizeObserver.observe(canvas)
    window.addEventListener('resize', engine.resize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', engine.resize)
      engine.stop()
      engineRef.current = null
    }
  }, [])

  useEffect(() => {
    engineRef.current?.retarget(sceneConfig)
  }, [sceneConfig])

  useEffect(() => {
    engineRef.current?.updateSpeechSignals(speechSignals)
  }, [speechSignals])

  return (
    <canvas
      ref={canvasRef}
      className="glyph-stage"
      aria-hidden="true"
    />
  )
}

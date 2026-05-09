export type StreamSource = 'typed' | 'speech' | 'generated'

export type StreamStatus = 'partial' | 'final'

export type StreamChunk = {
  id: string
  text: string
  timestamp: string
  source: StreamSource
  status: StreamStatus
}

export type VisualCue = {
  id: string
  phrase: string
  prompt: string
  targetTiming: {
    paragraphIndex: number
    phraseMatch: string
    wordIndex?: number
  }
  sceneType: 'glyph-scene' | 'force-field' | 'canvas-effect' | 'pretext-effect'
  status: 'pending' | 'generating' | 'ready' | 'failed'
}

export type GeneratedParagraph = {
  id: string
  sourceContextIds: string[]
  text: string
  createdAt: string
  visualCues: VisualCue[]
}

export type DemoFixture = {
  presentationBrief: string
  typedInput: StreamChunk[]
  generatedParagraphs: GeneratedParagraph[]
}

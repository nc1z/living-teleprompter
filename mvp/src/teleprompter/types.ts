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
  sceneType: 'glyph-scene' | 'force-field' | 'canvas-effect' | 'pretext-effect' | 'image'
  status: 'pending' | 'generating' | 'ready' | 'failed'
}

export type GlyphSceneMood =
  | 'calm'
  | 'focused'
  | 'playful'
  | 'dramatic'
  | 'storm'
  | 'forest'
  | 'product'
  | 'object'
  | 'abstract'

export type GlyphClusterShapeType =
  | 'ellipse'
  | 'line'
  | 'rect'
  | 'spiral'
  | 'scatter'
  | 'rain'

export type GlyphSceneCluster = {
  id: string
  glyphs: string[]
  color: string
  opacity: number
  scale: number
  weight: number
  shape: {
    type: GlyphClusterShapeType
    center: {
      x: number
      y: number
    }
    radius: {
      x: number
      y: number
    }
    rotation?: number
    turns?: number
  }
}

export type GlyphSceneMap = {
  rows: string[]
  color?: string
  accent?: string
  scale?: number
}

export type GlyphForceField = {
  id: string
  type: 'repel' | 'attract' | 'vortex' | 'wind' | 'noise' | 'flow' | 'speechPulse'
  strength: number
  radius: number
  position?: {
    x: number
    y: number
  }
  direction?: {
    x: number
    y: number
  }
}

export type GlyphSceneConfig = {
  id: string
  cueId: string
  status: 'ready' | 'failed'
  sourcePhrase: string
  targetTiming: VisualCue['targetTiming']
  sceneType: VisualCue['sceneType']
  palette: {
    background: string
    primary: string
    accent: string
    muted: string
    glyphs: string[]
  }
  glyphMap?: GlyphSceneMap
  clusters: GlyphSceneCluster[]
  mood: GlyphSceneMood
  creatures: string[]
  forceFields: GlyphForceField[]
  speechMappings: {
    volume: string
    pace: string
    emphasis: string
    topicShift: string
  }
  reducedMotion: boolean
  errorMessage?: string
  createdAt: string
  updatedAt: string
}

export type SpeechSignals = {
  volume: number
  pace: number
  pitch: number
  pauseDurationMs: number
  emphasis: number
  confidence: number
  topicShift: number
  sentiment: 'neutral' | 'positive' | 'tense' | 'playful' | 'serious'
  currentWordIndex: number
}

export type GeneratedParagraph = {
  id: string
  sourceContextIds: string[]
  text: string
  createdAt: string
  visualCues: VisualCue[]
  asciiArt?: string
}

export type DemoFixture = {
  presentationBrief: string
  typedInput: StreamChunk[]
  generatedParagraphs: GeneratedParagraph[]
}

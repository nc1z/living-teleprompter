import type {
  GeneratedParagraph,
  GlyphClusterShapeType,
  GlyphForceField,
  GlyphSceneCluster,
  GlyphSceneConfig,
  GlyphSceneMood,
  VisualCue,
} from '../teleprompter/types'

type SceneInput = {
  cue?: VisualCue
  paragraph?: Pick<GeneratedParagraph, 'id' | 'text'>
}

const glyphBanks = [
  ['●', '◐', '◑', '○', '◆', '◇', '✦', '·'],
  ['│', '╱', '╲', '┃', '┆', '┊', '✧', '˚'],
  ['▣', '▤', '▥', '□', '◇', '+', '✦', '·'],
  ['•', '·', '˚', '˙', '✦', '✧', '*', '+'],
  ['—', '╱', '╲', '◇', '◆', '✦', '✧', '·'],
]

const palettes = [
  ['#111827', '#2563eb', '#bfdbfe'],
  ['#14532d', '#16a34a', '#86efac'],
  ['#7f1d1d', '#dc2626', '#fca5a5'],
  ['#0f766e', '#f59e0b', '#99f6e4'],
  ['#4c1d95', '#db2777', '#c4b5fd'],
  ['#0369a1', '#0891b2', '#bae6fd'],
]

const shapeTypes: GlyphClusterShapeType[] = [
  'ellipse',
  'line',
  'rect',
  'spiral',
  'scatter',
  'rain',
]

function hashText(value: string) {
  return [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizedWords(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
}

function buildFallbackClusters(seed: number, palette: string[], glyphs: string[]) {
  const clusters: GlyphSceneCluster[] = []

  for (let index = 0; index < 4; index += 1) {
    const shape = shapeTypes[(seed + index * 3) % shapeTypes.length]
    const x = 0.34 + (((seed >> (index + 1)) % 32) / 100)
    const y = 0.38 + (((seed >> (index + 4)) % 30) / 100)
    const radiusX = 0.08 + (((seed >> (index + 7)) % 18) / 100)
    const radiusY = 0.08 + (((seed >> (index + 10)) % 18) / 100)

    clusters.push({
      id: `cluster-${index + 1}`,
      glyphs,
      color: palette[index % palette.length],
      opacity: clamp(0.18 + index * 0.12, 0.18, 0.72),
      scale: clamp(0.85 + index * 0.12, 0.7, 1.5),
      weight: index === 0 ? 0.48 : 0.18,
      shape: {
        type: shape,
        center: {
          x: clamp(x, 0.18, 0.82),
          y: clamp(y, 0.24, 0.78),
        },
        radius: {
          x: radiusX,
          y: radiusY,
        },
        rotation: ((seed % 90) - 45) * (Math.PI / 180),
        turns: 1.5 + (seed % 4),
      },
    })
  }

  return clusters
}

function createSceneConfig(input: SceneInput, sourceText: string): GlyphSceneConfig {
  const seed = hashText(sourceText || input.paragraph?.id || 'default scene')
  const palette = palettes[seed % palettes.length]
  const glyphs = glyphBanks[(seed >> 3) % glyphBanks.length]
  const words = normalizedWords(sourceText)
  const sourcePhrase =
    input.cue?.phrase ||
    words.slice(0, 5).join(' ') ||
    input.paragraph?.text.split(' ').slice(0, 5).join(' ') ||
    'living demo'
  const now = new Date().toISOString()

  return {
    id: `scene-${seed.toString(16)}`,
    cueId: input.cue?.id || `cue-${seed.toString(16)}`,
    status: 'ready',
    sourcePhrase,
    targetTiming: input.cue?.targetTiming || {
      paragraphIndex: 0,
      phraseMatch: sourcePhrase,
    },
    sceneType: input.cue?.sceneType || 'glyph-scene',
    palette: {
      background: 'transparent',
      primary: palette[0],
      accent: palette[1],
      muted: palette[2],
      glyphs,
    },
    glyphMap: undefined,
    clusters: buildFallbackClusters(seed, palette, glyphs),
    mood: 'abstract' satisfies GlyphSceneMood,
    creatures: [`topic-${sourcePhrase.replace(/\s+/g, '-').slice(0, 40)}`],
    forceFields: [
      { id: 'semantic-focus', type: 'attract', strength: 0.24, radius: 0.56, position: { x: 0.52, y: 0.56 } },
      { id: 'voice-pulse', type: 'speechPulse', strength: 0.22, radius: 0.44 },
      { id: 'ambient-motion', type: 'noise', strength: 0.14, radius: 0.9 },
    ] satisfies GlyphForceField[],
    speechMappings: {
      volume: 'particle energy',
      pace: 'flow speed',
      emphasis: 'speech pulse radius',
      topicShift: 'scene retarget vortex',
    },
    reducedMotion: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function generateGlyphSceneConfig(
  cue: VisualCue | undefined,
  paragraph: Pick<GeneratedParagraph, 'id' | 'text'> | undefined,
): GlyphSceneConfig {
  const sourceText = [cue?.phrase, cue?.prompt, paragraph?.text].filter(Boolean).join(' ')

  return createSceneConfig({ cue, paragraph }, sourceText)
}

export async function requestGlyphSceneConfig(
  cue: VisualCue | undefined,
  paragraph: Pick<GeneratedParagraph, 'id' | 'text'> | undefined,
): Promise<GlyphSceneConfig> {
  const fallback = generateGlyphSceneConfig(cue, paragraph)

  try {
    const response = await fetch('/api/glyph-scene', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cue,
        paragraph,
        fallback,
      }),
    })

    if (!response.ok) return fallback

    const generated = (await response.json()) as GlyphSceneConfig

    if (
      (!Array.isArray(generated.clusters) || !generated.clusters.length) &&
      (!Array.isArray(generated.glyphMap?.rows) || !generated.glyphMap.rows.length)
    ) {
      return fallback
    }

    return generated
  } catch {
    return fallback
  }
}

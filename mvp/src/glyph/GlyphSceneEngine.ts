import type {
  GlyphClusterShapeType,
  GlyphForceField,
  GlyphSceneCluster,
  GlyphSceneConfig,
  SpeechSignals,
} from '../teleprompter/types'

type GlyphParticle = {
  id: string
  char: string
  color: string
  homeX: number
  homeY: number
  x: number
  y: number
  vx: number
  vy: number
  rotation: number
  angularVelocity: number
  scale: number
  baseScale: number
  opacity: number
  baseOpacity: number
  depth: number
  energy: number
}

const baseParticleCount = 420
const maxParticleCount = 1800
const defaultSignals: SpeechSignals = {
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function seededRandom(seed: number) {
  let state = seed || 1

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function hashText(value: string) {
  return [...value].reduce((hash, char) => (hash * 33 + char.charCodeAt(0)) >>> 0, 17)
}

function fieldPosition(field: GlyphForceField, width: number, height: number) {
  return {
    x: (field.position?.x ?? 0.5) * width,
    y: (field.position?.y ?? 0.5) * height,
  }
}

function fallbackCluster(scene: GlyphSceneConfig): GlyphSceneCluster {
  const glyphs = scene.palette?.glyphs?.filter(Boolean)

  return {
    id: 'fallback',
    glyphs: glyphs?.length ? glyphs : ['•', '·', '✦', '◇'],
    color: scene.palette?.primary || '#111827',
    opacity: 0.48,
    scale: 1,
    weight: 1,
    shape: {
      type: 'ellipse',
      center: { x: 0.5, y: 0.56 },
      radius: { x: 0.28, y: 0.18 },
    },
  }
}

function normalizeCluster(scene: GlyphSceneConfig, cluster: Partial<GlyphSceneCluster> | undefined) {
  const fallback = fallbackCluster(scene)
  const glyphs = cluster?.glyphs?.filter(Boolean)
  const allowedShapeTypes: GlyphClusterShapeType[] = [
    'ellipse',
    'line',
    'rect',
    'spiral',
    'scatter',
    'rain',
  ]
  const shapeType = allowedShapeTypes.includes(cluster?.shape?.type as GlyphClusterShapeType)
    ? cluster?.shape?.type
    : fallback.shape.type

  return {
    ...fallback,
    ...cluster,
    glyphs: glyphs?.length ? glyphs : fallback.glyphs,
    color: cluster?.color || fallback.color,
    opacity: Number.isFinite(cluster?.opacity) ? Number(cluster?.opacity) : fallback.opacity,
    scale: Number.isFinite(cluster?.scale) ? Number(cluster?.scale) : fallback.scale,
    weight: Number.isFinite(cluster?.weight) ? Number(cluster?.weight) : fallback.weight,
    shape: {
      type: shapeType || fallback.shape.type,
      center: {
        x: Number.isFinite(cluster?.shape?.center?.x)
          ? Number(cluster?.shape?.center?.x)
          : fallback.shape.center.x,
        y: Number.isFinite(cluster?.shape?.center?.y)
          ? Number(cluster?.shape?.center?.y)
          : fallback.shape.center.y,
      },
      radius: {
        x: Number.isFinite(cluster?.shape?.radius?.x)
          ? Number(cluster?.shape?.radius?.x)
          : fallback.shape.radius.x,
        y: Number.isFinite(cluster?.shape?.radius?.y)
          ? Number(cluster?.shape?.radius?.y)
          : fallback.shape.radius.y,
      },
      rotation: Number.isFinite(cluster?.shape?.rotation)
        ? Number(cluster?.shape?.rotation)
        : fallback.shape.rotation,
      turns: Number.isFinite(cluster?.shape?.turns)
        ? Number(cluster?.shape?.turns)
        : fallback.shape.turns,
    },
  } satisfies GlyphSceneCluster
}

function sceneClusters(scene: GlyphSceneConfig) {
  const clusters = Array.isArray(scene.clusters)
    ? scene.clusters.map((cluster) => normalizeCluster(scene, cluster))
    : []

  return clusters.length ? clusters : [fallbackCluster(scene)]
}

function glyphMapRows(scene: GlyphSceneConfig) {
  return Array.isArray(scene.glyphMap?.rows)
    ? scene.glyphMap.rows.map((row) => String(row).slice(0, 80))
    : []
}

function glyphMapPoints(scene: GlyphSceneConfig, width: number, height: number) {
  const rows = glyphMapRows(scene)
  const maxColumns = Math.max(...rows.map((row) => [...row].length), 0)

  if (!rows.length || !maxColumns) return []

  const cellSize = Math.min(width * 0.62 / maxColumns, height * 0.5 / rows.length)
  const startX = width * 0.5 - (maxColumns * cellSize) / 2
  const startY = height * 0.56 - (rows.length * cellSize) / 2
  const points: Array<{ x: number; y: number; char: string; color: string }> = []

  rows.forEach((row, rowIndex) => {
    for (const [columnIndex, char] of [...row].entries()) {
      if (!char.trim()) return

      points.push({
        x: startX + columnIndex * cellSize,
        y: startY + rowIndex * cellSize,
        char,
        color: /[|/\\_\-.,'`]/.test(char)
          ? scene.glyphMap?.accent || scene.palette.accent
          : scene.glyphMap?.color || scene.palette.primary,
      })
    }
  })

  return points
}

function glyphMapLayout(scene: GlyphSceneConfig, width: number, height: number) {
  const rows = glyphMapRows(scene)
  const maxColumns = Math.max(...rows.map((row) => [...row].length), 0)

  if (!rows.length || !maxColumns) return null

  const cellSize = Math.min(width * 0.62 / maxColumns, height * 0.5 / rows.length)

  return {
    rows,
    cellSize,
    startX: width * 0.5 - (maxColumns * cellSize) / 2,
    startY: height * 0.56 - (rows.length * cellSize) / 2,
  }
}

function clusterPoint(
  cluster: GlyphSceneCluster,
  ratio: number,
  random: () => number,
  width: number,
  height: number,
) {
  const centerX = cluster.shape.center.x * width
  const centerY = cluster.shape.center.y * height
  const radiusX = cluster.shape.radius.x * width
  const radiusY = cluster.shape.radius.y * height
  const angle = ratio * Math.PI * 2
  const rotation = cluster.shape.rotation || 0
  const shapeHandlers: Record<GlyphClusterShapeType, () => { x: number; y: number }> = {
    ellipse: () => {
      const distance = Math.sqrt(random())
      return {
        x: Math.cos(angle) * radiusX * distance,
        y: Math.sin(angle) * radiusY * distance,
      }
    },
    line: () => ({
      x: (ratio - 0.5) * radiusX * 2,
      y: (random() - 0.5) * radiusY * 0.35,
    }),
    rect: () => ({
      x: (random() - 0.5) * radiusX * 2,
      y: (random() - 0.5) * radiusY * 2,
    }),
    spiral: () => {
      const turns = cluster.shape.turns || 2.5
      const spiralAngle = ratio * Math.PI * 2 * turns
      return {
        x: Math.cos(spiralAngle) * radiusX * ratio,
        y: Math.sin(spiralAngle) * radiusY * ratio,
      }
    },
    scatter: () => ({
      x: (random() - 0.5) * radiusX * 2,
      y: (random() - 0.5) * radiusY * 2,
    }),
    rain: () => ({
      x: (random() - 0.5) * radiusX * 2,
      y: (ratio - 0.5) * radiusY * 2,
    }),
  }
  const point = shapeHandlers[cluster.shape.type]()
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  return {
    x: centerX + point.x * cos - point.y * sin,
    y: centerY + point.x * sin + point.y * cos,
  }
}

export class GlyphSceneEngine {
  private animationId = 0
  private canvas: HTMLCanvasElement
  private context: CanvasRenderingContext2D
  private height = 1
  private lastTime = performance.now()
  private particles: GlyphParticle[] = []
  private scene: GlyphSceneConfig
  private signals = defaultSignals
  private width = 1

  constructor(canvas: HTMLCanvasElement, initialScene: GlyphSceneConfig) {
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Canvas 2D context is unavailable.')
    }

    this.canvas = canvas
    this.context = context
    this.scene = initialScene
    this.resize()
    this.retarget(initialScene, true)
  }

  start() {
    if (this.animationId) return

    this.lastTime = performance.now()
    this.animationId = window.requestAnimationFrame(this.tick)
  }

  stop() {
    if (!this.animationId) return

    window.cancelAnimationFrame(this.animationId)
    this.animationId = 0
  }

  resize = () => {
    const rect = this.canvas.getBoundingClientRect()
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)

    this.width = Math.max(1, rect.width)
    this.height = Math.max(1, rect.height)
    this.canvas.width = Math.round(this.width * pixelRatio)
    this.canvas.height = Math.round(this.height * pixelRatio)
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    this.assignHomes(this.scene)
  }

  retarget(scene: GlyphSceneConfig, immediate = false) {
    this.scene = scene
    this.ensureParticles(scene)
    this.assignHomes(scene)

    if (immediate) {
      for (const particle of this.particles) {
        particle.x = particle.homeX
        particle.y = particle.homeY
        particle.vx = 0
        particle.vy = 0
        particle.rotation = 0
      }
    }
  }

  updateSpeechSignals(signals: SpeechSignals) {
    this.signals = signals
  }

  private ensureParticles(scene: GlyphSceneConfig) {
    const random = seededRandom(hashText(scene.id))
    const clusters = sceneClusters(scene)
    const glyphMapGlyphs = glyphMapPoints(scene, this.width, this.height).map((point) => point.char)
    const desiredParticleCount = Math.min(
      maxParticleCount,
      Math.max(baseParticleCount, glyphMapGlyphs.length),
    )
    const glyphs = [
      ...glyphMapGlyphs,
      ...clusters.flatMap((cluster) => cluster.glyphs),
    ].filter(Boolean)

    while (this.particles.length < desiredParticleCount) {
      const index = this.particles.length
      const char = glyphs[index % glyphs.length] || '•'
      const x = random() * this.width
      const y = random() * this.height

      this.particles.push({
        id: `glyph-${index}`,
        char,
        color: scene.palette.primary,
        homeX: x,
        homeY: y,
        x,
        y,
        vx: 0,
        vy: 0,
        rotation: random() * Math.PI,
        angularVelocity: (random() - 0.5) * 0.4,
        scale: 0.7 + random() * 1.2,
        baseScale: 1,
        opacity: 0.2 + random() * 0.5,
        baseOpacity: 0.4,
        depth: random(),
        energy: random(),
      })
    }

    for (let index = 0; index < this.particles.length; index += 1) {
      this.particles[index].char = glyphs[index % glyphs.length] || this.particles[index].char
    }
  }

  private assignHomes(scene: GlyphSceneConfig) {
    const random = seededRandom(hashText(`${scene.id}:${scene.sourcePhrase}`))
    const mapPoints = glyphMapPoints(scene, this.width, this.height)
    const clusters = sceneClusters(scene)
    const totalWeight = clusters.reduce((sum, cluster) => sum + Math.max(0.01, cluster.weight), 0)

    for (let index = 0; index < this.particles.length; index += 1) {
      const particle = this.particles[index]
      const jitterX = (random() - 0.5) * this.width * 0.08
      const jitterY = (random() - 0.5) * this.height * 0.08
      const normalizedIndex = index / Math.max(1, this.particles.length - 1)

      if (mapPoints.length) {
        const point = mapPoints[index % mapPoints.length]

        particle.char = point.char
        particle.color = point.color
        particle.homeX = point.x + jitterX * 0.04
        particle.homeY = point.y + jitterY * 0.04
        particle.baseScale = (scene.glyphMap?.scale || 1) * (0.9 + random() * 0.2)
        particle.baseOpacity = 0.58
        continue
      }

      let cursor = (normalizedIndex * totalWeight) % totalWeight
      const cluster =
        clusters.find((item) => {
          cursor -= Math.max(0.01, item.weight)
          return cursor <= 0
        }) || clusters[0]
      const clusterGlyphs = cluster.glyphs.filter(Boolean)
      const point = clusterPoint(cluster, normalizedIndex, random, this.width, this.height)

      particle.char = clusterGlyphs[index % Math.max(1, clusterGlyphs.length)] || particle.char
      particle.color = cluster.color
      particle.homeX = point.x + jitterX * 0.12
      particle.homeY = point.y + jitterY * 0.12
      particle.baseScale = cluster.scale * (0.8 + random() * 0.4)
      particle.baseOpacity = cluster.opacity
    }
  }

  private tick = (time: number) => {
    const dt = Math.min(0.034, Math.max(0.001, (time - this.lastTime) / 1000))

    this.lastTime = time
    this.update(dt, time / 1000)
    this.render(time / 1000)
    this.animationId = window.requestAnimationFrame(this.tick)
  }

  private update(dt: number, elapsed: number) {
    const speechEnergy =
      this.signals.volume * 0.45 + this.signals.emphasis * 0.35 + this.signals.topicShift * 0.5
    const damping = this.scene.reducedMotion ? 0.86 : 0.92

    for (const particle of this.particles) {
      const spring = this.scene.reducedMotion ? 2.6 : 4.6 + speechEnergy * 2

      particle.vx += (particle.homeX - particle.x) * spring * dt
      particle.vy += (particle.homeY - particle.y) * spring * dt

      for (const field of this.scene.forceFields) {
        this.applyForceField(particle, field, dt, elapsed)
      }

      particle.vx *= damping
      particle.vy *= damping
      particle.x += particle.vx
      particle.y += particle.vy
      particle.rotation += particle.angularVelocity * dt + this.signals.pace * 0.012
      particle.opacity = clamp(particle.baseOpacity + particle.depth * 0.28 + speechEnergy * 0.18, 0.16, 0.92)
      particle.scale = clamp(particle.baseScale + particle.depth * 0.28 + speechEnergy * 0.16, 0.6, 1.8)
    }
  }

  private applyForceField(
    particle: GlyphParticle,
    field: GlyphForceField,
    dt: number,
    elapsed: number,
  ) {
    const strength = field.strength * (1 + this.signals.volume * 1.8)
    const position = fieldPosition(field, this.width, this.height)
    const dx = particle.x - position.x
    const dy = particle.y - position.y
    const distance = Math.max(1, Math.hypot(dx, dy))
    const radius = field.radius * Math.max(this.width, this.height)
    const falloff = clamp(1 - distance / radius, 0, 1)

    if (field.type === 'wind' || field.type === 'flow') {
      particle.vx += (field.direction?.x ?? 1) * strength * 22 * dt
      particle.vy += (field.direction?.y ?? 0) * strength * 22 * dt
      return
    }

    if (field.type === 'noise') {
      particle.vx += Math.sin(elapsed * 1.7 + particle.energy * 12) * strength * 18 * dt
      particle.vy += Math.cos(elapsed * 1.3 + particle.depth * 10) * strength * 18 * dt
      return
    }

    if (!falloff) return

    if (field.type === 'vortex') {
      particle.vx += (-dy / distance) * strength * falloff * 120 * dt
      particle.vy += (dx / distance) * strength * falloff * 120 * dt
    } else if (field.type === 'attract') {
      particle.vx += (-dx / distance) * strength * falloff * 110 * dt
      particle.vy += (-dy / distance) * strength * falloff * 110 * dt
    } else if (field.type === 'repel' || field.type === 'speechPulse') {
      const pulse = field.type === 'speechPulse' ? 1 + this.signals.emphasis * 2.4 : 1
      particle.vx += (dx / distance) * strength * falloff * pulse * 120 * dt
      particle.vy += (dy / distance) * strength * falloff * pulse * 120 * dt
    }
  }

  private render(elapsed: number) {
    const { context } = this

    context.clearRect(0, 0, this.width, this.height)
    context.save()
    context.globalCompositeOperation = 'source-over'

    this.drawCreatureHints(elapsed)
    this.drawGlyphMap()

    for (const particle of this.particles) {
      context.save()
      context.translate(particle.x, particle.y)
      context.rotate(particle.rotation)
      context.globalAlpha = glyphMapRows(this.scene).length ? particle.opacity * 0.18 : particle.opacity
      context.fillStyle = particle.color
      context.font = `${Math.round(14 * particle.scale)}px ui-monospace, SFMono-Regular, Menlo, monospace`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(particle.char, 0, 0)
      context.restore()
    }

    context.restore()
  }

  private drawGlyphMap() {
    const layout = glyphMapLayout(this.scene, this.width, this.height)

    if (!layout) return

    const { context } = this

    context.save()
    context.globalAlpha = 0.94
    context.font = `${Math.round(layout.cellSize * 1.18)}px ui-monospace, SFMono-Regular, Menlo, monospace`
    context.textAlign = 'left'
    context.textBaseline = 'top'

    layout.rows.forEach((row, rowIndex) => {
      let columnIndex = 0

      for (const char of [...row]) {
        if (char.trim()) {
          context.fillStyle = /[|/\\_\-.,'`╱╲═─│┌┐└┘]/.test(char)
            ? this.scene.glyphMap?.accent || this.scene.palette.accent
            : this.scene.glyphMap?.color || this.scene.palette.primary
          context.fillText(
            char,
            layout.startX + columnIndex * layout.cellSize,
            layout.startY + rowIndex * layout.cellSize,
          )
        }

        columnIndex += 1
      }
    })

    context.restore()
  }

  private drawCreatureHints(elapsed: number) {
    const { context } = this
    const centerX = this.width * 0.5
    const centerY = this.height * 0.56
    const pulse = 1 + this.signals.volume * 0.16 + Math.sin(elapsed * 2) * 0.025

    context.save()
    context.globalAlpha = 0.11
    context.strokeStyle = this.scene.palette.accent
    context.lineWidth = 2

    context.beginPath()
    context.ellipse(centerX, centerY, this.width * 0.28 * pulse, this.height * 0.18 * pulse, 0, 0, Math.PI * 2)
    context.stroke()

    context.restore()
  }
}

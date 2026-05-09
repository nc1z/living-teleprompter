# Living Teleprompter: Fluid Glyph Creatures Implementation Guide

## Goal

Pivot the living teleprompter from slow runtime image generation to fast, dynamic glyph animation.

The target experience is **not static ASCII art**. The target is:

> fluid creatures, objects, weather, forests, symbols, and emotional effects made from animated glyph particles.

The system should feel like a living typographic world where speech drives motion.

---

## Current Problem

The current POC uses Codex Exec to generate images dynamically.

That is too slow for a real-time teleprompter because image generation creates:
- high latency
- inconsistent frame pacing
- expensive runtime work
- unpredictable visual continuity
- frequent scene replacement instead of smooth evolution

This architecture is not suitable for a speech-driven interface.

---

## New Direction

Use AI to generate:
- glyph vocabularies
- creature systems
- animation rules
- force-field definitions
- TypeScript code
- scene presets
- choreography logic

Do **not** use AI to render every frame.

Runtime should be:
- deterministic
- local
- fast
- canvas/WebGL based
- driven by speech events

---

## Key Learning

The best Pretext demos are not traditional ASCII art.

They are closer to:

> procedural motion graphics where glyphs are particles.

A static dragon drawn with text looks bad because it is just terminal art.

A fluid Pretext dragon works because:
- thousands of glyphs move together
- glyph density forms mass
- motion reveals anatomy
- negative space defines shape
- spring physics gives life
- opacity and scale create depth
- the creature persists over time

The visible form emerges from motion, density, and behavior.

---

## Reference Patterns

### Pretext Playground

The `0xNyk/pretext-playground` project describes itself as an interactive ASCII dragon built on `@chenglou/pretext`.

Important implementation details from that project:
- every character on screen is a physics body
- the dragon glides through Pretext-measured multilingual text
- letters spring back to their Pretext-computed home positions
- `prepare()` measures once, then `layout()` is pure arithmetic
- `prepareWithSegments` and `layoutWithLines` create positioned lines
- each character receives a home position from Pretext
- the dragon is a 60-segment ASCII chain
- letters have velocity, rotation, spring-home force, and collision response
- Canvas 2D handles rendering
- the render loop uses `requestAnimationFrame`
- text is measured once at init and on resize
- there are no DOM reads in the hot path

Reference:
https://github.com/0xNyk/pretext-playground

### Awesome Pretext

The `awesome-pretext` repo shows that the ecosystem is forming around:
- dragon through text
- illustrated manuscript
- Bad Apple ASCII
- fluid smoke ASCII
- singularity / black-hole text
- drag-sprite reflow
- interactive media art
- kinetic typography
- text-over-video placement

This confirms the pivot:
Pretext is not just a text measurement helper. It is becoming a layout substrate for real-time typographic simulations.

Reference:
https://github.com/bluedusk/awesome-pretext

---

## Core Architecture

```txt
Speech stream
    ↓
Transcript / semantic parser
    ↓
Pretext layout
    ↓
Persistent glyph particles
    ↓
Physics + force fields
    ↓
Canvas/WebGL renderer
```

The most important rule:

> Do not regenerate the scene. Preserve identity over time.

When text changes:
- recompute target glyph positions
- keep existing particles alive
- retarget particles to new homes
- animate with spring physics

When emotional state changes:
- adjust force fields
- adjust density
- adjust turbulence
- adjust creature behavior
- adjust color, glow, scale, opacity

---

## Runtime Mental Model

Each glyph has two positions:

```txt
home position = where Pretext says this glyph belongs
live position = where physics currently renders it
```

The renderer draws the live position.

The physics system constantly pulls each glyph back toward its home position.

External forces can disturb glyphs:
- dragon body
- umbrella obstacle
- black hole
- speech emphasis pulse
- pause ripple
- topic transition vortex
- confidence trail
- rain or smoke field

---

## Particle Model

```ts
export type GlyphParticle = {
  id: string
  char: string

  homeX: number
  homeY: number

  x: number
  y: number

  vx: number
  vy: number

  ax: number
  ay: number

  rotation: number
  angularVelocity: number

  scale: number
  opacity: number
  depth: number

  energy: number
  heat: number
  mood: "calm" | "focused" | "intense" | "playful" | "dramatic"

  clusterId?: string
  semanticRole?: "word" | "punctuation" | "creature" | "particle" | "effect"
}
```

---

## Core Update Loop

```ts
function tick(dt: number) {
  updateSpeechSignals()
  updateCreatureControllers(dt)
  updateForceFields(dt)

  for (const p of glyphParticles) {
    applySpringToHome(p)
    applyDamping(p)
    applySpeechForces(p)
    applyCreatureCollisions(p)
    applyFlowFields(p)
    integrateParticle(p, dt)
  }

  renderCanvas()
  requestAnimationFrame(tick)
}
```

Avoid React state inside the frame loop.

Use:
- refs
- typed arrays if needed
- mutable objects
- object pools
- spatial hashing for collisions

---

## Pretext Integration

Use Pretext to get glyph homes.

Pseudo-code:

```ts
import { prepareWithSegments, layoutWithLines } from "@chenglou/pretext"

const prepared = prepareWithSegments(text, font)
const layout = layoutWithLines(prepared, width, lineHeight)

const homes = flattenLinesToGlyphHomes(layout)
```

On resize:
- run layout again
- update each particle's `homeX` and `homeY`
- do not reset `x`, `y`, `vx`, `vy`

On transcript update:
- diff old text to new text
- reuse particles for matching glyphs where possible
- create particles only for new glyphs
- retire removed glyphs with fade-out animation

---

## Text Diffing Strategy

For a teleprompter, text changes continuously.

Avoid clearing all particles.

Use one of these strategies:

### Simple Strategy

Good for POC.

```ts
for each new glyph index:
  if old particle exists at same index:
    reuse it
  else:
    create new particle near previous word or cursor
```

### Better Strategy

Use word-level diff:
- preserve particles for unchanged words
- retarget moved words
- spawn particles for inserted words
- fade removed words into dust or smoke

### Best Strategy

Use semantic IDs:
- each word/token gets stable ID
- speech engine emits token updates
- particles map to token IDs
- glyphs persist across edits and corrections

---

## Creature System

Creatures should not be generated as static ASCII blocks.

A creature is a controller that owns glyph clusters and force fields.

```ts
export type GlyphCreature = {
  id: string
  type: "dragon" | "bird" | "fish" | "forestSpirit" | "umbrella" | "smoke"

  glyphs: CreatureGlyphPalette
  segments: CreatureSegment[]

  position: Vec2
  velocity: Vec2

  mood: string
  energy: number

  update(dt: number, speech: SpeechSignals): void
  applyForces(particles: GlyphParticle[]): void
  render(ctx: CanvasRenderingContext2D): void
}
```

---

## Dragon Implementation

The dragon should be a chain of segments.

```ts
type DragonSegment = {
  x: number
  y: number
  angle: number
  radius: number
  glyph: string
  phase: number
}
```

Behavior:
- head follows a target
- target may be cursor, speech cursor, or semantic focus point
- body segments follow previous segments with lag
- wings are offset from selected body segments
- spine glyphs shimmer along the chain
- fire particles emit from head direction
- nearby transcript glyphs receive repulsion force

Glyph palette:

```ts
export const dragonGlyphs = {
  head: ["◉", "◆", "◇", "◈"],
  body: ["█", "▓", "▒", "░", "◆", "◇"],
  spine: ["╬", "║", "│", "╱", "╲"],
  wing: ["╱", "╲", "ᐱ", "ᐯ", "⌁"],
  fire: ["✦", "✧", "❋", "✺", "*"],
  ember: ["·", "˚", "˙", "✧"]
}
```

The dragon should read as a dragon through:
- head shape
- eyes
- wing motion
- segmented serpentine body
- fire particles
- scale-like density
- coherent movement

Not through a static outline.

---

## Umbrella / Obstacle Reflow

Umbrella-style demos are not about ASCII umbrellas.

They are about text dynamically reflowing around a moving shape.

The object can be simple:
- SVG umbrella
- glyph umbrella
- canvas path
- sprite

The important part is the obstacle-aware layout.

```ts
type Obstacle = {
  id: string
  x: number
  y: number
  shape: "circle" | "polygon" | "umbrella" | "custom"
  bounds: Rect[]
  velocity: Vec2
}
```

Pipeline:

```txt
moving obstacle
    ↓
layout text around obstacle
    ↓
update glyph homes
    ↓
particles spring toward new homes
```

Result:
- text appears to flow around the umbrella
- glyphs do not pop
- the scene feels alive

---

## Forest / Environment System

A forest should be generated procedurally from glyph particles, not drawn as a static ASCII block.

Tree definition:

```ts
export const forestGlyphs = {
  trunk: ["│", "║", "┃"],
  branch: ["╱", "╲", "╭", "╮", "╰", "╯"],
  leaf: ["▓", "▒", "░", "◆", "◇", "✦", "·"],
  pollen: ["˚", "˙", "✧", "✦"]
}
```

Generate trees as particle clusters:
- trunk particles form vertical density
- canopy particles form blobs using noise
- branches use curved paths
- wind field sways leaves
- speech volume increases pollen movement
- topic shifts ripple across tree line

---

## Force Fields

Force fields are the main abstraction.

```ts
export type ForceField = {
  id: string
  type: "repel" | "attract" | "vortex" | "wind" | "noise" | "flow" | "speechPulse"
  strength: number
  radius: number
  position?: Vec2
  direction?: Vec2
  apply(p: GlyphParticle, dt: number): void
}
```

Examples:
- dragon body: moving repulsion fields
- black hole: attract + rotate
- speech emphasis: radial burst
- pause: damping increase
- topic shift: horizontal wave
- confidence: forward flow
- uncertainty: jitter/noise
- dramatic beat: slow-motion expansion

---

## Speech Signal Mapping

The teleprompter already has rich input.

Create a normalized signal object:

```ts
export type SpeechSignals = {
  volume: number
  pace: number
  pitch: number
  pauseDurationMs: number
  emphasis: number
  confidence: number
  topicShift: number
  sentiment: "neutral" | "positive" | "tense" | "playful" | "serious"
  currentWordIndex: number
}
```

Map signals to animation:

```ts
const speechToAnimation = {
  volume: "particle energy",
  pace: "creature speed",
  pitch: "vertical drift",
  pauseDurationMs: "damping and orbit",
  emphasis: "repulsion pulse",
  confidence: "trail length",
  topicShift: "vortex transition",
}
```

---

## AI Role

AI should generate scene systems, not frames.

Good AI outputs:
- TypeScript glyph palettes
- force-field presets
- creature controllers
- animation rules
- theme packs
- mood mappings
- prompt-to-scene configs

Bad AI outputs:
- generated images every moment
- static ASCII blocks
- one-off drawings
- frame-by-frame assets

---

## Dynamic Scene File Pattern

There can be one file that Codex Exec updates when needed.

Suggested file:

```txt
src/generated/liveScene.generated.ts
```

This file exports a deterministic scene config.

Example:

```ts
export const liveScene = {
  version: 1,
  theme: "illuminated-dragon",
  palettes: {
    dragon: {
      body: ["█", "▓", "▒", "░", "◆", "◇"],
      fire: ["✦", "✧", "❋", "✺", "*"],
      smoke: ["·", "˚", "˙"]
    }
  },
  creatures: [
    {
      type: "dragon",
      segments: 80,
      followMode: "speechCursor",
      repulsionRadius: 42,
      spring: 0.08,
      damping: 0.87
    }
  ],
  forceFields: [
    {
      type: "speechPulse",
      strength: 1.2,
      radius: 180,
      trigger: "emphasis"
    }
  ]
}
```

The renderer imports this config.

Codex can update the file when the requested scene changes:
- dragon
- forest
- umbrella
- smoke
- swarm
- black hole
- manuscript
- ocean
- storm

But the runtime engine remains stable.

---

## Agent / Skill Design

Create a `SKILL.md` for generating fluid glyph systems.

Suggested skill:

```md
# Fluid Glyph Creature Skill

## Purpose
Generate reusable TypeScript scene configs for a Pretext-powered living teleprompter.

## Output
Return a single TypeScript module exporting:
- glyph palettes
- creature definitions
- force-field definitions
- speech mappings
- rendering parameters

## Do Not
- generate static ASCII art
- generate images
- generate frame-by-frame assets
- reset particle identity every update

## Always
- use persistent particles
- define home positions and live positions
- include spring physics
- include damping
- include speech-reactive mappings
- include reduced-motion fallback
- include performance notes

## Scene Types
- dragon
- umbrella reflow
- forest
- smoke
- bird flock
- fish swarm
- black hole
- manuscript illumination
- rain
- fireflies
- ocean waves

## Output Format
TypeScript only.
```

---

## Renderer Responsibilities

The renderer should:
- load the generated scene config
- build creature controllers
- build force fields
- update Pretext glyph homes
- run physics loop
- draw to canvas/WebGL
- preserve accessibility DOM text
- respect reduced-motion settings

The renderer should not:
- call AI every frame
- replace all particles on text updates
- rely on DOM measurements
- use React state for per-frame values

---

## React Integration

React owns:
- component lifecycle
- props
- transcript state
- control panel
- canvas mount
- generated scene import

The animation engine owns:
- particles
- creatures
- force fields
- frame loop
- rendering

Suggested component:

```tsx
<LivingTeleprompter
  transcript={transcript}
  speechSignals={speechSignals}
  scene={liveScene}
  font="20px Inter"
  lineHeight={30}
/>
```

Internally:
- use `ResizeObserver`
- use `useRef` for engine state
- initialize engine on mount
- update transcript and speech signals imperatively
- do not re-render React every frame

---

## Performance Rules

Must:
- use `requestAnimationFrame`
- use Canvas 2D first
- move to WebGL if particle count gets high
- reuse arrays and objects
- use spatial hashing for collisions
- avoid layout reads in the hot path
- measure text only on init, resize, and transcript changes
- keep AI outside the frame loop

Target:
- 60fps baseline
- 120fps aspirational
- 500-2,000 glyph particles for POC
- 5,000-20,000 glyph particles with WebGL

---

## Accessibility

Because canvas text is not accessible by default:

Always include:
- hidden semantic DOM text
- reduced-motion mode
- pause animation button
- contrast-safe mode
- fallback plain teleprompter view

Reduced motion behavior:
- disable creature motion
- disable particle turbulence
- use normal DOM text
- optionally keep subtle highlight only

---

## Codex Prompt Template

Use this when asking Codex to implement a new creature or effect:

```txt
We are building a Pretext-powered living teleprompter.

Do not generate static ASCII art.
Do not generate images.
Do not regenerate the scene every frame.

Generate a TypeScript scene config and any necessary controller code for a fluid glyph creature.

The system uses:
- Pretext for glyph home positions
- persistent glyph particles
- Canvas/WebGL rendering
- spring physics
- force fields
- speech signals

Create:
1. glyph palette
2. creature controller
3. force fields
4. speech-to-animation mapping
5. performance-safe update loop
6. reduced-motion fallback

The creature should emerge through motion, density, and behavior, not through a static text block.
```

---

## Codex Task: Recreate Fluid Creatures

Ask Codex to build this in phases.

### Phase 1: Engine
- `GlyphParticle`
- `ForceField`
- `CreatureController`
- `PretextLayoutAdapter`
- `CanvasGlyphRenderer`
- `AnimationLoop`

### Phase 2: Text
- transcript updates
- diffing
- stable particle IDs
- fade-in / fade-out particles
- resize relayout

### Phase 3: Creatures
- dragon chain
- umbrella obstacle
- forest clusters
- smoke field
- flock/swarm

### Phase 4: Speech
- speech signals
- emphasis pulses
- pause damping
- topic vortices
- pace-based speed
- confidence trails

### Phase 5: Polish
- glow
- depth
- opacity
- trails
- blur
- color palettes
- reduced-motion fallback
- debug panel

---

## Final Principle

We are not generating pictures.

We are generating living glyph systems.

The AI creates the rules.

The runtime animates the world.

The glyphs persist.

The speech drives the forces.

The creature emerges.

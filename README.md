# Living Teleprompter

An unplanned demo machine. The presenter speaks, the audience sees a living page.

## What It Does

The presenter opens a single page and starts speaking. Their words stream into a focused teleprompter display. While they speak, the system generates the next paragraph of script for the presenter to read. As the script is generated, background jobs pre-generate visuals — animated glyph creatures, dynamic scenes, and emphasis effects — timed to appear as the presenter reaches the relevant words.

The audience sees a page that stays visually alive. The presenter always has something to say next.

## Background

### The POC

A proof-of-concept was built and tested to validate the core product bet before committing to a full implementation. The POC is not committed to this repository. It was a plain JavaScript spike, intentionally rough, used only to prove feasibility and surface real-world constraints.

The POC proved the idea works. The core loop — speech in, transcript on screen, generated next script visible to the presenter, animated glyph scene reacting to speech — is viable. The details below came directly from running it.

### How GPT Realtime-2 Works in This Context

The app uses the OpenAI Realtime API as the live voice-to-action runtime. It is not used for image generation or as a build tool — it sits in the live speech path.

The browser captures microphone audio with `getUserMedia` and opens a WebRTC connection to the Realtime API. Audio flows over the WebRTC media channel. JSON control events and model responses flow over the WebRTC data channel. The browser never holds the raw API key — a small backend endpoint handles Realtime session creation and mints ephemeral client tokens.

The model receives a continuous audio stream and emits:
- partial transcription deltas as the speaker talks
- finalized transcript phrases when speech stabilizes
- structured next-script responses triggered by the app
- display extraction responses — a phrase, an emphasized word, a color — used to update the audience-facing display
- visual cue outputs used to start background scene generation

A ChatGPT subscription is not sufficient. The app requires an OpenAI API key with Realtime access, handled server-side.

### How Dynamic Realtime Voice-to-Action Works

The Realtime API makes it possible to send the audio stream once and get multiple response types back over the same session. The app uses this to separate concerns:

- **Transcription** updates the teleprompter immediately as the speaker talks. Partials appear in a small footer only. The big audience display does not chase raw deltas — they are too unstable.
- **Display extraction** runs a quick model call to pick the best phrase and emphasis word from recent speech, returning structured JSON like `{ "display": "demo living teleprompter", "emphasis": ["teleprompter"], "color": "green" }`. The audience display updates from this, not from raw transcription.
- **Script generation** runs separately and only when triggered — either by the presenter clicking "Generate next" or when speech reaches the last two words of the current generated script. The generated next paragraph appears in the presenter overlay, not the audience display.
- **Scene config generation** produces compact TypeScript configs for the glyph animation engine — palettes, creature definitions, force fields, speech mappings — based on the generated script.

The key insight is that each response type has different latency requirements and triggers. Running them as separate concerns over one session keeps the live speech path fast while allowing slower generation to happen in the background.

### How Dynamic Script Generation Works

Script generation is triggered conservatively, not on every finalized phrase. Generating on every chunk produces unstable, fragmented output that the presenter cannot trust.

Generation triggers when:
- the presenter explicitly clicks `Generate next` or `Done reading`, or
- speech matches the last two words of the current generated script (loose match, not word-for-word)

When speech matches the end of the current script, the presenter sees a brief green confirmation on the script panel before the next paragraph begins generating.

Each generation call includes rich context:
- a presentation brief the presenter enters before starting ("What are you presenting today?")
- recent speaker transcript
- previously generated scripts that were accepted or read
- chronological recent conversation

The brief is hidden once the session starts so it does not clutter the live display. Without the brief, generated scripts drift quickly off-topic.

Generated scripts must remain stable once visible. Rewriting text under the presenter breaks trust and loses their place.

### Script Nuances and Regeneration Cues

Several situations trigger regeneration rather than advancing to a queued next paragraph:

- **Topic divergence**: if the presenter ignores the generated script and speaks about something else, the system should detect the drift and regenerate from the latest spoken context
- **Manual skip**: the presenter can skip the current generated paragraph and request a new one from controls
- **Manual regenerate**: the presenter can explicitly regenerate if the queued script is wrong

Speech matching uses normalized text and word-overlap heuristics. Exact word-for-word matching fails too often due to transcription noise, filler words, and natural variation in how people read. Semantic matching or model-based reasoning is reserved for a later iteration.

All generated text is English-only. Transcription artifacts can occasionally produce non-English tokens, especially at phrase boundaries. The system rejects non-English display or script output and falls back to a local English extraction.

### The Visual Generation Pivot

The original concept used GPT image generation to produce visuals during the presentation. The POC tested this path.

**Image generation latency was 111,901ms end to end.** That is nearly two minutes. Visuals arrived long after the speaker had moved past the relevant moment. Image generation as a live runtime dependency does not work.

The pivot: use AI to generate the *rules* for a visual scene, not the frames themselves. The runtime is a local canvas glyph animation engine — persistent particles, spring physics, force fields, and creature controllers — that runs at 60fps without any AI in the frame loop.

The Realtime API generates compact scene configs (TypeScript) describing the mood, creature type, glyph palette, and force-field parameters. The engine loads the config and animates continuously. The scene evolves with speech signals — volume, pace, pause duration, emphasis, topic shift — without any generation call during playback.

This produces motion in milliseconds, not minutes.

### Feasibility Verdict

The core idea is feasible:

- Live speech to teleprompter transcript: proven, low latency
- Generated next-paragraph script: proven, 1-3 seconds to first useful text
- Stable audience display driven by display extraction: proven, clean and readable
- Glyph animation engine reacting to speech: viable, prototype-ready
- Image generation as live visual: not viable at current latency — replaced by the glyph engine approach

The main remaining risk is the glyph animation engine itself. The POC did not include a full PretextJS-backed particle system. That is the next thing to build and validate.

## Architecture

```
Speech (WebRTC mic)
    ↓
OpenAI Realtime API
    ↓  ↓  ↓
    │  │  └── Display extraction → audience display
    │  └───── Script generation → presenter overlay
    └──────── Transcription → teleprompter footer

Scene config
    ↓
Canvas glyph engine (PretextJS + spring physics + force fields)
    ↓
Audience display layer
```

- **React** owns application state and UI composition: mic controls, connection status, setup prompt, script queue, presenter controls, debug panels.
- **Canvas engine** owns the animation loop: `requestAnimationFrame`, particles, velocities, glyph homes, force fields, retargeting, resize handling, drawing.
- **Realtime API** owns live intelligence: transcription, script generation, display extraction, scene config generation.

React does not store per-frame particle state. The canvas engine does not call AI.

## Running Locally

Requirements: Node.js, an OpenAI API key with Realtime access, a small backend endpoint for ephemeral token minting.

```
npm install
npm run dev
```

Set `OPENAI_API_KEY` in your environment. The backend endpoint must not expose the key to the browser.

## Status

POC complete. Full implementation in progress per `PLAN.md`.

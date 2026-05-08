# Living Teleprompter Implementation Plan

## References

- `PRD.md`: Product requirements, phase definitions, data model, rendering strategy, latency targets, and MVP scope.
- `IDEA.md`: Original product concept and desired live demo loop.
- `REPORT.md`: PretextJS text layout and physics reference.
- `REPORT-2.md`: HTML-in-Canvas and fluid animation reference.

## Planning Principles

- Build the text loop first. The product is only useful if the presenter can speak or type and immediately see readable, focused words.
- Keep Phase 1 DOM-first. PretextJS, canvas physics, and HTML-in-Canvas are later rendering layers, not MVP blockers.
- Keep the presenter and audience surfaces separable. The MVP can use one shared page, but generated script and controls should live in an overlay that can later become a private presenter view.
- Optimize the LLM path for speed. Use one streaming generation call that returns paragraph text first and lightweight visual cues in the same response.
- Start visual generation as early as possible once a usable paragraph or cue exists.

## Phase 0: Minimal Project Bootstrap

### Objective

Create only the minimum foundation needed to start Phase 1. Avoid empty architecture folders and define types when the first feature uses them.

### Subtasks

- [ ] Initialize a React + Vite + TypeScript app.
- [ ] Add baseline scripts for `dev`, `build`, `preview`, and linting if practical.
- [ ] Create folders only as features need them.
- [ ] Define the first typed models inside the feature code that consumes them.
- [ ] Add deterministic demo fixtures for local development:
  - [ ] 2-3 typed input sentences.
  - [ ] 1-2 mock generated paragraphs.
  - [ ] 1 mock visual cue tied to a phrase in a generated paragraph.
- [ ] Add basic README instructions for running the app locally.

### Outputs

- Running local web app shell.
- Minimal fixture data for the first teleprompter demo.
- Initial development scripts and folder structure.

### Validation

- [ ] App starts locally.
- [ ] TypeScript compiles.
- [ ] Demo fixture data can be imported without API keys.

## Phase 1: Streaming Teleprompter Page

### Objective

Build the single-page, no-scroll teleprompter experience with streamed text, greyed-out history, focused active words, and a hideable presenter overlay.

### 1. Page Shell and Layout

- [ ] Create a full-viewport route or app shell.
- [ ] Disable document scrolling.
- [ ] Use a white background.
- [ ] Reserve the main canvas of the page for large teleprompter words only.
- [ ] Add responsive typography suitable for presentation distance.
- [ ] Keep the active phrase horizontally centered and in a stable vertical reading band near the middle of the viewport.
- [ ] Ensure text never overflows incoherently on desktop or mobile.

### 2. Stream State

- [ ] Implement stream chunk state with `id`, `text`, `timestamp`, `source`, and `status`.
- [ ] Support `typed`, `speech`, and `generated` as source values even if only `typed` is active in Phase 1.
- [ ] Track partial and final chunks.
- [ ] Maintain a simple in-memory array of finalized chunks as the Phase 1 context source.
- [ ] Add helpers to finalize a sentence and append it to context.

### 3. Manual Input Harness

- [ ] Add a local-only manual input mode for typing a sentence.
- [ ] Add a deterministic demo stream that emits words or tokens over time.
- [ ] Support starting, pausing, resuming, and clearing the demo stream.
- [ ] Keep input controls outside the main audience text area, preferably in the presenter overlay.

### 4. Teleprompter Renderer

- [ ] Render streamed words as regular DOM text.
- [ ] Grey out previous spoken words with reduced opacity.
- [ ] Render the current word or phrase in bold dark text.
- [ ] Keep the active phrase visually dominant within the reading band defined in the page layout.
- [ ] Limit visible history so the page remains uncluttered.
- [ ] Avoid layout shifts as new words arrive.
- [ ] Add reduced-motion-safe transitions.

### 5. Presenter Overlay

- [ ] Add a subtle overlay or panel for presenter-only information.
- [ ] Show queued generated script separately from the main teleprompter words.
- [ ] Add controls:
  - [ ] Pause/resume live streaming.
  - [ ] Skip current generated paragraph.
  - [ ] Regenerate next paragraph.
  - [ ] Accept/advance the current generated paragraph in typed MVP mode.
  - [ ] Clear session.
  - [ ] Toggle overlay visibility.
- [ ] Add a feature/debug flag for showing generation delay state.
- [ ] When the debug flag is enabled, show a bouncing `...` while generation is pending.

### Outputs

- A usable no-scroll teleprompter page.
- Manual streaming demo.
- Presenter overlay with basic controls.

### Validation

- [ ] A typed or demo sentence streams progressively into the page.
- [ ] Previous words are grey and less prominent.
- [ ] Active text is bold, dark, and easy to identify.
- [ ] The page does not scroll.
- [ ] The presenter overlay can be hidden without disrupting the main display.
- [ ] App runs without voice, LLM, or image generation services.

## MVP Slice: Phase 1 + Narrow Phase 3

### Objective

Prove the core loop: typed context enters the teleprompter, a generated paragraph appears for the presenter, and the visible teleprompter never stalls.

### Subtasks

- [ ] Add a mock LLM provider that returns a plausible next paragraph and visual cue objects.
- [ ] Use the Phase 1 finalized chunk array as the MVP context source.
- [ ] Trigger paragraph generation when a sentence finalizes.
- [ ] Stream generated paragraph text into the presenter overlay first.
- [ ] Allow generated text to be injected into the main teleprompter stream for demos.
- [ ] Use the accept/advance control to mark a generated paragraph as presenter-approved in typed MVP mode.
- [ ] Track generation states: `pending`, `generating`, `ready`, `failed`.
- [ ] Add one automatic retry on provider failure.
- [ ] Keep current spoken or typed text streaming if generation fails.

### Outputs

- MVP demo loop using typed input and mock generation.
- Basic generated script queue.
- Failure behavior that does not stall the teleprompter.

### Validation

- [ ] Given one typed sentence, a next paragraph appears.
- [ ] Generated text is visually separate from the audience-facing current words.
- [ ] Mock failure path retries once and then allows manual regenerate.
- [ ] No background process blocks text streaming.

## Phase 2: Visual Generation Scripts

### Objective

Create a scriptable asset generation path that accepts structured visual cue prompts and produces browser-loadable assets plus metadata.

### 1. Asset Interface

- [ ] Define a `VisualCue` input contract based on `PRD.md`.
- [ ] Define an `AssetJob` output contract with job ID, cue ID, status, asset path, error message, and timestamps.
- [ ] Define supported asset types:
  - [ ] `svg`
  - [ ] `image`
  - [ ] `canvas-effect`
  - [ ] `pretext-effect`
- [ ] Store generated asset metadata in a predictable format such as JSON.

### 2. Local Generator Prototype

- [ ] Create a script that accepts a prompt and cue metadata.
- [ ] Generate a simple SVG or placeholder image without requiring external services.
- [ ] Write outputs to a predictable generated asset directory.
- [ ] Return job metadata that the frontend can consume.
- [ ] Add deterministic sample cues for development.

### 3. Future Codex Exec Integration Point

Do not build a Codex exec wrapper until there is a concrete command or image generation tool to wrap. For now, keep Codex exec as a documented future integration point behind the same asset job contract used by the local generator.

### 4. Frontend Asset Loading

- [ ] Add an asset registry or asset job store.
- [ ] Poll or subscribe to asset job status.
- [ ] Load ready SVG/image assets from the local output path.
- [ ] Render at least one generated asset in a simple visual layer.
- [ ] Add fallback display when an asset fails or is unavailable.

### 5. PretextJS Preparation

- [ ] Install and evaluate PretextJS in an isolated demo component.
- [ ] Build a small text measurement spike using a fixed paragraph.
- [ ] Map measured glyphs to home positions.
- [ ] Prototype simple letter displacement and return-to-home physics.
- [ ] Keep this outside the Phase 1 core renderer until the effect is stable.
- [ ] Document the spike output so the Rendering Enhancements track can reuse the measured glyph model and physics parameters.

### Outputs

- Scriptable visual generation interface.
- Local asset output directory with metadata.
- Frontend can load and render at least one generated asset.
- PretextJS spike for later generated visual/text interactions.

### Validation

- [ ] Running a script with a prompt creates a usable asset.
- [ ] Generated metadata includes source phrase and intended timing.
- [ ] Phase 3 can call the asset interface with a visual cue object.
- [ ] Asset generation can fail without breaking the app.

## Phase 3: LLM Script Generation and Asset Preloading

### Objective

Connect live context to a real or mock provider that generates the next paragraph and structured visual cues, then starts visual asset jobs in the background.

### 1. Context Manager Extension

- [ ] Extend the Phase 1 finalized chunk array rather than creating a second context store.
- [ ] Keep the current finalized sentence.
- [ ] Keep the last 3-5 finalized sentences.
- [ ] Support an optional cached session summary only when it already exists.
- [ ] Avoid summarization on the critical path.
- [ ] Expose a compact context payload for provider calls.

### 2. Provider Abstraction

- [ ] Define a provider interface for streaming generated paragraph text.
- [ ] Support mock provider first.
- [ ] Add real LLM provider behind environment configuration.
- [ ] Keep provider details out of UI components.
- [ ] Support cancellation or stale-response protection if the presenter clears or skips.

### 3. Streaming LLM Response Shape

- [ ] Request paragraph text first.
- [ ] Include lightweight structured visual cues in the same response.
- [ ] Avoid a second blocking parser call.
- [ ] Validate visual cues before creating asset jobs.
- [ ] Use phrase match + paragraph index + optional word index for `targetTiming`.

### 4. Latency and Failure Behavior

- [ ] Start generation as soon as a sentence finalizes.
- [ ] Target first generated text within 1-2 seconds under normal conditions.
- [ ] Target a usable paragraph within 3-5 seconds under normal conditions.
- [ ] Retry once automatically on failure.
- [ ] Use the Phase 1 debug flag for any visible generation delay state.
- [ ] Keep teleprompter streaming current text during provider delay or failure.
- [ ] Let presenter manually regenerate from controls.

### 5. Asset Preloading Handoff

- [ ] Convert validated visual cues into Phase 2 asset jobs.
- [ ] Start visual generation as soon as a usable cue exists.
- [ ] Do not wait for the full paragraph if cues are available earlier.
- [ ] Track asset states independently from paragraph generation.
- [ ] Associate assets with generated paragraph IDs and target phrases.

### 6. Script Queue

- [ ] Add a generated paragraph queue.
- [ ] Show the next paragraph in the presenter overlay.
- [ ] Support skip and regenerate.
- [ ] In typed MVP mode, allow generated paragraphs to become context through the explicit accept/advance control.
- [ ] In voice mode, allow generated paragraphs to become context through speech matching after the presenter reads them.
- [ ] Prevent stale generated paragraphs from overwriting newer presenter intent.

### Outputs

- Real or mock LLM generation loop.
- Generated paragraph queue.
- Structured cue extraction from the same provider response.
- Background asset preloading.

### Validation

- [ ] One finalized sentence produces a generated paragraph.
- [ ] The paragraph appears before the presenter needs it in normal conditions.
- [ ] At least one asset job starts from the generated paragraph.
- [ ] LLM failure does not stall the visible teleprompter.
- [ ] Asset generation is asynchronous and non-blocking.

## Phase 4: Voice-to-Action Integration

### Objective

Make speech the primary entrypoint and combine text streaming, LLM generation, generated script queueing, and visual asset rendering into one live presentation loop.

### 1. Speech Capture

- [ ] Add microphone permission flow.
- [ ] Capture live audio.
- [ ] Stream speech-to-text partials into the teleprompter.
- [ ] Finalize recognized sentences into stream chunks.
- [ ] Preserve typed input as a fallback and test harness.

### 2. Voice-to-Context Loop

- [ ] Send finalized speech sentences to the context manager.
- [ ] Trigger LLM generation from finalized speech.
- [ ] Keep partial speech rendering immediate and independent from LLM state.
- [ ] Handle speech recognition interruptions without clearing context.

### 3. Generated Script Delivery

- [ ] Queue generated next paragraph for presenter reading.
- [ ] Keep generated script out of the main audience text until spoken or explicitly injected.
- [ ] Support presenter skip/regenerate during live speech.
- [ ] Add stale-response protection for old LLM outputs.

### 4. Visual Timing

- [ ] Match spoken or queued generated phrases against visual cue `targetTiming`.
- [ ] Trigger ready assets when the target phrase or word index is reached.
- [ ] If assets are not ready in time, either skip or show a simple fallback.
- [ ] Start visual jobs early when paragraph text or cue data becomes usable.
- [ ] Use paragraph pacing or light pauses in generated text to create generation lead time.

### 5. Failure and Recovery

- [ ] If speech recognition fails, keep typed input available.
- [ ] If LLM generation fails, continue displaying live speech and allow regenerate.
- [ ] If visual generation fails, continue text rendering and mark asset failed.
- [ ] If microphone permission is denied, show the manual input harness.

### Outputs

- Speech-first demo loop.
- Live partial speech on the teleprompter.
- Generated presenter script.
- Background visual generation and timed rendering.

### Validation

- [ ] Presenter can begin by speaking without typing.
- [ ] Spoken text appears in near real time.
- [ ] A next paragraph is generated from spoken context.
- [ ] Visual generation begins before the relevant generated sentence is spoken.
- [ ] The audience-facing page continues updating if speech, LLM, or one asset job fails.

## Rendering Enhancements Track

### Objective

Layer richer generated visual/text interactions onto the stable DOM teleprompter without compromising readability.

### Subtasks

- [ ] Add a canvas visual layer above or below DOM text.
- [ ] Reuse the PretextJS spike from Phase 2 when implementing per-letter home positions and physics effects.
- [ ] Implement rendering capability detection:
  - [ ] Canvas support.
  - [ ] PretextJS availability.
  - [ ] HTML-in-Canvas support.
  - [ ] OffscreenCanvas support.
  - [ ] Device pixel ratio.
- [ ] Select rendering mode at runtime:
  - [ ] `dom`
  - [ ] `dom-plus-canvas`
  - [ ] `pretext-canvas`
  - [ ] `html-in-canvas`
- [ ] Add reduced-motion handling for all animated effects.
- [ ] Prototype generated motifs beyond dragon examples, such as diagrams, forests, abstract motion elements, or product visuals.
- [ ] Use PretextJS for effects requiring per-letter home positions.
- [ ] Keep HTML-in-Canvas behind feature detection and experimental flags.
- [ ] Synchronize canvas CSS size, backing size, and device pixel ratio.

### Validation

- [ ] Baseline DOM mode works everywhere.
- [ ] Canvas layer can be disabled without breaking text.
- [ ] Advanced effects do not reduce text readability.
- [ ] Experimental HTML-in-Canvas mode degrades cleanly when unsupported.

## Presenter and Audience View Split

### Objective

Evolve the MVP shared page into separate presenter and audience rendering targets.

This can happen in parallel with the Rendering Enhancements track after the MVP is stable. It does not depend on PretextJS, canvas effects, or HTML-in-Canvas.

### Subtasks

- [ ] Extract shared presentation state from view components.
- [ ] Define audience view as polished text and visuals only.
- [ ] Define presenter view as live text, generated script, status, and controls.
- [ ] Move the MVP presenter overlay into the presenter view.
- [ ] Add a simple route or session mode switch for presenter vs audience.
- [ ] Decide how state sync works between views.
- [ ] Keep shared-view mode available for local demos.

### Validation

- [ ] Presenter controls are not visible in the audience view.
- [ ] Audience view continues rendering active text and visuals.
- [ ] Presenter view can skip, regenerate, pause, and clear without UI confusion.

## Persistence Note

Start with in-memory session state. Revisit browser storage, local files, or a lightweight database only after the MVP loop feels useful. Any persistence choice must not add latency to the streaming path.

## Suggested Build Order

1. Phase 0 project setup.
2. Phase 1 DOM teleprompter and manual stream.
3. MVP slice with mock LLM generation.
4. Phase 3 provider abstraction and real LLM option.
5. Phase 2 local visual generation interface.
6. Phase 3 asset preloading handoff.
7. Phase 4 speech input.
8. Rendering enhancements with canvas, PretextJS, and optional HTML-in-Canvas.
9. Separate presenter and audience views. This can run in parallel with rendering enhancements once MVP state boundaries are clear.
10. Persistence beyond in-memory state, only after MVP usage shows what needs to be retained.

## First Milestone

The first useful milestone is:

- Full-screen white teleprompter page.
- Manual sentence streaming.
- Grey previous words and bold active words.
- Hideable presenter overlay.
- Mock generated next paragraph.
- Debug-only bouncing `...` state.
- No dependency on voice, image generation, PretextJS, or HTML-in-Canvas.

This milestone proves the core reading and generation loop before investing in advanced visuals.

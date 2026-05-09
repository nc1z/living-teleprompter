# Living Teleprompter Implementation Plan

## References

- `PRD.md`: Product requirements, phase definitions, data model, rendering strategy, latency targets, and MVP scope.
- `IDEA.md`: Original product concept and desired live demo loop.
- `REPORT.md`: PretextJS text layout and physics reference.
- `REPORT-2.md`: HTML-in-Canvas and fluid animation reference.

## Planning Principles

- Prove the real LLM latency path early. The product fails if real speech-to-script generation cannot produce useful text fast enough.
- Build the text loop around the real-time path. The presenter must be able to speak and immediately see readable, focused words while the LLM plans ahead.
- Use OpenAI Realtime API or the realtime Agents SDK for live voice-to-action runtime. Codex is for building the app and prototyping local asset scripts, not for the live speech loop.
- Keep Phase 1 DOM-first. PretextJS, canvas physics, and HTML-in-Canvas are later rendering layers, not MVP blockers.
- Keep the presenter and audience surfaces separable. The MVP can use one shared page, but generated script and controls should live in an overlay that can later become a private presenter view.
- Optimize the LLM path for speed. Use one streaming generation call that returns paragraph text first and lightweight visual cues in the same response.
- Start visual generation as early as possible once a usable paragraph or cue exists.
- Keep deterministic fixtures for development and visual testing only. They are not a substitute for the real LLM feasibility test.

## POC Learnings To Preserve

These lessons came from testing the `poc/` Realtime spike and should override older assumptions in this plan.

### Realtime and Auth

- A ChatGPT subscription is not a runtime credential for this app. The local app needs OpenAI API access and an API key handled by a backend endpoint.
- Codex can build and edit the app, but Codex is not the live Realtime runtime.
- Browser audio should use WebRTC by default. WebSockets are only for server-side audio pipelines or lower-level server-to-server experiments.
- The browser must not receive the standard OpenAI API key. Use a small backend endpoint for Realtime session creation or ephemeral client token minting.

### Script Generation

- The generated next script must be stable once visible. Rewriting it under the presenter breaks trust.
- Generation should not trigger on every finalized speech chunk.
- Generation is allowed only when:
  - the presenter explicitly clicks `Generate next` / `Done reading`, or
  - speech matches the last two words of the current generated script.
- When speech matches the last two words, the presenter needs visible confirmation. The POC uses a brief green state on the generated script panel.
- If the presenter ignores the first generated sentence or changes topic, the app should detect divergence from the generated script and regenerate from the latest spoken context.
- Speech matching should be loose, not word-for-word. Use normalized text and semantic/word-overlap heuristics first; improve with model reasoning later.

### Context Quality

- The model needs a global presentation brief before the session starts: “What are you presenting?”
- That brief becomes global context for all generated scripts.
- Each generation must include broader conversation context, not only the latest sentence:
  - presentation brief
  - recent speaker transcript
  - generated scripts that were accepted/read
  - chronological recent conversation
- The brief input is a setup control. Hide it after the mic/Realtime session starts so it does not clutter the live display.
- Generated script must be English-only. The app should guard against transcription artifacts causing non-English display/script output.

### Audience Display

- The big audience-facing display should not render raw partial transcript deltas. It shifts too much and is hard to read.
- Keep partial Realtime transcript in a small footer or debug line only.
- The big display should persist the last rendered phrase/headline until the next finalized display replaces it. It should not flash back to “listening.”
- Grey trailing transcript text looked bad in practice. Prefer a clean white page with a single stable display.
- The big display should feel like a slide deck, not a transcript. It should show a headline, short phrase, or powerful keyword.
- The app should use quick model reasoning to decide the slide-like display text and which word deserves emphasis.
- Emphasis should not default to the first word. The emphasized word should usually be the concept, object, product, verb, or surprising idea.
- Render display output as a coherent phrase, e.g. `keep talking naturally`, with one word emphasized, not as stacked broken words like `can / keep / talking / naturally / while`.
- Display extraction should return structured data such as:

```json
{
  "display": "demo living teleprompter",
  "emphasis": ["teleprompter"],
  "color": "green"
}
```

- Display text must be English-only. If model output appears non-English, reject it and fall back to a local English display extraction.

### Debug UI

- The spike UI should keep the main display clean and use icon controls for mic/start/stop.
- The generated next script panel must be large enough to read. It should not be squeezed by debug panels.
- Token/cost tracking is useful during the spike, but the UI only needs:
  - API total tokens
  - actual-ish cost
  - fallback estimate
- Timing and raw event panels are useful for development but should be hidden by default once the basic spike works.

### Frontend Runtime Architecture

- The productized frontend should use React for the app shell, not for the animation loop.
- React owns application state and UI composition: setup prompt, microphone controls, Realtime connection status, generated script queue, stable audience display, debug/cost panels, and future presenter/audience separation.
- The canvas glyph engine owns the hot path: `requestAnimationFrame`, particles, velocities, glyph homes, force fields, retargeting, resize handling, and drawing.
- Realtime API owns live intelligence events: transcription, next-script generation, display extraction, voice-to-action events, and compact glyph scene config generation.
- React should pass stable config and signal changes into the engine through refs/effects. Do not keep per-frame particle state in React.
- Keep this boundary explicit:
  - React = application state + UI composition.
  - Canvas engine = realtime animation runtime.
  - Realtime API = speech, transcript, script, and scene intelligence.
- The current plain JavaScript POC is fine for the spike. The production version should migrate the app shell to React while keeping the canvas engine framework-agnostic.
- A likely component boundary is `<GlyphStage sceneConfig={sceneConfig} speechSignals={speechSignals} />`, where the component creates the engine once and calls imperative methods like `engine.retarget(sceneConfig)` and `engine.updateSpeechSignals(speechSignals)`.

## Voice-to-Action Runtime Architecture

The live product should use API runtime, not Codex runtime.

Codex can help implement the project and may be used to prototype local asset-generation scripts. It should not sit in the real-time speech path. The speech loop needs a low-latency runtime based on OpenAI Realtime API or the realtime Agents SDK.

### Preferred Browser Path

Use WebRTC for browser microphone audio:

1. The browser asks a small backend endpoint for a Realtime session or ephemeral client token.
2. The backend uses the real OpenAI API key and never exposes it to the browser.
3. The browser captures microphone audio with `getUserMedia`.
4. The browser opens a WebRTC connection to the Realtime API.
5. Audio flows over WebRTC.
6. JSON control events flow over the WebRTC data channel.
7. Transcription deltas update the teleprompter immediately.
8. Stable phrases or finalized sentences update context immediately.
9. Text-only script planning responses are triggered only when the script queue is empty.
10. Tool/function calls or structured visual cues start background visual jobs for the queued script.

WebSockets are not the preferred browser path. Use WebSockets only if the audio pipeline moves server-side or if a server-to-server Realtime integration becomes necessary. In a WebSocket setup, the app must manually send encoded audio chunks and handle lower-level audio/event plumbing.

### Realtime Session Behavior

- Use realtime transcription or a realtime voice model to receive partial transcript deltas while the presenter speaks.
- Keep voice activity detection enabled for turn/phrase detection, but avoid automatic public model responses.
- Manually trigger script-planning responses only when the script queue can accept a new item.
- Prefer text-only planning responses for generated presenter script.
- Use out-of-band responses or custom response context for planning so generated script does not pollute the live conversation state unnecessarily.
- Use low-latency model settings for script generation, favoring first useful text over deep reasoning.
- Treat generated presenter script as immutable once visible. New speech can update context, but it must not replace the current next script while it is generating, ready, or being read.

### Voice-to-Action Tools

Voice-to-action means the model can request application actions through tool/function calls or equivalent structured outputs. Initial app actions should be:

- `queue_next_paragraph`: add generated presenter text to the script queue.
- `create_visual_cues`: return phrase-linked visual cue objects.
- `start_asset_generation`: start a background SVG/image/canvas asset job.
- `set_scene_mood`: update visual styling or motion direction.
- `trigger_visual_at_phrase`: bind a ready asset or effect to a phrase match, paragraph index, and optional word index.

The app executes these actions locally or through its backend. The model proposes the action and arguments; the application remains responsible for actually mutating state, starting jobs, and rendering visuals.

## Spike Mode: Fast Proof Before Product Phases

Before treating the phase plan as implementation order, run one focused spike. This spike is allowed to be fast, messy, and disposable. The goal is not clean architecture, reusable components, polished UI, or long-term maintainability. The goal is to prove or disprove the core technical loop quickly.

### Spike Objective

Prove that the live demo concept can work with real services:

1. OpenAI Realtime API can receive browser microphone input and return useful live transcription/planning events.
2. WebRTC can stream speech smoothly enough for large text to appear while the presenter is still talking.
3. Real image or visual asset generation can start from received context early enough to be useful during the generated paragraph.

### Spike Rules

- [ ] Prefer speed over code cleanliness.
- [ ] Hardcode prompts, sample topics, and UI labels if needed.
- [ ] Use one page with debug panels if that is fastest.
- [ ] Log timings aggressively in the browser console and on screen.
- [ ] Skip polished styling except for making text readable.
- [ ] Skip full presenter/audience separation.
- [ ] Skip durable persistence.
- [ ] Skip PretextJS and HTML-in-Canvas unless they are needed for a specific visual proof.
- [ ] Keep secrets out of browser code even during the spike.
- [ ] Keep enough notes to turn learnings into the real plan afterward.
- [ ] Do not continuously replace the generated next script while the presenter is speaking. A bad spike that rewrites the next script under the presenter does not prove the intended product experience.

### Spike Workstream 1: Realtime API POC

- [ ] Add a minimal backend endpoint that creates a Realtime session or ephemeral client token.
- [ ] Connect the browser to OpenAI Realtime using WebRTC.
- [ ] Capture microphone input with `getUserMedia`.
- [ ] Receive and display transcription deltas.
- [ ] Detect stable phrases or finalized sentences.
- [ ] Manually trigger a text-only planning response only when no generated script is currently queued.
- [ ] Show the generated next paragraph in a crude presenter preview and freeze it once visible.
- [ ] Add a rough manual `Done reading` or `Generate next` control before attempting automatic speech matching.
- [ ] Disable or avoid automatic public model speech responses unless needed for debugging.

### Spike Workstream 2: WebRTC Text Performance

- [ ] Keep partial transcript in a small footer/debug line rather than the big audience display.
- [ ] Render finalized speech as a stable slide-like headline, short phrase, or powerful keyword in the big display.
- [ ] Persist the last big display until the next finalized display replaces it.
- [ ] Avoid grey trailing text in the audience display.
- [ ] Use quick model reasoning or structured extraction to decide which word deserves emphasis.
- [ ] Highlight only the chosen important word or phrase, not the entire display.
- [ ] Measure perceived delay between speaking and seeing text.
- [ ] Log transcript delta arrival timestamps.
- [ ] Log final sentence or stable phrase timestamps.
- [ ] Test with at least three short spoken prompts.
- [ ] Record whether the text feels usable for a live presentation.

### Spike Workstream 3: Image Generation From Context

- [ ] From a stable phrase or generated paragraph, create one visual prompt.
- [ ] Start an image/SVG/visual asset generation job immediately.
- [ ] Measure time from context availability to job start.
- [ ] Measure time from job start to usable asset.
- [ ] Render the first ready asset on the same page.
- [ ] Test whether simpler assets such as SVG/canvas placeholders are fast enough to bridge the gap while full image generation runs.
- [ ] Record whether full image generation is fast enough for live timing or must be treated as delayed/background enhancement.

### Spike Acceptance Criteria

- [ ] Browser speech reaches the Realtime API through WebRTC.
- [ ] Partial spoken words appear in a small live transcript footer/debug line while speaking.
- [ ] The big audience display shows stable slide-like display text after finalized speech.
- [ ] The big audience display persists the last rendered display until replaced.
- [ ] The emphasized display word is chosen by meaning, not simply by position.
- [ ] Display and script output are English-only.
- [ ] A real generated next paragraph appears from spoken context.
- [ ] The generated next paragraph does not re-generate or replace itself while it is visible.
- [ ] The spike has a manual way to mark the generated script done before generating the next one.
- [ ] The first generated text arrives fast enough to avoid an awkward pause in at least some normal test runs.
- [ ] A visual generation job starts from live or generated context.
- [ ] At least one generated or placeholder visual appears on screen.
- [ ] Timing data is captured for speech-to-text, speech-to-script, and context-to-visual.

### Spike Decision

After the spike, decide one of:

- **Proceed:** latency is good enough to build the product plan.
- **Proceed with UX adjustment:** text works, but the generated script or visuals need fallback behavior, pacing, or delayed reveal.
- **Stop or rethink:** real LLM or visual latency is too slow for the core live presentation concept.

## Phase 0: Minimal Project Bootstrap

### Objective

Create only the minimum foundation needed to run a real Realtime/LLM feasibility spike. Avoid empty architecture folders and define types when the first feature uses them.

### Subtasks

- [ ] Initialize a React + Vite + TypeScript app.
- [ ] Add baseline scripts for `dev`, `build`, `preview`, and linting if practical.
- [ ] Create folders only as features need them.
- [ ] Define the first typed models inside the feature code that consumes them.
- [ ] Add environment configuration for real OpenAI Realtime/LLM credentials without committing secrets.
- [ ] Add a minimal backend endpoint for creating a Realtime session or ephemeral client token.
- [ ] Add deterministic demo fixtures for local development:
  - [ ] 2-3 typed input sentences.
  - [ ] 1-2 mock generated paragraphs.
  - [ ] 1 mock visual cue tied to a phrase in a generated paragraph.
- [ ] Add basic README instructions for running the app locally.

### Outputs

- Running local web app shell.
- Minimal fixture data for the first teleprompter demo.
- Environment configuration ready for real provider testing.
- Minimal backend path for browser-safe Realtime authentication.
- Initial development scripts and folder structure.

### Validation

- [ ] App starts locally.
- [ ] TypeScript compiles.
- [ ] Demo fixture data can be imported without API keys.
- [ ] Real provider credentials can be configured locally without being checked into source control.
- [ ] Browser code does not require a standard OpenAI API key.

## Phase 0.5: Realtime LLM Feasibility Spike

### Objective

Prove the core technical bet before polishing the UI: live speech must become visible text immediately, and a real LLM must generate usable future script fast enough to avoid awkward pauses.

### Subtasks

- [ ] Connect microphone input to OpenAI Realtime transcription or an equivalent real streaming speech-to-text path.
- [ ] Use WebRTC for browser microphone audio unless the spike proves a server-side WebSocket path is necessary.
- [ ] Use the WebRTC data channel for Realtime control events and transcript/planning events.
- [ ] Render transcription deltas as they arrive in a minimal debug view.
- [ ] Detect stable phrases or finalized sentences from the transcription stream.
- [ ] Send a compact context payload to a real LLM/script planner as soon as a stable phrase or sentence is available.
- [ ] Use low-latency settings for the script planner, favoring first useful text over deep reasoning.
- [ ] Keep automatic public model responses off; manually trigger text-only planning responses.
- [ ] Stream generated next-paragraph text into a simple presenter preview area.
- [ ] Include lightweight structured visual cues in the same generation response when possible, but do not block on them.
- [ ] Log timing metrics:
  - [ ] speech partial received
  - [ ] sentence or phrase finalized
  - [ ] LLM request started
  - [ ] first generated text received
  - [ ] usable paragraph received
  - [ ] visual cue received
- [ ] Add cancellation or stale-response handling when a newer sentence supersedes an older generation.
- [ ] Keep deterministic fixtures available only as a fallback for UI work, not as the feasibility proof.

### Outputs

- Working microphone-to-transcript stream.
- Real LLM-generated next paragraph from spoken context.
- Timing logs that show whether the idea is viable.
- Minimal debug UI for live speech, generated script, and latency measurements.

### Validation

- [ ] Spoken words appear as text while the presenter is still speaking.
- [ ] First generated script text appears within 1-2 seconds after a stable phrase or sentence finalizes under normal conditions.
- [ ] A usable generated paragraph appears within 3-5 seconds under normal conditions.
- [ ] If generation is late or fails, transcription continues streaming.
- [ ] The spike uses a real provider, not a mock, for the pass/fail decision.

## Phase 1: Streaming Teleprompter Page

### Objective

Turn the successful Realtime feasibility spike into the single-page, no-scroll teleprompter experience with stable slide-like audience text, a live transcript footer, and a hideable presenter overlay.

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
- [ ] Keep manual input as a development fallback; real speech remains the product-critical path.

### 4. Teleprompter Renderer

- [ ] Render the audience-facing display as regular DOM text.
- [ ] Do not render raw partial transcript in the big display.
- [ ] Keep partial Realtime transcript in a small low-emphasis footer/debug line.
- [ ] Convert finalized speech into a stable slide-like headline, short phrase, or powerful keyword.
- [ ] Persist the last rendered big display until the next finalized display replaces it.
- [ ] Use model-assisted display extraction to choose the display phrase and emphasized word.
- [ ] Highlight only selected important words, not the full display text.
- [ ] Ensure display extraction output is English-only.
- [ ] Avoid grey trailing text; keep the main display clean and uncluttered.
- [ ] Avoid layout shifts as partial transcript arrives.
- [ ] Add reduced-motion-safe transitions.

### 5. Presenter Overlay

- [ ] Add a subtle overlay or panel for presenter-only information.
- [ ] Show queued generated script separately from the main teleprompter words.
- [ ] Make the generated next script panel large enough to read comfortably during live testing.
- [ ] Add controls:
  - [ ] Pause/resume live streaming.
  - [ ] Skip current generated paragraph.
  - [ ] Regenerate next paragraph.
  - [ ] Done reading / generate next.
  - [ ] Accept/advance the current generated paragraph in typed MVP mode.
  - [ ] Clear session.
  - [ ] Toggle overlay visibility.
- [ ] Use compact icon controls for start/stop microphone where possible.
- [ ] Add a feature/debug flag for showing generation delay state.
- [ ] When the debug flag is enabled, show a bouncing `...` while generation is pending.

### Outputs

- A usable no-scroll teleprompter page.
- Real transcription streaming display with manual streaming fallback.
- Presenter overlay with basic controls.

### Validation

- [ ] A typed or demo sentence streams progressively into the page.
- [ ] Partial transcript stays out of the big display.
- [ ] Finalized speech becomes stable slide-like display text.
- [ ] Important words can be emphasized individually.
- [ ] The main display does not use grey trailing transcript text.
- [ ] The page does not scroll.
- [ ] The presenter overlay can be hidden without disrupting the main display.
- [ ] App can still run in fixture mode for UI development without voice, LLM, or image generation services.

## MVP Slice: Real Speech + Real LLM + Phase 1 UI

### Objective

Prove the core product loop with real services: spoken context enters the teleprompter, a real LLM generates future script, and the visible teleprompter never stalls.

### Subtasks

- [ ] Keep a fixture provider for local UI testing only.
- [ ] Use the Phase 1 finalized chunk array as the MVP context source.
- [ ] Trigger real paragraph generation when a stable phrase or sentence finalizes and the script queue is empty.
- [ ] Stream generated paragraph text into the presenter overlay first, then freeze that text as the current next script.
- [ ] Allow generated text to be injected into the main teleprompter stream for demos.
- [ ] Use the accept/advance control to mark a generated paragraph as presenter-approved in typed MVP mode.
- [ ] Use the done-reading/generate-next control to clear the current script and allow the next generation.
- [ ] Track generation states: `pending`, `generating`, `ready`, `failed`.
- [ ] Add one automatic retry on provider failure.
- [ ] Keep current spoken or typed text streaming if generation fails.

### Outputs

- MVP demo loop using real speech input and real LLM generation.
- Basic generated script queue.
- Failure behavior that does not stall the teleprompter.

### Validation

- [ ] Given one spoken sentence, a real generated next paragraph appears.
- [ ] The generated next paragraph remains stable while visible.
- [ ] Generated text is visually separate from the audience-facing current words.
- [ ] Provider failure path retries once and then allows manual regenerate.
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

Harden the real provider path from the MVP: generate the next paragraph and structured visual cues from live context, then start visual asset jobs in the background.

### 1. Context Manager Extension

- [ ] Capture a global presentation brief before the session starts.
- [ ] Include the global presentation brief in every script and display-generation request.
- [ ] Extend the Phase 1 finalized chunk array rather than creating a second context store.
- [ ] Keep the current finalized sentence.
- [ ] Keep the last 3-5 finalized sentences.
- [ ] Track generated scripts that were accepted/read.
- [ ] Maintain a chronological recent-conversation window with speaker turns and accepted generated scripts.
- [ ] Support an optional cached session summary only when it already exists.
- [ ] Avoid summarization on the critical path.
- [ ] Expose a compact context payload for provider calls.

### 2. Provider Abstraction

- [ ] Define a provider interface for streaming generated paragraph text.
- [ ] Keep the real provider as the primary implementation.
- [ ] Keep fixture/mock provider only for local UI development and test determinism.
- [ ] Keep provider details out of UI components.
- [ ] Support cancellation or stale-response protection if the presenter clears or skips.

### 3. Streaming LLM Response Shape

- [ ] Request paragraph text first.
- [ ] Enforce English-only generated script output.
- [ ] Include lightweight structured visual cues in the same response.
- [ ] Avoid a second blocking parser call.
- [ ] Validate visual cues before creating asset jobs.
- [ ] Use phrase match + paragraph index + optional word index for `targetTiming`.

### 4. Latency and Failure Behavior

- [ ] Start generation as soon as a sentence finalizes only if the script queue is empty.
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

- [ ] Add a generated paragraph queue with explicit states:
  - [ ] `idle`: no queued script; finalized context may trigger generation.
  - [ ] `generating`: a script is in flight; ignore new generation triggers.
  - [ ] `ready`: script is visible and immutable; ignore new generation triggers.
  - [ ] `reading`: presenter appears to be reading or has started reading; ignore new generation triggers.
  - [ ] `consumed`: script is done; append/mark context and return to `idle`.
- [ ] Show the next paragraph in the presenter overlay.
- [ ] Freeze generated paragraph text once visible; never replace it because new speech arrived.
- [ ] Allow the next generation only from an explicit `Generate next` / `Done reading` action or a successful last-two-words speech match.
- [ ] When speech matches the last two words, show a visible success state such as a brief green highlight.
- [ ] If the presenter diverges from or ignores the generated script, treat that as skip/topic-change intent and regenerate from the latest spoken context.
- [ ] Support explicit skip and regenerate.
- [ ] Add a manual done-reading/generate-next control before relying on automatic speech matching.
- [ ] In typed MVP mode, allow generated paragraphs to become context through the explicit accept/advance or done-reading control.
- [ ] In voice mode, eventually allow generated paragraphs to become context through speech matching after the presenter reads them.
- [ ] Treat sophisticated speech matching as an enhancement, but require simple last-two-words matching for the POC/MVP handoff.
- [ ] Prevent stale generated paragraphs from overwriting newer presenter intent.

### Outputs

- Real LLM generation loop with fixture fallback for development.
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

Productionize the Realtime speech path proven in Phase 0.5 and combine text streaming, LLM generation, generated script queueing, and visual asset rendering into one live presentation loop.

### 1. Speech Capture

- [ ] Harden the microphone permission flow from the feasibility spike.
- [ ] Capture live audio reliably across supported browsers.
- [ ] Stream speech-to-text partials into the teleprompter using the proven Realtime path.
- [ ] Keep WebRTC as the default browser transport and reserve WebSockets for server-side audio pipelines.
- [ ] Keep the backend responsible for Realtime session creation or ephemeral token minting.
- [ ] Finalize recognized phrases or sentences into stream chunks.
- [ ] Preserve typed input as a fallback and test harness.

### 2. Voice-to-Context Loop

- [ ] Send finalized speech sentences to the context manager.
- [ ] Trigger text-only script planning responses from finalized or stable speech only when the script queue is `idle`.
- [ ] Use out-of-band/custom-context responses where useful so planning output does not pollute the live conversation state.
- [ ] Keep partial speech rendering immediate and independent from LLM state.
- [ ] Use a separate fast display-extraction response to turn finalized speech into an English slide-like display phrase with structured emphasis.
- [ ] Handle speech recognition interruptions without clearing context.

### 3. Generated Script Delivery

- [ ] Queue generated next paragraph for presenter reading.
- [ ] Accept `queue_next_paragraph`-style tool/function calls or equivalent structured outputs.
- [ ] Keep the queued generated script immutable until the presenter skips it, regenerates intentionally, or marks it done.
- [ ] Keep generated script out of the main audience text until spoken or explicitly injected.
- [ ] Support presenter skip/regenerate during live speech as explicit actions only.
- [ ] Support manual done-reading/generate-next before automatic speech matching is trusted.
- [ ] Enforce English-only generated script output.
- [ ] Add stale-response protection for old LLM outputs.

### 4. Visual Timing

- [ ] Accept `create_visual_cues`, `start_asset_generation`, and `trigger_visual_at_phrase`-style tool/function calls or equivalent structured outputs.
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

## Token Usage Tracking (Dev Only)

### Objective

Give developers visibility into token consumption and estimated cost during a session. This is a development tool, not a user-facing feature. All token tracking UI and logging is behind the same debug/feature flag used for generation delay state.

### Cost Model

The app has **audio input** and **text input/output**. There is no audio output — the presenter reads generated text, the system does not speak it.

| Token type | When it applies | Reference price (GPT-Realtime-2) |
|---|---|---|
| Audio input | Phase 4 voice mode only | $32 / 1M tokens ($0.40 cached) |
| Text input | Context payload sent for paragraph generation | Standard text pricing per provider |
| Text output | Generated paragraph + visual cues | Standard text pricing per provider |

Cached input pricing should be leveraged aggressively since the rolling context overlaps heavily between consecutive generation calls.

### Subtasks

- [ ] Add a `DEV_TOKEN_TRACKING` feature flag, gated by the existing debug flag.
- [ ] Prefer actual provider usage fields such as `response.usage` over local estimates whenever available.
- [ ] Show only the essential live-testing fields by default: API total tokens, actual-ish cost, and fallback estimate.
- [ ] Estimate input tokens per generation call from the context payload size.
- [ ] Estimate output tokens per generation call from the generated paragraph and visual cue response size.
- [ ] In Phase 4, estimate audio input tokens from speech duration using the provider's token-per-second ratio.
- [ ] Track cached vs uncached input tokens when the provider reports cache status.
- [ ] Maintain a running session total: input tokens, output tokens, audio tokens, estimated cost.
- [ ] Show the session total in the presenter overlay when the debug flag is enabled.
- [ ] Log per-call token estimates to the browser console in debug mode.
- [ ] Use a simple character-to-token heuristic (e.g., chars / 4) unless the provider returns actual token counts.

### Validation

- [ ] Token tracking UI is invisible when the debug flag is off.
- [ ] Session totals increment with each generation call.
- [ ] Estimated cost updates reflect the correct token type and pricing tier.
- [ ] Token tracking adds no latency to the generation or streaming path.

## Suggested Build Order

0. Spike mode: fast proof of Realtime API, WebRTC text display, and context-to-image latency.
1. Phase 0 minimal project bootstrap.
2. Phase 0.5 Realtime LLM feasibility spike with real speech and real generation, refined from spike learnings.
3. Phase 1 DOM teleprompter using the real transcription stream, with manual fixture fallback.
4. MVP slice with real speech, real LLM generation, presenter overlay, and latency logging.
5. Phase 3 provider hardening, script queue, stale-response handling, and failure recovery.
6. Phase 2 local visual generation interface.
7. Phase 3 asset preloading handoff.
8. Rendering enhancements with canvas, PretextJS, and optional HTML-in-Canvas.
9. Separate presenter and audience views. This can run in parallel with rendering enhancements once MVP state boundaries are clear.
10. Persistence beyond in-memory state, only after MVP usage shows what needs to be retained.

## First Milestone

The first useful milestone is:

- A fast spike proves microphone input can reach OpenAI Realtime through WebRTC.
- Microphone input streams into a small live transcript footer/debug line while the presenter is still speaking.
- The big display shows stable English slide-like display text from finalized speech, not raw partial transcript.
- The big display persists until the next display replaces it.
- Important display words are selected by model reasoning and emphasized individually.
- A real LLM receives stable spoken context and streams a generated next paragraph.
- The generated next paragraph remains stable while visible and does not get replaced by later speech.
- A manual done-reading/generate-next control and last-two-words speech match gate subsequent script generation.
- Diverging from the generated script can intentionally trigger regeneration from the new topic/context.
- A global presentation brief and recent conversation context improve script relevance.
- A visual generation job starts from received context or generated paragraph text.
- Timing logs show speech partials, sentence finalization, LLM start, first generated text, usable paragraph completion, visual job start, and visual readiness.
- Target latency is 1-2 seconds to first generated text and 3-5 seconds to a usable paragraph under normal conditions.
- The text stream continues if generation is late or fails.
- The UI can be minimal: debug transcript, generated script preview, and latency measurements.
- No dependency on polished image integration, PretextJS, or HTML-in-Canvas.

This milestone proves or disproves the core product bet before investing in polished UI, clean architecture, or advanced visuals.

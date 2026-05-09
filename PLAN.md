# Living Teleprompter Implementation Plan

## References

- `PRD.md`: Product requirements, phase definitions, data model, rendering strategy, latency targets, and MVP scope.
- `IDEA.md`: Original product concept and desired live demo loop.
- `REPORT.md`: PretextJS text layout and physics reference.
- `REPORT-2.md`: HTML-in-Canvas and fluid animation reference.

## Planning Principles

- Prove the real LLM latency path early. The product fails if real speech-to-script generation cannot produce useful text fast enough.
- Build the text loop around the real-time path. The presenter must be able to speak and immediately see readable, focused words while the LLM plans ahead.
- Use OpenAI Realtime API or the realtime Agents SDK for live voice-to-action runtime. Codex is for building the app and prototyping offline tooling, not for the live speech loop.
- Keep Phase 1 DOM-first. PretextJS, canvas physics, and HTML-in-Canvas are later rendering layers, not MVP blockers.
- Keep the shared page as the default product surface. The generated next script can stay in the same UI as the visible teleprompter experience; separate presenter/audience views and hiding the script are optional post-MVP enhancements.
- Optimize the LLM path for speed. Use one streaming generation call that returns paragraph text first and lightweight visual cues in the same response.
- Treat glyph scene config generation and local scene retargeting as downstream polish until the real-time text summary, emphasis, script regeneration, and script completion loop is reliable.
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
- React owns application state and UI composition: setup prompt, microphone controls, Realtime connection status, generated script queue, stable audience display, debug/cost panels, and optional future presenter/audience separation.
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

Codex can help implement the project and may be used to prototype local scene-config tooling. It should not sit in the real-time speech path. The speech loop needs a low-latency runtime based on OpenAI Realtime API or the realtime Agents SDK.

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
10. Tool/function calls or structured visual cues start glyph scene config generation or local scene actions for the queued script.

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
- `set_glyph_scene_config`: apply or queue a compact glyph scene config.
- `trigger_force_field`: trigger a speech-timed force field, burst, swirl, rain, forest growth, product reveal, or similar local canvas action.
- `set_scene_mood`: update visual styling or motion direction.
- `trigger_visual_at_phrase`: bind a ready scene action or optional delayed asset to a phrase match, paragraph index, and optional word index.

The app executes these actions locally or through its backend. The model proposes the action and arguments; the application remains responsible for actually mutating state, starting jobs, and rendering visuals.

## Spike Mode: Fast Proof Before Product Phases

Before treating the phase plan as implementation order, run one focused spike. This spike is allowed to be fast, messy, and disposable. The goal is not clean architecture, reusable components, polished UI, or long-term maintainability. The goal is to prove or disprove the core technical loop quickly.

### Spike Objective

Prove that the live demo concept can work with real services:

1. OpenAI Realtime API can receive browser microphone input and return useful live transcription/planning events.
2. WebRTC can stream speech smoothly enough for large text to appear while the presenter is still talking.
3. A real LLM can generate useful next-script text fast enough, keep it stable while visible, and react when the presenter completes or skips it.

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

### Deferred Visual Spike: Glyph Scene Generation From Context

This is not required for the core spike pass/fail decision. Run it only after the real-time text summary, generated script lifecycle, last-two-words completion, and going-off-script regeneration are reliable.

- [ ] From a stable phrase or generated paragraph, create one visual cue or scene intent.
- [ ] Start glyph scene config generation or local scene retargeting immediately.
- [ ] Measure time from context availability to scene request start.
- [ ] Measure time from scene request start to usable glyph scene.
- [ ] Render the first ready glyph scene on the same page.
- [ ] Test whether local fallback scenes are fast enough to cover the live path while optional image/SVG generation trails.
- [ ] Record whether any image generation path is fast enough for live timing or must remain delayed/offline enhancement.

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
- [ ] Last-two-words completion can mark the current script done and allow the next script.
- [ ] Going off script can trigger regeneration from the latest spoken context.
- [ ] Timing data is captured for speech-to-text and speech-to-script.

### Spike Decision

After the spike, decide one of:

- **Proceed:** latency is good enough to build the product plan.
- **Proceed with UX adjustment:** text works, but generated script completion, divergence handling, or pacing needs fallback behavior.
- **Stop or rethink:** real LLM latency or script quality is too weak for the core live presentation concept.

## Phase 0: Minimal Project Bootstrap

### Objective

Create only the minimum foundation needed to run a real Realtime/LLM feasibility spike. Avoid empty architecture folders and define types when the first feature uses them.

### Subtasks

- [x] Initialize a React + Vite + TypeScript app.
- [x] Add baseline scripts for `dev`, `build`, `preview`, and linting if practical.
- [x] Create folders only as features need them.
- [x] Define the first typed models inside the feature code that consumes them.
- [x] Add environment configuration for real OpenAI Realtime/LLM credentials without committing secrets.
- [x] Add a minimal backend endpoint for creating a Realtime session or ephemeral client token.
- [x] Add deterministic demo fixtures for local development:
  - [x] 2-3 typed input sentences.
  - [x] 1-2 mock generated paragraphs.
  - [x] 1 mock visual cue tied to a phrase in a generated paragraph.
- [x] Add basic README instructions for running the app locally.

### Outputs

- Running local web app shell.
- Minimal fixture data for the first teleprompter demo.
- Environment configuration ready for real provider testing.
- Minimal backend path for browser-safe Realtime authentication.
- Initial development scripts and folder structure.

### Validation

- [x] App starts locally.
- [x] TypeScript compiles.
- [x] Demo fixture data can be imported without API keys.
- [x] Real provider credentials can be configured locally without being checked into source control.
- [x] Browser code does not require a standard OpenAI API key.

## Phase 0.5: Realtime LLM Feasibility Spike

### Objective

Prove the core technical bet before polishing the UI: live speech must become visible text immediately, and a real LLM must generate usable future script fast enough to avoid awkward pauses.

### Subtasks

- [x] Connect microphone input to OpenAI Realtime transcription or an equivalent real streaming speech-to-text path.
- [x] Use WebRTC for browser microphone audio unless the spike proves a server-side WebSocket path is necessary.
- [x] Use the WebRTC data channel for Realtime control events and transcript/planning events.
- [x] Render transcription deltas as they arrive in a minimal debug view.
- [x] Detect stable phrases or finalized sentences from the transcription stream.
- [x] Send a compact context payload to a real LLM/script planner as soon as a stable phrase or sentence is available.
- [x] Use low-latency settings for the script planner, favoring first useful text over deep reasoning.
- [x] Keep automatic public model responses off; manually trigger text-only planning responses.
- [x] Stream generated next-paragraph text into a simple presenter preview area.
- [x] Include lightweight structured visual cues in the same generation response when possible, but do not block on them.
- [x] Log timing metrics:
  - [x] speech partial received
  - [x] sentence or phrase finalized
  - [x] LLM request started
  - [x] first generated text received
  - [x] usable paragraph received
  - [x] visual cue received
- [x] Add cancellation or stale-response handling when a newer sentence supersedes an older generation.
- [x] Keep deterministic fixtures available only as a fallback for UI work, not as the feasibility proof.

### Outputs

- Working microphone-to-transcript stream.
- Real LLM-generated next paragraph from spoken context.
- Timing logs that show whether the idea is viable.
- Minimal debug UI for live speech, generated script, and latency measurements.

### Validation

- [x] Spoken words appear as text while the presenter is still speaking.
- [ ] First generated script text appears within 1-2 seconds after a stable phrase or sentence finalizes under normal conditions.
- [ ] A usable generated paragraph appears within 3-5 seconds under normal conditions.
- [x] If generation is late or fails, transcription continues streaming.
- [x] The spike uses a real provider, not a mock, for the pass/fail decision.

Live validation requires running the MVP server with `OPENAI_API_KEY` and testing microphone input in the browser.

## Phase 1: Streaming Teleprompter Page

### Objective

Turn the successful Realtime feasibility spike into the single-page, no-scroll teleprompter experience with stable slide-like audience text, a live transcript footer, and the generated next script in the same shared UI.

### 1. Page Shell and Layout

- [x] Create a full-viewport route or app shell.
- [x] Disable document scrolling.
- [x] Use a white background.
- [x] Reserve the main canvas of the page for large teleprompter words only.
- [x] Add responsive typography suitable for presentation distance.
- [x] Keep the active phrase horizontally centered and in a stable vertical reading band near the middle of the viewport.
- [x] Ensure text never overflows incoherently on desktop or mobile.

### 2. Stream State

- [x] Implement stream chunk state with `id`, `text`, `timestamp`, `source`, and `status`.
- [x] Support `typed`, `speech`, and `generated` as source values even if only `typed` is active in Phase 1.
- [x] Track partial and final chunks.
- [x] Maintain a simple in-memory array of finalized chunks as the Phase 1 context source.
- [x] Add helpers to finalize a sentence and append it to context.

### 3. Manual Input Harness

- [x] Add a local-only manual input mode for typing a sentence.
- [x] Add a deterministic demo stream that emits words or tokens over time.
- [x] Support starting, pausing, resuming, and clearing the demo stream.
- [x] Keep input controls outside the main audience text area in the shared controls panel.
- [x] Keep manual input as a development fallback; real speech remains the product-critical path.

### 4. Teleprompter Renderer

- [x] Render the audience-facing display as regular DOM text.
- [x] Do not render raw partial transcript in the big display.
- [x] Keep partial Realtime transcript in a small low-emphasis footer/debug line.
- [x] Convert finalized speech into a stable slide-like headline, short phrase, or powerful keyword.
- [x] Persist the last rendered big display until the next finalized display replaces it.
- [x] Use model-assisted display extraction to choose the display phrase and emphasized word.
- [x] Highlight only selected important words, not the full display text.
- [x] Ensure display extraction output is English-only.
- [x] Avoid grey trailing text; keep the main display clean and uncluttered.
- [x] Avoid layout shifts as partial transcript arrives.
- [x] Add reduced-motion-safe transitions.

### 5. Shared Script and Controls Panel

- [x] Add a subtle panel for controls and generated script inside the shared UI.
- [x] Show queued generated script in the same UI while keeping it visually distinct from the main teleprompter words.
- [x] Make the generated next script panel large enough to read comfortably during live testing.
- [x] Add controls:
  - [x] Pause/resume live streaming.
  - [x] Skip current generated paragraph.
  - [x] Regenerate next paragraph.
  - [x] Done reading / generate next.
  - [x] Accept/advance the current generated paragraph in typed MVP mode.
  - [x] Clear session.
  - [x] Keep controls available in the shared UI.
- [x] Use compact icon controls for start/stop microphone where possible.
- [x] Add a feature/debug flag for showing generation delay state.
- [x] When the debug flag is enabled, show a bouncing `...` while generation is pending.

### Outputs

- A usable no-scroll teleprompter page.
- Real transcription streaming display with manual streaming fallback.
- Shared controls and generated-script panel.

### Validation

- [x] A typed or demo sentence streams progressively into the page.
- [x] Partial transcript stays out of the big display.
- [x] Finalized speech becomes stable slide-like display text.
- [x] Important words can be emphasized individually.
- [x] The main display does not use grey trailing transcript text.
- [x] The page does not scroll.
- [x] The controls panel can coexist without disrupting the main display.
- [x] App can still run in fixture mode for UI development without voice or LLM services.

## MVP Slice: Real Speech + Real LLM + Phase 1 UI

### Objective

Prove the core product loop with real services: spoken context enters the teleprompter, a real LLM generates future script, and the visible teleprompter never stalls.

### Subtasks

- [x] Keep fixture data for local UI initialization and development only.
- [x] Use the Phase 1 finalized chunk array as the MVP context source.
- [x] Trigger real paragraph generation when a stable phrase or sentence finalizes and no script has been generated yet.
- [x] Stream generated paragraph text into the shared script panel first, then freeze that text as the current next script.
- [x] Allow generated text to be injected into context through explicit accept/done controls.
- [x] Use the accept control to mark a generated paragraph as presenter-approved in MVP mode.
- [x] Use the done-reading/generate-next control to clear the current script and allow the next generation.
- [x] Track generation states: `idle`, `generating`, `ready`, `failed`.
- [x] Keep current spoken text streaming if generation fails.

Automatic retry on provider failure is no longer an MVP gate. It belongs in Phase 3 provider hardening after the Phase 2 text/script lifecycle is reliable.

### Outputs

- MVP demo loop using real speech input and real LLM generation.
- Basic generated script queue.
- Failure behavior that does not stall the teleprompter.

### Validation

- [ ] Given one spoken sentence, a real generated next paragraph appears.
- [ ] The generated next paragraph remains stable while visible.
- [ ] Generated text appears in the same UI but remains visually distinct from the audience-facing current words.
- [x] No background process blocks text streaming.

The remaining MVP validation can happen while starting Phase 2. Do not block Phase 2 on provider retry or visual/glyph work.

## Phase 2: Text and Script Loop Hardening

### Objective

Make the core live product loop reliable before investing in visuals: real-time speech should become stable summarized display text, generated script should remain useful and immutable while visible, going off script should regenerate from the latest context, and saying the last two words should mark the current script complete.

### 1. Realtime Display Summary

- [x] Confirm finalized speech always triggers display extraction in the MVP.
- [x] Keep the local English fallback summary immediate so the big text updates even when the LLM is slow.
- [x] Keep partial transcript in the footer/debug line only.
- [x] Ensure LLM display extraction returns concise English slide-like text.
- [x] Ensure emphasis is selected by meaning, not by word position.
- [x] Reject malformed or non-English display extraction and keep the local fallback.
- [x] Avoid layout shift and broken multi-line fragments in the big display.

### 2. Generated Script Lifecycle

- [x] Keep the current generated script immutable while it is visible.
- [x] Do not regenerate or replace the current script from normal finalized speech.
- [x] Generate only when the script queue is empty, the presenter clicks a control, or the current script is completed.
- [x] Preserve simplified manual controls: `Next`, `Regenerate`, and `Skip`.
- [x] Track script states explicitly: `idle`, `generating`, `ready`, `reading`, `consumed`, and `failed`.
- [x] Prevent stale generated paragraphs from overwriting newer presenter intent.

### 3. Last-Two-Words Completion

- [x] Normalize finalized speech and generated script text for loose word matching.
- [x] Detect when finalized speech matches the last two meaningful words of the current generated script.
- [x] Mark the current generated script complete when the match succeeds.
- [x] Append or mark the completed generated script in context so future generations know it was accepted/read.
- [x] Show a visible success state such as a brief green highlight in the script panel.
- [x] Automatically allow or start the next script generation after completion.
- [x] Keep manual `Skip` / `Regenerate` controls as fallbacks even when speech matching exists.

### 4. Going Off Script

- [x] Detect when finalized speech diverges from the current generated script strongly enough to imply topic change or skipped script.
- [x] Start with simple normalized word-overlap heuristics before adding model reasoning.
- [x] If divergence is detected, mark the current generated script as skipped.
- [x] Regenerate from the latest spoken context and presentation brief.
- [x] Avoid false positives while the presenter is still reading the generated script.
- [x] Preserve explicit `Skip` and `Regenerate` controls.

### 5. Context Quality

- [x] Include the global presentation brief in every script and display-generation request.
- [x] Use the Phase 1 finalized chunk array as the primary context source.
- [x] Track generated scripts that were accepted/read.
- [x] Maintain a chronological recent-conversation window with speaker turns and accepted generated scripts.
- [x] Avoid summarization on the critical path.
- [x] Expose a compact context payload for provider calls.

### Outputs

- Stable real-time summarized display text.
- Meaningful colored/underlined emphasis.
- Immutable generated next script.
- Last-two-words script completion.
- Going-off-script regeneration from latest context.
- Better script relevance from global brief plus recent conversation.

### Validation

- [ ] Spoken text produces concise big display text with meaningful emphasis.
- [ ] The current generated script does not change unless completed, skipped, or regenerated.
- [ ] Saying the last two meaningful words marks the script complete and shows green confirmation.
- [ ] After completion, a new next script can be generated without manual cleanup.
- [ ] Going off script regenerates from the latest spoken context.
- [ ] Text streaming and display updates continue if script generation is slow or fails.

## Phase 3: Provider Reliability and Extraction Layer

### Objective

Harden the real provider path without changing the presenter experience from Phase 2. Phase 2 owns visible script behavior; Phase 3 owns prompt/context boundaries, malformed-output handling, retry behavior, stale-response protection, latency observability, and structured extraction for future visual work.

### 1. Compact Provider Context

- [x] Send the current finalized speech separately from broader context.
- [x] Keep the last 3-5 finalized chunks in the planning prompt instead of the full transcript.
- [ ] Support an optional cached session summary only when it already exists.
- [x] Use accepted/read generated scripts in future generation prompts.
- [x] Include skipped/superseded scripts so the model can avoid repeating rejected directions.
- [x] Keep provider context compact enough for low latency.

### 2. Provider Boundary

- [ ] Extract Realtime planning/display provider code out of `App.tsx` once behavior stabilizes.
- [ ] Keep the real provider as the primary implementation.
- [ ] Keep fixture/mock provider only for local UI development and test determinism.
- [ ] Keep provider details out of UI components.
- [x] Support stale-response protection when newer presenter intent supersedes older generation.
- [ ] Support explicit cancellation/abort when the presenter clears, skips, or stops the session.

### 3. Structured Response Shape

- [x] Request paragraph text first.
- [x] Enforce English-only generated script output.
- [x] Include lightweight structured visual cues or scene intents in the same response.
- [x] Avoid a second blocking parser call for visual cues.
- [x] Validate visual cues for later visual work without blocking text/script behavior on them.
- [x] Use phrase match + paragraph index + optional word index for `targetTiming`.

### 4. Latency and Failure Behavior

- [x] Start generation only when the script queue is empty or explicitly allowed by Phase 2 controls.
- [ ] Target first generated text within 1-2 seconds under normal conditions.
- [ ] Target a usable paragraph within 3-5 seconds under normal conditions.
- [x] Retry once automatically when planning finishes without usable English paragraph text.
- [x] Keep visible teleprompter text streaming during provider delay or failure.
- [x] Let presenter manually regenerate from controls.
- [ ] Record provider latency metrics separately from UI/debug event logs.
- [ ] Surface actual provider usage fields when available so token/cost tracking can use real numbers.

### 5. Provider Output Guardrails

- [x] Reject malformed or non-English display extraction and keep local fallback display text.
- [x] Reject malformed or non-English generated script output.
- [x] Ignore stale planning deltas and stale completed planning responses.
- [x] Keep display extraction scoped to the latest promoted speech chunk.
- [ ] Add stricter schema validation for visual cues before Phase 5 consumes them.
- [ ] Add one retry for recoverable provider error events, not only malformed planning completion.

### Outputs

- Compact provider prompt/context payload.
- Provider output guardrails for generated script, display extraction, and visual cues.
- Automatic retry for recoverable planning failures.
- Stale-response protection for streamed and completed planning responses.

### Validation

- [ ] One finalized sentence still produces a generated paragraph.
- [ ] The paragraph appears before the presenter needs it in normal conditions.
- [ ] Provider delay or failure does not stall the visible teleprompter.
- [ ] Provider output is rejected or retried when it is malformed or non-English.
- [ ] Stale provider output cannot overwrite newer presenter intent.

## Phase 4: Voice-to-Action Integration

### Objective

Productionize the Realtime speech path proven in Phase 0.5 and combine text streaming, display extraction, generated script queueing, script completion, and topic-change handling into one live presentation loop.

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

- [ ] Queue generated next paragraph for presenter reading in the same shared UI.
- [ ] Accept `queue_next_paragraph`-style tool/function calls or equivalent structured outputs.
- [ ] Keep the queued generated script immutable until the presenter skips it, regenerates intentionally, or marks it done.
- [ ] Keep generated script in the shared script panel, distinct from the main large teleprompter text, until spoken or explicitly injected.
- [ ] Support presenter skip/regenerate during live speech as explicit actions only.
- [ ] Support manual done-reading/generate-next before automatic speech matching is trusted.
- [ ] Enforce English-only generated script output.
- [ ] Add stale-response protection for old LLM outputs.

### 4. Completion and Topic Change

- [ ] Match spoken phrases against the last two meaningful words of the queued script.
- [ ] Trigger script completion and next-generation eligibility on successful match.
- [ ] Show visible completion feedback in the shared script panel.
- [ ] Detect topic-change/divergence from finalized speech.
- [ ] Regenerate from latest context when the presenter intentionally goes off script.
- [ ] Avoid replacing the visible script while the presenter is likely still reading it.

### 5. Topic Drift Memory Enhancement

- [ ] When the presenter goes off script, extract the new topic or direction from finalized speech.
- [ ] Append the new topic as a session-level addendum to the initial presentation brief instead of replacing the original brief.
- [ ] Include both the original brief and topic-drift addendum in future script-generation prompts.
- [ ] Let the LLM decide whether to steer fully into the new topic or gently connect it back to the original presentation.
- [ ] Keep the addendum compact so it improves relevance without bloating the low-latency context payload.

### 6. Failure and Recovery

- [ ] If speech recognition fails, keep typed input available.
- [ ] If LLM generation fails, continue displaying live speech and allow regenerate.
- [ ] If microphone permission is denied, show the manual input harness.

### Outputs

- Speech-first demo loop.
- Live partial speech on the teleprompter.
- Generated presenter script.
- Last-two-words completion.
- Going-off-script regeneration.

### Validation

- [ ] Presenter can begin by speaking without typing.
- [ ] Spoken text appears in near real time.
- [ ] A next paragraph is generated from spoken context.
- [ ] The current script completes when the presenter speaks its last two meaningful words.
- [ ] Going off script regenerates the next script from the latest context.
- [ ] The audience-facing page continues updating if speech or LLM generation fails.

## Phase 5: Glyph Scene Runtime

### Objective

Create the local glyph scene runtime that accepts structured visual cues or scene intents and produces immediate canvas/Pretext-ready motion. This is good-to-have presentation polish after the core real-time text and script loop works.

### 1. Scene Config Interface

- [ ] Define a `VisualCue` input contract based on `PRD.md`.
- [ ] Define a `GlyphSceneConfig` contract with scene ID, cue ID, status, source phrase, target timing, palette, mood, creatures, force fields, speech mappings, reduced-motion behavior, error message, and timestamps.
- [ ] Define supported scene/action types:
  - [ ] `glyph-scene`
  - [ ] `force-field`
  - [ ] `canvas-effect`
  - [ ] `pretext-effect`
  - [ ] optional delayed `image`
- [ ] Store generated scene metadata in a predictable format such as JSON.

### 2. Canvas Glyph Engine

- [ ] Build a framework-agnostic engine that owns `requestAnimationFrame`, canvas drawing, particles, velocities, glyph homes, force fields, resize handling, and reduced-motion behavior.
- [ ] Use React only to mount the canvas and pass stable `sceneConfig` and `speechSignals` through refs/effects.
- [ ] Do not keep per-frame particle state in React.
- [ ] Preserve particle identity across scene changes; retarget existing particles instead of clearing the scene.
- [ ] Add deterministic local scenes for development: forest, storm, dragon, product reveal, swarm, rain, fireflies, and abstract motion.

### 3. Local Scene Generator Prototype

- [ ] Create a local generator that accepts a cue or scene intent and returns a compact `GlyphSceneConfig`.
- [ ] Generate scene rules, palettes, force fields, and timing metadata without requiring external image services.
- [ ] Return scene metadata that the frontend can consume.
- [ ] Add deterministic sample cues and scene configs for development.

### 4. Frontend Scene Loading

- [ ] Add a scene registry or scene status store.
- [ ] Apply ready scene configs to the canvas glyph engine.
- [ ] Render at least one generated/local glyph scene in a visual layer.
- [ ] Add fallback display when a scene config fails or is unavailable.
- [ ] Keep optional image/SVG assets behind the same status store as delayed enhancement only.

### 5. Scene Timing Handoff

- [ ] Accept `create_visual_cues`, `set_glyph_scene_config`, `trigger_force_field`, and `trigger_visual_at_phrase`-style tool/function calls or equivalent structured outputs.
- [ ] Match spoken or queued generated phrases against visual cue `targetTiming`.
- [ ] Trigger ready scene actions when the target phrase or word index is reached.
- [ ] If a generated scene config is not ready in time, use a local fallback scene or skip the effect.
- [ ] Start scene config generation or local scene retargeting early when paragraph text or cue data becomes usable.
- [ ] Use paragraph pacing or light pauses in generated text to create lead time for richer optional visuals.

### 6. PretextJS Preparation

- [ ] Install and evaluate PretextJS in an isolated demo component.
- [ ] Build a small text measurement spike using a fixed paragraph.
- [ ] Map measured glyphs to home positions.
- [ ] Prototype simple letter displacement and return-to-home physics.
- [ ] Keep this outside the Phase 1 core renderer until the effect is stable.
- [ ] Document the spike output so the Rendering Enhancements track can reuse the measured glyph model and physics parameters.

### Outputs

- Scriptable glyph scene interface.
- Local scene registry with metadata.
- Frontend can load and render at least one generated/local glyph scene.
- PretextJS spike for generated visual/text interactions.

### Validation

- [ ] Running the local scene generator with a cue creates a usable scene config.
- [ ] Generated metadata includes source phrase and intended timing.
- [ ] Scene generation can fail without breaking the app.
- [ ] The glyph engine can retarget scenes without resetting every particle.

## Rendering Enhancements Track

### Objective

Layer richer PretextJS and experimental HTML-in-Canvas interactions onto the Phase 5 glyph scene runtime without compromising readability.

### Subtasks

- [ ] Extend the Phase 5 canvas glyph layer above or below DOM text.
- [ ] Reuse the PretextJS spike from Phase 5 when implementing per-letter home positions and physics effects.
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
- [ ] Keep optional generated image/SVG assets as delayed enhancement only.

### Validation

- [ ] Baseline DOM mode works everywhere.
- [ ] Canvas layer can be disabled without breaking text.
- [ ] Advanced effects do not reduce text readability.
- [ ] Experimental HTML-in-Canvas mode degrades cleanly when unsupported.

## Optional Post-MVP: Presenter and Audience View Split

### Objective

Optionally evolve the MVP shared page into separate presenter and audience rendering targets.

This is intentionally deprioritized. The product can keep the teleprompted next script in the same shared UI. Only revisit this after the live speech, script generation, glyph scene runtime, and voice-to-action loop feel useful.

### Subtasks

- [ ] Extract shared presentation state from view components.
- [ ] Define audience view as polished text and visuals only.
- [ ] Define presenter view as live text, generated script, status, and controls.
- [ ] If separate views become necessary, move the shared controls/script panel into the presenter view.
- [ ] Add a simple route or session mode switch for presenter vs audience.
- [ ] Decide how state sync works between views.
- [ ] Keep shared-view mode available for local demos.
- [ ] Preserve the current shared UI as the default mode unless a real demo need proves separate views are necessary.
- [ ] Optionally hide the generated script and controls for audience-only mode.

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
- [ ] Show the session total in the shared debug panel when the debug flag is enabled.
- [ ] Log per-call token estimates to the browser console in debug mode.
- [ ] Use a simple character-to-token heuristic (e.g., chars / 4) unless the provider returns actual token counts.

### Validation

- [ ] Token tracking UI is invisible when the debug flag is off.
- [ ] Session totals increment with each generation call.
- [ ] Estimated cost updates reflect the correct token type and pricing tier.
- [ ] Token tracking adds no latency to the generation or streaming path.

## Suggested Build Order

0. Spike mode: fast proof of Realtime API, WebRTC text display, and script generation latency.
1. Phase 0 minimal project bootstrap.
2. Phase 0.5 Realtime LLM feasibility spike with real speech and real generation, refined from spike learnings.
3. Phase 1 DOM teleprompter using the real transcription stream, with manual fixture fallback.
4. MVP slice with real speech, real LLM generation, shared script panel, and latency logging.
5. Phase 2 text and script loop hardening: summarized big text, meaningful emphasis, immutable current script, last-two-words completion, and going-off-script regeneration.
6. Phase 3 provider hardening, script queue, stale-response handling, and failure recovery.
7. Phase 4 voice-to-action integration for the reliable text/script loop.
8. Phase 5 glyph scene runtime and local scene config interface.
9. Rendering enhancements with PretextJS and optional HTML-in-Canvas.
10. Persistence beyond in-memory state, only after MVP usage shows what needs to be retained.
11. Optional separate presenter/audience views, only after the shared UI proves insufficient.

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
- Visual/glyph work is not part of this milestone; it starts only after the text/script loop is reliable.
- Timing logs show speech partials, sentence finalization, LLM start, first generated text, and usable paragraph completion.
- Target latency is 1-2 seconds to first generated text and 3-5 seconds to a usable paragraph under normal conditions.
- The text stream continues if generation is late or fails.
- The UI can be minimal: debug transcript, generated script preview, and latency measurements.
- No dependency on polished image integration, advanced PretextJS effects, or HTML-in-Canvas.

This milestone proves or disproves the core product bet before investing in polished UI, clean architecture, or advanced visuals.

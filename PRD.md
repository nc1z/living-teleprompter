# Living Teleprompter PRD

## Source references

- `IDEA.md`: Defines the phased product concept: a single-page streaming teleprompter, image generation scripts, LLM-generated next-paragraph prompting, and speech as the final entrypoint.
- `REPORT.md`: Provides the technical foundation for interactive text rendering with PretextJS, including per-character layout, canvas rendering, physics-based motion, accessibility considerations, and the dragon-style animation model.
- `REPORT-2.md`: Evaluates HTML-in-Canvas as an experimental way to combine accessible DOM text with canvas/WebGL/WebGPU effects, shaders, pixel manipulation, and worker-based rendering.

## Product summary

Living Teleprompter is a single-page presentation surface for unplanned demos. A speaker begins by saying a sentence. The app streams that sentence into a focused teleprompter display, uses the live context to generate the next paragraph for the speaker, and pre-generates visual assets that can appear as the presentation evolves.

The audience sees a dynamic landing page that changes while the speaker talks. The presenter sees or reads a continuously generated script. The system should feel like a live, improvised presentation where text, visuals, and generated prompts stay synchronized.

## Problem

Live demos and presentations often require prepared scripts, slides, and visual assets. When the presenter has not prepared, the experience usually becomes less polished: the speaker has to improvise, the audience has no visual anchor, and any supporting graphics arrive too late.

Living Teleprompter addresses this by converting speech into a real-time presentation surface:

1. Current speech becomes beautiful streamed text.
2. The LLM uses the streamed sentence as context.
3. The LLM generates the next paragraph for the presenter.
4. The system starts preparing relevant images, SVGs, or animated visual elements before the presenter reaches the corresponding line.
5. The audience sees a page that stays visually alive throughout the talk.

## Goals

- Build a single-page, no-scroll teleprompter display that streams text in real time.
- Highlight the active/focused text while greying out older text.
- Preserve enough streamed text context for LLM generation.
- Generate the next paragraph of presenter script from the live context.
- Start background visual generation jobs based on upcoming generated script.
- Support PretextJS-compatible visual effects inspired by the dragon animation described in `REPORT.md`.
- Use HTML-in-Canvas ideas from `REPORT-2.md` as a progressive enhancement when browser support allows it.
- Integrate speech as the final primary entrypoint.

## Non-goals

- Full slide-deck editing.
- Multi-page website publishing.
- Production-grade video compositing.
- Real-time collaborative editing.
- A general-purpose text editor.
- Replacing presentation tools like Keynote, PowerPoint, or Google Slides.

## Target users

- Demo presenters who want to improvise product walkthroughs.
- Founders or builders recording quick product demos.
- Livestreamers who want generated visuals while speaking.
- Educators or workshop hosts who want a live visual layer without preparing slides.

## Core user journey

1. The presenter opens a single-page teleprompter.
2. The presenter starts speaking: "Today I will be demoing XXX. We can now do interactive demos without preparing for it."
3. The spoken sentence streams into the page as large readable text.
4. Older words fade or grey out while the active phrase remains visually focused.
5. The LLM receives the sentence and current context.
6. The LLM generates at least the next paragraph of script.
7. The system identifies visual opportunities in that paragraph.
8. Background jobs generate images, SVGs, or animation-ready assets.
9. As the presenter reads the generated paragraph, the page reveals relevant dynamic visuals.
10. The loop continues from speech to context to script to visuals.

## Product Views

The long-term product should support separate presenter and audience views:

- **Presenter view:** Shows live spoken text, generated next-paragraph script, generation state, and presenter controls.
- **Audience view:** Shows only the polished public presentation surface: beautiful streamed text and generated visuals.

For the MVP, separate views are an enhancement rather than a blocker. The MVP may use one shared page, but it must include a subtle presenter-only overlay or panel for the upcoming generated script. This overlay should be easy to hide and should be architected so it can later become a private presenter view without rewriting the audience-facing teleprompter.

## Phase 1: Streaming Teleprompter Page

### Objective

Create the first single-page experience: streamed text in, no-scroll teleprompter display out.

### Requirements

- Render one full-screen page with no document scrolling.
- Accept streamed text input as sentences, words, or tokens.
- Display text in a teleprompter style optimized for reading from a distance.
- Grey out older text while keeping the current text visually focused.
- Keep the active text centered or visually dominant.
- Maintain a short rolling context buffer.
- Support manual text input for local testing before speech integration exists.
- Provide deterministic demo data so Phase 1 can be tested without APIs.
- Prefer regular DOM text rendering for the first implementation so the page remains accessible, debuggable, and compatible with stable browsers.
- Keep Phase 1 visually focused on the white teleprompter text experience: grey previous words, bold active words, no generated image/text physics required.
- Include a presenter overlay that can show queued generated script separately from the large audience-facing teleprompter words.

### Acceptance criteria

- A user can stream a sentence into the app and see it appear progressively.
- The page does not scroll.
- Older streamed text is visually de-emphasized.
- The current streamed phrase is easy to identify.
- The app can run locally without voice, LLM, or image generation services.
- The presenter overlay can be shown or hidden without disrupting the teleprompter display.

## Phase 2: Visual Generation Scripts

### Objective

Create functions or scripts that can generate visual assets, including SVGs or assets compatible with PretextJS-style text and physics effects.

### Requirements

- Provide a scriptable interface for generating visual prompts from text.
- Support calling Codex exec or another local command runner to create assets.
- Support output formats suitable for the frontend, including SVG and browser-renderable image assets.
- Store generated assets in a predictable local directory.
- Produce metadata that maps each asset to a sentence, phrase, or upcoming paragraph.
- Use `REPORT.md` as the technical reference for PretextJS-compatible interactive text effects.
- Define `Codex exec` as a local background command/script runner for prototyping generated assets, not as a required production API.
- Accept structured visual cue prompts from Phase 3 and convert them into asset generation jobs.

### Acceptance criteria

- A developer can run a script with a prompt and receive a usable visual asset.
- Generated asset metadata includes the source phrase and intended timing.
- The frontend can load at least one generated asset from the local output path.
- The generated asset format does not block later PretextJS or canvas integration.
- Phase 3 can call the Phase 2 asset interface with a visual cue object and receive a generation job ID or asset status.

## Phase 3: LLM Script Generation and Asset Preloading

### Objective

Connect streamed text context to a provider that generates the next paragraph and starts background visual generation.

### Requirements

- Store streamed text context locally in memory, local storage, or a small persistence layer.
- Send a speed-optimized context window to an LLM provider: current finalized sentence, last 3-5 finalized sentences, and an optional cached session summary only if one already exists.
- Return a teleprompt script of at least the next paragraph.
- Use one streaming LLM call that prioritizes paragraph text first and includes lightweight structured visual cues in the same response.
- Identify visual cues from the generated paragraph as structured fields, not through a second blocking parser call.
- Start background image or SVG generation jobs for those cues.
- Track generation state: pending, generating, ready, failed.
- Make generated script available to the teleprompter before the presenter needs it.
- Show generation delay state only behind a feature/debug flag. When enabled, the presenter overlay may show a bouncing `...`; otherwise generation state stays hidden.
- If generation is slow or fails, keep the teleprompter running with current spoken text. Retry once automatically, then allow manual regenerate from presenter controls.
- Start visual generation as soon as a usable generated paragraph or cue is available. The generated paragraph may include light pacing, pauses, or expansion to create lead time for visuals.

### Acceptance criteria

- Given one spoken or typed context sentence, the system generates a next paragraph.
- The generated paragraph can be displayed in the teleprompter stream.
- At least one visual generation job starts from the generated paragraph.
- Asset generation happens asynchronously and does not block text streaming.
- The next paragraph starts streaming within 1-2 seconds after a sentence finalizes under normal conditions.
- A first usable generated paragraph completes within 3-5 seconds under normal conditions.
- Visual generation may trail text generation and should target readiness within 5-15 seconds when possible.
- LLM failure does not stall the visible teleprompter.

## Phase 4: Voice-to-Action Integration

### Objective

Make speech the primary entrypoint and combine the previous phases into one loop.

### Requirements

- Capture microphone input.
- Stream speech-to-text into the Phase 1 teleprompter.
- Send recognized text to the LLM provider.
- Receive generated next-paragraph script.
- Queue generated script for the presenter.
- Trigger background visual generation.
- Render generated visuals at the appropriate moment during the presentation.
- Provide clear fallback behavior if speech, LLM, or visual generation fails.

### Acceptance criteria

- The presenter can start speaking without typing.
- Spoken text appears on the page in near real time.
- The system generates a next paragraph from the spoken context.
- Visual generation begins before the relevant generated sentence is spoken.
- The audience-facing page continues to update even if one background asset fails.

## Presenter Controls

The MVP should include a minimal presenter control surface, available in the presenter overlay:

- Pause/resume live streaming.
- Skip the current generated paragraph.
- Regenerate the next paragraph.
- Clear the session.
- Toggle presenter overlay visibility.

These controls are for live testing and presenter recovery. They should not appear in the audience-facing polished view once separate views are implemented.

## Visual and Text Rendering Requirements

`REPORT.md` identifies PretextJS as a strong foundation for high-performance text layout and physics-based effects. The product should use those ideas where they directly improve the experience.

### Requirements

- Use canvas or similarly performant rendering for animated text effects.
- Treat visible text as layout-aware elements when building advanced effects.
- Keep text readable first; animation should support the presentation rather than interfere with it.
- Support reduced-motion behavior.
- Maintain an accessible text representation outside canvas where needed.
- Keep the main display full-screen and uncluttered.
- Feature-detect experimental HTML-in-Canvas support before using it.
- Provide a stable fallback path when HTML-in-Canvas is unavailable.
- Keep CSS size, canvas backing size, and device pixel ratio synchronized for all canvas-based rendering.

### Generated visual/text interaction

The PretextJS dragon demo in `REPORT.md` should guide the technical ambition, but dragons are only one example. The broader goal is generated visual/text interaction:

- Text can behave like particles with home positions.
- Generated SVGs or character-based objects can move through text.
- Letters can temporarily react to animated objects and return to place.
- The app can use generated visual motifs such as unicorns, forests, product diagrams, or abstract motion elements.
- Phase 1 should not include these advanced interactions. Phase 1 users should see the clean white teleprompter experience first; generated image/text physics belongs to later phases.

### HTML-in-Canvas opportunity

`REPORT-2.md` introduces an alternate rendering path that may improve the product once the core experience works:

- Keep teleprompter words as real HTML for accessibility, selection, styling, and semantic behavior.
- Capture that HTML as a canvas/WebGL/WebGPU texture for fluid visual effects.
- Apply shader-driven effects such as ripples, liquid distortion, burn transitions, morphs, or particle disintegration.
- Use `paint` events and `requestPaint()` only when needed, avoiding unnecessary redraws.
- Offload heavier capture or post-processing work to workers with `OffscreenCanvas` where supported.

This should not be required for the MVP because the API is experimental and may require browser flags. It is best positioned as a Phase 2 or Phase 3 visual enhancement behind feature detection.

## Rendering Strategy

The product should use a layered rendering strategy rather than betting on one technique too early:

1. **Baseline DOM teleprompter:** Render the large focused words as normal HTML. This is the Phase 1 default because it is accessible, stable, easy to style, and fast enough for streaming text.
2. **Canvas visual layer:** Render generated images, SVG-inspired motion, particles, and PretextJS text physics above or below the DOM text when advanced effects are needed.
3. **PretextJS text-physics mode:** Use PretextJS when individual letters need measured positions, home coordinates, and physics interactions.
4. **HTML-in-Canvas enhancement:** When supported, capture live DOM text into canvas/WebGL textures to apply fluid shader effects while preserving DOM semantics.

The implementation should choose the simplest layer that satisfies the current effect. Phase 1 should not require PretextJS or HTML-in-Canvas unless a specific animation demands it.

## Tech Stack

- React + Vite + TypeScript for the single-page app.
- DOM-first rendering for the Phase 1 teleprompter.
- PretextJS is required for Phase 2+ advanced text physics and generated image/text interaction, but not required for the Phase 1 MVP.
- Canvas/WebGL layers are introduced when visual effects need them.
- HTML-in-Canvas remains an experimental progressive enhancement behind feature detection.

## System Architecture

### Frontend

- Single-page app.
- Teleprompter renderer.
- Streaming text state.
- Focus and history display.
- Visual layer for generated assets.
- Optional PretextJS/canvas layer for physics text effects.
- Optional HTML-in-Canvas/WebGL layer for experimental shader effects.

### Context manager

- Stores streamed speech/text.
- Maintains current sentence, recent paragraph, and session-level context.
- Sends compact context to the LLM.
- Receives generated script and visual cues.

### Provider layer

- Abstracts LLM calls.
- Supports OpenAI voice-to-action APIs or Codex-driven workflows.
- Supports future provider changes without rewriting the UI.

### Asset generation worker

- Accepts visual prompts.
- Calls local scripts, Codex exec, image APIs, or SVG generators.
- Writes assets and metadata.
- Reports readiness back to the frontend.

### Rendering capability detector

- Detects support for stable DOM rendering, canvas rendering, PretextJS effects, and HTML-in-Canvas APIs.
- Chooses the highest-quality supported rendering path at runtime.
- Falls back to DOM text plus simple visual overlays when experimental APIs are unavailable.

## Data Model

### Stream chunk

- `id`
- `text`
- `timestamp`
- `source`: `typed`, `speech`, or `generated`
- `status`: `partial` or `final`

### Generated paragraph

- `id`
- `sourceContextIds`
- `text`
- `createdAt`
- `visualCues`

### Visual cue

- `id`
- `phrase`
- `prompt`
- `targetTiming`: phrase match + paragraph index + optional word index. This is not a wall-clock timestamp by default.
- `assetType`: `svg`, `image`, `canvas-effect`, or `pretext-effect`
- `status`: `pending`, `generating`, `ready`, or `failed`
- `assetPath`

### Rendering capability

- `supportsCanvas`
- `supportsPretext`
- `supportsHtmlInCanvas`
- `supportsOffscreenCanvas`
- `devicePixelRatio`
- `selectedRenderingMode`: `dom`, `dom-plus-canvas`, `pretext-canvas`, or `html-in-canvas`

## Success Metrics

- Text streaming feels immediate, with no visible UI blocking.
- Active text is readable at presentation distance.
- Generated next paragraph is available before the presenter finishes the current thought.
- The next paragraph starts streaming within 1-2 seconds after sentence finalization and completes a usable draft within 3-5 seconds under normal conditions.
- Visual jobs can run in the background without disrupting text rendering.
- Visual jobs can begin before the presenter reaches the relevant generated sentence.
- Advanced text effects maintain smooth animation on a typical laptop.
- The app can complete a full demo loop from speech to text to generated script to visual output.
- Experimental rendering enhancements degrade cleanly to the baseline DOM teleprompter.

## Risks

- Voice recognition latency may make the script feel late.
- LLM generation may produce paragraphs that do not match the speaker's intent.
- LLM generation may fail or exceed the desired latency budget; the teleprompter must continue and presenter controls must allow recovery.
- Image generation may be too slow for live timing.
- Canvas-heavy effects may reduce readability if overused.
- HTML-in-Canvas is experimental, browser-limited, and may require flags, so it cannot be a hard dependency.
- Shader or pixel-processing effects may introduce device pixel ratio, coordinate sync, and transform alignment bugs.
- Generated visuals may need moderation, caching, and fallback states.
- Provider APIs and model capabilities may change over time.

## Open Questions

- Should visual assets be generated only from LLM-produced script, or also from the speaker's live words?
- Where should session data persist: memory, browser storage, local files, or a lightweight database?
- When should HTML-in-Canvas become part of the public demo path instead of an experimental mode?
- Which effects are worth shader-based rendering versus simpler CSS/canvas overlays?

## MVP Definition

The MVP is Phase 1 plus a narrow slice of Phase 3:

- A single no-scroll page.
- Manual typed streaming input.
- Focused teleprompter rendering with greyed-out history.
- Local context buffer.
- Mock or real LLM call that generates the next paragraph.
- Generated paragraph appears in the teleprompter queue.
- Advanced PretextJS and HTML-in-Canvas effects are excluded from the MVP unless implemented as optional demos.

Phase 2 and Phase 4 can be developed after the MVP proves that the core speech-to-script loop feels useful.

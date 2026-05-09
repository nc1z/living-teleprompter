# Learnings

## Image Generation Latency

- The first live `image-gen` visual for the generated script took `111901ms` end to end.
- This is too slow for live presentation pacing. At that latency, visuals arrive after the speaker has likely moved past the relevant moment.
- We need to investigate alternatives before treating visual generation as viable in the realtime loop.

Potential alternatives to explore:

- Start image generation earlier, as soon as the next script begins streaming instead of waiting for the final paragraph.
- Generate lower-quality or smaller draft visuals first, then replace them with higher-quality versions when ready.
- Pre-generate multiple likely visual directions from the presentation brief before the speaker reaches them.
- Use cached/reusable visual templates or animations while the high-quality image is still generating.
- Split the visual pipeline into immediate lightweight stage effects plus slower background image generation.

## ASCII / Glyph Animation Pivot

- `ANIMATE-HOW-TO.md` clarifies that the pivot should not be static ASCII art.
- The target is a persistent local glyph-particle system: canvas/WebGL rendering, spring physics, force fields, and scene controllers.
- AI should generate scene rules/configs when needed, but runtime visuals should be deterministic and local.
- First POC implementation should replace image assets with immediate canvas glyph scenes so the audience sees motion in milliseconds rather than waiting for image generation.
- The next iteration should generate compact scene configs from the generated script, not choose only from fixed presets. The runtime can support a small primitive library (`blob`, `ring`, `line`, `spiral`, `wave`, `tree`, `chain`, etc.) while the model decides composition, glyph palette, mood, colors, and energy.

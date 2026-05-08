# HTML‑in‑Canvas and Fluid Web Animations

## Overview

The **HTML‑in‑Canvas API** is an experimental WICG proposal that bridges the gap between DOM elements and graphics contexts.  Historically, developers wanting to combine rich HTML content with advanced canvas effects had to either position HTML elements on top of a canvas or manually recreate UI elements inside the canvas.  The proposal allows a `<canvas>` element to contain actual DOM children that are fully interactive and accessible; the browser can capture those elements as textures and hand them to 2D Canvas, WebGL or WebGPU contexts at high speed【776459002812559†L20-L45】.  This makes it possible to blend the semantic, accessible world of HTML with per‑pixel shaders, 3D transformations and other techniques that were previously limited to games and graphic applications.

### What problem does it solve?

* **Replaces CSS overlay hacks and complex re‑rendering libraries.** Traditional approaches for mixing HTML and canvas involved overlaying HTML on top of the canvas or using libraries like `html2canvas`.  Overlays do not work when the content needs to live inside a 3‑D world, and `html2canvas` re‑renders the DOM in JavaScript, missing features like `backdrop‑filter`, shadows and web fonts【386237678364701†L132-L144】.
* **Maintains interactivity and accessibility.** Because canvas children remain real DOM nodes, keyboard focus, screen reader semantics and pointer events continue to work even though their visual representation is captured as pixels【776459002812559†L34-L45】.
* **Enables GPU‑accelerated effects.** The API allows the browser to capture HTML at 60 fps and supply it directly to the GPU.  Shaders can then distort, blend or apply post‑processing to HTML content【386237678364701†L84-L107】.

## Core primitives in the specification

The explainer defines four key primitives【958048505750994†L297-L337】:

| Primitive | Purpose | Notes |
|---|---|---|
| **`layoutsubtree` attribute** | Added to `<canvas>` to opt its descendants into normal layout and hit‑testing.  Without it the children are invisible until drawn.  It creates a stacking context and paint containment【958048505750994†L297-L305】【470823563556913†L81-L90】. | Required for HTML‑in‑Canvas to work. |
| **`drawElementImage()` / WebGL equivalents (`texElementImage2D`, `copyElementImageToTexture`)** | Captures a child element’s rendered pixels into a 2D canvas, WebGL or WebGPU texture.  When called during the `paint` event, it draws a fresh snapshot of the element; outside `paint`, it uses the previous frame【958048505750994†L309-L315】. | Returns a transform matrix that can be applied to the DOM element to keep its location synchronized【958048505750994†L367-L389】. |
| **`paint` event & `requestPaint()`** | A new event on `<canvas>` that fires when any canvas child changes visually.  It triggers the drawing of updated snapshots.  The `requestPaint()` method forces an additional paint even when nothing has changed, similar to `requestAnimationFrame()`【958048505750994†L339-L352】. | Use the event to perform drawing logic; DOM changes made during the event are applied in the next frame【958048505750994†L341-L348】. |
| **`captureElementImage()`** | Creates an `ElementImage` snapshot that can be transferred to a web worker and drawn on an `OffscreenCanvas`【958048505750994†L354-L360】. | Enables heavy rendering on worker threads. |

## How HTML‑in‑Canvas works

1. **Place HTML content inside the `<canvas>` with `layoutsubtree`.**  The canvas’s children behave like normal DOM elements (they can be styled with CSS, scroll and receive focus) but are not visually shown until captured【470823563556913†L81-L90】.
2. **Listen for the `paint` event and draw the element.**  After calling `canvas.requestPaint()` to trigger the initial paint, register a `paint` event listener.  Inside the handler, call `ctx.drawElementImage(element, x, y)` or the WebGL/WebGPU equivalent to draw the element at a specific position in the canvas【470823563556913†L101-L121】.  Clear the context with `ctx.reset()` before drawing to avoid stale transformations【470823563556913†L123-L126】.
3. **Synchronize transforms.**  The returned transform matrix ensures that pointer events and accessibility reflect the drawn position.  Apply `element.style.transform = transform.toString()` after drawing【470823563556913†L214-L227】.
4. **Enable the experimental flag.**  The API is currently available behind the `CanvasDrawElement` flag in Chromium browsers (Chrome Canary or Brave stable).  Navigate to `chrome://flags/#canvas-draw-element` and enable it【525949266211317†L223-L224】【470823563556913†L25-L33】.

The simplest example is:

```html
<canvas id="canvas" width="400" height="200" layoutsubtree>
  <div id="ui">
    <h2>Interactive HTML</h2>
    <input type="text" placeholder="Type here...">
  </div>
</canvas>
<script>
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const ui = canvas.querySelector('#ui');
  canvas.requestPaint();
  canvas.addEventListener('paint', () => {
    ctx.reset();
    const transform = ctx.drawElementImage(ui, 0, 0);
    ui.style.transform = transform.toString();
  });
</script>
```

## Key considerations and best practices

### Size and resolution

* **Sync the canvas drawing surface with its CSS size.**  The canvas element does not automatically size itself to its content.  If the CSS size and the drawing surface (`width`/`height` attributes) do not match, textures will be stretched and coordinates will drift【525949266211317†L211-L213】【470823563556913†L145-L157】.  A common pattern is to attach a `ResizeObserver` that sets `canvas.width` and `canvas.height` to the element’s device‑pixel dimensions【470823563556913†L160-L165】.
* **Account for device pixel ratio (DPR).**  Multiply CSS positions by `canvas.width / canvasRect.width` to align coordinates on high‑DPI displays【525949266211317†L217-L218】.
* **Use opaque backgrounds.**  Semi‑transparent input backgrounds may allow shader effects to bleed through; using solid colors prevents artifacts【525949266211317†L220-L221】.

### Coordinate and transform handling

* **Flip the Y axis in shaders.**  WebGL’s coordinate system is bottom‑up, whereas canvas textures are top‑down.  Adjust UVs accordingly, e.g., `v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5)`【525949266211317†L208-L209】.
* **CSS transforms on the source element do not affect drawing.**  The spec states that the canvas’s current transformation matrix applies when drawing, but CSS transforms on the element are ignored for rendering【470823563556913†L189-L192】.  Interaction still respects CSS transforms, so applying a transform only to the HTML results in misaligned visuals【470823563556913†L194-L207】.  Synchronize the transform using the returned matrix from `drawElementImage()`【470823563556913†L209-L233】.
* **Call `ctx.reset()` before each draw.**  This resets the transformation matrix and other drawing state, ensuring previous frames do not bleed into the next【470823563556913†L123-L126】.

### Triggering paints

* **Use `requestPaint()` to force a repaint.**  The `paint` event only fires when children visually change.  For animations that update every frame (e.g., numbers counting up), call `requestPaint()` within your animation loop【958048505750994†L339-L352】.
* **Wait for the first `paint` event.**  Calling WebGL’s `texElementImage2D` or the 2D context’s `drawElementImage` before the first paint results in `InvalidStateError`【525949266211317†L214-L215】.

### Privacy and security

To protect user data, painting an element automatically strips sensitive information.  Cross‑origin resources (images, iframes) are not drawn; form autofill suggestions and visited‑link styling are hidden; text subpixel anti‑aliasing is disabled【776459002812559†L109-L120】.  This ensures the API cannot be abused to extract cross‑origin content or user secrets.

## Creating fluid animations with HTML‑in‑Canvas

### Shader‑driven effects

The most striking use of HTML‑in‑Canvas comes from combining WebGL shaders with live HTML textures.  Because the captured HTML becomes a texture, fragment shaders can perform per‑pixel distortion, blending or masking.  Examples from the **html‑in‑canvas.dev** showcase include:

* **Liquid Glass Distortion:** An HTML card is placed inside a `<canvas layoutsubtree>` and drawn into a WebGL canvas.  A refraction shader warps the texture following the mouse; pointer events pass through to the live HTML underneath【378545314184561†L28-L66】.  The steps are:
  1. Render a styled HTML card inside a canvas.
  2. Call `drawElementImage()` to copy the card into a 2D canvas【378545314184561†L52-L56】.
  3. Use that canvas as a WebGL texture and apply a refraction shader【378545314184561†L52-L59】.
  4. Compose the shader result over the live HTML, allowing users to click buttons through the distortion【378545314184561†L60-L63】.

* **Pixel Disintegration:** A tweet‑style card is drawn inside the canvas.  On click, the card is disintegrated into thousands of particles; clicking again reassembles it.  The effect uses `drawElementImage()` to render the card, then `getImageData()` to read each pixel’s color and position as seeds for particles【122849948757675†L63-L76】.  Physics (velocity, gravity, drag) drives the particles, which then reassemble on demand【122849948757675†L69-L77】.

* **Burn Transition & Morphing Text:** Advanced demos blend two live HTML states using multiple textures and noise functions.  For example, a dark‑mode toggle draws both the light and dark pages into separate textures and composites them through zones (heat distortion, ember line, smoke)【525949266211317†L160-L175】.

These examples illustrate that **shaders unlock fluid, organic animations**—distortions, ripples, melting text, noise‑driven transitions—that are impossible with CSS alone.  Because the API gives per‑pixel access to HTML, developers can sample luminance, edges or color to drive animations【525949266211317†L60-L70】.

### Particle and pixel manipulation

In addition to shaders, you can manipulate pixels directly with the 2D canvas API:

1. Draw the element into the canvas during the `paint` event (`ctx.drawElementImage(element, 0, 0)`).
2. Use `ctx.getImageData(0, 0, canvas.width, canvas.height)` to read the RGBA values【470823563556913†L264-L275】.
3. Iterate over the pixel array (`data`) and modify values (change colors, reposition pixels, or compute particle parameters)【470823563556913†L249-L297】.
4. Write back the updated pixels using `ctx.putImageData()`【470823563556913†L315-L319】.

This pattern enables effects like dissolves, transitions, pixel sorting and sprite explosions.  The **Pixel Disintegration** demo uses this technique to sample color and position for each particle【122849948757675†L63-L76】.  Remember to keep a buffer of the original pixel data when iterating so that modifications do not affect the source while reading【470823563556913†L339-L347】.

### Synchronizing transforms for motion

To animate movement, rotation or scaling of HTML content inside the canvas without breaking interactivity:

1. Apply transformation methods on the canvas context (e.g., `ctx.translate`, `ctx.rotate`, `ctx.scale`) before calling `drawElementImage()`.
2. Retrieve the transform returned by `drawElementImage()` and assign it to the HTML element’s `style.transform`【470823563556913†L209-L227】.  This ensures that pointer events and focus follow the visual representation.
3. For dynamic animations (e.g., following pointer movements or values from an input), call `requestPaint()` each frame to trigger the `paint` event.

## Performance considerations

* **Use `requestPaint()` sparingly.**  Unlike `requestAnimationFrame()`, `paint` only fires when the DOM changes, making it efficient for static UI.  For continuous animations, call `requestPaint()` inside your animation loop but avoid unnecessary calls when nothing changes.
* **Batch drawing in a single `paint` handler.**  If multiple elements need to be captured, draw them sequentially during the same `paint` event to minimise redraws.  The event provides a list of changed elements, enabling targeted updates【958048505750994†L341-L347】.
* **Offload heavy work to workers.**  Use `captureElementImage()` to transfer element images to a worker thread and perform expensive rendering on an `OffscreenCanvas`【958048505750994†L354-L360】.
* **Feature detection.**  Always check for API support before using it.  Feature detection can be performed by creating a canvas, setting the `layoutsubtree` attribute and verifying that `drawElementImage` exists on the context【386237678364701†L151-L159】.  Provide a fallback for unsupported browsers.

## Privacy and security safeguards

To prevent cross‑origin data leakage or covert fingerprinting, the specification enforces **privacy‑preserving painting**.  When capturing HTML:

* Cross‑origin images, iframes and CSS `url()` resources are not painted【776459002812559†L109-L120】.
* Form autofill suggestions and spelling or grammar markers are hidden【776459002812559†L109-L120】.
* Visited‑link styling is treated as unvisited【776459002812559†L117-L119】.
* Subpixel anti‑aliasing is disabled to avoid timing attacks【776459002812559†L119-L120】.

These protections mean that applications cannot use HTML‑in‑Canvas to capture sensitive user information.  Developers should still respect privacy by not capturing confidential content and by following permission prompts when implemented by browsers.

## Conclusion

The HTML‑in‑Canvas API opens a new frontier for web animations.  By capturing live, interactive HTML as textures and combining it with shaders, WebGL and pixel manipulation, developers can produce fluid, cinematic effects while retaining the accessibility and semantics of the DOM.  Key to a successful implementation are:

* Opting into the feature with the `layoutsubtree` attribute and enabling the experimental flag.
* Managing size, coordinate systems and transforms to ensure pixel‑perfect rendering.
* Using the `paint` event and `drawElementImage()` to capture HTML and synchronize DOM transforms.
* Harnessing shaders, pixel operations and physics to create fluid, responsive animations.

Although still experimental and behind a flag, the API demonstrates that the web can evolve beyond flat layers into immersive experiences where the boundaries between DOM and canvas dissolve.

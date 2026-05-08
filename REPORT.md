# PretextJS: interactive text and physics effects

## Overview of PretextJS and how it works

**Purpose and origin.**  PretextJS (often just *Pretext*) is a small (~15 KB) TypeScript library created by Cheng Lou (author of `react‑motion`).  It solves a long‑standing bottleneck in web development: measuring text dimensions forces the browser to recalculate the entire layout tree (a *reflow*), and even using the Canvas API (`measureText`) for measurement still carries overhead.  Pretext avoids both reflow and heavy canvas operations by splitting text layout into two phases.  The `prepare()` function uses the browser’s `canvas.measureText()` API once to measure each segment of text and caches the results.  Then `layout()` performs pure arithmetic to compute line counts, heights and break positions for any container width, so subsequent layouts run in microseconds without touching the DOM【97116289204646†L54-L119】.  The library caches measurements based on the text and font, so repeated calls return instantly【97116289204646†L145-L151】.  Benchmarks from early 2026 show that measuring 1,000 pieces of text with Pretext takes about 0.05 ms—roughly **500× faster** than DOM methods and **19× faster** than plain canvas measurement【97116289204646†L166-L210】.

**Two‑phase architecture.**  The separation of measurement and layout unlocks new interaction patterns.  Developers can call `prepare()` once for each unique string, then repeatedly call `layout()` whenever the container width or line height changes.  Because the heavy measurement work is cached, resizing or reflowing text becomes almost free【97116289204646†L109-L159】.  Pretext supports Unicode segmentation and works across Latin, CJK, Arabic (including right‑to‑left) and emoji sequences【97116289204646†L111-L115】.  It does not render text—Pretext only provides precise metrics.  Developers are expected to render the text themselves (e.g., via the DOM, Canvas or WebGL), which means they can combine the layout data with custom rendering and physics.

**Why text measurement matters.**  Modern frameworks like React, Vue and Svelte re‑render components on every state change; a table that sorts or filters may trigger hundreds of text measurements.  DOM-based measurement (`getBoundingClientRect`) triggers a reflow, and each reflow can take several milliseconds.  For UIs displaying many rows, this can freeze the browser【97116289204646†L82-L108】.  By decoupling measurement from rendering, Pretext eliminates this bottleneck and integrates naturally into reactive architectures【97116289204646†L82-L88】.

## Community demos and the “dragon” phenomenon

PretextJS shot to prominence in March 2026 partly because of creative demos that showcased what becomes possible when text measurement is essentially free.  The community built animations where text flows around moving shapes, physics simulations where balls bounce between lines, and morphing paragraphs【97116289204646†L399-L417】.  Among these, the most famous is a demo where **an animated dragon made from ASCII characters flies through a block of multilingual text and pushes the letters aside in real time**【97116289204646†L399-L413】.  The effect was striking because the dragon seemed to “swim” through the text at 60 frames per second, with letters bouncing away and then springing back to their home positions after the creature passed.  The underlying technique is explained in the *Pretext Playground* repository.

### How the dragon demo works

The *Pretext Playground* describes the demo as “an interactive ASCII dragon demo built on `@chenglou/pretext`”【67008885445374†L275-L282】.  Its key characteristics include:

- **Per‑character physics:**  Every visible character on the screen is treated as an independent physics body【67008885445374†L320-L322】.  After the text is measured with Pretext, each character receives a “home” position (its normal coordinates in the layout)【67008885445374†L301-L306】.  A simple physics simulation applies forces when a character is displaced: a spring force pulls it back to its home location, and friction/damping slows it down.  This creates the effect of letters bouncing back after being disturbed.

- **Dragon representation:**  The dragon is rendered as a chain of about 60 ASCII glyphs (e.g., `◆▓▒░╬║│·`) with wings, spines and eyes【67008885445374†L317-L319】.  It is controlled by the user’s cursor; moving the mouse updates the dragon’s head, and the rest of the segments follow with slight delay, producing a smooth “snake” or “dragon” motion.  Clicking the mouse emits ASCII “fire” particles (`✦✧❋✺`) that blast nearby letters and apply additional forces【67008885445374†L320-L324】.

- **Canvas rendering and main loop:**  The demo uses the Canvas 2D API for all rendering【67008885445374†L356-L358】.  At initialization it calls Pretext’s `prepareWithSegments` and `layoutWithLines` to obtain the positions of every character【67008885445374†L301-L307】.  During the animation loop (driven by `requestAnimationFrame`), it updates the physics state of each character and the dragon, draws them to the canvas, and repeats.  Importantly, the text measurement is only performed once at startup (and on resize); the per‑frame work is pure physics and drawing【67008885445374†L368-L371】.

- **Additional features:**  The playground also includes floating enemy characters, a 3D text “tunnel”, rotating cards and a control panel with sliders for dragon size, physics parameters and fire intensity【67008885445374†L326-L337】.  These extras show how Pretext’s layout data can be repurposed for various interactive effects.

The Emelia article notes that a Romanian developer built an animated dragon with **80 articulated segments** that recalculated the entire layout each frame while still maintaining 60 fps, illustrating the efficiency of Pretext【97116289204646†L403-L413】.  Because Pretext decouples measurement from rendering, layout recalculations do not involve the DOM and thus can be done each frame without degrading performance【97116289204646†L399-L417】.

## What makes Pretext suitable for physics‑based text interactions

The dragon demo is not a built‑in Pretext feature; rather, Pretext provides the foundation for creative developers to implement it.  The key enablers are:

1. **Per‑character metrics:**  Pretext’s `layoutWithLines` returns detailed positional data for every glyph.  Developers can assign a “home” to each letter and update its actual position independently, enabling letter‑level physics【67008885445374†L301-L306】.

2. **Cacheable measurement:**  Since measurement is done once via `prepare()` and reused via `layout()`, the cost of recomputing layouts on each frame is negligible【97116289204646†L109-L119】.  This makes it feasible to recalculate or update text layout after the dragon pushes letters around or when the container resizes.

3. **Canvas‑friendly output:**  Pretext returns plain numeric positions rather than DOM nodes, so it integrates naturally with canvas or WebGL rendering.  The dragon demo uses the Canvas 2D API to draw text and shapes efficiently【67008885445374†L356-L358】.

4. **Internationalization support:**  Pretext handles segmentation for CJK, Arabic, Hebrew, emojis and mixed scripts【67008885445374†L312-L313】, making it possible for the dragon to swim through multilingual text.  This broad language support is critical because letter widths and kerning vary widely across scripts.

5. **Performance:**  With `layout()` running in ~0.05 ms for 1,000 items【97116289204646†L166-L210】 and no reflows, developers can include additional physics calculations and still maintain 60 fps.  The playground’s main loop updates thousands of characters plus a chain of dragon segments each frame【67008885445374†L368-L371】.

These factors explain why Pretext sparked so much excitement and why the dragon demo became a viral showcase of what is now possible.

## Product requirements document: React‑based dragon text component

The following PRD outlines a **React component** that replicates the core features of the Pretext dragon demo while remaining flexible for other interactive layouts.

### Purpose

To provide a reusable React component that allows developers to animate a graphical object (e.g., dragon, cursor follower, shape) through a block of text.  As the object moves, individual letters are displaced with physics and then return smoothly to their original positions.  The component should demonstrate the power of Pretext for interactive text layouts and serve as a learning tool for developers exploring the library.

### Goals and objectives

- **Demonstrate Pretext capabilities** by building an eye‑catching animation where text reacts to a moving object without DOM reflows.
- **Encourage exploration** by exposing parameters (e.g., object size, physics forces) through a control panel.
- **Provide cross‑language support** so the component works with English, CJK and other scripts using Pretext’s segmentation【67008885445374†L312-L313】.
- **Maintain performance** of at least 60 fps on mainstream devices.  Text measurement should not cause any layout reflow and should leverage Pretext’s caching【97116289204646†L109-L119】.
- **Include accessibility features** such as a hidden DOM copy of the text for screen readers and an option to disable animation for users who prefer reduced motion.

### Non‑goals

- Not intended for production reading experiences (e.g., news articles) because constantly moving text can impair readability.
- Not intended to replace standard CSS text wrapping for typical layouts.

### User stories

1. **Developer**: *As a front‑end developer, I want to import the `DragonText` component into a React app and pass it a string of text and styling options so that I can display interactive, physics‑aware text without worrying about DOM layout performance.*

2. **User (viewer)**: *As a site visitor, I want to move my cursor over the text and watch an animated dragon push letters aside so that I can experience an engaging demo of the technology.*

3. **User with reduced motion**: *As a user who prefers reduced motion, I want to disable the animation while still being able to read the text.*

4. **Developer customizing physics**: *As a developer, I want to adjust physics parameters (spring strength, damping, repulsion radius) to create different interaction styles.*

### Functional requirements

1. **Text measurement and layout**
   - Use Pretext’s `prepare()` and `layout()` functions (or the higher‑level `prepareWithSegments` / `layoutWithLines`) to obtain positions for each glyph in the provided text【67008885445374†L301-L306】.
   - Recompute layout on window resize or when the container width changes, using Pretext’s cached measurements to avoid repeated `measureText` calls【97116289204646†L109-L119】.
   - Support multi‑line text and languages with complex scripts (CJK, Arabic, emoji)【67008885445374†L312-L313】.

2. **Rendering**
   - Draw text and the moving object on an HTML Canvas element.  Use absolute positioning (Canvas 2D context) for each character to enable per‑character motion【67008885445374†L356-L358】.
   - Provide a fallback DOM rendering of the text in a visually hidden element for accessibility; this ensures screen readers can read the content and users can copy/paste.

3. **Physics engine**
   - Treat each character as a particle with position, velocity and home position.  Apply a **spring force** that pulls the character back to its home, and a **repulsive force** when the moving object is within a certain radius.
   - Represent the moving object as a chain of segments following the cursor (inverse kinematics).  Each segment updates its position each frame to follow the previous segment.
   - Implement optional “fire breath” particles that apply additional forces when the mouse button is held.  Fire particles should dissipate after a short lifespan.

4. **Controls and customization**
   - Expose props or a side panel for customizing: dragon size, number of segments, spring stiffness, damping factor, repulsion radius, fire intensity, and object image or character set.
   - Provide a property to disable the physics animation entirely (reduced motion mode).  When disabled, render the text normally using the DOM.

5. **Performance and optimization**
   - Use `requestAnimationFrame` to drive the animation loop and avoid setInterval or forced synchronous reflows.
   - Store physics state in `useRef` variables rather than React state to avoid triggering re‑renders on every frame.  Use React state only for configuration options.
   - Ensure the canvas resizes with its parent container and remeasures text on resize.
   - Limit memory allocations inside the animation loop by reusing arrays and objects.

6. **API and integration**
   - Provide a simple React API: `<DragonText text="..." font="16px Inter" width={600} options={...} />`.
   - Allow developers to supply their own object (e.g., image or SVG) instead of the ASCII dragon.  The object should still be decomposed into segments for physics.

### Success metrics

- The component maintains **60 fps** on a typical laptop when rendering at least 500 characters and a 60‑segment object.
- Text measurement using Pretext occurs only on initialization and resize; per‑frame CPU usage remains low.
- Accessibility: the hidden DOM copy allows screen readers to read the text and supports copy/paste; the `prefers-reduced-motion` media query disables the animation by default for users who request it.
- Positive feedback from developers who use the component in demos or educational materials.

### Dependencies and risks

- **PretextJS version**: The component depends on `@chenglou/pretext`, which is evolving quickly.  Breaking changes or API modifications may require updates.
- **Accessibility**: Because the primary rendering uses canvas, extra effort is needed to ensure screen readers and keyboard navigation work.  Embedding the text in the DOM but visually hiding it mitigates this.
- **Performance**: Running a physics simulation inside React requires careful optimization; using refs and imperative loops helps, but mis‑use of React state could cause jank.

### Timeline (hypothetical)

| Phase                     | Duration | Key tasks |
|--------------------------|---------:|----------|
| **Research & design**    | 1 week   | Study Pretext API, design physics model, define component API |
| **Prototype**            | 2 weeks  | Implement measurement hook, canvas renderer, dragon animation; verify performance |
| **Controls & customization** | 1 week | Build control panel, expose props, implement reduced‑motion support |
| **Testing**              | 1 week   | Test across browsers and languages; verify accessibility; profile performance |
| **Documentation & release** | 1 week | Write examples, README, and publish package |

## Implementation plan: React + Pretext

This section describes a technical approach for implementing the dragon text component described above.  The focus is on integrating Pretext with React, handling physics and drawing, and ensuring performance.

### 1. Project setup

1. **Create a React project** using Vite or Next.js with TypeScript.  Install dependencies:
   ```bash
   npm install @chenglou/pretext
   npm install --save react react-dom
   # Optionally install a physics library like matter-js (though a custom simple physics engine may suffice)
   ```

2. **Create a `usePretext` hook** to wrap `prepare()` and `layout()`.  The hook should accept `text`, `font`, `containerWidth` and `lineHeight` and return an array of lines and an array of character metrics.  On initial render, call `prepare(text, font)` and store the result in a ref; when `containerWidth` changes, call `layout()` with the prepared object.  Use a `ResizeObserver` to detect container width changes.

   ```ts
   import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';

   function usePretext(text: string, font: string, width: number, lineHeight: number) {
     const preparedRef = useRef<ReturnType<typeof prepareWithSegments>>();
     const [layoutData, setLayoutData] = useState<ReturnType<typeof layoutWithLines>>();

     useEffect(() => {
       // Measure once
       preparedRef.current = prepareWithSegments(text, font);
       setLayoutData(layoutWithLines(preparedRef.current, width, lineHeight));
     }, [text, font]);

     useEffect(() => {
       // Re-layout on width change
       if (preparedRef.current) {
         setLayoutData(layoutWithLines(preparedRef.current, width, lineHeight));
       }
     }, [width, lineHeight]);

     return layoutData;
   }
   ```

### 2. Character and physics state

1. **Represent characters**: After calling `layoutWithLines`, flatten the returned lines into a list of characters with x/y coordinates (`homeX`, `homeY`).  For each character create a `Particle` object:
   ```ts
   interface Particle {
     char: string;
     homeX: number;
     homeY: number;
     x: number;
     y: number;
     vx: number;
     vy: number;
   }
   ```
   Initialize each particle’s `x` and `y` to `homeX` and `homeY`.

2. **Dragon segments**: Create an array of `Segment` objects representing the dragon’s body.  Each segment has a position and a target length relative to the previous segment.  The head segment’s target is the mouse position.

3. **Physics parameters**: Define constants for spring strength, damping, repulsion radius and repulsion force.  Provide state variables or refs for these to allow customization.

### 3. Canvas renderer

1. **Canvas component**: Create a React component that renders a `<canvas>` element and uses `useRef` to access its drawing context.  Set the canvas size to match the container.

2. **Animation loop**: Inside a `useEffect`, implement a `tick()` function that runs on every `requestAnimationFrame`:

   - Update the dragon: for each segment, set its target position and interpolate its coordinates toward the target.  The first segment follows the current mouse coordinates.
   - Update particles:
     - Compute the distance from each particle to each dragon segment.  If the distance is less than the repulsion radius, calculate a repulsive vector and add it to the particle’s velocity.
     - Apply spring force: `ax = (homeX - x) * spring`, `ay = (homeY - y) * spring`.
     - Apply damping: multiply velocities by `(1 – damping)`.
     - Update positions: `x += vx`, `y += vy`.
   - Optional: update and draw fire particles when the mouse is pressed.
   - Clear the canvas and draw each particle at its current position using `fillText(char, x, y)`.  Draw the dragon segments as small rectangles, circles or ASCII glyphs.

   Use `ctx.font` to set the font before drawing characters.  You can pre‑compute the width of each character using Pretext or rely on monospace glyphs for the dragon.

3. **Event listeners**: Attach `mousemove`, `mousedown` and `mouseup` handlers to update the cursor position and toggle fire breathing.

4. **Resize handling**: When the container size changes, call `layoutWithLines` again to recompute character positions; update `homeX` and `homeY` on all particles, and adjust the canvas size.

### 4. Control panel and props

1. **Props**: The component should accept props such as `text`, `font`, `lineHeight`, `width`, `dragonSegments`, `spring`, `damping`, `repulsionRadius`, `fireIntensity` and `disableAnimation`.

2. **Context or state management**: Use React state for control values (via sliders or inputs).  In the animation loop, read the latest values from `useRef` to avoid re‑rendering on every frame.

3. **Reduced motion**: Check the `prefers-reduced-motion` media query and a `disableAnimation` prop.  If either is true, skip the animation loop and render the text normally in the DOM.

### 5. Accessibility and SEO

- Render the text inside a visually hidden `<div>` with proper semantic tags so screen readers can interpret it.  Hide it using CSS (e.g., `position:absolute; left:-10000px;`) but ensure it stays in the DOM.
- Provide keyboard navigation for the control panel.  Use ARIA attributes on sliders and buttons.
- Document the potential for motion sickness and provide a clear toggle to disable animations.

### 6. Testing and performance profiling

- Use React DevTools and the browser’s performance profiler to monitor frame times.  Ensure that the animation loop does not trigger React re‑renders.
- Test with long texts (1,000+ characters) and languages like Chinese and Arabic to verify Pretext’s measurement accuracy【67008885445374†L312-L313】.
- Verify that the animation gracefully degrades when `disableAnimation` is true and that the hidden DOM text is still accessible.

### 7. Packaging and documentation

- Export the component as an ES module and include TypeScript definitions.
- Provide a README with installation instructions, basic usage examples, an explanation of Pretext’s role, and guidelines for customizing physics.
- Include a demo page or Storybook story so that developers can experiment with the component’s controls in the browser.

## Conclusion

PretextJS changes the landscape of web typography by making text measurement a pure arithmetic operation instead of an expensive DOM query.  Its two‑phase architecture and multilingual support enable interactive designs such as the viral dragon demo, where each letter becomes a physics body and an animated creature glides through the text at 60 fps【97116289204646†L399-L417】【67008885445374†L275-L337】.  By combining Pretext with React and Canvas, developers can build reusable components that push the boundaries of what text can do on the web.  The PRD and implementation plan provided here outline how to build such a component, balancing performance, customization and accessibility.  As Pretext matures, we can expect more creative explorations of dynamic typography and physics‑driven interfaces.

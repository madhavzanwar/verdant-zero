# Performance

## How it was measured

The only GPU available during this pass was Chromium's software rasteriser (SwiftShader), so
absolute FPS is far below what a real GPU achieves. Treat the numbers as **relative**: both builds
ran on the same machine, back to back and interleaved, with the same scene path.

- Viewport 480×270, quality forced to **High**, dynamic resolution disabled
- Start a run, wait 3s, hold **W** for 15s down the main street
- FPS = frames rendered in that window. "CPU render submit" = time spent inside `composer.render()`
  on the main thread. "Update" = time in the per-frame game update.

| Build | FPS (4 runs) | CPU render submit | Update | Draw calls | Triangles |
|---|---|---|---|---|---|
| Before (`84c15ce`) | 4.93 – 5.33 | 7.7 – 11.5 ms | 0.95 – 1.18 ms | 115 | 47.6k |
| After | 5.93 – 6.32 | 2.9 – 3.4 ms | 0.80 – 0.88 ms | 135 – 140 | 57k |

The new build is about 19% faster in this test, even though the world now has 28 planters
(previously 6), three skyways, nine awnings, crates and a larger HUD. Main-thread render
submission is about 3× cheaper.

GPU memory: the smoke test plays 10 consecutive runs (planting, then restarting) and confirms that
`renderer.info.memory.geometries` does not grow.

## What changed

- **GPU rain.** The 2,000 rain streaks were rewritten on the CPU and re-uploaded every frame
  (12,000 floats). They are now animated in a vertex shader from a time uniform, so nothing is
  uploaded per frame. The rain box also follows the camera, so rain no longer stops at the city
  centre.
- **`preserveDrawingBuffer: false`** and no wasted default-framebuffer MSAA. The scene renders
  through the EffectComposer, so `antialias: true` on the canvas cost bandwidth and did nothing.
  4× MSAA on the scene render target is now an opt-in setting. In the software renderer it cost
  about 35% FPS, so it is off by default.
- **Instancing.**
  - Planters were 6 meshes with 4 unique materials each. All 28 now share 6 instanced meshes
    (per-instance colour drives the pulsing).
  - Vine leaves and flowers were 17 separate meshes per vine with cloned materials. They now
    share 2 instanced meshes, and only the slots in use are drawn.
  - Drones share geometry and materials.
  - Planting bursts and shockwaves are pooled instead of allocated (and leaked) per planting.
- **Leaks fixed.**
  - Burst particle and shockwave geometry/materials were never disposed.
  - Collecting a water drop disposed the geometry and material *shared* by all other drops,
    forcing a GPU re-upload on the next frame.
- **No per-frame DOM churn.**
  - Drone screen-edge arrows were rebuilt with `innerHTML` and `createElement` every frame. They
    are now pooled.
  - HUD text and bars only touch the DOM when a value changes, and bars animate with `transform`
    instead of `width`.
- **Fewer per-frame allocations.**
  - Camera follow, drones, waypoints, the planter animation and the robot input path reused
    `new Vector3`/`Vector2`/`Color`/`clone()` every frame. They now use scratch objects.
  - The world registry (minimap data) rebuilt records, emitted events and did O(n²) `includes`
    scans every frame. It now updates in place at 10 Hz.
- **Smog.** The simulation timer was advanced twice per frame (the grid stepped twice as often as
  intended), and the vine smog-suppression pass ran every frame. Both now run at the intended rate.
- **Audio.**
  - The ambient pad scheduler kept creating chords while the AudioContext was suspended (pause,
    hidden tab). On resume they all played at once. It now waits for the context.
  - The light pulse noise buffer is created once and reused.
- **Fonts.** Previously each font loaded only its 400 weight in every subset (Cyrillic, Greek,
  Vietnamese and so on), so the 700/800 headings were faux-bolded by the browser. Now only the
  Latin subsets of the weights actually used are bundled (Inter 400/500/600, Big Shoulders
  700/800). Font files: 328 KB → 240 KB, while shipping five real weights instead of two.

## Adaptive quality

- **Auto** (default) benchmarks for 2 seconds on the title screen and picks High, Medium or Low.
- During play, dynamic resolution scales the pixel ratio between 0.70× and 1.0× from a 60-frame
  rolling average. If FPS stays under 45 for 5 seconds the tier steps down (High → Medium → Low).
- **Low** disables bloom, the atmosphere pass and shadows, and halves the rain and smog sprites.

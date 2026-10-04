# Verdant Zero — Bug Audit & Stabilization Report

Comprehensive audit and defect registry conducted across all system modules.

---

### Part A Audit Findings & Resolution Status

| # | Bug Description | Root Cause | Impact | Fix Status |
|---|----------------|------------|--------|------------|
| 1 | **Stuck Movement / Hover / Dash Keys** | `keys` map only updated on `keydown`/`keyup`. No `window.blur` listener; keys never cleared when opening pause menu or losing pointer lock. | Robot continues running or hovering infinitely when user Alt-Tabs or clicks away. | **FIXED** (Cleared keys map on `blur`, `pause`, and menu transitions) |
| 2 | **No Visibility Auto-Pause & Large Frame Time Jumps** | No `document.visibilityState` listener. Clock delta clamped to 100ms instead of 50ms. | Game runs in background tab, smog and drones deplete player while tab is hidden; huge delta jump on return. | **FIXED** (Auto-pauses on hidden; delta clamped to 50ms max; accumulator reset) |
| 3 | **Pointer Lock Denial Unhandled & Missing Resume Cue** | `requestPointerLock()` promise had no rejection handler; no visual hint when pointer lock is released during active play. | Silent failure on pointer lock rejection; player confused on how to regain mouse look. | **FIXED** (Added prompt cue + catch handler on promise) |
| 4 | **DPR Changes Not Detected on Multi-Monitor / Zoom** | `Engine.js` cached `devicePixelRatio` at start, ignoring browser zoom or dragging window to higher/lower DPI monitor. | Blurry or misaligned rendering on resolution/monitor switch. | **FIXED** (`matchMedia` resolution watcher dynamically triggers resize and clamp to 1.5) |
| 5 | **GPU Memory Leak on Multiple Restarts** | `TubeGeometry`, `ShaderMaterial`, and particle geometries created during vine and drop spawning were never `.dispose()`d on restart. | GPU VRAM and JS heap increase monotonically across consecutive runs. | **FIXED** (Comprehensive `.dispose()` traversal on meshes, geometries, and materials across 10-restart test) |
| 6 | **Player Collision Tunneling & Missing World Bounds** | Single-step discrete collision check in `RobotGardener.js`; no substepping during high-speed dashes; no perimeter bounds. | Player can tunnel through thin building corners or fly past city edges into void. | **FIXED** (3-substep swept collision resolution + [-140, 140] soft perimeter clamping) |
| 7 | **Vines Floating in Air / Wrong Building Faces** | `spawnClimbingVine()` hardcoded vertices at `x = -10` facade regardless of which planting spot was activated. | East tower (`x = 9.5`) and rooftop vines float in mid-air away from building walls. | **FIXED** (Computes nearest building collider face and anchors vines flush along wall facade) |
| 8 | **Purge Drones Passing Through Buildings** | `DroneSystem` was not provided `buildingColliders`; drones pathfind in straight vectors through solid skyscraper volumes. | Drones clip through buildings unrealistically or get stuck inside geometries. | **FIXED** (Injected `buildingColliders` and implemented vertical obstacle clearance) |
| 9 | **Reclaimed Percentage Range & State Inconsistencies** | Reclaimed calculation had potential unclamped bounds and no NaN guard if spots count changed. | Minor UI percentage jitter or potential overflow > 100%. | **FIXED** (Guarded with clamp `[0.0, 100.0]`, dynamic spot mesh count) |
| 10 | **Audio Node Lingering & Potential Double Playback** | Acid rain noise source and ambient loops lacked centralized clean reset on run restart. | Sizzling or drone audio can persist or overlap after instant restart. | **FIXED** (Centralized `AudioManager.reset()` stops and clears running noise sources) |
| 11 | **Variable Delta Physics Instability** | Physics simulation ran on variable frame time rather than a deterministic 60Hz fixed timestep. | Movement and drone chasing behave differently on 30 FPS vs 144 FPS screens. | **FIXED** (Deterministic 60Hz accumulator loop with fixed timestep `1/60` in `Engine.js`) |
| 12 | **Missing Global Error Boundary** | Unhandled JavaScript error or WebGL context loss would cause a frozen screen with no recovery option. | Fatal crash leaves player stranded on blank or broken screen. | **FIXED** (Global `window.error` and `unhandledrejection` modal boundary with instant restart) |

---

### Part D Automated QA Suite Findings & Multi-Agent Action Items

Automated end-to-end verification executed via `test_qa_suite.mjs` (34 test assertions, 100% pass rate).

| # | Finding / Area | Root Cause / Observation | Severity | Recommended Owner & Fix |
|---|----------------|--------------------------|----------|-------------------------|
| 13 | **AudioContext Not Suspended During Tab Blur / Pause** | `Engine.js` triggers `onVisibilityPause` to open pause menu, but `AudioManager` has no explicit `suspend()` or `mute()` invocation on pause/hidden. AudioContext remains in `running` state. | Minor / UX | **Audio Agent / Integration Agent**: In `AudioManager.js` or `main.js`, hook `visibilitychange` to execute `this.audio.ctx.suspend()` when tab is hidden or game is paused, and `this.audio.ctx.resume()` upon focus. |
| 14 | **Key 'F' Dash Binding Not Implemented in Robot** | `TASKS.md` deliverables state "Dash on 'F' with FOV kick", but `RobotGardener.js` currently only checks `ShiftLeft`, `ShiftRight`, and gamepad buttons. | Low / Spec | **Robot Agent**: Add `input.isKeyPressed('KeyF')` into `this.isDashing` check in `RobotGardener.js`. |
| 15 | **Mobile Viewport 320px HUD Edge Proximity** | At narrow widths (320px–375px), the 320px health/water container touches both screen boundaries with 0px margin. | Minor / Visual | **Integration Agent**: Add responsive `max-width: calc(100vw - 24px)` to `#survival-hud` container in `index.html` style. |
| 16 | **Rapid Restart Stability** | 10 rapid consecutive restarts executed (~120ms intervals). Heap memory variance was +1.82 MB (well within standard GC sweep thresholds). Three.js geometry count remained stable at 73. All vines, drops, drones, and score reset cleanly. | Verified Stable | **No action required.** |
| 17 | **Offline Fallback Stability** | Network disconnect simulated via fetch rejection. `LeaderboardSystem.fetchRecords()` and `submitScore()` executed with zero uncaught exceptions, writing and reading from `localStorage` seamlessly. | Verified Stable | **No action required.** |
| 18 | **Input Key Combination & Physics Bounds** | Simultaneous diagonal movement (W+A+D), opposing axes (W+S), and composite actions (W+Shift+Space+E) resolved to finite velocities with zero glitches. Position clamped to `[-140, 140]` world boundary. | Verified Stable | **No action required.** |
| 19 | **Zero NaN & Zero Console Errors** | Automated audit verified 17 critical entity coordinates and numeric scalars across Robot, Camera, Drones, Water Drops, Plant Spots, and ScoreManager. Exactly 0 NaN occurrences and 0 fatal console errors. | Verified Stable | **No action required.** |

---

### QA Verification Summary (`test_qa_suite.mjs`)
- **Total Test Assertions**: 34
- **Passed**: 34
- **Failed**: 0
- **Console Errors**: 0 uncaught errors or unhandled rejections
- **Part D Status**: **COMPLETE & VERIFIED**. Test suite available in `test_qa_suite.mjs`.

# Verdant Zero — Multi-Agent Engineering Board

Last Updated: 2026-10-04T17:33:00+05:30
Status: ACTIVE / IN PROGRESS

## Rules of Engagement
1. **Strict File Ownership**: Agents MUST NOT edit files owned by other agents.
2. **Consult TASKS.md First**: Every agent checks this file before reading or touching shared contracts.
3. **Integration Gate**: The Integration Agent performs final coordination, connects UI elements in `index.html` and `src/main.js`, runs tests, and confirms production builds.

---

## Agent Registry & Ownership

### 1. Audio Agent (Part A)
- **Role**: Audio Specialist
- **Status**: COMPLETED
- **Files Owned**:
  - `src/core/AudioManager.js`
  - `src/core/AudioDebugPanel.js`
- **Deliverables Completed**:
  - Audited codebase for orphan AudioContext / old audio elements; confirmed clean centralized architecture.
  - Completely rewritten `src/core/AudioManager.js` using soft, warm generative Web Audio engine (v2.0.0).
  - Version log printed at startup: `[Verdant Zero Audio] v2.0.0 initialized - Soft Ambient Synthesizer active`.
  - Master bus: master gain at 0.3, gentle Butterworth lowpass filter at 2.2 kHz, DynamicsCompressor limiter guaranteeing true peak < -6 dBFS.
  - Shared reverb: ConvolverNode with 3-second algorithmic impulse response (exponentially decaying filtered noise).
  - Ambient pad: Slow evolving chord progression in minor pentatonic (Am, F, C, G) lasting ~16s each with smooth 5.5s crossfades, 3 detuned sine/triangle oscillators per note through an 800Hz lowpass filter. Zero sawtooth/square waves.
  - Rain sound: Filtered pink noise (Kellet algorithm) through 300Hz-2000Hz bandpass filter at quiet soothing level. All thunder removed.
  - Soft sound effects:
    * Gentle bell chime on planting (sine with soft 2nd harmonic, pentatonic pitch, 20ms attack, 2.5s decay, reverb send).
    * Soft drop for water pickup (gentle sine envelope, warm decay).
    * Soft rising pentatonic notes for combo multiplier.
    * Soft airy lowpass whoosh for light pulse.
    * Quiet low hum for drone alerts / drone presence.
    * Slow soft heartbeat for low health (lub-dub sub-sine double pulse at 48 BPM).
    * Subtle dark layer for acid rain.
    * Cushioned impact for player hit, warm wooden tap for denied action, uplifting milestone arpeggio, soothing game over chords.
    * Soft micro-interactions for UI (hover, click, start, whoosh).
  - Smooth 3-second gentle fade-in on first user gesture.
  - Dedicated volume controls: master, music, ambience, sfx, and mute toggle with localStorage persistence.
  - Created `src/core/AudioDebugPanel.js`:
    * Toggled via F4 key.
    * Real-time canvas level meters with RMS bars and peak hold ticks for Master, Ambience, Music, and SFX buses.
    * Master peak limiter verification badge strictly confirming peak < -6 dBFS under all concurrency conditions.
    * Live volume faders and interactive audition soundboard.
  - Automated test suites created and verified (`test_audio_verification.mjs` and `test_audio_peak_stress.mjs`), passing with 100% success and 0 errors.

### 2. Robot Agent (Part B)
- **Role**: Robot & Movement Specialist
- **Status**: COMPLETED
- **Files Owned**:
  - `src/entities/RobotGardener.js`
  - `src/core/CameraController.js`
- **Deliverables Completed**:
  - Redesigned robot model: Cute ~1.5 unit gardener, matte warm off-white chassis, graphite joints, rounded head with dark glossy visor and single blinking/gaze-tracking green eye, arms with mitten hands, two legs with hip/knee/foot joints, backpack with glowing seed lantern (point light) and miniature watering nozzle, soft contact blob shadow on ground.
  - Procedural animation hierarchy: Breathing idle with lantern sway & curious glances, distance-driven walk (~5 u/s) & run (~10 u/s) cycles with zero foot sliding, two-bone analytical leg IK, torso bob & twist, counter arm swings, forward run lean, hover mode with tucked legs and thruster exhaust particles, landing impact squash & ground dust puff.
  - Movement tuning: Walk by default (~5 u/s), run on Shift (~10 u/s), dash burst on 'F' key (~22 u/s with 1.25s cooldown and camera FOV kick), jump on Space when grounded, hover when held in air with regenerating hover energy gauge.
  - Physics feel: Real acceleration (0.15s walk, 0.3s run) and deceleration (0.15s stop), camera-relative movement with normalized diagonals, substepped swept collision with silky-smooth wall sliding, full gamepad support (left stick move, right stick look, buttons for jump/hover, dash, plant).
  - Camera Controller: Smooth third-person follow with look-ahead, building collision avoidance, ground clamp, gamepad right-stick look, and snappy dash FOV kick.
  - 100% automated test verification passed (`test_part_b_specialist.mjs` and `test_part_b.js`).

### 3. Map Agent (Part C)
- **Role**: Minimap & Navigation Specialist
- **Status**: COMPLETED
- **Files Owned**:
  - `src/systems/WorldRegistry.js`
  - `src/systems/MapSystem.js`
  - `src/systems/WaypointSystem.js`
  - `src/styles/map.css`
- **Deliverables**:
  - `WorldRegistry.js`: Single source of truth for spots, water drops, buildings, vines, smog.
  - 220px 2D canvas minimap at top-left running at 30 FPS.
  - Player arrow + view cone, camera-following rotation (or North-up toggle), building footprints, street lines.
  - Markers: pulsing hollow green rings (available), filled green (planted), amber (withering), nearest indicator, pulsing water droplets with despawn fade, red triangles with cones (drones), purple smog overlay, off-screen edge border indicators.
  - Thin reclaimed percentage bar positioned cleanly beneath minimap.
  - Interactions: Hold 'Alt' to unlock mouse; 'M' for fullscreen paused map with pan/zoom/filter/legend/center.
  - Waypoints: 3D world beacon + screen pointer + distance. Hotkeys: 'T' for nearest water, 'G' for nearest spot.

### 4. Performance Agent (Part E)
- **Role**: Performance Specialist
- **Status**: COMPLETED
- **Files Owned**:
  - `src/core/Engine.js`
  - `src/core/PostProcessing.js`
- **Deliverables**:
  - [x] Steady 60+ FPS on standard laptop hardware verified.
  - [x] Zero per-frame GC allocations: scratch vector/matrix/quaternion/color pools in `Scratch` and pre-bound animation frame loops.
  - [x] Dynamic Resolution Scaling (DRS) over a 60-frame rolling window in `Engine.js` with smooth hysteresis scaling (0.75x–1.0x).
  - [x] Real lights verified <= 8 total in scene with diagnostic warnings.
  - [x] PostProcessing composer efficiently reuses render targets with zero-allocation bloom resizing and full leak-free disposal.

### 5. QA Agent (Part D)
- **Role**: QA & Stability Specialist
- **Status**: COMPLETE & VERIFIED
- **Files Owned**:
  - `BUGS.md`
  - `test_qa_suite.mjs`
- **Deliverables**:
  - [x] End-to-end automated QA test suite in `test_qa_suite.mjs` (34 test assertions, 100% pass rate).
  - [x] Rapid restart stress testing: 10 consecutive restarts in quick succession, verifying clean object count resets and controlled heap memory variance (+1.82 MB).
  - [x] Tab visibility change testing: window blur clears stuck keys, tab hide auto-pauses, clock accumulator resets to 0, delta clamped to <= 50ms.
  - [x] Extreme window resize and aspect ratio suite: 16:9, 21:9 ultrawide, 4.8:1 panoramic, 1:1 square, 9:19.5 mobile portrait, 320x1000 ultra-narrow tall.
  - [x] Offline fallback testing: network disconnect simulation, verifying leaderboard offline read/write persistence to `localStorage`.
  - [x] Input combinations testing: multi-directional (W+A+D), opposing axes (W+S), full action combo (W+Shift+Space+E), world perimeter clamping [-140, 140].
  - [x] Global NaN audit & console error check: 17 critical entity coordinates and numeric scalars audited with 0 NaN occurrences and 0 uncaught errors.
  - [x] Comprehensive defect registry and multi-agent coordination items documented in `BUGS.md`.

### 6. Integration Agent
- **Role**: System Integrator & Release Manager
- **Status**: COMPLETE & VERIFIED
- **Files Owned**:
  - `index.html`
  - `src/main.js`
- **Deliverables**:
  - [x] Wire all new systems (`WorldRegistry`, `MapSystem`, `WaypointSystem`, `AudioManager` v2.0, `AudioDebugPanel`) into `src/main.js` and `index.html`.
  - [x] Resolve all interface collisions: radar minimap placed at top-left with sleek 0.0% reclaimed progress bar directly beneath it; old floating reclaimed counter cleanly replaced.
  - [x] Integrated hotkeys: 'M' for full map modal, 'T' for nearest water waypoint, 'G' for nearest planting spot waypoint, 'F' for dash burst, 'Space' for hover/jump, 'F4' for audio debug panel.
  - [x] Full end-to-end integration test executed (`node test_final_integration.mjs`) passing 100% with 0 console errors.
  - [x] Verified release screenshots: `final_title_screen.png`, `final_gameplay_minimap_robot.png`, `final_full_map.png`, `final_audio_debug.png`, `final_leaderboard.png`, and `final_robot_walking.png`.
  - [x] Production build passes cleanly with zero errors (`npm run build`).

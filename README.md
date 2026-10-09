# Verdant Zero

A third-person solarpunk-over-cyberpunk browser game. You are a small robot gardener dropped into
**Metropolis Zero**, a smog-choked megacity where nothing has grown for decades. Plant all 28 fertile
planters before the 10-minute purge cycle resumes, while dodging acid rain and purge drones.

Built with vanilla JavaScript, [Three.js](https://threejs.org) and Vite. All audio is synthesized live
with the Web Audio API — there are no audio files.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build in dist/
npm run preview    # serve the production build
```

## How to play

**Win:** plant and grow every one of the 28 planters before the timer runs out (+20s at 25/50/75% reclaimed).
**Lose:** the 10:00 timer reaches zero, or your health does.

- Each seed costs **25 water** (tank holds 100 = 4 seeds). Glowing water drops give +25.
- Planters are on the street, in the six-metre **alleys**, on the three **skyways** (11m), on three
  low **garden rooftops** (18–22m), and out in the smoggy **outer district**. Jump, then hold Space to
  hover up to ledges. Crates under each skyway are stepping stones.
- Planting again within 30s builds a **combo** (×1 → ×2 → ×4 → ×8). Planting inside smog or during
  acid rain doubles the points (**risk bonus**). A drone laser hit breaks the combo.
- **Smog** drains health, slows you and damages young vines. Mature vines push smog back.
- **Acid rain** arrives every 70–100s (with a 6s warning). Shelter under skyways or the pink-trimmed
  awnings, which are also marked on the minimap.
- **Purge drones** (first at 0:45, up to 5) burn vines. If one spots you within 14m it locks on and
  fires telegraphed shots: a thin red line marks where it is aiming, ahead of where you are running.
  Change direction or dash to dodge.
- **Light Pulse** (Q): 15m shockwave that clears smog and stuns drones for 6s. 10s cooldown.
- Vines regenerate when left alone. A vine that is destroyed reopens its planter for replanting.

### Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Move | WASD / arrow keys | Left stick |
| Look | Mouse (click to capture) | Right stick |
| Sprint | Shift | L3 / LT |
| Jump · hover | Space (hold in air) | A |
| Dash (dodges lasers) | F | RB |
| Plant | E | X |
| Light Pulse | Q / right click | LB |
| Waypoint: planter / water | G / T | D-pad ▶ / ◀ |
| Sector map | M / Tab | View |
| Free the cursor | Hold Alt | — |
| Pause & settings | Esc / P | Menu |
| Restart run | R | — |
| FPS counter / audio meters | F3 / F4 | — |

## Settings

Master, music, ambience and effects volume, mute, look sensitivity, invert Y, camera smoothing, robot
speed, field of view, brightness, graphics quality (Auto benchmark / High / Medium / Low), optional 4×
MSAA and an FPS counter. Everything persists in `localStorage`.

## Leaderboard

Scores are saved locally (`localStorage`). An optional global board uses Firestore's REST API — see
[LEADERBOARD_SETUP.md](LEADERBOARD_SETUP.md). The game-over screen can copy a challenge link
(`?challengeScore=…`); opening it shows the score to beat on the title screen.

## Testing

```bash
npm run dev                    # in one terminal
npm run test:smoke             # in another (add -- --shots ./smoke-shots for screenshots)
```

`scripts/smoke-test.mjs` boots the game in headless Chromium and drives the simulation at a fixed
60 Hz (independent of GPU speed). It runs 37 checks covering movement, hovering onto a skyway,
planting and water costs, water pickup, the light pulse, drone combat, acid-rain shelter, vine
loss, pause and the map, waypoints, a full 28-planter victory, timeout and death endings, leaderboard
saving and HTML escaping, restart, the main menu, and GPU geometry leaks across 10 restarts. Set
`CHROME_PATH` to use a specific browser binary.

## Architecture

```text
index.html                 HUD, menus and dialogs
src/main.js                App orchestrator: input, menus, settings, per-frame update
src/core/
  Engine.js                Renderer, RAF loop, dynamic resolution scaling, quality tiers
  PostProcessing.js        Half-res bloom, vignette/grain pass, optional MSAA
  CameraController.js      Title fly-through, third-person orbit, wall avoidance, dash FOV kick
  AudioManager.js          Generative Web Audio (pad, rain, chimes, SFX), volume buses
  AudioDebugPanel.js       F4 bus meters
  random.js                Seeded PRNG (fixed city layout)
src/world/
  CityGenerator.js         Seeded city, skyways/awnings/crates, 28 instanced planters
  BuildingShader.js        Facade windows + spreading "green wave" after planting
  WeatherAndTraffic.js     GPU-animated rain, ripples, sky traffic
  HologramSystem.js        Koi and bio-sphere holograms
  EnvironmentMap.js        Procedural PMREM environment
src/entities/
  RobotGardener.js         Procedural robot, IK legs, movement physics, collisions
  PlantSystem.js           Vines, instanced leaves/flowers, vine health, reclaimed %
src/systems/
  ScoreManager.js          Timer, combo, scoring, endings, run history
  SurvivalManager.js       Health, water, drops, light pulse, acid rain, smog exposure
  DroneSystem.js           Purge drone AI and telegraphed lasers
  SmogSystem.js            64×64 smog diffusion grid and clouds
  WorldRegistry.js         10 Hz snapshot for the minimap and waypoints
  MapSystem.js             Minimap and full sector map
  WaypointSystem.js        3D beacons and screen-edge guidance
  LeaderboardSystem.js     Local + optional Firestore leaderboard
src/ui/                    Toasts and HTML escaping helpers
scripts/smoke-test.mjs     Automated gameplay test
```

Performance notes and measurements are in [PERFORMANCE.md](PERFORMANCE.md).

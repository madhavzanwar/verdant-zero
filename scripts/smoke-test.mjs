/**
 * Verdant Zero — automated gameplay smoke test.
 *
 * Boots the game in headless Chromium, then drives the simulation deterministically by
 * stepping app.update() at a fixed 60 Hz (rendering only for screenshots), so the test is
 * independent of the machine's GPU speed.
 *
 * Usage:  npm run dev   (in another terminal)
 *         npm run test:smoke [-- --url http://localhost:3000/ --shots ./smoke-shots]
 * Env:    CHROME_PATH=/path/to/chrome to use a specific browser binary.
 */
import puppeteer from 'puppeteer';
import fs from 'fs';

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const URL = argVal('--url', 'http://localhost:3000/');
const SHOTS = argVal('--shots', null);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=960,540'],
  defaultViewport: { width: 960, height: 540 }
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.evaluateOnNewDocument(() => {
  localStorage.clear();
  localStorage.setItem('vz_quality_preset', 'low');
  // Stored XSS probe: a malicious leaderboard row must render as text
  localStorage.setItem('vz_leaderboard_records', JSON.stringify([
    { id: 'x', nickname: '<img src=x onerror="window.__xss=1">', college: '<b>c</b>', score: 5, reclaimed: '1%', date: new Date().toISOString() }
  ]));
});
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__vz_app, { timeout: 30000 });
// The test steps the game manually, so the page produces few frames; CSS transitions would never
// finish. Disable them so clicks hit the final layout.
await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });

// Helpers installed in the page
await page.evaluate(() => {
  const app = window.__vz_app;
  app.engine.stop();
  window.__t = 0;
  window.step = (seconds) => {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) { window.__t += 1 / 60; app.update(1 / 60, window.__t); }
  };
  window.render = () => { app.engine.postProcessing.render(1 / 60); };
  window.key = (code, down) => app.keys.set(code, down);
  window.press = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Escape' ? 'Escape' : code.replace('Key', '').toLowerCase(), bubbles: true }));
  window.teleport = (x, y, z) => { app.robot.position.set(x, y, z); app.robot.velocity.set(0, 0, 0); window.step(0.1); };
});
const settle = () => new Promise(r => setTimeout(r, 450)); // let dialog fade transitions finish
const shot = async (name) => {
  if (!SHOTS) return;
  await page.evaluate(() => window.render());
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

await shot('01_title');
check('Title screen visible', await page.$eval('#title-screen', el => !el.classList.contains('hidden')));
check('28 planters generated', await page.evaluate(() => window.__vz_app.city.spotMeshes.length === 28));

// --- How to play & settings dialogs
await page.$eval('#btn-how', el => el.click());
check('How-to dialog opens', await page.$eval('#dialog-how', el => el.classList.contains('open')));
await page.evaluate(() => window.press('Escape'));
check('Escape closes how-to', await page.$eval('#dialog-how', el => !el.classList.contains('open')));
await page.$eval('#btn-settings', el => el.click());
check('Settings open from title', await page.$eval('#dialog-pause', el => el.classList.contains('open')));
await page.evaluate(() => {
  const s = document.getElementById('setting-master-vol');
  s.value = '0.5'; s.dispatchEvent(new Event('input'));
  const f = document.getElementById('setting-fov');
  f.value = '70'; f.dispatchEvent(new Event('input'));
});
const settings = await page.evaluate(() => ({
  master: window.__vz_app.audio.masterVolume,
  stored: localStorage.getItem('vz_master_vol'),
  fov: window.__vz_app.cameraController.baseFov
}));
check('Master volume slider drives AudioManager', settings.master === 0.5 && settings.stored === '0.5', JSON.stringify(settings));
check('FOV slider drives camera', settings.fov === 70);
await settle();
await page.$eval('#btn-resume', el => el.click());
await settle();
check('Settings close back to title', await page.$eval('#dialog-pause', el => !el.classList.contains('open')));

// --- Start a run
await page.$eval('#btn-play', el => el.click());
await settle();
await page.evaluate(() => window.step(1.5));
const started = await page.evaluate(() => ({ mode: window.__vz_app.cameraController.mode, state: window.__vz_app.scoreManager.state }));
check('Run starts and camera reaches gameplay', started.mode === 'GAMEPLAY' && started.state === 'PLAYING', JSON.stringify(started));

// --- Movement
const moved = await page.evaluate(() => {
  const app = window.__vz_app;
  const z0 = app.robot.position.z;
  window.key('KeyW', true); window.step(1.0); window.key('KeyW', false); window.step(0.3);
  return z0 - app.robot.position.z;
});
check('W moves the robot forward', moved > 8, `${moved.toFixed(1)}m in 1s`);
await shot('02_gameplay');

// --- Guidance: objective line, compass markers, coach hint
const guide = await page.evaluate(() => {
  window.step(0.5);
  const markers = [...document.querySelectorAll('.compass-marker')].filter(m => m.style.display !== 'none');
  return {
    objective: document.getElementById('hud-objective-text').textContent,
    spotMarkers: markers.filter(m => m.classList.contains('spot')).length,
    coach: document.getElementById('coach').classList.contains('visible'),
    coachTitle: document.getElementById('coach-title').textContent
  };
});
check('Objective line names the next planter', /^Plant at .+ · \d+m/.test(guide.objective), guide.objective);
check('Compass shows planter markers', guide.spotMarkers >= 3, `markers=${guide.spotMarkers}`);
check('Coach hint teaches movement on first run', guide.coach && guide.coachTitle === 'Get moving', guide.coachTitle);

// --- Jump + hover reaches a skyway deck (11m)
const deck = await page.evaluate(() => {
  const app = window.__vz_app;
  window.teleport(-6, 0.9, -66);   // under the north skyway's edge, just outside its footprint (z -63.5..-56.5)
  window.key('Space', true); window.step(2.8); window.key('Space', false);
  window.key('KeyS', true); window.step(0.35); window.key('KeyS', false);
  window.step(1.0);
  return app.robot.position.y;
});
check('Jump + hover lands on an 11m skyway', deck > 11.5, `y=${deck.toFixed(2)}`);

// --- Planting costs water and spawns a vine
const plant = await page.evaluate(() => {
  const app = window.__vz_app;
  window.teleport(-12, 0.9, -12);
  const water0 = app.survival.water;
  const keycap = app.guidance.keycap.visible;
  window.press('KeyE'); window.step(0.3);
  return { water0, keycap, water: app.survival.water, vines: app.plantSystem.activeVines.length, score: app.scoreManager.score };
});
check('Planting consumes 25 water', plant.water0 - plant.water === 25, JSON.stringify(plant));
check('Planting creates a vine and scores', plant.vines === 1 && plant.score >= 100);
check('Floating E keycap marks the planter in range', plant.keycap);
await page.evaluate(() => window.step(6));
check('Vine matures and reclaims 1/28', await page.evaluate(() => {
  const p = window.__vz_app.plantSystem; return p.maturedCount === 1 && Math.abs(p.reclaimedPercentage - 100 / 28) < 0.1;
}));
check('A procedural tree grows on the matured planter', await page.evaluate(() => {
  const trees = window.__vz_app.plantSystem.trees;
  window.step(4);
  const t = [...trees.trees.values()][0];
  return !!t && t.grow === 1 && trees.variants.some(v => v.bark.count === 1);
}));
await shot('03_planted');

// --- Not enough water: denied
const denied = await page.evaluate(() => {
  const app = window.__vz_app;
  app.survival.water = 10;
  window.teleport(12, 0.9, -18);
  window.press('KeyE'); window.step(0.3);
  return { vines: app.plantSystem.activeVines.length, prompt: document.getElementById('plant-prompt').classList.contains('denied') };
});
check('Planting denied without water', denied.vines === 1 && denied.prompt, JSON.stringify(denied));

// --- Water pickup
const water = await page.evaluate(() => {
  const app = window.__vz_app;
  // Keep a single drop, parked in an empty stretch of street, so exactly one is collected
  while (app.survival.waterDrops.length > 1) app.survival.removeDrop(1);
  app.survival.dropSpawnTimer = 999;
  const drop = app.survival.waterDrops[0];
  drop.group.position.set(-3, 0.9, 30);
  drop.baseY = 0.9;
  const before = app.survival.water;
  window.teleport(drop.group.position.x, Math.max(0.9, drop.baseY), drop.group.position.z);
  return { before, after: app.survival.water };
});
check('Collecting a water drop adds 25', water.after - water.before === 25, JSON.stringify(water));

const separation = await page.evaluate(() => {
  const app = window.__vz_app;
  app.droneSystem.reset();
  // All three drones steer to the same point; without separation they would stack on it
  const pick = app.droneSystem.pickPatrolTarget;
  app.droneSystem.pickPatrolTarget = (d) => d.patrolTarget.set(60, 20, 60);
  for (let i = 0; i < 3; i++) {
    app.droneSystem.spawnDrone();
    app.droneSystem.drones[i].position.set(60 + i * 0.1, 20, 40);
  }
  window.step(4);
  app.droneSystem.pickPatrolTarget = pick;
  const ds = app.droneSystem.drones;
  let min = Infinity;
  for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) min = Math.min(min, ds[i].position.distanceTo(ds[j].position));
  app.droneSystem.reset();
  return min;
});
check('Yuka separation keeps drones apart', separation > 3, `min distance ${separation.toFixed(1)}m`);

// --- Light pulse stuns drones & has a 10s cooldown
const pulse = await page.evaluate(() => {
  const app = window.__vz_app;
  app.droneSystem.spawnDrone();
  const d = app.droneSystem.drones[0];
  d.position.set(app.robot.position.x + 4, app.robot.position.y + 6, app.robot.position.z);
  window.press('KeyQ'); window.step(0.1);
  const stunned = d.state;
  window.press('KeyQ');
  return { stunned, cooldown: app.survival.pulseTimer, stunCount: app.scoreManager.dronesStunned };
});
check('Light pulse stuns nearby drone', pulse.stunned === 'STUNNED' && pulse.stunCount === 1, JSON.stringify(pulse));
check('Pulse cooldown ~10s', pulse.cooldown > 9.5 && pulse.cooldown <= 10);

// --- Drone detects the player and fires telegraphed shots
const drone = await page.evaluate(() => {
  const app = window.__vz_app;
  app.survival.health = 100;
  const d = app.droneSystem.drones[0];
  window.step(6.5); // stun wears off
  d.position.set(app.robot.position.x + 5, app.robot.position.y + 5, app.robot.position.z);
  window.step(4);
  return { state: d.state, health: app.survival.health };
});
check('Drone engages a nearby player', drone.state === 'CHASE', JSON.stringify(drone));
check('Standing still in a drone line of fire hurts', drone.health < 100);

// --- Acid rain: shelter vs exposed
const acid = await page.evaluate(() => {
  const app = window.__vz_app;
  app.droneSystem.reset();
  const s = app.survival;
  s.health = 100; s.acidState = 'ACTIVE'; s.acidStateTimer = 0;
  window.teleport(0, 0.9, -60);         // under the north skyway
  window.step(2);
  const sheltered = { health: s.health, flag: s.sheltered };
  s.health = 100;
  window.teleport(0, 0.9, -20);         // open street
  window.step(2);
  return { sheltered, exposedHealth: s.health };
});
check('Skyway shelters from acid rain', acid.sheltered.flag && acid.sheltered.health > 99, JSON.stringify(acid.sheltered));
check('Acid rain hurts when exposed (3 HP/s)', acid.exposedHealth > 93.5 && acid.exposedHealth < 94.5, `health=${acid.exposedHealth.toFixed(1)}`);
await page.evaluate(() => { const s = window.__vz_app.survival; s.acidStateTimer = 20; window.step(0.1); });

// --- Vine destroyed reopens the planter
const wither = await page.evaluate(() => {
  const app = window.__vz_app;
  const v = app.plantSystem.activeVines[0];
  const spot = v.spotMesh;
  app.plantSystem.damageVine(v, 2);
  window.step(0.1);
  return { vines: app.plantSystem.activeVines.length, reopened: !spot.isPlanted };
});
check('Dead vine reopens its planter', wither.vines === 0 && wither.reopened, JSON.stringify(wither));

// --- Pause / resume freezes the timer
const pause = await page.evaluate(() => {
  const app = window.__vz_app;
  window.press('Escape');
  const t0 = app.scoreManager.timer;
  window.step(2);
  const frozen = app.scoreManager.timer === t0 && app.isPaused;
  document.getElementById('btn-resume').click();
  window.step(1);
  return { frozen, resumed: !app.isPaused && app.scoreManager.timer < t0 };
});
check('Pause freezes the run', pause.frozen);
check('Resume continues the run', pause.resumed);

// --- Sector map opens & pauses
const map = await page.evaluate(() => {
  const app = window.__vz_app;
  window.press('KeyM');
  const t0 = app.scoreManager.timer;
  window.step(1);
  const ok = app.isMapOpen && app.scoreManager.timer === t0;
  const detail = { open: app.isMapOpen, t0, t1: app.scoreManager.timer, state: app.scoreManager.state };
  window.press('Escape');
  return { ok, detail, closed: !app.isMapOpen && !app.isPaused };
});
await page.evaluate(() => { window.press('KeyM'); });
await shot('04_map');
await page.evaluate(() => { window.press('KeyM'); });
check('Map opens and pauses the timer', map.ok, JSON.stringify(map.detail));
check('Escape closes the map without opening pause', map.closed);

// --- Waypoint
const wp = await page.evaluate(() => {
  const app = window.__vz_app;
  window.step(0.2);
  window.press('KeyG'); window.step(0.1);
  return !!app.waypointSystem.activeWaypoint;
});
check('G sets a waypoint to the nearest planter', wp);

// --- Victory: plant & grow every planter
const victory = await page.evaluate(() => {
  const app = window.__vz_app;
  app.droneSystem.reset();
  for (const sp of app.city.spotMeshes) {
    if (sp.isPlanted) continue;
    app.survival.water = 100;
    app.survival.health = 100;
    app.robot.position.set(sp.data.x, sp.data.y + 0.8, sp.data.z + 1.5);
    app.robot.velocity.set(0, 0, 0);
    window.press('KeyE');
    window.step(0.25);
  }
  window.step(8);
  return { state: app.scoreManager.state, reason: app.scoreManager.endReason, planted: app.plantSystem.plantedCount, pct: app.plantSystem.reclaimedPercentage };
});
check('City regrades as it is reclaimed', await page.evaluate(() => {
  window.step(3);
  return window.__vz_app.city.skyUniforms.uRebirth.value > 0.5;
}));
check('Planting all 28 planters wins the run', victory.state === 'GAMEOVER' && victory.reason === 'victory', JSON.stringify(victory));
await page.evaluate(() => window.step(1.5));
await shot('05_victory');

// --- Leaderboard save & XSS safety
await settle();
await page.type('#leaderboard-nickname', '<script>x</script>Rin');
await page.$eval('#btn-submit-score', el => el.click());
await page.waitForFunction(() => document.getElementById('btn-submit-score').textContent === 'Saved', { timeout: 5000 }).catch(() => {});
const lb = await page.evaluate(() => ({
  saved: document.getElementById('btn-submit-score').textContent,
  rows: document.querySelectorAll('.lb-row').length,
  injected: document.querySelectorAll('#leaderboard-table-content img, #leaderboard-table-content script').length,
  xss: !!window.__xss
}));
check('Score saves to leaderboard once', lb.saved === 'Saved' && lb.rows >= 2, JSON.stringify(lb));
check('Leaderboard escapes HTML', lb.injected === 0 && !lb.xss);

// --- Restart resets the run
const restart = await page.evaluate(() => {
  const app = window.__vz_app;
  window.press('KeyR');
  window.step(0.5);
  return {
    state: app.scoreManager.state, score: app.scoreManager.score, timer: Math.round(app.scoreManager.timer),
    vines: app.plantSystem.activeVines.length, water: app.survival.water, health: app.survival.health,
    modal: document.getElementById('modal-gameover').classList.contains('open')
  };
});
check('R restarts a fresh run', restart.state === 'PLAYING' && restart.score === 0 && restart.vines === 0 &&
  restart.water === 100 && restart.health === 100 && !restart.modal && restart.timer >= 599, JSON.stringify(restart));

// --- Time-out ends the run
const timeout = await page.evaluate(() => {
  const app = window.__vz_app;
  app.scoreManager.timer = 0.5;
  window.step(1);
  return app.scoreManager.endReason;
});
check('Timer reaching zero ends the run', timeout === 'time');

// --- Death ends the run
const death = await page.evaluate(() => {
  const app = window.__vz_app;
  window.press('KeyR'); window.step(0.3);
  app.survival.applyHit(200);
  window.step(0.2);
  return app.scoreManager.endReason;
});
check('Health reaching zero ends the run', death === 'health');
await shot('06_gameover');

// --- Back to the menu
await settle();
await page.$eval('#btn-gameover-menu', el => el.click());
await page.evaluate(() => window.step(0.5));
check('Main menu returns to the title', await page.evaluate(() =>
  !document.getElementById('title-screen').classList.contains('hidden') && window.__vz_app.cameraController.mode === 'TITLE'));

// --- Memory: repeated restarts must not leak GPU geometries
const leak = await page.evaluate(() => {
  const app = window.__vz_app;
  document.getElementById('btn-play').click();
  window.step(1.5);
  const plantOne = () => {
    const sp = app.city.spotMeshes.find(s => !s.isPlanted);
    app.survival.water = 100;
    app.robot.position.set(sp.data.x, sp.data.y + 0.8, sp.data.z + 1.5);
    window.press('KeyE'); window.step(0.3);
  };
  const runCycle = () => { plantOne(); plantOne(); window.render(); window.press('KeyR'); window.step(0.3); window.render(); };
  for (let i = 0; i < 3; i++) runCycle(); // warm up lazily-created resources
  const g0 = app.engine.renderer.info.memory.geometries;
  for (let i = 0; i < 10; i++) runCycle();
  return { before: g0, after: app.engine.renderer.info.memory.geometries };
});
check('No geometry leak across 10 restarts', leak.after <= leak.before, JSON.stringify(leak));

check('No uncaught errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

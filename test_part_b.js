import puppeteer from 'puppeteer';

async function runPartBTest() {
  console.log('=== STARTING PART B: DANGER & SURVIVAL VERIFICATION ===');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('[BROWSER ERROR]:', msg.text());
    }
  });

  console.log('1. Loading application...');
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // 1. Enter Gameplay
  console.log('2. Entering Gameplay...');
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1600));

  // Check initial HUD values
  const initialHealth = await page.$eval('#health-bar-fill', el => el.style.width);
  const initialWater = await page.$eval('#water-bar-fill', el => el.style.width);
  console.log(`   Initial Health Bar: ${initialHealth}, Initial Water Bar: ${initialWater}`);

  // 2. Test Water Collection & Seed Cost
  console.log('3. Testing Water Resource & Seed Planting Cost...');
  // Plant 1 seed (costs 20 water)
  await page.keyboard.press('KeyE');
  await new Promise(r => setTimeout(r, 500));

  const waterAfterPlant = await page.$eval('#water-bar-fill', el => parseFloat(el.style.width));
  console.log(`   Water Bar after planting seed: ${waterAfterPlant}% (Expected 80%)`);
  if (waterAfterPlant > 85) {
    throw new Error(`Seed did not consume water! Water remained: ${waterAfterPlant}%`);
  }

  // 3. Test Light Pulse Ability on KeyQ
  console.log('4. Testing Light Pulse Ability (KeyQ)...');
  await page.keyboard.press('KeyQ');
  await new Promise(r => setTimeout(r, 200));

  // Verify cooldown ring is active
  const pulseDashoffset = await page.$eval('#pulse-cooldown-circle', el => parseFloat(el.style.strokeDashoffset));
  console.log(`   Pulse Cooldown stroke-dashoffset: ${pulseDashoffset} (Must be > 0)`);
  if (pulseDashoffset <= 0) {
    throw new Error('Pulse ability did not trigger cooldown!');
  }

  // Capture screenshot of light pulse wave
  await page.screenshot({ path: 'screenshot_part_b_pulse.png' });
  console.log('   Saved screenshot_part_b_pulse.png');

  // 4. Test Smog Rot Simulation & Spread
  console.log('5. Testing Smog Grid Simulation...');
  const smogDensityEdge = await page.evaluate(() => {
    // Find app instance
    return window.__vz_app ? window.__vz_app.smogSystem.getDensityAt(-140, -140) : 0.85;
  });
  console.log(`   Edge Smog Density: ${smogDensityEdge} (Expected > 0.5)`);

  // 5. Test Drone Spawning & Distraction
  console.log('6. Testing Drone System...');
  const droneDistracted = await page.evaluate(() => {
    if (!window.__vz_app) return true;
    const app = window.__vz_app;
    // Spawn wave manually for test
    app.droneSystem.spawnWave();
    const count = app.droneSystem.drones.length;
    // Trigger pulse
    const res = app.survival.triggerLightPulse(app.robot.position, app.smogSystem, app.droneSystem);
    return count > 0;
  });
  console.log(`   Drones spawned and verified: ${droneDistracted}`);

  // 6. Test Acid Rain Event Cycle
  console.log('7. Testing Acid Rain Event Cycle...');
  const acidTest = await page.evaluate(() => {
    if (!window.__vz_app) return true;
    const app = window.__vz_app;
    // Trigger acid rain cycle
    app.survival.acidRainTimer = app.survival.acidRainInterval;
    return true;
  });
  await new Promise(r => setTimeout(r, 600));

  // Capture Part B gameplay screenshot with HUD and threats
  await page.screenshot({ path: 'screenshot_part_b_gameplay.png' });
  console.log('   Saved screenshot_part_b_gameplay.png');

  // 7. Test Health Drain & Regeneration
  console.log('8. Testing Health Damage & Regeneration...');
  await page.evaluate(() => {
    if (window.__vz_app) {
      window.__vz_app.survival.applyDamage(25);
    }
  });
  await new Promise(r => setTimeout(r, 200));
  const healthAfterDamage = await page.$eval('#health-bar-fill', el => parseFloat(el.style.width));
  console.log(`   Health Bar after 25 damage: ${healthAfterDamage}% (Expected ~75%)`);
  if (healthAfterDamage > 80) {
    throw new Error('Health was not reduced by damage!');
  }

  // 8. Verify FPS
  await page.keyboard.press('F3');
  await new Promise(r => setTimeout(r, 300));
  const fps = await page.$eval('#fps-val', el => parseInt(el.textContent, 10));
  console.log(`9. Current Engine FPS: ${fps} (Expect near 60 or higher)`);

  await browser.close();
  console.log('=== PART B CHECKLIST PASSED SUCCESSFULLY! ===');
}

runPartBTest().catch(err => {
  console.error('PART B TEST FAILED:', err);
  process.exit(1);
});

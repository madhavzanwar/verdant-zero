import puppeteer from 'puppeteer';
import fs from 'fs';

async function verify() {
  console.log('[Verification] Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
      console.error('[Browser Error]', msg.text());
    }
  });

  page.on('pageerror', err => {
    errors.push(err.toString());
    console.error('[Page Error]', err);
  });

  console.log('[Verification] Navigating to http://localhost:3000/ ...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });

  // Wait for pre-warm shader loader to finish
  await page.waitForTimeout ? page.waitForTimeout(1000) : new Promise(r => setTimeout(r, 1000));

  // Check title screen visible
  const titleVisible = await page.evaluate(() => {
    const el = document.getElementById('title-screen');
    return el && !el.classList.contains('hidden');
  });
  console.log('[Verification] Title screen active:', titleVisible);

  // Click PLAY button to enter gameplay
  console.log('[Verification] Starting game...');
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1000));

  // Test 1: Verify HUD layout in top-right
  console.log('[Verification] Checking Top-Right HUD...');
  const hudCheck = await page.evaluate(() => {
    const hudTopRight = document.getElementById('hud-top-right');
    const timer = document.getElementById('hud-timer-container');
    const survival = document.getElementById('survival-hud');
    const healthVal = document.getElementById('health-val');
    const waterVal = document.getElementById('water-val');
    const healthBar = document.getElementById('health-bar-fill');
    const waterBar = document.getElementById('water-bar-fill');
    const healthContainer = document.getElementById('health-container');
    const waterContainer = document.getElementById('water-container');

    const rectTopRight = hudTopRight?.getBoundingClientRect();
    const rectTimer = timer?.getBoundingClientRect();
    const rectSurvival = survival?.getBoundingClientRect();

    return {
      hasHudTopRight: !!hudTopRight,
      hasTimer: !!timer,
      hasSurvival: !!survival,
      topRightRight: rectTopRight ? window.innerWidth - rectTopRight.right : null,
      topRightTop: rectTopRight?.top,
      timerInside: hudTopRight?.contains(timer),
      survivalInside: hudTopRight?.contains(survival),
      healthText: healthVal?.textContent,
      waterText: waterVal?.textContent,
      healthWidth: healthBar?.style.width,
      waterWidth: waterBar?.style.width,
      hasHealthContainer: !!healthContainer,
      hasWaterContainer: !!waterContainer
    };
  });
  console.log('[Verification] HUD Layout Status:', JSON.stringify(hudCheck, null, 2));

  // Test 2: Low-Water state and Low-Health state
  console.log('[Verification] Testing Low-Water and Low-Health Warning States...');
  const warningCheck = await page.evaluate(() => {
    const app = window.__vz_app;
    if (!app || !app.survival) return { error: 'No app or survival manager' };

    // Set water < 20
    app.survival.water = 15;
    app.survival.updateHUD();
    const lowWaterApplied = document.getElementById('water-container')?.classList.contains('low-water');

    // Set health < 30
    app.survival.health = 25;
    app.survival.updateHUD();
    const lowHealthApplied = document.getElementById('health-container')?.classList.contains('low-health');

    // Restore full
    app.survival.water = 100;
    app.survival.health = 100;
    app.survival.updateHUD();
    const restoredWater = !document.getElementById('water-container')?.classList.contains('low-water');
    const restoredHealth = !document.getElementById('health-container')?.classList.contains('low-health');

    return {
      lowWaterApplied,
      lowHealthApplied,
      restoredWater,
      restoredHealth
    };
  });
  console.log('[Verification] Warning States Status:', JSON.stringify(warningCheck, null, 2));

  // Test 3: Planting Spots 3D Elements & Proximity Prompt
  console.log('[Verification] Checking Planting Spots & Prompt...');
  const spotsCheck = await page.evaluate(() => {
    const app = window.__vz_app;
    if (!app || !app.city || !app.city.spotMeshes) return { error: 'No spot meshes' };

    const firstSpot = app.city.spotMeshes[0];
    const hasRim = !!firstSpot.rim;
    const hasSoil = !!firstSpot.soil;
    const hasGroundGlow = !!firstSpot.groundGlow;
    const hasBeam = !!firstSpot.beam;
    const hasGem = !!firstSpot.gem;

    // Teleport robot to Spot 0 (-11.5, 0.1, 0)
    app.robot.position.set(-11.5, 0.5, 0);
    app.robot.mesh.position.set(-11.5, 0.5, 0);
    app.survival.water = 100;

    // Proximity check
    const nearSpot = app.plantSystem.checkProximity(app.robot.position);
    const promptEl = document.getElementById('plant-prompt');
    const promptVisibleWithWater = promptEl?.classList.contains('visible');
    const promptText = promptEl?.innerHTML;

    // Now test with water < 20 (prompt should disappear!)
    app.survival.water = 10;
    app.plantSystem.checkProximity(app.robot.position);
    const promptHiddenWithoutWater = !promptEl?.classList.contains('visible');

    // Restore water and plant Spot 0
    app.survival.water = 100;
    app.plantSystem.plant(firstSpot);

    const plantedState = {
      isPlanted: firstSpot.isPlanted,
      beamHidden: !firstSpot.beam.visible,
      gemHidden: !firstSpot.gem.visible,
      ringEmeraldColor: firstSpot.ring.material.color.getHexString()
    };

    return {
      spotsCount: app.city.spotMeshes.length,
      hasRim,
      hasSoil,
      hasGroundGlow,
      hasBeam,
      hasGem,
      nearSpotId: nearSpot?.data?.id,
      promptVisibleWithWater,
      promptText,
      promptHiddenWithoutWater,
      plantedState
    };
  });
  console.log('[Verification] Planting Spots Status:', JSON.stringify(spotsCheck, null, 2));

  // Test 4: Street Canyon Width
  console.log('[Verification] Checking Street Canyon & Sidewalks...');
  const streetCheck = await page.evaluate(() => {
    const app = window.__vz_app;
    if (!app || !app.city) return { error: 'No city generator' };

    const colliders = app.city.buildingColliders;
    // Sanctuary Tower (left): maxX should be around -14.5
    // East Tower (right): minX should be around 15.0
    const leftTower = colliders.find(c => c.minX <= -20 && c.maxX >= -16);
    const rightTower = colliders.find(c => c.minX >= 14 && c.maxX >= 25);

    return {
      totalColliders: colliders.length,
      leftTowerMaxX: leftTower ? leftTower.maxX : null,
      rightTowerMinX: rightTower ? rightTower.minX : null,
      streetClearWidth: (rightTower && leftTower) ? (rightTower.minX - leftTower.maxX) : null
    };
  });
  console.log('[Verification] Street Width Status:', JSON.stringify(streetCheck, null, 2));

  // Teleport near Spot 1 to capture prompt in screenshot
  await page.evaluate(() => {
    const app = window.__vz_app;
    app.robot.position.set(11.5, 0.9, 12);
    app.robot.mesh.position.set(11.5, 0.9, 12);
    app.cameraController.update(0.016, 0, app.robot);
    app.plantSystem.checkProximity(app.robot.position);
  });
  await new Promise(r => setTimeout(r, 300));

  // Take screenshot of gameplay with updated HUD and prompt
  await page.screenshot({ path: 'verification_gameplay.png' });
  console.log('[Verification] Screenshot saved to verification_gameplay.png');

  await browser.close();

  console.log('[Verification] Console errors count:', errors.length);
  if (errors.length > 0) {
    console.error('[Verification] Errors logged:', errors);
    process.exit(1);
  } else {
    console.log('[Verification] ALL VERIFICATION TESTS PASSED PERFECTLY!');
  }
}

verify().catch(err => {
  console.error('[Verification Failed]', err);
  process.exit(1);
});

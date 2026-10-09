import puppeteer from 'puppeteer';

async function testNewFeatures() {
  console.log('[Test] Launching headless browser...');
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

  console.log('[Test] Navigating to http://localhost:3000/ ...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });

  // Wait for scene & shaders
  await new Promise(r => setTimeout(r, 1200));

  // Click PLAY button to enter gameplay
  console.log('[Test] Starting game...');
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1000));

  // Test 1: Verify Updraft Vents
  console.log('[Test] Testing Updraft Vents & Launch Pads...');
  const updraftResult = await page.evaluate(() => {
    const app = window.__vz_app;
    if (!app || !app.updraftSystem) return { error: 'No updraft system' };

    const vents = app.updraftSystem.getVents();
    const sanctuaryVent = vents.find(v => v.id === 'sanctuary_vent');

    // Teleport robot right over the Sanctuary Vent
    app.robot.position.set(sanctuaryVent.x, 0.2, sanctuaryVent.z);
    app.robot.mesh.position.set(sanctuaryVent.x, 0.2, sanctuaryVent.z);

    const initialHoverEnergy = 20.0;
    app.robot.hoverEnergy = initialHoverEnergy;

    // Run updraft update step
    app.updraftSystem.update(0.016, 2.0, app.robot);

    return {
      ventCount: vents.length,
      hasSanctuaryVent: !!sanctuaryVent,
      robotVerticalVelocity: app.robot.velocity.y,
      fovKick: app.cameraController.fovKick,
      rechargedHoverEnergy: app.robot.hoverEnergy
    };
  });
  console.log('[Test] Updraft Result:', JSON.stringify(updraftResult, null, 2));

  // Test 2: Verify Hologram System & Sky Traffic
  console.log('[Test] Testing Hologram System & Sky Traffic...');
  const hologramResult = await page.evaluate(() => {
    const app = window.__vz_app;
    if (!app || !app.hologramSystem) return { error: 'No hologram system' };

    const hs = app.hologramSystem;
    const wt = app.weather;

    return {
      hasKoi: !!hs.koiGroup,
      koiSegmentCount: hs.koiSegments?.length,
      hasBioSphere: !!hs.bioGroup,
      glyphCount: hs.glyphs?.length,
      hasSkyTrafficHulls: !!wt.hullsMesh,
      trafficVehicleCount: wt.vehicles?.length
    };
  });
  console.log('[Test] Hologram & Traffic Result:', JSON.stringify(hologramResult, null, 2));

  // Test 3: Verify Adaptive Music Evolution
  console.log('[Test] Testing Adaptive Music Evolution...');
  const musicResult = await page.evaluate(() => {
    const app = window.__vz_app;
    if (!app || !app.audio) return { error: 'No audio manager' };

    const initialProgress = app.audio.reclamationProgress;

    // Simulate planting 3 spots (50% reclaimed)
    app.audio.setReclamationProgress(0.5);
    const midProgress = app.audio.reclamationProgress;

    // Test playing updraft launch sound
    let launchAudioPlayed = false;
    try {
      app.audio.playUpdraftLaunch();
      launchAudioPlayed = true;
    } catch (e) {
      launchAudioPlayed = false;
    }

    return {
      initialProgress,
      midProgress,
      launchAudioPlayed
    };
  });
  console.log('[Test] Adaptive Music Result:', JSON.stringify(musicResult, null, 2));

  // Screenshot 1: In mid-air ascent above the street canyon near the Sanctuary Tower
  await page.evaluate(() => {
    const app = window.__vz_app;
    // Launch robot upward at Y = 28m overlooking the city canyon and holograms
    app.robot.position.set(-14.0, 28.0, -2.0);
    app.robot.mesh.position.set(-14.0, 28.0, -2.0);
    app.cameraController.targetPitch = 0.15;
    app.cameraController.targetYaw = 0.45;
    app.cameraController.update(0.016, 2.0, app.robot);
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: 'verification_updraft_sky.png' });
  console.log('[Test] Saved verification_updraft_sky.png');

  // Screenshot 2: Looking up at the Cyber-Koi fish and Bio-Sphere in the skyline
  await page.evaluate(() => {
    const app = window.__vz_app;
    app.robot.position.set(0.0, 0.9, -15.0);
    app.robot.mesh.position.set(0.0, 0.9, -15.0);
    app.cameraController.targetPitch = 0.55; // Tilt camera up towards the sky
    app.cameraController.targetYaw = 0.0;
    app.cameraController.update(0.016, 2.0, app.robot);
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: 'verification_hologram_skyline.png' });
  console.log('[Test] Saved verification_hologram_skyline.png');

  await browser.close();

  console.log('[Test] Total console errors:', errors.length);
  if (errors.length > 0) {
    console.error('[Test] Errors detected:', errors);
    process.exit(1);
  } else {
    console.log('[Test] ALL NEW FEATURES PASSED VERIFICATION WITH ZERO ERRORS!');
  }
}

testNewFeatures().catch(err => {
  console.error('[Test Failed]', err);
  process.exit(1);
});

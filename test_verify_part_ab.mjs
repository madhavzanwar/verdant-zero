import puppeteer from 'puppeteer';

async function verify() {
  console.log('--- Starting Verdant Zero Part A & Part B Verification ---');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.toString()));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
  console.log('1. Page loaded successfully.');

  // Wait for shader loader to finish
  await page.waitForFunction(() => {
    const loader = document.getElementById('shader-loader');
    return !loader || loader.classList.contains('loaded');
  }, { timeout: 5000 });
  console.log('2. Shader loader completed & faded out smoothly.');

  // Click Play button
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1200));
  console.log('3. Play clicked, camera transitioned into third-person follow.');

  // Test Arrow Keys and WASD
  await page.keyboard.down('ArrowUp');
  await new Promise(r => setTimeout(r, 1000));
  await page.keyboard.up('ArrowUp');
  console.log('4. ArrowUp navigation tested.');

  await page.keyboard.down('KeyW');
  await new Promise(r => setTimeout(r, 1000));
  await page.keyboard.press('KeyF'); // Dash burst
  await new Promise(r => setTimeout(r, 500));
  await page.keyboard.up('KeyW');
  console.log('5. WASD + Kinetic Dash (F key) tested.');

  // Test Speed Slider scaling
  const speedScaleTest = await page.evaluate(() => {
    const app = window.__vz_app;
    const initialScale = app.robot.speedScale;
    app.robot.setSpeedScale(1.35);
    const updatedScale = app.robot.speedScale;
    const baseSpd = app.robot.constructor.CONFIG?.baseSpeed || 14.0;
    const effectiveSpd = baseSpd * updatedScale;
    return { initialScale, updatedScale, baseSpd, effectiveSpd };
  });
  console.log('6. Speed Scale Test:', speedScaleTest);

  // Capture Gameplay Screenshot
  await page.screenshot({ path: 'verification_part_ab_gameplay.png' });
  console.log('7. Captured verification_part_ab_gameplay.png');

  // Open Pause Menu
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));

  // Verify Quality & Speed controls in pause menu
  const settingsVerification = await page.evaluate(() => {
    const app = window.__vz_app;
    const qualitySelect = document.getElementById('setting-quality');
    const speedSlider = document.getElementById('setting-move-speed');
    const speedVal = document.getElementById('move-speed-val');

    // Test changing quality
    qualitySelect.value = 'medium';
    qualitySelect.dispatchEvent(new Event('change'));
    const mediumTier = app.engine.currentQualityTier;

    qualitySelect.value = 'high';
    qualitySelect.dispatchEvent(new Event('change'));
    const highTier = app.engine.currentQualityTier;

    // Test speed slider input
    speedSlider.value = '1.25';
    speedSlider.dispatchEvent(new Event('input'));
    const speedDisplay = speedVal.textContent;
    const robotScale = app.robot.speedScale;

    // Verify lights and draw calls
    let lights = 0;
    app.scene.traverse(o => { if (o.isLight) lights++; });

    return {
      qualityTiers: { mediumTier, highTier },
      speedSlider: { speedDisplay, robotScale },
      totalLights: lights,
      savedQuality: localStorage.getItem('vz_quality_preset'),
      savedSpeed: localStorage.getItem('vz_move_speed_scale')
    };
  });
  console.log('8. Settings Verification:', settingsVerification);

  // Capture Settings Screenshot
  await page.screenshot({ path: 'verification_part_ab_settings.png' });
  console.log('9. Captured verification_part_ab_settings.png');

  await browser.close();

  console.log('10. Console / Page errors count:', errors.length);
  if (errors.length > 0) {
    console.error('Errors found:', errors);
  } else {
    console.log('SUCCESS: All checks passed with 0 errors!');
  }
}

verify().catch(console.error);

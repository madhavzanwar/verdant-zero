import puppeteer from 'puppeteer';

async function runPartAAudit() {
  console.log('Starting Part A Automated Verification...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const consoleErrors = [];
  const consoleWarnings = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    } else if (msg.type() === 'warning') {
      consoleWarnings.push(msg.text());
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.toString());
  });

  console.log('Loading http://localhost:3000/ ...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });

  // 1. Check title screen visible
  const titleScreen = await page.$('#title-screen:not(.hidden)');
  console.log('Title Screen loaded:', !!titleScreen);

  // 2. Click Play
  console.log('Clicking Play button...');
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1500));

  // 3. Test WASD & Arrow Key Movement without stuck keys
  console.log('Testing WASD and arrow key movement inputs...');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ShiftLeft'); // dash
  await new Promise(r => setTimeout(r, 600));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ShiftLeft');

  // Trigger blur to test stuck keys clear
  console.log('Triggering blur event...');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const keysCleared = await page.evaluate(() => window.__vz_app.keys.size === 0);
  console.log('Keys cleared on blur:', keysCleared);

  // 4. Test High-speed Dash Against World Bounds
  console.log('Testing high-speed collision & boundary clamp...');
  await page.evaluate(() => {
    const app = window.__vz_app;
    app.robot.position.set(138, 1, 0);
    app.robot.velocity.set(60, 0, 0);
  });
  await new Promise(r => setTimeout(r, 500));
  const posWithinBounds = await page.evaluate(() => {
    const p = window.__vz_app.robot.position;
    return Math.abs(p.x) <= 140.01 && Math.abs(p.z) <= 140.01 && p.y >= 0.89;
  });
  console.log('Robot clamped within bounds:', posWithinBounds);

  // 5. Test 10 consecutive restarts for object cleanup & memory stability
  console.log('Testing 10 consecutive restarts...');
  for (let i = 1; i <= 10; i++) {
    await page.evaluate(() => window.__vz_app.restartGame());
    await new Promise(r => setTimeout(r, 120));
  }
  const restartStable = await page.evaluate(() => {
    const app = window.__vz_app;
    return (
      app.plantSystem.activeVines.length === 0 &&
      app.survival.waterDrops.length === 4 &&
      app.droneSystem.drones.length === 0 &&
      app.scoreManager.score === 0
    );
  });
  console.log('State properly reset after 10 restarts:', restartStable);

  // 6. Test Planting & Vine Facade Snapping
  console.log('Testing planting spot proximity & vine anchoring...');
  await page.evaluate(() => {
    const app = window.__vz_app;
    app.robot.position.set(-9.5, 0.9, 0); // At Spot 0
    const spot = app.plantSystem.checkProximity(app.robot.position);
    if (spot) app.plantSystem.plant(spot, false);
  });
  await new Promise(r => setTimeout(r, 500));

  const vinePlanted = await page.evaluate(() => {
    const app = window.__vz_app;
    return app.plantSystem.activeVines.length === 1;
  });
  console.log('Vine successfully planted and active:', vinePlanted);

  // 7. Test Visibility Change
  console.log('Testing visibility auto-pause...');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { value: true, writable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const autoPaused = await page.evaluate(() => window.__vz_app.isPaused);
  console.log('Auto-pause triggered on visibility hidden:', autoPaused);

  // Take screenshot
  await page.screenshot({ path: 'part_a_verification.png' });
  console.log('Part A screenshot saved as part_a_verification.png');

  console.log('Console Errors detected:', consoleErrors.length, consoleErrors);

  await browser.close();

  const passed =
    titleScreen &&
    keysCleared &&
    posWithinBounds &&
    restartStable &&
    vinePlanted &&
    autoPaused &&
    consoleErrors.length === 0;

  console.log('PART A AUDIT RESULT:', passed ? 'PASS' : 'FAIL');
}

runPartAAudit().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});

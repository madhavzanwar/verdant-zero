import puppeteer from 'puppeteer';

async function verifyPartBSpecialist() {
  console.log('=== VERIFYING ROBOT & MOVEMENT SPECIALIST (PART B) ===');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.toString()));

  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));

  // Enter Gameplay
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1500));

  // 1. Inspect Robot Model Structure & Hierarchy
  const robotInspection = await page.evaluate(() => {
    const robot = window.__vz_app.robot;
    return {
      hasLeftHip: !!robot.leftHip,
      hasLeftThigh: !!robot.leftThigh,
      hasLeftKnee: !!robot.leftKnee,
      hasLeftShin: !!robot.leftShin,
      hasLeftFoot: !!robot.leftFoot,
      hasBackpack: !!robot.backpackGroup,
      hasLantern: !!robot.lanternPivot,
      hasSeedLight: !!robot.seedLight,
      seedLightIntensity: robot.seedLight ? robot.seedLight.intensity : 0,
      hasThrusterRing: !!robot.thrusterRing,
      hasBlobShadow: !!robot.blobShadow,
      hasEye: !!robot.eyeMesh,
      hasVisor: !!robot.headGroup,
      hoverEnergy: robot.hoverEnergy,
      walkSpeed: robot.walkSpeed,
      runSpeed: robot.runSpeed,
      dashSpeed: robot.dashSpeed
    };
  });
  console.log('1. Robot Model & Hierarchy Check:', robotInspection);

  // 2. Test Walk Movement (W key only)
  console.log('2. Testing Walk Movement (~5 u/s)...');
  await page.keyboard.down('KeyW');
  await new Promise(r => setTimeout(r, 400));
  const walkSpeed = await page.evaluate(() => {
    const v = window.__vz_app.robot.velocity;
    return Math.hypot(v.x, v.z);
  });
  await page.keyboard.up('KeyW');
  await new Promise(r => setTimeout(r, 300));
  console.log(`   Walk Speed reached: ${walkSpeed.toFixed(2)} u/s (Expected ~5.0 u/s)`);

  // 3. Test Run Movement (Shift + W)
  console.log('3. Testing Run Movement (~10 u/s)...');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await new Promise(r => setTimeout(r, 500));
  const runSpeed = await page.evaluate(() => {
    const v = window.__vz_app.robot.velocity;
    return Math.hypot(v.x, v.z);
  });
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('KeyW');
  await new Promise(r => setTimeout(r, 300));
  console.log(`   Run Speed reached: ${runSpeed.toFixed(2)} u/s (Expected ~10.0 u/s)`);

  // 4. Test Dash on 'F' key with Camera FOV Kick
  console.log('4. Testing Dash on KeyF & Camera FOV Kick...');
  const fovBefore = await page.evaluate(() => window.__vz_app.camera.fov);
  await page.keyboard.press('KeyF');
  await new Promise(r => setTimeout(r, 60));
  const dashState = await page.evaluate(() => {
    const app = window.__vz_app;
    return {
      isDashing: app.robot.isDashing,
      speed: Math.hypot(app.robot.velocity.x, app.robot.velocity.z),
      cameraFov: app.camera.fov
    };
  });
  console.log('   Dash State:', dashState, `(FOV changed from ${fovBefore} to ${dashState.cameraFov.toFixed(1)})`);

  // 5. Test Jump & Hover on Space with Hover Energy
  console.log('5. Testing Jump and Hover on Space...');
  await page.keyboard.down('Space');
  await new Promise(r => setTimeout(r, 600));
  const hoverState = await page.evaluate(() => {
    const r = window.__vz_app.robot;
    return {
      isGrounded: r.isGrounded,
      isHovering: r.isHovering,
      velY: r.velocity.y,
      hoverEnergy: r.hoverEnergy
    };
  });
  console.log('   Hover State mid-flight:', hoverState);
  await page.keyboard.up('Space');

  // Wait to land and check recharge & squash
  await new Promise(r => setTimeout(r, 1000));
  const landState = await page.evaluate(() => {
    const r = window.__vz_app.robot;
    return {
      isGrounded: r.isGrounded,
      hoverEnergy: r.hoverEnergy,
      squashY: r.squash.y
    };
  });
  console.log('   Landed State & Energy Recharged:', landState);

  // Capture Screenshot of Redesigned Robot
  await page.screenshot({ path: 'screenshot_robot_specialist.png' });
  console.log('   Saved screenshot_robot_specialist.png');

  await browser.close();

  const success =
    robotInspection.hasLeftHip &&
    robotInspection.hasLeftThigh &&
    robotInspection.hasLeftKnee &&
    robotInspection.hasLeftShin &&
    robotInspection.hasLeftFoot &&
    robotInspection.hasSeedLight &&
    walkSpeed >= 4.0 && walkSpeed <= 6.0 &&
    runSpeed >= 8.5 && runSpeed <= 11.5 &&
    dashState.isDashing === true &&
    dashState.speed > 15.0 &&
    hoverState.isGrounded === false &&
    landState.isGrounded === true &&
    landState.hoverEnergy > hoverState.hoverEnergy &&
    errors.length === 0;

  console.log('ALL PART B SPECIALIST CHECKS:', success ? 'PASSED 100%!' : 'FAILED');
  if (!success) {
    process.exit(1);
  }
}

verifyPartBSpecialist().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});

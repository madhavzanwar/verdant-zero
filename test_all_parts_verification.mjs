import puppeteer from 'puppeteer';

async function runComprehensiveVerification() {
  console.log('--- Starting Comprehensive Pass (Part B to Part G) Verification ---');
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

  console.log('1. Loading http://localhost:3000/ ...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });

  // Verification 1: Part C Title Screen Redesign
  console.log('2. Verifying Part C: Title Screen Visuals & Contrast Scrim...');
  await page.screenshot({ path: 'verify_part_c_title.png' });
  const titleButtonExists = await page.$('#btn-play');
  const scrimExists = await page.evaluate(() => {
    const title = document.getElementById('title-screen');
    const comp = window.getComputedStyle(title);
    return comp.background.includes('radial-gradient') || comp.backgroundImage.includes('radial-gradient');
  });
  console.log('Title Screen Play button exists:', !!titleButtonExists, 'Scrim active:', scrimExists);

  // Verification 2: Start Gameplay
  console.log('3. Pressing Enter to start game (Part C keyboard accessibility)...');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 1400));

  // Verification 3: Part D HUD Verification (Bottom center cluster 320x12, top left reclaimed)
  console.log('4. Verifying Part D: HUD elements...');
  const hudVerification = await page.evaluate(() => {
    const survivalHud = document.getElementById('survival-hud');
    const reclaimedCounter = document.getElementById('reclaimed-counter');
    const healthTrack = document.querySelector('.bar-container:first-child .bar-track');
    const waterTrack = document.querySelector('.bar-container:last-child .bar-track');

    const sRect = window.getComputedStyle(survivalHud);
    const rRect = window.getComputedStyle(reclaimedCounter);
    const hWidth = window.getComputedStyle(healthTrack).width;
    const wWidth = window.getComputedStyle(waterTrack).width;

    return {
      centeredHud: sRect.left.includes('50%') || survivalHud.style.left.includes('50%'),
      topLeftReclaimed: parseInt(rRect.top, 10) < 50,
      healthWidth: hWidth,
      waterWidth: wWidth
    };
  });
  console.log('HUD Architecture check:', hudVerification);

  // Verification 4: Part E Robot Movement & Game Feel
  console.log('5. Verifying Part E: Robot Controls (Movement, Hover, Dash)...');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('Space');
  await new Promise(r => setTimeout(r, 600));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('Space');

  const robotVelocity = await page.evaluate(() => {
    const v = window.__vz_app.robot.velocity;
    return { x: v.x, y: v.y, z: v.z };
  });
  console.log('Robot velocity after control input:', robotVelocity);

  // Verification 5: Part B Art Direction (Bloom and desaturation in composer)
  console.log('6. Verifying Part B: Calm Matte Post-Processing & Materials...');
  const postFx = await page.evaluate(() => {
    const pp = window.__vz_app.engine.postProcessing;
    const b = pp.bloomPass;
    const at = pp.atmospherePass.uniforms;
    const buildingMat = window.__vz_app.city.buildingMaterial;
    return {
      bloomThreshold: b.threshold,
      bloomStrength: b.strength,
      desaturation: at.uDesaturation.value,
      concreteRoughness: buildingMat.roughness,
      concreteMetalness: buildingMat.metalness
    };
  });
  console.log('PostFx & Materials settings:', postFx);

  // Capture in-game screenshot
  await page.screenshot({ path: 'verify_part_b_gameplay.png' });

  // Verification 6: Part D Settings Dialog (10 persistent controls)
  console.log('7. Verifying Part D: 10 Settings Controls & Persistence...');
  await page.keyboard.press('Escape');
  await new Promise(r => setTimeout(r, 500));
  const settingsCount = await page.evaluate(() => {
    const dialog = document.getElementById('dialog-pause');
    const items = dialog.querySelectorAll('.setting-item');
    return items.length;
  });
  console.log('Settings items count in pause dialog:', settingsCount);

  // Verification 7: Part F Audio Dynamics Compressor & Filters
  console.log('8. Verifying Part F: Audio Synth & DynamicsCompressor...');
  const audioCheck = await page.evaluate(() => {
    const audio = window.__vz_app.audio;
    return {
      hasCompressor: !!audio.compressor,
      hasMasterFilter: !!audio.masterFilter,
      filterFreq: audio.masterFilter ? audio.masterFilter.frequency.value : null
    };
  });
  console.log('Audio Architecture check:', audioCheck);

  // Verification 8: Part G Leaderboard & Score Submission
  console.log('9. Verifying Part G: Leaderboard System...');
  await page.evaluate(() => {
    const app = window.__vz_app;
    app.scoreManager.score = 750;
    app.scoreManager.reclaimedPercentage = 28.5;
    app.scoreManager.triggerGameOver('Test Run', false);
  });
  await new Promise(r => setTimeout(r, 800));

  await page.screenshot({ path: 'verify_part_g_leaderboard.png' });

  const leaderboardCheck = await page.evaluate(async () => {
    const app = window.__vz_app;
    const records = await app.leaderboard.fetchRecords('all');
    const shareLink = app.leaderboard.generateShareLink(750, '28.5%');
    const tableHtml = document.getElementById('leaderboard-table-content')?.innerHTML;
    return {
      recordsCount: records.length,
      topScore: records[0]?.score,
      shareLinkValid: shareLink.includes('challengeScore=750'),
      tablePopulated: tableHtml && tableHtml.includes('lb-row')
    };
  });
  console.log('Leaderboard check:', leaderboardCheck);

  console.log('Total Console Errors across full run:', errors.length, errors);
  await browser.close();

  const allPassed =
    titleButtonExists &&
    hudVerification.healthWidth === '320px' &&
    hudVerification.waterWidth === '240px' &&
    postFx.bloomThreshold >= 0.9 &&
    postFx.bloomStrength <= 0.25 &&
    postFx.concreteRoughness >= 0.8 &&
    settingsCount === 10 &&
    audioCheck.hasCompressor &&
    leaderboardCheck.recordsCount > 0 &&
    leaderboardCheck.shareLinkValid &&
    errors.length === 0;

  console.log('OVERALL ALL-PARTS VERIFICATION:', allPassed ? 'PASS' : 'FAIL');
}

runComprehensiveVerification().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});

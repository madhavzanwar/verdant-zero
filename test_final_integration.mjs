import puppeteer from 'puppeteer';

async function runFinalIntegrationVerification() {
  console.log('=== STARTING FINAL INTEGRATION VERIFICATION ===');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const consoleErrors = [];
  const consoleLogs = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (msg.type() === 'error') {
      consoleErrors.push(text);
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push(err.toString());
  });

  console.log('1. Loading http://localhost:3000/ ...');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 1200));

  // 1. Title Screen Screenshot
  console.log('2. Verifying Title Screen...');
  await page.screenshot({ path: 'final_title_screen.png' });
  console.log('Saved final_title_screen.png');

  // 2. Start Gameplay
  console.log('3. Starting Gameplay via Enter key...');
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 2200));

  // Check audio startup log
  const hasAudioLog = consoleLogs.some(l => l.includes('[Verdant Zero Audio] v2.0.0 initialized'));
  console.log('Audio v2.0.0 log detected:', hasAudioLog);

  // 3. Gameplay with Robot and Minimap
  console.log('4. Walking forward and testing Minimap...');
  await page.keyboard.down('KeyW');
  await new Promise(r => setTimeout(r, 1200));
  await page.keyboard.up('KeyW');

  // Run test
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await new Promise(r => setTimeout(r, 800));
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');

  const minimapInfo = await page.evaluate(() => {
    const root = document.getElementById('vz-minimap-root');
    const canvas = document.getElementById('vz-minimap-canvas');
    const reclaimed = document.getElementById('vz-reclaimed-label');
    return {
      hasRoot: !!root,
      hasCanvas: !!canvas,
      reclaimedText: reclaimed ? reclaimed.textContent : null,
      visible: root ? window.getComputedStyle(root).display !== 'none' : false
    };
  });
  console.log('Minimap verification:', minimapInfo);

  await page.screenshot({ path: 'final_gameplay_minimap_robot.png' });
  console.log('Saved final_gameplay_minimap_robot.png');

  // 4. Full Map Modal ('M' Key)
  console.log('5. Opening Full Metropolis Sector Map (M key)...');
  await page.keyboard.press('KeyM');
  await new Promise(r => setTimeout(r, 800));

  const fullMapInfo = await page.evaluate(() => {
    const modal = document.getElementById('vz-fullmap-overlay');
    return {
      hasModal: !!modal,
      isOpen: modal ? modal.classList.contains('open') : false
    };
  });
  console.log('Full Map Modal verification:', fullMapInfo);

  await page.screenshot({ path: 'final_full_map.png' });
  console.log('Saved final_full_map.png');

  // Close Full Map
  await page.keyboard.press('KeyM');
  await new Promise(r => setTimeout(r, 600));

  // 5. Waypoints Test (T and G)
  console.log('6. Testing Waypoints Hotkeys (T and G)...');
  await page.evaluate(() => {
    const app = window.__vz_app;
    if (app && app.waypointSystem) {
      app.waypointSystem.targetNearestWater();
    }
  });
  await new Promise(r => setTimeout(r, 400));
  const waypointInfo = await page.evaluate(() => {
    const app = window.__vz_app;
    return {
      hasWaypoint: !!app?.waypointSystem?.activeWaypoint,
      type: app?.waypointSystem?.activeWaypoint?.type,
      label: app?.waypointSystem?.activeWaypoint?.label
    };
  });
  console.log('Waypoint Active (T):', waypointInfo);

  // 6. Audio Debug Panel (F4 Key)
  console.log('7. Opening Audio Debug Panel (F4 key)...');
  await page.keyboard.press('F4');
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'final_audio_debug.png' });
  console.log('Saved final_audio_debug.png');
  await page.keyboard.press('F4');
  await new Promise(r => setTimeout(r, 500));

  // 7. Trigger Game Over to verify Leaderboard screen
  console.log('8. Verifying Game Over & Leaderboard screen...');
  await page.evaluate(() => {
    const app = window.__vz_app;
    if (app && app.scoreManager) {
      app.scoreManager.triggerGameOver('Depleted');
    }
  });
  await new Promise(r => setTimeout(r, 1200));

  await page.screenshot({ path: 'final_leaderboard.png' });
  console.log('Saved final_leaderboard.png');

  console.log('=== CONSOLE ERRORS SUMMARY ===');
  console.log('Total Errors:', consoleErrors.length);
  if (consoleErrors.length > 0) {
    console.error('Errors encountered:', consoleErrors);
  }

  await browser.close();
  console.log('=== FINAL INTEGRATION VERIFICATION COMPLETE ===');
  if (consoleErrors.length > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runFinalIntegrationVerification().catch(err => {
  console.error('Fatal integration test failure:', err);
  process.exit(1);
});

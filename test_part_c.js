import puppeteer from 'puppeteer';

async function runPartCTest() {
  console.log('--- STARTING VERDANT ZERO PART C VERIFICATION ---');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--window-size=1280,720'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('[vite]') && !text.includes('downloadable font')) {
      console.log(`[Browser Console]: ${text}`);
    }
  });

  page.on('pageerror', err => {
    console.error(`[Browser PageError]: ${err.message}`);
  });

  // Navigate to localhost:3000
  console.log('1. Navigating to http://localhost:3000/...');
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));

  // Verify Title Screen & Click Play
  console.log('2. Starting game from Title Screen...');
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1500));

  // Verify initial HUD & ScoreManager state
  const initialData = await page.evaluate(() => {
    const app = window.__vz_app;
    return {
      gameState: app.scoreManager.state,
      score: app.scoreManager.score,
      combo: app.scoreManager.combo,
      timer: app.scoreManager.timer,
      health: app.survival.health,
      water: app.survival.water,
      scoreDisplay: document.getElementById('hud-score-val')?.textContent,
      timerDisplay: document.getElementById('hud-timer-val')?.textContent
    };
  });
  console.log('Initial State:', initialData);

  if (initialData.gameState !== 'PLAYING') {
    throw new Error(`Expected gameState 'PLAYING', got ${initialData.gameState}`);
  }
  if (initialData.score !== 0) {
    throw new Error(`Expected initial score 0, got ${initialData.score}`);
  }
  if (initialData.combo !== 1) {
    throw new Error(`Expected initial combo 1, got ${initialData.combo}`);
  }
  if (initialData.timer < 175) {
    throw new Error(`Expected initial timer ~180s, got ${initialData.timer}`);
  }

  // TEST 1: Score & Combo progression
  console.log('3. Testing Score & Combo progression...');
  const comboResults = await page.evaluate(() => {
    const app = window.__vz_app;
    const sm = app.scoreManager;

    // Normal planting (not in smog)
    const plant1 = sm.recordPlanting(false); // base 50 * 1 = 50 pts
    const scoreAfter1 = sm.score;
    const comboAfter1 = sm.combo;

    // Chain planting within 6s
    const plant2 = sm.recordPlanting(false); // base 50 * 2 = 100 pts -> 150 total
    const scoreAfter2 = sm.score;
    const comboAfter2 = sm.combo;

    // Third chained planting
    const plant3 = sm.recordPlanting(false); // base 50 * 3 = 150 pts -> 300 total
    const scoreAfter3 = sm.score;
    const comboAfter3 = sm.combo;

    return {
      plant1, scoreAfter1, comboAfter1,
      plant2, scoreAfter2, comboAfter2,
      plant3, scoreAfter3, comboAfter3
    };
  });
  console.log('Combo Test Results:', comboResults);

  if (comboResults.comboAfter2 !== 2 || comboResults.comboAfter3 !== 3) {
    throw new Error(`Combo multiplier failed: expected 2 then 3, got ${comboResults.comboAfter2}, ${comboResults.comboAfter3}`);
  }
  if (comboResults.scoreAfter3 !== 300) {
    throw new Error(`Score calculation failed: expected 300, got ${comboResults.scoreAfter3}`);
  }

  // TEST 2: Risk Bonus in smog zone
  console.log('4. Testing Risk Bonus in smog zone...');
  const riskResult = await page.evaluate(() => {
    const app = window.__vz_app;
    const sm = app.scoreManager;
    const prevScore = sm.score; // 300
    // Planting in smog: base 50 * combo (4) * risk (2) = 400 pts -> 700 total
    const plantRisk = sm.recordPlanting(true);
    const toastRiskActive = document.getElementById('toast-risk')?.classList.contains('active');
    return {
      awarded: plantRisk.awarded,
      combo: plantRisk.combo,
      riskMultiplier: plantRisk.riskMultiplier,
      newScore: sm.score,
      delta: sm.score - prevScore,
      toastRiskActive
    };
  });
  console.log('Risk Bonus Results:', riskResult);

  if (riskResult.riskMultiplier !== 2 || riskResult.awarded !== 400) {
    throw new Error(`Risk bonus calculation failed: expected 400 pts (50*4*2), got ${riskResult.awarded}`);
  }
  if (!riskResult.toastRiskActive) {
    throw new Error('Risk toast failed to display');
  }

  // TEST 3: Combo Reset on Player Damage
  console.log('5. Testing Combo Reset on Player Damage...');
  const damageReset = await page.evaluate(() => {
    const app = window.__vz_app;
    // Apply damage to reset combo
    app.survival.applyDamage(15);
    return {
      health: app.survival.health,
      combo: app.scoreManager.combo,
      comboTimer: app.scoreManager.comboTimer
    };
  });
  console.log('Damage Reset Results:', damageReset);
  if (damageReset.combo !== 1 || damageReset.comboTimer !== 0) {
    throw new Error(`Damage failed to reset combo: combo is ${damageReset.combo}, timer is ${damageReset.comboTimer}`);
  }

  // TEST 4: Other Scoring events (Water +10, Drone pulse +25, Vine lost -200, Vine matured +100/1%)
  console.log('6. Testing Water, Drone Evaded, Vine Maturity & Vine Lost points...');
  const scoringEvents = await page.evaluate(() => {
    const app = window.__vz_app;
    const sm = app.scoreManager;
    const scoreBefore = sm.score;

    sm.recordWaterCollected(); // +10
    const scoreAfterWater = sm.score;

    sm.recordDroneEvaded(2); // +50 (25 * 2)
    const scoreAfterDrones = sm.score;

    sm.recordVineMatured(16.67); // +1667 (100 * 16.67)
    const scoreAfterMatured = sm.score;

    sm.recordVineDestroyed(); // -200
    const scoreAfterDestroyed = sm.score;

    return {
      waterDelta: scoreAfterWater - scoreBefore,
      dronesDelta: scoreAfterDrones - scoreAfterWater,
      maturedDelta: scoreAfterMatured - scoreAfterDrones,
      destroyedDelta: scoreAfterDestroyed - scoreAfterMatured,
      totalScore: sm.score
    };
  });
  console.log('Scoring Events Results:', scoringEvents);
  if (scoringEvents.waterDelta !== 10) throw new Error('Water drop score failed');
  if (scoringEvents.dronesDelta !== 50) throw new Error('Drone evasion score failed');
  if (scoringEvents.maturedDelta !== 1667) throw new Error('Vine maturity score failed');
  if (scoringEvents.destroyedDelta !== -200) throw new Error('Vine destroyed penalty failed');

  // TEST 5: Timer & 10% Milestone Bonus (+8s)
  console.log('7. Testing 10% Milestone Bonus (+8s)...');
  const milestoneResult = await page.evaluate(() => {
    const app = window.__vz_app;
    const sm = app.scoreManager;
    const timerBefore = sm.timer;

    // Cross 10% milestone
    sm.checkReclaimedMilestones(12.5);
    const timerAfter10 = sm.timer;
    const milestonePassed10 = sm.milestonesPassed.has(10);
    const toastMilestone = document.getElementById('toast-milestone')?.textContent;

    // Cross 20% milestone
    sm.checkReclaimedMilestones(22.0);
    const timerAfter20 = sm.timer;
    const milestonePassed20 = sm.milestonesPassed.has(20);

    return {
      timerBefore,
      timerAfter10,
      gain10: timerAfter10 - timerBefore,
      milestonePassed10,
      timerAfter20,
      gain20: timerAfter20 - timerAfter10,
      milestonePassed20,
      toastMilestone
    };
  });
  console.log('Milestone Results:', milestoneResult);
  if (Math.abs(milestoneResult.gain10 - 8.0) > 0.1 || !milestoneResult.milestonePassed10) {
    throw new Error(`Milestone +8s bonus failed for 10%: gain=${milestoneResult.gain10}`);
  }
  if (Math.abs(milestoneResult.gain20 - 8.0) > 0.1 || !milestoneResult.milestonePassed20) {
    throw new Error(`Milestone +8s bonus failed for 20%: gain=${milestoneResult.gain20}`);
  }

  // Wait 500ms and take screenshot of active HUD
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'screenshot_part_c_hud.png' });
  console.log('Captured screenshot_part_c_hud.png');

  // TEST 6: Game Over Trigger on Health = 0 & Camera Pullback
  console.log('8. Testing Game Over Trigger on Health = 0...');
  const goResult = await page.evaluate(() => {
    const app = window.__vz_app;
    // Inflict lethal damage
    app.survival.applyDamage(150);

    const isGameOver = app.scoreManager.state === 'GAMEOVER';
    const modalOpen = document.getElementById('modal-gameover')?.classList.contains('open');
    const goScoreText = document.getElementById('go-score')?.textContent;
    const cameraMode = app.cameraController.mode;

    return {
      isGameOver,
      modalOpen,
      goScoreText,
      cameraMode
    };
  });
  console.log('Game Over State:', goResult);

  if (!goResult.isGameOver || !goResult.modalOpen) {
    throw new Error('Game Over modal failed to open upon depletion');
  }
  if (goResult.cameraMode !== 'GAMEOVER') {
    throw new Error(`Expected cameraMode 'GAMEOVER', got ${goResult.cameraMode}`);
  }

  // Let count-up animation settle
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'screenshot_part_c_gameover.png' });
  console.log('Captured screenshot_part_c_gameover.png');

  // TEST 7: LocalStorage Persistence across page reload
  console.log('9. Testing LocalStorage Persistence across page reload...');
  const savedScoreBefore = await page.evaluate(() => localStorage.getItem('vz_high_score'));
  console.log(`Saved High Score before reload: ${savedScoreBefore}`);

  if (!savedScoreBefore || parseInt(savedScoreBefore, 10) <= 0) {
    throw new Error('Failed to save high score in localStorage');
  }

  // Reload page
  console.log('Reloading page to test persistence...');
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));

  const persistentData = await page.evaluate(() => {
    const highScore = localStorage.getItem('vz_high_score');
    const runHistory = localStorage.getItem('vz_run_history');
    return {
      highScore,
      runHistory: runHistory ? JSON.parse(runHistory) : []
    };
  });
  console.log('Persistent Storage Data after reload:', persistentData);

  if (persistentData.highScore !== savedScoreBefore) {
    throw new Error(`High score did not persist: expected ${savedScoreBefore}, got ${persistentData.highScore}`);
  }
  if (!Array.isArray(persistentData.runHistory) || persistentData.runHistory.length === 0) {
    throw new Error('Run history did not persist in localStorage');
  }

  // TEST 8: Instant Restart (<1s with no page reload)
  console.log('10. Testing Instant Restart (<1s, reusing geometry)...');
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1200));

  const restartBenchmark = await page.evaluate(() => {
    const t0 = performance.now();
    // Trigger instant restart
    window.__vz_app.restartGame();
    const t1 = performance.now();
    const durationMs = t1 - t0;

    const app = window.__vz_app;
    return {
      durationMs,
      gameState: app.scoreManager.state,
      score: app.scoreManager.score,
      health: app.survival.health,
      water: app.survival.water,
      timer: app.scoreManager.timer,
      cameraMode: app.cameraController.mode
    };
  });
  console.log('Instant Restart Benchmark:', restartBenchmark);

  if (restartBenchmark.durationMs >= 1000) {
    throw new Error(`Restart took too long: ${restartBenchmark.durationMs}ms (must be <1000ms)`);
  }
  if (restartBenchmark.gameState !== 'PLAYING' || restartBenchmark.score !== 0 || restartBenchmark.health !== 100) {
    throw new Error('Restart failed to restore initial state');
  }

  // TEST 9: Instant Restart via 'KeyR'
  console.log('11. Testing Instant Restart via KeyR...');
  await page.keyboard.press('KeyR');
  await new Promise(r => setTimeout(r, 200));

  const keyRState = await page.evaluate(() => ({
    gameState: window.__vz_app.scoreManager.state,
    score: window.__vz_app.scoreManager.score,
    health: window.__vz_app.survival.health
  }));
  console.log('KeyR Restart State:', keyRState);
  if (keyRState.gameState !== 'PLAYING' || keyRState.score !== 0 || keyRState.health !== 100) {
    throw new Error('KeyR restart failed');
  }

  await browser.close();
  console.log('\n========================================');
  console.log('>>> ALL PART C CHECKLIST ITEMS PASSED! <<<');
  console.log('========================================\n');
}

runPartCTest().catch(err => {
  console.error('\n*** PART C VERIFICATION FAILED ***\n', err);
  process.exit(1);
});

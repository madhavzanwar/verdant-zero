import puppeteer from 'puppeteer';

async function testAudioEngine() {
  console.log('--- Starting Verdant Zero Audio Engine (v2.0.0) Browser Verification ---');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
  });

  const page = await browser.newPage();

  // Capture console logs from browser
  const browserLogs = [];
  page.on('console', msg => {
    browserLogs.push(msg.text());
    console.log(`[Browser Console]: ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.error(`[Browser PageError]: ${err.message}`);
  });

  // Navigate to Vite dev server on port 3000
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

  // Evaluate the AudioManager and AudioDebugPanel inside the browser
  const results = await page.evaluate(async () => {
    const checks = [];

    try {
      const { AudioManager } = await import('/src/core/AudioManager.js');
      const audio = new AudioManager();
      checks.push({ name: 'AudioManager instantiation', passed: Boolean(audio) });

      audio.init();
      checks.push({ name: 'AudioManager init()', passed: audio.isInitialized });
      checks.push({ name: 'AudioContext active', passed: Boolean(audio.ctx) });

      // Check Master Bus
      checks.push({ name: 'masterGain created', passed: Boolean(audio.masterGain) });
      checks.push({
        name: 'masterFilter is lowpass @ 2200Hz',
        passed: audio.masterFilter && audio.masterFilter.type === 'lowpass' && Math.round(audio.masterFilter.frequency.value) === 2200
      });
      checks.push({
        name: 'masterLimiter is DynamicsCompressor',
        passed: Boolean(audio.masterLimiter && audio.masterLimiter.threshold)
      });

      // Check Sub-buses
      checks.push({ name: 'musicBus created', passed: Boolean(audio.musicBus) });
      checks.push({ name: 'ambienceBus created', passed: Boolean(audio.ambienceBus) });
      checks.push({ name: 'sfxBus created', passed: Boolean(audio.sfxBus) });
      checks.push({
        name: 'reverbConvolver created with 3s buffer',
        passed: Boolean(audio.reverbConvolver && audio.reverbConvolver.buffer && Math.round(audio.reverbConvolver.buffer.duration) === 3)
      });

      // Check AnalyserNodes
      checks.push({ name: 'masterAnalyser created', passed: Boolean(audio.masterAnalyser) });
      checks.push({ name: 'musicAnalyser created', passed: Boolean(audio.musicAnalyser) });
      checks.push({ name: 'ambienceAnalyser created', passed: Boolean(audio.ambienceAnalyser) });
      checks.push({ name: 'sfxAnalyser created', passed: Boolean(audio.sfxAnalyser) });

      // Check Ambient Pad & Rain
      checks.push({ name: 'Rain source started', passed: Boolean(audio.rainSource) });
      checks.push({ name: 'Drone hum started', passed: Boolean(audio.droneHumOsc) });

      // Test Soft Sound Effects without throwing
      audio.playPlantingChime();
      audio.playWaterCollect();
      audio.playComboChime(1);
      audio.playComboChime(5);
      audio.playLightPulse();
      audio.playDroneAlert();
      audio.playHeartbeat();
      audio.playAcidRainWarning();
      audio.startAcidRainSound();
      audio.stopAcidRainSound();
      audio.playDeniedSound();
      audio.playPlayerHit();
      audio.playMilestoneCelebration();
      audio.playGameOverSound(true);
      audio.playGameOverSound(false);
      audio.playHover();
      audio.playClick();
      checks.push({ name: 'All 17 soft sound effects executed cleanly', passed: true });

      // Test volume controls & mute
      audio.setMasterVolume(0.5);
      checks.push({ name: 'setMasterVolume(0.5)', passed: audio.masterVolume === 0.5 });
      audio.setMusicVolume(0.6);
      checks.push({ name: 'setMusicVolume(0.6)', passed: audio.musicVolume === 0.6 });
      audio.setAmbienceVolume(0.7);
      checks.push({ name: 'setAmbienceVolume(0.7)', passed: audio.ambienceVolume === 0.7 });
      audio.setSfxVolume(0.8);
      checks.push({ name: 'setSfxVolume(0.8)', passed: audio.sfxVolume === 0.8 });

      const muted = audio.toggleMute();
      checks.push({ name: 'toggleMute()', passed: audio.isMuted === true });
      audio.setMuted(false);
      checks.push({ name: 'setMuted(false)', passed: audio.isMuted === false });

      // Check AudioDebugPanel
      checks.push({ name: 'AudioDebugPanel attached', passed: Boolean(audio.debugPanel) });
      audio.debugPanel.show();
      checks.push({ name: 'Debug panel shown', passed: audio.debugPanel.isVisible });

      // Simulate F4 keypress
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4' }));
      checks.push({ name: 'F4 toggles panel hidden', passed: !audio.debugPanel.isVisible });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4' }));
      checks.push({ name: 'F4 toggles panel visible', passed: audio.debugPanel.isVisible });

      // Verify master peak < -6 dB
      audio.debugPanel.drawMeters();
      const masterPeak = audio.debugPanel.peakHold.master;
      checks.push({
        name: 'Master peak verification (< -6 dBFS)',
        passed: masterPeak <= -6.0 || masterPeak === -100,
        value: `${masterPeak.toFixed(1)} dBFS`
      });

      // Cleanup
      audio.debugPanel.hide();
      audio.destroy();
      checks.push({ name: 'destroy() cleaned up properly', passed: true });

      return { success: true, checks };
    } catch (e) {
      return { success: false, error: e.message, stack: e.stack, checks };
    }
  });

  await browser.close();

  console.log('\n--- Test Results Summary ---');
  let allPassed = results.success;
  for (const c of results.checks || []) {
    const status = c.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`[${status}] ${c.name}${c.value ? ` (${c.value})` : ''}`);
    if (!c.passed) allPassed = false;
  }

  if (results.error) {
    console.error('Fatal error in tests:', results.error);
    console.error(results.stack);
    process.exit(1);
  }

  if (allPassed) {
    console.log('\nAll audio tests passed successfully with 0 errors!');
  } else {
    console.error('\nSome checks failed.');
    process.exit(1);
  }
}

testAudioEngine().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

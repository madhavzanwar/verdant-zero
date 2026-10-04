import puppeteer from 'puppeteer';

async function testPeakStress() {
  console.log('--- Running Audio Limiter Peak Stress Test ---');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });

  const stressResults = await page.evaluate(async () => {
    const { AudioManager } = await import('/src/core/AudioManager.js');
    const audio = new AudioManager();
    audio.init();

    // Ensure audio context is running
    if (audio.ctx.state === 'suspended') {
      await audio.ctx.resume();
    }

    // Set all buses to maximum volume to test limiter protection
    audio.setMasterVolume(1.0);
    audio.setMusicVolume(1.0);
    audio.setAmbienceVolume(1.0);
    audio.setSfxVolume(1.0);

    // Fire heavy concurrent sound effects
    for (let i = 0; i < 5; i++) {
      audio.playPlantingChime();
      audio.playWaterCollect();
      audio.playComboChime(5);
      audio.playLightPulse();
      audio.playDroneAlert();
      audio.playMilestoneCelebration();
      audio.playGameOverSound(true);
      audio.playHeartbeat();
    }

    // Measure peaks over 500ms
    let maxPeakObserved = -100;
    const timeData = new Float32Array(512);

    for (let frame = 0; frame < 30; frame++) {
      await new Promise(r => setTimeout(r, 20));
      audio.masterAnalyser.getFloatTimeDomainData(timeData);

      for (let j = 0; j < timeData.length; j++) {
        const absVal = Math.abs(timeData[j]);
        if (absVal > 1e-4) {
          const db = 20 * Math.log10(absVal);
          if (db > maxPeakObserved) {
            maxPeakObserved = db;
          }
        }
      }
    }

    audio.destroy();

    return {
      maxPeakObserved,
      isUnderSafeCeiling: maxPeakObserved <= -6.0
    };
  });

  await browser.close();

  console.log(`Max Master Peak Observed under maximum concurrency: ${stressResults.maxPeakObserved.toFixed(2)} dBFS`);
  console.log(`Strict Limiter Ceiling Check (< -6.0 dBFS): ${stressResults.isUnderSafeCeiling ? 'PASSED ✓' : 'FAILED ✗'}`);

  if (!stressResults.isUnderSafeCeiling) {
    console.error('Peak exceeded -6 dBFS!');
    process.exit(1);
  } else {
    console.log('Peak stress test passed: Audio master output is strictly limited below -6 dBFS!');
  }
}

testPeakStress().catch(err => {
  console.error('Stress test error:', err);
  process.exit(1);
});

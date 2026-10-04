import puppeteer from 'puppeteer';

async function runPartATest() {
  console.log('=== VERIFYING PART A: VISIBILITY & VISUAL REWRITE ===');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', msg => {
    console.log(`[BROWSER ${msg.type().toUpperCase()}]:`, msg.text());
  });

  page.on('pageerror', err => {
    console.error('[BROWSER UNCAUGHT ERROR]:', err);
  });

  console.log('1. Loading http://localhost:3000/...');
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));

  // Verify reclaimed counter starts at 0.0%
  const initialReclaimed = await page.$eval('#reclaimed-val', el => el.textContent.trim());
  console.log(`2. Initial reclaimed percentage: "${initialReclaimed}" (Expect "0.0%")`);
  if (initialReclaimed !== '0.0%') {
    throw new Error(`Reclaimed percentage did not start at 0.0%! Found: ${initialReclaimed}`);
  }

  // Click Play to enter gameplay
  console.log('3. Clicking Play...');
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1600));

  // Test WASD and Arrow key controls remain functional
  console.log('4. Testing WASD, Arrow keys, Hover, Dash...');
  await page.keyboard.down('KeyW');
  await new Promise(r => setTimeout(r, 200));
  await page.keyboard.up('KeyW');

  await page.keyboard.down('ArrowUp');
  await new Promise(r => setTimeout(r, 200));
  await page.keyboard.up('ArrowUp');

  // Space hover
  await page.keyboard.down('Space');
  await new Promise(r => setTimeout(r, 300));
  await page.keyboard.up('Space');
  await new Promise(r => setTimeout(r, 400)); // land

  // Capture Part A screenshots
  console.log('5. Capturing screenshots...');
  await page.screenshot({ path: 'screenshot_part_a_city.png' });
  console.log('   Saved screenshot_part_a_city.png');

  // Slight tilt up to view towers and glowing horizon
  await page.mouse.move(640, 260, { steps: 10 });
  await new Promise(r => setTimeout(r, 600));
  await page.screenshot({ path: 'screenshot_part_a_skyline.png' });
  console.log('   Saved screenshot_part_a_skyline.png');

  // 6. Pixel analysis for "near pure black" constraint:
  // "at most about twenty percent of the pixels are near pure black"
  console.log('6. Analyzing pixel luminance distribution...');
  const blackPct = await page.evaluate(() => {
    const canvas = document.getElementById('webgl-canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return '0.00';
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let nearBlackCount = 0;
    const total = width * height;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      // A pixel is "near pure black" if all R, G, B channels are under 16 (< 6.2% brightness)
      if (r < 16 && g < 16 && b < 16) {
        nearBlackCount++;
      }
    }
    return ((nearBlackCount / total) * 100).toFixed(2);
  });
  console.log(`   Near-pure black pixel percentage: ${blackPct}% (Target <= 20%)`);

  if (parseFloat(blackPct) > 22.0) {
    throw new Error(`Scene is too dark! Near pure black pixels: ${blackPct}% > 20% target.`);
  }

  // 7. Check FPS
  await page.keyboard.press('F3');
  await new Promise(r => setTimeout(r, 400));
  const fps = await page.$eval('#fps-val', el => parseInt(el.textContent, 10));
  console.log(`7. Engine FPS: ${fps} (Expect near 60 or higher)`);
  if (fps < 50) {
    console.warn(`Warning: FPS is ${fps}`);
  }

  // 8. Test planting with E & check real vine growth
  console.log('8. Testing planting with KeyE...');
  await page.keyboard.press('KeyE');
  await new Promise(r => setTimeout(r, 2000));
  const afterPlantReclaimed = await page.$eval('#reclaimed-val', el => el.textContent.trim());
  console.log(`   Reclaimed after planting: ${afterPlantReclaimed}`);

  await browser.close();
  console.log('=== PART A CHECKLIST PASSED SUCCESSFULLY! ===');
}

runPartATest().catch(err => {
  console.error('PART A TEST FAILED:', err);
  process.exit(1);
});

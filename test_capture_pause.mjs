import puppeteer from 'puppeteer';

async function capturePauseMenu() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1200));

  await page.evaluate(() => {
    window.__vz_app.openPauseMenu();
  });
  await new Promise(r => setTimeout(r, 500));

  await page.screenshot({ path: 'verification_pause_settings.png' });
  console.log('Captured verification_pause_settings.png');

  await browser.close();
}

capturePauseMenu().catch(console.error);

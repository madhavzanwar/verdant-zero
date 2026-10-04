import puppeteer from 'puppeteer';

async function captureFrontView() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));
  await page.click('#btn-play');
  await new Promise(r => setTimeout(r, 1200));

  // Rotate robot to face the camera directly
  await page.evaluate(() => {
    const robot = window.__vz_app.robot;
    robot.mesh.rotation.y = Math.PI;
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: 'screenshot_robot_front.png' });
  console.log('Front view captured: screenshot_robot_front.png');
  await browser.close();
}

captureFrontView().catch(console.error);

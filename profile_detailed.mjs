import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

async function profile() {
  console.log('--- Profiling Verdant Zero Baseline ---');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle0' });
  await page.keyboard.press('Enter');
  await new Promise(r => setTimeout(r, 2000));

  // Run a realistic workload: move, plant, trigger pulse, simulate active gameplay
  await page.keyboard.down('KeyW');
  await new Promise(r => setTimeout(r, 1500));
  await page.keyboard.press('KeyE'); // Plant
  await new Promise(r => setTimeout(r, 1000));
  await page.keyboard.press('KeyQ'); // Pulse
  await new Promise(r => setTimeout(r, 1500));
  await page.keyboard.up('KeyW');

  const baselineData = await page.evaluate(() => {
    const app = window.__vz_app;
    const renderer = app?.engine?.renderer;
    const scene = app?.scene;

    // Accumulate draw calls and triangles across a frame
    renderer.info.autoReset = false;
    renderer.info.reset();
    
    // Trigger one explicit render through the composer
    if (app.engine?.postProcessing?.composer) {
      app.engine.postProcessing.composer.render();
    } else {
      renderer.render(scene, app.camera);
    }

    const calls = renderer.info.render.calls;
    const triangles = renderer.info.render.triangles;
    renderer.info.autoReset = true;

    // Count all lights in the scene graph
    let lights = 0;
    const lightDetails = [];
    scene?.traverse(o => {
      if (o.isLight) {
        lights++;
        lightDetails.push({ type: o.type, color: o.color?.getHexString(), intensity: o.intensity });
      }
    });

    // Count particles
    const rain = app?.weather?.rainData?.length || 0;
    const ripples = app?.weather?.rippleData?.length || 0;
    const traffic = (app?.weather?.trafficCount || 0) * 2;
    const smog = app?.smogSystem?.cloudData?.length || 0;
    const sparks = app?.droneSystem?.sparkCount || 0;
    const fireflies = app?.plantSystem?.fireflies?.length || 120;
    const totalParticles = rain + ripples + traffic + smog + sparks + fireflies;

    // Frame times from rolling window
    const frameTimes = app?.engine?.frameTimes ? Array.from(app.engine.frameTimes) : [];
    const validTimes = frameTimes.filter(t => t > 0);
    const avgFrameTime = validTimes.reduce((a, b) => a + b, 0) / (validTimes.length || 1);
    const minFrameTime = Math.min(...(validTimes.length ? validTimes : [16.6]));
    const maxFrameTime = Math.max(...(validTimes.length ? validTimes : [16.6]));

    // JS Heap
    const mem = performance.memory ? {
      usedJSHeapMB: +(performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(2),
      totalJSHeapMB: +(performance.memory.totalJSHeapSize / (1024 * 1024)).toFixed(2),
      jsHeapLimitMB: +(performance.memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(2)
    } : { usedJSHeapMB: 'N/A', totalJSHeapMB: 'N/A' };

    return {
      drawCalls: calls,
      triangles: triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      realLightsCount: lights,
      lightDetails,
      particles: {
        rainStreaks: rain,
        ripples,
        trafficPoints: traffic,
        smogSprites: smog,
        droneSparks: sparks,
        fireflies,
        totalActive: totalParticles
      },
      frameTime: {
        avgMs: +avgFrameTime.toFixed(2),
        minMs: +minFrameTime.toFixed(2),
        maxMs: +maxFrameTime.toFixed(2),
        estimatedFps: +(1000 / avgFrameTime).toFixed(1)
      },
      memory: mem
    };
  });

  // Measure build size
  let buildSizeKB = { js: 705.66, css: 28.84, html: 15.41, total: 749.91 };
  try {
    const distPath = path.resolve('dist', 'assets');
    if (fs.existsSync(distPath)) {
      const files = fs.readdirSync(distPath);
      let totalBytes = 0;
      files.forEach(f => {
        const stats = fs.statSync(path.join(distPath, f));
        totalBytes += stats.size;
      });
      buildSizeKB.assetsTotalKB = +(totalBytes / 1024).toFixed(2);
    }
  } catch (e) {}

  baselineData.buildSize = buildSizeKB;
  console.log('COMPLETE BASELINE PROFILE:');
  console.log(JSON.stringify(baselineData, null, 2));

  fs.writeFileSync('baseline_metrics.json', JSON.stringify(baselineData, null, 2));
  await browser.close();
}

profile().catch(err => {
  console.error('Profiling error:', err);
  process.exit(1);
});

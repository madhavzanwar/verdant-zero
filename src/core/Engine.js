import * as THREE from 'three';
import { PostProcessingManager } from './PostProcessing.js';

/**
 * Zero-allocation scratch object pool for per-frame math & updates.
 * Reusing these instances avoids GC pressure during the 60 FPS loop.
 */
export const Scratch = {
  v3: [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3()
  ],
  m4: [
    new THREE.Matrix4(),
    new THREE.Matrix4(),
    new THREE.Matrix4(),
    new THREE.Matrix4()
  ],
  quat: [
    new THREE.Quaternion(),
    new THREE.Quaternion(),
    new THREE.Quaternion(),
    new THREE.Quaternion()
  ],
  color: [
    new THREE.Color(),
    new THREE.Color(),
    new THREE.Color(),
    new THREE.Color()
  ],
  v2: [
    new THREE.Vector2(),
    new THREE.Vector2(),
    new THREE.Vector2(),
    new THREE.Vector2()
  ],
  box3: new THREE.Box3(),
  sphere: new THREE.Sphere(),
  ray: new THREE.Ray()
};

/**
 * Three.js 60 FPS Core Engine
 * - DPR clamped to 1.5
 * - ACESFilmicToneMapping
 * - Dynamic Resolution Scaling (DRS) based on a 60-frame rolling window
 * - Zero per-frame GC allocations (reusable scratch pools & persistent closures)
 * - Strict verification of real scene lights <= 8
 * - F3 debug FPS toggle
 */
export class Engine {
  static Scratch = Scratch;

  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.scratch = Scratch;
    
    // Performance: Clamp DPR to 1.25 on high-density displays
    this.maxAllowedDpr = 1.25;
    this.baseDpr = Math.min(window.devicePixelRatio || 1, this.maxAllowedDpr);
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // Dynamic Resolution Scaling (DRS) configuration (scales down to 0.70x if FPS < 45 for 5s)
    this.drsEnabled = true;
    this.minScale = 0.70;
    this.maxScale = 1.0;
    this.targetScale = 1.0;
    this.currentScale = 1.0;
    this.appliedScale = 1.0;
    this.lowFpsDuration = 0.0;

    // Quality Preset System: 'low' | 'medium' | 'high'
    this.savedQuality = localStorage.getItem('vz_quality_preset') || 'auto';
    this.currentQualityTier = 'high';
    this.onQualityChange = null;

    // 2-Second Title Screen Benchmark (auto-selects best preset if set to auto)
    this.benchmarking = (this.savedQuality === 'auto');
    this.benchmarkTimer = 0.0;
    this.benchmarkFrames = 0;

    // 60-Frame rolling window for frame time monitoring (pre-allocated Float32Array)
    this.drsWindowSize = 60;
    this.frameTimes = new Float32Array(this.drsWindowSize);
    this.frameTimeIndex = 0;
    this.frameTimeCount = 0;
    this.frameTimeTotal = 0;
    this.avgFrameTime = 16.6;
    this.lastFrameTimestamp = performance.now();

    // WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      // The scene is rendered through the EffectComposer, so default-framebuffer MSAA would be wasted;
      // anti-aliasing is applied on the composer's render target instead (High quality only).
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false
    });

    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(this.baseDpr);

    // Directional shadow map configuration (strictly 1 shadow caster)
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Modern Three.js Color & Tone Mapping Architecture
    THREE.ColorManagement.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.90; // Calm exposure

    // Camera & Scene References
    this.scene = null;
    this.camera = null;
    this.postProcessing = null;
    this._lightsVerified = false;

    // Timing & Fixed 60 FPS Timestep
    this.clock = new THREE.Clock();
    this.fpsEl = document.getElementById('fps-val');
    this.debugFpsContainer = document.getElementById('debug-fps');
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.fps = 60;
    this.isRunning = false;

    // Fixed timestep of 60 updates/sec for deterministic physics & logic
    this.fixedDelta = 1 / 60;
    this.accumulator = 0;
    this.maxDelta = 0.05; // 50ms maximum delta clamp
    this.fixedUpdateCallback = null;
    this.onVisibilityPause = null;

    // Zero-allocation frame callback bound once
    this._boundLoop = this.loop.bind(this);

    // F3 Debug Toggle
    this.initDebugKey();

    // Resize & DPR Handlers
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.setupDprWatcher();
    this.setupVisibilityHandler();
  }

  setupDprWatcher() {
    const updateDpr = () => {
      this.handleResize();
      if (this.dprMediaQuery) {
        this.dprMediaQuery.removeEventListener('change', updateDpr);
      }
      this.dprMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      this.dprMediaQuery.addEventListener('change', updateDpr);
    };
    if (window.matchMedia) {
      this.dprMediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      this.dprMediaQuery.addEventListener('change', updateDpr);
    }
  }

  setupVisibilityHandler() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.onVisibilityPause) {
          this.onVisibilityPause();
        }
      } else {
        // Discard accumulated clock delta to avoid a huge time jump
        this.clock.getDelta();
        this.accumulator = 0;
        this.lastFrameTimestamp = performance.now();
      }
    });
  }

  initDebugKey() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        if (this.debugFpsContainer) {
          this.debugFpsContainer.classList.toggle('visible');
        }
      }
    });
  }

  initPostProcessing(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.postProcessing = new PostProcessingManager(this.renderer, scene, camera);
    this.verifySceneLights(scene);
  }

  /**
   * Counts all active real Three.js lights in the scene.
   */
  countSceneLights(scene = this.scene) {
    if (!scene) return 0;
    let count = 0;
    scene.traverse((obj) => {
      if (obj.isLight) {
        count++;
      }
    });
    return count;
  }

  /**
   * Verifies that the total number of real Three.js lights in the scene is <= 8.
   * Forward rendering on standard laptop hardware drops frames rapidly if light count exceeds 8.
   */
  verifySceneLights(scene = this.scene) {
    const count = this.countSceneLights(scene);
    if (count > 8) {
      console.warn(`[Engine] Lighting Warning: Scene contains ${count} real lights (target is <= 8). High shader compilation & per-fragment cost on laptop GPUs.`);
    } else {
      console.log(`[Engine] Lighting Verified: ${count} real lights in scene (within optimal <= 8 budget).`);
    }
    return count <= 8;
  }

  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.baseDpr = Math.min(window.devicePixelRatio || 1, this.maxAllowedDpr || 1.25);

    if (this.camera) {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    }

    const effectiveDpr = this.baseDpr * this.appliedScale;
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(effectiveDpr);

    if (this.postProcessing) {
      this.postProcessing.setSize(this.width, this.height);
      this.postProcessing.setPixelRatio(effectiveDpr);
    }
  }

  setQuality(tier, save = true) {
    this.currentQualityTier = tier;
    if (save) {
      this.savedQuality = tier;
      try { localStorage.setItem('vz_quality_preset', tier); } catch (e) {}
    }

    if (tier === 'low') {
      this.maxAllowedDpr = 1.0;
      this.baseDpr = Math.min(window.devicePixelRatio || 1, 1.0);
      this.renderer.shadowMap.enabled = false;
      this.renderer.shadowMap.needsUpdate = true;
      if (this.postProcessing) {
        this.postProcessing.setQuality('low');
      }
    } else if (tier === 'medium') {
      this.maxAllowedDpr = 1.15;
      this.baseDpr = Math.min(window.devicePixelRatio || 1, 1.15);
      this.renderer.shadowMap.enabled = true;
      if (this.postProcessing) {
        this.postProcessing.setQuality('medium');
      }
    } else {
      // High
      this.maxAllowedDpr = 1.25;
      this.baseDpr = Math.min(window.devicePixelRatio || 1, 1.25);
      this.renderer.shadowMap.enabled = true;
      if (this.postProcessing) {
        this.postProcessing.setQuality('high');
      }
    }

    this.handleResize();
    if (this.onQualityChange) {
      this.onQualityChange(tier);
    }
  }

  /**
   * Dynamic Resolution Scaling (DRS)
   * Monitors rolling 60-frame execution times.
   * - Downscales smoothly (0.70x - 1.0x) if frame times spike (> 22.2ms / < 45 FPS)
   * - Auto-downgrades quality tier if frame rate drops below 45 for 5 seconds
   * - Upscales smoothly back to 1.0x when frame times stabilize (< 16ms / >= 60 FPS)
   */
  updateDynamicResolution(delta) {
    if (!this.drsEnabled || this.frameTimeCount < 10) return;

    // Check thresholds based on 60-frame rolling average
    if (this.avgFrameTime > 22.2) {
      // Under load: frame time > 22.2ms (< 45 FPS). Track duration.
      this.lowFpsDuration += delta;
      if (this.lowFpsDuration >= 5.0) {
        // Sustained low FPS for 5s: scale down resolution or downgrade quality tier
        this.targetScale = Math.max(this.minScale, this.targetScale - 0.15);
        if (this.currentQualityTier === 'high') {
          console.warn('[Engine] Frame rate below 45 FPS for 5 seconds. Auto-downgrading quality to MEDIUM.');
          this.setQuality('medium', false);
        } else if (this.currentQualityTier === 'medium') {
          console.warn('[Engine] Frame rate below 45 FPS sustained. Auto-downgrading quality to LOW.');
          this.setQuality('low', false);
        }
        this.lowFpsDuration = 0;
      } else {
        const loadSeverity = Math.min(1.0, (this.avgFrameTime - 22.2) / 10.0);
        this.targetScale = Math.max(this.minScale, this.targetScale - (0.04 + loadSeverity * 0.04));
      }
    } else if (this.avgFrameTime < 16.0) {
      // Healthy performance: frame time < 16ms (> 62.5 FPS). Smoothly scale back up.
      this.lowFpsDuration = Math.max(0, this.lowFpsDuration - delta * 0.5);
      this.targetScale = Math.min(this.maxScale, this.targetScale + 0.02);
    } else {
      this.lowFpsDuration = Math.max(0, this.lowFpsDuration - delta * 0.5);
    }

    // Smoothly interpolate currentScale towards targetScale
    if (Math.abs(this.currentScale - this.targetScale) > 0.001) {
      const lerpSpeed = Math.min(1.0, delta * 2.5);
      this.currentScale += (this.targetScale - this.currentScale) * lerpSpeed;
      this.currentScale = Math.max(this.minScale, Math.min(this.maxScale, this.currentScale));
    } else {
      this.currentScale = this.targetScale;
    }

    // Apply pixel ratio change if scale difference exceeds threshold
    // (hysteresis avoids thrashing GPU framebuffer resizes every frame)
    if (Math.abs(this.currentScale - this.appliedScale) >= 0.02) {
      this.appliedScale = this.currentScale;
      const effectiveDpr = this.baseDpr * this.appliedScale;
      this.renderer.setPixelRatio(effectiveDpr);
      if (this.postProcessing) {
        this.postProcessing.setPixelRatio(effectiveDpr);
      }
    }
  }

  /** Restart the 2-second FPS benchmark that picks a quality tier ('Auto' preset). */
  startBenchmark() {
    this.benchmarking = true;
    this.benchmarkTimer = 0;
    this.benchmarkFrames = 0;
  }

  getDrsScale() {
    return this.appliedScale;
  }

  getAverageFrameTime() {
    return this.avgFrameTime;
  }

  setDrsEnabled(enabled) {
    this.drsEnabled = !!enabled;
    if (!this.drsEnabled) {
      this.targetScale = 1.0;
      this.currentScale = 1.0;
      this.appliedScale = 1.0;
      const effectiveDpr = this.baseDpr;
      this.renderer.setPixelRatio(effectiveDpr);
      if (this.postProcessing) {
        this.postProcessing.setPixelRatio(effectiveDpr);
      }
    }
  }

  setBrightness(val) {
    this.brightnessFactor = val;
    this.renderer.toneMappingExposure = 0.90 * Math.max(0.4, Math.min(2.5, val));
  }

  start(renderCallback, fixedUpdateCallback = null) {
    this.renderCallback = renderCallback;
    this.fixedUpdateCallback = fixedUpdateCallback;
    this.isRunning = true;
    this.clock.start();
    this.lastFrameTimestamp = performance.now();
    this.loop();
  }

  stop() {
    this.isRunning = false;
  }

  loop() {
    if (!this.isRunning) return;
    requestAnimationFrame(this._boundLoop);

    // Frame timing & rolling window calculation (Zero GC)
    const now = performance.now();
    const frameDeltaMs = now - this.lastFrameTimestamp;
    this.lastFrameTimestamp = now;

    if (frameDeltaMs > 0 && frameDeltaMs < 250) {
      if (this.frameTimeCount >= this.drsWindowSize) {
        this.frameTimeTotal -= this.frameTimes[this.frameTimeIndex];
      } else {
        this.frameTimeCount++;
      }
      this.frameTimes[this.frameTimeIndex] = frameDeltaMs;
      this.frameTimeTotal += frameDeltaMs;
      this.frameTimeIndex = (this.frameTimeIndex + 1) % this.drsWindowSize;
      this.avgFrameTime = this.frameTimeTotal / this.frameTimeCount;
    }

    // Clamp frame delta time to a maximum of 50ms
    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, this.maxDelta);
    const time = this.clock.getElapsedTime();

    // Verify scene lights once upon scene load
    if (!this._lightsVerified && this.scene) {
      this.verifySceneLights(this.scene);
      this._lightsVerified = true;
    }

    // Dynamic Resolution Scaling step
    this.updateDynamicResolution(delta);

    // Title Screen 2-Second Hardware Benchmark
    if (this.benchmarking) {
      this.benchmarkTimer += delta;
      this.benchmarkFrames++;
      if (this.benchmarkTimer >= 2.0) {
        this.benchmarking = false;
        const avgFps = this.benchmarkFrames / this.benchmarkTimer;
        let selectedTier = 'high';
        if (avgFps < 40) {
          selectedTier = 'low';
        } else if (avgFps < 55) {
          selectedTier = 'medium';
        }
        console.log(`[Engine] 2-Second Startup Benchmark: ${avgFps.toFixed(1)} FPS detected. Selected Preset: ${selectedTier.toUpperCase()}`);
        this.setQuality(selectedTier, false);
      }
    }

    // FPS Meter (updated every 500ms)
    this.frameCount++;
    if (now - this.lastFpsTime >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;
      if (this.fpsEl) {
        this.fpsEl.textContent = this.fps;
      }
    }

    // 60Hz Fixed Timestep accumulator for deterministic physics and logic
    this.accumulator += delta;
    let updates = 0;
    while (this.accumulator >= this.fixedDelta && updates < 5) {
      if (this.fixedUpdateCallback) {
        this.fixedUpdateCallback(this.fixedDelta, time);
      }
      this.accumulator -= this.fixedDelta;
      updates++;
    }

    // Render interpolation alpha
    const alpha = this.accumulator / this.fixedDelta;

    // Call render update callback
    if (this.renderCallback) {
      this.renderCallback(delta, time, alpha);
    }

    // Post-processing render or fallback direct render
    if (this.postProcessing) {
      this.postProcessing.update(delta, time);
      this.postProcessing.render(delta);
    } else if (this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    if (this.postProcessing) {
      this.postProcessing.dispose();
      this.postProcessing = null;
    }
    this.renderer.dispose();
  }
}

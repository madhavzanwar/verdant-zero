import * as THREE from 'three';
import { PostProcessingManager } from './PostProcessing.js';

/**
 * Three.js 60 FPS Core Engine
 * - DPR clamped to 1.5
 * - ACESFilmicToneMapping
 * - Dynamic resolution scaling for smooth 60 FPS
 * - F3 debug FPS toggle
 */
export class Engine {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    
    // Performance: Clamp DPR to 1.5
    this.baseDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.currentScale = 1.0;
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: true
    });

    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(this.baseDpr);

    // Modern Three.js Color & Tone Mapping Architecture
    THREE.ColorManagement.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.30;

    // Camera & Scene References
    this.scene = null;
    this.camera = null;
    this.postProcessing = null;

    // Timing & 60 FPS Monitoring
    this.clock = new THREE.Clock();
    this.fpsEl = document.getElementById('fps-val');
    this.debugFpsContainer = document.getElementById('debug-fps');
    this.frameCount = 0;
    this.lastFpsTime = performance.now();
    this.fps = 60;
    this.isRunning = false;

    // F3 Debug Toggle
    this.initDebugKey();

    // Resize Handler
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
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
  }

  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    if (this.camera) {
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
    }

    this.renderer.setSize(this.width, this.height);
    if (this.postProcessing) {
      this.postProcessing.setSize(this.width, this.height);
    }
  }

  /**
   * Dynamic Resolution Scaling (Part Six)
   * Drops render scale slightly if fps dips, restores when stable
   */
  adaptResolution() {
    if (this.fps < 48 && this.currentScale > 0.8) {
      this.currentScale = 0.85;
      this.renderer.setPixelRatio(this.baseDpr * this.currentScale);
    } else if (this.fps > 58 && this.currentScale < 1.0) {
      this.currentScale = 1.0;
      this.renderer.setPixelRatio(this.baseDpr);
    }
  }

  setBrightness(val) {
    this.brightnessFactor = val;
    this.renderer.toneMappingExposure = 1.30 * Math.max(0.4, Math.min(2.5, val));
  }

  start(renderCallback) {
    this.renderCallback = renderCallback;
    this.isRunning = true;
    this.clock.start();
    this.loop();
  }

  stop() {
    this.isRunning = false;
  }

  loop() {
    if (!this.isRunning) return;
    requestAnimationFrame(() => this.loop());

    const delta = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.getElapsedTime();

    // FPS Meter
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsTime));
      this.frameCount = 0;
      this.lastFpsTime = now;
      if (this.fpsEl) {
        this.fpsEl.textContent = this.fps;
      }
      this.adaptResolution();
    }

    // Call update callback
    if (this.renderCallback) {
      this.renderCallback(delta, time);
    }

    // Post-processing render
    if (this.postProcessing) {
      this.postProcessing.update(delta, time);
      this.postProcessing.render();
    } else if (this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }
}

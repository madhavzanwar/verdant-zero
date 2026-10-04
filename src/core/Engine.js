import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * VERDANT ZERO // Three.js Core Engine
 * Tuned for solid 60 FPS performance on standard laptops with post-processing.
 * Implements UnrealBloomPass, ACES Filmic tone mapping, and clamped DPR.
 */
export class Engine {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    
    // Performance: Clamp DPR to 1.5 to guarantee 60fps on retina/high-DPI screens without GPU thermal throttle
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    // Initialize WebGLRenderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true
    });

    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(this.dpr);

    // Modern Three.js Color & Tone Mapping Architecture
    THREE.ColorManagement.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // Active scene reference
    this.activeScene = null;
    this.isRunning = false;

    // Post-Processing Pipeline
    this.setupPostProcessing();

    // Clock & Timing for 60 FPS Loop
    this.clock = new THREE.Clock();
    this.fpsCounterEl = document.getElementById('fps-counter');
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();
    this.fps = 60;

    // Resize binding
    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
  }

  setupPostProcessing() {
    const renderTarget = new THREE.WebGLRenderTarget(
      this.width * this.dpr,
      this.height * this.dpr,
      {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        colorSpace: THREE.SRGBColorSpace
      }
    );

    this.composer = new EffectComposer(this.renderer, renderTarget);

    // 1. Initial Scene Render Pass
    this.renderPass = new RenderPass();
    this.composer.addPass(this.renderPass);

    // 2. Cinematic Unreal Bloom Pass
    // Parameters: resolution, strength, radius, threshold
    // Threshold 0.2 ensures dead gray buildings don't bloom, while high emissive neon glows brilliantly
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      1.65, // Bloom Strength
      0.55, // Bloom Radius
      0.22  // Bloom Threshold
    );
    this.composer.addPass(this.bloomPass);

    // 3. Color Space Output Pass
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  /**
   * Sets the active 3D scene (must provide .scene and .camera, plus optional .update(delta, time))
   * @param {Object} sceneInstance 
   */
  setScene(sceneInstance) {
    this.activeScene = sceneInstance;
    if (this.renderPass) {
      this.renderPass.scene = sceneInstance.scene;
      this.renderPass.camera = sceneInstance.camera;
    }
  }

  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    if (this.activeScene && this.activeScene.camera) {
      this.activeScene.camera.aspect = this.width / this.height;
      this.activeScene.camera.updateProjectionMatrix();
    }

    this.renderer.setSize(this.width, this.height);
    this.composer.setSize(this.width, this.height);
    this.bloomPass.resolution.set(this.width, this.height);
  }

  start() {
    if (this.isRunning) return;
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

    // Calculate clamped delta time
    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, 0.1); // Cap delta to prevent jump
    const time = this.clock.getElapsedTime();

    // FPS Meter calculation
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsUpdate >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      if (this.fpsCounterEl) {
        this.fpsCounterEl.textContent = this.fps;
      }
    }

    // Update active scene logic
    if (this.activeScene) {
      if (typeof this.activeScene.update === 'function') {
        this.activeScene.update(delta, time);
      }
      // Render through Bloom Post-Processing Composer
      if (this.activeScene.scene && this.activeScene.camera) {
        this.composer.render();
      }
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }
}

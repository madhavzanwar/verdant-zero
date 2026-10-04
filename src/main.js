import "@fontsource/big-shoulders-display";
import "@fontsource/inter";

import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { AudioManager } from './core/AudioManager.js';
import { CameraController } from './core/CameraController.js';
import { CityGenerator } from './world/CityGenerator.js';
import { WeatherAndTraffic } from './world/WeatherAndTraffic.js';
import { RobotGardener } from './entities/RobotGardener.js';
import { PlantSystem } from './entities/PlantSystem.js';

/**
 * Verdant Zero Application Bootstrap
 * - 360° Mouse Look with Pointer Lock
 * - WASD & Arrow Key Navigation
 * - Pause Menu & Sensitivity / Invert-Y Settings
 */
class VerdantZeroApp {
  constructor() {
    this.canvas = document.getElementById('webgl-canvas');
    this.isPaused = false;
    this.isPointerLocked = false;

    // 1. Initialize Scene & Atmospheric Lighting
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c18); // Dark purple-blue dusk
    this.scene.fog = new THREE.FogExp2(0x0a0c18, 0.0048); // Exponential squared fog showing all depth layers

    // 2. Camera Setup
    this.camera = new THREE.PerspectiveCamera(
      50,
      window.innerWidth / window.innerHeight,
      0.1,
      850
    );

    // 3. Ambient & Overcast Directional Dusk Lighting
    const ambientLight = new THREE.AmbientLight(0x2d3448, 2.2);
    this.scene.add(ambientLight);

    const duskKeyLight = new THREE.DirectionalLight(0x3e4d6a, 2.4);
    duskKeyLight.position.set(60, 150, -40);
    this.scene.add(duskKeyLight);

    const horizonRimLight = new THREE.DirectionalLight(0x633394, 1.2);
    horizonRimLight.position.set(-80, 50, 60);
    this.scene.add(horizonRimLight);

    // 4. Procedural City & Atmospheric Weather
    this.city = new CityGenerator(this.scene);
    this.weather = new WeatherAndTraffic(this.scene);

    // 5. Core Subsystems
    this.engine = new Engine(this.canvas);
    this.audio = new AudioManager();
    this.cameraController = new CameraController(this.camera, this.city.buildingColliders);

    // 6. Robot Gardener (Player) & Planting System
    this.robot = new RobotGardener(this.scene, this.city.buildingColliders);
    this.plantSystem = new PlantSystem(this.scene, this.city, this.audio);

    // 7. Input & Mouse Look State
    this.keys = new Map();
    this.initInput();
    this.initMouseLook();

    // 8. Post-Processing Pipeline
    this.engine.initPostProcessing(this.scene, this.camera);

    // 9. Minimal Title Screen & Pause Menu UI Bindings
    this.initUI();

    // 10. Start 60 FPS Engine Loop
    this.engine.start((delta, time) => this.update(delta, time));
  }

  initInput() {
    window.addEventListener('keydown', (e) => {
      // Prevent browser from scrolling the page when arrow keys or space are pressed
      const scrollKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
      if (scrollKeys.includes(e.code)) {
        e.preventDefault();
      }

      this.keys.set(e.code, true);

      // Plant seed interaction on KeyE
      if (e.code === 'KeyE' && !this.isPaused) {
        const spot = this.plantSystem.checkProximity(this.robot.position);
        if (spot) {
          this.plantSystem.plant(spot);
        }
      }

      // Escape key opens/closes pause menu
      if (e.code === 'Escape') {
        const dialogHow = document.getElementById('dialog-how');
        if (dialogHow && dialogHow.classList.contains('open')) {
          dialogHow.classList.remove('open');
          dialogHow.setAttribute('aria-hidden', 'true');
          return;
        }

        if (this.cameraController.mode === 'GAMEPLAY') {
          if (!this.isPaused) {
            this.openPauseMenu();
          } else {
            this.closePauseMenu();
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);
    });

    // Start audio on first user gesture anywhere
    const startAudio = () => {
      this.audio.ensureContext();
      window.removeEventListener('pointerdown', startAudio);
      window.removeEventListener('keydown', startAudio);
    };
    window.addEventListener('pointerdown', startAudio, { once: true });
    window.addEventListener('keydown', startAudio, { once: true });
  }

  initMouseLook() {
    // 1. Pointer Lock on Click during Gameplay
    this.canvas.addEventListener('click', () => {
      if (this.cameraController.mode === 'GAMEPLAY' && !this.isPaused) {
        if (!document.pointerLockElement) {
          this.canvas.requestPointerLock?.();
        }
      }
    });

    // 2. Pointer Lock State Tracking
    let wasPointerLocked = false;
    document.addEventListener('pointerlockchange', () => {
      const isLocked = document.pointerLockElement === this.canvas;
      if (wasPointerLocked && !isLocked && this.cameraController.mode === 'GAMEPLAY' && !this.isPaused) {
        this.openPauseMenu();
      }
      wasPointerLocked = isLocked;
      this.isPointerLocked = isLocked;
    });

    // 3. Mouse Movement Handling
    window.addEventListener('mousemove', (e) => {
      if (this.isPaused) return;

      if (this.isPointerLocked) {
        // Direct pointer lock delta
        this.cameraController.handlePointerMove(e.movementX, e.movementY);
      } else if (this.cameraController.mode === 'GAMEPLAY') {
        // Fallback when pointer lock is not active
        const normX = (e.clientX / window.innerWidth - 0.5) * 2;
        const normY = (e.clientY / window.innerHeight - 0.5) * 2;
        this.cameraController.handleScreenMouseFallback(normX, normY);
      }
    });
  }

  isKeyPressed(code) {
    return !!this.keys.get(code);
  }

  initUI() {
    const titleScreenEl = document.getElementById('title-screen');
    const btnPlay = document.getElementById('btn-play');
    const btnHow = document.getElementById('btn-how');
    const dialogHow = document.getElementById('dialog-how');
    const btnCloseHow = document.getElementById('btn-close-how');

    // Pause & Settings UI elements
    const btnResume = document.getElementById('btn-resume');
    const sliderSens = document.getElementById('setting-sensitivity');
    const sensValDisplay = document.getElementById('sensitivity-value');
    const checkInvertY = document.getElementById('setting-invert-y');

    // Initialize Settings from CameraController
    if (sliderSens && sensValDisplay) {
      sliderSens.value = this.cameraController.sensitivity.toString();
      sensValDisplay.textContent = `${this.cameraController.sensitivity.toFixed(1)}x`;

      sliderSens.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.cameraController.setSensitivity(val);
        sensValDisplay.textContent = `${val.toFixed(1)}x`;
      });
    }

    if (checkInvertY) {
      checkInvertY.checked = this.cameraController.invertY;
      checkInvertY.addEventListener('change', (e) => {
        this.cameraController.setInvertY(e.target.checked);
      });
    }

    // Resume Button
    if (btnResume) {
      btnResume.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closePauseMenu();
      });
    }

    // "Play" Button Click
    if (btnPlay) {
      btnPlay.addEventListener('click', () => {
        this.audio.ensureContext();
        
        // Hide title screen
        if (titleScreenEl) {
          titleScreenEl.classList.add('hidden');
        }

        // Transition camera from Title orbit to Robot third-person follow
        this.cameraController.startGameplayTransition(this.robot.position);

        // Lock pointer automatically for gameplay
        setTimeout(() => {
          this.canvas.requestPointerLock?.();
        }, 1100);
      });
    }

    // "How to play" Dialog
    if (btnHow && dialogHow) {
      btnHow.addEventListener('click', () => {
        this.audio.ensureContext();
        dialogHow.classList.add('open');
        dialogHow.setAttribute('aria-hidden', 'false');
      });
    }

    if (btnCloseHow && dialogHow) {
      btnCloseHow.addEventListener('click', () => {
        dialogHow.classList.remove('open');
        dialogHow.setAttribute('aria-hidden', 'true');
      });
    }

    if (dialogHow) {
      dialogHow.addEventListener('click', (e) => {
        if (e.target === dialogHow) {
          dialogHow.classList.remove('open');
          dialogHow.setAttribute('aria-hidden', 'true');
        }
      });
    }
  }

  openPauseMenu() {
    this.isPaused = true;
    const dialogPause = document.getElementById('dialog-pause');
    if (dialogPause) {
      dialogPause.classList.add('open');
      dialogPause.setAttribute('aria-hidden', 'false');
    }
  }

  closePauseMenu() {
    this.isPaused = false;
    const dialogPause = document.getElementById('dialog-pause');
    if (dialogPause) {
      dialogPause.classList.remove('open');
      dialogPause.setAttribute('aria-hidden', 'true');
    }
    // Re-lock pointer
    if (this.cameraController.mode === 'GAMEPLAY') {
      try {
        this.canvas.requestPointerLock?.();
      } catch (e) {
        // Pointer lock fallback is handled gracefully
      }
    }
  }

  update(delta, time) {
    if (this.isPaused) return;

    // 1. Update City & Atmospheric Details
    this.city.update(delta, time);
    this.weather.update(delta, time);

    // 2. Camera Horizontal and Pitch Angles for Player Movement and Eye Gaze
    const cameraAngle = this.cameraController.getHorizontalAngle();
    const cameraPitch = this.cameraController.getPitchAngle();

    // 3. Update Robot Gardener Physics, WASD/Arrow Movement & Eye
    this.robot.update(delta, time, this, cameraAngle, cameraPitch);

    // 4. Update Plant Proximity & Growth Animations
    const nearSpot = this.plantSystem.checkProximity(this.robot.position);
    this.robot.isNearPlantSpot = !!nearSpot;
    this.plantSystem.update(delta, time);

    // 5. Update Camera Controller with Mouse Look
    this.cameraController.update(delta, time, this.robot);
  }
}

// Launch on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  new VerdantZeroApp();
});

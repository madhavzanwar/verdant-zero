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
import { createProceduralEnvMap } from './world/EnvironmentMap.js';
import { SmogSystem } from './systems/SmogSystem.js';
import { DroneSystem } from './systems/DroneSystem.js';
import { SurvivalManager } from './systems/SurvivalManager.js';
import { ScoreManager } from './systems/ScoreManager.js';

/**
 * Verdant Zero Application Bootstrap
 * - 360° Mouse Look with Pointer Lock
 * - WASD & Arrow Key Navigation
 * - Pause Menu & Sensitivity / Invert-Y / Brightness Settings
 * - Part B: Smog Rot, Purge Drones, Water Resources, Acid Rain & Light Pulse
 * - Part C: Scoring, Combo Multiplier, Risk Bonus, Timer & Milestones, Game Over & Instant Restart
 */
class VerdantZeroApp {
  constructor() {
    this.canvas = document.getElementById('webgl-canvas');
    this.isPaused = false;
    this.isPointerLocked = false;
    this.gameTime = 0.0;

    // 1. Initialize Engine & Canvas First
    this.engine = new Engine(this.canvas);

    // 2. Initialize Scene, Fog & Horizon Dusk Color
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c1e); // Dark indigo dusk
    this.scene.fog = new THREE.FogExp2(0x2a1650, 0.0028); // Horizon-matching purple fog, visible up to 400m

    // 3. PMREM Environment Map for Colorful Neon Reflections on Concrete, Asphalt & Robot
    const envMap = createProceduralEnvMap(this.engine.renderer);
    this.scene.environment = envMap;

    // 4. Camera Setup (FOV 60, Far 2000)
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    );

    // 5. Real Scene Lights (Strictly under 8 total real lights)
    // 5a. Hemisphere light (purple-blue sky, dark teal ground at strong intensity)
    const hemiLight = new THREE.HemisphereLight(0x3e2570, 0x08222b, 2.4);
    this.scene.add(hemiLight);

    // 5b. Cool blue moonlight directional light
    const moonLight = new THREE.DirectionalLight(0x7590d4, 1.8);
    moonLight.position.set(80, 160, -60);
    this.scene.add(moonLight);

    // (The other 4 point lights follow the player robot: seed, cyan rim, magenta rim, ground bounce)

    // 6. Procedural City & Atmospheric Weather
    this.city = new CityGenerator(this.scene);
    this.weather = new WeatherAndTraffic(this.scene);

    // 7. Core Subsystems
    this.audio = new AudioManager();
    this.cameraController = new CameraController(this.camera, this.city.buildingColliders);

    // 8. Part C Score & Game State Manager
    this.scoreManager = new ScoreManager(this.audio);
    this.scoreManager.onRecordTimelapse = (data) => this.handleTimelapseRecord(data);
    this.scoreManager.onGameOver = () => {
      this.cameraController.setGameOverMode(this.robot.position);
      if (document.pointerLockElement) {
        try { document.exitPointerLock?.(); } catch (e) {}
      }
    };

    // 9. Robot Gardener (Player) & Planting System
    this.robot = new RobotGardener(this.scene, this.city.buildingColliders);
    this.plantSystem = new PlantSystem(this.scene, this.city, this.audio, this.scoreManager);

    // 10. Threat & Survival Subsystems
    this.smogSystem = new SmogSystem(this.scene, this.city.buildingColliders);
    this.droneSystem = new DroneSystem(this.scene, this.audio);
    this.survival = new SurvivalManager(this.scene, this.city.buildingColliders, this.audio, this.scoreManager);

    // 11. Input & Mouse Look State
    this.keys = new Map();
    this.initInput();
    this.initMouseLook();

    // 12. Post-Processing Pipeline
    this.engine.initPostProcessing(this.scene, this.camera);

    // 13. Minimal Title Screen, HUD & Pause Menu UI Bindings
    this.initUI();

    // 14. Start 60 FPS Engine Loop
    this.engine.start((delta, time) => this.update(delta, time));
    window.__vz_app = this;
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
      if (e.code === 'KeyE' && !this.isPaused && this.scoreManager.state === 'PLAYING') {
        const spot = this.plantSystem.checkProximity(this.robot.position);
        if (spot) {
          if (this.survival.canAffordPlant()) {
            this.survival.consumeWaterForSeed();
            const inSmog = this.smogSystem.getDensity(spot.data.x, spot.data.z) > 0.08;
            this.plantSystem.plant(spot, inSmog);
          } else {
            this.survival.notifyDeniedPlanting(this.robot);
            if (spot.mesh && spot.mesh.material) {
              spot.mesh.material.color.setHex(0xff2222);
              setTimeout(() => {
                if (!spot.isPlanted) spot.mesh.material.color.setHex(0x00ff88);
              }, 450);
            }
          }
        }
      }

      // Light Pulse ability on KeyQ
      if (e.code === 'KeyQ' && !this.isPaused && this.cameraController.mode === 'GAMEPLAY') {
        this.survival.triggerLightPulse(this.robot.position, this.smogSystem, this.droneSystem);
      }

      // Instant Restart on KeyR
      if (e.code === 'KeyR' && (this.cameraController.mode === 'GAMEPLAY' || this.scoreManager.state === 'GAMEOVER')) {
        this.restartGame();
      }

      // Escape key opens/closes pause menu
      if (e.code === 'Escape') {
        const dialogHow = document.getElementById('dialog-how');
        if (dialogHow && dialogHow.classList.contains('open')) {
          dialogHow.classList.remove('open');
          dialogHow.setAttribute('aria-hidden', 'true');
          return;
        }

        if (this.scoreManager.state === 'GAMEOVER') {
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
    // 1. Pointer Lock on Left Click during Gameplay
    this.canvas.addEventListener('click', () => {
      if (this.cameraController.mode === 'GAMEPLAY' && !this.isPaused) {
        if (!document.pointerLockElement) {
          this.canvas.requestPointerLock?.();
        }
      }
    });

    // Right Click for Light Pulse
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.cameraController.mode === 'GAMEPLAY' && !this.isPaused) {
        this.survival.triggerLightPulse(this.robot.position, this.smogSystem, this.droneSystem);
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
    const sliderBright = document.getElementById('setting-brightness');
    const brightValDisplay = document.getElementById('brightness-value');

    // Initialize Brightness from localStorage
    const savedBrightness = parseFloat(localStorage.getItem('vz_brightness') || '1.0');
    this.engine.setBrightness(savedBrightness);
    if (sliderBright && brightValDisplay) {
      sliderBright.value = savedBrightness.toString();
      brightValDisplay.textContent = `${savedBrightness.toFixed(1)}x`;

      sliderBright.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.engine.setBrightness(val);
        localStorage.setItem('vz_brightness', val.toString());
        brightValDisplay.textContent = `${val.toFixed(1)}x`;
      });
    }

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

    // Pause Dialog Buttons
    const btnPauseRestart = document.getElementById('btn-pause-restart');
    if (btnPauseRestart) {
      btnPauseRestart.addEventListener('click', (e) => {
        e.stopPropagation();
        this.restartGame();
      });
    }

    const btnPauseMenu = document.getElementById('btn-pause-menu');
    if (btnPauseMenu) {
      btnPauseMenu.addEventListener('click', (e) => {
        e.stopPropagation();
        this.returnToMainMenu();
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

        // Start game state in ScoreManager
        this.scoreManager.startGame();

        // Transition camera from Title orbit to Robot third-person follow
        this.cameraController.startGameplayTransition(this.robot.position);

        // Lock pointer automatically for gameplay
        setTimeout(() => {
          this.canvas.requestPointerLock?.();
        }, 1100);
      });
    }

    // Game Over Screen Buttons
    const btnGoRestart = document.getElementById('btn-gameover-restart');
    if (btnGoRestart) {
      btnGoRestart.addEventListener('click', () => this.restartGame());
    }

    const btnGoMenu = document.getElementById('btn-gameover-menu');
    if (btnGoMenu) {
      btnGoMenu.addEventListener('click', () => this.returnToMainMenu());
    }

    const btnTimelapse = document.getElementById('btn-timelapse-hook');
    if (btnTimelapse) {
      btnTimelapse.addEventListener('click', () => this.handleTimelapseRecord());
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

    // Pulse button click in HUD
    const pulseBtn = document.getElementById('pulse-ability');
    if (pulseBtn) {
      pulseBtn.addEventListener('click', () => {
        if (this.cameraController.mode === 'GAMEPLAY' && !this.isPaused && this.scoreManager.state === 'PLAYING') {
          this.survival.triggerLightPulse(this.robot.position, this.smogSystem, this.droneSystem);
        }
      });
    }
  }

  openPauseMenu() {
    this.isPaused = true;
    if (this.scoreManager) this.scoreManager.pause();
    const dialogPause = document.getElementById('dialog-pause');
    if (dialogPause) {
      dialogPause.classList.add('open');
      dialogPause.setAttribute('aria-hidden', 'false');
    }
  }

  closePauseMenu() {
    this.isPaused = false;
    if (this.scoreManager) this.scoreManager.resume();
    const dialogPause = document.getElementById('dialog-pause');
    if (dialogPause) {
      dialogPause.classList.remove('open');
      dialogPause.setAttribute('aria-hidden', 'true');
    }
    // Re-lock pointer
    if (this.cameraController.mode === 'GAMEPLAY' && this.scoreManager.state === 'PLAYING') {
      try {
        this.canvas.requestPointerLock?.();
      } catch (e) {
        // Pointer lock fallback is handled gracefully
      }
    }
  }

  restartGame() {
    this.isPaused = false;
    const dialogPause = document.getElementById('dialog-pause');
    if (dialogPause) {
      dialogPause.classList.remove('open');
      dialogPause.setAttribute('aria-hidden', 'true');
    }
    const modalGameOver = document.getElementById('modal-gameover');
    if (modalGameOver) {
      modalGameOver.classList.remove('open');
      modalGameOver.setAttribute('aria-hidden', 'true');
    }

    const titleScreenEl = document.getElementById('title-screen');
    if (titleScreenEl) titleScreenEl.classList.add('hidden');

    // Instant restart under 1s reusing all geometry
    this.robot.reset();
    this.plantSystem.reset();
    this.survival.reset();
    this.droneSystem.reset();
    this.smogSystem.reset();
    this.cameraController.resetGameplay(this.robot.position);
    this.scoreManager.startGame();

    try {
      this.canvas.requestPointerLock?.();
    } catch (e) {}
  }

  returnToMainMenu() {
    this.isPaused = false;
    const dialogPause = document.getElementById('dialog-pause');
    if (dialogPause) {
      dialogPause.classList.remove('open');
      dialogPause.setAttribute('aria-hidden', 'true');
    }
    const modalGameOver = document.getElementById('modal-gameover');
    if (modalGameOver) {
      modalGameOver.classList.remove('open');
      modalGameOver.setAttribute('aria-hidden', 'true');
    }

    const titleScreenEl = document.getElementById('title-screen');
    if (titleScreenEl) {
      titleScreenEl.classList.remove('hidden');
    }

    this.cameraController.returnToTitle();
    this.scoreManager.state = 'MENU';
    this.scoreManager.reset();
    this.robot.reset();
    this.plantSystem.reset();
    this.survival.reset();
    this.droneSystem.reset();
    this.smogSystem.reset();

    if (document.pointerLockElement) {
      try { document.exitPointerLock?.(); } catch (e) {}
    }
  }

  handleTimelapseRecord(runData = null) {
    const data = runData || {
      score: this.scoreManager.score,
      reclaimed: this.scoreManager.reclaimedPercentage,
      timeSurvived: this.scoreManager.timeSurvived
    };
    console.log('Cinematic time-lapse recording hook triggered:', data);
    if (window.__vz_onRecordTimelapse) {
      window.__vz_onRecordTimelapse(data);
    }
    const btn = document.getElementById('btn-timelapse-hook');
    if (btn) {
      const originalText = btn.textContent;
      btn.textContent = 'Recording Queued...';
      setTimeout(() => { btn.textContent = originalText; }, 2000);
    }
  }

  update(delta, time) {
    // 0. Handle Game Over State
    if (this.scoreManager.state === 'GAMEOVER') {
      if (this.cameraController.mode !== 'GAMEOVER') {
        this.cameraController.setGameOverMode(this.robot.position);
        if (document.pointerLockElement) {
          try { document.exitPointerLock?.(); } catch (e) {}
        }
      }
      this.cameraController.update(delta, time, this.robot);
      this.city.update(delta, time);
      this.weather.update(delta, time);
      return;
    }

    if (this.isPaused || this.scoreManager.state === 'PAUSED') return;

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

    // 6. Update Part B & Part C Subsystems (Only during active gameplay)
    if (this.cameraController.mode === 'GAMEPLAY' && this.scoreManager.state === 'PLAYING') {
      this.gameTime += delta;

      // 6a. Update Score, Timer Countdown, Combo Draining & Animations
      this.scoreManager.update(delta);

      if (this.scoreManager.state === 'GAMEOVER') {
        this.cameraController.setGameOverMode(this.robot.position);
        if (document.pointerLockElement) {
          try { document.exitPointerLock?.(); } catch (e) {}
        }
        return;
      }

      // 6b. Smog Simulation & Vine interactions
      this.smogSystem.update(delta, this.gameTime, this.plantSystem.activeVines, this.robot.position);

      // 6c. Purge Drone Wave Threats & Laser Burning
      const droneUpdate = this.droneSystem.update(delta, this.gameTime, this.plantSystem.activeVines, this.robot.position, this.camera);
      if (droneUpdate && droneUpdate.playerDamage > 0) {
        this.survival.applyDamage(droneUpdate.playerDamage);
      }

      // 6d. Survival Resource Loop (Health regen, water drops, acid rain, HUD)
      this.survival.update(
        delta,
        this.gameTime,
        this.robot,
        this.smogSystem,
        this.droneSystem,
        this.weather,
        this.plantSystem.activeVines,
        this.camera
      );
    }
  }
}

// Launch on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  new VerdantZeroApp();
});

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
import { LeaderboardSystem } from './systems/LeaderboardSystem.js';
import { WorldRegistry } from './systems/WorldRegistry.js';
import { MapSystem } from './systems/MapSystem.js';
import { WaypointSystem } from './systems/WaypointSystem.js';

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

    // 5b. Cool blue moonlight directional light (strictly 1 shadow caster in scene)
    const moonLight = new THREE.DirectionalLight(0x7590d4, 1.8);
    moonLight.position.set(80, 160, -60);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.width = 1024;
    moonLight.shadow.mapSize.height = 1024;
    moonLight.shadow.camera.near = 10;
    moonLight.shadow.camera.far = 400;
    moonLight.shadow.camera.left = -60;
    moonLight.shadow.camera.right = 60;
    moonLight.shadow.camera.top = 60;
    moonLight.shadow.camera.bottom = -60;
    moonLight.shadow.bias = -0.0005;
    this.scene.add(moonLight);
    this.scene.add(moonLight.target);
    this.moonLight = moonLight;

    // 6. Procedural City & Atmospheric Weather
    this.city = new CityGenerator(this.scene);
    this.weather = new WeatherAndTraffic(this.scene);

    // 7. Core Subsystems
    this.audio = new AudioManager();
    this.cameraController = new CameraController(this.camera, this.city.buildingColliders);

    // 8. Part C Score & Game State Manager
    this.scoreManager = new ScoreManager(this.audio);
    this.leaderboard = new LeaderboardSystem();
    this.scoreManager.onRecordTimelapse = (data) => this.handleTimelapseRecord(data);
    this.scoreManager.onGameOver = () => {
      this.cameraController.setGameOverMode(this.robot.position);
      if (document.pointerLockElement) {
        try { document.exitPointerLock?.(); } catch (e) {}
      }
      this.renderLeaderboard();
    };

    // 9. Robot Gardener (Player) & Planting System
    this.robot = new RobotGardener(this.scene, this.city.buildingColliders);
    this.plantSystem = new PlantSystem(this.scene, this.city, this.audio, this.scoreManager);

    // 10. Threat & Survival Subsystems (Pass buildingColliders to DroneSystem for obstacle avoidance)
    this.smogSystem = new SmogSystem(this.scene, this.city.buildingColliders);
    this.droneSystem = new DroneSystem(this.scene, this.audio, this.city.buildingColliders);
    this.survival = new SurvivalManager(this.scene, this.city.buildingColliders, this.audio, this.scoreManager);

    // 10b. World Registry, Waypoint Navigation & Minimap Systems
    this.worldRegistry = new WorldRegistry();
    this.waypointSystem = new WaypointSystem(this.scene, this.camera, this.worldRegistry, this.audio);
    this.mapSystem = new MapSystem({
      scene: this.scene,
      camera: this.camera,
      worldRegistry: this.worldRegistry,
      waypointSystem: this.waypointSystem,
      app: this
    });

    // 11. Input & Mouse Look State
    this.keys = new Map();
    this.initInput();
    this.initMouseLook();

    // Hook tab visibility auto-pause from Engine
    this.engine.onVisibilityPause = () => {
      if (this.cameraController.mode === 'GAMEPLAY' && !this.isPaused && this.scoreManager.state === 'PLAYING') {
        this.openPauseMenu();
      }
      if (this.audio) {
        this.audio.handleTabVisibility(document.hidden);
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (this.audio) {
        this.audio.handleTabVisibility(document.hidden);
      }
    });

    // Global Error Boundary
    this.initErrorBoundary();

    // 12. Post-Processing Pipeline
    this.engine.initPostProcessing(this.scene, this.camera);

    // Sync graphics quality across weather and smog particles
    this.engine.onQualityChange = (tier) => {
      if (this.weather) this.weather.setQuality(tier);
      if (this.smogSystem) this.smogSystem.setQuality(tier);
    };

    // Pre-warm shaders and dismiss shader compilation overlay
    const shaderLoader = document.getElementById('shader-loader');
    const loaderBar = document.getElementById('loader-bar-fill');
    if (loaderBar) loaderBar.style.width = '70%';

    try {
      this.engine.renderer.compile(this.scene, this.camera);
    } catch (err) {
      console.warn('[Verdant Zero] Pre-compiling scene shaders:', err);
    }

    if (loaderBar) loaderBar.style.width = '100%';
    setTimeout(() => {
      if (shaderLoader) {
        shaderLoader.classList.add('loaded');
      }
    }, 300);

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

      // Plant seed interaction on KeyE with 100ms input buffering
      if (e.code === 'KeyE' && !this.isPaused && this.scoreManager.state === 'PLAYING') {
        this.attemptPlantWithBuffer();
      }

      // Enter key starts game on Title Screen
      if (e.code === 'Enter' && this.cameraController.mode === 'TITLE') {
        const btnPlay = document.getElementById('btn-play');
        if (btnPlay) btnPlay.click();
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

    // Clear all input state on window blur to prevent stuck movement keys
    window.addEventListener('blur', () => {
      this.keys.clear();
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

  attemptPlantWithBuffer() {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const spot = this.plantSystem.checkProximity(this.robot.position);
      if (spot) {
        clearInterval(interval);
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
      } else if (attempts >= 5) {
        clearInterval(interval);
      }
    }, 20); // 5 attempts x 20ms = 100ms buffer window
  }

  initErrorBoundary() {
    const errorDialog = document.getElementById('dialog-error');
    const errorMsg = document.getElementById('error-message');
    const btnRestart = document.getElementById('btn-error-restart');
    const btnReload = document.getElementById('btn-error-reload');

    const showError = (err) => {
      const msg = (err && (err.message || err.toString())) || '';
      // Ignore benign pointer lock permission rejections
      if (msg.includes('Pointer Lock') || msg.includes('user gesture') || msg.includes('NotAllowedError')) {
        console.warn('Pointer lock notice (gesture required):', msg);
        return;
      }
      console.error('Verdant Zero Caught Error:', err);
      if (errorDialog && errorMsg) {
        errorMsg.textContent = `A runtime exception occurred: ${err.message || err}. The state was recovered safely.`;
        errorDialog.classList.add('open');
        errorDialog.setAttribute('aria-hidden', 'false');
      }
    };

    window.addEventListener('error', (e) => showError(e.error || e));
    window.addEventListener('unhandledrejection', (e) => showError(e.reason || e));

    if (btnRestart) {
      btnRestart.addEventListener('click', () => {
        if (errorDialog) {
          errorDialog.classList.remove('open');
          errorDialog.setAttribute('aria-hidden', 'true');
        }
        this.restartGame();
      });
    }

    if (btnReload) {
      btnReload.addEventListener('click', () => {
        window.location.reload();
      });
    }
  }

  initMouseLook() {
    const promptEl = document.getElementById('pointerlock-prompt');

    // 1. Pointer Lock on Left Click during Gameplay
    this.canvas.addEventListener('click', () => {
      if (this.cameraController.mode === 'GAMEPLAY' && !this.isPaused) {
        if (!document.pointerLockElement) {
          const req = this.canvas.requestPointerLock?.();
          if (req && typeof req.catch === 'function') {
            req.catch((err) => {
              console.warn('Pointer lock request denied:', err);
            });
          }
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

      if (promptEl) {
        if (!isLocked && this.cameraController.mode === 'GAMEPLAY' && !this.isPaused) {
          promptEl.classList.add('visible');
        } else {
          promptEl.classList.remove('visible');
        }
      }
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
    // 1. Master Volume
    const sliderMasterVol = document.getElementById('setting-master-vol');
    const masterVolVal = document.getElementById('master-vol-val');
    const savedMasterVol = parseFloat(localStorage.getItem('vz_master_vol') || '0.35');
    if (this.audio && this.audio.masterGain) this.audio.masterGain.gain.setValueAtTime(savedMasterVol, this.audio.ctx?.currentTime || 0);
    if (sliderMasterVol && masterVolVal) {
      sliderMasterVol.value = savedMasterVol.toString();
      masterVolVal.textContent = `${Math.round(savedMasterVol * 100)}%`;
      sliderMasterVol.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (this.audio && this.audio.masterGain && this.audio.ctx) {
          this.audio.masterGain.gain.setValueAtTime(val, this.audio.ctx.currentTime);
        }
        localStorage.setItem('vz_master_vol', val.toString());
        masterVolVal.textContent = `${Math.round(val * 100)}%`;
      });
    }

    // 2. Ambient / Rain Volume
    const sliderAmbVol = document.getElementById('setting-ambient-vol');
    const ambVolVal = document.getElementById('ambient-vol-val');
    const savedAmbVol = parseFloat(localStorage.getItem('vz_ambient_vol') || '0.8');
    if (this.audio && this.audio.ambientGain) this.audio.ambientGain.gain.setValueAtTime(savedAmbVol, this.audio.ctx?.currentTime || 0);
    if (sliderAmbVol && ambVolVal) {
      sliderAmbVol.value = savedAmbVol.toString();
      ambVolVal.textContent = `${Math.round(savedAmbVol * 100)}%`;
      sliderAmbVol.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (this.audio && this.audio.ambientGain && this.audio.ctx) {
          this.audio.ambientGain.gain.setValueAtTime(val, this.audio.ctx.currentTime);
        }
        localStorage.setItem('vz_ambient_vol', val.toString());
        ambVolVal.textContent = `${Math.round(val * 100)}%`;
      });
    }

    // 3. SFX Volume
    const sliderSfxVol = document.getElementById('setting-sfx-vol');
    const sfxVolVal = document.getElementById('sfx-vol-val');
    const savedSfxVol = parseFloat(localStorage.getItem('vz_sfx_vol') || '0.8');
    if (sliderSfxVol && sfxVolVal) {
      sliderSfxVol.value = savedSfxVol.toString();
      sfxVolVal.textContent = `${Math.round(savedSfxVol * 100)}%`;
      sliderSfxVol.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        localStorage.setItem('vz_sfx_vol', val.toString());
        sfxVolVal.textContent = `${Math.round(val * 100)}%`;
      });
    }

    // 4. Mouse Sensitivity
    if (sliderSens && sensValDisplay) {
      sliderSens.value = this.cameraController.sensitivity.toString();
      sensValDisplay.textContent = `${this.cameraController.sensitivity.toFixed(1)}x`;

      sliderSens.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.cameraController.setSensitivity(val);
        sensValDisplay.textContent = `${val.toFixed(1)}x`;
      });
    }

    // 5. Scene Exposure
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

    // 6. FOV Slider
    const sliderFov = document.getElementById('setting-fov');
    const fovValDisplay = document.getElementById('fov-val');
    const savedFov = parseFloat(localStorage.getItem('vz_fov') || '60');
    if (this.camera) {
      this.camera.fov = savedFov;
      this.camera.updateProjectionMatrix();
    }
    if (sliderFov && fovValDisplay) {
      sliderFov.value = savedFov.toString();
      fovValDisplay.textContent = `${savedFov}°`;
      sliderFov.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        this.camera.fov = val;
        this.camera.updateProjectionMatrix();
        localStorage.setItem('vz_fov', val.toString());
        fovValDisplay.textContent = `${val}°`;
      });
    }

    // 7. Graphic Quality Preset
    const selectQuality = document.getElementById('setting-quality');
    const savedQuality = localStorage.getItem('vz_quality_preset') || 'auto';
    if (selectQuality) {
      selectQuality.value = savedQuality;
      selectQuality.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'auto') {
          this.engine.savedQuality = 'auto';
          this.engine.benchmarking = true;
          this.engine.benchmarkTimer = 0;
          this.engine.benchmarkFrames = 0;
          try { localStorage.setItem('vz_quality_preset', 'auto'); } catch (err) {}
        } else {
          this.engine.benchmarking = false;
          this.engine.setQuality(val, true);
        }
      });
    }

    // 8. Robot Movement Speed Scale (80% - 150%)
    const sliderMoveSpeed = document.getElementById('setting-move-speed');
    const moveSpeedVal = document.getElementById('move-speed-val');
    const savedMoveSpeed = parseFloat(localStorage.getItem('vz_move_speed_scale') || '1.0');
    if (sliderMoveSpeed) {
      sliderMoveSpeed.value = savedMoveSpeed.toString();
      if (moveSpeedVal) moveSpeedVal.textContent = `${Math.round(savedMoveSpeed * 100)}%`;
      sliderMoveSpeed.addEventListener('input', (e) => {
        const scale = parseFloat(e.target.value);
        if (moveSpeedVal) moveSpeedVal.textContent = `${Math.round(scale * 100)}%`;
        if (this.robot) {
          this.robot.setSpeedScale(scale);
        }
      });
    }

    // 9. Invert Vertical Look
    if (checkInvertY) {
      checkInvertY.checked = this.cameraController.invertY;
      checkInvertY.addEventListener('change', (e) => {
        this.cameraController.setInvertY(e.target.checked);
      });
    }

    // 8. Mute Audio
    const checkMute = document.getElementById('setting-mute-audio');
    const savedMute = localStorage.getItem('vz_mute_audio') === 'true';
    if (checkMute) {
      checkMute.checked = savedMute;
      checkMute.addEventListener('change', (e) => {
        const isMuted = e.target.checked;
        if (this.audio && this.audio.masterGain && this.audio.ctx) {
          this.audio.masterGain.gain.setValueAtTime(isMuted ? 0 : parseFloat(localStorage.getItem('vz_master_vol') || '0.35'), this.audio.ctx.currentTime);
        }
        localStorage.setItem('vz_mute_audio', isMuted.toString());
      });
    }

    // 9. Camera Smoothing
    const checkCamSmoothing = document.getElementById('setting-cam-smoothing');
    const savedCamSmoothing = localStorage.getItem('vz_cam_smoothing') !== 'false';
    if (checkCamSmoothing) {
      checkCamSmoothing.checked = savedCamSmoothing;
      checkCamSmoothing.addEventListener('change', (e) => {
        this.cameraController.damping = e.target.checked ? 12.0 : 40.0;
        localStorage.setItem('vz_cam_smoothing', e.target.checked.toString());
      });
    }

    // 10. Always Show FPS Overlay
    const checkFps = document.getElementById('setting-show-fps');
    const debugFpsEl = document.getElementById('debug-fps');
    const savedShowFps = localStorage.getItem('vz_show_fps') === 'true';
    if (debugFpsEl && savedShowFps) debugFpsEl.classList.add('visible');
    if (checkFps) {
      checkFps.checked = savedShowFps;
      checkFps.addEventListener('change', (e) => {
        if (debugFpsEl) {
          if (e.target.checked) debugFpsEl.classList.add('visible');
          else debugFpsEl.classList.remove('visible');
        }
        localStorage.setItem('vz_show_fps', e.target.checked.toString());
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

        // Show Gameplay HUD
        const gameplayHudEl = document.getElementById('gameplay-hud');
        if (gameplayHudEl) {
          gameplayHudEl.classList.add('visible');
          gameplayHudEl.setAttribute('aria-hidden', 'false');
        }

        // Start game state in ScoreManager
        this.scoreManager.startGame();

        // Transition camera from Title orbit to Robot third-person follow
        this.cameraController.startGameplayTransition(this.robot.position);

        // Lock pointer automatically for gameplay (safely catching user gesture restrictions)
        setTimeout(() => {
          try {
            const p = this.canvas.requestPointerLock?.();
            if (p && typeof p.catch === 'function') {
              p.catch(() => {});
            }
          } catch (e) {}
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

    // Leaderboard Tabs & Submission
    const nickInput = document.getElementById('leaderboard-nickname');
    const collegeInput = document.getElementById('leaderboard-college');
    const btnSubmit = document.getElementById('btn-submit-score');
    const statusMsg = document.getElementById('submit-status-msg');

    const savedInfo = this.leaderboard.getSavedPlayerInfo();
    if (nickInput && savedInfo.nickname) nickInput.value = savedInfo.nickname;
    if (collegeInput && savedInfo.college) collegeInput.value = savedInfo.college;

    if (btnSubmit) {
      btnSubmit.addEventListener('click', async () => {
        const nickname = nickInput ? nickInput.value : '';
        const college = collegeInput ? collegeInput.value : '';
        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Submitting...';

        const res = await this.leaderboard.submitScore({
          nickname,
          college,
          score: this.scoreManager.score,
          reclaimed: this.scoreManager.reclaimedPercentage.toFixed(1) + '%'
        });

        if (statusMsg) {
          statusMsg.textContent = res.success ? 'Score submitted to leaderboard!' : (res.reason || 'Failed to submit.');
          setTimeout(() => { if (statusMsg) statusMsg.textContent = ''; }, 4000);
        }
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Submit Score';
        this.renderLeaderboard();
      });
    }

    // Tab buttons
    ['all', 'today', 'college'].forEach(tab => {
      const tabBtn = document.getElementById(`tab-lb-${tab}`);
      if (tabBtn) {
        tabBtn.addEventListener('click', () => {
          document.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
          tabBtn.classList.add('active');
          this.renderLeaderboard(tab);
        });
      }
    });

    // Challenge a Friend Button
    const btnShare = document.getElementById('btn-share-challenge');
    if (btnShare) {
      btnShare.addEventListener('click', () => {
        const link = this.leaderboard.generateShareLink(
          this.scoreManager.score,
          this.scoreManager.reclaimedPercentage.toFixed(1) + '%'
        );
        navigator.clipboard?.writeText(link).then(() => {
          const orig = btnShare.textContent;
          btnShare.textContent = 'Challenge Link Copied!';
          setTimeout(() => { btnShare.textContent = orig; }, 2500);
        }).catch(() => {
          prompt('Share this challenge link with your friends:', link);
        });
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
    if (this.audio && typeof this.audio.handleTabVisibility === 'function') {
      this.audio.handleTabVisibility(true);
    }
    const dialogPause = document.getElementById('dialog-pause');
    if (dialogPause) {
      dialogPause.classList.add('open');
      dialogPause.setAttribute('aria-hidden', 'false');
    }
  }

  closePauseMenu() {
    this.isPaused = false;
    if (this.scoreManager) this.scoreManager.resume();
    if (this.audio && typeof this.audio.handleTabVisibility === 'function') {
      this.audio.handleTabVisibility(false);
    }
    const dialogPause = document.getElementById('dialog-pause');
    if (dialogPause) {
      dialogPause.classList.remove('open');
      dialogPause.setAttribute('aria-hidden', 'true');
    }
    // Re-lock pointer
    if (this.cameraController.mode === 'GAMEPLAY' && this.scoreManager.state === 'PLAYING') {
      try {
        const p = this.canvas.requestPointerLock?.();
        if (p && typeof p.catch === 'function') {
          p.catch(() => {});
        }
      } catch (e) {
        // Pointer lock fallback is handled gracefully
      }
    }
  }

  restartGame() {
    this.isPaused = false;
    this.keys.clear();
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

    const gameplayHudEl = document.getElementById('gameplay-hud');
    if (gameplayHudEl) {
      gameplayHudEl.classList.add('visible');
      gameplayHudEl.setAttribute('aria-hidden', 'false');
    }

    // Reset waypoints, full map, and world registry
    if (this.waypointSystem) this.waypointSystem.clearWaypoint();
    if (this.mapSystem && this.mapSystem.isFullMapOpen) this.mapSystem.closeFullMap();
    if (this.worldRegistry) this.worldRegistry.reset();

    // Instant restart under 1s resetting audio & state
    if (this.audio) this.audio.reset();
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
    this.keys.clear();
    if (this.audio) this.audio.reset();
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

    const gameplayHudEl = document.getElementById('gameplay-hud');
    if (gameplayHudEl) {
      gameplayHudEl.classList.remove('visible');
      gameplayHudEl.setAttribute('aria-hidden', 'true');
    }

    if (this.waypointSystem) this.waypointSystem.clearWaypoint();
    if (this.mapSystem && this.mapSystem.isFullMapOpen) this.mapSystem.closeFullMap();

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

  async renderLeaderboard(tab = 'all') {
    const container = document.getElementById('leaderboard-table-content');
    if (!container) return;
    container.innerHTML = '<div style="font-size:0.75rem; color:#64748b; padding:8px;">Fetching standings...</div>';

    const records = await this.leaderboard.fetchRecords(tab);
    if (!records || records.length === 0) {
      container.innerHTML = '<div style="font-size:0.75rem; color:#64748b; padding:8px;">No records yet. Be the first to claim a rank!</div>';
      return;
    }

    container.innerHTML = records.map((r, idx) => {
      const rank = idx + 1;
      const rankClass = rank === 1 ? 'top-1' : (rank === 2 ? 'top-2' : (rank === 3 ? 'top-3' : ''));
      return `
        <div class="lb-row ${rankClass}">
          <span style="font-weight:700;">#${rank}</span>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.nickname}</span>
          <span style="color:#94a3b8; font-size:0.75rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${r.college}</span>
          <span style="color:#05df72; font-weight:700; text-align:right;">${r.score}</span>
          <span style="color:#7e8b9f; font-size:0.72rem; text-align:right;">${r.reclaimed}</span>
        </div>
      `;
    }).join('');
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

    // Keep single moonlight shadow frustum centered tightly around player
    if (this.moonLight && this.robot && this.robot.position) {
      this.moonLight.target.position.set(this.robot.position.x, 0, this.robot.position.z);
      this.moonLight.position.set(this.robot.position.x + 80, 160, this.robot.position.z - 60);
    }

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

      // 6e. Sync World Registry & Update Waypoints / Minimap (30 FPS throttled)
      if (this.worldRegistry) {
        this.worldRegistry.syncFromWorld({
          city: this.city,
          plantSystem: this.plantSystem,
          smogSystem: this.smogSystem,
          droneSystem: this.droneSystem,
          survival: this.survival,
          robot: this.robot,
          cameraController: this.cameraController
        });
      }

      if (this.waypointSystem) {
        this.waypointSystem.update(delta, this.gameTime);
      }

      if (this.mapSystem) {
        this.mapSystem.update(delta, this.gameTime);
      }
    }
  }
}

// Launch on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  new VerdantZeroApp();
});

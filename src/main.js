import "@fontsource/big-shoulders-display/latin-700";
import "@fontsource/big-shoulders-display/latin-800";
import "@fontsource/inter/latin-400";
import "@fontsource/inter/latin-500";
import "@fontsource/inter/latin-600";

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
import { ScoreManager, formatTime } from './systems/ScoreManager.js';
import { LeaderboardSystem } from './systems/LeaderboardSystem.js';
import { WorldRegistry } from './systems/WorldRegistry.js';
import { MapSystem } from './systems/MapSystem.js';
import { WaypointSystem } from './systems/WaypointSystem.js';
import { HologramSystem } from './world/HologramSystem.js';
import { showToast, clearToasts } from './ui/Toasts.js';
import { escapeHtml } from './ui/escape.js';

const $ = (id) => document.getElementById(id);

function readSetting(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function writeSetting(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* storage unavailable */ }
}

function isTypingTarget(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

/**
 * Verdant Zero — application orchestrator.
 * Owns the scene, wires every system together, handles input, menus and the per-frame update.
 */
class VerdantZeroApp {
  constructor() {
    this.canvas = $('webgl-canvas');
    this.isPaused = false;
    this.isMapOpen = false;
    this.isAltHeld = false;
    this.settingsFromTitle = false;
    this.isPointerLocked = false;
    this.gameTime = 0;
    this.plantBuffer = 0;
    this.scoreSubmitted = false;
    this.keys = new Map();
    this.gpPrev = [];
    this.allowGamepad = true;

    this.engine = new Engine(this.canvas);

    // Scene, fog, environment
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c1e);
    this.scene.fog = new THREE.FogExp2(0x281648, 0.0023);
    this.scene.environment = createProceduralEnvMap(this.engine.renderer);

    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);

    // Lights: hemisphere + one shadow-casting moon (+ the robot's lantern)
    this.scene.add(new THREE.HemisphereLight(0x483280, 0x152536, 2.6));
    const moonLight = new THREE.DirectionalLight(0x7e9ae0, 2.0);
    moonLight.position.set(80, 160, -60);
    moonLight.castShadow = true;
    moonLight.shadow.mapSize.set(1024, 1024);
    Object.assign(moonLight.shadow.camera, { near: 10, far: 400, left: -60, right: 60, top: 60, bottom: -60 });
    moonLight.shadow.bias = -0.0005;
    this.scene.add(moonLight, moonLight.target);
    this.moonLight = moonLight;

    // World
    this.city = new CityGenerator(this.scene);
    this.weather = new WeatherAndTraffic(this.scene);
    this.weather.setFocus(this.camera.position);
    this.hologramSystem = new HologramSystem(this.scene);

    // Core systems
    this.audio = new AudioManager();
    this.cameraController = new CameraController(this.camera, this.city.buildingColliders);
    this.scoreManager = new ScoreManager(this.audio);
    this.leaderboard = new LeaderboardSystem();

    this.robot = new RobotGardener(this.scene, this.city.buildingColliders);
    this.city.setPlayerPosition(this.robot.position);
    this.plantSystem = new PlantSystem(this.scene, this.city, this.audio, this.scoreManager);

    this.smogSystem = new SmogSystem(this.scene, this.city.buildingColliders);
    this.droneSystem = new DroneSystem(this.scene, this.audio, this.city.buildingColliders);
    this.survival = new SurvivalManager(this.scene, this.city, this.audio, this.scoreManager);

    this.plantSystem.setSurvivalManager(this.survival);
    this.survival.setPlantSystem(this.plantSystem);
    this.droneSystem.setPlantSystem(this.plantSystem);
    this.droneSystem.onPlayerHit = (dmg) => this.survival.applyHit(dmg);
    this.plantSystem.onVineLost = (name) => showToast(`Vine lost${name ? ` at ${name}` : ''} — replant it`, 'bad', 2600);
    this.scoreManager.healthProvider = () => this.survival.health;
    this.scoreManager.onGameOver = () => this.handleGameOver();

    // Navigation
    this.worldRegistry = new WorldRegistry();
    this.waypointSystem = new WaypointSystem(this.scene, this.camera, this.worldRegistry, this.audio);
    this.waypointSystem.canUse = () => this.isPlaying();
    this.mapSystem = new MapSystem({
      scene: this.scene,
      camera: this.camera,
      worldRegistry: this.worldRegistry,
      waypointSystem: this.waypointSystem,
      app: this
    });
    this.syncRegistry(true);

    this.initInput();
    this.initMouseLook();
    this.initErrorBoundary();

    this.engine.onVisibilityPause = () => {
      if (this.isPlaying()) this.openPauseMenu();
    };
    document.addEventListener('visibilitychange', () => {
      this.audio.handleTabVisibility(document.hidden || this.isPaused);
    });

    this.engine.initPostProcessing(this.scene, this.camera);
    this.engine.onQualityChange = (tier) => {
      this.weather.setQuality(tier);
      this.smogSystem.setQuality(tier);
      const label = $('quality-active');
      if (label) label.textContent = this.engine.savedQuality === 'auto' ? `→ ${tier}` : '';
    };

    // Compile shaders up front so the first gameplay frames don't hitch
    const loaderBar = $('loader-bar-fill');
    if (loaderBar) loaderBar.style.transform = 'scaleX(0.7)';
    try {
      this.engine.renderer.compile(this.scene, this.camera);
    } catch (err) {
      console.warn('[Verdant Zero] Shader pre-compile failed:', err);
    }
    if (loaderBar) loaderBar.style.transform = 'scaleX(1)';
    setTimeout(() => $('shader-loader')?.classList.add('loaded'), 250);

    this.initUI();
    this.refreshTitleRecords();

    this.engine.start((delta, time) => this.update(delta, time));
    window.__vz_app = this;
  }

  isPlaying() {
    return this.cameraController.mode === 'GAMEPLAY' && this.scoreManager.state === 'PLAYING' && !this.isPaused;
  }

  // ===========================================================================
  // INPUT
  // ===========================================================================

  initInput() {
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e)) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.key === 'Alt') {
        e.preventDefault();
        this.isAltHeld = true;
        this.releasePointerLock();
      }

      this.keys.set(e.code, true);
      if (e.repeat) return;

      switch (e.code) {
        case 'KeyE':
          if (this.isPlaying()) this.plantBuffer = 0.15;
          break;
        case 'KeyQ':
          if (this.isPlaying()) this.survival.triggerLightPulse(this.robot.position, this.smogSystem, this.droneSystem);
          break;
        case 'KeyR':
          if (this.isPlaying() || this.scoreManager.state === 'GAMEOVER') this.restartGame();
          break;
        case 'Enter':
          if (this.cameraController.mode === 'TITLE' && !this.anyDialogOpen()) $('btn-play')?.click();
          break;
        case 'KeyM':
        case 'Tab':
          if (this.isMapOpen) this.mapSystem.closeFullMap();
          else if (this.isPlaying()) this.mapSystem.openFullMap();
          break;
        case 'Escape':
        case 'KeyP':
          this.handleBackKey(e.code);
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);
      if (e.key === 'Alt') this.isAltHeld = false;
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.isAltHeld = false;
    });

    const startAudio = () => this.audio.ensureContext();
    window.addEventListener('pointerdown', startAudio, { once: true });
    window.addEventListener('keydown', startAudio, { once: true });
  }

  anyDialogOpen() {
    return !!document.querySelector('.dialog-overlay.open');
  }

  handleBackKey(code) {
    const how = $('dialog-how');
    if (how.classList.contains('open')) { this.closeDialog(how); return; }
    if (this.isMapOpen) { this.mapSystem.closeFullMap(); return; }
    if (this.settingsFromTitle) { this.closePauseMenu(); return; }
    if (this.scoreManager.state === 'GAMEOVER') return;
    if (code === 'KeyP' && !this.isPaused && !this.isPlaying()) return;
    if (this.cameraController.mode === 'GAMEPLAY') {
      if (this.isPaused) this.closePauseMenu();
      else this.openPauseMenu();
    }
  }

  isKeyPressed(code) {
    return this.keys.get(code) === true;
  }

  /** Edge-triggered gamepad buttons for menu-level actions (movement is read by the robot). */
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (!gp) return;
    const pressed = (i) => !!gp.buttons[i]?.pressed;
    const edge = (i) => pressed(i) && !this.gpPrev[i];

    if (edge(9)) this.handleBackKey('Escape');                       // Menu / Start
    if (this.isPlaying()) {
      if (edge(2)) this.plantBuffer = 0.15;                            // X
      if (edge(4)) this.survival.triggerLightPulse(this.robot.position, this.smogSystem, this.droneSystem); // LB
      if (edge(14)) this.waypointSystem.targetNearestWater();          // D-pad left
      if (edge(15)) this.waypointSystem.targetNearestFertileSpot();    // D-pad right
    }
    if (edge(8)) {                                                     // View / Select
      if (this.isMapOpen) this.mapSystem.closeFullMap();
      else if (this.isPlaying()) this.mapSystem.openFullMap();
    }
    if (this.cameraController.mode === 'TITLE' && edge(0) && !this.anyDialogOpen()) $('btn-play')?.click();

    for (let i = 0; i < gp.buttons.length; i++) this.gpPrev[i] = pressed(i);
  }

  tryPlant() {
    const spot = this.plantSystem.checkProximity(this.robot.position, false);
    if (!spot) return false;
    if (!this.survival.canAffordPlant()) {
      this.survival.notifyDeniedPlanting();
      this.city.flashSpotDenied(spot);
      return true;
    }
    this.survival.consumeWaterForSeed();
    const risky = this.survival.isRisky(spot.data, this.smogSystem);
    this.plantSystem.plant(spot, risky);
    if (this.waypointSystem.activeWaypoint?.type === 'SPOT') this.waypointSystem.clearWaypoint();
    return true;
  }

  initMouseLook() {
    const promptEl = $('pointerlock-prompt');

    this.canvas.addEventListener('click', () => {
      if (this.isPlaying() && !document.pointerLockElement) this.requestPointerLock();
    });

    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.isPlaying() && e.target === this.canvas) {
        this.survival.triggerLightPulse(this.robot.position, this.smogSystem, this.droneSystem);
      }
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      const wasLocked = this.isPointerLocked;
      this.isPointerLocked = locked;
      const requested = this.expectingUnlock;
      if (!locked) this.expectingUnlock = false;
      // Losing the lock unexpectedly (browser Esc) pauses — unless the game or the player (Alt) freed the cursor
      if (wasLocked && !locked && !requested && this.isPlaying() && !this.isAltHeld && !this.isMapOpen) {
        this.openPauseMenu();
      }
      this.updatePointerPrompt();
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPaused || this.isMapOpen) return;
      if (this.isPointerLocked) {
        this.cameraController.handlePointerMove(e.movementX, e.movementY);
      }
    });

    this.pointerPromptEl = promptEl;
  }

  updatePointerPrompt() {
    if (!this.pointerPromptEl) return;
    const show = !this.isPointerLocked && this.isPlaying() && !this.isMapOpen;
    this.pointerPromptEl.classList.toggle('visible', show);
  }

  /** Release the mouse on purpose (menus, map, Alt) — must not be mistaken for the player pressing Esc. */
  releasePointerLock() {
    if (!document.pointerLockElement) return;
    this.expectingUnlock = true;
    document.exitPointerLock?.();
  }

  requestPointerLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* not allowed without a gesture; the prompt explains */ }
  }

  initErrorBoundary() {
    const dialog = $('dialog-error');
    const showError = (err) => {
      const msg = (err && (err.message || String(err))) || '';
      if (/pointer ?lock|user gesture|NotAllowedError|The user has exited the lock/i.test(msg)) return;
      console.error('Verdant Zero error:', err);
      $('error-message').textContent = `${msg || 'Unknown error'}. You can restart the run or reload the page.`;
      this.openDialog(dialog);
    };
    window.addEventListener('error', (e) => showError(e.error || e.message));
    window.addEventListener('unhandledrejection', (e) => showError(e.reason));
    $('btn-error-restart').addEventListener('click', () => { this.closeDialog(dialog); this.restartGame(); });
    $('btn-error-reload').addEventListener('click', () => window.location.reload());
  }

  // ===========================================================================
  // UI
  // ===========================================================================

  openDialog(el) {
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
  }

  closeDialog(el) {
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
  }

  bindSlider(id, valueId, key, fallback, format, apply) {
    const slider = $(id);
    const label = $(valueId);
    const initial = parseFloat(readSetting(key, fallback));
    const value = Number.isFinite(initial) ? initial : parseFloat(fallback);
    slider.value = String(value);
    label.textContent = format(value);
    apply(value, true);
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      label.textContent = format(v);
      apply(v, false);
    });
  }

  bindCheckbox(id, key, fallback, apply) {
    const box = $(id);
    box.checked = readSetting(key, String(fallback)) === 'true';
    apply(box.checked, true);
    box.addEventListener('change', () => {
      writeSetting(key, box.checked);
      apply(box.checked, false);
    });
  }

  initSettings() {
    const pct = v => `${Math.round(v * 100)}%`;
    const audio = this.audio;

    // Audio (the AudioManager persists its own values)
    this.bindSlider('setting-master-vol', 'master-vol-val', 'vz_master_vol', '1', pct, (v) => audio.setMasterVolume(v));
    this.bindSlider('setting-music-vol', 'music-vol-val', 'vz_music_vol', '0.85', pct, (v) => audio.setMusicVolume(v));
    this.bindSlider('setting-ambient-vol', 'ambient-vol-val', 'vz_ambient_vol', '0.8', pct, (v) => audio.setAmbienceVolume(v));
    this.bindSlider('setting-sfx-vol', 'sfx-vol-val', 'vz_sfx_vol', '0.85', pct, (v) => audio.setSfxVolume(v));
    this.bindCheckbox('setting-mute-audio', 'vz_mute_audio', false, (on) => audio.setMuted(on));

    // Controls
    this.bindSlider('setting-sensitivity', 'sensitivity-value', 'vz_mouse_sensitivity', '1', v => `${v.toFixed(1)}×`,
      (v) => this.cameraController.setSensitivity(v));
    this.bindSlider('setting-move-speed', 'move-speed-val', 'vz_move_speed_scale', '1', pct, (v) => this.robot.setSpeedScale(v));
    this.bindCheckbox('setting-invert-y', 'vz_invert_y', false, (on) => this.cameraController.setInvertY(on));
    this.bindCheckbox('setting-cam-smoothing', 'vz_cam_smoothing', true, (on) => { this.cameraController.damping = on ? 12 : 40; });

    // Display
    this.bindSlider('setting-fov', 'fov-val', 'vz_fov', '60', v => `${Math.round(v)}°`, (v, init) => {
      this.cameraController.baseFov = v;
      this.camera.fov = v;
      this.camera.updateProjectionMatrix();
      if (!init) writeSetting('vz_fov', v);
    });
    this.bindSlider('setting-brightness', 'brightness-value', 'vz_brightness', '1', v => `${v.toFixed(1)}×`, (v, init) => {
      this.engine.setBrightness(v);
      if (!init) writeSetting('vz_brightness', v);
    });
    this.bindCheckbox('setting-msaa', 'vz_msaa', false, (on) => this.engine.postProcessing?.setAntialias(on));
    this.bindCheckbox('setting-show-fps', 'vz_show_fps', false, (on) => $('debug-fps').classList.toggle('visible', on));

    const quality = $('setting-quality');
    quality.value = this.engine.savedQuality;
    quality.addEventListener('change', () => {
      if (quality.value === 'auto') {
        this.engine.savedQuality = 'auto';
        writeSetting('vz_quality_preset', 'auto');
        this.engine.startBenchmark();
      } else {
        this.engine.benchmarking = false;
        this.engine.setQuality(quality.value, true);
      }
    });
  }

  initUI() {
    this.initSettings();

    $('btn-play').addEventListener('click', () => this.startGame());
    $('btn-how').addEventListener('click', () => { this.audio.ensureContext(); this.openDialog($('dialog-how')); });
    $('btn-close-how').addEventListener('click', () => this.closeDialog($('dialog-how')));
    $('btn-settings').addEventListener('click', () => {
      this.audio.ensureContext();
      this.settingsFromTitle = true;
      $('dialog-pause').classList.add('from-title');
      $('pause-title').textContent = 'Settings';
      $('btn-resume').textContent = 'Back';
      this.openDialog($('dialog-pause'));
    });

    $('btn-resume').addEventListener('click', () => this.closePauseMenu());
    $('btn-pause-restart').addEventListener('click', () => this.restartGame());
    $('btn-pause-menu').addEventListener('click', () => this.returnToMainMenu());
    $('btn-gameover-restart').addEventListener('click', () => this.restartGame());
    $('btn-gameover-menu').addEventListener('click', () => this.returnToMainMenu());
    $('pulse-ability').addEventListener('click', () => {
      if (this.isPlaying()) this.survival.triggerLightPulse(this.robot.position, this.smogSystem, this.droneSystem);
    });

    // Leaderboard
    const nickInput = $('leaderboard-nickname');
    const collegeInput = $('leaderboard-college');
    const btnSubmit = $('btn-submit-score');
    const statusMsg = $('submit-status-msg');
    const saved = this.leaderboard.getSavedPlayerInfo();
    nickInput.value = saved.nickname;
    collegeInput.value = saved.college;

    btnSubmit.addEventListener('click', async () => {
      if (this.scoreSubmitted) return;
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Saving…';
      const res = await this.leaderboard.submitScore({
        nickname: nickInput.value,
        college: collegeInput.value,
        score: this.scoreManager.score,
        reclaimed: `${this.scoreManager.reclaimedPercentage.toFixed(1)}%`,
        combo: this.scoreManager.bestCombo,
        time: Math.floor(this.scoreManager.timeSurvived),
        victory: this.scoreManager.isVictory
      });
      if (res.success) {
        this.scoreSubmitted = true;
        btnSubmit.textContent = 'Saved';
        statusMsg.textContent = res.remote ? 'Saved locally and to the online board.' : 'Saved to this device.';
      } else {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Save score';
        statusMsg.textContent = res.reason || 'Could not save.';
      }
      this.renderLeaderboard(this.activeLbTab);
    });

    ['all', 'today', 'college'].forEach(tab => {
      const btn = $(`tab-lb-${tab}`);
      btn.addEventListener('click', () => {
        document.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderLeaderboard(tab);
      });
    });

    const btnShare = $('btn-share-challenge');
    btnShare.addEventListener('click', () => {
      const link = this.leaderboard.generateShareLink(this.scoreManager.score, `${this.scoreManager.reclaimedPercentage.toFixed(1)}%`);
      const done = () => {
        btnShare.textContent = 'Link copied!';
        setTimeout(() => { btnShare.textContent = 'Copy challenge link'; }, 2500);
      };
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(link).then(done).catch(() => window.prompt('Copy this challenge link:', link));
      } else {
        window.prompt('Copy this challenge link:', link);
      }
    });

    // Incoming challenge (?challengeScore=…)
    const params = new URLSearchParams(window.location.search);
    const challenge = parseInt(params.get('challengeScore') || '', 10);
    if (Number.isFinite(challenge) && challenge > 0) {
      this.challengeScore = challenge;
      const reclaimed = (params.get('reclaimed') || '').replace(/[^0-9.%]/g, '');
      $('challenge-text').textContent = `Beat ${challenge.toLocaleString()} points${reclaimed ? ` · ${reclaimed} reclaimed` : ''}`;
      $('challenge-banner').hidden = false;
    }
  }

  refreshTitleRecords() {
    const best = parseInt(readSetting('vz_high_score', '0'), 10) || 0;
    const rec = parseFloat(readSetting('vz_best_reclaimed', '0')) || 0;
    const combo = parseInt(readSetting('vz_best_combo', '1'), 10) || 1;
    $('rec-score').textContent = best > 0 ? best.toLocaleString() : '—';
    $('rec-reclaimed').textContent = rec > 0 ? `${rec.toFixed(1)}%` : '—';
    $('rec-combo').textContent = best > 0 ? `×${combo}` : '—';
  }

  setHudVisible(visible) {
    const hud = $('gameplay-hud');
    hud.classList.toggle('visible', visible);
    hud.setAttribute('aria-hidden', String(!visible));
    $('title-screen').classList.toggle('hidden', visible);
  }

  startGame() {
    if (this.cameraController.mode !== 'TITLE') return;
    this.audio.ensureContext();
    this.resetRun();
    this.setHudVisible(true);
    this.cameraController.startGameplayTransition(this.robot.position);
    this.scoreManager.startGame();
    this.requestPointerLock();
    setTimeout(() => {
      if (this.isPlaying()) showToast('Find a glowing planter and press E — G marks the nearest one', 'info', 4500);
    }, 1200);
  }

  openPauseMenu() {
    if (this.scoreManager.state === 'GAMEOVER') return;
    this.isPaused = true;
    this.keys.clear();
    this.scoreManager.pause();
    this.audio.handleTabVisibility(true);
    $('pause-title').textContent = 'Paused';
    $('btn-resume').textContent = 'Resume';
    $('dialog-pause').classList.remove('from-title');
    $('pause-run-summary').textContent =
      `${this.plantSystem.plantedCount} / ${this.plantSystem.totalSpots} planters · ${formatTime(this.scoreManager.timer)} left · ${this.scoreManager.score.toLocaleString()} pts`;
    this.openDialog($('dialog-pause'));
    this.releasePointerLock();
    this.updatePointerPrompt();
  }

  closePauseMenu() {
    this.closeDialog($('dialog-pause'));
    if (this.settingsFromTitle) {
      this.settingsFromTitle = false;
      return;
    }
    this.isPaused = false;
    this.scoreManager.resume();
    this.audio.handleTabVisibility(false);
    if (this.isPlaying()) this.requestPointerLock();
    this.updatePointerPrompt();
  }

  /** Called by MapSystem when the sector map opens/closes. */
  setMapOpen(open) {
    this.isMapOpen = open;
    this.keys.clear();
    if (open) {
      this.scoreManager.pause();
      this.releasePointerLock();
    } else {
      this.scoreManager.resume();
      if (this.isPlaying()) this.requestPointerLock();
    }
    this.updatePointerPrompt();
  }

  resetRun() {
    this.isPaused = false;
    this.keys.clear();
    this.gameTime = 0;
    this.plantBuffer = 0;
    this.scoreSubmitted = false;
    clearToasts();
    this.waypointSystem.clearWaypoint();
    if (this.isMapOpen) this.mapSystem.closeFullMap();
    this.worldRegistry.reset();
    this.audio.reset();
    this.robot.reset();
    this.plantSystem.reset();
    this.survival.reset();
    this.droneSystem.reset();
    this.smogSystem.reset();
    this.weather.setRainAcidic(false);
    this.scoreManager.reset();
    this.syncRegistry(true);

    const btn = $('btn-submit-score');
    btn.disabled = false;
    btn.textContent = 'Save score';
    $('submit-status-msg').textContent = '';
    ['dialog-pause', 'modal-gameover', 'dialog-error'].forEach(id => this.closeDialog($(id)));
    this.settingsFromTitle = false;
  }

  restartGame() {
    if (this.cameraController.mode === 'TITLE') {
      this.startGame();
      return;
    }
    this.resetRun();
    this.setHudVisible(true);
    this.cameraController.resetGameplay(this.robot.position);
    this.scoreManager.startGame();
    this.audio.handleTabVisibility(false);
    this.requestPointerLock();
  }

  returnToMainMenu() {
    this.resetRun();
    this.setHudVisible(false);
    this.cameraController.returnToTitle();
    this.scoreManager.state = 'MENU';
    this.audio.handleTabVisibility(false);
    this.releasePointerLock();
    this.refreshTitleRecords();
    this.updatePointerPrompt();
  }

  handleGameOver() {
    this.cameraController.setGameOverMode(this.robot.position);
    this.releasePointerLock();
    this.keys.clear();
    this.plantSystem.setPrompt('');
    this.audio.setLowHealth(false);
    this.updatePointerPrompt();
    this.activeLbTab = 'all';
    document.querySelectorAll('.lb-tab').forEach(b => b.classList.toggle('active', b.id === 'tab-lb-all'));
    this.renderLeaderboard('all');
    if (this.challengeScore) {
      const beat = this.scoreManager.score > this.challengeScore;
      showToast(beat ? `Challenge beaten! (${this.challengeScore.toLocaleString()})` : `Challenge: ${this.challengeScore.toLocaleString()} to beat`, beat ? 'milestone' : 'info', 4000);
    }
  }

  async renderLeaderboard(tab = 'all') {
    this.activeLbTab = tab;
    const container = $('leaderboard-table-content');
    container.innerHTML = '<div class="lb-empty">Loading…</div>';
    const records = await this.leaderboard.fetchRecords(tab);
    if (!records.length) {
      container.innerHTML = `<div class="lb-empty">${tab === 'college' ? 'Save a score with a crew name to see your crew here.' : 'No scores yet — save yours to claim #1.'}</div>`;
      return;
    }
    container.innerHTML = records.map((r, i) => `
      <div class="lb-row${i < 3 ? ` top-${i + 1}` : ''}">
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHtml(r.nickname)}<small>${escapeHtml(r.college)}</small></span>
        <span class="lb-score">${Number(r.score).toLocaleString()}</span>
        <span class="lb-rec">${escapeHtml(r.reclaimed)}</span>
      </div>`).join('');
  }

  // ===========================================================================
  // WORLD REGISTRY (minimap / waypoints data), throttled to 10 Hz
  // ===========================================================================

  syncRegistry(force = false) {
    this.registryTimer = (this.registryTimer || 0);
    if (!force && this.registryTimer > 0) return;
    this.registryTimer = 0.1;
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

  // ===========================================================================
  // FRAME UPDATE
  // ===========================================================================

  update(delta, time) {
    this.pollGamepad();

    // Ambient world animates in every state except pause/map
    if (!this.isPaused && !this.isMapOpen) {
      this.city.update(delta, time);
      this.weather.update(delta, time);
      this.hologramSystem.update(delta, time);
    }

    if (this.scoreManager.state === 'GAMEOVER') {
      this.cameraController.update(delta, time, this.robot);
      this.plantSystem.update(delta, time);
      return;
    }
    if (this.isPaused || this.isMapOpen) return;

    const playing = this.cameraController.mode === 'GAMEPLAY' && this.scoreManager.state === 'PLAYING';

    // Robot only takes input during gameplay
    this.robot.update(delta, time, playing ? this : NO_INPUT, this.cameraController.getHorizontalAngle(), this.cameraController.getPitchAngle());
    this.moonLight.target.position.set(this.robot.position.x, 0, this.robot.position.z);
    this.moonLight.position.set(this.robot.position.x + 80, 160, this.robot.position.z - 60);

    this.cameraController.update(delta, time, this.robot);
    this.plantSystem.update(delta, time);

    if (!playing) return;

    this.gameTime += delta;

    // Planting (with a short input buffer so E pressed just before arriving still counts)
    const nearSpot = this.plantSystem.checkProximity(this.robot.position, true);
    this.robot.isNearPlantSpot = !!nearSpot;
    if (this.plantBuffer > 0) {
      this.plantBuffer -= delta;
      if (this.tryPlant()) this.plantBuffer = 0;
    }

    this.scoreManager.setPlantedCount(this.plantSystem.plantedCount);
    this.scoreManager.update(delta);
    this.audio.setReclamationProgress(this.plantSystem.reclaimedPercentage / 100);
    if (this.scoreManager.state !== 'PLAYING') return;

    this.smogSystem.update(delta, this.gameTime, this.plantSystem.activeVines, this.robot.position);
    this.droneSystem.update(delta, this.gameTime, this.plantSystem.activeVines, this.robot.position, {
      alive: this.survival.health > 0,
      dashing: this.robot.isDashing,
      velocity: this.robot.velocity
    });
    this.droneSystem.updateScreenIndicators(this.camera);
    this.survival.update(delta, this.gameTime, this.robot, this.smogSystem, this.weather, this.plantSystem.activeVines);
    if (this.scoreManager.state !== 'PLAYING') return;

    this.registryTimer -= delta;
    this.syncRegistry();
    this.waypointSystem.update(delta, this.gameTime);
    this.mapSystem.update(delta, this.gameTime);
  }
}

// Input stub used while the camera is still flying in or the run has ended
const NO_INPUT = { isKeyPressed: () => false };

window.addEventListener('DOMContentLoaded', () => {
  new VerdantZeroApp();
});

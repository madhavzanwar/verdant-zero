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
 * Orchestrates Procedural City, Weather, Robot Gardener,
 * Planting System, Camera, and Minimal Title Screen.
 */
class VerdantZeroApp {
  constructor() {
    this.canvas = document.getElementById('webgl-canvas');

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

    // 4. Core Subsystems
    this.engine = new Engine(this.canvas);
    this.audio = new AudioManager();
    this.cameraController = new CameraController(this.camera);

    // 5. Procedural City & Atmospheric Weather
    this.city = new CityGenerator(this.scene);
    this.weather = new WeatherAndTraffic(this.scene);

    // 6. Robot Gardener (Player) & Planting System
    this.robot = new RobotGardener(this.scene, this.city.buildingColliders);
    this.plantSystem = new PlantSystem(this.scene, this.city, this.audio);

    // 7. Input State
    this.keys = new Map();
    this.initInput();

    // 8. Post-Processing Pipeline
    this.engine.initPostProcessing(this.scene, this.camera);

    // 9. Minimal Title Screen UI Bindings
    this.initUI();

    // 10. Start 60 FPS Engine Loop
    this.engine.start((delta, time) => this.update(delta, time));
  }

  initInput() {
    window.addEventListener('keydown', (e) => {
      this.keys.set(e.code, true);

      // Plant seed interaction on KeyE
      if (e.code === 'KeyE') {
        const spot = this.plantSystem.checkProximity(this.robot.position);
        if (spot) {
          this.plantSystem.plant(spot);
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

  isKeyPressed(code) {
    return !!this.keys.get(code);
  }

  initUI() {
    const titleScreenEl = document.getElementById('title-screen');
    const btnPlay = document.getElementById('btn-play');
    const btnHow = document.getElementById('btn-how');
    const dialogHow = document.getElementById('dialog-how');
    const btnCloseHow = document.getElementById('btn-close-how');

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

    // Backdrop click or Escape key to close dialog
    if (dialogHow) {
      dialogHow.addEventListener('click', (e) => {
        if (e.target === dialogHow) {
          dialogHow.classList.remove('open');
          dialogHow.setAttribute('aria-hidden', 'true');
        }
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dialogHow && dialogHow.classList.contains('open')) {
        dialogHow.classList.remove('open');
        dialogHow.setAttribute('aria-hidden', 'true');
      }
    });
  }

  update(delta, time) {
    // 1. Update City & Atmospheric Details
    this.city.update(delta, time);
    this.weather.update(delta, time);

    // 2. Calculate Camera Horizontal Heading for Player-Relative Movement
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const cameraAngle = Math.atan2(forward.x, forward.z);

    // 3. Update Robot Gardener Physics & Eye
    this.robot.update(delta, time, this, cameraAngle);

    // 4. Update Plant Proximity & Growth Animations
    const nearSpot = this.plantSystem.checkProximity(this.robot.position);
    this.robot.isNearPlantSpot = !!nearSpot;
    this.plantSystem.update(delta, time);

    // 5. Update Camera Controller
    this.cameraController.update(delta, time, this.robot);
  }
}

// Launch on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  new VerdantZeroApp();
});

import { Engine } from './core/Engine.js';
import { AudioManager } from './core/AudioManager.js';
import { GameState, STATES } from './core/GameState.js';
import { InputManager } from './core/InputManager.js';
import { TitleScene } from './scenes/TitleScene.js';
import { TitleScreen } from './ui/TitleScreen.js';

/**
 * VERDANT ZERO // Application Bootstrap
 */
class VerdantZeroApp {
  constructor() {
    this.canvas = document.getElementById('webgl-canvas');
    this.gameState = new GameState();
    this.audioManager = new AudioManager();
    this.inputManager = new InputManager();

    // Initialize 3D Engine
    this.engine = new Engine(this.canvas);

    // Initialize Title 3D Scene
    this.titleScene = new TitleScene();
    this.engine.setScene(this.titleScene);

    // Initialize UI Controller
    this.titleScreen = new TitleScreen({
      gameState: this.gameState,
      audioManager: this.audioManager
    });

    // Start 60 FPS Render Loop
    this.engine.start();

    // Enable audio on first user touch / click
    const handleFirstUserInteraction = () => {
      this.audioManager.ensureContext();
      window.removeEventListener('pointerdown', handleFirstUserInteraction);
      window.removeEventListener('keydown', handleFirstUserInteraction);
    };
    window.addEventListener('pointerdown', handleFirstUserInteraction, { once: true });
    window.addEventListener('keydown', handleFirstUserInteraction, { once: true });

    console.log(
      '%c VERDANT ZERO %c v0.1.0-ALPHA // 2150 CYBERPUNK METACITY %c',
      'background: #00f0ff; color: #060710; font-weight: bold; padding: 4px 8px; border-radius: 4px;',
      'background: #060710; color: #00ff88; font-weight: bold; padding: 4px 8px; border: 1px solid #00ff88;',
      ''
    );
  }
}

// Instantiate application once DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  new VerdantZeroApp();
});

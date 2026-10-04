/**
 * VERDANT ZERO // Game State & Score Store
 * Architecture designed for replayability, combos, and high-score persistence.
 */

export const STATES = {
  TITLE: 'TITLE',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  GAMEOVER: 'GAMEOVER'
};

export class GameState {
  constructor() {
    this.currentState = STATES.TITLE;
    
    // Core game metrics
    this.score = 0;
    this.highScore = parseInt(localStorage.getItem('vz_high_score') || '0', 10);
    this.combo = 0;
    this.maxCombo = parseInt(localStorage.getItem('vz_max_combo') || '0', 10);
    this.seedsRemaining = 1;
    this.greenPercentage = 0.0;
    
    // Event listeners
    this.listeners = new Map();
  }

  /**
   * Transition to a new state
   * @param {string} newState 
   */
  setState(newState) {
    if (this.currentState === newState) return;
    const oldState = this.currentState;
    this.currentState = newState;
    this.emit('stateChange', { oldState, newState });
  }

  /**
   * Add score with active combo multiplier
   * @param {number} points 
   */
  addScore(points) {
    const multiplier = 1 + Math.floor(this.combo / 5) * 0.5;
    const gained = Math.round(points * multiplier);
    this.score += gained;

    if (this.score > this.highScore) {
      this.highScore = this.score;
      localStorage.setItem('vz_high_score', this.highScore.toString());
      this.emit('newHighScore', this.highScore);
    }

    this.emit('scoreUpdate', { score: this.score, gained, multiplier });
  }

  /**
   * Register a combo increment
   */
  incrementCombo() {
    this.combo++;
    if (this.combo > this.maxCombo) {
      this.maxCombo = this.combo;
      localStorage.setItem('vz_max_combo', this.maxCombo.toString());
    }
    this.emit('comboUpdate', { combo: this.combo, maxCombo: this.maxCombo });
  }

  /**
   * Reset combo (e.g. miss or impact)
   */
  resetCombo() {
    if (this.combo > 0) {
      this.combo = 0;
      this.emit('comboReset');
    }
  }

  /**
   * Resets gameplay session values for a new run
   */
  resetSession() {
    this.score = 0;
    this.combo = 0;
    this.seedsRemaining = 1;
    this.greenPercentage = 0.0;
    this.emit('sessionReset');
  }

  /**
   * Subscribes to game state events
   * @param {string} event 
   * @param {Function} callback 
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event).delete(callback);
  }

  /**
   * Emits an event to registered listeners
   * @param {string} event 
   * @param {any} data 
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      }
    }
  }
}

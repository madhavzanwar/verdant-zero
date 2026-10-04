import { STATES } from '../core/GameState.js';

/**
 * VERDANT ZERO // Title Screen UI Controller
 * Manages glassmorphism interface interactions, audio triggers,
 * stats presentation, and system archives modal.
 */
export class TitleScreen {
  constructor({ gameState, audioManager }) {
    this.gameState = gameState;
    this.audioManager = audioManager;

    // DOM Elements
    this.screenEl = document.getElementById('title-screen');
    this.btnStart = document.getElementById('btn-start-game');
    this.btnLore = document.getElementById('btn-open-lore');
    this.btnCloseLore = document.getElementById('btn-close-lore');
    this.btnDismissLore = document.getElementById('btn-modal-dismiss');
    this.loreModal = document.getElementById('lore-modal');
    this.btnAudioToggle = document.getElementById('btn-audio-toggle');
    this.audioStatusLabel = document.getElementById('audio-status-label');
    this.audioWave1 = document.getElementById('audio-wave-1');
    this.audioWave2 = document.getElementById('audio-wave-2');
    
    // Stats elements
    this.highScoreEl = document.getElementById('title-high-score');
    this.highComboEl = document.getElementById('title-high-combo');
    this.toastEl = document.getElementById('system-toast');
    this.toastMsgEl = document.getElementById('toast-message');

    this.toastTimeout = null;

    this.init();
  }

  init() {
    this.updateStatsDisplay();
    this.updateAudioButtonState(this.audioManager.isMuted);
    this.bindEvents();

    // Listen for GameState updates
    this.gameState.on('newHighScore', () => this.updateStatsDisplay());
  }

  updateStatsDisplay() {
    if (this.highScoreEl) {
      this.highScoreEl.textContent = this.gameState.highScore.toLocaleString().padStart(6, '0');
    }
    if (this.highComboEl) {
      this.highComboEl.textContent = `${this.gameState.maxCombo}x`;
    }
  }

  updateAudioButtonState(isMuted) {
    if (this.audioStatusLabel) {
      this.audioStatusLabel.textContent = isMuted ? 'AUDIO: OFF' : 'AUDIO: ON';
    }
    if (this.btnAudioToggle) {
      if (isMuted) {
        this.btnAudioToggle.classList.add('muted');
        if (this.audioWave1) this.audioWave1.style.opacity = '0.2';
        if (this.audioWave2) this.audioWave2.style.opacity = '0.2';
      } else {
        this.btnAudioToggle.classList.remove('muted');
        if (this.audioWave1) this.audioWave1.style.opacity = '1';
        if (this.audioWave2) this.audioWave2.style.opacity = '1';
      }
    }
  }

  bindEvents() {
    // Interactive Audio Hover Effects
    const interactiveButtons = [
      this.btnStart,
      this.btnLore,
      this.btnCloseLore,
      this.btnDismissLore,
      this.btnAudioToggle
    ];

    interactiveButtons.forEach(btn => {
      if (!btn) return;
      btn.addEventListener('mouseenter', () => {
        this.audioManager.playHover();
      });
    });

    // Start Button Action
    if (this.btnStart) {
      this.btnStart.addEventListener('click', () => {
        this.audioManager.playStart();
        this.showToast('SYSTEM PRIMED // ARCHITECTURE READY FOR STAGE 2 GAMEPLAY');
      });
    }

    // Lore Modal Controls
    if (this.btnLore) {
      this.btnLore.addEventListener('click', () => {
        this.audioManager.playWhoosh();
        this.openLoreModal();
      });
    }

    if (this.btnCloseLore) {
      this.btnCloseLore.addEventListener('click', () => {
        this.audioManager.playClick();
        this.closeLoreModal();
      });
    }

    if (this.btnDismissLore) {
      this.btnDismissLore.addEventListener('click', () => {
        this.audioManager.playClick();
        this.closeLoreModal();
      });
    }

    // Close modal clicking on backdrop
    if (this.loreModal) {
      this.loreModal.addEventListener('click', (e) => {
        if (e.target === this.loreModal) {
          this.audioManager.playClick();
          this.closeLoreModal();
        }
      });
    }

    // Audio Toggle
    if (this.btnAudioToggle) {
      this.btnAudioToggle.addEventListener('click', () => {
        const isMuted = this.audioManager.toggleMute();
        this.updateAudioButtonState(isMuted);
        if (!isMuted) {
          this.audioManager.playClick();
          this.showToast('SYNTH AUDIO PROTOCOL ACTIVE');
        } else {
          this.showToast('AUDIO SYSTEM MUTED');
        }
      });
    }

    // Keyboard navigation (ESC closes modal)
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.loreModal.classList.contains('open')) {
        this.closeLoreModal();
      }
    });
  }

  openLoreModal() {
    if (this.loreModal) {
      this.loreModal.classList.add('open');
      this.loreModal.setAttribute('aria-hidden', 'false');
    }
  }

  closeLoreModal() {
    if (this.loreModal) {
      this.loreModal.classList.remove('open');
      this.loreModal.setAttribute('aria-hidden', 'true');
    }
  }

  showToast(message, duration = 3000) {
    if (!this.toastEl || !this.toastMsgEl) return;

    this.toastMsgEl.textContent = message;
    this.toastEl.classList.add('show');

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }

    this.toastTimeout = setTimeout(() => {
      this.toastEl.classList.remove('show');
    }, duration);
  }
}

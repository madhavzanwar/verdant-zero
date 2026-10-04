/**
 * VERDANT ZERO // Audio Manager
 * Procedural Web Audio API sound generator.
 * Zero external audio assets, zero network latency, 100% offline & client-side.
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.isMuted = localStorage.getItem('vz_audio_muted') === 'true';
    this.masterGain = null;
    this.ambientGain = null;
    this.ambientNodes = [];
    this.isAmbientPlaying = false;
    this.initialized = false;
  }

  /**
   * Initializes AudioContext upon user gesture to comply with browser autoplay policy.
   */
  init() {
    if (this.initialized) return;

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContextClass();
      
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.65, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      this.ambientGain.connect(this.masterGain);

      this.initialized = true;
      this.startAmbientDrone();
    } catch (e) {
      console.warn('Web Audio API not supported or blocked:', e);
    }
  }

  ensureContext() {
    if (!this.initialized) {
      this.init();
    } else if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Creates a dark cyberpunk ambient background hum.
   * Uses dual low-frequency detuned oscillators filtered through a slow LFO lowpass filter.
   */
  startAmbientDrone() {
    if (!this.ctx || this.isAmbientPlaying) return;

    try {
      const t = this.ctx.currentTime;

      // Filter
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, t);
      filter.Q.setValueAtTime(4.0, t);

      // Filter LFO for breathing city effect
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.setValueAtTime(0.08, t); // Very slow cycle (12.5 seconds)
      lfoGain.gain.setValueAtTime(60, t);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start(t);

      // Low Sub Drone (Oscillator 1)
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(55, t); // A1 note
      osc1.connect(filter);
      osc1.start(t);

      // Detuned Harmonizer (Oscillator 2)
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(54.2, t); // Slight detune for phasing
      osc2.connect(filter);
      osc2.start(t);

      // Subtle High Shimmer (Bioluminescent aura tone)
      const shimmerFilter = this.ctx.createBiquadFilter();
      shimmerFilter.type = 'bandpass';
      shimmerFilter.frequency.setValueAtTime(880, t);
      shimmerFilter.Q.setValueAtTime(6.0, t);

      const shimmerOsc = this.ctx.createOscillator();
      shimmerOsc.type = 'sine';
      shimmerOsc.frequency.setValueAtTime(440, t);

      const shimmerGain = this.ctx.createGain();
      shimmerGain.gain.setValueAtTime(0.04, t);
      shimmerOsc.connect(shimmerFilter);
      shimmerFilter.connect(shimmerGain);
      shimmerGain.connect(this.ambientGain);
      shimmerOsc.start(t);

      filter.connect(this.ambientGain);

      this.ambientNodes = [osc1, osc2, lfo, shimmerOsc];
      this.isAmbientPlaying = true;
    } catch (e) {
      console.warn('Could not start ambient drone:', e);
    }
  }

  /**
   * High-tech UI Hover Blip
   */
  playHover() {
    if (this.isMuted || !this.ctx) return;
    this.ensureContext();

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, t);
      osc.frequency.exponentialRampToValueAtTime(1900, t + 0.04);

      gain.gain.setValueAtTime(0.05, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 0.045);
    } catch (e) {}
  }

  /**
   * Resonant Cybernetic UI Click
   */
  playClick() {
    if (this.isMuted || !this.ctx) return;
    this.ensureContext();

    try {
      const t = this.ctx.currentTime;

      // Primary tone
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(620, t);
      osc1.frequency.exponentialRampToValueAtTime(310, t + 0.09);

      gain1.gain.setValueAtTime(0.2, t);
      gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

      osc1.connect(gain1);
      gain1.connect(this.masterGain);

      // Higher chime
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1240, t);
      gain2.gain.setValueAtTime(0.12, t);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

      osc2.connect(gain2);
      gain2.connect(this.masterGain);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.095);
      osc2.stop(t + 0.095);
    } catch (e) {}
  }

  /**
   * System Initialize / Start Fanfare
   */
  playStart() {
    if (this.isMuted || !this.ctx) return;
    this.ensureContext();

    try {
      const t = this.ctx.currentTime;
      const notes = [440, 554.37, 659.25, 880, 1108.73]; // Pentatonic arpeggio

      notes.forEach((freq, idx) => {
        const startTime = t + idx * 0.07;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.18, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(startTime);
        osc.stop(startTime + 0.36);
      });
    } catch (e) {}
  }

  /**
   * Cybernetic UI Whoosh for modal open/close
   */
  playWhoosh() {
    if (this.isMuted || !this.ctx) return;
    this.ensureContext();

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(300, t);
      filter.frequency.exponentialRampToValueAtTime(1600, t + 0.12);
      filter.Q.setValueAtTime(2.0, t);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, t);

      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 0.15);
    } catch (e) {}
  }

  /**
   * Toggles mute state
   * @returns {boolean} New mute state
   */
  toggleMute() {
    this.ensureContext();
    this.isMuted = !this.isMuted;
    localStorage.setItem('vz_audio_muted', this.isMuted.toString());

    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.65, this.ctx.currentTime);
    }

    return this.isMuted;
  }
}

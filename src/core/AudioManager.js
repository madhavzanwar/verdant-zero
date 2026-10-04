/**
 * Layered Procedural Web Audio Synthesizer
 * - Low deep drone
 * - Procedural rain sound (filtered noise)
 * - Distant city hum
 * - Occasional distant rolling thunder
 * - Ascending crystal chime on planting + warm swelling life pad
 * - Starts only on first click with a smooth fade-in
 */

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.ambientGain = null;
    this.isInitialized = false;
    this.thunderTimer = null;
  }

  init() {
    if (this.isInitialized) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      // Master Gain starting at 0 for fade in
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // Smooth 2.5 second fade in
      this.masterGain.gain.exponentialRampToValueAtTime(0.65, this.ctx.currentTime + 2.5);

      this.ambientGain = this.ctx.createGain();
      this.ambientGain.gain.setValueAtTime(0.85, this.ctx.currentTime);
      this.ambientGain.connect(this.masterGain);

      // Initialize Ambient Layers
      this.startDeepDrone();
      this.startRainSound();
      this.startCityHum();
      this.scheduleFarThunder();

      this.isInitialized = true;
    } catch (e) {
      console.warn('Web Audio API not supported:', e);
    }
  }

  ensureContext() {
    if (!this.isInitialized) {
      this.init();
    } else if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // 1. Low Deep Drone (Blade Runner 2049 sub-bass atmosphere)
  startDeepDrone() {
    const t = this.ctx.currentTime;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(110, t);
    filter.Q.setValueAtTime(3.5, t);

    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(46.25, t); // F#1

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(46.6, t); // Slight detune for slow beating

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.35, t);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(this.ambientGain);

    osc1.start(t);
    osc2.start(t);
  }

  // 2. Synthesized Rain Sound (Filtered white/pink noise)
  startRainSound() {
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    // Pink noise generation
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
      b6 = white * 0.115926;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    // Dual filtering for rain texture
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1200, this.ctx.currentTime);
    filter.Q.setValueAtTime(0.85, this.ctx.currentTime);

    const rainGain = this.ctx.createGain();
    rainGain.gain.setValueAtTime(0.24, this.ctx.currentTime);

    whiteNoise.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(this.ambientGain);

    whiteNoise.start(this.ctx.currentTime);
  }

  // 3. Distant City Hum
  startCityHum() {
    const t = this.ctx.currentTime;
    const humFilter = this.ctx.createBiquadFilter();
    humFilter.type = 'bandpass';
    humFilter.frequency.setValueAtTime(220, t);
    humFilter.Q.setValueAtTime(4.0, t);

    const humOsc = this.ctx.createOscillator();
    humOsc.type = 'triangle';
    humOsc.frequency.setValueAtTime(110, t);

    const humGain = this.ctx.createGain();
    humGain.gain.setValueAtTime(0.12, t);

    humOsc.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(this.ambientGain);

    humOsc.start(t);
  }

  // 4. Far Distant Rolling Thunder
  scheduleFarThunder() {
    const delay = 25000 + Math.random() * 25000; // Every 25 - 50 seconds
    this.thunderTimer = setTimeout(() => {
      this.playFarThunder();
      this.scheduleFarThunder();
    }, delay);
  }

  playFarThunder() {
    if (!this.ctx || this.ctx.state !== 'running') return;

    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(65, t);
      filter.frequency.exponentialRampToValueAtTime(35, t + 4.5);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(42, t);
      osc.frequency.exponentialRampToValueAtTime(24, t + 4.5);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 4.8);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 4.9);
    } catch (e) {}
  }

  // 5. Planting Crystal Chime & Swelling Pad
  playPlantingChime() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;

    // Ascending crystal chime arpeggio
    const freqs = [880, 1108.73, 1318.51, 1760.00, 2217.46];
    freqs.forEach((f, idx) => {
      const noteTime = t + idx * 0.08;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, noteTime);

      gain.gain.setValueAtTime(0.25, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 1.2);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start(noteTime);
      osc.stop(noteTime + 1.25);
    });

    // Warm swelling life pad as the vine grows
    const padNotes = [220, 277.18, 329.63, 440];
    padNotes.forEach(freq => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(280, t);
      filter.frequency.exponentialRampToValueAtTime(1400, t + 2.5); // Filter swell
      filter.frequency.exponentialRampToValueAtTime(400, t + 5.0);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 1.8);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 5.5);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      osc.stop(t + 5.6);
    });
  }

  destroy() {
    if (this.thunderTimer) clearTimeout(this.thunderTimer);
    if (this.ctx) this.ctx.close();
  }
}

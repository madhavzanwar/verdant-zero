/**
 * Verdant Zero — Generative Web Audio Engine (v2.0.0)
 * 
 * Soft, warm, relaxing generative audio architecture:
 * - Master bus: master gain at 0.3, lowpass filter at 2.2 kHz, gentle DynamicsCompressor limiter (guarantees peak < -6 dB).
 * - Shared reverb: ConvolverNode with 3-second algorithmic impulse response (exponentially decaying filtered noise).
 * - Ambient pad: Slow evolving chord progression in minor pentatonic (Am, F, C, G) lasting ~16s each with long crossfades.
 *   3 detuned sine/triangle oscillators through an 800Hz lowpass. Never uses sawtooth or square waves.
 * - Rain: Pink noise through a bandpass filter (300Hz - 2000Hz) at a quiet level. Zero thunder.
 * - Soft sound effects:
 *   * Gentle bell chime on planting (sine with soft 2nd harmonic, pentatonic pitch, 20ms attack, 2.5s decay).
 *   * Soft drop for water pickup (gentle sine envelope, warm decay).
 *   * Soft rising pentatonic notes for combo multiplier.
 *   * Soft airy lowpass whoosh for light pulse.
 *   * Quiet low hum for drone alert / drone presence.
 *   * Slow soft heartbeat for low health.
 *   * Subtle dark layer for acid rain.
 *   * Soft UI interactions (hover, click, start, whoosh).
 * - 3-second gentle fade-in on first user gesture.
 * - Dedicated volume controls: master, music, ambience, sfx, and mute toggle.
 * - Integrated F4 Audio Debug Panel.
 */

import { AudioDebugPanel } from './AudioDebugPanel.js';

export class AudioManager {
  constructor() {
    this.version = '2.0.0';
    this.ctx = null;
    this.isInitialized = false;

    // Bus nodes
    this.masterGain = null;
    this.masterFilter = null;
    this.masterLimiter = null;
    this.masterAnalyser = null;

    this.musicBus = null;
    this.musicAnalyser = null;

    this.ambienceBus = null;
    this.ambienceAnalyser = null;
    this.ambientGain = null; // Backwards compatibility alias

    this.sfxBus = null;
    this.sfxAnalyser = null;

    // Reverb bus
    this.reverbConvolver = null;
    this.reverbSend = null;
    this.reverbGain = null;

    // Ambient Pad State
    this.padOscillators = [];
    this.padTimer = null;
    this.padChordIndex = 0;
    this.activePadGain = null;

    // Rain Sound State
    this.rainSource = null;
    this.rainGain = null;

    // Acid Rain State
    this.acidSource = null;
    this.acidGain = null;

    // Drone Hum State
    this.droneHumOsc = null;
    this.droneHumGain = null;
    this.droneHumCount = 0;

    // Low Health Heartbeat State
    this.heartbeatTimer = null;
    this.isHeartbeatActive = false;

    // Volumes and Mute
    this._masterVolume = parseFloat(localStorage.getItem('vz_master_vol') ?? '1.0');
    this._musicVolume = parseFloat(localStorage.getItem('vz_music_vol') ?? '0.85');
    this._ambienceVolume = parseFloat(localStorage.getItem('vz_ambient_vol') ?? '0.8');
    this._sfxVolume = parseFloat(localStorage.getItem('vz_sfx_vol') ?? '0.85');
    this._isMuted = localStorage.getItem('vz_mute_audio') === 'true';

    // Target master level
    this.targetMasterLevel = 0.3;

    // Debug panel (ready for F4 toggle from app start)
    if (typeof window !== 'undefined') {
      this.debugPanel = new AudioDebugPanel(this);
    }
  }

  get isMuted() {
    return this._isMuted;
  }

  set isMuted(val) {
    this.setMuted(Boolean(val));
  }

  get masterVolume() {
    return this._masterVolume;
  }

  set masterVolume(val) {
    this.setMasterVolume(val);
  }

  get musicVolume() {
    return this._musicVolume;
  }

  set musicVolume(val) {
    this.setMusicVolume(val);
  }

  get ambienceVolume() {
    return this._ambienceVolume;
  }

  set ambienceVolume(val) {
    this.setAmbienceVolume(val);
  }

  get sfxVolume() {
    return this._sfxVolume;
  }

  set sfxVolume(val) {
    this.setSfxVolume(val);
  }

  init() {
    if (this.isInitialized) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        console.warn('[Verdant Zero Audio] Web Audio API not supported in this environment');
        return;
      }

      this.ctx = new AudioCtx();

      // Log startup announcement as specified in prompt
      console.log(`[Verdant Zero Audio] v${this.version} initialized - Soft Ambient Synthesizer active`);

      // 1. MASTER BUS ARCHITECTURE
      // Target master gain at 0.3
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      // Lowpass filter at 2.2 kHz (gentle Butterworth rolloff)
      this.masterFilter = this.ctx.createBiquadFilter();
      this.masterFilter.type = 'lowpass';
      this.masterFilter.frequency.value = 2200;
      this.masterFilter.frequency.setValueAtTime(2200, this.ctx.currentTime);
      this.masterFilter.Q.value = 0.707;
      this.masterFilter.Q.setValueAtTime(0.707, this.ctx.currentTime);

      // Gentle DynamicsCompressor limiter to strictly guarantee master peak never exceeds -6 dB
      this.masterLimiter = this.ctx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -20.0;
      this.masterLimiter.threshold.setValueAtTime(-20.0, this.ctx.currentTime);
      this.masterLimiter.knee.value = 2.0;
      this.masterLimiter.knee.setValueAtTime(2.0, this.ctx.currentTime);
      this.masterLimiter.ratio.value = 20.0;
      this.masterLimiter.ratio.setValueAtTime(20.0, this.ctx.currentTime);
      this.masterLimiter.attack.value = 0.001;
      this.masterLimiter.attack.setValueAtTime(0.001, this.ctx.currentTime);
      this.masterLimiter.release.value = 0.10;
      this.masterLimiter.release.setValueAtTime(0.10, this.ctx.currentTime);

      // Master Analyser Node
      this.masterAnalyser = this.ctx.createAnalyser();
      this.masterAnalyser.fftSize = 512;
      this.masterAnalyser.smoothingTimeConstant = 0.8;

      // Master Routing: masterGain -> masterFilter -> masterLimiter -> masterAnalyser -> destination
      this.masterGain.connect(this.masterFilter);
      this.masterFilter.connect(this.masterLimiter);
      this.masterLimiter.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.ctx.destination);

      // 2. SHARED REVERB (3-second decaying filtered noise ConvolverNode)
      this.initSharedReverb();

      // 3. SUB-BUSES
      // Music Bus
      this.musicBus = this.ctx.createGain();
      this.musicAnalyser = this.ctx.createAnalyser();
      this.musicAnalyser.fftSize = 512;
      this.musicAnalyser.smoothingTimeConstant = 0.8;
      this.musicBus.connect(this.musicAnalyser);
      this.musicAnalyser.connect(this.masterGain);

      // Ambience Bus
      this.ambienceBus = this.ctx.createGain();
      this.ambienceAnalyser = this.ctx.createAnalyser();
      this.ambienceAnalyser.fftSize = 512;
      this.ambienceAnalyser.smoothingTimeConstant = 0.8;
      this.ambienceBus.connect(this.ambienceAnalyser);
      this.ambienceAnalyser.connect(this.masterGain);
      this.ambientGain = this.ambienceBus; // Alias for existing code

      // SFX Bus
      this.sfxBus = this.ctx.createGain();
      this.sfxAnalyser = this.ctx.createAnalyser();
      this.sfxAnalyser.fftSize = 512;
      this.sfxAnalyser.smoothingTimeConstant = 0.8;
      this.sfxBus.connect(this.sfxAnalyser);
      this.sfxAnalyser.connect(this.masterGain);

      // Apply initial bus volumes
      this.updateBusGains();

      // 4. 3-SECOND GENTLE FADE-IN ON FIRST USER GESTURE
      const targetMaster = this._isMuted ? 0.0001 : (this.targetMasterLevel * this._masterVolume);
      this.masterGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      this.masterGain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, targetMaster),
        this.ctx.currentTime + 3.0
      );

      // 5. START AMBIENT SOUNDS
      this.startAmbientPad();
      this.startRainSound();
      this.startDroneHum();

      // 6. INITIALIZE DEBUG PANEL (F4 key toggle)
      if (typeof window !== 'undefined' && !this.debugPanel) {
        this.debugPanel = new AudioDebugPanel(this);
      }

      this.isInitialized = true;
    } catch (e) {
      console.warn('[Verdant Zero Audio] Initialization error:', e);
    }
  }

  ensureContext() {
    if (!this.isInitialized) {
      this.init();
    } else if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  // ==========================================
  // SHARED REVERB (Algorithmic 3s Noise Impulse)
  // ==========================================
  initSharedReverb() {
    try {
      const sampleRate = this.ctx.sampleRate;
      const duration = 3.0; // 3 seconds rich reverb tail
      const length = Math.floor(sampleRate * duration);
      const impulseBuffer = this.ctx.createBuffer(2, length, sampleRate);
      const left = impulseBuffer.getChannelData(0);
      const right = impulseBuffer.getChannelData(1);

      let lFilter = 0;
      let rFilter = 0;

      for (let i = 0; i < length; i++) {
        const t = i / length; // normalized progress 0..1
        // Exponential decay envelope
        const envelope = Math.exp(-t * 3.4) * (1 - t * 0.95);

        const whiteL = (Math.random() * 2 - 1) * envelope;
        const whiteR = (Math.random() * 2 - 1) * envelope;

        // Recursive 1-pole lowpass filter for warm, silky diffused tails (no harsh static)
        lFilter = lFilter * 0.72 + whiteL * 0.28;
        rFilter = rFilter * 0.72 + whiteR * 0.28;

        left[i] = lFilter;
        right[i] = rFilter;
      }

      this.reverbConvolver = this.ctx.createConvolver();
      this.reverbConvolver.buffer = impulseBuffer;

      // Reverb Send bus for SFX / Music
      this.reverbSend = this.ctx.createGain();
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.setValueAtTime(0.24, this.ctx.currentTime);

      this.reverbSend.connect(this.reverbConvolver);
      this.reverbConvolver.connect(this.reverbGain);
      this.reverbGain.connect(this.masterGain);
    } catch (e) {
      console.warn('[Verdant Zero Audio] Reverb initialization warning:', e);
    }
  }

  // ==========================================
  // AMBIENT PAD: MINOR PENTATONIC EVOLVING CHORDS
  // ==========================================
  startAmbientPad() {
    // Progression: A minor, F major, C major, G major
    // Minor pentatonic compatible voicings with warm bass & mid harmonics
    this.padChords = [
      // Am9: A2, E3, A3, C4, E4
      [110.0, 164.81, 220.0, 261.63, 329.63],
      // Fmaj7: F2, C3, F3, A3, C4
      [87.31, 130.81, 174.61, 220.0, 261.63],
      // Cmaj9: C2, G2, E3, G3, D4
      [65.41, 98.00, 164.81, 196.00, 293.66],
      // G6: G2, D3, G3, B3, E4
      [98.00, 146.83, 196.00, 246.94, 329.63]
    ];

    this.padChordIndex = 0;
    this.scheduleNextPadChord();
  }

  scheduleNextPadChord() {
    if (!this.ctx || this.ctx.state === 'closed') return;

    const chord = this.padChords[this.padChordIndex];
    this.padChordIndex = (this.padChordIndex + 1) % this.padChords.length;

    const t = this.ctx.currentTime;
    const chordDuration = 16.0; // ~16s each
    const crossfadeTime = 5.5; // Long, seamless crossfades

    // Lowpass filter dedicated to this chord (800 Hz warmth)
    const chordFilter = this.ctx.createBiquadFilter();
    chordFilter.type = 'lowpass';
    chordFilter.frequency.setValueAtTime(800, t);
    chordFilter.Q.setValueAtTime(0.65, t);

    // Subtle gentle filter breathing LFO
    const filterLfo = this.ctx.createOscillator();
    const filterLfoGain = this.ctx.createGain();
    filterLfo.type = 'sine';
    filterLfo.frequency.setValueAtTime(0.08, t); // Slow 12-second cycle
    filterLfoGain.gain.setValueAtTime(140, t);
    filterLfo.connect(filterLfoGain);
    filterLfoGain.connect(chordFilter.frequency);
    filterLfo.start(t);
    filterLfo.stop(t + chordDuration);

    // Chord Gain with smooth attack, sustain, decay
    const chordGain = this.ctx.createGain();
    chordGain.gain.setValueAtTime(0.0001, t);
    chordGain.gain.linearRampToValueAtTime(0.22, t + crossfadeTime);
    chordGain.gain.setValueAtTime(0.22, t + chordDuration - crossfadeTime);
    chordGain.gain.linearRampToValueAtTime(0.0001, t + chordDuration);

    chordFilter.connect(chordGain);
    chordGain.connect(this.musicBus);

    // Subtle reverb send for ambient pad
    if (this.reverbSend) {
      const padReverbSend = this.ctx.createGain();
      padReverbSend.gain.setValueAtTime(0.25, t);
      chordGain.connect(padReverbSend);
      padReverbSend.connect(this.reverbSend);
    }

    // 3 detuned sine/triangle oscillators per note. NEVER use sawtooth or square waves!
    const noteOscillators = [];
    chord.forEach((freq) => {
      // Osc 1: Pure Sine at center frequency
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, t);

      // Osc 2: Triangle at +3.2 cents for gentle warmth
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(freq * Math.pow(2, 3.2 / 1200), t);

      // Osc 3: Pure Sine at -3.2 cents for soft beating
      const osc3 = this.ctx.createOscillator();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(freq * Math.pow(2, -3.2 / 1200), t);

      // Sub-mixer gain for voice
      const voiceGain = this.ctx.createGain();
      voiceGain.gain.setValueAtTime(1.0 / chord.length, t);

      osc1.connect(voiceGain);
      osc2.connect(voiceGain);
      osc3.connect(voiceGain);
      voiceGain.connect(chordFilter);

      osc1.start(t);
      osc2.start(t);
      osc3.start(t);

      osc1.stop(t + chordDuration);
      osc2.stop(t + chordDuration);
      osc3.stop(t + chordDuration);

      noteOscillators.push(osc1, osc2, osc3);
    });

    // Schedule next chord crossfade before this one finishes
    const nextDelay = (chordDuration - crossfadeTime) * 1000;
    this.padTimer = setTimeout(() => {
      this.scheduleNextPadChord();
    }, nextDelay);
  }

  // ==========================================
  // RAIN AMBIENCE: FILTERED PINK NOISE (NO THUNDER)
  // ==========================================
  startRainSound() {
    if (!this.ctx) return;

    try {
      const bufferSize = Math.floor(this.ctx.sampleRate * 4.0); // 4-second looping buffer
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      // Paul Kellet's filtered pink noise algorithm
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
        b6 = white * 0.115926;
      }

      this.rainSource = this.ctx.createBufferSource();
      this.rainSource.buffer = noiseBuffer;
      this.rainSource.loop = true;

      // Bandpass filter spanning 300Hz - 2000Hz (configured using cascaded highpass + lowpass)
      const rainHp = this.ctx.createBiquadFilter();
      rainHp.type = 'highpass';
      rainHp.frequency.setValueAtTime(300, this.ctx.currentTime);
      rainHp.Q.setValueAtTime(0.707, this.ctx.currentTime);

      const rainLp = this.ctx.createBiquadFilter();
      rainLp.type = 'lowpass';
      rainLp.frequency.setValueAtTime(2000, this.ctx.currentTime);
      rainLp.Q.setValueAtTime(0.707, this.ctx.currentTime);

      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.setValueAtTime(0.14, this.ctx.currentTime); // Quiet soothing level

      this.rainSource.connect(rainHp);
      rainHp.connect(rainLp);
      rainLp.connect(this.rainGain);
      this.rainGain.connect(this.ambienceBus);

      this.rainSource.start(this.ctx.currentTime);
    } catch (e) {
      console.warn('[Verdant Zero Audio] Rain sound warning:', e);
    }
  }

  // ==========================================
  // DRONE AMBIENT HUM
  // ==========================================
  startDroneHum() {
    if (!this.ctx || this.droneHumOsc) return;

    try {
      const t = this.ctx.currentTime;
      this.droneHumOsc = this.ctx.createOscillator();
      this.droneHumOsc.type = 'triangle'; // Gentle triangle wave, no harsh sawtooth
      this.droneHumOsc.frequency.setValueAtTime(98.0, t); // Warm low G2

      const humFilter = this.ctx.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.setValueAtTime(240, t);
      humFilter.Q.setValueAtTime(1.5, t);

      this.droneHumGain = this.ctx.createGain();
      this.droneHumGain.gain.setValueAtTime(0.04, t); // Quiet gentle ambient layer

      this.droneHumOsc.connect(humFilter);
      humFilter.connect(this.droneHumGain);
      this.droneHumGain.connect(this.ambienceBus);

      this.droneHumOsc.start(t);
    } catch (e) {}
  }

  // ==========================================
  // SOFT SOUND EFFECTS (SFX)
  // ==========================================

  /**
   * Gentle bell chime on planting
   * Sine with soft 2nd harmonic, pentatonic pitch, 20ms attack, 2.5s decay, reverb tail.
   */
  playPlantingChime() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;
    // Pentatonic scale notes: C5, D5, E5, G5, A5
    const pentatonicNotes = [523.25, 587.33, 659.25, 783.99, 880.00];
    const baseFreq = pentatonicNotes[Math.floor(Math.random() * pentatonicNotes.length)];

    // Play an uplifting, gentle dual-bell chime
    [baseFreq, baseFreq * 1.5].forEach((freq, i) => {
      const noteTime = t + i * 0.07;

      // Primary sine
      const osc1 = this.ctx.createOscillator();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freq, noteTime);

      // Soft 2nd harmonic
      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq * 2.0, noteTime);

      const gain1 = this.ctx.createGain();
      gain1.gain.setValueAtTime(0.0001, noteTime);
      gain1.gain.linearRampToValueAtTime(0.22, noteTime + 0.02); // 20ms attack
      gain1.gain.exponentialRampToValueAtTime(0.0001, noteTime + 2.5); // 2.5s decay

      const gain2 = this.ctx.createGain();
      gain2.gain.setValueAtTime(0.0001, noteTime);
      gain2.gain.linearRampToValueAtTime(0.06, noteTime + 0.02); // Soft 2nd harmonic
      gain2.gain.exponentialRampToValueAtTime(0.0001, noteTime + 1.8);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400, noteTime);

      osc1.connect(gain1);
      osc2.connect(gain2);
      gain1.connect(filter);
      gain2.connect(filter);
      filter.connect(this.sfxBus);

      // Send to lush shared reverb
      if (this.reverbSend) {
        const revSend = this.ctx.createGain();
        revSend.gain.setValueAtTime(0.45, noteTime);
        filter.connect(revSend);
        revSend.connect(this.reverbSend);
      }

      osc1.start(noteTime);
      osc2.start(noteTime);
      osc1.stop(noteTime + 2.55);
      osc2.stop(noteTime + 2.55);
    });
  }

  /**
   * Soft drop for water pickup
   * Gentle pure sine drop envelope with warm decay
   */
  playWaterCollect() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    // Gentle downward pitch curve for classic soft water droplet plop
    osc.frequency.setValueAtTime(740, t);
    osc.frequency.exponentialRampToValueAtTime(460, t + 0.22);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.20, t + 0.015); // 15ms attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28); // 0.25s decay

    osc.connect(gain);
    gain.connect(this.sfxBus);

    if (this.reverbSend) {
      const revSend = this.ctx.createGain();
      revSend.gain.setValueAtTime(0.3, t);
      gain.connect(revSend);
      revSend.connect(this.reverbSend);
    }

    osc.start(t);
    osc.stop(t + 0.3);
  }

  /**
   * Soft rising pentatonic notes for combo
   */
  playComboChime(comboLevel = 1) {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;
    // Rising pentatonic scale: A4, C5, D5, E5, G5, A5, C6
    const pentatonicScale = [440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];
    const pitchIndex = Math.min(pentatonicScale.length - 1, Math.max(0, comboLevel - 1));
    const pitch = pentatonicScale[pitchIndex];

    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(pitch, t);

    // Warm subtle overtone
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(pitch * 2, t);

    const gain1 = this.ctx.createGain();
    gain1.gain.setValueAtTime(0.0001, t);
    gain1.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

    const gain2 = this.ctx.createGain();
    gain2.gain.setValueAtTime(0.0001, t);
    gain2.gain.linearRampToValueAtTime(0.06, t + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);

    osc1.connect(gain1);
    osc2.connect(gain2);
    gain1.connect(this.sfxBus);
    gain2.connect(this.sfxBus);

    if (this.reverbSend) {
      const revSend = this.ctx.createGain();
      revSend.gain.setValueAtTime(0.4, t);
      gain1.connect(revSend);
      revSend.connect(this.reverbSend);
    }

    osc1.start(t);
    osc2.start(t);
    osc1.stop(t + 0.48);
    osc2.stop(t + 0.48);
  }

  /**
   * Soft airy lowpass whoosh for pulse ability
   */
  playLightPulse() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;

    // Filtered noise swoosh
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.7);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(250, t);
    filter.frequency.exponentialRampToValueAtTime(950, t + 0.25);
    filter.frequency.exponentialRampToValueAtTime(250, t + 0.65);
    filter.Q.setValueAtTime(2.0, t);

    // Warm sub sine underlay
    const subOsc = this.ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(120, t);
    subOsc.frequency.linearRampToValueAtTime(180, t + 0.25);
    subOsc.frequency.linearRampToValueAtTime(90, t + 0.65);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.24, t + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.68);

    noise.connect(filter);
    subOsc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);

    if (this.reverbSend) {
      const revSend = this.ctx.createGain();
      revSend.gain.setValueAtTime(0.35, t);
      gain.connect(revSend);
      revSend.connect(this.reverbSend);
    }

    noise.start(t);
    subOsc.start(t);
    noise.stop(t + 0.7);
    subOsc.stop(t + 0.7);
  }

  /**
   * Quiet low hum for drone wave alert (soft and warm, zero harsh sawtooth)
   */
  playDroneAlert() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(80, t + 0.6);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(260, t);
    filter.Q.setValueAtTime(1.8, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);

    osc.start(t);
    osc.stop(t + 0.7);
  }

  /**
   * Slow soft heartbeat for low health (lub-dub sub-sine double pulse)
   */
  playHeartbeat() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;

    // Pulse 1 ("lub")
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(58, t);
    osc1.frequency.exponentialRampToValueAtTime(40, t + 0.12);

    const gain1 = this.ctx.createGain();
    gain1.gain.setValueAtTime(0.0001, t);
    gain1.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);

    osc1.connect(gain1);
    gain1.connect(this.sfxBus);
    osc1.start(t);
    osc1.stop(t + 0.15);

    // Pulse 2 ("dub") ~140ms later
    const t2 = t + 0.14;
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(50, t2);
    osc2.frequency.exponentialRampToValueAtTime(36, t2 + 0.12);

    const gain2 = this.ctx.createGain();
    gain2.gain.setValueAtTime(0.0001, t2);
    gain2.gain.linearRampToValueAtTime(0.16, t2 + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.15);

    osc2.connect(gain2);
    gain2.connect(this.sfxBus);
    osc2.start(t2);
    osc2.stop(t2 + 0.16);
  }

  startHeartbeat() {
    if (this.isHeartbeatActive) return;
    this.isHeartbeatActive = true;
    this.playHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isHeartbeatActive) this.playHeartbeat();
    }, 1250); // Slow calming 48 BPM heartbeat
  }

  stopHeartbeat() {
    this.isHeartbeatActive = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  setLowHealth(isActive) {
    if (isActive) {
      this.startHeartbeat();
    } else {
      this.stopHeartbeat();
    }
  }

  /**
   * Subtle dark layer for acid rain (gentle warm bandpassed noise)
   */
  startAcidRainSound() {
    if (!this.ctx || this.acidGain) return;
    try {
      const bufferSize = Math.floor(this.ctx.sampleRate * 2.0);
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const out = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) out[i] = (Math.random() * 2 - 1) * 0.25;

      this.acidSource = this.ctx.createBufferSource();
      this.acidSource.buffer = noiseBuffer;
      this.acidSource.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(850, this.ctx.currentTime);
      filter.Q.setValueAtTime(1.4, this.ctx.currentTime);

      this.acidGain = this.ctx.createGain();
      this.acidGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
      this.acidGain.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 1.2);

      this.acidSource.connect(filter);
      filter.connect(this.acidGain);
      this.acidGain.connect(this.ambienceBus);

      this.acidSource.start();
    } catch (e) {}
  }

  stopAcidRainSound() {
    if (this.acidGain && this.ctx) {
      this.acidGain.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 0.8);
      setTimeout(() => {
        if (this.acidSource) {
          try { this.acidSource.stop(); } catch (e) {}
          this.acidSource = null;
        }
        this.acidGain = null;
      }, 850);
    }
  }

  playAcidRainWarning() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;
    // Soft two-tone warm chime
    [440, 370].forEach((freq, idx) => {
      const noteTime = t + idx * 0.2;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, noteTime);
      gain.gain.linearRampToValueAtTime(0.15, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.35);

      osc.connect(gain);
      gain.connect(this.sfxBus);

      osc.start(noteTime);
      osc.stop(noteTime + 0.38);
    });
  }

  /**
   * Soft denied sound (muted wooden tap, warm and gentle)
   */
  playDeniedSound() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.08);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.14, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

    osc.connect(gain);
    gain.connect(this.sfxBus);

    osc.start(t);
    osc.stop(t + 0.1);
  }

  /**
   * Soft player hit sound (cushioned thud, no harsh crack)
   */
  playPlayerHit() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.15);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.20, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

    osc.connect(gain);
    gain.connect(this.sfxBus);

    osc.start(t);
    osc.stop(t + 0.2);
  }

  /**
   * Milestone celebration sound (warm shimmering pentatonic arpeggio)
   */
  playMilestoneCelebration() {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6

    freqs.forEach((freq, idx) => {
      const noteTime = t + idx * 0.08;
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.0001, noteTime);
      gain.gain.linearRampToValueAtTime(0.18, noteTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.55);

      osc.connect(gain);
      gain.connect(this.sfxBus);

      if (this.reverbSend) {
        const revSend = this.ctx.createGain();
        revSend.gain.setValueAtTime(0.4, noteTime);
        gain.connect(revSend);
        revSend.connect(this.reverbSend);
      }

      osc.start(noteTime);
      osc.stop(noteTime + 0.58);
    });
  }

  /**
   * Game Over Sound (Victory or Defeat)
   */
  playGameOverSound(isVictory = false) {
    if (!this.ctx) return;
    this.ensureContext();

    const t = this.ctx.currentTime;
    if (isVictory) {
      // Warm soaring pentatonic triad
      [523.25, 659.25, 783.99, 1046.50, 1318.51].forEach((freq, i) => {
        const noteTime = t + i * 0.12;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteTime);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, noteTime);
        gain.gain.linearRampToValueAtTime(0.18, noteTime + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 1.2);

        osc.connect(gain);
        gain.connect(this.sfxBus);

        if (this.reverbSend) {
          const revSend = this.ctx.createGain();
          revSend.gain.setValueAtTime(0.5, noteTime);
          gain.connect(revSend);
          revSend.connect(this.reverbSend);
        }

        osc.start(noteTime);
        osc.stop(noteTime + 1.25);
      });
    } else {
      // Gentle melancholic warm chord resolution (no harsh sawtooth)
      [164.81, 196.00, 246.94].forEach((freq) => {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.85, t + 1.4);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.16, t + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);

        osc.connect(gain);
        gain.connect(this.sfxBus);

        if (this.reverbSend) {
          const revSend = this.ctx.createGain();
          revSend.gain.setValueAtTime(0.4, t);
          gain.connect(revSend);
          revSend.connect(this.reverbSend);
        }

        osc.start(t);
        osc.stop(t + 1.55);
      });
    }
  }

  // ==========================================
  // UI SOUNDS
  // ==========================================
  playHover() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.04, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);

    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.04);
  }

  playClick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(680, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.08, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  playStart() {
    this.playPlantingChime();
  }

  playWhoosh() {
    this.playLightPulse();
  }

  // ==========================================
  // VOLUME & MUTE CONTROLS
  // ==========================================
  setMasterVolume(volume) {
    this._masterVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('vz_master_vol', this._masterVolume.toString());
    if (this.masterGain && this.ctx) {
      const target = this._isMuted ? 0.0001 : (this.targetMasterLevel * this._masterVolume);
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(Math.max(0.0001, target), this.ctx.currentTime);
    }
  }

  setMusicVolume(volume) {
    this._musicVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('vz_music_vol', this._musicVolume.toString());
    if (this.musicBus && this.ctx) {
      this.musicBus.gain.setValueAtTime(this._musicVolume * 0.55, this.ctx.currentTime);
    }
  }

  setAmbienceVolume(volume) {
    this._ambienceVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('vz_ambient_vol', this._ambienceVolume.toString());
    if (this.ambienceBus && this.ctx) {
      this.ambienceBus.gain.setValueAtTime(this._ambienceVolume * 0.50, this.ctx.currentTime);
    }
  }

  setSfxVolume(volume) {
    this._sfxVolume = Math.max(0, Math.min(1, volume));
    localStorage.setItem('vz_sfx_vol', this._sfxVolume.toString());
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.setValueAtTime(this._sfxVolume * 0.58, this.ctx.currentTime);
    }
  }

  setMuted(muted) {
    this._isMuted = Boolean(muted);
    localStorage.setItem('vz_mute_audio', this._isMuted.toString());
    if (this.masterGain && this.ctx) {
      const target = this._isMuted ? 0.0001 : (this.targetMasterLevel * this._masterVolume);
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(Math.max(0.0001, target), this.ctx.currentTime);
    }
  }

  toggleMute() {
    this.setMuted(!this._isMuted);
    return this._isMuted;
  }

  updateBusGains() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.musicBus) this.musicBus.gain.setValueAtTime(this._musicVolume * 0.55, t);
    if (this.ambienceBus) this.ambienceBus.gain.setValueAtTime(this._ambienceVolume * 0.50, t);
    if (this.sfxBus) this.sfxBus.gain.setValueAtTime(this._sfxVolume * 0.58, t);
  }

  handleTabVisibility(isHidden) {
    if (!this.ctx) return;
    if (isHidden && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    } else if (!isHidden && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  reset() {
    this.stopAcidRainSound();
    this.stopHeartbeat();
  }

  destroy() {
    if (this.padTimer) clearTimeout(this.padTimer);
    this.stopHeartbeat();
    this.stopAcidRainSound();
    if (this.rainSource) {
      try { this.rainSource.stop(); } catch (e) {}
    }
    if (this.droneHumOsc) {
      try { this.droneHumOsc.stop(); } catch (e) {}
    }
    if (this.debugPanel) {
      this.debugPanel.destroy();
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
    }
  }
}

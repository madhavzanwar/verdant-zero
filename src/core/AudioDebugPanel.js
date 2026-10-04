/**
 * Verdant Zero — Real-Time Audio Debug Panel (F4 Toggle)
 * 
 * Features:
 * - Toggled via F4 key (or toggle button)
 * - Real-time canvas level meters for Master, Ambience, Music, and SFX buses
 * - Precise peak & RMS metering in dBFS
 * - Master peak limiter verification (strictly flags & confirms peak < -6 dBFS)
 * - Interactive bus volume faders & mute toggle
 * - Instant audition buttons for testing soft generative sound effects
 * - Cyber-botanical glassmorphism styling
 */

export class AudioDebugPanel {
  constructor(audioManager) {
    this.audioManager = audioManager;
    this.isVisible = false;
    this.container = null;
    this.rafId = null;

    // Meter history and peak hold
    this.peakHold = {
      master: -100,
      ambience: -100,
      music: -100,
      sfx: -100
    };
    this.peakDecay = 0.96;
    this.maxObservedMasterPeak = -100;

    // Scratch buffers for analyser reads
    this.timeData = new Float32Array(512);

    this.initDOM();
    this.initKeyboardListener();
  }

  initKeyboardListener() {
    this.keyHandler = (e) => {
      if (e.key === 'F4' || e.code === 'F4') {
        e.preventDefault();
        if (this.audioManager) {
          this.audioManager.ensureContext();
        }
        this.toggle();
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  initDOM() {
    if (typeof document === 'undefined') return;

    this.container = document.createElement('div');
    this.container.id = 'vz-audio-debug-panel';
    this.container.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      width: 340px;
      background: rgba(10, 14, 28, 0.96);
      border: 1px solid rgba(56, 217, 169, 0.35);
      border-radius: 10px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.65), 0 0 20px rgba(56, 217, 169, 0.15);
      color: #e2e8f0;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      font-size: 11px;
      z-index: 999999;
      display: none;
      flex-direction: column;
      overflow: hidden;
      user-select: none;
    `;

    this.container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(56, 217, 169, 0.08); border-bottom: 1px solid rgba(56, 217, 169, 0.2);">
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background: #38d9a9; box-shadow: 0 0 8px #38d9a9;"></div>
          <span style="font-family: 'Big Shoulders Display', sans-serif; font-size: 15px; font-weight: 700; letter-spacing: 1.5px; color: #a7f3d0; text-transform: uppercase;">
            AUDIO DEBUG // v2.0
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="color: #64748b; font-size: 10px; font-family: monospace;">[F4]</span>
          <button id="vz-audio-dbg-close" style="background: none; border: none; color: #94a3b8; font-size: 16px; cursor: pointer; padding: 0 4px; line-height: 1;">&times;</button>
        </div>
      </div>

      <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;">
        <!-- Limiter Safety Status Badge -->
        <div id="vz-limiter-badge" style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 6px; padding: 6px 10px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 600; color: #34d399; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px;">Master Peak Verification</span>
          <span id="vz-master-peak-val" style="font-family: monospace; font-size: 11px; font-weight: 700; color: #6ee7b7;">-inf dB</span>
        </div>
        <div id="vz-limiter-subtext" style="font-size: 9.5px; color: #94a3b8; margin-top: -6px; padding-left: 2px;">
          Limiter ceiling: &lt; -6.0 dBFS &bull; Max observed: <span id="vz-max-observed" style="font-family: monospace; color: #a7f3d0;">-inf dB</span>
        </div>

        <!-- Bus Meters Canvas -->
        <div style="background: rgba(4, 7, 16, 0.85); border-radius: 6px; padding: 8px 10px; border: 1px solid rgba(255, 255, 255, 0.06);">
          <div style="display: flex; justify-content: space-between; font-size: 9px; color: #64748b; margin-bottom: 4px; font-family: monospace;">
            <span>BUS</span>
            <span>-36 &nbsp; -24 &nbsp; -18 &nbsp; -12 &nbsp; -6 &nbsp; 0 dB</span>
          </div>
          <canvas id="vz-audio-meters-canvas" width="310" height="96" style="width: 100%; height: 96px; display: block;"></canvas>
        </div>

        <!-- Quick Volume & Mute Controls -->
        <div style="display: flex; flex-direction: column; gap: 6px; background: rgba(255, 255, 255, 0.02); padding: 8px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.04);">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #94a3b8; font-size: 10px;">Master</span>
            <input type="range" id="vz-fader-master" min="0" max="1" step="0.01" value="1" style="width: 140px; accent-color: #38d9a9; height: 4px; cursor: pointer;">
            <button id="vz-btn-mute" style="background: rgba(56, 217, 169, 0.15); border: 1px solid rgba(56, 217, 169, 0.3); color: #38d9a9; font-size: 9.5px; padding: 2px 8px; border-radius: 4px; cursor: pointer;">MUTE</button>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #94a3b8; font-size: 10px;">Music</span>
            <input type="range" id="vz-fader-music" min="0" max="1" step="0.01" value="0.85" style="width: 140px; accent-color: #60a5fa; height: 4px; cursor: pointer;">
            <span id="vz-val-music" style="font-family: monospace; font-size: 9.5px; color: #64748b; width: 32px; text-align: right;">85%</span>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #94a3b8; font-size: 10px;">Ambience</span>
            <input type="range" id="vz-fader-ambience" min="0" max="1" step="0.01" value="0.8" style="width: 140px; accent-color: #34d399; height: 4px; cursor: pointer;">
            <span id="vz-val-ambience" style="font-family: monospace; font-size: 9.5px; color: #64748b; width: 32px; text-align: right;">80%</span>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="color: #94a3b8; font-size: 10px;">SFX</span>
            <input type="range" id="vz-fader-sfx" min="0" max="1" step="0.01" value="0.85" style="width: 140px; accent-color: #f472b6; height: 4px; cursor: pointer;">
            <span id="vz-val-sfx" style="font-family: monospace; font-size: 9.5px; color: #64748b; width: 32px; text-align: right;">85%</span>
          </div>
        </div>

        <!-- Audition SFX Soundboard -->
        <div>
          <div style="font-size: 9.5px; color: #64748b; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px;">Audition Generative SFX</div>
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px;">
            <button id="vz-aud-plant" class="vz-aud-btn" style="background: rgba(56, 217, 169, 0.1); border: 1px solid rgba(56, 217, 169, 0.25); color: #a7f3d0; padding: 4px 6px; font-size: 9.5px; border-radius: 4px; cursor: pointer;">Plant Bell</button>
            <button id="vz-aud-water" class="vz-aud-btn" style="background: rgba(96, 165, 250, 0.1); border: 1px solid rgba(96, 165, 250, 0.25); color: #93c5fd; padding: 4px 6px; font-size: 9.5px; border-radius: 4px; cursor: pointer;">Water Drop</button>
            <button id="vz-aud-combo" class="vz-aud-btn" style="background: rgba(244, 114, 182, 0.1); border: 1px solid rgba(244, 114, 182, 0.25); color: #fbcfe8; padding: 4px 6px; font-size: 9.5px; border-radius: 4px; cursor: pointer;">Combo +</button>
            <button id="vz-aud-pulse" class="vz-aud-btn" style="background: rgba(251, 191, 36, 0.1); border: 1px solid rgba(251, 191, 36, 0.25); color: #fde68a; padding: 4px 6px; font-size: 9.5px; border-radius: 4px; cursor: pointer;">Light Pulse</button>
            <button id="vz-aud-heart" class="vz-aud-btn" style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #fca5a5; padding: 4px 6px; font-size: 9.5px; border-radius: 4px; cursor: pointer;">Heartbeat</button>
            <button id="vz-aud-acid" class="vz-aud-btn" style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.25); color: #e9d5ff; padding: 4px 6px; font-size: 9.5px; border-radius: 4px; cursor: pointer;">Acid Warning</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.metersCanvas = document.getElementById('vz-audio-meters-canvas');
    this.metersCtx = this.metersCanvas ? this.metersCanvas.getContext('2d') : null;

    this.bindEvents();
    this.updateControlsState();
  }

  bindEvents() {
    // Close button
    const closeBtn = document.getElementById('vz-audio-dbg-close');
    if (closeBtn) {
      closeBtn.onclick = () => this.hide();
    }

    // Faders
    const fMaster = document.getElementById('vz-fader-master');
    if (fMaster) {
      fMaster.oninput = (e) => this.audioManager.setMasterVolume(parseFloat(e.target.value));
    }

    const fMusic = document.getElementById('vz-fader-music');
    if (fMusic) {
      fMusic.oninput = (e) => {
        const val = parseFloat(e.target.value);
        this.audioManager.setMusicVolume(val);
        const lbl = document.getElementById('vz-val-music');
        if (lbl) lbl.textContent = `${Math.round(val * 100)}%`;
      };
    }

    const fAmb = document.getElementById('vz-fader-ambience');
    if (fAmb) {
      fAmb.oninput = (e) => {
        const val = parseFloat(e.target.value);
        this.audioManager.setAmbienceVolume(val);
        const lbl = document.getElementById('vz-val-ambience');
        if (lbl) lbl.textContent = `${Math.round(val * 100)}%`;
      };
    }

    const fSfx = document.getElementById('vz-fader-sfx');
    if (fSfx) {
      fSfx.oninput = (e) => {
        const val = parseFloat(e.target.value);
        this.audioManager.setSfxVolume(val);
        const lbl = document.getElementById('vz-val-sfx');
        if (lbl) lbl.textContent = `${Math.round(val * 100)}%`;
      };
    }

    // Mute button
    const btnMute = document.getElementById('vz-btn-mute');
    if (btnMute) {
      btnMute.onclick = () => {
        const isMuted = this.audioManager.toggleMute();
        this.updateMuteButton(isMuted);
      };
    }

    // Soundboard Auditions
    const audPlant = document.getElementById('vz-aud-plant');
    if (audPlant) audPlant.onclick = () => this.audioManager.playPlantingChime();

    const audWater = document.getElementById('vz-aud-water');
    if (audWater) audWater.onclick = () => this.audioManager.playWaterCollect();

    const audCombo = document.getElementById('vz-aud-combo');
    if (audCombo) {
      let comboStep = 1;
      audCombo.onclick = () => {
        this.audioManager.playComboChime(comboStep);
        comboStep = (comboStep % 5) + 1;
      };
    }

    const audPulse = document.getElementById('vz-aud-pulse');
    if (audPulse) audPulse.onclick = () => this.audioManager.playLightPulse();

    const audHeart = document.getElementById('vz-aud-heart');
    if (audHeart) audHeart.onclick = () => this.audioManager.playHeartbeat();

    const audAcid = document.getElementById('vz-aud-acid');
    if (audAcid) audAcid.onclick = () => this.audioManager.playAcidRainWarning();
  }

  updateControlsState() {
    const fMaster = document.getElementById('vz-fader-master');
    if (fMaster) fMaster.value = this.audioManager.masterVolume;

    const fMusic = document.getElementById('vz-fader-music');
    if (fMusic) fMusic.value = this.audioManager.musicVolume;

    const fAmb = document.getElementById('vz-fader-ambience');
    if (fAmb) fAmb.value = this.audioManager.ambienceVolume;

    const fSfx = document.getElementById('vz-fader-sfx');
    if (fSfx) fSfx.value = this.audioManager.sfxVolume;

    this.updateMuteButton(this.audioManager.isMuted);
  }

  updateMuteButton(isMuted) {
    const btnMute = document.getElementById('vz-btn-mute');
    if (btnMute) {
      btnMute.textContent = isMuted ? 'UNMUTE' : 'MUTE';
      btnMute.style.background = isMuted ? 'rgba(239, 68, 68, 0.25)' : 'rgba(56, 217, 169, 0.15)';
      btnMute.style.borderColor = isMuted ? 'rgba(239, 68, 68, 0.5)' : 'rgba(56, 217, 169, 0.3)';
      btnMute.style.color = isMuted ? '#fca5a5' : '#38d9a9';
    }
  }

  show() {
    this.isVisible = true;
    if (this.container) {
      this.container.style.display = 'flex';
    }
    this.updateControlsState();
    this.startRenderLoop();
  }

  hide() {
    this.isVisible = false;
    if (this.container) {
      this.container.style.display = 'none';
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  toggle() {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  getBusPeakAndRms(analyser) {
    if (!analyser) return { peakDb: -100, rmsDb: -100 };

    analyser.getFloatTimeDomainData(this.timeData);
    let sumSq = 0;
    let peak = 0;

    for (let i = 0; i < this.timeData.length; i++) {
      const val = Math.abs(this.timeData[i]);
      if (val > peak) peak = val;
      sumSq += val * val;
    }

    const rms = Math.sqrt(sumSq / this.timeData.length);
    const peakDb = peak > 1e-4 ? 20 * Math.log10(peak) : -100;
    const rmsDb = rms > 1e-4 ? 20 * Math.log10(rms) : -100;

    return { peakDb, rmsDb };
  }

  startRenderLoop() {
    if (this.rafId) return;

    const render = () => {
      if (!this.isVisible) return;
      this.drawMeters();
      this.rafId = requestAnimationFrame(render);
    };

    this.rafId = requestAnimationFrame(render);
  }

  drawMeters() {
    if (!this.metersCtx || !this.metersCanvas) return;

    const ctx = this.metersCtx;
    const width = this.metersCanvas.width;
    const height = this.metersCanvas.height;

    ctx.clearRect(0, 0, width, height);

    const buses = [
      { name: 'MST', analyser: this.audioManager.masterAnalyser, key: 'master', color: '#38d9a9' },
      { name: 'AMB', analyser: this.audioManager.ambienceAnalyser, key: 'ambience', color: '#34d399' },
      { name: 'MUS', analyser: this.audioManager.musicAnalyser, key: 'music', color: '#60a5fa' },
      { name: 'SFX', analyser: this.audioManager.sfxAnalyser, key: 'sfx', color: '#f472b6' }
    ];

    const rowHeight = 22;
    const labelWidth = 36;
    const meterWidth = width - labelWidth - 52;
    const minDb = -48;
    const maxDb = 0;

    buses.forEach((bus, index) => {
      const y = index * rowHeight + 2;
      const { peakDb, rmsDb } = this.getBusPeakAndRms(bus.analyser);

      // Decay peak hold
      if (peakDb > this.peakHold[bus.key]) {
        this.peakHold[bus.key] = peakDb;
      } else {
        this.peakHold[bus.key] = Math.max(-100, this.peakHold[bus.key] - 0.25);
      }

      // Track max observed master peak
      if (bus.key === 'master' && peakDb > this.maxObservedMasterPeak) {
        this.maxObservedMasterPeak = peakDb;
      }

      // Draw Bus Label
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(bus.name, 4, y + 8);

      // Meter Background Track
      const trackX = labelWidth;
      const trackY = y + 2;
      const trackH = 12;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(trackX, trackY, meterWidth, trackH);

      // Map dB to width
      const dbToX = (db) => {
        const clamped = Math.max(minDb, Math.min(maxDb, db));
        return ((clamped - minDb) / (maxDb - minDb)) * meterWidth;
      };

      // Draw RMS level bar
      const rmsW = dbToX(rmsDb);
      if (rmsW > 0) {
        const grad = ctx.createLinearGradient(trackX, 0, trackX + meterWidth, 0);
        grad.addColorStop(0, '#059669');
        grad.addColorStop(0.7, '#10b981');
        grad.addColorStop(0.875, '#fbbf24'); // -6 dB threshold
        grad.addColorStop(1, '#ef4444');
        ctx.fillStyle = grad;
        ctx.fillRect(trackX, trackY, rmsW, trackH);
      }

      // Draw Peak tick
      const peakX = trackX + dbToX(peakDb);
      if (peakDb > minDb) {
        ctx.fillStyle = peakDb > -6.0 ? '#ef4444' : '#ffffff';
        ctx.fillRect(peakX - 1, trackY - 1, 2, trackH + 2);
      }

      // Draw Peak Hold tick
      const holdX = trackX + dbToX(this.peakHold[bus.key]);
      if (this.peakHold[bus.key] > minDb) {
        ctx.fillStyle = this.peakHold[bus.key] > -6.0 ? '#f87171' : '#38d9a9';
        ctx.fillRect(holdX - 1, trackY, 2, trackH);
      }

      // -6 dB Safe Limit Guideline (strictly visual reference)
      const limitX = trackX + dbToX(-6.0);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
      ctx.fillRect(limitX, trackY, 1, trackH);

      // Numerical Readout
      ctx.fillStyle = peakDb > -6.0 ? '#f87171' : '#94a3b8';
      ctx.font = '9.5px monospace';
      ctx.textAlign = 'right';
      const readText = peakDb <= -90 ? '-inf' : `${peakDb.toFixed(1)}`;
      ctx.fillText(readText, width - 4, y + 8);
    });

    // Update Limiter Verification Badge
    const masterPeak = this.peakHold['master'];
    const badgeEl = document.getElementById('vz-limiter-badge');
    const peakValEl = document.getElementById('vz-master-peak-val');
    const maxObsEl = document.getElementById('vz-max-observed');

    if (peakValEl) {
      peakValEl.textContent = masterPeak <= -90 ? '-inf dB' : `${masterPeak.toFixed(1)} dBFS`;
    }

    if (maxObsEl) {
      maxObsEl.textContent = this.maxObservedMasterPeak <= -90 ? '-inf dB' : `${this.maxObservedMasterPeak.toFixed(1)} dBFS`;
    }

    if (badgeEl) {
      const isUnderSafeLimit = this.maxObservedMasterPeak <= -6.0 || this.maxObservedMasterPeak <= -90;
      if (isUnderSafeLimit) {
        badgeEl.style.background = 'rgba(16, 185, 129, 0.12)';
        badgeEl.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        badgeEl.firstElementChild.style.color = '#34d399';
        badgeEl.firstElementChild.textContent = 'Master Peak: SAFE (< -6 dB)';
      } else {
        // In case an extreme burst occurred
        badgeEl.style.background = 'rgba(239, 68, 68, 0.15)';
        badgeEl.style.borderColor = 'rgba(239, 68, 68, 0.5)';
        badgeEl.firstElementChild.style.color = '#f87171';
        badgeEl.firstElementChild.textContent = 'Master Peak Warning';
      }
    }
  }

  destroy() {
    this.hide();
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

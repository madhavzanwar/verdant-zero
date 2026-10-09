import { showToast } from '../ui/Toasts.js';

/**
 * Score & Run Manager
 * - States: 'MENU' | 'PLAYING' | 'PAUSED' | 'GAMEOVER'
 * - 10:00 countdown. Win: all planters planted and grown. Lose: timer hits zero or health hits zero.
 * - Scoring:
 *     planting          100 × combo × risk (risk ×2 when planting in smog or acid rain)
 *     vine matured      +150
 *     water drop        +10
 *     drone stunned     +25 each
 *     vine lost         −150 (floor 0)
 *     victory bonus     +10 per remaining second, +5 per remaining health point
 * - Combo: planting again within 30s steps the multiplier ×1 → ×2 → ×4 → ×8. A drone laser hit breaks it.
 * - Milestones at 25/50/75% reclaimed grant +20s.
 * - Persists personal bests and the last 5 runs in localStorage.
 */

export const RUN_DURATION = 600;
const COMBO_STEPS = [1, 2, 4, 8];
const COMBO_WINDOW = 30.0;
const MILESTONES = [25, 50, 75];
const MILESTONE_BONUS_SECONDS = 20;

function readNumber(key, fallback) {
  try {
    const v = parseFloat(localStorage.getItem(key));
    return Number.isFinite(v) ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeItem(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export class ScoreManager {
  constructor(audioManager) {
    this.audio = audioManager;
    this.state = 'MENU';

    this.onGameOver = null;
    this.healthProvider = null; // () => current health (for the victory bonus)

    this.cacheDOMElements();
    this.reset();
  }

  cacheDOMElements() {
    this.scoreValEl = document.getElementById('hud-score-val');
    this.comboContainer = document.getElementById('hud-combo-group');
    this.comboTextEl = document.getElementById('combo-badge-text');
    this.comboRingFill = document.getElementById('combo-ring-fill');
    this.timerValEl = document.getElementById('hud-timer-val');
    this.timerContainer = document.getElementById('hud-timer-container');
    this.plantersEl = document.getElementById('hud-planters');
    this.reclaimFillEl = document.getElementById('hud-reclaim-fill');
    this.reclaimValEl = document.getElementById('reclaimed-val');

    this.modalGameOver = document.getElementById('modal-gameover');
    this.goKickerEl = document.getElementById('go-kicker');
    this.goTitleEl = document.getElementById('go-title');
    this.goSubtitleEl = document.getElementById('go-subtitle');
    this.goScoreEl = document.getElementById('go-score');
    this.goReclaimedEl = document.getElementById('go-reclaimed');
    this.goComboEl = document.getElementById('go-combo');
    this.goVinesEl = document.getElementById('go-vines');
    this.goDronesEl = document.getElementById('go-drones');
    this.goTimeEl = document.getElementById('go-time');
    this.goNewBestBadge = document.getElementById('go-new-best-badge');
    this.goHistoryList = document.getElementById('go-history-list');
  }

  startGame() {
    this.reset();
    this.state = 'PLAYING';
  }

  pause() {
    if (this.state === 'PLAYING') this.state = 'PAUSED';
  }

  resume() {
    if (this.state === 'PAUSED') this.state = 'PLAYING';
  }

  reset() {
    this.score = 0;
    this.displayedScore = 0;
    this.comboLevel = 0;
    this.comboTimer = 0;
    this.bestCombo = 1;
    this.timer = RUN_DURATION;
    this.timeSurvived = 0;
    this.milestonesPassed = new Set();
    this.vinesPlanted = 0;
    this.vinesPlantedNow = 0;
    this.vinesLost = 0;
    this.dronesStunned = 0;
    this.waterCollected = 0;
    this.reclaimedPercentage = 0;
    this.maturedCount = 0;
    this.totalSpots = 28;
    this.isVictory = false;
    this.isNewHighScore = false;
    this.endReason = '';
    this._lastHud = {};

    if (this.modalGameOver) {
      this.modalGameOver.classList.remove('open');
      this.modalGameOver.setAttribute('aria-hidden', 'true');
    }
    this.updateHUD(true);
  }

  get combo() {
    return COMBO_STEPS[this.comboLevel];
  }

  addScore(points) {
    this.score = Math.max(0, Math.round(this.score + points));
  }

  recordPlanting(isRisky) {
    if (this.state !== 'PLAYING') return null;
    this.vinesPlanted++;

    if (this.comboTimer > 0) {
      this.comboLevel = Math.min(COMBO_STEPS.length - 1, this.comboLevel + 1);
    } else {
      this.comboLevel = 0;
    }
    this.comboTimer = COMBO_WINDOW;
    this.bestCombo = Math.max(this.bestCombo, this.combo);

    const risk = isRisky ? 2 : 1;
    const awarded = 100 * this.combo * risk;
    this.addScore(awarded);

    if (this.audio) this.audio.playComboChime(this.comboLevel + 1);
    if (this.comboContainer) {
      this.comboContainer.classList.remove('pop');
      void this.comboContainer.offsetWidth;
      this.comboContainer.classList.add('pop');
    }

    let msg = `+${awarded}`;
    if (this.combo > 1) msg += `  ·  Combo ×${this.combo}`;
    if (isRisky) msg += '  ·  Risk ×2';
    showToast(msg, isRisky ? 'risk' : 'good', 1800);

    return { awarded, combo: this.combo, risk };
  }

  recordVineMatured() {
    if (this.state !== 'PLAYING') return;
    this.addScore(150);
  }

  recordVineDestroyed() {
    if (this.state !== 'PLAYING') return;
    this.vinesLost++;
    this.addScore(-150);
  }

  recordWaterCollected() {
    if (this.state !== 'PLAYING') return;
    this.waterCollected++;
    this.addScore(10);
  }

  recordDronesStunned(count = 1) {
    if (this.state !== 'PLAYING' || count <= 0) return;
    this.dronesStunned += count;
    this.addScore(25 * count);
  }

  /** A real hit (drone laser) breaks the combo chain. Continuous smog/acid damage does not. */
  breakCombo() {
    if (this.comboTimer > 0 && this.comboLevel > 0) {
      showToast('Combo broken', 'bad', 1400);
    }
    this.comboLevel = 0;
    this.comboTimer = 0;
  }

  checkReclaimedMilestones(percentage, maturedCount, totalSpots) {
    this.reclaimedPercentage = percentage;
    this.maturedCount = maturedCount;
    this.totalSpots = totalSpots;
    if (this.state !== 'PLAYING') return;

    for (const m of MILESTONES) {
      if (percentage >= m && !this.milestonesPassed.has(m)) {
        this.milestonesPassed.add(m);
        this.timer += MILESTONE_BONUS_SECONDS;
        if (this.audio) this.audio.playMilestoneCelebration();
        showToast(`${m}% reclaimed  ·  +${MILESTONE_BONUS_SECONDS}s`, 'milestone', 2800);
      }
    }

    if (maturedCount >= totalSpots && !this.isVictory) {
      this.isVictory = true;
      const health = this.healthProvider ? this.healthProvider() : 0;
      this.addScore(Math.floor(this.timer) * 10 + Math.floor(health) * 5);
      this.triggerGameOver('victory');
    }
  }

  update(delta) {
    if (this.state !== 'PLAYING') return;

    this.timeSurvived += delta;
    this.timer = Math.max(0, this.timer - delta);
    if (this.timer <= 0) {
      this.triggerGameOver('time');
      return;
    }

    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - delta);
      if (this.comboTimer <= 0) this.comboLevel = 0;
    }

    this.updateHUD(false, delta);
  }

  updateHUD(instant = false, delta = 0.016) {
    const diff = this.score - this.displayedScore;
    if (instant || Math.abs(diff) < 1) {
      this.displayedScore = this.score;
    } else {
      this.displayedScore += diff * Math.min(1, delta * 12);
    }

    const last = this._lastHud;
    const scoreText = Math.round(this.displayedScore).toLocaleString();
    if (this.scoreValEl && last.score !== scoreText) {
      this.scoreValEl.textContent = scoreText;
      last.score = scoreText;
    }

    const timeText = formatTime(this.timer);
    if (this.timerValEl && last.time !== timeText) {
      this.timerValEl.textContent = timeText;
      last.time = timeText;
      this.timerContainer?.classList.toggle('urgent', this.timer <= 60);
    }

    if (this.comboContainer && last.combo !== this.combo) {
      this.comboContainer.classList.toggle('active', this.combo > 1);
      if (this.comboTextEl) this.comboTextEl.textContent = `×${this.combo}`;
      last.combo = this.combo;
    }
    if (this.comboRingFill) {
      const offset = (88 * (1 - this.comboTimer / COMBO_WINDOW)).toFixed(1);
      if (last.ring !== offset) {
        this.comboRingFill.style.strokeDashoffset = offset;
        last.ring = offset;
      }
    }

    const planted = `${this.vinesPlantedNow ?? 0} / ${this.totalSpots}`;
    if (this.plantersEl && last.planted !== planted) {
      this.plantersEl.textContent = planted;
      last.planted = planted;
    }
    const pct = Math.floor(this.reclaimedPercentage);
    if (last.pct !== pct) {
      if (this.reclaimFillEl) this.reclaimFillEl.style.transform = `scaleX(${this.reclaimedPercentage / 100})`;
      if (this.reclaimValEl) this.reclaimValEl.textContent = `${pct}%`;
      last.pct = pct;
    }
  }

  /** Called by the app each frame with the live planted count (vines can be lost). */
  setPlantedCount(count) {
    this.vinesPlantedNow = count;
  }

  triggerGameOver(reason) {
    if (this.state === 'GAMEOVER') return;
    this.state = 'GAMEOVER';
    this.endReason = reason;
    const isVictory = reason === 'victory';

    if (this.audio) this.audio.playGameOverSound(isVictory);
    this.displayedScore = this.score;
    this.updateHUD(true);

    const prevBest = readNumber('vz_high_score', 0);
    this.isNewHighScore = this.score > prevBest && this.score > 0;
    if (this.isNewHighScore) writeItem('vz_high_score', String(this.score));
    if (this.bestCombo > readNumber('vz_best_combo', 1)) writeItem('vz_best_combo', String(this.bestCombo));
    if (this.reclaimedPercentage > readNumber('vz_best_reclaimed', 0)) writeItem('vz_best_reclaimed', this.reclaimedPercentage.toFixed(1));

    this.saveRunHistory(isVictory);
    this.showGameOverModal(reason);

    if (typeof this.onGameOver === 'function') {
      try { this.onGameOver(reason, isVictory); } catch (err) { console.warn('onGameOver hook error:', err); }
    }
  }

  saveRunHistory(isVictory) {
    try {
      let history = JSON.parse(localStorage.getItem('vz_run_history') || '[]');
      if (!Array.isArray(history)) history = [];
      history.unshift({
        date: new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        score: this.score,
        reclaimed: this.reclaimedPercentage.toFixed(1),
        combo: this.bestCombo,
        timeSurvived: Math.floor(this.timeSurvived),
        victory: isVictory
      });
      writeItem('vz_run_history', JSON.stringify(history.slice(0, 5)));
    } catch (e) {
      console.warn('Could not save run history:', e);
    }
  }

  showGameOverModal(reason) {
    if (!this.modalGameOver) return;
    const copy = {
      victory: ['City reborn', 'Metropolis Zero breathes again', 'Every planter is alive. The canopy will outlast the smog.'],
      time: ['Time expired', 'The window closed', 'The purge cycle resumed before the city could recover.'],
      health: ['System depleted', 'Unit offline', 'Your chassis gave out. The seeds you planted keep growing.']
    }[reason] || ['Run complete', 'Run complete', ''];

    this.goKickerEl.textContent = copy[0];
    this.goTitleEl.textContent = copy[1];
    this.goSubtitleEl.textContent = copy[2];
    this.modalGameOver.classList.toggle('victory', reason === 'victory');
    this.goNewBestBadge?.classList.toggle('visible', this.isNewHighScore);

    this.animateStat(this.goScoreEl, 0, this.score, 1200);
    this.animateStat(this.goReclaimedEl, 0, this.reclaimedPercentage, 1000, '%', 1);
    this.goComboEl.textContent = `×${this.bestCombo}`;
    this.goVinesEl.textContent = `${this.vinesPlantedNow ?? 0} / ${this.totalSpots}`;
    this.goDronesEl.textContent = String(this.dronesStunned);
    this.goTimeEl.textContent = formatTime(this.timeSurvived);

    this.renderRunHistory();
    this.modalGameOver.classList.add('open');
    this.modalGameOver.setAttribute('aria-hidden', 'false');
  }

  animateStat(element, start, end, duration, suffix = '', decimals = 0) {
    if (!element) return;
    const startTime = performance.now();
    const format = v => `${decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString()}${suffix}`;
    const step = (now) => {
      const p = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      element.textContent = format(start + (end - start) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  renderRunHistory() {
    if (!this.goHistoryList) return;
    let history = [];
    try { history = JSON.parse(localStorage.getItem('vz_run_history') || '[]'); } catch (e) { /* ignore */ }
    if (!Array.isArray(history) || history.length === 0) {
      this.goHistoryList.innerHTML = '<div class="history-empty">No previous runs yet.</div>';
      return;
    }
    this.goHistoryList.innerHTML = history.map((run, idx) => `
      <div class="history-item${idx === 0 ? ' current' : ''}${run.victory ? ' won' : ''}">
        <span class="hist-date">${String(run.date)}</span>
        <span class="hist-score">${Number(run.score).toLocaleString()}</span>
        <span class="hist-rec">${Number(run.reclaimed)}%</span>
        <span class="hist-combo">×${Number(run.combo)}</span>
      </div>`).join('');
  }
}

/**
 * Score & Progression Manager for Verdant Zero
 * - Game States: 'MENU', 'PLAYING', 'PAUSED', 'GAMEOVER'
 * - Scoring:
 *   - +100 points per 1% reclaimed upon vine maturity
 *   - +50 points base per planting
 *   - +10 points per water droplet collected
 *   - +25 points per drone distracted by light pulse
 *   - -200 points per vine lost to smog/drones (floor 0)
 * - Combo Multiplier:
 *   - 1x -> 2x -> 3x -> 4x -> 5x within 6.0s window
 *   - Circular draining timer ring
 *   - Rising pitch audio chime & pop animation
 *   - Resets on timeout or player damage
 * - Risk Bonus:
 *   - 2x points when planting in smog zone (base * combo * 2)
 *   - Toast notification 'RISK x2'
 * - 3-Minute Run Countdown:
 *   - +8s on each 10% reclaimed milestone crossed
 *   - City Reborn ending at 100% with +50 pts/sec bonus
 * - LocalStorage Persistence:
 *   - vz_high_score, vz_best_combo, vz_best_reclaimed, vz_run_history (last 5 runs)
 * - Clean hook for time-lapse recording
 */

export class ScoreManager {
  constructor(audioManager) {
    this.audio = audioManager;
    this.state = 'MENU'; // 'MENU' | 'PLAYING' | 'PAUSED' | 'GAMEOVER'

    // Core Run Metrics
    this.score = 0;
    this.displayedScore = 0;
    this.combo = 1;
    this.comboTimer = 0.0;
    this.maxComboTime = 6.0;
    this.bestCombo = 1;

    this.timer = 180.0; // 3 minutes in seconds
    this.timeSurvived = 0.0;
    this.milestonesPassed = new Set();

    this.vinesPlanted = 0;
    this.dronesEvaded = 0;
    this.waterCollected = 0;
    this.reclaimedPercentage = 0.0;

    this.isCityReborn = false;
    this.isNewHighScore = false;

    // Time-lapse recording hook
    this.onRecordTimelapse = null;
    this.onGameOver = null;

    // High Score from localStorage
    this.highScore = parseInt(localStorage.getItem('vz_high_score') || '0', 10);
    this.bestStoredCombo = parseInt(localStorage.getItem('vz_best_combo') || '1', 10);
    this.bestStoredReclaimed = parseFloat(localStorage.getItem('vz_best_reclaimed') || '0.0');

    // DOM Element Cache
    this.cacheDOMElements();
  }

  cacheDOMElements() {
    this.scoreValEl = document.getElementById('hud-score-val');
    this.comboContainer = document.getElementById('hud-combo-group');
    this.comboTextEl = document.getElementById('combo-badge-text');
    this.comboRingFill = document.getElementById('combo-ring-fill');

    this.timerValEl = document.getElementById('hud-timer-val');
    this.timerContainer = document.getElementById('hud-timer-container');

    this.toastRiskEl = document.getElementById('toast-risk');
    this.toastMilestoneEl = document.getElementById('toast-milestone');

    this.modalGameOver = document.getElementById('modal-gameover');
    this.goTitleEl = document.getElementById('go-title');
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
    this.state = 'PLAYING';
    this.reset();
  }

  pause() {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
    }
  }

  resume() {
    if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
    }
  }

  /**
   * Reset run state instantly (<1s object pool reuse)
   */
  reset() {
    this.score = 0;
    this.displayedScore = 0;
    this.combo = 1;
    this.comboTimer = 0.0;
    this.bestCombo = 1;

    this.timer = 180.0;
    this.timeSurvived = 0.0;
    this.milestonesPassed.clear();

    this.vinesPlanted = 0;
    this.dronesEvaded = 0;
    this.waterCollected = 0;
    this.reclaimedPercentage = 0.0;

    this.isCityReborn = false;
    this.isNewHighScore = false;

    // Hide modals & toasts
    if (this.modalGameOver) {
      this.modalGameOver.classList.remove('open');
      this.modalGameOver.setAttribute('aria-hidden', 'true');
    }
    if (this.toastRiskEl) this.toastRiskEl.classList.remove('active');
    if (this.toastMilestoneEl) this.toastMilestoneEl.classList.remove('active');

    this.updateHUD(true);
  }

  /**
   * Score Adjustment with count-up animation
   */
  addScore(points) {
    this.score = Math.max(0, this.score + points);
  }

  /**
   * Called when a seed is planted
   */
  recordPlanting(isInsideSmog) {
    if (this.state !== 'PLAYING') return;

    this.vinesPlanted++;

    // 1. Combo progression (chained planting within 6s)
    if (this.comboTimer > 0) {
      this.combo = Math.min(5, this.combo + 1);
    } else {
      this.combo = 1;
    }
    this.comboTimer = this.maxComboTime;
    this.bestCombo = Math.max(this.bestCombo, this.combo);

    // Audio chime rising in pitch
    if (this.audio) {
      this.audio.playComboChime(this.combo);
    }

    // Pop animation on combo badge
    if (this.comboContainer) {
      this.comboContainer.classList.remove('pop');
      void this.comboContainer.offsetWidth; // Reflow
      this.comboContainer.classList.add('pop');
    }

    // 2. Risk bonus calculation
    const basePoints = 50;
    const riskMultiplier = isInsideSmog ? 2 : 1;
    const awarded = basePoints * this.combo * riskMultiplier;

    this.addScore(awarded);

    // 3. Show Risk toast if in smog
    if (isInsideSmog) {
      this.showRiskToast();
    }

    return { awarded, combo: this.combo, riskMultiplier };
  }

  showRiskToast() {
    if (!this.toastRiskEl) return;
    this.toastRiskEl.classList.remove('active');
    void this.toastRiskEl.offsetWidth;
    this.toastRiskEl.classList.add('active');

    if (this.riskToastTimeout) clearTimeout(this.riskToastTimeout);
    this.riskToastTimeout = setTimeout(() => {
      if (this.toastRiskEl) this.toastRiskEl.classList.remove('active');
    }, 2200);
  }

  showMilestoneToast(milestone) {
    if (!this.toastMilestoneEl) return;
    this.toastMilestoneEl.textContent = `+8s TIME BONUS — ${milestone}% RECLAIMED`;
    this.toastMilestoneEl.classList.remove('active');
    void this.toastMilestoneEl.offsetWidth;
    this.toastMilestoneEl.classList.add('active');

    if (this.milestoneTimeout) clearTimeout(this.milestoneTimeout);
    this.milestoneTimeout = setTimeout(() => {
      if (this.toastMilestoneEl) this.toastMilestoneEl.classList.remove('active');
    }, 2600);
  }

  /**
   * Called when a vine's growth completes
   * Award +100 points for every 1% of the city reclaimed
   */
  recordVineMatured(percentageContribution) {
    if (this.state !== 'PLAYING') return;
    const points = Math.round(percentageContribution * 100);
    this.addScore(points);
  }

  /**
   * Called when a vine is destroyed by smog or purge drone
   * Costs 200 points (floor at 0)
   */
  recordVineDestroyed() {
    this.addScore(-200);
  }

  /**
   * Called when a water drop is collected (+10 points)
   */
  recordWaterCollected() {
    if (this.state !== 'PLAYING') return;
    this.waterCollected++;
    this.addScore(10);
  }

  /**
   * Called when light pulse distracts a drone (+25 points)
   */
  recordDroneEvaded(count = 1) {
    if (this.state !== 'PLAYING') return;
    this.dronesEvaded += count;
    this.addScore(25 * count);
  }

  /**
   * Reset combo when player takes damage
   */
  onPlayerDamage() {
    if (this.combo > 1 || this.comboTimer > 0) {
      this.combo = 1;
      this.comboTimer = 0.0;
    }
  }

  /**
   * Check 10% reclaimed milestones
   */
  checkReclaimedMilestones(currentPercentage) {
    this.reclaimedPercentage = currentPercentage;

    for (let m = 10; m <= 100; m += 10) {
      if (currentPercentage >= m && !this.milestonesPassed.has(m)) {
        this.milestonesPassed.add(m);
        this.timer += 8.0; // Add 8 seconds

        if (this.audio) {
          this.audio.playMilestoneCelebration();
        }
        this.showMilestoneToast(m);
      }
    }

    // City Reborn Ending (100% Reclaimed)
    if (currentPercentage >= 99.9 && !this.isCityReborn && this.state === 'PLAYING') {
      this.isCityReborn = true;
      const victoryBonus = Math.floor(this.timer * 50);
      this.addScore(victoryBonus);
      this.triggerGameOver('City Reborn', true);
    }
  }

  /**
   * Update scoring loop, timer, and animated count-up
   */
  update(delta) {
    if (this.state !== 'PLAYING') return;

    this.timeSurvived += delta;

    // 1. Timer countdown
    this.timer = Math.max(0, this.timer - delta);
    if (this.timer <= 0) {
      this.triggerGameOver('Time Expired', false);
      return;
    }

    // 2. Combo timer countdown
    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - delta);
      if (this.comboTimer <= 0) {
        this.combo = 1;
      }
    }

    // 3. Update HUD Display
    this.updateHUD(false, delta);
  }

  updateHUD(instant = false, delta = 0.016) {
    // A. Smooth count-up score animation
    if (instant) {
      this.displayedScore = this.score;
    } else {
      const diff = this.score - this.displayedScore;
      if (Math.abs(diff) < 1) {
        this.displayedScore = this.score;
      } else {
        // Fast yet smooth lerp
        this.displayedScore += diff * Math.min(1.0, delta * 12.0);
      }
    }

    if (this.scoreValEl) {
      this.scoreValEl.textContent = Math.round(this.displayedScore).toLocaleString();
    }

    // B. Timer display (MM:SS)
    if (this.timerValEl) {
      const totalSec = Math.ceil(this.timer);
      const minutes = Math.floor(totalSec / 60);
      const seconds = totalSec % 60;
      this.timerValEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

      // Warning color if under 30 seconds
      if (totalSec <= 30) {
        this.timerContainer?.classList.add('urgent');
      } else {
        this.timerContainer?.classList.remove('urgent');
      }
    }

    // C. Combo badge & draining ring
    if (this.comboContainer) {
      if (this.combo > 1) {
        this.comboContainer.classList.add('active');
        if (this.comboTextEl) this.comboTextEl.textContent = `${this.combo}x`;
      } else {
        this.comboContainer.classList.remove('active');
        if (this.comboTextEl) this.comboTextEl.textContent = '1x';
      }

      // Circular draining ring (stroke-dashoffset from 0 to 88)
      if (this.comboRingFill) {
        const perimeter = 88.0; // r=14 -> 2 * PI * 14 ~= 88
        const ratio = this.comboTimer / this.maxComboTime;
        const offset = perimeter * (1.0 - ratio);
        this.comboRingFill.style.strokeDashoffset = offset.toString();
      }
    }
  }

  /**
   * Game Over Trigger
   */
  triggerGameOver(reason = 'Depleted', isVictory = false) {
    if (this.state === 'GAMEOVER') return;
    this.state = 'GAMEOVER';

    // Play Audio
    if (this.audio) {
      this.audio.playGameOverSound(isVictory);
    }

    // Final score settle
    this.displayedScore = this.score;

    // Check High Score
    const prevHighScore = parseInt(localStorage.getItem('vz_high_score') || '0', 10);
    this.isNewHighScore = this.score > prevHighScore;
    if (this.isNewHighScore) {
      localStorage.setItem('vz_high_score', this.score.toString());
      this.highScore = this.score;
    }

    // Persist Best Combo & Reclaimed
    const prevBestCombo = parseInt(localStorage.getItem('vz_best_combo') || '1', 10);
    if (this.bestCombo > prevBestCombo) {
      localStorage.setItem('vz_best_combo', this.bestCombo.toString());
    }

    const prevBestReclaimed = parseFloat(localStorage.getItem('vz_best_reclaimed') || '0.0');
    if (this.reclaimedPercentage > prevBestReclaimed) {
      localStorage.setItem('vz_best_reclaimed', this.reclaimedPercentage.toFixed(1));
    }

    // Persist Run History (Last 5 runs)
    this.saveRunHistory(isVictory);

    // Display Game Over Modal with count-ups
    this.showGameOverModal(reason, isVictory);

    // Camera and UI game over callback
    if (typeof this.onGameOver === 'function') {
      try {
        this.onGameOver(reason, isVictory);
      } catch (err) {
        console.warn('onGameOver hook error:', err);
      }
    }

    // Clean hook for time-lapse recording
    if (typeof this.onRecordTimelapse === 'function') {
      try {
        this.onRecordTimelapse({
          score: this.score,
          reclaimed: this.reclaimedPercentage,
          timeSurvived: this.timeSurvived,
          victory: isVictory
        });
      } catch (err) {
        console.warn('Timelapse hook error:', err);
      }
    }
  }

  saveRunHistory(isVictory) {
    try {
      const historyStr = localStorage.getItem('vz_run_history');
      let history = historyStr ? JSON.parse(historyStr) : [];
      if (!Array.isArray(history)) history = [];

      const runRecord = {
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        score: this.score,
        reclaimed: this.reclaimedPercentage.toFixed(1),
        combo: this.bestCombo,
        timeSurvived: Math.floor(this.timeSurvived),
        victory: isVictory
      };

      history.unshift(runRecord);
      history = history.slice(0, 5); // Keep last 5 runs

      localStorage.setItem('vz_run_history', JSON.stringify(history));
    } catch (e) {
      console.warn('Could not save run history to localStorage:', e);
    }
  }

  showGameOverModal(reason, isVictory) {
    if (!this.modalGameOver) return;

    if (this.goTitleEl) {
      this.goTitleEl.textContent = isVictory ? 'CITY REBORN' : (reason === 'Time Expired' ? 'TIME EXPIRED' : 'SYSTEM DEPLETED');
    }

    // New High Score Badge
    if (this.goNewBestBadge) {
      if (this.isNewHighScore && this.score > 0) {
        this.goNewBestBadge.classList.add('visible');
      } else {
        this.goNewBestBadge.classList.remove('visible');
      }
    }

    // Format Time Survived
    const totalSec = Math.floor(this.timeSurvived);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    const timeFormatted = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;

    // Animate Stats Count-Up
    this.animateStat(this.goScoreEl, 0, this.score, 1200);
    this.animateStat(this.goReclaimedEl, 0, this.reclaimedPercentage, 1000, '%', 1);
    this.animateStat(this.goComboEl, 1, this.bestCombo, 800, 'x');
    this.animateStat(this.goVinesEl, 0, this.vinesPlanted, 800);
    this.animateStat(this.goDronesEl, 0, this.dronesEvaded, 800);
    if (this.goTimeEl) this.goTimeEl.textContent = timeFormatted;

    // Render Recent Run History (Last 5 runs)
    this.renderRunHistory();

    // Show modal
    this.modalGameOver.classList.add('open');
    this.modalGameOver.setAttribute('aria-hidden', 'false');
  }

  animateStat(element, start, end, duration, suffix = '', decimals = 0) {
    if (!element) return;
    const startTime = performance.now();
    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;
      element.textContent = `${decimals > 0 ? current.toFixed(decimals) : Math.round(current).toLocaleString()}${suffix}`;
      if (progress < 1.0) {
        requestAnimationFrame(step);
      } else {
        element.textContent = `${decimals > 0 ? end.toFixed(decimals) : Math.round(end).toLocaleString()}${suffix}`;
      }
    };
    requestAnimationFrame(step);
  }

  renderRunHistory() {
    if (!this.goHistoryList) return;
    try {
      const historyStr = localStorage.getItem('vz_run_history');
      const history = historyStr ? JSON.parse(historyStr) : [];
      if (!Array.isArray(history) || history.length === 0) {
        this.goHistoryList.innerHTML = '<div class="history-empty">No previous runs recorded.</div>';
        return;
      }

      this.goHistoryList.innerHTML = history.map((run, idx) => `
        <div class="history-item ${idx === 0 ? 'current' : ''}">
          <span class="hist-col hist-date">${run.date}</span>
          <span class="hist-col hist-score">${run.score.toLocaleString()} pts</span>
          <span class="hist-col hist-rec">${run.reclaimed}%</span>
          <span class="hist-col hist-combo">${run.combo}x</span>
        </div>
      `).join('');
    } catch (e) {
      console.warn('Failed rendering run history:', e);
    }
  }
}

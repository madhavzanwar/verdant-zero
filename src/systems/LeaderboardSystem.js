/**
 * Verdant Zero — Leaderboard System (Part G)
 * - Supports Firestore remote database via REST API / client SDK with zero mandatory paid deps
 * - Offline-first fallback to LocalStorage with automatic merge
 * - Nickname & College / Campus input
 * - Three Tab Views: "All Time", "Today", "My College"
 * - Share / "Challenge a Friend" deep-link & clipboard copy
 * - Rate-limited score submission (one save per run is enforced by the app; 15s cooldown here)
 */

export class LeaderboardSystem {
  constructor() {
    this.storageKey = 'vz_leaderboard_records';
    this.nicknameKey = 'vz_player_nickname';
    this.collegeKey = 'vz_player_college';
    this.lastSubmitTime = 0;
    this.submitCooldown = 15000; // 15 seconds

    // Firebase REST Configuration from env or fallback
    this.firebaseConfig = {
      projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || '',
      apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || ''
    };

    this.activeTab = 'all'; // 'all' | 'today' | 'college'
    this.removeLegacySeedRecords();
  }

  getSavedPlayerInfo() {
    return {
      nickname: this.safeGet(this.nicknameKey),
      college: this.safeGet(this.collegeKey)
    };
  }

  safeGet(key) {
    try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
  }

  savePlayerInfo(nickname, college) {
    try {
      if (nickname) localStorage.setItem(this.nicknameKey, nickname.trim().slice(0, 24));
      if (college) localStorage.setItem(this.collegeKey, college.trim().slice(0, 36));
    } catch (e) { /* storage unavailable */ }
  }

  /** Earlier versions seeded fake players; drop them so the board only shows real runs. */
  removeLegacySeedRecords() {
    const seeds = new Set(['AeroBotanist', 'NeonSprout', 'EchoGardener', 'VerdantViper', 'FloraZero']);
    const records = this.getLocalRecords();
    const cleaned = records.filter(r => !(seeds.has(r.nickname) && /^[1-5]$/.test(String(r.id))));
    if (cleaned.length !== records.length) {
      try { localStorage.setItem(this.storageKey, JSON.stringify(cleaned)); } catch (e) { /* ignore */ }
    }
  }

  getLocalRecords() {
    try {
      const list = JSON.parse(localStorage.getItem(this.storageKey) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  async submitScore(entry) {
    const now = Date.now();
    if (now - this.lastSubmitTime < this.submitCooldown) {
      console.warn('Leaderboard submission throttled (cooldown active).');
      return { success: false, reason: 'Please wait before submitting again.' };
    }
    this.lastSubmitTime = now;

    const nickname = (entry.nickname || '').trim().slice(0, 24) || 'Anonymous Gardener';
    const college = (entry.college || '').trim().slice(0, 36);
    const score = Math.max(0, Math.floor(entry.score || 0));
    const reclaimed = entry.reclaimed || '0.0%';

    this.savePlayerInfo((entry.nickname || '').trim(), college);

    const record = {
      id: 'rec_' + Math.random().toString(36).substr(2, 9),
      nickname,
      college,
      score,
      reclaimed,
      combo: Math.max(1, Math.floor(entry.combo || 1)),
      time: Math.max(0, Math.floor(entry.time || 0)),
      victory: !!entry.victory,
      date: new Date().toISOString()
    };

    // 1. Save to LocalStorage
    const records = this.getLocalRecords();
    records.push(record);
    records.sort((a, b) => b.score - a.score);
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(records.slice(0, 50)));
    } catch (e) {
      return { success: false, reason: 'Browser storage is unavailable.' };
    }

    // 2. Submit to Firebase Firestore REST API if configured
    let remote = false;
    if (this.firebaseConfig.projectId && this.firebaseConfig.apiKey) {
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${this.firebaseConfig.projectId}/databases/(default)/documents/leaderboard?key=${this.firebaseConfig.apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              nickname: { stringValue: nickname },
              college: { stringValue: college },
              score: { integerValue: score.toString() },
              reclaimed: { stringValue: reclaimed },
              timestamp: { timestampValue: record.date }
            }
          })
        });
        remote = res.ok;
      } catch (err) {
        console.warn('Firestore sync failed, local record preserved:', err);
      }
    }

    return { success: true, record, remote };
  }

  async fetchRecords(tab = 'all', filterCollege = '') {
    this.activeTab = tab;
    let records = this.getLocalRecords();

    // Query remote Firestore if configured
    if (this.firebaseConfig.projectId && this.firebaseConfig.apiKey) {
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${this.firebaseConfig.projectId}/databases/(default)/documents/leaderboard?key=${this.firebaseConfig.apiKey}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data.documents) {
            const remoteRecords = data.documents.map(doc => {
              const f = doc.fields || {};
              return {
                id: doc.name,
                nickname: f.nickname?.stringValue || 'Gardener',
                college: f.college?.stringValue || 'City Lab',
                score: parseInt(f.score?.integerValue || '0', 10),
                reclaimed: f.reclaimed?.stringValue || '0.0%',
                date: f.timestamp?.timestampValue || new Date().toISOString()
              };
            });
            // Merge remote + local, dropping local rows that were also synced remotely
            const key = r => `${r.nickname}|${r.score}|${r.date}`;
            const seen = new Set(remoteRecords.map(key));
            records = [...remoteRecords, ...records.filter(r => !seen.has(key(r)))];
          }
        }
      } catch (e) {
        console.warn('Using offline leaderboard cache.');
      }
    }

    // Filter by Tab
    if (tab === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      records = records.filter(r => new Date(r.date) >= todayStart);
    } else if (tab === 'college') {
      const userCollege = (filterCollege || this.getSavedPlayerInfo().college || '').trim().toLowerCase();
      records = userCollege ? records.filter(r => (r.college || '').toLowerCase() === userCollege) : [];
    }

    records.sort((a, b) => b.score - a.score);
    return records.slice(0, 25);
  }

  generateShareLink(score, reclaimed) {
    const origin = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({
      challengeScore: score,
      reclaimed: reclaimed
    });
    return `${origin}?${params.toString()}`;
  }
}

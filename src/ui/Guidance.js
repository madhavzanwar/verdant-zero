import * as THREE from 'three';

/**
 * Guidance — keeps the player oriented at all times.
 *
 * - Compass ribbon: heading ticks plus markers for the nearest open planters (▲ = elevated),
 *   the nearest water drop, nearby drones and the active waypoint. Off-ribbon markers pin to the
 *   edge with a chevron so you always know which way to turn.
 * - Objective line: one sentence telling you what to do next ("Plant at Lantern Alley · 42m").
 * - Coach hints: one-time contextual tips the first time a mechanic matters (stored per player).
 * - World keycap: a floating "E" above the planter you can plant right now.
 */

const FOV_SPAN = Math.PI * 0.6;      // compass shows ±54°
const COMPASS_HZ = 30;
const OBJECTIVE_HZ = 4;
const HINT_STORAGE = 'vz_hints_seen';

const HINTS = {
  move: { icon: 'WASD', title: 'Get moving', text: 'Move with WASD, look with the mouse. Follow the green markers on the compass.' },
  plant: { icon: 'E', title: 'Plant a seed', text: 'Stand in a glowing planter and press E. Each seed costs 25 water.' },
  combo: { icon: '×2', title: 'Chain it', text: 'Plant again within 30 seconds to double, then quadruple your points.' },
  elevated: { icon: '▲', title: 'Planter up high', text: 'Jump, then hold SPACE to hover. Crates under skyways are stepping stones.' },
  water: { icon: 'T', title: 'Out of seeds', text: 'Collect blue water drops for more seeds. Press T to mark the nearest one.' },
  smog: { icon: 'Q', title: 'Toxic smog', text: 'Smog drains health and slows you. A Light Pulse (Q) clears it around you.' },
  acid: { icon: '☂', title: 'Acid rain', text: 'Shelter under a skyway or a pink-trimmed awning until it passes.' },
  drone: { icon: 'F', title: 'Purge drone', text: 'Watch for the red aim line, then change direction or dash (F). Q stuns drones.' },
  vine: { icon: '!', title: 'Vine under attack', text: 'Amber planters on the radar are withering. Stun the drone before the vine dies.' },
  map: { icon: 'M', title: 'Plan a route', text: 'Press M for the sector map. Click anywhere on it to drop a waypoint.' }
};

function loadSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(HINT_STORAGE) || '[]'));
  } catch (e) {
    return new Set();
  }
}

function makeKeycapTexture(label, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(6, 26, 18, 0.9)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.roundRect(12, 12, 104, 104, 22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 64px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Guidance {
  constructor({ scene, registry, waypointSystem }) {
    this.registry = registry;
    this.waypoints = waypointSystem;
    this.seen = loadSeen();
    this.queue = [];
    this.coachTimer = 0;
    this.compassTimer = 0;
    this.objectiveTimer = 0;
    this.lastObjective = '';

    this.compassTrack = document.getElementById('compass-track');
    this.objectiveEl = document.getElementById('hud-objective-text');
    this.coachEl = document.getElementById('coach');
    this.coachIcon = document.getElementById('coach-icon');
    this.coachTitle = document.getElementById('coach-title');
    this.coachText = document.getElementById('coach-text');

    this.buildCompass();

    // World-space keycap above the planter in range
    this.keyTexPlant = makeKeycapTexture('E', '#2df59a');
    this.keyTexDenied = makeKeycapTexture('E', '#ffc247');
    this.keycap = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.keyTexPlant, depthTest: false, transparent: true }));
    this.keycap.scale.set(0.9, 0.9, 1);
    this.keycap.renderOrder = 10;
    this.keycap.visible = false;
    scene.add(this.keycap);
    this.keycapPop = 0;
  }

  buildCompass() {
    const track = this.compassTrack;
    if (!track) return;
    track.innerHTML = '';
    this.ticks = [];
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    for (let i = 0; i < 24; i++) {
      const el = document.createElement('span');
      const isCardinal = i % 3 === 0;
      el.className = isCardinal ? 'compass-tick major' : 'compass-tick';
      if (isCardinal) el.textContent = labels[i / 3];
      track.appendChild(el);
      this.ticks.push({ el, angle: (i / 24) * Math.PI * 2 });
    }
    // Marker pool
    this.markers = [];
    for (let i = 0; i < 12; i++) {
      const el = document.createElement('span');
      el.className = 'compass-marker';
      const label = document.createElement('small');
      el.appendChild(label);
      track.appendChild(el);
      this.markers.push({ el, label, state: '' });
    }
  }

  // ---------------------------------------------------------------------------
  // Hints
  // ---------------------------------------------------------------------------

  hint(id) {
    if (this.seen.has(id) || this.queue.includes(id) || this.current === id) return;
    this.queue.push(id);
  }

  markSeen(id) {
    this.seen.add(id);
    try { localStorage.setItem(HINT_STORAGE, JSON.stringify([...this.seen])); } catch (e) { /* ignore */ }
  }

  resetHints() {
    this.seen.clear();
    try { localStorage.removeItem(HINT_STORAGE); } catch (e) { /* ignore */ }
  }

  updateCoach(delta) {
    if (this.coachTimer > 0) {
      this.coachTimer -= delta;
      if (this.coachTimer <= 0) {
        this.coachEl?.classList.remove('visible');
        this.current = null;
        this.coachTimer = -0.6; // short gap between hints
      }
      return;
    }
    if (this.coachTimer < 0) {
      this.coachTimer = Math.min(0, this.coachTimer + delta);
      return;
    }
    const id = this.queue.shift();
    if (!id) return;
    const h = HINTS[id];
    this.current = id;
    this.markSeen(id);
    if (!this.coachEl) return;
    this.coachIcon.textContent = h.icon;
    this.coachTitle.textContent = h.title;
    this.coachText.textContent = h.text;
    this.coachEl.classList.add('visible');
    this.coachTimer = 6;
  }

  clearCoach() {
    this.queue.length = 0;
    this.coachTimer = 0;
    this.current = null;
    this.coachEl?.classList.remove('visible');
  }

  // ---------------------------------------------------------------------------
  // Per-frame
  // ---------------------------------------------------------------------------

  /**
   * @param ctx { delta, robot, survival, droneSystem, plantSystem, nearSpot, canAfford }
   */
  update(ctx) {
    const { delta } = ctx;
    this.updateKeycap(ctx);
    this.updateCoach(delta);
    this.detectHints(ctx);

    this.compassTimer -= delta;
    if (this.compassTimer <= 0) {
      this.compassTimer = 1 / COMPASS_HZ;
      this.updateCompass(ctx);
    }
    this.objectiveTimer -= delta;
    if (this.objectiveTimer <= 0) {
      this.objectiveTimer = 1 / OBJECTIVE_HZ;
      this.updateObjective(ctx);
    }
  }

  updateKeycap({ delta, nearSpot, canAfford, time }) {
    if (nearSpot) {
      const d = nearSpot.data;
      this.keycap.visible = true;
      this.keycapPop = Math.min(1, this.keycapPop + delta * 6);
      const pop = 0.9 * (1 + 0.25 * Math.sin(this.keycapPop * Math.PI));
      this.keycap.scale.set(pop, pop, 1);
      this.keycap.position.set(d.x, d.y + 3.4 + Math.sin(time * 3) * 0.12, d.z);
      const tex = canAfford ? this.keyTexPlant : this.keyTexDenied;
      if (this.keycap.material.map !== tex) {
        this.keycap.material.map = tex;
        this.keycap.material.needsUpdate = true;
      }
    } else {
      this.keycap.visible = false;
      this.keycapPop = 0;
    }
  }

  detectHints({ robot, survival, droneSystem, plantSystem, nearSpot, gameTime }) {
    if (gameTime > 1.5) this.hint('move');
    if (nearSpot) this.hint('plant');
    if (plantSystem.plantedCount >= 1) this.hint('combo');
    if (plantSystem.plantedCount >= 3) this.hint('map');
    if (survival.water < survival.seedCost) this.hint('water');
    if (survival.inSmog) this.hint('smog');
    if (survival.acidState !== 'IDLE') this.hint('acid');
    if (droneSystem.drones.some(d => d.state === 'ALERT' || d.state === 'CHASE')) this.hint('drone');
    if (plantSystem.activeVines.some(v => v.health < 0.6)) this.hint('vine');

    const nearest = this.registry.getNearestAvailableSpot(robot.position);
    if (nearest && nearest.spot.y > 1 && nearest.distance < 25 && robot.position.y < nearest.spot.y) {
      this.hint('elevated');
    }
  }

  updateCompass({ robot }) {
    if (!this.compassTrack) return;
    const heading = this.registry.player.cameraHeading;
    const width = this.compassTrack.clientWidth || 320;
    const half = width / 2;
    const toX = (angle) => {
      let rel = angle - heading;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      return { x: (rel / (FOV_SPAN / 2)) * half, rel };
    };

    for (const t of this.ticks) {
      const { x } = toX(t.angle);
      const visible = Math.abs(x) < half;
      t.el.style.opacity = visible ? String(1 - Math.abs(x) / half * 0.7) : '0';
      t.el.style.transform = `translateX(${(half + x).toFixed(1)}px)`;
    }

    // Collect markers: nearest 3 open planters, nearest water, drones within 70m, waypoint
    const p = robot.position;
    const items = [];
    const spots = [];
    for (const s of this.registry.getSpots()) {
      if (s.isPlanted) continue;
      spots.push({ s, d: Math.hypot(s.x - p.x, s.z - p.z) });
    }
    spots.sort((a, b) => a.d - b.d);
    spots.slice(0, 3).forEach((e, i) => items.push({
      type: e.s.y > 1 ? 'spot up' : 'spot', x: e.s.x, z: e.s.z, label: i === 0 ? `${Math.round(e.d)}m` : '', primary: i === 0
    }));
    for (const s of this.registry.getSpots()) {
      if (s.isPlanted && s.isWithering) items.push({ type: 'wither', x: s.x, z: s.z, label: '' });
    }
    const water = this.registry.getNearestWaterDrop(p);
    if (water) items.push({ type: 'water', x: water.drop.x, z: water.drop.z, label: `${Math.round(water.distance)}m` });
    for (const d of this.registry.getDrones()) {
      if (Math.hypot(d.x - p.x, d.z - p.z) < 70) items.push({ type: d.state === 'CHASE' || d.state === 'ALERT' ? 'drone hot' : 'drone', x: d.x, z: d.z, label: '' });
    }
    const wp = this.waypoints?.activeWaypoint;
    if (wp) items.push({ type: 'waypoint', x: wp.position.x, z: wp.position.z, label: '' });

    for (let i = 0; i < this.markers.length; i++) {
      const m = this.markers[i];
      const it = items[i];
      if (!it) {
        if (m.state !== 'hidden') { m.el.style.display = 'none'; m.state = 'hidden'; }
        continue;
      }
      const angle = Math.atan2(it.x - p.x, -(it.z - p.z));
      let { x } = toX(angle);
      const clamped = Math.abs(x) > half - 8;
      if (clamped) x = Math.sign(x) * (half - 8);
      const cls = `compass-marker ${it.type}${clamped ? ' edge' : ''}${clamped && x < 0 ? ' left' : ''}${it.primary ? ' primary' : ''}`;
      if (m.state !== cls) { m.el.className = cls; m.state = cls; m.el.style.display = ''; }
      m.el.style.transform = `translateX(${(half + x).toFixed(1)}px)`;
      if (m.label.textContent !== it.label) m.label.textContent = it.label;
    }
  }

  updateObjective({ robot, survival, droneSystem }) {
    if (!this.objectiveEl) return;
    let text;
    let tone = '';
    const chased = droneSystem.drones.some(d => d.state === 'CHASE');
    if (survival.acidState === 'ACTIVE' && !survival.sheltered) {
      text = 'Acid rain — get under a skyway or awning';
      tone = 'warn';
    } else if (chased) {
      text = 'Drone lock — keep moving, dash (F) out of the red line, or stun it (Q)';
      tone = 'danger';
    } else if (survival.water < survival.seedCost) {
      const w = this.registry.getNearestWaterDrop(robot.position);
      text = w ? `Collect water · nearest drop ${Math.round(w.distance)}m (T)` : 'Collect water drops to refill your seeds';
      tone = 'water';
    } else {
      const n = this.registry.getNearestAvailableSpot(robot.position);
      if (n) {
        const rise = n.spot.y - (robot.position.y - 0.9);
        const up = rise > 2 ? ` · ▲ ${Math.round(rise)}m up` : '';
        text = `Plant at ${n.spot.type} · ${Math.round(n.distance)}m${up}`;
      } else {
        text = 'Every planter is seeded — protect the vines until they bloom';
      }
    }
    const key = text + tone;
    if (key !== this.lastObjective) {
      this.lastObjective = key;
      this.objectiveEl.textContent = text;
      this.objectiveEl.className = `objective-text ${tone}`;
    }
  }

  reset() {
    this.clearCoach();
    this.keycap.visible = false;
    this.lastObjective = '';
  }
}

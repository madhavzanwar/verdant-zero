import * as THREE from 'three';
import { showToast } from '../ui/Toasts.js';

/**
 * Survival & Player Resources
 * - Health 100. Regenerates 5 HP/s after 5s without damage.
 * - Water 100 (4 seeds × 25). Water drops (+25) spawn on walkable ground, skyways and alleys.
 * - Light Pulse: 15m radius, clears smog, stuns drones for 6s, 10s cooldown.
 * - Acid rain cycle: warning (6s) → storm (14s), every 70–100s. 6 HP/s unless sheltered under a
 *   skyway or awning. Damages growing vines.
 * - Smog: density > 0.22 drains health continuously (no hit flash), slows the robot.
 * - Discrete hits (drone lasers) flash the screen, play the hit sound and break the combo.
 */

const SEED_COST = 25;
const MAX_DROPS = 8;
const DROP_LIFETIME = 60;
const PULSE_RADIUS = 15;
const PULSE_COOLDOWN = 10;
const STUN_DURATION = 6;

export class SurvivalManager {
  constructor(scene, city, audioManager, scoreManager = null) {
    this.scene = scene;
    this.city = city;
    this.colliders = city.buildingColliders;
    this.shelters = city.shelters || [];
    this.audio = audioManager;
    this.scoreManager = scoreManager;
    this.plantSystem = null;

    this.maxHealth = 100;
    this.maxWater = 100;
    this.seedCost = SEED_COST;
    this.pulseCooldown = PULSE_COOLDOWN;
    this.pulseRadius = PULSE_RADIUS;

    this.waterDrops = [];
    this.nextDropId = 1;

    this._pullDir = new THREE.Vector3();
    this._fogBase = new THREE.Color(0x281648);
    this._fogAcid = new THREE.Color(0x3a4a18);

    this.initWaterDropVisuals();
    this.initPulseVisual();
    this.cacheDOM();
    this.reset();
  }

  setPlantSystem(ps) {
    this.plantSystem = ps;
  }

  cacheDOM() {
    const $ = id => document.getElementById(id);
    this.healthBar = $('health-bar-fill');
    this.waterBar = $('water-bar-fill');
    this.hoverBar = $('hover-bar-fill');
    this.healthVal = $('health-val');
    this.waterVal = $('water-val');
    this.healthContainer = $('health-container');
    this.waterContainer = $('water-container');
    this.seedPips = $('seed-pips');
    this.pulseRing = $('pulse-cooldown-circle');
    this.pulseCdText = $('pulse-cd-text');
    this.pulseBtn = $('pulse-ability');
    this.dashRing = $('dash-cooldown-circle');
    this.dashBtn = $('dash-ability');
    this.damageFlashEl = $('damage-flash');
    this.smogOverlayEl = $('smog-overlay');
    this.acidOverlayEl = $('acid-overlay');
    this.chipAcid = $('chip-acid');
    this.chipSmog = $('chip-smog');

    if (this.seedPips && this.seedPips.children.length === 0) {
      for (let i = 0; i < this.maxWater / SEED_COST; i++) {
        const pip = document.createElement('i');
        pip.className = 'seed-pip';
        this.seedPips.appendChild(pip);
      }
    }
    this._hud = {};
  }

  // ---------------------------------------------------------------------------
  // Visuals
  // ---------------------------------------------------------------------------

  initPulseVisual() {
    const ringGeo = new THREE.RingGeometry(0.85, 1.0, 64).rotateX(-Math.PI / 2);
    this.pulseMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0x33ffaa, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.pulseMesh.visible = false;
    this.scene.add(this.pulseMesh);

    // Inner flash disc
    const discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    this.pulseDisc = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
      color: 0x11cc77, transparent: true, opacity: 0, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.pulseDisc.visible = false;
    this.scene.add(this.pulseDisc);
    this.activePulse = null;
  }

  initWaterDropVisuals() {
    this.dropGeo = new THREE.SphereGeometry(0.35, 16, 12);
    this.dropMat = new THREE.MeshStandardMaterial({
      color: 0x00d0ff, roughness: 0.1, metalness: 0.6, emissive: 0x0077ff, emissiveIntensity: 1.1
    });
    this.dropRingGeo = new THREE.RingGeometry(0.5, 0.65, 24).rotateX(-Math.PI / 2);
    this.dropRingMat = new THREE.MeshBasicMaterial({
      color: 0x00e0ff, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.dropBeamGeo = new THREE.CylinderGeometry(0.05, 0.25, 6, 8, 1, true).translate(0, 3, 0);
    this.dropBeamMat = new THREE.MeshBasicMaterial({
      color: 0x00b8ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
  }

  // ---------------------------------------------------------------------------
  // Water drops
  // ---------------------------------------------------------------------------

  isInsideCollider(x, y, z, pad = 1.0) {
    for (const c of this.colliders) {
      if (x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad &&
          y < c.height + 0.5 && y > (c.minY || 0) - 1.5) {
        return true;
      }
    }
    return false;
  }

  pickDropLocation() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const roll = Math.random();
      let x, y = 0.9, z;
      if (roll < 0.55) {
        // Street & sidewalks
        x = (Math.random() - 0.5) * 28;
        z = (Math.random() - 0.5) * 256;
      } else if (roll < 0.75) {
        // Alleys (6m gaps between towers every 24m)
        const alleys = [-120, -96, -72, -48, -24, 0, 24, 48, 72, 96, 120];
        z = alleys[Math.floor(Math.random() * alleys.length)];
        x = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 12);
      } else if (roll < 0.9 && this.city.spotMeshes) {
        // Near an elevated planter (skyway / garden roof) so high routes stay worth it
        const high = this.city.spotMeshes.filter(s => s.data.y > 1);
        const s = high[Math.floor(Math.random() * high.length)].data;
        x = s.x + (Math.random() - 0.5) * 5;
        z = s.z + (Math.random() - 0.5) * 3;
        y = s.y + 0.8;
      } else {
        // Outer district
        x = (Math.random() < 0.5 ? -1 : 1) * (38 + Math.random() * 14);
        z = (Math.random() - 0.5) * 220;
      }
      if (y < 2 && this.isInsideCollider(x, y, z)) continue;
      return { x, y, z };
    }
    return { x: (Math.random() - 0.5) * 10, y: 0.9, z: (Math.random() - 0.5) * 100 };
  }

  spawnWaterDrop() {
    if (this.waterDrops.length >= MAX_DROPS) return;
    const { x, y, z } = this.pickDropLocation();

    const group = new THREE.Group();
    group.position.set(x, y, z);
    const sphere = new THREE.Mesh(this.dropGeo, this.dropMat);
    const ring = new THREE.Mesh(this.dropRingGeo, this.dropRingMat);
    ring.position.y = -0.45;
    const beam = new THREE.Mesh(this.dropBeamGeo, this.dropBeamMat);
    beam.position.y = -0.4;
    group.add(sphere, ring, beam);
    this.scene.add(group);

    this.waterDrops.push({ id: `drop_${this.nextDropId++}`, group, sphere, ring, baseY: y, life: DROP_LIFETIME, maxLife: DROP_LIFETIME });
  }

  removeDrop(i) {
    const drop = this.waterDrops[i];
    this.scene.remove(drop.group); // geometry & materials are shared — never dispose here
    this.waterDrops.splice(i, 1);
  }

  // ---------------------------------------------------------------------------
  // Abilities & damage
  // ---------------------------------------------------------------------------

  triggerLightPulse(origin, smogSystem, droneSystem) {
    if (this.pulseTimer > 0) {
      if (this.audio) this.audio.playDeniedSound();
      return false;
    }
    this.pulseTimer = PULSE_COOLDOWN;

    this.activePulse = { radius: 0.5, life: 1.0 };
    this.pulseMesh.position.set(origin.x, origin.y - 0.75, origin.z);
    this.pulseDisc.position.copy(this.pulseMesh.position);
    this.pulseMesh.visible = true;
    this.pulseDisc.visible = true;

    if (this.audio) this.audio.playLightPulse();
    if (smogSystem) smogSystem.clearRadius(origin.x, origin.z, PULSE_RADIUS, 5.0);

    let stunned = 0;
    if (droneSystem) {
      stunned = droneSystem.stunDrones(origin, PULSE_RADIUS + 3, STUN_DURATION);
      if (stunned > 0) {
        if (this.scoreManager) this.scoreManager.recordDronesStunned(stunned);
        showToast(stunned === 1 ? 'Drone stunned' : `${stunned} drones stunned`, 'good', 1600);
      }
    }
    return { stunned };
  }

  canAffordPlant() {
    return this.water >= SEED_COST;
  }

  consumeWaterForSeed() {
    if (this.water < SEED_COST) return false;
    this.water -= SEED_COST;
    return true;
  }

  notifyDeniedPlanting() {
    if (this.audio) this.audio.playDeniedSound();
    showToast('Not enough water — press T to find some', 'bad', 2000);
  }

  /** Discrete hit (drone laser). */
  applyHit(amount) {
    if (this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.timeSinceDamage = 0;
    if (this.scoreManager) this.scoreManager.breakCombo();
    if (this.damageFlashEl) {
      this.damageFlashEl.classList.remove('active');
      void this.damageFlashEl.offsetWidth;
      this.damageFlashEl.classList.add('active');
    }
    if (this.audio) this.audio.playPlayerHit();
    this.checkDeath();
  }

  /** Continuous damage over time (smog, acid). No flash; a soft thud at most every 0.7s. */
  applyDrain(amount) {
    if (this.health <= 0 || amount <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.timeSinceDamage = 0;
    if (this.drainSoundTimer <= 0) {
      this.drainSoundTimer = 0.7;
      if (this.audio) this.audio.playDrainTick();
    }
    this.checkDeath();
  }

  checkDeath() {
    if (this.health <= 0 && this.scoreManager) {
      this.scoreManager.triggerGameOver('health');
    }
  }

  isSheltered(pos) {
    for (const s of this.shelters) {
      if (pos.x > s.minX && pos.x < s.maxX && pos.z > s.minZ && pos.z < s.maxZ && s.minY > pos.y) {
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(delta, gameTime, robot, smogSystem, weather, vines) {
    const playerPos = robot.position;
    this.drainSoundTimer -= delta;

    // Health regeneration
    this.timeSinceDamage += delta;
    if (this.timeSinceDamage >= 5 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + delta * 5);
    }

    // Pulse cooldown & expanding ring
    if (this.pulseTimer > 0) this.pulseTimer = Math.max(0, this.pulseTimer - delta);
    if (this.activePulse) {
      const p = this.activePulse;
      p.radius = Math.min(PULSE_RADIUS, p.radius + delta * 30);
      p.life -= delta * 1.4;
      this.pulseMesh.scale.set(p.radius, 1, p.radius);
      this.pulseDisc.scale.set(p.radius, 1, p.radius);
      this.pulseMesh.material.opacity = Math.max(0, p.life);
      this.pulseDisc.material.opacity = Math.max(0, p.life * 0.25);
      if (p.life <= 0) {
        this.activePulse = null;
        this.pulseMesh.visible = false;
        this.pulseDisc.visible = false;
      }
    }

    // Water drops: keep the city stocked
    this.dropSpawnTimer -= delta;
    if (this.dropSpawnTimer <= 0 || this.waterDrops.length < 3) {
      this.dropSpawnTimer = 5 + Math.random() * 3;
      this.spawnWaterDrop();
    }

    for (let i = this.waterDrops.length - 1; i >= 0; i--) {
      const drop = this.waterDrops[i];
      drop.life -= delta;
      const g = drop.group.position;
      g.y = drop.baseY + Math.sin(gameTime * 3.5 + i) * 0.15;
      drop.ring.rotation.y += delta * 1.5;
      const fade = drop.life < 5 ? (Math.sin(gameTime * 18) > 0 ? 1 : 0.2) : 1;
      drop.sphere.visible = fade > 0.5;

      const dx = playerPos.x - g.x, dy = playerPos.y - g.y, dz = playerPos.z - g.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 5.0) {
        this._pullDir.set(dx, dy, dz).normalize();
        g.addScaledVector(this._pullDir, delta * 10.0);
        drop.baseY += this._pullDir.y * delta * 10.0;
      }

      if (dist < 1.7) {
        const before = this.water;
        this.water = Math.min(this.maxWater, this.water + 25);
        if (this.audio) this.audio.playWaterCollect();
        if (this.scoreManager) this.scoreManager.recordWaterCollected();
        if (this.water === this.maxWater && before + 25 > this.maxWater) showToast('Tank full', 'info', 1000);
        this.removeDrop(i);
      } else if (drop.life <= 0) {
        this.removeDrop(i);
      }
    }

    // Acid rain cycle
    this.acidStateTimer += delta;
    const fog = this.scene.fog;
    if (this.acidState === 'IDLE') {
      if (fog) fog.color.lerp(this._fogBase, Math.min(1, delta * 0.8));
      if (this.acidStateTimer >= this.acidInterval) {
        this.acidState = 'WARNING';
        this.acidStateTimer = 0;
        if (this.audio) this.audio.playAcidRainWarning();
        showToast('Acid rain incoming — get under a skyway or awning', 'warn', 5000);
      }
    } else if (this.acidState === 'WARNING') {
      if (fog) fog.color.lerp(this._fogAcid, Math.min(1, delta * 0.6));
      if (this.acidStateTimer >= 6) {
        this.acidState = 'ACTIVE';
        this.acidStateTimer = 0;
        if (weather) weather.setRainAcidic(true);
        if (this.audio) this.audio.startAcidRainSound();
      }
    } else if (this.acidState === 'ACTIVE') {
      this.sheltered = this.isSheltered(playerPos);
      if (!this.sheltered) this.applyDrain(6 * delta);
      if (this.plantSystem) {
        for (const v of vines) {
          if (v.growth < 0.85) this.plantSystem.damageVine(v, delta * 0.05);
        }
      }
      if (this.acidStateTimer >= 14) {
        this.acidState = 'IDLE';
        this.acidStateTimer = 0;
        this.acidInterval = 70 + Math.random() * 30;
        if (weather) weather.setRainAcidic(false);
        if (this.audio) this.audio.stopAcidRainSound();
        showToast('Acid rain has passed', 'info', 1800);
      }
    }

    // Smog exposure
    this.smogDensity = smogSystem ? smogSystem.getDensityAt(playerPos.x, playerPos.z) : 0;
    const inSmog = this.smogDensity > 0.22 && playerPos.y < 20;
    if (inSmog) {
      this.applyDrain(this.smogDensity * 7 * delta);
    }
    robot.moveSpeedMultiplier = inSmog ? 1 - Math.min(0.35, this.smogDensity * 0.4) : 1;
    this.inSmog = inSmog;

    if (smogSystem && this.plantSystem) {
      for (const v of vines) {
        if (!v.matured && smogSystem.getDensityAt(v.pos.x, v.pos.z) > 0.28) {
          this.plantSystem.damageVine(v, delta * 0.06);
        }
      }
    }

    if (this.audio) this.audio.setLowHealth(this.health > 0 && this.health < 25);
    this.updateHUD(robot);
  }

  /** True when planting now earns the risk bonus. */
  isRisky(spotData, smogSystem) {
    const smog = smogSystem ? smogSystem.getDensityAt(spotData.x, spotData.z) : 0;
    return smog > 0.22 || this.acidState === 'ACTIVE';
  }

  updateHUD(robot) {
    const h = this._hud;
    const health = Math.round(this.health);
    if (h.health !== health) {
      h.health = health;
      if (this.healthBar) this.healthBar.style.transform = `scaleX(${this.health / this.maxHealth})`;
      if (this.healthVal) this.healthVal.textContent = String(health);
      this.healthContainer?.classList.toggle('low', this.health < 30);
    }

    const water = Math.round(this.water);
    if (h.water !== water) {
      h.water = water;
      if (this.waterBar) this.waterBar.style.transform = `scaleX(${this.water / this.maxWater})`;
      if (this.waterVal) this.waterVal.textContent = String(water);
      this.waterContainer?.classList.toggle('low', this.water < SEED_COST);
      if (this.seedPips) {
        const seeds = Math.floor(this.water / SEED_COST);
        Array.from(this.seedPips.children).forEach((pip, i) => pip.classList.toggle('on', i < seeds));
      }
    }

    if (robot) {
      const hover = Math.round(robot.hoverEnergy);
      if (h.hover !== hover) {
        h.hover = hover;
        if (this.hoverBar) this.hoverBar.style.transform = `scaleX(${robot.hoverEnergy / robot.maxHoverEnergy})`;
      }
      const dashP = robot.dashCooldown > 0 ? 1 - robot.dashCooldownTimer / robot.dashCooldown : 1;
      const dashKey = Math.round(dashP * 40);
      if (h.dash !== dashKey) {
        h.dash = dashKey;
        if (this.dashRing) this.dashRing.style.strokeDashoffset = (113.1 * (1 - dashP)).toFixed(1);
        this.dashBtn?.classList.toggle('ready', dashP >= 1);
      }
    }

    const pulseP = 1 - this.pulseTimer / PULSE_COOLDOWN;
    const pulseKey = Math.round(pulseP * 60);
    if (h.pulse !== pulseKey) {
      h.pulse = pulseKey;
      if (this.pulseRing) this.pulseRing.style.strokeDashoffset = (113.1 * (1 - pulseP)).toFixed(1);
      this.pulseBtn?.classList.toggle('ready', pulseP >= 1);
      if (this.pulseCdText) this.pulseCdText.textContent = this.pulseTimer > 0 ? String(Math.ceil(this.pulseTimer)) : '';
    }

    const acidKey = this.acidState === 'ACTIVE' ? (this.sheltered ? 'safe' : 'exposed') : (this.acidState === 'WARNING' ? 'warn' : '');
    if (h.acid !== acidKey) {
      h.acid = acidKey;
      if (this.chipAcid) {
        this.chipAcid.hidden = !acidKey;
        this.chipAcid.textContent = acidKey === 'safe' ? 'Acid rain · Sheltered' : acidKey === 'exposed' ? 'Acid rain · Exposed!' : 'Acid rain incoming';
        this.chipAcid.classList.toggle('safe', acidKey === 'safe');
      }
      this.acidOverlayEl?.classList.toggle('active', acidKey === 'exposed');
    }

    const smogKey = this.inSmog ? Math.round(this.smogDensity * 10) : 0;
    if (h.smog !== smogKey) {
      h.smog = smogKey;
      if (this.chipSmog) this.chipSmog.hidden = !this.inSmog;
      if (this.smogOverlayEl) this.smogOverlayEl.style.opacity = this.inSmog ? (this.smogDensity * 0.65).toFixed(2) : '0';
    }
  }

  reset() {
    this.health = this.maxHealth;
    this.water = this.maxWater;
    this.timeSinceDamage = 0;
    this.drainSoundTimer = 0;
    this.pulseTimer = 0;
    this.acidState = 'IDLE';
    this.acidStateTimer = 0;
    this.acidInterval = 75;
    this.sheltered = false;
    this.inSmog = false;
    this.smogDensity = 0;
    this.dropSpawnTimer = 4;
    this.activePulse = null;
    if (this.pulseMesh) { this.pulseMesh.visible = false; this.pulseDisc.visible = false; }

    if (this.damageFlashEl) this.damageFlashEl.classList.remove('active');
    if (this.smogOverlayEl) this.smogOverlayEl.style.opacity = '0';
    if (this.acidOverlayEl) this.acidOverlayEl.classList.remove('active');
    if (this.scene.fog) this.scene.fog.color.copy(this._fogBase);

    for (let i = this.waterDrops.length - 1; i >= 0; i--) this.removeDrop(i);
    for (let i = 0; i < 6; i++) this.spawnWaterDrop();

    this._hud = {};
    this.updateHUD(null);
  }
}

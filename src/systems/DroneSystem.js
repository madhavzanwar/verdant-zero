import * as THREE from 'three';

/**
 * Purge Drone System
 * States:
 *   PATROL   drift between waypoints over the street; pick a vine to burn when one is grown enough
 *   BURN     hover over a vine and burn it with a continuous red beam (young vines ~14s, mature ~33s)
 *   ALERT    player seen within 14m: eye flashes, warning hum, 0.8s before engaging
 *   CHASE    keep ~8m from the player and fire telegraphed laser shots: a thin aim line locks onto
 *            where the player was, then fires 0.6s later. Moving or dashing out of the line dodges it.
 *   STUNNED  hit by the Light Pulse: blind, sinking and slowly spinning for 6s
 * Population: first drone at 0:45, one more every 90s (cap 5). Shared geometry/materials; pooled screen-edge indicators.
 */

const DETECT_RADIUS = 14;
const LOSE_RADIUS = 32;
const SHOT_DAMAGE = 12;
const SHOT_AIM_TIME = 0.6;
const SHOT_INTERVAL = 1.8;
const BURN_RATE_GROWING = 0.07;   // ~14s to kill a young vine
const BURN_RATE_MATURE = 0.03;    // ~33s to kill a mature vine (it also regenerates when left alone)
const RETREAT_TIME = 20;          // after destroying a vine a drone patrols before hunting again
const MAX_DRONES = 5;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class DroneSystem {
  constructor(scene, audioManager, colliders = []) {
    this.scene = scene;
    this.audio = audioManager;
    this.colliders = colliders;
    this.drones = [];
    this.nextId = 1;
    this.plantSystem = null;
    this.onPlayerHit = null;

    this.edgeArrowsContainer = document.getElementById('drone-indicators');
    this.chipDrone = document.getElementById('chip-drone');
    this.arrowPool = [];

    this.initSharedAssets();
    this.initSparks();
    this.reset();
  }

  setPlantSystem(ps) {
    this.plantSystem = ps;
  }

  initSharedAssets() {
    this.geo = {
      body: new THREE.CylinderGeometry(1.2, 1.3, 0.22, 16),
      ring: new THREE.TorusGeometry(1.35, 0.08, 8, 24).rotateX(Math.PI / 2),
      eye: new THREE.SphereGeometry(0.35, 16, 12),
      thruster: new THREE.CylinderGeometry(0.12, 0.05, 0.2, 8),
      cone: new THREE.CylinderGeometry(0.2, 3.5, 10, 16, 1, true).translate(0, -5, 0),
      beam: new THREE.CylinderGeometry(0.08, 0.08, 1, 8).translate(0, 0.5, 0)
    };
    this.mat = {
      body: new THREE.MeshStandardMaterial({ color: 0x221a22, metalness: 0.8, roughness: 0.3 }),
      ring: new THREE.MeshStandardMaterial({ color: 0xd92b2b, metalness: 0.9, roughness: 0.2, emissive: 0x330000 }),
      thruster: new THREE.MeshBasicMaterial({ color: 0xff6600 }),
      cone: new THREE.MeshBasicMaterial({ color: 0xff0033, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })
    };
  }

  initSparks() {
    this.sparkCount = 80;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.sparkCount * 3).fill(-999);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparkPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xff5500, size: 0.35, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.sparkPoints.frustumCulled = false;
    this.sparkData = Array.from({ length: this.sparkCount }, () => ({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
    this.sparkCursor = 0;
    this.scene.add(this.sparkPoints);
  }

  createDrone() {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.geo.body, this.mat.body));
    const ring = new THREE.Mesh(this.geo.ring, this.mat.ring);
    group.add(ring);

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0022 });
    const eye = new THREE.Mesh(this.geo.eye, eyeMat);
    eye.position.y = -0.12;
    group.add(eye);

    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const th = new THREE.Mesh(this.geo.thruster, this.mat.thruster);
      th.position.set(Math.cos(a), 0.12, Math.sin(a));
      group.add(th);
    }

    const cone = new THREE.Mesh(this.geo.cone, this.mat.cone);
    group.add(cone);

    // Beam is reused for both the vine-burning ray and the aim/shot line
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xff0033, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(this.geo.beam, beamMat);
    beam.visible = false;
    beam.frustumCulled = false;
    this.scene.add(beam);

    return {
      id: `drone_${this.nextId++}`,
      group, ring, eye, eyeMat, cone, beam, beamMat,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      patrolTarget: new THREE.Vector3(),
      aimPoint: new THREE.Vector3(),
      cruiseY: 16 + Math.random() * 8,
      state: 'PATROL',
      stateTimer: 0,
      shotTimer: 0,
      aiming: false,
      targetVine: null,
      stunTimer: 0,
      lostTimer: 0,
      retreatTimer: 0,
      phase: Math.random() * 10
    };
  }

  spawnDrone() {
    const d = this.createDrone();
    // Arrive from either end of the street canyon, high above the skyline
    const end = Math.random() < 0.5 ? -1 : 1;
    d.position.set((Math.random() - 0.5) * 30, 40, end * (110 + Math.random() * 25));
    this.pickPatrolTarget(d);
    d.group.position.copy(d.position);
    this.scene.add(d.group);
    this.drones.push(d);
  }

  pickPatrolTarget(d) {
    d.patrolTarget.set((Math.random() - 0.5) * 70, d.cruiseY, (Math.random() - 0.5) * 240);
  }

  /** Light pulse: stun every drone within radius. Returns how many were newly stunned. */
  stunDrones(origin, radius, duration) {
    let count = 0;
    for (const d of this.drones) {
      if (d.position.distanceTo(origin) <= radius) {
        if (d.state !== 'STUNNED') count++;
        this.setState(d, 'STUNNED');
        d.stunTimer = duration;
      }
    }
    return count;
  }

  setState(d, state) {
    d.state = state;
    d.stateTimer = 0;
    d.aiming = false;
    d.beam.visible = false;
    if (state !== 'BURN') d.targetVine = null;
  }

  targetDroneCount(gameTime) {
    if (gameTime < 45) return 0;
    return Math.min(MAX_DRONES, 1 + Math.floor((gameTime - 45) / 90));
  }

  update(delta, gameTime, vines, playerPos, playerState) {
    // Population: one drone every few seconds until the target count for this point in the run
    this.spawnTimer -= delta;
    if (this.drones.length < this.targetDroneCount(gameTime) && this.spawnTimer <= 0) {
      this.spawnTimer = 6;
      this.spawnDrone();
      if (this.audio) this.audio.playDroneAlert();
    }

    let engaged = 0;
    let nearestDist = Infinity;

    for (const d of this.drones) {
      d.stateTimer += delta;
      d.ring.rotation.y += delta * (d.state === 'STUNNED' ? 1.0 : 6.0);
      const distToPlayer = d.position.distanceTo(playerPos);
      const horizToPlayer = Math.hypot(d.position.x - playerPos.x, d.position.z - playerPos.z);
      nearestDist = Math.min(nearestDist, distToPlayer);

      switch (d.state) {
        case 'STUNNED': this.updateStunned(d, delta); break;
        case 'ALERT': this.updateAlert(d, delta, playerPos); break;
        case 'CHASE': this.updateChase(d, delta, playerPos, playerState, distToPlayer); engaged++; break;
        case 'BURN': this.updateBurn(d, delta, gameTime); break;
        default: this.updatePatrol(d, delta, vines);
      }

      // Detection (any non-stunned, non-engaged state)
      // Scanner reach is horizontal (drones cruise 15–25m up and look down)
      if ((d.state === 'PATROL' || d.state === 'BURN') && horizToPlayer < DETECT_RADIUS &&
          Math.abs(d.position.y - playerPos.y) < 28 && playerState.alive) {
        this.setState(d, 'ALERT');
        if (this.audio) this.audio.playDroneAlert();
      }

      this.avoidBuildings(d);

      // Visual position (bob), eye colour
      d.group.position.set(d.position.x, d.position.y + Math.sin(gameTime * 3 + d.phase) * 0.3, d.position.z);
      if (d.state === 'STUNNED') {
        d.eyeMat.color.setHex(0x3355ff);
      } else if (d.state === 'ALERT') {
        d.eyeMat.color.setHex(Math.sin(d.stateTimer * 40) > 0 ? 0xffffff : 0xff0022);
      } else {
        d.eyeMat.color.setHex(0xff0022);
      }
      d.cone.visible = d.state !== 'STUNNED';
    }

    this.updateSparks(delta);
    if (this.audio) this.audio.setDroneProximity(nearestDist, engaged > 0);
    if (this.chipDrone) {
      const hidden = engaged === 0;
      if (this.chipDrone.hidden !== hidden) this.chipDrone.hidden = hidden;
    }
  }

  moveTowards(d, target, speed, delta) {
    _v1.subVectors(target, d.position);
    const dist = _v1.length();
    if (dist > 0.01) {
      _v1.multiplyScalar(Math.min(dist, speed * delta) / dist);
      d.position.add(_v1);
      d.group.rotation.y = Math.atan2(_v1.x, _v1.z);
    }
    return dist;
  }

  updatePatrol(d, delta, vines) {
    d.beam.visible = false;
    if (d.retreatTimer > 0) {
      d.retreatTimer -= delta;
      if (this.moveTowards(d, d.patrolTarget, 7, delta) < 2) this.pickPatrolTarget(d);
      return;
    }
    // Pick the nearest vine worth burning
    let best = null, bestDist = 90;
    for (const v of vines) {
      if (v.growth < 0.3 || v.health <= 0) continue;
      if (this.drones.some(o => o !== d && o.targetVine === v)) continue;
      const dist = Math.hypot(v.pos.x - d.position.x, v.pos.z - d.position.z);
      if (dist < bestDist) { bestDist = dist; best = v; }
    }

    if (best) {
      _v2.set(best.pos.x, best.pos.y + 9, best.pos.z);
      if (this.moveTowards(d, _v2, 9, delta) < 1.5) {
        this.setState(d, 'BURN');
        d.targetVine = best;
      }
      d.targetVine = best;
      return;
    }

    if (this.moveTowards(d, d.patrolTarget, 7, delta) < 2) this.pickPatrolTarget(d);
  }

  updateBurn(d, delta) {
    const v = d.targetVine;
    if (!v || v.health <= 0 || !this.plantSystem || !this.plantSystem.activeVines.includes(v)) {
      const destroyed = !!v && (v.health <= 0 || !this.plantSystem?.activeVines.includes(v));
      this.setState(d, 'PATROL');
      if (destroyed) {
        d.retreatTimer = RETREAT_TIME;
        this.pickPatrolTarget(d);
      }
      return;
    }
    this.plantSystem.damageVine(v, (v.matured ? BURN_RATE_MATURE : BURN_RATE_GROWING) * delta);
    _v2.set(v.pos.x, v.pos.y + 1.2, v.pos.z);
    this.pointBeam(d, _v2, 0.9, 1);
    if (Math.random() < 0.5) this.emitSparks(_v2);
  }

  updateAlert(d, delta, playerPos) {
    d.group.rotation.y = Math.atan2(playerPos.x - d.position.x, playerPos.z - d.position.z);
    if (d.stateTimer >= 0.8) {
      this.setState(d, 'CHASE');
      d.shotTimer = 0.4;
    }
  }

  updateChase(d, delta, playerPos, playerState, distToPlayer) {
    // Hold an orbit ~8m away, 5m above the player
    _v1.subVectors(d.position, playerPos);
    _v1.y = 0;
    if (_v1.lengthSq() < 0.01) _v1.set(1, 0, 0);
    _v1.normalize().multiplyScalar(8);
    _v2.copy(playerPos).add(_v1);
    _v2.y = playerPos.y + 5;
    this.moveTowards(d, _v2, 11, delta);
    d.group.rotation.y = Math.atan2(playerPos.x - d.position.x, playerPos.z - d.position.z);

    if (distToPlayer > LOSE_RADIUS || !playerState.alive) {
      d.lostTimer += delta;
      if (d.lostTimer > 2.5) { d.lostTimer = 0; this.setState(d, 'PATROL'); }
      return;
    }
    d.lostTimer = 0;

    d.shotTimer -= delta;
    if (!d.aiming && d.shotTimer <= 0) {
      // Lock the aim slightly ahead of the player: running straight gets you hit, changing direction dodges
      d.aiming = true;
      d.aimTimer = SHOT_AIM_TIME;
      d.aimPoint.copy(playerPos);
      if (playerState.velocity) {
        d.aimPoint.x += playerState.velocity.x * SHOT_AIM_TIME * 0.7;
        d.aimPoint.z += playerState.velocity.z * SHOT_AIM_TIME * 0.7;
      }
      if (this.audio) this.audio.playLaserCharge();
    }

    if (d.aiming) {
      d.aimTimer -= delta;
      this.pointBeam(d, d.aimPoint, 0.25 + 0.25 * Math.sin(d.aimTimer * 60), 0.35, true);
      if (d.aimTimer <= 0) {
        d.aiming = false;
        d.shotTimer = SHOT_INTERVAL;
        this.pointBeam(d, d.aimPoint, 1, 2.2, true);
        d.flashTimer = 0.12;
        this.emitSparks(d.aimPoint);
        if (this.audio) this.audio.playLaserShot();
        // Hit if the player is still close to the locked aim point (dashing grants immunity)
        const missDist = Math.hypot(playerPos.x - d.aimPoint.x, playerPos.y - d.aimPoint.y, playerPos.z - d.aimPoint.z);
        if (missDist < 1.6 && !playerState.dashing && this.onPlayerHit) {
          this.onPlayerHit(SHOT_DAMAGE);
        }
      }
    } else if (d.flashTimer > 0) {
      d.flashTimer -= delta;
      if (d.flashTimer <= 0) d.beam.visible = false;
    } else {
      d.beam.visible = false;
    }
  }

  updateStunned(d, delta) {
    d.stunTimer -= delta;
    d.position.y = Math.max(8, d.position.y - delta * 2.5);
    d.group.rotation.y += delta * 1.5;
    if (d.stunTimer <= 0) {
      this.setState(d, 'PATROL');
      this.pickPatrolTarget(d);
    }
  }

  pointBeam(d, target, opacity, width, isShot = false) {
    _v1.set(d.position.x, d.position.y - 0.4, d.position.z);
    _v2.subVectors(target, _v1);
    const len = _v2.length();
    d.beam.position.copy(_v1);
    d.beam.scale.set(width, len, width);
    d.beam.quaternion.setFromUnitVectors(_up, _v2.normalize());
    d.beamMat.opacity = opacity;
    d.beamMat.color.setHex(isShot ? 0xff2244 : 0xff0033);
    d.beam.visible = true;
  }

  avoidBuildings(d) {
    for (const c of this.colliders) {
      if (d.position.x > c.minX - 1.5 && d.position.x < c.maxX + 1.5 &&
          d.position.z > c.minZ - 1.5 && d.position.z < c.maxZ + 1.5 &&
          d.position.y < c.height + 2.5 && d.position.y > (c.minY || 0) - 2) {
        d.position.y = c.height + 2.5;
      }
    }
  }

  emitSparks(pos) {
    for (let k = 0; k < 2; k++) {
      const s = this.sparkData[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % this.sparkCount;
      s.active = true;
      s.x = pos.x + (Math.random() - 0.5) * 0.5;
      s.y = pos.y + Math.random() * 0.5;
      s.z = pos.z + (Math.random() - 0.5) * 0.5;
      s.vx = (Math.random() - 0.5) * 4;
      s.vy = 2 + Math.random() * 3.5;
      s.vz = (Math.random() - 0.5) * 4;
      s.life = 0.5 + Math.random() * 0.3;
    }
  }

  updateSparks(delta) {
    const pos = this.sparkPoints.geometry.attributes.position.array;
    let any = false;
    for (let i = 0; i < this.sparkCount; i++) {
      const s = this.sparkData[i];
      if (!s.active) continue;
      any = true;
      s.vy -= 9.8 * delta;
      s.x += s.vx * delta; s.y += s.vy * delta; s.z += s.vz * delta;
      s.life -= delta;
      if (s.life <= 0 || s.y < 0) { s.active = false; pos[i * 3 + 1] = -999; continue; }
      pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
    }
    if (any || this._sparksWereActive) this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    this._sparksWereActive = any;
  }

  /** Screen-edge arrows for off-screen drones (pooled DOM nodes). */
  updateScreenIndicators(camera) {
    if (!this.edgeArrowsContainer || !camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    let used = 0;

    for (const d of this.drones) {
      _v1.copy(d.position).project(camera);
      const behind = _v1.z > 1;
      const off = behind || _v1.x < -0.9 || _v1.x > 0.9 || _v1.y < -0.9 || _v1.y > 0.9;
      if (!off) continue;

      let el = this.arrowPool[used];
      if (!el) {
        el = document.createElement('div');
        el.className = 'drone-edge-arrow';
        this.edgeArrowsContainer.appendChild(el);
        this.arrowPool.push(el);
      }
      used++;

      let x = (_v1.x * 0.5 + 0.5) * w;
      let y = (-_v1.y * 0.5 + 0.5) * h;
      if (behind) { x = w - x; y = h - y; }
      x = Math.max(28, Math.min(w - 28, x));
      y = Math.max(28, Math.min(h - 28, y));
      const angle = Math.atan2(y - h / 2, x - w / 2);
      el.style.display = 'block';
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle}rad)`;
      el.classList.toggle('engaged', d.state === 'CHASE' || d.state === 'ALERT');
    }
    for (let i = used; i < this.arrowPool.length; i++) this.arrowPool[i].style.display = 'none';
  }

  reset() {
    for (const d of this.drones) {
      this.scene.remove(d.group);
      this.scene.remove(d.beam);
      d.eyeMat.dispose();
      d.beamMat.dispose();
    }
    this.drones = [];
    this.spawnTimer = 0;
    this.arrowPool.forEach(el => { el.style.display = 'none'; });
    if (this.chipDrone) this.chipDrone.hidden = true;
    if (this.audio && this.audio.setDroneProximity) this.audio.setDroneProximity(Infinity, false);
  }
}

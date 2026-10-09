import * as THREE from 'three';
import { MAX_PLANT_WAVES } from '../world/BuildingShader.js';

/**
 * Plant & Procedural Vine Growth System
 * - Seed drop sequence: pooled particle burst + ground shockwave ring
 * - Procedural climbing vines (TubeGeometry along CatmullRom curves) that hug the nearest facade,
 *   or grow as a free-standing spiral where no wall is close (rooftops, plazas)
 * - Leaves and bio-flowers for every vine share two InstancedMeshes (2 draw calls total)
 * - Vine health: smog/acid hurt growing vines, drones burn any vine. Health regenerates when left
 *   alone; a vine that reaches 0 withers away and its planter reopens.
 * - Reclaimed % = summed growth of living vines / planter count, so 100% is always reachable.
 */

const LEAVES_PER_VINE = 14;
const FLOWERS_PER_VINE = 3;
const GROWTH_RATE = 0.2;          // ~5s from seed to mature vine
const HEALTH_REGEN_DELAY = 2.5;   // seconds without damage before a vine starts healing
const HEALTH_REGEN_RATE = 0.06;   // health per second

const VineShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uGrowth;
    uniform float uTime;
    uniform float uHealth;
    varying vec2 vUv;

    void main() {
      if (vUv.x > uGrowth) discard;

      vec3 barkColor = vec3(0.08, 0.26, 0.12);
      float sap = smoothstep(0.42, 0.58, sin(vUv.y * 3.14159));
      float pulse = 0.5 + 0.5 * sin(vUv.x * 24.0 - uTime * 4.0);
      vec3 sapColor = vec3(0.0, 1.0, 0.55) * (sap * pulse * 1.5);

      vec3 healthy = barkColor + sapColor;
      vec3 withered = vec3(0.22, 0.2, 0.16) + vec3(0.6, 0.35, 0.0) * sap * pulse * 0.6;
      gl_FragColor = vec4(mix(withered, healthy, uHealth), 1.0);
    }
  `
};

export class PlantSystem {
  constructor(scene, cityGenerator, audioManager, scoreManager = null) {
    this.scene = scene;
    this.city = cityGenerator;
    this.audio = audioManager;
    this.scoreManager = scoreManager;
    this.survival = null;

    this.activeVines = [];
    this.totalSpots = Math.max(1, this.city.spotMeshes ? this.city.spotMeshes.length : 1);
    this.reclaimedPercentage = 0.0;
    this.plantedCount = 0;
    this.maturedCount = 0;

    // Callbacks wired by the app
    this.onVineLost = null;

    this.promptEl = document.getElementById('plant-prompt');
    this.promptTextEl = document.getElementById('plant-prompt-text');
    this._promptState = '';

    this._tmpV = new THREE.Vector3();
    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
    this._leafBase = new THREE.Color(0x00ff88);
    this._leafDead = new THREE.Color(0x6b5a3a);
    this._flowerColors = [new THREE.Color(0x00f0ff), new THREE.Color(0xff3388), new THREE.Color(0x00ffaa)];

    this.initInstancedFoliage();
    this.initBursts();
    this.initFireflies();
  }

  setScoreManager(sm) {
    this.scoreManager = sm;
  }

  setSurvivalManager(survival) {
    this.survival = survival;
  }

  // ---------------------------------------------------------------------------
  // Pools
  // ---------------------------------------------------------------------------

  initInstancedFoliage() {
    const maxVines = this.totalSpots;
    const leafGeo = new THREE.PlaneGeometry(0.45, 0.65);
    const leafMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
    this.leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, maxVines * LEAVES_PER_VINE);

    const flowerGeo = new THREE.IcosahedronGeometry(0.3, 1);
    const flowerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, maxVines * FLOWERS_PER_VINE);

    const zero = this._dummy;
    zero.scale.set(0, 0, 0);
    zero.updateMatrix();
    for (let i = 0; i < this.leafMesh.count; i++) {
      this.leafMesh.setMatrixAt(i, zero.matrix);
      this.leafMesh.setColorAt(i, this._leafBase);
    }
    for (let i = 0; i < this.flowerMesh.count; i++) {
      this.flowerMesh.setMatrixAt(i, zero.matrix);
      this.flowerMesh.setColorAt(i, this._flowerColors[i % 3]);
    }
    zero.scale.set(1, 1, 1);

    // Instances are scattered across the whole city; skip bounding-sphere culling.
    this.leafMesh.frustumCulled = false;
    this.flowerMesh.frustumCulled = false;
    this.scene.add(this.leafMesh);
    this.scene.add(this.flowerMesh);

    // Each planter index owns a fixed block of instances; only draw up to the highest slot in use
    this.updateInstanceCounts();
  }

  updateInstanceCounts() {
    let maxSlot = 0;
    for (const v of this.activeVines) maxSlot = Math.max(maxSlot, v.spotMesh.index + 1);
    this.leafMesh.count = maxSlot * LEAVES_PER_VINE;
    this.flowerMesh.count = maxSlot * FLOWERS_PER_VINE;
  }

  initBursts() {
    // One pooled points cloud for planting bursts (3 simultaneous bursts x 60 particles)
    this.burstCount = 180;
    const geo = new THREE.BufferGeometry();
    this.burstPositions = new Float32Array(this.burstCount * 3).fill(-999);
    geo.setAttribute('position', new THREE.BufferAttribute(this.burstPositions, 3));
    this.burstPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x00ffaa, size: 0.35, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.burstPoints.frustumCulled = false;
    this.burstData = Array.from({ length: this.burstCount }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
    this.burstCursor = 0;
    this.scene.add(this.burstPoints);

    // Pooled shockwave rings
    this.shockGeo = new THREE.RingGeometry(0.2, 0.6, 32).rotateX(-Math.PI / 2);
    this.shockwaves = [];
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(this.shockGeo, new THREE.MeshBasicMaterial({
        color: 0x00ff88, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false
      }));
      mesh.visible = false;
      this.scene.add(mesh);
      this.shockwaves.push({ mesh, scale: 1, opacity: 0 });
    }
  }

  initFireflies() {
    const fCount = 120;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(fCount * 3).fill(-999);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    this.fireflyPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x00ffaa, size: 0.35, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.fireflyPoints.frustumCulled = false;
    this.fireflyData = Array.from({ length: fCount }, () => ({ active: false, x: 0, y: 0, z: 0, vy: 0, life: 0 }));
    this.scene.add(this.fireflyPoints);
  }

  // ---------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------

  /**
   * Returns the unplanted spot within planting range (3.5m horizontal, similar height), or null.
   * Also drives the context prompt.
   */
  checkProximity(playerPos, showPrompt = true) {
    let nearSpot = null;
    const spots = this.city.spotMeshes;
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      if (sp.isPlanted) continue;
      const d = sp.data;
      const dy = playerPos.y - d.y;
      if (dy < -0.5 || dy > 2.6) continue;
      if (Math.hypot(playerPos.x - d.x, playerPos.z - d.z) <= 3.5) {
        nearSpot = sp;
        break;
      }
    }

    if (showPrompt) {
      let state = '';
      if (nearSpot) {
        state = (!this.survival || this.survival.canAffordPlant()) ? 'plant' : 'water';
      }
      this.setPrompt(state);
    }
    return nearSpot;
  }

  setPrompt(state) {
    if (!this.promptEl || state === this._promptState) return;
    this._promptState = state;
    if (!state) {
      this.promptEl.classList.remove('visible', 'denied');
      return;
    }
    this.promptEl.classList.add('visible');
    this.promptEl.classList.toggle('denied', state === 'water');
    if (this.promptTextEl) {
      this.promptTextEl.textContent = state === 'plant' ? 'Plant seed' : 'Need 25 water';
    }
  }

  plant(spotMesh, isRisky = false) {
    if (spotMesh.isPlanted) return null;
    spotMesh.isPlanted = true;
    spotMesh.isWithering = false;
    this.setPrompt('');

    const d = spotMesh.data;
    const pos = new THREE.Vector3(d.x, d.y, d.z);

    this.spawnBurst(pos);
    this.spawnShockwave(pos);
    if (this.audio) this.audio.playPlantingChime();
    this.spawnVine(pos, spotMesh, isRisky);
    this.triggerBuildingWave(pos, spotMesh.index);
    this.plantedCount++;

    return this.scoreManager ? this.scoreManager.recordPlanting(isRisky) : null;
  }

  // ---------------------------------------------------------------------------
  // Vine construction
  // ---------------------------------------------------------------------------

  buildVineCurve(pos) {
    // Find the nearest facade (ignore thin platforms/awnings) within 12m at this height
    let bestDist = 144;
    let normalX = 0, normalZ = 0, anchorX = pos.x, anchorZ = pos.z, wallTop = 0;
    let found = false;

    for (const c of this.city.buildingColliders) {
      if (c.isPlatform || c.height < pos.y + 6) continue;
      const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
      const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
      const distSq = (pos.x - cx) ** 2 + (pos.z - cz) ** 2;
      if (distSq < bestDist) {
        bestDist = distSq;
        found = true;
        wallTop = c.height;
        const dMinX = Math.abs(pos.x - c.minX), dMaxX = Math.abs(pos.x - c.maxX);
        const dMinZ = Math.abs(pos.z - c.minZ), dMaxZ = Math.abs(pos.z - c.maxZ);
        const minF = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);
        anchorX = pos.x; anchorZ = pos.z;
        if (minF === dMinX) { normalX = -1; normalZ = 0; anchorX = c.minX - 0.2; }
        else if (minF === dMaxX) { normalX = 1; normalZ = 0; anchorX = c.maxX + 0.2; }
        else if (minF === dMinZ) { normalX = 0; normalZ = -1; anchorZ = c.minZ - 0.2; }
        else { normalX = 0; normalZ = 1; anchorZ = c.maxZ + 0.2; }
      }
    }

    const pts = [new THREE.Vector3(pos.x, pos.y + 0.1, pos.z)];
    if (found) {
      // Climb the facade flush with the wall
      const tanX = -normalZ, tanZ = normalX;
      const height = Math.min(30, wallTop - pos.y - 1);
      const offsets = [0.8, -0.6, 0.9, -0.4, 0.5];
      offsets.forEach((o, i) => {
        const t = (i + 1) / offsets.length;
        pts.push(new THREE.Vector3(anchorX + tanX * o, pos.y + 1.0 + t * height, anchorZ + tanZ * o));
      });
    } else {
      // Free-standing spiral sapling (rooftops / open plazas)
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const a = t * Math.PI * 3.0;
        const r = 0.9 * (1 - t * 0.5);
        pts.push(new THREE.Vector3(pos.x + Math.cos(a) * r, pos.y + t * 9.0, pos.z + Math.sin(a) * r));
      }
    }
    return new THREE.CatmullRomCurve3(pts);
  }

  spawnVine(pos, spotMesh, isRisky) {
    const curve = this.buildVineCurve(pos);
    const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.24, 8, false);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uGrowth: { value: 0 }, uTime: { value: 0 }, uHealth: { value: 1 } },
      vertexShader: VineShader.vertexShader,
      fragmentShader: VineShader.fragmentShader,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(tubeGeo, mat);
    this.scene.add(mesh);

    const slot = spotMesh.index;
    const leaves = [];
    for (let i = 0; i < LEAVES_PER_VINE; i++) {
      const t = (i + 1) / (LEAVES_PER_VINE + 1);
      const p = curve.getPoint(t);
      leaves.push({
        index: slot * LEAVES_PER_VINE + i, t,
        x: p.x + (Math.random() - 0.5) * 0.4, y: p.y, z: p.z + (Math.random() - 0.5) * 0.4,
        rot: Math.random() * Math.PI * 2, open: 0
      });
    }
    const flowers = [0.35, 0.65, 0.95].map((t, i) => {
      const p = curve.getPoint(t);
      return { index: slot * FLOWERS_PER_VINE + i, t, x: p.x, y: p.y, z: p.z, open: 0 };
    });

    this.activeVines.push({
      mesh, mat, curve, leaves, flowers, pos, spotMesh,
      growth: 0, health: 1, matured: false, isInsideSmog: isRisky,
      lastDamageTime: 0, damageAccum: 0
    });
    this.updateInstanceCounts();
  }

  /** Called by smog / acid rain / drones. */
  damageVine(vine, amount) {
    if (!vine || vine.health <= 0) return;
    vine.health = Math.max(0, vine.health - amount);
    vine.lastDamageTime = 0;
  }

  triggerBuildingWave(pos, slot) {
    const uniforms = this.city.buildingMaterial?.userData.uniforms;
    if (!uniforms || slot >= MAX_PLANT_WAVES) return;
    uniforms.uPlantSpots.value[slot].copy(pos);
    uniforms.uPlantRadii.value[slot] = 0.1;
    uniforms.uPlantCount.value = Math.max(uniforms.uPlantCount.value, slot + 1);
  }

  clearBuildingWave(slot) {
    const uniforms = this.city.buildingMaterial?.userData.uniforms;
    if (!uniforms || slot >= MAX_PLANT_WAVES) return;
    uniforms.uPlantRadii.value[slot] = 0;
    uniforms.uPlantSpots.value[slot].set(0, -999, 0);
  }

  destroyVine(vine) {
    const idx = this.activeVines.indexOf(vine);
    if (idx !== -1) this.activeVines.splice(idx, 1);

    this.scene.remove(vine.mesh);
    vine.mesh.geometry.dispose();
    vine.mat.dispose();

    const d = this._dummy;
    d.scale.set(0, 0, 0);
    d.updateMatrix();
    vine.leaves.forEach(l => this.leafMesh.setMatrixAt(l.index, d.matrix));
    vine.flowers.forEach(f => this.flowerMesh.setMatrixAt(f.index, d.matrix));
    d.scale.set(1, 1, 1);
    d.rotation.set(0, 0, 0);
    this.leafMesh.instanceMatrix.needsUpdate = true;
    this.flowerMesh.instanceMatrix.needsUpdate = true;

    if (vine.spotMesh) {
      vine.spotMesh.isPlanted = false;
      vine.spotMesh.isWithering = false;
      this.clearBuildingWave(vine.spotMesh.index);
    }
    if (vine.matured) this.maturedCount = Math.max(0, this.maturedCount - 1);
    this.updateInstanceCounts();
    this.plantedCount = Math.max(0, this.plantedCount - 1);
  }

  reset() {
    while (this.activeVines.length > 0) {
      this.destroyVine(this.activeVines[0]);
    }
    this.city.spotMeshes.forEach(sp => { sp.isPlanted = false; sp.isWithering = false; });

    const uniforms = this.city.buildingMaterial?.userData.uniforms;
    if (uniforms) {
      uniforms.uPlantCount.value = 0;
      for (let i = 0; i < MAX_PLANT_WAVES; i++) {
        uniforms.uPlantRadii.value[i] = 0;
        uniforms.uPlantSpots.value[i].set(0, -999, 0);
      }
    }

    this.burstData.forEach(p => { p.life = 0; });
    this.burstPositions.fill(-999);
    this.burstPoints.geometry.attributes.position.needsUpdate = true;
    this.shockwaves.forEach(s => { s.mesh.visible = false; s.opacity = 0; });
    this.fireflyData.forEach(f => { f.active = false; });

    this.plantedCount = 0;
    this.maturedCount = 0;
    this.reclaimedPercentage = 0;
    this.setPrompt('');
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  update(delta, time) {
    const d = this._dummy;
    let leavesDirty = false;
    let flowersDirty = false;
    let totalGrowth = 0;

    for (let i = this.activeVines.length - 1; i >= 0; i--) {
      const v = this.activeVines[i];

      // Health: regenerate when left alone, wither away at zero
      v.lastDamageTime += delta;
      if (v.lastDamageTime > HEALTH_REGEN_DELAY && v.health < 1) {
        v.health = Math.min(1, v.health + HEALTH_REGEN_RATE * delta);
      }
      if (v.health <= 0) {
        const name = v.spotMesh?.data.type;
        this.destroyVine(v);
        if (this.scoreManager) this.scoreManager.recordVineDestroyed();
        if (this.onVineLost) this.onVineLost(name);
        continue;
      }
      if (v.spotMesh) v.spotMesh.isWithering = v.health < 0.6;
      v.mat.uniforms.uHealth.value = v.health;
      v.mat.uniforms.uTime.value = time;

      if (v.growth < 1) {
        v.growth = Math.min(1, v.growth + delta * GROWTH_RATE);
        v.mat.uniforms.uGrowth.value = v.growth;
        if (Math.random() < 0.2) this.emitSpore(v.pos);

        if (v.growth >= 1 && !v.matured) {
          v.matured = true;
          this.maturedCount++;
          if (this.scoreManager) this.scoreManager.recordVineMatured();
        }
      }
      totalGrowth += v.growth;

      // Leaves unfurl as growth passes them; tint toward brown when unhealthy
      for (let k = 0; k < v.leaves.length; k++) {
        const leaf = v.leaves[k];
        const target = v.growth >= leaf.t ? 1 : 0;
        if (leaf.open < target) {
          leaf.open = Math.min(1, leaf.open + delta * 4);
          d.position.set(leaf.x, leaf.y, leaf.z);
          d.rotation.set(0, leaf.rot, 0.4);
          d.scale.setScalar(Math.max(0.001, leaf.open));
          d.updateMatrix();
          this.leafMesh.setMatrixAt(leaf.index, d.matrix);
          leavesDirty = true;
        }
      }
      if (v.health < 1 || v._lastTint !== v.health) {
        this._color.copy(this._leafDead).lerp(this._leafBase, v.health);
        for (let k = 0; k < v.leaves.length; k++) this.leafMesh.setColorAt(v.leaves[k].index, this._color);
        this.leafMesh.instanceColor.needsUpdate = true;
        v._lastTint = v.health;
      }

      // Flowers open, then breathe
      for (let k = 0; k < v.flowers.length; k++) {
        const fl = v.flowers[k];
        if (v.growth >= fl.t) {
          fl.open = Math.min(1, fl.open + delta * 3);
          const s = fl.open * (1.0 + 0.18 * Math.sin(time * 3.5 + k)) * (0.4 + 0.6 * v.health);
          d.position.set(fl.x, fl.y, fl.z);
          d.rotation.set(0, 0, 0);
          d.scale.setScalar(Math.max(0.001, s));
          d.updateMatrix();
          this.flowerMesh.setMatrixAt(fl.index, d.matrix);
          flowersDirty = true;
        }
      }
    }
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    if (leavesDirty) this.leafMesh.instanceMatrix.needsUpdate = true;
    if (flowersDirty) this.flowerMesh.instanceMatrix.needsUpdate = true;

    this.reclaimedPercentage = Math.min(100, (totalGrowth / this.totalSpots) * 100);
    if (this.scoreManager) this.scoreManager.checkReclaimedMilestones(this.reclaimedPercentage, this.maturedCount, this.totalSpots);

    // Expand the living green wave in the building shader
    const uniforms = this.city.buildingMaterial?.userData.uniforms;
    if (uniforms) {
      for (let i = 0; i < uniforms.uPlantCount.value; i++) {
        const r = uniforms.uPlantRadii.value[i];
        if (r > 0 && r < 34) uniforms.uPlantRadii.value[i] = r + delta * 7.5;
      }
    }

    this.updateParticles(delta, time);
  }

  updateParticles(delta, time) {
    // Bursts
    let anyBurst = false;
    const bp = this.burstPositions;
    for (let i = 0; i < this.burstCount; i++) {
      const p = this.burstData[i];
      if (p.life <= 0) continue;
      anyBurst = true;
      p.life -= delta;
      p.vy -= 8.0 * delta;
      p.x += p.vx * delta; p.y += p.vy * delta; p.z += p.vz * delta;
      bp[i * 3] = p.x; bp[i * 3 + 1] = p.life > 0 ? p.y : -999; bp[i * 3 + 2] = p.z;
    }
    if (anyBurst || this._burstWasActive) this.burstPoints.geometry.attributes.position.needsUpdate = true;
    this._burstWasActive = anyBurst;

    // Shockwaves
    for (const sw of this.shockwaves) {
      if (!sw.mesh.visible) continue;
      sw.scale += delta * 12.0;
      sw.opacity -= delta * 1.5;
      sw.mesh.scale.set(sw.scale, 1, sw.scale);
      sw.mesh.material.opacity = Math.max(0, sw.opacity);
      if (sw.opacity <= 0) sw.mesh.visible = false;
    }

    // Fireflies / spores
    const pos = this.fireflyPoints.geometry.attributes.position.array;
    let anyFly = false;
    for (let i = 0; i < this.fireflyData.length; i++) {
      const f = this.fireflyData[i];
      if (!f.active) continue;
      anyFly = true;
      f.y += f.vy * delta;
      f.x += Math.sin(time * 2.0 + i) * 0.02;
      f.z += Math.cos(time * 2.0 + i) * 0.02;
      f.life -= delta * 0.3;
      pos[i * 3] = f.x; pos[i * 3 + 1] = f.y; pos[i * 3 + 2] = f.z;
      if (f.life <= 0) { f.active = false; pos[i * 3 + 1] = -999; }
    }
    if (anyFly || this._flyWasActive) this.fireflyPoints.geometry.attributes.position.needsUpdate = true;
    this._flyWasActive = anyFly;
  }

  spawnBurst(pos) {
    for (let i = 0; i < 60; i++) {
      const p = this.burstData[this.burstCursor];
      this.burstCursor = (this.burstCursor + 1) % this.burstCount;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 4.0;
      p.x = pos.x; p.y = pos.y + 0.2; p.z = pos.z;
      p.vx = Math.cos(angle) * speed; p.vy = 2.0 + Math.random() * 5.0; p.vz = Math.sin(angle) * speed;
      p.life = 0.8;
    }
  }

  spawnShockwave(pos) {
    const sw = this.shockwaves.find(s => !s.mesh.visible) || this.shockwaves[0];
    sw.mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    sw.scale = 1; sw.opacity = 0.9;
    sw.mesh.scale.set(1, 1, 1);
    sw.mesh.visible = true;
  }

  emitSpore(origin) {
    const f = this.fireflyData.find(ff => !ff.active);
    if (!f) return;
    f.active = true;
    f.x = origin.x + (Math.random() - 0.5) * 1.5;
    f.y = origin.y + 1.0 + Math.random() * 4.0;
    f.z = origin.z + (Math.random() - 0.5) * 1.5;
    f.vy = 0.8 + Math.random() * 1.2;
    f.life = 1.0;
  }
}

import * as THREE from 'three';

/**
 * Plant & Procedural Vine Growth System
 * - Seed drop sequence: particle burst, ground shockwave ring
 * - Procedural climbing vines (TubeGeometry along CatmullRom curves)
 * - Real-time shader growth extension without popping
 * - Instanced leaves that unfurl one-by-one
 * - Glowing bio-flowers in cyan, pink, and emerald that open and emit light
 * - Upward drifting fireflies & spores
 * - Propagates world-space green wave reveal into building shader
 */

const VineShader = {
  uniforms: {
    uGrowth: { value: 0.0 },
    uTime: { value: 0.0 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uGrowth;
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vNormal;

    void main() {
      // Smooth real-time growth reveal
      if (vUv.x > uGrowth) discard;

      // Base vine bark color
      vec3 barkColor = vec3(0.08, 0.26, 0.12);

      // Glowing bioluminescent sap vein flowing through trunk
      float sap = smoothstep(0.42, 0.58, sin(vUv.y * 3.14159));
      float pulse = 0.5 + 0.5 * sin(vUv.x * 24.0 - uTime * 4.0);
      vec3 sapColor = vec3(0.0, 1.0, 0.55) * (sap * pulse * 1.5);

      vec3 finalColor = barkColor + sapColor;
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `
};

export class PlantSystem {
  constructor(scene, cityGenerator, audioManager, scoreManager = null) {
    this.scene = scene;
    this.city = cityGenerator;
    this.audio = audioManager;
    this.scoreManager = scoreManager;

    this.activeVines = [];
    this.burstParticles = [];
    this.shockwaves = [];
    this.fireflies = [];

    this.reclaimedEl = document.getElementById('reclaimed-val');
    this.reclaimedCounterEl = document.getElementById('reclaimed-counter');
    this.promptEl = document.getElementById('plant-prompt');

    this.reclaimedPercentage = 0.0;
    if (this.reclaimedEl) {
      this.reclaimedEl.textContent = '0.0%';
    }

    this.plantedCount = 0;
    this.totalSpots = this.city.spotMeshes ? Math.max(1, this.city.spotMeshes.length) : 6;

    this.initFireflies();
  }

  setScoreManager(sm) {
    this.scoreManager = sm;
  }

  initFireflies() {
    const fCount = 120;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(fCount * 3);

    for (let i = 0; i < fCount * 3; i++) {
      pos[i] = -999;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x00ffaa,
      size: 0.35,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.fireflyPoints = new THREE.Points(geo, mat);
    this.fireflyData = Array.from({ length: fCount }, () => ({
      active: false,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0
    }));

    this.scene.add(this.fireflyPoints);
  }

  /**
   * Check proximity to planting spots
   */
  checkProximity(playerPos) {
    const titleEl = document.getElementById('title-screen');
    const isTitleActive = titleEl && !titleEl.classList.contains('hidden');

    let nearSpot = null;
    for (let sp of this.city.spotMeshes) {
      if (!sp.isPlanted) {
        const dist = playerPos.distanceTo(new THREE.Vector3(sp.data.x, sp.data.y, sp.data.z));
        if (dist < 4.2) {
          nearSpot = sp;
          break;
        }
      }
    }

    if (nearSpot && !isTitleActive) {
      if (this.promptEl) this.promptEl.classList.add('visible');
      return nearSpot;
    } else {
      if (this.promptEl) this.promptEl.classList.remove('visible');
      return isTitleActive ? null : nearSpot;
    }
  }

  /**
   * Trigger planting sequence
   */
  plant(spotMesh, isInsideSmog = false) {
    if (spotMesh.isPlanted) return;
    spotMesh.isPlanted = true;

    // Turn spot ring bright solid green
    spotMesh.mesh.material.opacity = 1.0;
    spotMesh.mesh.material.color.setHex(0x00ff88);

    const pos = new THREE.Vector3(spotMesh.data.x, spotMesh.data.y, spotMesh.data.z);

    // 1. Particle burst
    this.spawnBurst(pos);

    // 2. Shockwave ring
    this.spawnShockwave(pos);

    // 3. Audio cue: ascending chime & warm swelling pad
    if (this.audio) {
      this.audio.playPlantingChime();
    }

    // 4. Procedural Vine Growth
    this.spawnClimbingVine(pos, spotMesh, isInsideSmog);

    // 5. World-Space Green Wave into Building Shader
    this.triggerBuildingWave(pos);

    // 6. Update Reclaimed Counter & Score
    this.plantedCount++;
    if (this.reclaimedCounterEl) {
      this.reclaimedCounterEl.classList.add('active');
    }

    if (this.scoreManager) {
      this.scoreManager.recordPlanting(isInsideSmog);
    }
  }

  spawnBurst(pos) {
    const count = 60;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    const particles = [];
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y + 0.2;
      positions[i * 3 + 2] = pos.z;

      const angle = Math.random() * Math.PI * 2;
      const speed = 2.0 + Math.random() * 4.0;
      particles.push({
        x: pos.x, y: pos.y + 0.2, z: pos.z,
        vx: Math.cos(angle) * speed,
        vy: 2.0 + Math.random() * 5.0,
        vz: Math.sin(angle) * speed,
        life: 1.0
      });
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x00ffaa,
      size: 0.35,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });

    const mesh = new THREE.Points(geo, mat);
    this.scene.add(mesh);
    this.burstParticles.push({ mesh, particles, age: 0 });
  }

  spawnShockwave(pos) {
    const geo = new THREE.RingGeometry(0.2, 0.6, 32);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    this.scene.add(mesh);

    this.shockwaves.push({ mesh, scale: 1.0, maxScale: 8.5, opacity: 0.9 });
  }

  spawnClimbingVine(pos, spotMesh = null, isInsideSmog = false) {
    // Determine closest building collider to anchor climbing vine along its real face
    let bestDist = Infinity;
    let normalX = 0;
    let normalZ = 0;
    let anchorX = pos.x;
    let anchorZ = pos.z;

    if (this.city && this.city.buildingColliders) {
      for (let c of this.city.buildingColliders) {
        const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
        const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
        const distSq = (pos.x - cx) ** 2 + (pos.z - cz) ** 2;
        if (distSq < bestDist && distSq < 140) {
          bestDist = distSq;
          const dMinX = Math.abs(pos.x - c.minX);
          const dMaxX = Math.abs(pos.x - c.maxX);
          const dMinZ = Math.abs(pos.z - c.minZ);
          const dMaxZ = Math.abs(pos.z - c.maxZ);
          const minF = Math.min(dMinX, dMaxX, dMinZ, dMaxZ);
          if (minF === dMinX) { normalX = -1; normalZ = 0; anchorX = c.minX - 0.2; }
          else if (minF === dMaxX) { normalX = 1; normalZ = 0; anchorX = c.maxX + 0.2; }
          else if (minF === dMinZ) { normalX = 0; normalZ = -1; anchorZ = c.minZ - 0.2; }
          else { normalX = 0; normalZ = 1; anchorZ = c.maxZ + 0.2; }
        }
      }
    }

    const tanX = -normalZ;
    const tanZ = normalX;

    // Generate curved path climbing up the building facade flush with its wall
    const curvePoints = [
      new THREE.Vector3(pos.x, pos.y, pos.z),
      new THREE.Vector3(anchorX + tanX * 0.8, pos.y + 4.5, anchorZ + tanZ * 0.8),
      new THREE.Vector3(anchorX - tanX * 0.6, pos.y + 10.5, anchorZ - tanZ * 0.6),
      new THREE.Vector3(anchorX + tanX * 0.9, pos.y + 17.0, anchorZ + tanZ * 0.9),
      new THREE.Vector3(anchorX - tanX * 0.4, pos.y + 23.5, anchorZ - tanZ * 0.4),
      new THREE.Vector3(anchorX + tanX * 0.5, pos.y + 30.0, anchorZ + tanZ * 0.5)
    ];

    const curve = new THREE.CatmullRomCurve3(curvePoints);
    const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.24, 8, false);

    const vineMat = new THREE.ShaderMaterial({
      uniforms: {
        uGrowth: { value: 0.0 },
        uTime: { value: 0.0 }
      },
      vertexShader: VineShader.vertexShader,
      fragmentShader: VineShader.fragmentShader,
      side: THREE.DoubleSide
    });

    const vineMesh = new THREE.Mesh(tubeGeo, vineMat);
    this.scene.add(vineMesh);

    // Leaves attached along vine
    const leafGeo = new THREE.PlaneGeometry(0.45, 0.65);
    const leafMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9
    });

    const leaves = [];
    for (let i = 1; i <= 14; i++) {
      const t = i / 15;
      const point = curve.getPoint(t);

      const leaf = new THREE.Mesh(leafGeo, leafMat.clone());
      leaf.position.copy(point);
      leaf.position.x += tanX * (Math.random() - 0.5) * 0.4;
      leaf.position.z += tanZ * (Math.random() - 0.5) * 0.4;
      leaf.scale.set(0.001, 0.001, 0.001); // starts unfurled at 0
      this.scene.add(leaf);

      leaves.push({ mesh: leaf, targetT: t, isUnfurled: false });
    }

    // Glowing Bio-Flowers (Cyan, Pink, Emerald)
    const flowerColors = [0x00f0ff, 0xff3388, 0x00ffaa];
    const flowerGeo = new THREE.SphereGeometry(0.3, 12, 12);
    const flowers = [];

    [0.35, 0.65, 0.95].forEach((t, idx) => {
      const point = curve.getPoint(t);
      const flowerMat = new THREE.MeshBasicMaterial({
        color: flowerColors[idx]
      });

      const flower = new THREE.Mesh(flowerGeo, flowerMat);
      flower.position.copy(point);
      flower.scale.set(0.001, 0.001, 0.001);
      this.scene.add(flower);

      flowers.push({ mesh: flower, targetT: t, opened: false });
    });

    this.activeVines.push({
      mesh: vineMesh,
      mat: vineMat,
      growth: 0.0,
      health: 1.0,
      curve,
      leaves,
      flowers,
      pos,
      spotMesh,
      isInsideSmog,
      matured: false
    });
  }

  triggerBuildingWave(pos) {
    if (!this.city || !this.city.buildingMaterial) return;
    const uniforms = this.city.buildingMaterial.userData.uniforms;
    if (!uniforms) return;

    const idx = uniforms.uPlantCount.value;
    if (idx < 8) {
      uniforms.uPlantSpots.value[idx].copy(pos);
      uniforms.uPlantRadii.value[idx] = 0.1;
      uniforms.uPlantCount.value = idx + 1;
    }
  }

  destroyVine(vine) {
    const idx = this.activeVines.indexOf(vine);
    if (idx !== -1) {
      this.activeVines.splice(idx, 1);
    }

    if (vine.mesh) {
      this.scene.remove(vine.mesh);
      vine.mesh.geometry?.dispose();
      vine.mesh.material?.dispose();
    }
    if (vine.leaves) {
      vine.leaves.forEach(l => {
        if (l.mesh) {
          this.scene.remove(l.mesh);
          l.mesh.geometry?.dispose();
          l.mesh.material?.dispose();
        }
      });
    }
    if (vine.flowers) {
      vine.flowers.forEach(f => {
        if (f.mesh) {
          this.scene.remove(f.mesh);
          f.mesh.geometry?.dispose();
          f.mesh.material?.dispose();
        }
      });
    }

    // Reset spot mesh
    if (vine.spotMesh) {
      vine.spotMesh.isPlanted = false;
      if (vine.spotMesh.mesh && vine.spotMesh.mesh.material) {
        vine.spotMesh.mesh.material.opacity = 0.7;
        vine.spotMesh.mesh.material.color.setHex(0x00ff88);
      }
    }
  }

  reset() {
    // 1. Remove all active vines
    while (this.activeVines.length > 0) {
      this.destroyVine(this.activeVines[0]);
    }

    // 2. Reset all spot meshes
    if (this.city && this.city.spotMeshes) {
      this.city.spotMeshes.forEach(sp => {
        sp.isPlanted = false;
        if (sp.mesh && sp.mesh.material) {
          sp.mesh.material.opacity = 0.7;
          sp.mesh.material.color.setHex(0x00ff88);
        }
      });
    }

    // 3. Clear bursts and shockwaves
    this.burstParticles.forEach(b => { if (b.mesh) this.scene.remove(b.mesh); });
    this.burstParticles = [];

    this.shockwaves.forEach(s => { if (s.mesh) this.scene.remove(s.mesh); });
    this.shockwaves = [];

    // 4. Reset building wave uniforms
    if (this.city && this.city.buildingMaterial) {
      const uniforms = this.city.buildingMaterial.userData.uniforms;
      if (uniforms) {
        uniforms.uPlantCount.value = 0;
        for (let i = 0; i < 8; i++) {
          uniforms.uPlantRadii.value[i] = 0.0;
          uniforms.uPlantSpots.value[i].set(0, -999, 0);
        }
      }
    }

    this.plantedCount = 0;
    this.reclaimedPercentage = 0.0;
    if (this.reclaimedEl) {
      this.reclaimedEl.textContent = '0.0%';
    }
    if (this.reclaimedCounterEl) {
      this.reclaimedCounterEl.classList.remove('active');
    }
  }

  update(delta, time) {
    // 1. Animate Procedural Vine Growth & Check Smog Damage
    for (let i = this.activeVines.length - 1; i >= 0; i--) {
      const v = this.activeVines[i];

      // Smog zone seeds take damage until the vine matures, unless protected by a nearby healthy vine
      if (v.isInsideSmog && !v.matured) {
        const isProtected = this.activeVines.some(other =>
          other !== v && other.matured && (other.health || 1.0) > 0.5 && other.pos.distanceTo(v.pos) < 22.0
        );

        if (!isProtected) {
          v.health = Math.max(0, (v.health || 1.0) - delta * 0.12);
          if (v.health <= 0) {
            this.destroyVine(v);
            if (this.scoreManager) {
              this.scoreManager.recordVineDestroyed();
            }
            continue;
          }
        }
      }

      if (v.growth < 1.0) {
        v.growth += delta * 0.28; // Grows smoothly over ~3.5 seconds
        v.growth = Math.min(v.growth, 1.0);
        v.mat.uniforms.uGrowth.value = v.growth;
        v.mat.uniforms.uTime.value = time;

        // Unfurl leaves
        v.leaves.forEach(leaf => {
          if (v.growth >= leaf.targetT && !leaf.isUnfurled) {
            leaf.mesh.scale.set(1, 1, 1);
            leaf.isUnfurled = true;
          }
        });

        // Open flowers
        v.flowers.forEach(fl => {
          if (v.growth >= fl.targetT && !fl.opened) {
            fl.mesh.scale.set(1, 1, 1);
            fl.opened = true;
          }
        });

        // Vine Maturity Achievement
        if (v.growth >= 1.0 && !v.matured) {
          v.matured = true;
          const percentageContribution = 100.0 / (this.totalSpots || 6);
          if (this.scoreManager) {
            this.scoreManager.recordVineMatured(percentageContribution);
          }
        }

        // Spawn drifting spores from healthy vines
        if (Math.random() < 0.2) {
          this.emitSpore(v.pos);
        }
      }

      // Flower pulsing emission & soft breathing
      v.flowers.forEach(fl => {
        if (fl.opened) {
          const flowerPulse = 1.0 + 0.18 * Math.sin(time * 3.5);
          fl.mesh.scale.set(flowerPulse, flowerPulse, flowerPulse);
        }
      });
    }

    // Real vine coverage percentage calculation
    let totalCoverage = 0.0;
    this.activeVines.forEach(v => {
      const health = v.health !== undefined ? v.health : 1.0;
      totalCoverage += (v.growth || 0.0) * health;
    });

    const targetTotal = this.totalSpots || 6;
    this.reclaimedPercentage = Math.min(100.0, (totalCoverage / targetTotal) * 100.0);

    if (this.reclaimedEl) {
      this.reclaimedEl.textContent = `${this.reclaimedPercentage.toFixed(1)}%`;
    }

    if (this.scoreManager) {
      this.scoreManager.checkReclaimedMilestones(this.reclaimedPercentage);
    }

    // 2. Expand Living Green Wave Radii in Building Shader
    if (this.city && this.city.buildingMaterial) {
      const uniforms = this.city.buildingMaterial.userData.uniforms;
      if (uniforms) {
        for (let i = 0; i < uniforms.uPlantCount.value; i++) {
          if (uniforms.uPlantRadii.value[i] < 34.0) {
            uniforms.uPlantRadii.value[i] += delta * 7.5; // Expands outward smoothly
          }
        }
      }
    }

    // 3. Animate Burst Particles
    for (let i = this.burstParticles.length - 1; i >= 0; i--) {
      const b = this.burstParticles[i];
      b.age += delta;
      const positions = b.mesh.geometry.attributes.position.array;

      b.particles.forEach((p, idx) => {
        p.vy -= 8.0 * delta; // gravity
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.z += p.vz * delta;

        positions[idx * 3] = p.x;
        positions[idx * 3 + 1] = p.y;
        positions[idx * 3 + 2] = p.z;
      });

      b.mesh.geometry.attributes.position.needsUpdate = true;
      b.mesh.material.opacity = Math.max(0, 1.0 - b.age * 1.4);

      if (b.age >= 0.8) {
        this.scene.remove(b.mesh);
        this.burstParticles.splice(i, 1);
      }
    }

    // 4. Animate Shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.scale += delta * 12.0;
      sw.opacity -= delta * 1.5;

      sw.mesh.scale.set(sw.scale, sw.scale, 1);
      sw.mesh.material.opacity = Math.max(0, sw.opacity);

      if (sw.opacity <= 0) {
        this.scene.remove(sw.mesh);
        this.shockwaves.splice(i, 1);
      }
    }

    // 5. Animate Fireflies / Spores
    if (this.fireflyPoints) {
      const pos = this.fireflyPoints.geometry.attributes.position.array;

      this.fireflyData.forEach((f, i) => {
        if (f.active) {
          f.y += f.vy * delta;
          f.x += Math.sin(time * 2.0 + i) * 0.02;
          f.z += Math.cos(time * 2.0 + i) * 0.02;
          f.life -= delta * 0.3;

          pos[i * 3] = f.x;
          pos[i * 3 + 1] = f.y;
          pos[i * 3 + 2] = f.z;

          if (f.life <= 0) {
            f.active = false;
            pos[i * 3 + 1] = -999;
          }
        }
      });

      this.fireflyPoints.geometry.attributes.position.needsUpdate = true;
    }
  }

  emitSpore(origin) {
    const idleIdx = this.fireflyData.findIndex(f => !f.active);
    if (idleIdx !== -1) {
      const f = this.fireflyData[idleIdx];
      f.active = true;
      f.x = origin.x + (Math.random() - 0.5) * 1.5;
      f.y = origin.y + 1.0 + Math.random() * 4.0;
      f.z = origin.z + (Math.random() - 0.5) * 1.5;
      f.vy = 0.8 + Math.random() * 1.2;
      f.life = 1.0;
    }
  }
}

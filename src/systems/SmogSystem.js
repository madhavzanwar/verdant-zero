import * as THREE from 'three';

/**
 * Smog Rot Simulation System
 * - 64x64 cellular grid simulating toxic smog spreading inward from edges & pockets
 * - Rendered as thick purple-green toxic clouds & low moving ground mist
 * - Mature healthy vines push smog back within 15 units
 * - Light pulse pushes smog away within 12 units
 * - Standing in smog drains player health, causes robot eye flicker, and triggers faint purple screen haze
 * - Touching a vine drains vine health, withers leaves, turns vine gray, and drops reclaimed %
 */

export class SmogSystem {
  constructor(scene, cityColliders = []) {
    this.scene = scene;
    this.colliders = cityColliders;

    // 64x64 Grid
    this.gridSize = 64;
    this.worldSize = 320; // -160 to +160 in X and Z
    this.cellSize = this.worldSize / this.gridSize;
    this.grid = new Float32Array(this.gridSize * this.gridSize);
    this.nextGrid = new Float32Array(this.gridSize * this.gridSize);

    // Spread speed ramp (5% faster per minute)
    this.baseSpreadRate = 0.08;
    this.spreadRate = 0.08;
    this.simTimer = 0;
    this.simSlice = 0;
    this.dummy = new THREE.Object3D();

    // Temporary pulse clear zones
    this.clearZones = [];

    // Initialize edge smog & random pockets
    this.initGrid();

    // Rendered visual elements (moving cloud particles & ground mist)
    this.initVisuals();
  }

  initGrid() {
    for (let gz = 0; gz < this.gridSize; gz++) {
      for (let gx = 0; gx < this.gridSize; gx++) {
        const idx = gz * this.gridSize + gx;
        // Edge cells start full of smog
        const isEdge = (gx < 5 || gx >= this.gridSize - 5 || gz < 5 || gz >= this.gridSize - 5);
        if (isEdge) {
          this.grid[idx] = 0.85 + Math.random() * 0.15;
        } else {
          // A few random pocket clusters
          const distToCenter = Math.hypot(gx - 32, gz - 32);
          if (distToCenter > 18 && Math.random() < 0.035) {
            this.grid[idx] = 0.65;
          } else {
            this.grid[idx] = 0.0;
          }
        }
      }
    }
  }

  initVisuals() {
    // 1. Soft layered toxic cloud sprites (Instanced Billboard Quads)
    this.cloudCount = 70;
    this.activeCloudCount = 70;
    const cloudGeo = new THREE.PlaneGeometry(16, 16);

    // Soft radial gradient canvas for fluffy smog clouds
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    grad.addColorStop(0, 'rgba(120, 35, 130, 0.7)');
    grad.addColorStop(0.45, 'rgba(40, 95, 55, 0.45)');
    grad.addColorStop(1, 'rgba(20, 50, 30, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const cloudTex = new THREE.CanvasTexture(canvas);
    const cloudMat = new THREE.MeshBasicMaterial({
      map: cloudTex,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide
    });

    this.cloudMesh = new THREE.InstancedMesh(cloudGeo, cloudMat, this.cloudCount);
    this.cloudData = [];

    const dummy = this.dummy;

    for (let i = 0; i < this.cloudCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 35 + Math.random() * 115;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const y = 2.0 + Math.random() * 14.0;
      const scale = 0.9 + Math.random() * 1.2;

      this.cloudData.push({
        x, y, z,
        baseY: y,
        scale,
        rot: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.4
      });

      dummy.position.set(x, y, z);
      dummy.scale.set(scale, scale, 1);
      dummy.rotation.z = Math.random() * Math.PI * 2;
      dummy.updateMatrix();
      this.cloudMesh.setMatrixAt(i, dummy.matrix);
    }

    this.cloudMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.cloudMesh);

    // 2. Low Ground Mist Plane
    const mistGeo = new THREE.PlaneGeometry(360, 360);
    const mistMat = new THREE.MeshBasicMaterial({
      color: 0x481855,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.groundMist = new THREE.Mesh(mistGeo, mistMat);
    this.groundMist.rotation.x = -Math.PI / 2;
    this.groundMist.position.y = 0.4;
    this.scene.add(this.groundMist);
  }

  worldToGrid(x, z) {
    const gx = Math.floor((x + this.worldSize / 2) / this.cellSize);
    const gz = Math.floor((z + this.worldSize / 2) / this.cellSize);
    return {
      gx: Math.max(0, Math.min(this.gridSize - 1, gx)),
      gz: Math.max(0, Math.min(this.gridSize - 1, gz))
    };
  }

  getDensityAt(x, z) {
    const { gx, gz } = this.worldToGrid(x, z);
    return this.grid[gz * this.gridSize + gx];
  }

  getDensity(x, z) {
    return this.getDensityAt(x, z);
  }

  clearRadius(x, z, radius, duration = 4.0) {
    this.clearZones.push({ x, z, radius, timeLeft: duration });
  }

  update(delta, gameTime, vines = [], playerPos) {

    // Difficulty ramp: smog spreads 5% faster each minute
    const minutes = gameTime / 60.0;
    this.spreadRate = this.baseSpreadRate * Math.pow(1.05, minutes);

    // Update Clear Zones (Light Pulse)
    for (let i = this.clearZones.length - 1; i >= 0; i--) {
      const cz = this.clearZones[i];
      cz.timeLeft -= delta;
      // Hold the cleared area open for the zone's duration
      this.suppressSmogAt(cz.x, cz.z, cz.radius, Math.min(1, delta * 20));
      if (cz.timeLeft <= 0) {
        this.clearZones.splice(i, 1);
      }
    }

    // Mature healthy vines push smog back within 15 units
    // Throttled with the simulation step below so the effect is frame-rate independent
    this.vineTimer = (this.vineTimer || 0) + delta;
    if (this.vineTimer > 0.1) {
      this.vineTimer = 0;
      for (const v of vines) {
        if (v.growth >= 0.85 && v.health > 0.2) this.suppressSmogAt(v.pos.x, v.pos.z, 15.0, 0.6);
      }
    }

    // Run cellular automata diffusion every 0.10 seconds, sliced across 2 half-frames
    this.simTimer += delta;
    if (this.simTimer > 0.10) {
      this.simTimer = 0;
      this.stepSimulationSlice();
    }

    // Animate Visual Cloud Sprites (reusing persistent this.dummy)
    const dummy = this.dummy;
    const count = this.activeCloudCount || this.cloudCount;

    for (let i = 0; i < count; i++) {
      const c = this.cloudData[i];
      // Drift with slow toxic wind
      c.x += Math.sin(gameTime * 0.1 + i) * delta * 1.5;
      c.z += Math.cos(gameTime * 0.08 + i) * delta * 1.2;
      c.y = c.baseY + Math.sin(gameTime * 0.8 + i) * 0.5;
      c.rot += delta * 0.05 * c.speed;

      // Wrap boundaries
      if (c.x > 150) c.x = -150;
      if (c.x < -150) c.x = 150;
      if (c.z > 150) c.z = -150;
      if (c.z < -150) c.z = 150;

      // Match density from grid
      const density = this.getDensityAt(c.x, c.z);
      const activeScale = c.scale * (0.4 + density * 0.9);

      dummy.position.set(c.x, c.y, c.z);
      dummy.scale.set(activeScale, activeScale, 1);
      dummy.rotation.z = c.rot;
      dummy.updateMatrix();
      this.cloudMesh.setMatrixAt(i, dummy.matrix);
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true;

    // Check player smog exposure
    const playerSmog = playerPos ? this.getDensityAt(playerPos.x, playerPos.z) : 0;
    return { playerSmog };
  }

  setQuality(tier) {
    if (tier === 'low') {
      this.activeCloudCount = 35;
    } else {
      this.activeCloudCount = 70;
    }
    if (this.cloudMesh) {
      this.cloudMesh.count = this.activeCloudCount;
    }
  }

  suppressSmogAt(worldX, worldZ, radius, factor) {
    const { gx: centerGx, gz: centerGz } = this.worldToGrid(worldX, worldZ);
    const cellRadius = Math.ceil(radius / this.cellSize);

    for (let dz = -cellRadius; dz <= cellRadius; dz++) {
      for (let dx = -cellRadius; dx <= cellRadius; dx++) {
        const gx = centerGx + dx;
        const gz = centerGz + dz;
        if (gx >= 0 && gx < this.gridSize && gz >= 0 && gz < this.gridSize) {
          const dist = Math.hypot(dx * this.cellSize, dz * this.cellSize);
          if (dist <= radius) {
            const idx = gz * this.gridSize + gx;
            this.grid[idx] *= (1.0 - factor);
          }
        }
      }
    }
  }

  stepSimulationSlice() {
    const half = Math.floor(this.gridSize / 2);
    const startZ = this.simSlice === 0 ? 0 : half;
    const endZ = this.simSlice === 0 ? half : this.gridSize;
    this.simSlice = (this.simSlice + 1) % 2;

    // 4-neighbor diffusion & growth for current vertical slice
    for (let gz = startZ; gz < endZ; gz++) {
      for (let gx = 0; gx < this.gridSize; gx++) {
        const idx = gz * this.gridSize + gx;
        const current = this.grid[idx];

        // Edges continuously regenerate toxic smog
        const isEdge = (gx < 4 || gx >= this.gridSize - 4 || gz < 4 || gz >= this.gridSize - 4);
        if (isEdge) {
          this.nextGrid[idx] = Math.min(1.0, current + 0.05);
          continue;
        }

        // Neighbors average with boundary safety
        const up = gz > 0 ? this.grid[(gz - 1) * this.gridSize + gx] : current;
        const down = gz < this.gridSize - 1 ? this.grid[(gz + 1) * this.gridSize + gx] : current;
        const left = gx > 0 ? this.grid[gz * this.gridSize + (gx - 1)] : current;
        const right = gx < this.gridSize - 1 ? this.grid[gz * this.gridSize + (gx + 1)] : current;

        const neighborAvg = (up + down + left + right) * 0.25;
        let nextVal = current + (neighborAvg - current) * this.spreadRate;
        if (nextVal > 0.05) {
          nextVal += 0.006 * this.spreadRate;
        }

        this.nextGrid[idx] = Math.max(0.0, Math.min(1.0, nextVal));
      }
    }

    // When full pass completes, swap buffers
    if (this.simSlice === 0) {
      const temp = this.grid;
      this.grid = this.nextGrid;
      this.nextGrid = temp;
    }
  }

  reset() {
    this.spreadRate = this.baseSpreadRate;
    this.simTimer = 0;
    this.clearZones = [];
    this.initGrid();
  }
}

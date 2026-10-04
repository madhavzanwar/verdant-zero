import * as THREE from 'three';

/**
 * Survival & Player Mechanics Manager
 * - Health system (100 HP, slow regeneration after 5s without damage, red hit flash)
 * - Water resource system (0-100 water, 20 per seed, 6 glowing blue droplets spawned, magnetic pull, blue arrow indicator)
 * - Light pulse ability (Q / Right Click, 5s cooldown, expanding ring, pushes smog 12m, distracts drones 25m)
 * - Acid rain event cycle (every 60-90s, 5s warning, 15s duration, sickly yellow-green sky/rain, upward raycast cover detection)
 */

export class SurvivalManager {
  constructor(scene, colliders, audioManager, scoreManager = null) {
    this.scene = scene;
    this.colliders = colliders;
    this.audio = audioManager;
    this.scoreManager = scoreManager;

    // 1. Health State
    this.maxHealth = 100;
    this.health = 100;
    this.timeSinceDamage = 0;

    // 2. Water Resource State
    this.maxWater = 100;
    this.water = 100; // Starts full
    this.seedCost = 20;

    // Droplets pool
    this.waterDrops = [];
    this.dropSpawnTimer = 0;
    this.maxDrops = 6;
    this.initWaterDropMesh();

    // 3. Light Pulse Ability State
    this.pulseCooldown = 5.0;
    this.pulseTimer = 0.0;
    this.initPulseVisual();

    // 4. Acid Rain Cycle State
    this.acidRainInterval = 75.0; // every ~75 seconds
    this.acidRainTimer = 0.0;
    this.acidWarningDuration = 5.0;
    this.acidEventDuration = 15.0;
    this.acidState = 'IDLE'; // 'IDLE' | 'WARNING' | 'ACTIVE'
    this.acidStateTimer = 0.0;

    // Raycaster for upward overhang protection
    this.raycaster = new THREE.Raycaster();
    this.upVector = new THREE.Vector3(0, 1, 0);
    this._pullDir = new THREE.Vector3();

    // 5. HUD DOM References
    this.healthBar = document.getElementById('health-bar-fill');
    this.waterBar = document.getElementById('water-bar-fill');
    this.pulseRing = document.getElementById('pulse-cooldown-circle');
    this.damageFlashEl = document.getElementById('damage-flash');
    this.smogOverlayEl = document.getElementById('smog-overlay');
    this.acidWarningEl = document.getElementById('acid-warning');
    this.waterArrowEl = document.getElementById('water-indicator-arrow');

    // Spawn initial water droplets
    for (let i = 0; i < 4; i++) {
      this.spawnWaterDrop();
    }
  }

  initPulseVisual() {
    const ringGeo = new THREE.RingGeometry(0.5, 1.2, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.pulseMesh = new THREE.Mesh(ringGeo, ringMat);
    this.pulseMesh.rotation.x = -Math.PI / 2;
    this.pulseMesh.position.y = 0.1;
    this.scene.add(this.pulseMesh);
    this.activePulseAnim = null;
  }

  initWaterDropMesh() {
    this.dropGeo = new THREE.SphereGeometry(0.35, 16, 16);
    this.dropMat = new THREE.MeshStandardMaterial({
      color: 0x00d0ff,
      roughness: 0.1,
      metalness: 0.9,
      emissive: 0x0077ff,
      emissiveIntensity: 0.8
    });

    this.dropRingGeo = new THREE.RingGeometry(0.5, 0.65, 24);
    this.dropRingMat = new THREE.MeshBasicMaterial({
      color: 0x00e0ff,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
  }

  spawnWaterDrop() {
    if (this.waterDrops.length >= this.maxDrops) return;

    // Pick location on street or rooftop
    const isRooftop = Math.random() < 0.45;
    let x, y, z;

    if (isRooftop && this.colliders.length > 0) {
      const b = this.colliders[Math.floor(Math.random() * Math.min(25, this.colliders.length))];
      x = (b.minX + b.maxX) / 2 + (Math.random() - 0.5) * 4;
      z = (b.minZ + b.maxZ) / 2 + (Math.random() - 0.5) * 4;
      y = b.height + 0.6;
    } else {
      x = (Math.random() - 0.5) * 60;
      z = (Math.random() - 0.5) * 120;
      y = 0.6;
    }

    const group = new THREE.Group();
    group.position.set(x, y, z);

    const sphere = new THREE.Mesh(this.dropGeo, this.dropMat);
    group.add(sphere);

    const ring = new THREE.Mesh(this.dropRingGeo, this.dropRingMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.4;
    group.add(ring);

    this.scene.add(group);
    this.waterDrops.push({
      group,
      sphere,
      ring,
      baseY: y,
      pos: new THREE.Vector3(x, y, z)
    });
  }

  triggerLightPulse(origin, smogSystem, droneSystem) {
    if (this.pulseTimer > 0) return false;

    this.pulseTimer = this.pulseCooldown;

    // 1. Expanding Visual Wave
    this.activePulseAnim = {
      origin: origin.clone(),
      radius: 0.5,
      maxRadius: 13.0,
      life: 0.6
    };
    this.pulseMesh.position.copy(origin);
    this.pulseMesh.position.y = Math.max(0.1, origin.y - 0.5);

    // 2. Play Audio Cue
    if (this.audio) {
      this.audio.playLightPulse();
    }

    // 3. Clear Smog within 12 units
    if (smogSystem) {
      smogSystem.clearRadius(origin.x, origin.z, 12.0, 4.5);
    }

    // 4. Distract Drones within 25 units
    let distracted = 0;
    if (droneSystem) {
      distracted = droneSystem.distractDrones(origin, 25.0, 3.0);
      if (distracted > 0 && this.scoreManager) {
        this.scoreManager.recordDroneEvaded(distracted);
      }
    }

    return { success: true, distractedDrones: distracted };
  }

  canAffordPlant() {
    return this.water >= this.seedCost;
  }

  consumeWaterForSeed() {
    if (this.water >= this.seedCost) {
      this.water -= this.seedCost;
      this.updateHUD();
      return true;
    }
    return false;
  }

  notifyDeniedPlanting(robot) {
    if (this.audio) {
      this.audio.playDeniedSound();
    }
    // Shake robot eye
    if (robot) {
      robot.eyeMesh.position.x += (Math.random() - 0.5) * 0.15;
    }
  }

  applyDamage(amount) {
    this.health = Math.max(0, this.health - amount);
    this.timeSinceDamage = 0;

    if (this.scoreManager) {
      this.scoreManager.onPlayerDamage();
    }

    // Red edge flash
    if (this.damageFlashEl) {
      this.damageFlashEl.classList.remove('active');
      void this.damageFlashEl.offsetWidth; // trigger reflow
      this.damageFlashEl.classList.add('active');
    }

    if (this.audio) {
      this.audio.playPlayerHit();
    }

    this.updateHUD();

    if (this.health <= 0 && this.scoreManager) {
      this.scoreManager.triggerGameOver('Exhaustion', false);
    }
  }

  checkUnderCover(playerPos) {
    // Upward raycast against building bounding boxes
    for (let c of this.colliders) {
      const withinX = playerPos.x >= c.minX && playerPos.x <= c.maxX;
      const withinZ = playerPos.z >= c.minZ && playerPos.z <= c.maxZ;
      if (withinX && withinZ && c.height > playerPos.y + 0.5) {
        return true; // Sheltered under roof/building overhang
      }
    }
    return false;
  }

  update(delta, gameTime, robot, smogSystem, droneSystem, weather, vines = [], camera) {
    const playerPos = robot.position;

    // 1. Health Regeneration (slowly regenerates after 5s without damage)
    this.timeSinceDamage += delta;
    if (this.timeSinceDamage >= 5.0 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + delta * 6.5);
    }

    // 2. Pulse Cooldown Timer
    if (this.pulseTimer > 0) {
      this.pulseTimer = Math.max(0, this.pulseTimer - delta);
    }

    // Animate Pulse Wave
    if (this.activePulseAnim) {
      this.activePulseAnim.radius += delta * 24.0;
      this.activePulseAnim.life -= delta * 1.6;

      const scale = this.activePulseAnim.radius;
      this.pulseMesh.scale.set(scale, scale, 1);
      this.pulseMesh.material.opacity = Math.max(0, this.activePulseAnim.life);

      if (this.activePulseAnim.life <= 0) {
        this.activePulseAnim = null;
        this.pulseMesh.material.opacity = 0;
      }
    }

    // 3. Water Droplet Spawning & Magnetic Collection
    this.dropSpawnTimer += delta;
    const nextSpawnInterval = 8.0 + Math.random() * 4.0; // 8-12 seconds
    if (this.dropSpawnTimer > nextSpawnInterval) {
      this.dropSpawnTimer = 0;
      this.spawnWaterDrop();
    }

    // Water collection & magnetic pull
    for (let i = this.waterDrops.length - 1; i >= 0; i--) {
      const drop = this.waterDrops[i];
      // Floating animation
      drop.group.position.y = drop.baseY + Math.sin(gameTime * 3.5 + i) * 0.15;
      drop.ring.rotation.z += delta * 1.5;

      const dist = drop.group.position.distanceTo(playerPos);

      // Gentle magnetic pull
      if (dist < 6.0) {
        this._pullDir.subVectors(playerPos, drop.group.position).normalize();
        drop.group.position.addScaledVector(this._pullDir, delta * 9.0);
      }

      // Collect when close
      if (dist < 1.6) {
        this.water = Math.min(this.maxWater, this.water + 25);
        if (this.audio) {
          this.audio.playWaterCollect();
        }
        if (this.scoreManager) {
          this.scoreManager.recordWaterCollected();
        }
        this.scene.remove(drop.group);
        drop.group.traverse(child => {
          if (child.isMesh) {
            child.geometry?.dispose();
            child.material?.dispose();
          }
        });
        this.waterDrops.splice(i, 1);
      }
    }

    // 4. Acid Rain Cycle
    this.acidRainTimer += delta;
    if (this.acidState === 'IDLE') {
      if (this.acidRainTimer >= this.acidRainInterval) {
        this.acidState = 'WARNING';
        this.acidStateTimer = 0;
        if (this.acidWarningEl) this.acidWarningEl.classList.add('visible');
        if (this.audio) this.audio.playAcidRainWarning();
      }
    } else if (this.acidState === 'WARNING') {
      this.acidStateTimer += delta;
      // Telegraph: sky color shifts towards sickly yellow-green
      if (this.scene && this.scene.fog) {
        this.scene.fog.color.lerp(new THREE.Color(0x384a14), delta * 0.8);
      }
      if (this.acidStateTimer >= this.acidWarningDuration) {
        this.acidState = 'ACTIVE';
        this.acidStateTimer = 0;
        if (this.acidWarningEl) this.acidWarningEl.classList.remove('visible');
        if (weather) weather.setRainAcidic(true);
        if (this.audio) this.audio.startAcidRainSound();
      }
    } else if (this.acidState === 'ACTIVE') {
      this.acidStateTimer += delta;

      // Damage player if exposed to acid rain
      const isSheltered = this.checkUnderCover(playerPos);
      if (!isSheltered) {
        this.applyDamage(9.0 * delta);
      }

      // Damage young vines not fully grown
      vines.forEach(v => {
        if (v.growth < 0.85) {
          v.health = Math.max(0, (v.health !== undefined ? v.health : 1.0) - delta * 0.12);
        }
      });

      if (this.acidStateTimer >= this.acidEventDuration) {
        this.acidState = 'IDLE';
        this.acidRainTimer = 0;
        if (weather) weather.setRainAcidic(false);
        if (this.audio) this.audio.stopAcidRainSound();
        if (this.scene && this.scene.fog) {
          this.scene.fog.color.setHex(0x2a1650);
        }
      }
    }

    // 5. Update Smog Effects on Player & Vines
    if (smogSystem) {
      const smogDensity = smogSystem.getDensityAt(playerPos.x, playerPos.z);
      if (smogDensity > 0.22) {
        // Drain player health in smog
        this.applyDamage(smogDensity * 6.5 * delta);
        // Robot eye flickers in smog
        if (robot && Math.random() < 0.3) {
          robot.irisMat.color.setHex(0x1a8844);
        }
        if (this.smogOverlayEl) {
          this.smogOverlayEl.style.opacity = (smogDensity * 0.65).toFixed(2);
        }
      } else {
        if (this.smogOverlayEl) {
          this.smogOverlayEl.style.opacity = '0';
        }
      }

      // Smog drains vine health
      vines.forEach(v => {
        const vSmog = smogSystem.getDensityAt(v.pos.x, v.pos.z);
        if (vSmog > 0.28) {
          v.health = Math.max(0, (v.health !== undefined ? v.health : 1.0) - delta * 0.08);
          // Withering effect: turn leaves gray
          if (v.leaves) {
            v.leaves.forEach(leaf => {
              leaf.mesh.material.color.lerp(new THREE.Color(0x556055), delta * 0.5);
            });
          }
        }
      });
    }

    // 6. Update Water Drop Directional Arrow
    this.updateWaterIndicator(playerPos, camera);

    // 7. Update HUD Bars & Pulse Ring
    this.updateHUD();

    return {
      isDead: this.health <= 0,
      health: this.health,
      water: this.water
    };
  }

  updateWaterIndicator(playerPos, camera) {
    if (!this.waterArrowEl || !camera) return;

    // Find nearest water drop
    let nearest = null;
    let minDist = Infinity;
    this.waterDrops.forEach(d => {
      const dist = d.group.position.distanceTo(playerPos);
      if (dist < minDist) {
        minDist = dist;
        nearest = d;
      }
    });

    if (nearest && minDist > 3.0) {
      this.waterArrowEl.classList.add('visible');
      const screenPos = nearest.group.position.clone().project(camera);
      const width = window.innerWidth;
      const height = window.innerHeight;

      let x = (screenPos.x * 0.5 + 0.5) * width;
      let y = (-screenPos.y * 0.5 + 0.5) * height;

      if (screenPos.z > 1.0) {
        x = width - x;
        y = height - y;
      }

      const margin = 32;
      x = Math.max(margin, Math.min(width - margin, x));
      y = Math.max(margin, Math.min(height - margin, y));

      const angle = Math.atan2(y - height / 2, x - width / 2);
      this.waterArrowEl.style.left = `${x}px`;
      this.waterArrowEl.style.top = `${y}px`;
      this.waterArrowEl.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
    } else {
      this.waterArrowEl.classList.remove('visible');
    }
  }

  updateHUD() {
    if (this.healthBar) {
      this.healthBar.style.width = `${Math.max(0, (this.health / this.maxHealth) * 100)}%`;
    }
    if (this.waterBar) {
      this.waterBar.style.width = `${Math.max(0, (this.water / this.maxWater) * 100)}%`;
    }
    if (this.pulseRing) {
      const progress = 1.0 - (this.pulseTimer / this.pulseCooldown);
      // SVG stroke-dashoffset: 2 * PI * r (r=18 -> 113.1)
      const circumference = 113.1;
      this.pulseRing.style.strokeDashoffset = (circumference * (1.0 - progress)).toString();
    }
  }

  reset() {
    this.health = this.maxHealth;
    this.water = this.maxWater;
    this.timeSinceDamage = 0;
    this.pulseTimer = 0.0;
    this.acidState = 'IDLE';
    this.acidRainTimer = 0.0;
    this.acidStateTimer = 0.0;

    if (this.acidWarningEl) this.acidWarningEl.classList.remove('visible');
    if (this.damageFlashEl) this.damageFlashEl.classList.remove('active');
    if (this.smogOverlayEl) this.smogOverlayEl.classList.remove('active');

    if (this.scene && this.scene.fog) {
      this.scene.fog.color.setHex(0x2a1650);
    }

    // Remove and dispose remaining water drops
    for (let drop of this.waterDrops) {
      this.scene.remove(drop.group);
      drop.group.traverse(child => {
        if (child.isMesh) {
          child.geometry?.dispose();
          child.material?.dispose();
        }
      });
    }
    this.waterDrops = [];

    // Spawn 4 fresh drops
    for (let i = 0; i < 4; i++) {
      this.spawnWaterDrop();
    }

    this.updateHUD();
  }
}

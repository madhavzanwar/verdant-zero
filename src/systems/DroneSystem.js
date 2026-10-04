import * as THREE from 'three';

/**
 * Purge Drone Threat System
 * - Red threatening drones built from primitives (flat rotating body, glowing red eye, thruster lights)
 * - Spawn from map edges in waves (grace period 30s, waves every 45s, 1 to 6 drones)
 * - Target nearest healthy vine, hover and burn with visible red laser beam and spark/fire particles
 * - Scanning cone detects player (>1s exposure triggers player chase and contact damage)
 * - Distracted by Light Pulse within 25 units (chases pulse origin for 3s)
 * - Edge-of-screen indicator arrows pointing to off-screen drones
 */

export class DroneSystem {
  constructor(scene, audioManager) {
    this.scene = scene;
    this.audio = audioManager;

    this.drones = [];
    this.waveTimer = 0;
    this.currentWave = 0;
    this.gracePeriod = 30.0;
    this.waveInterval = 45.0;

    // Edge arrow container
    this.edgeArrowsContainer = document.getElementById('drone-indicators');

    // Laser & fire particle pools
    this.initFireParticles();
  }

  initFireParticles() {
    this.sparkCount = 60;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(this.sparkCount * 3);
    for (let i = 0; i < this.sparkCount * 3; i++) pos[i] = -999;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xff4400,
      size: 0.35,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.sparkPoints = new THREE.Points(geo, mat);
    this.sparkData = Array.from({ length: this.sparkCount }, () => ({
      active: false,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0
    }));
    this.scene.add(this.sparkPoints);
  }

  createDroneModel() {
    const group = new THREE.Group();

    // 1. Flat rotating chassis body
    const bodyGeo = new THREE.CylinderGeometry(1.2, 1.3, 0.22, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x221a22,
      metalness: 0.8,
      roughness: 0.3
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Rotating outer ring blades
    const ringGeo = new THREE.TorusGeometry(1.35, 0.08, 8, 24);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xd92b2b,
      metalness: 0.9,
      roughness: 0.2
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // 2. Glowing Red Central Eye
    const eyeGeo = new THREE.SphereGeometry(0.35, 16, 16);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0022 });
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.y = -0.12;
    group.add(eye);

    // Red eye point light
    const eyeLight = new THREE.PointLight(0xff0022, 1.2, 8, 1.6);
    eyeLight.position.y = -0.2;
    group.add(eyeLight);

    // 3. Thruster Lights (3 corners)
    const thrusterMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });
    const thrusterGeo = new THREE.CylinderGeometry(0.12, 0.05, 0.2, 8);
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2;
      const th = new THREE.Mesh(thrusterGeo, thrusterMat);
      th.position.set(Math.cos(angle) * 1.0, 0.12, Math.sin(angle) * 1.0);
      group.add(th);
    }

    // 4. Downward Scanning Cone
    const coneGeo = new THREE.CylinderGeometry(0.2, 3.5, 10, 16, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xff0033,
      transparent: true,
      opacity: 0.09,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = -5.0;
    group.add(cone);

    // 5. Burning Laser Beam (active during vine burning)
    const beamGeo = new THREE.CylinderGeometry(0.08, 0.08, 1, 8);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xff0033,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.visible = false;
    this.scene.add(beam);

    return {
      group,
      ring,
      eye,
      cone,
      beam,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      targetVine: null,
      state: 'SEEKING', // 'SEEKING' | 'BURNING' | 'CHASING_PLAYER' | 'DISTRACTED'
      playerDetectedTime: 0,
      burnTimer: 0,
      distractTimer: 0,
      distractTarget: new THREE.Vector3()
    };
  }

  spawnWave() {
    this.currentWave++;
    // Ramp drones from 1 up to 6
    const droneCount = Math.min(6, this.currentWave);

    if (this.audio) {
      this.audio.playDroneAlert();
    }

    for (let i = 0; i < droneCount; i++) {
      const drone = this.createDroneModel();
      // Spawn at map edge
      const angle = Math.random() * Math.PI * 2;
      const radius = 130 + Math.random() * 20;
      drone.position.set(
        Math.cos(angle) * radius,
        18 + Math.random() * 15,
        Math.sin(angle) * radius
      );
      drone.group.position.copy(drone.position);
      this.scene.add(drone.group);
      this.drones.push(drone);
    }
  }

  distractDrones(pulseOrigin, radius = 25.0, duration = 3.0) {
    let distractedCount = 0;
    this.drones.forEach(d => {
      if (d.position.distanceTo(pulseOrigin) <= radius) {
        d.state = 'DISTRACTED';
        d.distractTimer = duration;
        d.distractTarget.copy(pulseOrigin);
        d.beam.visible = false;
        distractedCount++;
      }
    });
    return distractedCount;
  }

  update(delta, gameTime, vines = [], playerPos, camera) {
    // 1. Wave Spawn Scheduling
    if (gameTime > this.gracePeriod) {
      this.waveTimer += delta;
      if (this.waveTimer >= this.waveInterval || this.drones.length === 0) {
        this.waveTimer = 0;
        this.spawnWave();
      }
    }

    let playerDamage = 0;

    // 2. Update Each Active Drone
    this.drones.forEach(d => {
      // Rotate chassis ring
      d.ring.rotation.z += delta * 6.0;

      // Bobbing
      d.group.position.y = d.position.y + Math.sin(gameTime * 3.0) * 0.35;

      // Handle States
      if (d.state === 'DISTRACTED') {
        d.distractTimer -= delta;
        const dir = d.distractTarget.clone().sub(d.position).normalize();
        d.position.addScaledVector(dir, delta * 12.0);
        d.group.position.x = d.position.x;
        d.group.position.z = d.position.z;

        if (d.distractTimer <= 0) {
          d.state = 'SEEKING';
        }
      } else if (d.state === 'CHASING_PLAYER' && playerPos) {
        const toPlayer = playerPos.clone().sub(d.position);
        const dist = toPlayer.length();
        if (dist > 1.2) {
          toPlayer.normalize();
          d.position.addScaledVector(toPlayer, delta * 14.0);
          d.group.position.x = d.position.x;
          d.group.position.z = d.position.z;
        } else {
          // Contact damage
          playerDamage += 18.0 * delta;
        }
        // If player escapes beyond 22 units, return to seeking vines
        if (dist > 24.0) {
          d.state = 'SEEKING';
          d.playerDetectedTime = 0;
        }
      } else if (d.state === 'BURNING') {
        // Drone is hovering over vine burning it
        if (!d.targetVine || d.targetVine.health <= 0 || d.targetVine.growth <= 0) {
          d.state = 'SEEKING';
          d.targetVine = null;
          d.beam.visible = false;
        } else {
          // Burn vine
          d.targetVine.health = Math.max(0, (d.targetVine.health || 1.0) - delta * 0.22);
          d.beam.visible = true;

          // Position laser beam from drone to vine origin
          const start = d.position.clone().add(new THREE.Vector3(0, -0.4, 0));
          const end = d.targetVine.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
          const mid = start.clone().add(end).multiplyScalar(0.5);
          const len = start.distanceTo(end);

          d.beam.position.copy(mid);
          d.beam.scale.set(1, len, 1);
          d.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());

          // Emit sparks at contact point
          this.emitSparks(end);
        }
      } else {
        // SEEKING state: pick nearest healthy vine
        d.beam.visible = false;
        let nearestVine = null;
        let minDist = Infinity;

        vines.forEach(v => {
          if (v.growth > 0.3 && (v.health === undefined || v.health > 0)) {
            const dist = d.position.distanceTo(v.pos);
            if (dist < minDist) {
              minDist = dist;
              nearestVine = v;
            }
          }
        });

        if (nearestVine) {
          d.targetVine = nearestVine;
          const targetHoverPos = nearestVine.pos.clone().add(new THREE.Vector3(0, 9.0, 0));
          const toTarget = targetHoverPos.sub(d.position);
          const dist = toTarget.length();

          if (dist > 1.5) {
            toTarget.normalize();
            d.position.addScaledVector(toTarget, delta * 11.0);
            d.group.position.x = d.position.x;
            d.group.position.z = d.position.z;
          } else {
            d.state = 'BURNING';
          }
        }
      }

      // Check player inside Scanning Cone (>1s triggers chase)
      if (playerPos && d.state !== 'CHASING_PLAYER' && d.state !== 'DISTRACTED') {
        const horizDist = Math.hypot(d.position.x - playerPos.x, d.position.z - playerPos.z);
        const vertDiff = d.position.y - playerPos.y;
        if (horizDist < 3.8 && vertDiff > 0 && vertDiff < 10.5) {
          d.playerDetectedTime += delta;
          if (d.playerDetectedTime > 1.0) {
            d.state = 'CHASING_PLAYER';
            d.beam.visible = false;
          }
        } else {
          d.playerDetectedTime = Math.max(0, d.playerDetectedTime - delta * 0.5);
        }
      }
    });

    // 3. Update Sparks Animation
    this.updateSparks(delta);

    // 4. Update Screen-Edge Indicator Arrows
    this.updateScreenIndicators(camera);

    return { playerDamage };
  }

  emitSparks(pos) {
    for (let k = 0; k < 2; k++) {
      const idx = this.sparkData.findIndex(s => !s.active);
      if (idx !== -1) {
        const s = this.sparkData[idx];
        s.active = true;
        s.x = pos.x + (Math.random() - 0.5) * 0.5;
        s.y = pos.y + Math.random() * 0.5;
        s.z = pos.z + (Math.random() - 0.5) * 0.5;
        s.vx = (Math.random() - 0.5) * 4.0;
        s.vy = 2.0 + Math.random() * 3.5;
        s.vz = (Math.random() - 0.5) * 4.0;
        s.life = 0.5 + Math.random() * 0.3;
      }
    }
  }

  updateSparks(delta) {
    if (!this.sparkPoints) return;
    const pos = this.sparkPoints.geometry.attributes.position.array;

    this.sparkData.forEach((s, i) => {
      if (s.active) {
        s.vy -= 9.8 * delta; // gravity
        s.x += s.vx * delta;
        s.y += s.vy * delta;
        s.z += s.vz * delta;
        s.life -= delta;

        pos[i * 3] = s.x;
        pos[i * 3 + 1] = s.y;
        pos[i * 3 + 2] = s.z;

        if (s.life <= 0 || s.y < 0) {
          s.active = false;
          pos[i * 3 + 1] = -999;
        }
      }
    });

    this.sparkPoints.geometry.attributes.position.needsUpdate = true;
  }

  updateScreenIndicators(camera) {
    if (!this.edgeArrowsContainer || !camera) return;

    // Remove old arrow elements
    this.edgeArrowsContainer.innerHTML = '';

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.drones.forEach(d => {
      const screenPos = d.position.clone().project(camera);
      // If drone is behind camera or off-screen, show edge arrow
      const isOffscreen = screenPos.z > 1.0 || screenPos.x < -0.9 || screenPos.x > 0.9 || screenPos.y < -0.9 || screenPos.y > 0.9;

      if (isOffscreen) {
        const arrow = document.createElement('div');
        arrow.className = 'drone-edge-arrow';

        // Calculate clamped screen position
        let x = (screenPos.x * 0.5 + 0.5) * width;
        let y = (-screenPos.y * 0.5 + 0.5) * height;

        if (screenPos.z > 1.0) {
          x = width - x;
          y = height - y;
        }

        const margin = 28;
        x = Math.max(margin, Math.min(width - margin, x));
        y = Math.max(margin, Math.min(height - margin, y));

        // Arrow angle pointing toward drone
        const angle = Math.atan2(y - height / 2, x - width / 2);
        arrow.style.left = `${x}px`;
        arrow.style.top = `${y}px`;
        arrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;

        this.edgeArrowsContainer.appendChild(arrow);
      }
    });
  }

  reset() {
    this.drones.forEach(d => {
      if (d.mesh) this.scene.remove(d.mesh);
      if (d.laserBeam) this.scene.remove(d.laserBeam);
      if (d.scanCone) this.scene.remove(d.scanCone);
    });
    this.drones = [];
    this.waveTimer = 0;
    this.currentWave = 0;
    if (this.edgeArrowsContainer) {
      this.edgeArrowsContainer.innerHTML = '';
    }
  }
}

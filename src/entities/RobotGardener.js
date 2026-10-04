import * as THREE from 'three';

/**
 * Robot Gardener Entity
 * - Compact capsule chassis with rounded primitives
 * - Large expressive glowing green eye that blinks, looks around, and widens near planting spots
 * - Articulated side arms & swinging seed lantern with real PointLight
 * - Hover thruster with particle trail and idle bobbing
 * - Dynamic tilt, landing squash, WASD flight + hover + dash controls
 * - Collision detection with streets and building rooftops
 */

export class RobotGardener {
  constructor(scene, colliders = []) {
    this.scene = scene;
    this.colliders = colliders;

    // Transform & Physics state
    this.position = new THREE.Vector3(-6.8, 1.2, 0);
    this.velocity = new THREE.Vector3();
    this.speed = 14.0;
    this.dashSpeed = 26.0;
    this.hoverThrust = 18.0;
    this.gravity = 14.0;
    this.isDashing = false;
    this.isGrounded = false;
    this.currentGroundY = 0.9;

    // Personality state
    this.tilt = { x: 0, z: 0 };
    this.squash = { y: 1.0, xz: 1.0 };
    this.blinkTimer = 0;
    this.isBlinking = false;
    this.isNearPlantSpot = false;

    // Group container
    this.mesh = new THREE.Group();
    this.buildRobotMesh();
    this.scene.add(this.mesh);

    // Thruster exhaust particles
    this.initThrusterParticles();
  }

  buildRobotMesh() {
    // 1. Compact Rounded Capsule Body (Dark graphite matte chassis)
    const bodyGeo = new THREE.CapsuleGeometry(0.55, 0.75, 16, 24);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1f242d,
      roughness: 0.45,
      metalness: 0.65
    });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.mesh.add(this.bodyMesh);

    // Decorative copper/brass collar band
    const bandGeo = new THREE.TorusGeometry(0.56, 0.04, 12, 32);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0xc4975a,
      roughness: 0.3,
      metalness: 0.8
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.05;
    this.bodyMesh.add(band);

    // 2. Large Expressive Glowing Green Eye (Cyclops lens)
    const eyeSocketGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.15, 24);
    const socketMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.8 });
    const eyeSocket = new THREE.Mesh(eyeSocketGeo, socketMat);
    eyeSocket.rotation.x = Math.PI / 2;
    eyeSocket.position.set(0, 0.35, 0.52);
    this.bodyMesh.add(eyeSocket);

    // Glowing green iris / pupil
    const irisGeo = new THREE.SphereGeometry(0.24, 24, 24);
    this.irisMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    this.eyeMesh = new THREE.Mesh(irisGeo, this.irisMat);
    this.eyeMesh.position.set(0, 0.35, 0.55);
    this.eyeMesh.scale.set(1, 1, 0.4);
    this.bodyMesh.add(this.eyeMesh);

    // Inner bright pupil
    const pupilGeo = new THREE.SphereGeometry(0.12, 16, 16);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.pupilMesh = new THREE.Mesh(pupilGeo, pupilMat);
    this.pupilMesh.position.set(0, 0.35, 0.62);
    this.pupilMesh.scale.set(1, 1, 0.3);
    this.bodyMesh.add(this.pupilMesh);

    // Eyelid for blinking
    const lidGeo = new THREE.SphereGeometry(0.26, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x1f242d, roughness: 0.5 });
    this.eyelid = new THREE.Mesh(lidGeo, lidMat);
    this.eyelid.position.set(0, 0.35, 0.56);
    this.eyelid.rotation.x = -Math.PI / 2;
    this.eyelid.scale.set(1.05, 0.05, 1.05); // Start open
    this.bodyMesh.add(this.eyelid);

    // 3. Small Articulated Side Arms
    const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7 });

    this.leftArm = new THREE.Mesh(armGeo, armMat);
    this.leftArm.position.set(-0.62, 0.05, 0.05);
    this.leftArm.rotation.z = Math.PI / 6;
    this.bodyMesh.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, armMat);
    this.rightArm.position.set(0.62, 0.05, 0.05);
    this.rightArm.rotation.z = -Math.PI / 6;
    this.bodyMesh.add(this.rightArm);

    // 4. Hanging Seed Lantern (Carries the Last Seed)
    this.lanternPivot = new THREE.Group();
    this.lanternPivot.position.set(0.48, -0.15, 0.28);
    this.bodyMesh.add(this.lanternPivot);

    // Chain link
    const chainGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.28, 6);
    const chain = new THREE.Mesh(chainGeo, armMat);
    chain.position.y = -0.14;
    this.lanternPivot.add(chain);

    // Lantern glass enclosure
    const lanternGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.38, 12);
    const lanternMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.45,
      roughness: 0.1
    });
    const lantern = new THREE.Mesh(lanternGeo, lanternMat);
    lantern.position.y = -0.38;
    this.lanternPivot.add(lantern);

    // Glowing Genesis Seed inside
    const seedGeo = new THREE.SphereGeometry(0.1, 16, 16);
    const seedMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    this.seedMesh = new THREE.Mesh(seedGeo, seedMat);
    this.seedMesh.position.y = -0.38;
    this.lanternPivot.add(this.seedMesh);

    // Real dynamic PointLight from the seed
    this.seedLight = new THREE.PointLight(0x00ff88, 2.5, 12, 1.4);
    this.seedLight.position.y = -0.38;
    this.lanternPivot.add(this.seedLight);

    // 5. Thruster Nozzle at Base
    const thrusterGeo = new THREE.CylinderGeometry(0.24, 0.12, 0.22, 16);
    const thrusterMat = new THREE.MeshStandardMaterial({ color: 0x111318, metalness: 0.9 });
    const thruster = new THREE.Mesh(thrusterGeo, thrusterMat);
    thruster.position.y = -0.85;
    this.bodyMesh.add(thruster);
  }

  initThrusterParticles() {
    const pCount = 20;
    const pGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(pCount * 3);

    for (let i = 0; i < pCount * 3; i++) {
      positions[i] = 0;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const pMat = new THREE.PointsMaterial({
      color: 0x00ffbb,
      size: 0.22,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });

    this.thrusterParticles = new THREE.Points(pGeo, pMat);
    this.thrusterParticlesData = Array.from({ length: pCount }, () => ({
      x: 0, y: 0, z: 0,
      vx: (Math.random() - 0.5) * 0.4,
      vy: -1.5 - Math.random() * 2.0,
      vz: (Math.random() - 0.5) * 0.4,
      life: Math.random()
    }));

    this.scene.add(this.thrusterParticles);
  }

  /**
   * Update Robot Physics, Animation & Collision
   */
  update(delta, time, input, cameraAngle, cameraPitch) {
    // 1. Process Input (WASD and Arrow keys supported simultaneously)
    const moveVector = new THREE.Vector3();

    if (input.isKeyPressed('KeyW') || input.isKeyPressed('ArrowUp')) moveVector.z -= 1;
    if (input.isKeyPressed('KeyS') || input.isKeyPressed('ArrowDown')) moveVector.z += 1;
    if (input.isKeyPressed('KeyA') || input.isKeyPressed('ArrowLeft')) moveVector.x -= 1;
    if (input.isKeyPressed('KeyD') || input.isKeyPressed('ArrowRight')) moveVector.x += 1;

    this.isDashing = input.isKeyPressed('ShiftLeft') || input.isKeyPressed('ShiftRight');
    const isHovering = input.isKeyPressed('Space');

    const currentSpeed = this.isDashing ? this.dashSpeed : this.speed;

    // Apply Camera-Relative Movement
    if (moveVector.lengthSq() > 0) {
      moveVector.normalize();
      moveVector.applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngle);
      
      this.velocity.x = moveVector.x * currentSpeed;
      this.velocity.z = moveVector.z * currentSpeed;

      // Face movement direction smoothly
      const targetHeading = Math.atan2(moveVector.x, moveVector.z);
      this.mesh.rotation.y = targetHeading;
    } else {
      this.velocity.x *= 0.85;
      this.velocity.z *= 0.85;
    }

    // Vertical Hover vs Gravity
    if (isHovering) {
      this.velocity.y += this.hoverThrust * delta;
      this.velocity.y = Math.min(this.velocity.y, 14.0);
    } else {
      this.velocity.y -= this.gravity * delta;
      this.velocity.y = Math.max(this.velocity.y, -18.0);
    }

    // Apply movement
    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;
    this.position.y += this.velocity.y * delta;

    // 2. Collision Resolution with City Buildings & Rooftops
    this.resolveCollisions();

    // 3. Dynamic Tilt & Idle Bobbing
    const targetTiltZ = -(this.velocity.x / currentSpeed) * 0.35;
    const targetTiltX = (this.velocity.z / currentSpeed) * 0.35;
    this.tilt.z += (targetTiltZ - this.tilt.z) * 0.15;
    this.tilt.x += (targetTiltX - this.tilt.x) * 0.15;

    this.bodyMesh.rotation.x = this.tilt.x;
    this.bodyMesh.rotation.z = this.tilt.z;

    // Idle vertical bobbing
    const bob = Math.sin(time * 3.5) * 0.08;
    this.mesh.position.set(this.position.x, this.position.y + bob, this.position.z);

    // Lantern swing inertia
    this.lanternPivot.rotation.z = -this.tilt.z * 1.5 + Math.sin(time * 2.5) * 0.08;
    this.lanternPivot.rotation.x = -this.tilt.x * 1.5;

    // 4. Expressive Eye Behavior (Blinking, Widening & Camera Gaze Tracking)
    this.updateEye(delta, time, cameraAngle, cameraPitch);

    // 5. Thruster Exhaust Particles
    this.updateThrusterParticles(delta, isHovering);
  }

  resolveCollisions() {
    const playerRadius = 0.65;
    let groundY = 0.9; // Street level

    for (let c of this.colliders) {
      // Check if player is horizontally within building footprint (+ margin)
      const withinX = this.position.x > c.minX - playerRadius && this.position.x < c.maxX + playerRadius;
      const withinZ = this.position.z > c.minZ - playerRadius && this.position.z < c.maxZ + playerRadius;

      if (withinX && withinZ) {
        // If above building roof, set rooftop as ground!
        if (this.position.y >= c.height - 0.2) {
          groundY = Math.max(groundY, c.height + 0.9);
        } else {
          // Horizontal Wall Collision: push out along shortest axis
          const distMinX = Math.abs(this.position.x - (c.minX - playerRadius));
          const distMaxX = Math.abs(this.position.x - (c.maxX + playerRadius));
          const distMinZ = Math.abs(this.position.z - (c.minZ - playerRadius));
          const distMaxZ = Math.abs(this.position.z - (c.maxZ + playerRadius));

          const minDist = Math.min(distMinX, distMaxX, distMinZ, distMaxZ);

          if (minDist === distMinX) this.position.x = c.minX - playerRadius;
          else if (minDist === distMaxX) this.position.x = c.maxX + playerRadius;
          else if (minDist === distMinZ) this.position.z = c.minZ - playerRadius;
          else if (minDist === distMaxZ) this.position.z = c.maxZ + playerRadius;
        }
      }
    }

    // Ground / Rooftop landing resolution
    if (this.position.y <= groundY) {
      if (!this.isGrounded && this.velocity.y < -3.0) {
        // Landing squash trigger
        this.squash.y = 0.82;
        this.squash.xz = 1.15;
      }
      this.position.y = groundY;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    // Smoothly spring squash back to normal
    this.squash.y += (1.0 - this.squash.y) * 0.15;
    this.squash.xz += (1.0 - this.squash.xz) * 0.15;
    this.bodyMesh.scale.set(this.squash.xz, this.squash.y, this.squash.xz);
  }

  updateEye(delta, time, cameraAngle, cameraPitch) {
    // Eye widening when near a planting spot
    const targetScale = this.isNearPlantSpot ? 1.35 : 1.0;
    const currentScale = this.eyeMesh.scale.x;
    const newScale = currentScale + (targetScale - currentScale) * 0.12;
    this.eyeMesh.scale.set(newScale, newScale, 0.4);
    this.pupilMesh.scale.set(newScale, newScale, 0.3);

    // Pulse brightness when excited near planting spot
    if (this.isNearPlantSpot) {
      this.irisMat.color.setHex(0x33ffaa);
    } else {
      this.irisMat.color.setHex(0x00ff88);
    }

    // Camera Gaze Tracking: eye looks toward direction camera is facing
    if (cameraAngle !== undefined) {
      let diff = cameraAngle - this.mesh.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      // Smooth horizontal gaze offset
      const lookOffsetX = Math.max(-0.12, Math.min(0.12, Math.sin(diff) * 0.12));
      // Smooth vertical gaze offset based on camera pitch
      const lookOffsetY = Math.max(-0.08, Math.min(0.08, Math.sin(cameraPitch || 0) * 0.08));

      this.eyeMesh.position.x = lookOffsetX;
      this.eyeMesh.position.y = 0.35 + lookOffsetY;
      this.pupilMesh.position.x = lookOffsetX * 1.25;
      this.pupilMesh.position.y = 0.35 + lookOffsetY * 1.25;
    }

    // Blink timer (blinks every 3.5 - 6 seconds)
    this.blinkTimer += delta;
    if (this.blinkTimer > 4.2) {
      this.isBlinking = true;
      this.eyelid.scale.y = 1.05; // Closed
      if (this.blinkTimer > 4.38) {
        this.isBlinking = false;
        this.eyelid.scale.y = 0.05; // Open
        this.blinkTimer = (Math.random() - 0.5) * 1.5;
      }
    }
  }

  updateThrusterParticles(delta, isHovering) {
    if (!this.thrusterParticles) return;

    const positions = this.thrusterParticles.geometry.attributes.position.array;
    const thrustStrength = isHovering ? 2.5 : 1.0;

    this.thrusterParticlesData.forEach((p, i) => {
      p.life -= delta * 3.5;
      if (p.life <= 0) {
        p.x = this.position.x + (Math.random() - 0.5) * 0.18;
        p.y = this.position.y - 0.85;
        p.z = this.position.z + (Math.random() - 0.5) * 0.18;
        p.vx = (Math.random() - 0.5) * 0.3;
        p.vy = (-2.0 - Math.random() * 2.5) * thrustStrength;
        p.vz = (Math.random() - 0.5) * 0.3;
        p.life = 0.8 + Math.random() * 0.4;
      } else {
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.z += p.vz * delta;
      }

      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    });

    this.thrusterParticles.geometry.attributes.position.needsUpdate = true;
  }
}

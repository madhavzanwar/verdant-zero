import * as THREE from 'three';

/**
 * Robot Gardener Entity
 * - Light brushed metal off-white/silver chassis (#dae2ed) with dark accent panels
 * - Bright glowing green eye with soft radiant halo
 * - Emissive hover thruster ring & particle trail
 * - Real point lights following player (seed light, cyan rim, magenta rim, warm ground bounce)
 * - Soft dynamic blob shadow on ground that scales with hover height
 * - WASD & Arrow key navigation, dynamic tilt, landing squash, camera gaze tracking
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

    // Soft blob shadow on ground
    this.initBlobShadow();

    // Thruster exhaust particles
    this.initThrusterParticles();
  }

  buildRobotMesh() {
    // 1. Light Brushed Metal Body (Off-white and silver with dark panels)
    const bodyGeo = new THREE.CapsuleGeometry(0.55, 0.75, 16, 24);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xdae2ed,       // Light silver / off-white brushed metal
      roughness: 0.28,
      metalness: 0.68
    });
    this.bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.mesh.add(this.bodyMesh);

    // Dark graphite accent panels (Belly & Back plate)
    const panelGeo = new THREE.CapsuleGeometry(0.56, 0.45, 12, 16);
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x242a38,
      roughness: 0.40,
      metalness: 0.50
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.scale.set(0.98, 0.75, 0.98);
    panel.position.y = -0.05;
    this.bodyMesh.add(panel);

    // Decorative polished brass/copper collar band
    const bandGeo = new THREE.TorusGeometry(0.57, 0.04, 12, 32);
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0xcca062,
      roughness: 0.25,
      metalness: 0.85
    });
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.06;
    this.bodyMesh.add(band);

    // 2. Large Expressive Glowing Green Eye with Soft Halo
    const eyeSocketGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.15, 24);
    const socketMat = new THREE.MeshStandardMaterial({
      color: 0x181c26,
      roughness: 0.5,
      metalness: 0.7
    });
    const eyeSocket = new THREE.Mesh(eyeSocketGeo, socketMat);
    eyeSocket.rotation.x = Math.PI / 2;
    eyeSocket.position.set(0, 0.35, 0.52);
    this.bodyMesh.add(eyeSocket);

    // Glowing green iris
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

    // Soft radiant eye halo
    const haloGeo = new THREE.RingGeometry(0.24, 0.48, 24);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.eyeHalo = new THREE.Mesh(haloGeo, haloMat);
    this.eyeHalo.position.set(0, 0.35, 0.58);
    this.bodyMesh.add(this.eyeHalo);

    // Eyelid for blinking
    const lidGeo = new THREE.SphereGeometry(0.26, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const lidMat = new THREE.MeshStandardMaterial({ color: 0xdae2ed, roughness: 0.3 });
    this.eyelid = new THREE.Mesh(lidGeo, lidMat);
    this.eyelid.position.set(0, 0.35, 0.56);
    this.eyelid.rotation.x = -Math.PI / 2;
    this.eyelid.scale.set(1.05, 0.05, 1.05); // Start open
    this.bodyMesh.add(this.eyelid);

    // 3. Small Articulated Side Arms
    const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.45, 8);
    const armMat = new THREE.MeshStandardMaterial({ color: 0x3d4b60, metalness: 0.75, roughness: 0.3 });

    this.leftArm = new THREE.Mesh(armGeo, armMat);
    this.leftArm.position.set(-0.62, 0.05, 0.05);
    this.leftArm.rotation.z = Math.PI / 6;
    this.bodyMesh.add(this.leftArm);

    this.rightArm = new THREE.Mesh(armGeo, armMat);
    this.rightArm.position.set(0.62, 0.05, 0.05);
    this.rightArm.rotation.z = -Math.PI / 6;
    this.bodyMesh.add(this.rightArm);

    // 4. Hanging Seed Lantern
    this.lanternPivot = new THREE.Group();
    this.lanternPivot.position.set(0.48, -0.15, 0.28);
    this.bodyMesh.add(this.lanternPivot);

    const chainGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.28, 6);
    const chain = new THREE.Mesh(chainGeo, armMat);
    chain.position.y = -0.14;
    this.lanternPivot.add(chain);

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

    const seedGeo = new THREE.SphereGeometry(0.1, 16, 16);
    const seedMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    this.seedMesh = new THREE.Mesh(seedGeo, seedMat);
    this.seedMesh.position.y = -0.38;
    this.lanternPivot.add(this.seedMesh);

    // Real dynamic PointLight from seed
    this.seedLight = new THREE.PointLight(0x00ff88, 2.2, 12, 1.4);
    this.seedLight.position.y = -0.38;
    this.lanternPivot.add(this.seedLight);

    // 5. Player Rim & Fill Point Lights (strictly under 8 total real lights in scene)
    // Cyan Rim Light (Left)
    this.rimLightCyan = new THREE.PointLight(0x00f0ff, 1.5, 14, 1.6);
    this.rimLightCyan.position.set(-1.4, 0.8, 0.6);
    this.bodyMesh.add(this.rimLightCyan);

    // Magenta Rim Light (Right)
    this.rimLightMagenta = new THREE.PointLight(0xff007f, 1.5, 14, 1.6);
    this.rimLightMagenta.position.set(1.4, 0.8, -0.6);
    this.bodyMesh.add(this.rimLightMagenta);

    // Warm Ground Bounce Light (Underneath)
    this.groundBounceLight = new THREE.PointLight(0xffaa44, 0.8, 8, 1.8);
    this.groundBounceLight.position.set(0, -0.7, 0);
    this.bodyMesh.add(this.groundBounceLight);

    // 6. Thruster Nozzle & Emissive Thruster Ring at Base
    const thrusterGeo = new THREE.CylinderGeometry(0.24, 0.14, 0.22, 16);
    const thrusterMat = new THREE.MeshStandardMaterial({ color: 0x222834, metalness: 0.85, roughness: 0.3 });
    const thruster = new THREE.Mesh(thrusterGeo, thrusterMat);
    thruster.position.y = -0.85;
    this.bodyMesh.add(thruster);

    // Glowing cyan/green emissive thruster ring
    const ringGeo = new THREE.TorusGeometry(0.22, 0.045, 12, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    this.thrusterRing = new THREE.Mesh(ringGeo, ringMat);
    this.thrusterRing.rotation.x = Math.PI / 2;
    this.thrusterRing.position.y = -0.96;
    this.bodyMesh.add(this.thrusterRing);
  }

  initBlobShadow() {
    // Generate soft circular radial gradient canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
    grad.addColorStop(0, 'rgba(8, 10, 20, 0.72)');
    grad.addColorStop(0.5, 'rgba(8, 10, 20, 0.40)');
    grad.addColorStop(1, 'rgba(8, 10, 20, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const shadowTex = new THREE.CanvasTexture(canvas);
    const shadowGeo = new THREE.PlaneGeometry(2.4, 2.4);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });

    this.blobShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.blobShadow.rotation.x = -Math.PI / 2;
    this.blobShadow.position.set(this.position.x, 0.02, this.position.z);
    this.scene.add(this.blobShadow);
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

  update(delta, time, input, cameraAngle = 0, cameraPitch = 0) {
    // 1. WASD & Arrow Key Movement Calculation
    let moveX = 0;
    let moveZ = 0;

    const isUp = input.isKeyPressed('KeyW') || input.isKeyPressed('ArrowUp');
    const isDown = input.isKeyPressed('KeyS') || input.isKeyPressed('ArrowDown');
    const isLeft = input.isKeyPressed('KeyA') || input.isKeyPressed('ArrowLeft');
    const isRight = input.isKeyPressed('KeyD') || input.isKeyPressed('ArrowRight');

    if (isUp) moveZ -= 1;
    if (isDown) moveZ += 1;
    if (isLeft) moveX -= 1;
    if (isRight) moveX += 1;

    // Movement direction relative to camera angle
    const moveVector = new THREE.Vector2(moveX, moveZ);
    if (moveVector.lengthSq() > 0) {
      moveVector.normalize();
      moveVector.rotateAround(new THREE.Vector2(0, 0), -cameraAngle);
    }

    // Dash burst handling (Shift key)
    this.isDashing = input.isKeyPressed('ShiftLeft') || input.isKeyPressed('ShiftRight');
    const currentSpeed = this.isDashing ? this.dashSpeed : this.speed;

    // Apply planar velocity with inertia
    this.velocity.x += (moveVector.x * currentSpeed - this.velocity.x) * delta * 8.0;
    this.velocity.z += (moveVector.y * currentSpeed - this.velocity.z) * delta * 8.0;

    // Hover thruster (Space key)
    const isHovering = input.isKeyPressed('Space');
    if (isHovering) {
      this.velocity.y += this.hoverThrust * delta;
      this.velocity.y = Math.min(this.velocity.y, 14.0);
    } else {
      this.velocity.y -= this.gravity * delta;
    }

    // Apply velocity to position
    this.position.x += this.velocity.x * delta;
    this.position.y += this.velocity.y * delta;
    this.position.z += this.velocity.z * delta;

    // 2. Collision with Buildings & Rooftops
    this.resolveCollisions();

    // Idle hovering bobbing motion
    const idleBob = Math.sin(time * 3.0) * 0.08;
    this.mesh.position.set(this.position.x, this.position.y + idleBob, this.position.z);

    // Update soft blob shadow directly on ground
    if (this.blobShadow) {
      this.blobShadow.position.set(this.position.x, this.currentGroundY + 0.02, this.position.z);
      const heightAboveGround = Math.max(0, this.position.y - this.currentGroundY);
      const shadowScale = Math.max(0.6, 1.0 + heightAboveGround * 0.22);
      this.blobShadow.scale.set(shadowScale, shadowScale, 1);
      this.blobShadow.material.opacity = Math.max(0.18, 0.72 - heightAboveGround * 0.10);
    }

    // 3. Dynamic Tilt into Movement Direction
    const targetTiltZ = -this.velocity.x * 0.045;
    const targetTiltX = this.velocity.z * 0.045;
    this.tilt.z += (targetTiltZ - this.tilt.z) * delta * 10.0;
    this.tilt.x += (targetTiltX - this.tilt.x) * delta * 10.0;

    this.mesh.rotation.z = this.tilt.z;
    this.mesh.rotation.x = this.tilt.x;

    // Smoothly turn body towards movement direction if moving
    if (moveVector.lengthSq() > 0.01) {
      const targetFacing = Math.atan2(this.velocity.x, this.velocity.z);
      let diff = targetFacing - this.mesh.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.mesh.rotation.y += diff * delta * 7.0;
    }

    // Lantern swing inertia
    this.lanternPivot.rotation.z = -this.tilt.z * 1.5 + Math.sin(time * 2.5) * 0.08;
    this.lanternPivot.rotation.x = -this.tilt.x * 1.5;

    // 4. Expressive Eye Behavior
    this.updateEye(delta, time, cameraAngle, cameraPitch);

    // 5. Thruster Exhaust Particles & Emissive Glow
    this.updateThrusterParticles(delta, isHovering);

    // Thruster ring brightness
    if (this.thrusterRing) {
      const ringGlow = isHovering ? 0x00ffff : 0x00ffaa;
      this.thrusterRing.material.color.setHex(ringGlow);
    }
  }

  resolveCollisions() {
    const playerRadius = 0.65;
    let groundY = 0.9;

    for (let c of this.colliders) {
      const withinX = this.position.x > c.minX - playerRadius && this.position.x < c.maxX + playerRadius;
      const withinZ = this.position.z > c.minZ - playerRadius && this.position.z < c.maxZ + playerRadius;

      if (withinX && withinZ) {
        if (this.position.y >= c.height - 0.2) {
          groundY = Math.max(groundY, c.height + 0.9);
        } else {
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

    this.currentGroundY = groundY;

    if (this.position.y <= groundY) {
      if (!this.isGrounded && this.velocity.y < -3.0) {
        this.squash.y = 0.82;
        this.squash.xz = 1.15;
      }
      this.position.y = groundY;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }

    this.squash.y += (1.0 - this.squash.y) * 0.15;
    this.squash.xz += (1.0 - this.squash.xz) * 0.15;
    this.bodyMesh.scale.set(this.squash.xz, this.squash.y, this.squash.xz);
  }

  updateEye(delta, time, cameraAngle, cameraPitch) {
    const targetScale = this.isNearPlantSpot ? 1.35 : 1.0;
    const currentScale = this.eyeMesh.scale.x;
    const newScale = currentScale + (targetScale - currentScale) * 0.12;
    this.eyeMesh.scale.set(newScale, newScale, 0.4);
    this.pupilMesh.scale.set(newScale, newScale, 0.3);

    if (this.eyeHalo) {
      this.eyeHalo.scale.set(newScale, newScale, 1);
    }

    if (this.isNearPlantSpot) {
      this.irisMat.color.setHex(0x33ffaa);
    } else {
      this.irisMat.color.setHex(0x00ff88);
    }

    if (cameraAngle !== undefined) {
      let diff = cameraAngle - this.mesh.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      const lookOffsetX = Math.max(-0.12, Math.min(0.12, Math.sin(diff) * 0.12));
      const lookOffsetY = Math.max(-0.08, Math.min(0.08, Math.sin(cameraPitch || 0) * 0.08));

      this.eyeMesh.position.x = lookOffsetX;
      this.eyeMesh.position.y = 0.35 + lookOffsetY;
      this.pupilMesh.position.x = lookOffsetX * 1.25;
      this.pupilMesh.position.y = 0.35 + lookOffsetY * 1.25;
      if (this.eyeHalo) {
        this.eyeHalo.position.x = lookOffsetX;
        this.eyeHalo.position.y = 0.35 + lookOffsetY;
      }
    }

    this.blinkTimer += delta;
    if (this.blinkTimer > 4.2) {
      this.isBlinking = true;
      this.eyelid.scale.y = 1.05;
      if (this.blinkTimer > 4.38) {
        this.isBlinking = false;
        this.eyelid.scale.y = 0.05;
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

  reset() {
    this.position.set(-6.8, 1.2, 0);
    this.velocity.set(0, 0, 0);
    this.isDashing = false;
    this.isGrounded = false;
    this.currentGroundY = 0.9;
    this.tilt = { x: 0, z: 0 };
    this.squash = { y: 1.0, xz: 1.0 };
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(0, 0, 0);
  }
}

import * as THREE from 'three';

/**
 * Updraft Steam Vents & Launch Pads System
 * - High-speed pneumatic thermal exhaust grates on street level
 * - Launces the robot gardener high into the air toward skyscraper rooftops
 * - Glowing cyber grates, rising volumetric steam plumes, and energy chevrons
 * - Recharges robot hover energy and triggers dynamic camera FOV kick
 */

export class UpdraftSystem {
  constructor(scene, audioManager, cameraController) {
    this.scene = scene;
    this.audio = audioManager;
    this.cameraController = cameraController;

    // Updraft vent coordinates strategically placed across street canyons & near towers
    this.ventConfigs = [
      { id: 'sanctuary_vent', x: -14.0, y: 0.05, z: -2.0, targetName: 'Sanctuary Spire Ascent' },
      { id: 'east_vent', x: 14.0, y: 0.05, z: 10.0, targetName: 'East Tower Ascent' },
      { id: 'north_plaza_vent', x: 0.0, y: 0.05, z: -28.0, targetName: 'North Avenue Overlook' },
      { id: 'south_canal_vent', x: 0.0, y: 0.05, z: 40.0, targetName: 'South Canal High Launch' }
    ];

    this.vents = [];
    this.lastLaunchTimes = new Map();
    this.cooldownDuration = 0.8; // 800ms cooldown per vent

    this.initVents();
  }

  initVents() {
    // 1. Heavy industrial circular cast-iron rim & slotted grate
    const rimGeo = new THREE.CylinderGeometry(1.65, 1.85, 0.16, 24);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x151a24,
      roughness: 0.85,
      metalness: 0.35
    });

    // 2. Glowing neon cyan energy ring
    const neonRingGeo = new THREE.RingGeometry(1.35, 1.55, 32);
    const neonRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      side: THREE.DoubleSide
    });

    // 3. Volumetric glowing steam plume column (translucent cylinder)
    const plumeGeo = new THREE.CylinderGeometry(1.3, 1.7, 34.0, 18, 1, true);
    plumeGeo.translate(0, 17.0, 0); // Base sits at ground level

    const plumeMat = new THREE.MeshBasicMaterial({
      color: 0x00ffea,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    // 4. Rising steam particles per vent
    const particleCountPerVent = 35;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCountPerVent * 3);
    for (let i = 0; i < particleCountPerVent * 3; i++) particlePos[i] = 0;
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));

    const particleMat = new THREE.PointsMaterial({
      color: 0x55ffff,
      size: 0.45,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.ventConfigs.forEach(cfg => {
      const group = new THREE.Group();
      group.position.set(cfg.x, cfg.y, cfg.z);

      // Cast iron rim
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.y = 0.08;
      group.add(rim);

      // Glowing neon ring on ground
      const neonRing = new THREE.Mesh(neonRingGeo, neonRingMat.clone());
      neonRing.rotation.x = -Math.PI / 2;
      neonRing.position.y = 0.17;
      group.add(neonRing);

      // Volumetric steam cylinder
      const plume = new THREE.Mesh(plumeGeo, plumeMat.clone());
      group.add(plume);

      // Particle system for upward steam wisps
      const pGeo = particleGeo.clone();
      const pMesh = new THREE.Points(pGeo, particleMat.clone());
      group.add(pMesh);

      // Floating holographic chevron / arrow indicating upward thrust
      const chevronGeo = new THREE.ConeGeometry(0.35, 0.6, 4);
      const chevronMat = new THREE.MeshBasicMaterial({
        color: 0x00ffff,
        transparent: true,
        opacity: 0.85
      });
      const chevron = new THREE.Mesh(chevronGeo, chevronMat);
      chevron.position.y = 1.6;
      group.add(chevron);

      // Particle data tracking
      const particles = [];
      for (let i = 0; i < particleCountPerVent; i++) {
        particles.push({
          x: (Math.random() - 0.5) * 1.8,
          y: Math.random() * 32.0,
          z: (Math.random() - 0.5) * 1.8,
          vy: 14.0 + Math.random() * 16.0,
          rot: Math.random() * Math.PI * 2
        });
      }

      this.scene.add(group);

      this.vents.push({
        id: cfg.id,
        name: cfg.targetName,
        pos: new THREE.Vector3(cfg.x, cfg.y, cfg.z),
        group,
        neonRing,
        plume,
        pMesh,
        particles,
        chevron
      });

      this.lastLaunchTimes.set(cfg.id, -999);
    });
  }

  update(delta, time, robot) {
    if (!robot || !robot.position) return;

    const playerPos = robot.position;

    this.vents.forEach(v => {
      // 1. Animate neon ring and volumetric steam pulse
      const pulse = 0.65 + 0.35 * Math.sin(time * 4.5 + v.pos.x);
      v.neonRing.material.opacity = 0.7 + 0.3 * pulse;
      v.plume.material.opacity = 0.09 + 0.08 * pulse;

      // Animate floating chevron
      v.chevron.position.y = 1.4 + Math.sin(time * 3.5 + v.pos.z) * 0.25;
      v.chevron.rotation.y = time * 2.0;

      // 2. Animate upward steam particles
      const positions = v.pMesh.geometry.attributes.position.array;
      v.particles.forEach((p, idx) => {
        p.y += p.vy * delta;
        p.x += Math.sin(time * 3.0 + idx) * 0.08 * delta;
        p.z += Math.cos(time * 3.0 + idx) * 0.08 * delta;

        if (p.y > 34.0) {
          p.y = 0.1;
          p.x = (Math.random() - 0.5) * 1.6;
          p.z = (Math.random() - 0.5) * 1.6;
        }

        const i3 = idx * 3;
        positions[i3] = p.x;
        positions[i3 + 1] = p.y;
        positions[i3 + 2] = p.z;
      });
      v.pMesh.geometry.attributes.position.needsUpdate = true;

      // 3. Proximity detection and launch trigger
      const dx = playerPos.x - v.pos.x;
      const dz = playerPos.z - v.pos.z;
      const horizontalDist = Math.hypot(dx, dz);
      const verticalDist = Math.abs(playerPos.y - v.pos.y);

      // Trigger launch if within 2.3m horizontally and close to ground or in lower air stream
      if (horizontalDist < 2.3 && verticalDist < 4.5) {
        const lastLaunch = this.lastLaunchTimes.get(v.id) || 0;
        if (time - lastLaunch > this.cooldownDuration) {
          this.lastLaunchTimes.set(v.id, time);
          this.triggerLaunch(v, robot);
        }
      }
    });
  }

  triggerLaunch(vent, robot) {
    // 1. Propel robot upward with strong, smooth pneumatic boost (~32.5 units/s)
    if (typeof robot.applyUpdraft === 'function') {
      robot.applyUpdraft(32.5);
    } else {
      robot.velocity.y = Math.max(robot.velocity.y, 32.5);
      robot.isGrounded = false;
      robot.isHovering = false;
      robot.hoverEnergy = 100.0;
    }

    // 2. Play audio launch sound cue
    if (this.audio && typeof this.audio.playUpdraftLaunch === 'function') {
      this.audio.playUpdraftLaunch();
    }

    // 3. Camera FOV kick for exhilarating speed rush
    if (this.cameraController && typeof this.cameraController.triggerUpdraftFov === 'function') {
      this.cameraController.triggerUpdraftFov();
    }

    // 4. Temporary flare on the steam plume
    if (vent.plume) {
      vent.plume.material.opacity = 0.45;
    }
  }

  getVents() {
    return this.ventConfigs;
  }
}

import * as THREE from 'three';

/**
 * Volumetric 3D Hologram System
 * - Giant Cyber-Koi Fish swimming undulating through the night sky between skyscrapers
 * - Rotating Rebirth Geodesic Bio-Sphere over North Plaza
 * - Floating Vertical Cyber Glyph Hologram Billboards
 * - Lightweight wireframe & additive blending shaders for maximum 60 FPS performance
 */

export class HologramSystem {
  constructor(scene) {
    this.scene = scene;

    this.initCyberKoi();
    this.initBioSphere();
    this.initFloatingGlyphs();
  }

  // =========================================================================
  // 1. GIANT CYBER-KOI FISH HOLOGRAPHIC PROJECTION
  // =========================================================================
  initCyberKoi() {
    this.koiGroup = new THREE.Group();
    // Positioned high in the canyon sky between central skyscrapers
    this.koiBasePos = new THREE.Vector3(2.5, 42.0, 5.0);
    this.koiGroup.position.copy(this.koiBasePos);

    // Segmented fish body for spine undulation
    this.koiSegments = [];
    const segmentCount = 14;
    const bodyLength = 16.0;

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x0099bb,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    for (let i = 0; i < segmentCount; i++) {
      const t = i / (segmentCount - 1);
      // Profile curve: tapered head, thick middle belly, sleek tapered tail
      const radius = Math.sin(t * Math.PI) * 1.55 + 0.22;
      const zOffset = (t - 0.5) * bodyLength;

      const segGeo = new THREE.CylinderGeometry(radius * 0.9, radius, bodyLength / segmentCount, 12, 1, true);
      segGeo.rotateX(Math.PI / 2);

      const segMesh = new THREE.Mesh(segGeo, wireMat.clone());
      segMesh.position.z = zOffset;

      const innerGlow = new THREE.Mesh(segGeo, glowMat.clone());
      innerGlow.scale.set(0.85, 0.85, 0.85);
      segMesh.add(innerGlow);

      this.koiGroup.add(segMesh);
      this.koiSegments.push({
        mesh: segMesh,
        innerGlow,
        zBase: zOffset,
        t
      });
    }

    // Flowing dorsal & pectoral fins
    const finGeo = new THREE.PlaneGeometry(2.4, 4.5);
    const finMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.45,
      wireframe: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    // Pectoral Fins (Left & Right)
    this.leftFin = new THREE.Mesh(finGeo, finMat);
    this.leftFin.position.set(-1.6, -0.4, 2.5);
    this.leftFin.rotation.set(0.3, -0.5, 0.4);
    this.koiGroup.add(this.leftFin);

    this.rightFin = new THREE.Mesh(finGeo, finMat);
    this.rightFin.position.set(1.6, -0.4, 2.5);
    this.rightFin.rotation.set(0.3, 0.5, -0.4);
    this.koiGroup.add(this.rightFin);

    // Large Tail Fin
    const tailFinGeo = new THREE.PlaneGeometry(3.5, 5.0);
    this.tailFin = new THREE.Mesh(tailFinGeo, finMat);
    this.tailFin.position.set(0, 0, -bodyLength / 2 - 1.8);
    this.tailFin.rotation.y = Math.PI / 2;
    this.koiGroup.add(this.tailFin);

    this.scene.add(this.koiGroup);
  }

  // =========================================================================
  // 2. REBIRTH GEODESIC BIO-SPHERE / DNA HELIX HOLOGRAPHIC PROJECTION
  // =========================================================================
  initBioSphere() {
    this.bioGroup = new THREE.Group();
    // Suspended high above North Avenue Crossing
    this.bioGroup.position.set(0.0, 36.0, -35.0);

    // Outer Geodesic Icosahedron Wireframe
    const icoGeo = new THREE.IcosahedronGeometry(5.5, 2);
    const icoWireMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.bioSphereOuter = new THREE.Mesh(icoGeo, icoWireMat);
    this.bioGroup.add(this.bioSphereOuter);

    // Inner Glowing Core Sphere
    const innerGeo = new THREE.IcosahedronGeometry(3.2, 1);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x05df72,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.bioSphereInner = new THREE.Mesh(innerGeo, innerMat);
    this.bioGroup.add(this.bioSphereInner);

    // Orbiting Data Ring in Radiant Cyan
    const ringGeo = new THREE.TorusGeometry(7.2, 0.12, 8, 36);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00d0ff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.orbitRing1 = new THREE.Mesh(ringGeo, ringMat);
    this.orbitRing1.rotation.x = Math.PI / 3;
    this.bioGroup.add(this.orbitRing1);

    this.orbitRing2 = new THREE.Mesh(ringGeo, ringMat);
    this.orbitRing2.rotation.x = -Math.PI / 4;
    this.orbitRing2.rotation.y = Math.PI / 4;
    this.bioGroup.add(this.orbitRing2);

    this.scene.add(this.bioGroup);
  }

  // =========================================================================
  // 3. FLOATING VERTICAL CYBER GLYPH HOLOGRAM BILLBOARDS
  // =========================================================================
  initFloatingGlyphs() {
    this.glyphs = [];
    const glyphPositions = [
      { x: -16.5, y: 32.0, z: -15.0, color: 0xff00aa, scale: 1.0 },
      { x: 16.5, y: 35.0, z: -5.0, color: 0x00f0ff, scale: 1.1 },
      { x: -18.0, y: 38.0, z: 25.0, color: 0x00ff88, scale: 0.95 }
    ];

    const boxWireGeo = new THREE.BoxGeometry(4.5, 9.0, 0.3);

    glyphPositions.forEach(cfg => {
      const g = new THREE.Group();
      g.position.set(cfg.x, cfg.y, cfg.z);

      const mat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        wireframe: true,
        transparent: true,
        opacity: 0.70,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      const frame = new THREE.Mesh(boxWireGeo, mat);
      g.add(frame);

      // Inner diagonal holographic crossbars
      const crossGeo = new THREE.PlaneGeometry(3.8, 8.2);
      const crossMat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const cross = new THREE.Mesh(crossGeo, crossMat);
      g.add(cross);

      this.scene.add(g);
      this.glyphs.push({
        group: g,
        baseY: cfg.y,
        baseColor: cfg.color,
        mat,
        crossMat
      });
    });
  }

  // =========================================================================
  // ANIMATION LOOP (CALLED EVERY FRAME)
  // =========================================================================
  update(delta, time) {
    // 1. Animate Giant Cyber-Koi Fish Undulation
    if (this.koiGroup) {
      // Gentle circular path around the city skyline
      const swimRadius = 26.0;
      const swimSpeed = 0.18;
      const swimAngle = time * swimSpeed;
      const posX = Math.sin(swimAngle) * swimRadius;
      const posZ = Math.cos(swimAngle) * swimRadius * 0.85;
      const posY = this.koiBasePos.y + Math.sin(time * 0.45) * 3.2;

      this.koiGroup.position.set(posX, posY, posZ);
      // Tangent heading angle
      const heading = swimAngle + Math.PI / 2;
      this.koiGroup.rotation.y = heading;
      // Gentle roll banking into the turn
      this.koiGroup.rotation.z = Math.sin(time * 0.6) * 0.15;

      // Spine wave undulation across segments (natural swimming movement)
      this.koiSegments.forEach((seg, idx) => {
        const wave = Math.sin(time * 2.8 - seg.t * 5.5) * 1.35;
        seg.mesh.position.x = wave * seg.t;
        seg.mesh.rotation.y = Math.cos(time * 2.8 - seg.t * 5.5) * 0.28;

        // Subtle holographic scanline flicker
        const scanlineFlicker = 0.65 + 0.25 * Math.sin(time * 8.0 + idx * 0.8);
        seg.mesh.material.opacity = scanlineFlicker;
      });

      // Flap fins in sync with swim cycle
      if (this.leftFin && this.rightFin) {
        const finFlap = Math.sin(time * 2.8) * 0.35;
        this.leftFin.rotation.z = 0.4 + finFlap;
        this.rightFin.rotation.z = -0.4 - finFlap;
      }
      if (this.tailFin) {
        this.tailFin.rotation.y = Math.PI / 2 + Math.sin(time * 2.8 - 4.5) * 0.55;
      }
    }

    // 2. Animate Rebirth Geodesic Bio-Sphere
    if (this.bioGroup) {
      this.bioSphereOuter.rotation.y += delta * 0.25;
      this.bioSphereOuter.rotation.x += delta * 0.12;
      this.bioSphereInner.rotation.y -= delta * 0.45;
      this.bioSphereInner.rotation.z += delta * 0.20;

      this.orbitRing1.rotation.z += delta * 0.55;
      this.orbitRing2.rotation.z -= delta * 0.65;

      // Soft breathing bobbing
      this.bioGroup.position.y = 36.0 + Math.sin(time * 1.2) * 1.5;
    }

    // 3. Animate Floating Cyber Glyph Hologram Billboards
    if (this.glyphs) {
      this.glyphs.forEach((gl, idx) => {
        gl.group.position.y = gl.baseY + Math.sin(time * 1.5 + idx * 1.8) * 0.8;
        gl.group.rotation.y = Math.sin(time * 0.8 + idx) * 0.18;

        // Subtle glitch / transmission scanline flicker
        const flicker = 0.55 + 0.35 * Math.sin(time * 12.0 + idx * 4.0);
        gl.mat.opacity = Math.max(0.2, flicker);
      });
    }
  }
}

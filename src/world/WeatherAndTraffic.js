import * as THREE from 'three';

/**
 * Heavy Rain & Flying Sky Traffic Systems
 * - 4,500 instanced rain streaks responding to wind vector
 * - Tiny splash ripple particles on street & rooftops
 * - Distant flying vehicles on curved spline routes with 3 distinct speeds for parallax
 */

export class WeatherAndTraffic {
  constructor(scene) {
    this.scene = scene;
    this.wind = new THREE.Vector3(-0.35, -2.8, -0.15);

    this.initRain();
    this.initSplashRipples();
    this.initSkyTraffic();
  }

  initRain() {
    // 4,500 continuous rain streaks using LineSegments for top performance
    const rainCount = 4500;
    const rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(rainCount * 6);

    this.rainData = [];

    for (let i = 0; i < rainCount; i++) {
      const x = (Math.random() - 0.5) * 220;
      const y = Math.random() * 150;
      const z = (Math.random() - 0.5) * 220;
      const length = 2.4 + Math.random() * 1.8;

      const idx = i * 6;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      // React to wind vector
      positions[idx + 3] = x + this.wind.x * 0.4;
      positions[idx + 4] = y - length;
      positions[idx + 5] = z + this.wind.z * 0.4;

      this.rainData.push({
        x, y, z,
        length,
        speed: 85 + Math.random() * 45
      });
    }

    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const rainMat = new THREE.LineBasicMaterial({
      color: 0x6b82a6,
      transparent: true,
      opacity: 0.22
    });

    this.rainLines = new THREE.LineSegments(rainGeo, rainMat);
    this.scene.add(this.rainLines);
  }

  initSplashRipples() {
    // Instanced subtle splash ripples on the ground
    const rippleCount = 80;
    const ringGeo = new THREE.RingGeometry(0.38, 0.42, 16);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7fa0c7,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide
    });

    this.rippleMesh = new THREE.InstancedMesh(ringGeo, ringMat, rippleCount);
    this.rippleData = [];

    const dummy = new THREE.Object3D();

    for (let i = 0; i < rippleCount; i++) {
      const x = (Math.random() - 0.5) * 120;
      const z = (Math.random() - 0.5) * 120;
      const y = 0.05;

      this.rippleData.push({
        x, y, z,
        scale: Math.random(),
        maxScale: 1.5 + Math.random() * 1.5,
        speed: 2.5 + Math.random() * 2.0
      });

      dummy.position.set(x, y, z);
      dummy.rotation.x = -Math.PI / 2;
      dummy.scale.set(0.1, 0.1, 0.1);
      dummy.updateMatrix();
      this.rippleMesh.setMatrixAt(i, dummy.matrix);
    }

    this.rippleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.rippleMesh);
  }

  initSkyTraffic() {
    // Distant flying hovercars at 3 distinct speeds for multi-layer parallax
    this.vehicles = [];
    const vehicleCount = 48;

    const lightGeo = new THREE.SphereGeometry(0.35, 8, 8);
    
    // Front headlights: cold cyan / warm white
    const headMat = new THREE.MeshBasicMaterial({ color: 0x70e4ef });
    // Rear taillights: neon red-orange
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2a55 });

    this.headlightsMesh = new THREE.InstancedMesh(lightGeo, headMat, vehicleCount);
    this.taillightsMesh = new THREE.InstancedMesh(lightGeo, tailMat, vehicleCount);

    const dummy = new THREE.Object3D();

    // 3 distinct altitude & speed layers
    const speedTiers = [0.12, 0.24, 0.42]; // Slow, Medium, Fast parallax

    for (let i = 0; i < vehicleCount; i++) {
      const tier = i % 3;
      const speedBase = speedTiers[tier];
      const direction = (Math.random() > 0.45) ? 1 : -1;
      const radius = 60 + tier * 50 + (Math.random() - 0.5) * 25;
      const altitude = 35 + tier * 40 + Math.random() * 25;
      const angle = Math.random() * Math.PI * 2;
      const speed = speedBase * direction * (0.8 + Math.random() * 0.4);

      this.vehicles.push({
        radius,
        altitude,
        angle,
        speed,
        speedBase
      });

      dummy.position.set(0, 0, 0);
      dummy.updateMatrix();
      this.headlightsMesh.setMatrixAt(i, dummy.matrix);
      this.taillightsMesh.setMatrixAt(i, dummy.matrix);
    }

    this.headlightsMesh.instanceMatrix.needsUpdate = true;
    this.taillightsMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(this.headlightsMesh);
    this.scene.add(this.taillightsMesh);
  }

  update(delta, time) {
    // 1. Animate Rain System with Wind Reaction
    if (this.rainLines && this.rainData) {
      const pos = this.rainLines.geometry.attributes.position.array;

      for (let i = 0; i < this.rainData.length; i++) {
        const r = this.rainData[i];
        r.y -= r.speed * delta;
        r.x += this.wind.x * delta * 25;
        r.z += this.wind.z * delta * 25;

        // Reset to top when hitting the ground
        if (r.y < 0) {
          r.y = 120 + Math.random() * 30;
          r.x = (Math.random() - 0.5) * 220;
          r.z = (Math.random() - 0.5) * 220;
        }

        const idx = i * 6;
        pos[idx] = r.x;
        pos[idx + 1] = r.y;
        pos[idx + 2] = r.z;

        pos[idx + 3] = r.x + this.wind.x * 0.4;
        pos[idx + 4] = r.y - r.length;
        pos[idx + 5] = r.z + this.wind.z * 0.4;
      }

      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }

    // 2. Animate Splash Ripples
    if (this.rippleMesh && this.rippleData) {
      const dummy = new THREE.Object3D();

      for (let i = 0; i < this.rippleData.length; i++) {
        const rip = this.rippleData[i];
        rip.scale += rip.speed * delta;

        if (rip.scale > rip.maxScale) {
          rip.scale = 0.1;
          rip.x = (Math.random() - 0.5) * 120;
          rip.z = (Math.random() - 0.5) * 120;
        }

        dummy.position.set(rip.x, rip.y, rip.z);
        dummy.rotation.x = -Math.PI / 2;
        dummy.scale.set(rip.scale, rip.scale, 1);
        dummy.updateMatrix();

        this.rippleMesh.setMatrixAt(i, dummy.matrix);
      }

      this.rippleMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Animate Sky Traffic with Curved Paths and Parallax
    if (this.headlightsMesh && this.taillightsMesh) {
      const dummy = new THREE.Object3D();

      this.vehicles.forEach((v, i) => {
        v.angle += v.speed * delta;
        const x = Math.cos(v.angle) * v.radius;
        const z = Math.sin(v.angle) * v.radius;
        const y = v.altitude + Math.sin(time * 0.8 + i) * 1.5;

        // Front headlight
        dummy.position.set(x, y, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.headlightsMesh.setMatrixAt(i, dummy.matrix);

        // Rear taillight offset
        const trailOffset = v.speed > 0 ? -1.6 : 1.6;
        dummy.position.set(
          x + Math.sin(v.angle) * trailOffset,
          y,
          z - Math.cos(v.angle) * trailOffset
        );
        dummy.updateMatrix();
        this.taillightsMesh.setMatrixAt(i, dummy.matrix);
      });

      this.headlightsMesh.instanceMatrix.needsUpdate = true;
      this.taillightsMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

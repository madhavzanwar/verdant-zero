import * as THREE from 'three';

/**
 * Heavy Rain & Flying Sky Traffic Systems
 * - 2,000 GPU-animated rain streaks drifting with the wind, following the camera
 * - Tiny splash ripple particles on street & rooftops
 * - Distant flying vehicles on curved spline routes with 3 distinct speeds for parallax
 */

const RAIN_BOX = 200;

export class WeatherAndTraffic {
  constructor(scene) {
    this.scene = scene;
    this.wind = new THREE.Vector3(-0.35, -2.8, -0.15);
    this.dummy = new THREE.Object3D();

    this.maxRainCount = 2000;
    this.activeRainCount = 2000;

    this.initRain();
    this.initSplashRipples();
    this.initSkyTraffic();
  }

  initRain() {
    // Rain streaks animated entirely on the GPU: each streak stores a seed (x, z, phase, speed)
    // and the vertex shader computes its position from uTime. Nothing is uploaded per frame.
    const n = this.maxRainCount;
    const seeds = new Float32Array(n * 2 * 4);
    const ends = new Float32Array(n * 2);
    const positions = new Float32Array(n * 2 * 3); // required by three; unused by the shader

    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * RAIN_BOX;
      const z = (Math.random() - 0.5) * RAIN_BOX;
      const phase = Math.random();
      const speed = 85 + Math.random() * 45;
      for (let e = 0; e < 2; e++) {
        const v = i * 2 + e;
        seeds.set([x, z, phase, speed], v * 4);
        ends[v] = e;
      }
    }

    this.rainGeo = new THREE.BufferGeometry();
    this.rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.rainGeo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));

    this.rainUniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uColor: { value: new THREE.Color(0xa8c4e8) },
      uOpacity: { value: 0.16 },
      uWind: { value: new THREE.Vector2(this.wind.x, this.wind.z) }
    };

    const rainMat = new THREE.ShaderMaterial({
      uniforms: this.rainUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        attribute float aEnd;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec2 uWind;
        const float BOX = ${RAIN_BOX.toFixed(1)};
        const float HEIGHT = 150.0;
        void main() {
          float fall = aSeed.w;
          float y = HEIGHT - mod(aSeed.z * HEIGHT + uTime * fall, HEIGHT);
          float drift = (HEIGHT - y) / fall * 25.0;
          vec2 xz = aSeed.xy + uWind * drift;
          // Wrap the streak into a box that follows the camera
          xz = uCenter.xz + mod(xz - uCenter.xz + BOX * 0.5, BOX) - BOX * 0.5;
          float len = 2.4 + fract(aSeed.z * 13.7) * 1.8;
          vec3 p = vec3(xz.x + uWind.x * 0.4 * aEnd, y - len * aEnd, xz.y + uWind.y * 0.4 * aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          gl_FragColor = vec4(uColor * uOpacity, 1.0);
        }
      `
    });

    this.rainLines = new THREE.LineSegments(this.rainGeo, rainMat);
    this.rainLines.frustumCulled = false;
    this.scene.add(this.rainLines);
  }

  setFocus(position) {
    this.focus = position;
  }

  setQuality(tier) {
    if (tier === 'low') {
      this.activeRainCount = 1000;
    } else if (tier === 'medium') {
      this.activeRainCount = 1600;
    } else {
      this.activeRainCount = this.maxRainCount;
    }
    if (this.rainGeo) {
      this.rainGeo.setDrawRange(0, this.activeRainCount * 2);
    }
  }

  setRainAcidic(isAcidic) {
    if (!this.rainUniforms) return;
    this.rainUniforms.uColor.value.setHex(isAcidic ? 0xb2d92b : 0xa8c4e8);
    this.rainUniforms.uOpacity.value = isAcidic ? 0.32 : 0.16;
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
    this.rippleMesh.frustumCulled = false;
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

    // 3D aerodynamic cruiser chassis hulls
    const hullGeo = new THREE.ConeGeometry(0.55, 2.2, 5);
    hullGeo.rotateX(Math.PI / 2);
    hullGeo.scale(1.0, 0.45, 1.0);
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x161d2b,
      roughness: 0.65,
      metalness: 0.45
    });
    this.hullsMesh = new THREE.InstancedMesh(hullGeo, hullMat, vehicleCount);

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
      this.hullsMesh.setMatrixAt(i, dummy.matrix);
    }

    this.headlightsMesh.instanceMatrix.needsUpdate = true;
    this.taillightsMesh.instanceMatrix.needsUpdate = true;
    this.hullsMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(this.hullsMesh);
    this.scene.add(this.headlightsMesh);
    this.scene.add(this.taillightsMesh);
  }

  update(delta, time) {
    // 1. Rain (GPU) — just advance time and follow the camera focus
    if (this.rainUniforms) {
      this.rainUniforms.uTime.value = time;
      if (this.focus) this.rainUniforms.uCenter.value.copy(this.focus);
    }

    // 2. Animate Splash Ripples
    if (this.rippleMesh && this.rippleData) {
      const dummy = this.dummy;

      for (let i = 0; i < this.rippleData.length; i++) {
        const rip = this.rippleData[i];
        rip.scale += rip.speed * delta;

        if (rip.scale > rip.maxScale) {
          rip.scale = 0.1;
          const cx = this.focus ? this.focus.x : 0;
          const cz = this.focus ? this.focus.z : 0;
          rip.x = cx + (Math.random() - 0.5) * 60;
          rip.z = cz + (Math.random() - 0.5) * 60;
        }

        dummy.position.set(rip.x, rip.y, rip.z);
        dummy.rotation.x = -Math.PI / 2;
        dummy.scale.set(rip.scale, rip.scale, 1);
        dummy.updateMatrix();

        this.rippleMesh.setMatrixAt(i, dummy.matrix);
      }

      this.rippleMesh.instanceMatrix.needsUpdate = true;
    }

    // 3. Animate Sky Traffic with 3D Hulls, Banking, and Parallax
    if (this.headlightsMesh && this.taillightsMesh && this.hullsMesh) {
      const dummy = this.dummy;

      this.vehicles.forEach((v, i) => {
        v.angle += v.speed * delta;
        const x = Math.cos(v.angle) * v.radius;
        const z = Math.sin(v.angle) * v.radius;
        const y = v.altitude + Math.sin(time * 0.8 + i) * 1.5;

        // Tangent heading angle and banking into the curve
        const heading = v.angle + (v.speed > 0 ? -Math.PI / 2 : Math.PI / 2);
        const bankRoll = v.speed > 0 ? -0.18 : 0.18;

        // 3D Vehicle Hull
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, heading, bankRoll);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.hullsMesh.setMatrixAt(i, dummy.matrix);

        // Front headlight positioned at nose
        const headOffset = v.speed > 0 ? 1.1 : -1.1;
        dummy.position.set(
          x - Math.sin(v.angle) * headOffset,
          y,
          z + Math.cos(v.angle) * headOffset
        );
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.headlightsMesh.setMatrixAt(i, dummy.matrix);

        // Rear taillight positioned at tail
        const trailOffset = v.speed > 0 ? -1.1 : 1.1;
        dummy.position.set(
          x - Math.sin(v.angle) * trailOffset,
          y,
          z + Math.cos(v.angle) * trailOffset
        );
        dummy.updateMatrix();
        this.taillightsMesh.setMatrixAt(i, dummy.matrix);
      });

      this.hullsMesh.instanceMatrix.needsUpdate = true;
      this.headlightsMesh.instanceMatrix.needsUpdate = true;
      this.taillightsMesh.instanceMatrix.needsUpdate = true;
    }
  }
}

import * as THREE from 'three';

/**
 * VERDANT ZERO // Cinematic Title & Metropolis Scene
 * Dark rainy cyberpunk city at dusk with towering skyscrapers of varied heights,
 * dead gray architecture with dormant pink and purple glowing windows,
 * distant flying traffic lights, atmospheric volumetric fog,
 * a magnificent glowing emerald green pillar of life, and slow cinematic camera.
 */
export class TitleScene {
  constructor() {
    this.scene = new THREE.Scene();
    
    // Dusk twilight background & thick atmospheric volumetric fog
    this.scene.background = new THREE.Color(0x090b14);
    this.scene.fog = new THREE.FogExp2(0x0a0c16, 0.011);

    // Camera setup
    this.camera = new THREE.PerspectiveCamera(
      45,
      window.innerWidth / window.innerHeight,
      0.1,
      650
    );
    this.camera.position.set(0, 24, 60);

    // Mouse parallax controls
    this.mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.initMouseListener();

    // Arrays for animated elements
    this.trafficVehicles = [];
    this.risingRings = [];

    // Build the atmospheric world
    this.setupLighting();
    this.buildGroundAndStreets();
    this.buildSkyscrapers();
    this.buildGreenPillar();
    this.buildRainSystem();
    this.buildFlyingTraffic();
    this.buildDistantBeacons();
  }

  initMouseListener() {
    window.addEventListener('pointermove', (e) => {
      this.mouse.targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      this.mouse.targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    });
  }

  setupLighting() {
    // Dusk twilight ambient light
    const ambientLight = new THREE.AmbientLight(0x181a2e, 1.2);
    this.scene.add(ambientLight);

    // Overcast dusk key light
    const duskDirLight = new THREE.DirectionalLight(0x28304a, 1.8);
    duskDirLight.position.set(50, 100, -30);
    this.scene.add(duskDirLight);

    // Deep purple rim light representing dusk horizon reflection
    const duskHorizonLight = new THREE.DirectionalLight(0x5b21b6, 0.9);
    duskHorizonLight.position.set(-60, 40, 50);
    this.scene.add(duskHorizonLight);
  }

  buildGroundAndStreets() {
    // Wet reflective city ground plane
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x08090f,
      roughness: 0.15, // Wet asphalt reflection
      metalness: 0.8
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -10;
    this.scene.add(ground);
  }

  buildSkyscrapers() {
    const buildingGroup = new THREE.Group();

    // 1. Brutalist dead & gray monolithic buildings
    const buildingCount = 130;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    
    // Cold dead gray concrete material
    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0x161a22,
      roughness: 0.88,
      metalness: 0.2
    });

    const towerMesh = new THREE.InstancedMesh(boxGeo, concreteMat, buildingCount);
    const dummy = new THREE.Object3D();

    const buildingData = [];

    // Distribute towers radially and along city canyons, leaving center open for Green Pillar
    for (let i = 0; i < buildingCount; i++) {
      // Hollow center circle for the Green Pillar
      const angle = (i / buildingCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const radius = 22 + Math.random() * 110;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius - 10;

      const width = 6 + Math.random() * 10;
      const depth = 6 + Math.random() * 10;
      // Tall towering skyline: up to 160 units tall!
      const height = 35 + Math.random() * 125;
      const y = height / 2 - 10;

      dummy.position.set(x, y, z);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();

      towerMesh.setMatrixAt(i, dummy.matrix);
      buildingData.push({ x, y: height - 10, z, width, depth, height });
    }
    towerMesh.instanceMatrix.needsUpdate = true;
    buildingGroup.add(towerMesh);

    // 2. Glowing Pink & Purple Windows (Dead metropolis with subtle dormant neon)
    const windowCount = 180;
    const winGeo = new THREE.PlaneGeometry(1, 1);
    
    // Pink neon windows
    const pinkWinMat = new THREE.MeshBasicMaterial({
      color: 0xff1493,
      side: THREE.DoubleSide
    });
    // Purple neon windows
    const purpleWinMat = new THREE.MeshBasicMaterial({
      color: 0x9333ea,
      side: THREE.DoubleSide
    });

    const pinkWinMesh = new THREE.InstancedMesh(winGeo, pinkWinMat, windowCount);
    const purpleWinMesh = new THREE.InstancedMesh(winGeo, purpleWinMat, windowCount);

    let pinkIdx = 0;
    let purpleIdx = 0;

    buildingData.forEach((b, idx) => {
      // Add vertical window strips on selected skyscrapers
      if (idx % 2 === 0 && pinkIdx < windowCount) {
        const winW = 1.2;
        const winH = 4 + Math.random() * 8;
        const sideOffset = b.width / 2 + 0.05;
        
        dummy.position.set(b.x + sideOffset, (b.height * 0.4) - 10 + Math.random() * (b.height * 0.3), b.z);
        dummy.rotation.set(0, Math.PI / 2, 0);
        dummy.scale.set(winW, winH, 1);
        dummy.updateMatrix();
        pinkWinMesh.setMatrixAt(pinkIdx++, dummy.matrix);
      }

      if (idx % 3 === 0 && purpleIdx < windowCount) {
        const winW = 1.2;
        const winH = 5 + Math.random() * 10;
        const frontOffset = b.depth / 2 + 0.05;
        
        dummy.position.set(b.x, (b.height * 0.5) - 10 + Math.random() * (b.height * 0.3), b.z + frontOffset);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(winW, winH, 1);
        dummy.updateMatrix();
        purpleWinMesh.setMatrixAt(purpleIdx++, dummy.matrix);
      }
    });

    pinkWinMesh.instanceMatrix.needsUpdate = true;
    purpleWinMesh.instanceMatrix.needsUpdate = true;
    buildingGroup.add(pinkWinMesh);
    buildingGroup.add(purpleWinMesh);

    // 3. Rooftop Spire Antennas
    const spireGeo = new THREE.CylinderGeometry(0.1, 0.4, 20, 6);
    const spireMat = new THREE.MeshBasicMaterial({ color: 0x7c3aed });
    const spireMesh = new THREE.InstancedMesh(spireGeo, spireMat, 40);

    for (let i = 0; i < 40; i++) {
      const b = buildingData[i * 2 % buildingData.length];
      dummy.position.set(b.x, b.y + 10, b.z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      spireMesh.setMatrixAt(i, dummy.matrix);
    }
    spireMesh.instanceMatrix.needsUpdate = true;
    buildingGroup.add(spireMesh);

    this.scene.add(buildingGroup);
  }

  buildGreenPillar() {
    // Centerpiece: The Verdant Genesis Pillar of Life
    // A towering, radiant beam of bioluminescent emerald shooting straight into the dusk clouds
    this.pillarGroup = new THREE.Group();
    this.pillarGroup.position.set(0, 0, 5);

    // 1. Central Core Beam (Super radiant emerald bloom)
    const pillarHeight = 220;
    const coreGeo = new THREE.CylinderGeometry(1.6, 2.4, pillarHeight, 32, 1, true);
    this.pillarCoreMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.95
    });
    const coreBeam = new THREE.Mesh(coreGeo, this.pillarCoreMat);
    coreBeam.position.y = pillarHeight / 2 - 10;
    this.pillarGroup.add(coreBeam);

    // 2. Outer Translucent Energy Sheath
    const outerGeo = new THREE.CylinderGeometry(3.2, 4.5, pillarHeight, 32, 1, true);
    this.pillarOuterMat = new THREE.MeshBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    this.outerBeam = new THREE.Mesh(outerGeo, this.pillarOuterMat);
    this.outerBeam.position.y = pillarHeight / 2 - 10;
    this.pillarGroup.add(this.outerBeam);

    // 3. Ascending Energy Helix Rings
    this.risingRings = [];
    const ringGeo = new THREE.TorusGeometry(4.8, 0.12, 16, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.85
    });

    for (let i = 0; i < 7; i++) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = i * 28 - 5;
      this.pillarGroup.add(ring);
      this.risingRings.push({ mesh: ring, speed: 12 + i * 2 });
    }

    // 4. Ground Emission Crater & Dais
    const daisGeo = new THREE.CylinderGeometry(8, 12, 3, 32);
    const daisMat = new THREE.MeshStandardMaterial({
      color: 0x111622,
      roughness: 0.4,
      metalness: 0.8
    });
    const dais = new THREE.Mesh(daisGeo, daisMat);
    dais.position.y = -8.5;
    this.pillarGroup.add(dais);

    // Glowing ground ring
    const groundRingGeo = new THREE.RingGeometry(6, 9, 32);
    const groundRingMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      side: THREE.DoubleSide
    });
    const groundRing = new THREE.Mesh(groundRingGeo, groundRingMat);
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.y = -6.9;
    this.pillarGroup.add(groundRing);

    // 5. Powerful Emerald Point Light illuminating surrounding buildings & mist
    this.pillarLight = new THREE.PointLight(0x00ff88, 6.0, 90, 1.2);
    this.pillarLight.position.set(0, 15, 0);
    this.pillarGroup.add(this.pillarLight);

    // Secondary upper pillar light
    const upperLight = new THREE.PointLight(0x00ff88, 4.0, 120, 1.4);
    upperLight.position.set(0, 90, 0);
    this.pillarGroup.add(upperLight);

    this.scene.add(this.pillarGroup);
  }

  buildRainSystem() {
    // 3,500 Torrential Rain Streaks
    const rainCount = 3500;
    const rainGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(rainCount * 6); // 2 vertices per line streak

    this.rainData = [];

    for (let i = 0; i < rainCount; i++) {
      const x = (Math.random() - 0.5) * 160;
      const y = Math.random() * 120 - 10;
      const z = (Math.random() - 0.5) * 160;
      const length = 1.8 + Math.random() * 1.5;

      const idx = i * 6;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;

      // Slight wind slant (-0.25 on x)
      positions[idx + 3] = x - 0.25;
      positions[idx + 4] = y - length;
      positions[idx + 5] = z;

      this.rainData.push({
        x, y, z,
        length,
        speed: 75 + Math.random() * 45
      });
    }

    rainGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const rainMat = new THREE.LineBasicMaterial({
      color: 0x93c5fd,
      transparent: true,
      opacity: 0.45
    });

    this.rainLines = new THREE.LineSegments(rainGeo, rainMat);
    this.scene.add(this.rainLines);
  }

  buildFlyingTraffic() {
    // Distant flying lights cruising between skyscrapers
    this.trafficVehicles = [];
    const vehicleCount = 35;

    // Instanced mesh for flying hovercars: front cyan lights + rear pink lights
    const lightGeo = new THREE.SphereGeometry(0.35, 8, 8);
    
    const headMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff0055 });

    this.headlightsMesh = new THREE.InstancedMesh(lightGeo, headMat, vehicleCount);
    this.taillightsMesh = new THREE.InstancedMesh(lightGeo, tailMat, vehicleCount);

    const dummy = new THREE.Object3D();

    for (let i = 0; i < vehicleCount; i++) {
      const altitude = 15 + Math.random() * 85;
      const radius = 35 + Math.random() * 70;
      const speed = (0.15 + Math.random() * 0.25) * (Math.random() > 0.5 ? 1 : -1);
      const angle = Math.random() * Math.PI * 2;
      const yOffset = (Math.random() - 0.5) * 6;

      this.trafficVehicles.push({
        radius,
        altitude,
        speed,
        angle,
        yOffset
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

  buildDistantBeacons() {
    // 3 Sweeping searchlights across the dusk clouds
    this.searchlights = [];
    const beaconColors = [0x00f0ff, 0xff007f, 0x8b5cf6];

    [
      [-40, 5, -20],
      [35, 8, -40],
      [-15, 6, 45]
    ].forEach((pos, idx) => {
      const spot = new THREE.SpotLight(beaconColors[idx], 8, 180, Math.PI / 8, 0.45, 1.2);
      spot.position.set(pos[0], pos[1], pos[2]);

      const target = new THREE.Object3D();
      target.position.set(pos[0] + 15, pos[1] + 60, pos[2] + 20);
      this.scene.add(target);
      spot.target = target;

      this.scene.add(spot);
      this.searchlights.push({ spot, target, basePos: pos, speed: 0.35 + idx * 0.15 });
    });
  }

  /**
   * 60 FPS Render Tick
   * @param {number} delta Delta time in seconds
   * @param {number} time Total elapsed time
   */
  update(delta, time) {
    // 1. Slow, majestic cinematic camera dolly around the city and Green Pillar
    const camAngle = time * 0.05;
    const camRadius = 55;
    const targetCamX = Math.sin(camAngle) * camRadius;
    const targetCamZ = Math.cos(camAngle) * camRadius + 8;
    const targetCamY = 24 + Math.sin(time * 0.07) * 8;

    // Mouse parallax smoothing
    this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.04;
    this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.04;

    this.camera.position.x = targetCamX + this.mouse.x * 6;
    this.camera.position.y = targetCamY - this.mouse.y * 5;
    this.camera.position.z = targetCamZ;

    // Smoothly focus on the Verdant Green Pillar
    this.camera.lookAt(0, 22, 5);

    // 2. Animate the Verdant Green Pillar & Ascending Rings
    if (this.pillarGroup) {
      // Breathing pulse for bloom emission
      const pulse = 1.0 + Math.sin(time * 2.5) * 0.2;
      this.pillarOuterMat.opacity = 0.35 + Math.sin(time * 2.5) * 0.12;
      this.outerBeam.rotation.y = time * 0.15;

      if (this.pillarLight) {
        this.pillarLight.intensity = 5.5 + Math.sin(time * 3.0) * 1.5;
      }

      // Ascend energy rings upward continuously
      this.risingRings.forEach(item => {
        item.mesh.position.y += item.speed * delta;
        item.mesh.rotation.z = time * 0.8;
        if (item.mesh.position.y > 200) {
          item.mesh.position.y = -6;
        }
      });
    }

    // 3. Animate Rain System
    if (this.rainLines && this.rainData) {
      const positions = this.rainLines.geometry.attributes.position.array;

      for (let i = 0; i < this.rainData.length; i++) {
        const item = this.rainData[i];
        item.y -= item.speed * delta;

        // Reset to top when hitting the ground
        if (item.y < -10) {
          item.y = 100 + Math.random() * 20;
          item.x = (Math.random() - 0.5) * 160;
          item.z = (Math.random() - 0.5) * 160;
        }

        const idx = i * 6;
        positions[idx] = item.x;
        positions[idx + 1] = item.y;
        positions[idx + 2] = item.z;

        positions[idx + 3] = item.x - 0.25;
        positions[idx + 4] = item.y - item.length;
        positions[idx + 5] = item.z;
      }

      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }

    // 4. Animate Flying Traffic Lights
    if (this.headlightsMesh && this.taillightsMesh) {
      const dummy = new THREE.Object3D();

      this.trafficVehicles.forEach((v, i) => {
        v.angle += v.speed * delta;
        const x = Math.cos(v.angle) * v.radius;
        const z = Math.sin(v.angle) * v.radius - 10;
        const y = v.altitude + Math.sin(time * 1.2 + i) * 1.5 + v.yOffset;

        // Headlight (front)
        dummy.position.set(x, y, z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.headlightsMesh.setMatrixAt(i, dummy.matrix);

        // Taillight (trailing behind)
        const trailOffset = v.speed > 0 ? -1.4 : 1.4;
        dummy.position.set(x + Math.sin(v.angle) * trailOffset, y, z - Math.cos(v.angle) * trailOffset);
        dummy.updateMatrix();
        this.taillightsMesh.setMatrixAt(i, dummy.matrix);
      });

      this.headlightsMesh.instanceMatrix.needsUpdate = true;
      this.taillightsMesh.instanceMatrix.needsUpdate = true;
    }

    // 5. Animate Sweeping Searchlights
    this.searchlights.forEach((item, idx) => {
      const sweep = Math.sin(time * item.speed + idx);
      item.target.position.x = item.basePos[0] + sweep * 40;
      item.target.position.y = item.basePos[1] + 65 + Math.cos(time * item.speed * 0.9) * 15;
    });
  }

  dispose() {
    // Resource cleanup
  }
}

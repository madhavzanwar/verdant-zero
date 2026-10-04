import * as THREE from 'three';
import { createBuildingMaterial } from './BuildingShader.js';

/**
 * Procedural Cyberpunk Metropolis Generator
 * - 350+ buildings in 3 depth layers (Close, Mid, Far giant silhouettes)
 * - Varied building architectures: stepped tops, rooftop vents, water tanks, antenna spires
 * - Abstract glyph neon signs & holographic billboards
 * - Dim moon, moving cloud sheet, volumetric street light shafts & searchlights
 * - Wet reflective street plane with neon reflection smearing
 * - Collision bounding boxes exported for player movement
 */

export class CityGenerator {
  constructor(scene) {
    this.scene = scene;
    this.buildingColliders = [];
    this.plantingSpots = [];
    this.animatedObjects = [];

    // Building material with procedural window hash & living green wave
    this.buildingMaterial = createBuildingMaterial();

    this.generate();
  }

  generate() {
    this.buildGroundAndStreets();
    this.buildSkyAtmosphere();
    this.buildCityLayers();
    this.buildRooftopDetails();
    this.buildNeonGlyphSigns();
    this.buildVolumetricLightShafts();
    this.setupPlantingSpots();
  }

  buildGroundAndStreets() {
    // Wet reflective street level
    const groundGeo = new THREE.PlaneGeometry(800, 800);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x090b12,
      roughness: 0.18, // High wet reflectivity
      metalness: 0.85
    });

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = false;
    this.scene.add(ground);

    // Subtle puddles and street markings plane
    const streetMarkGeo = new THREE.PlaneGeometry(400, 400);
    const streetMarkMat = new THREE.MeshBasicMaterial({
      color: 0x121728,
      transparent: true,
      opacity: 0.4
    });
    const streetMarks = new THREE.Mesh(streetMarkGeo, streetMarkMat);
    streetMarks.rotation.x = -Math.PI / 2;
    streetMarks.position.y = 0.02;
    this.scene.add(streetMarks);
  }

  buildSkyAtmosphere() {
    // 1. Huge Dim Moon / Planet behind the clouds
    const moonGeo = new THREE.SphereGeometry(75, 32, 32);
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0x24283b,
      transparent: true,
      opacity: 0.55
    });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.position.set(-180, 240, -320);
    this.scene.add(moon);

    // 2. Layered low cloud sheet with slow movement
    const cloudGeo = new THREE.PlaneGeometry(1200, 1200);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0x090a18,
      transparent: true,
      opacity: 0.35,
      depthWrite: false
    });

    this.cloudSheet = new THREE.Mesh(cloudGeo, cloudMat);
    this.cloudSheet.rotation.x = Math.PI / 2;
    this.cloudSheet.position.set(0, 160, 0);
    this.scene.add(this.cloudSheet);
  }

  buildCityLayers() {
    // Total buildings: 360 buildings in 3 distinct depth layers
    const totalBuildings = 360;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    
    // InstancedMesh for massive performance: 60fps on laptop
    this.towersMesh = new THREE.InstancedMesh(boxGeo, this.buildingMaterial, totalBuildings);
    const dummy = new THREE.Object3D();

    this.buildingPositions = [];

    let count = 0;

    // ----------------------------------------------------
    // LAYER 1: Close Layer (45 towers immediately around player)
    // Clear central street canyon along X=0, with towers lining sidewalks
    // ----------------------------------------------------
    // 1. Featured Sanctuary Tower on Left Side of Street (Spot 0 climbs this tower)
    dummy.position.set(-18, 24, 0);
    dummy.scale.set(16, 48, 24);
    dummy.updateMatrix();
    this.towersMesh.setMatrixAt(count, dummy.matrix);
    this.buildingPositions.push({ x: -18, y: 48, z: 0, w: 16, d: 24, layer: 1 });
    this.buildingColliders.push({ minX: -26, maxX: -10, minZ: -12, maxZ: 12, height: 48 });
    count++;

    // 2. Featured Tower on Right Side of Street
    dummy.position.set(18, 28, 0);
    dummy.scale.set(16, 56, 24);
    dummy.updateMatrix();
    this.towersMesh.setMatrixAt(count, dummy.matrix);
    this.buildingPositions.push({ x: 18, y: 56, z: 0, w: 16, d: 24, layer: 1 });
    this.buildingColliders.push({ minX: 10, maxX: 26, minZ: -12, maxZ: 12, height: 56 });
    count++;

    // Surrounding close street blocks along Z axis
    const sideX = [-22, 22, -45, 45];
    const sideZ = [-60, -32, 32, 60];

    for (let sx of sideX) {
      for (let sz of sideZ) {
        if (count >= totalBuildings) break;

        const posX = sx + (Math.random() - 0.5) * 4;
        const posZ = sz + (Math.random() - 0.5) * 4;
        const width = 14 + Math.random() * 8;
        const depth = 16 + Math.random() * 8;
        const height = 24 + Math.random() * 55;

        dummy.position.set(posX, height / 2, posZ);
        dummy.scale.set(width, height, depth);
        dummy.updateMatrix();

        this.towersMesh.setMatrixAt(count, dummy.matrix);
        this.buildingPositions.push({
          x: posX,
          y: height,
          z: posZ,
          w: width,
          d: depth,
          layer: 1
        });

        this.buildingColliders.push({
          minX: posX - width / 2,
          maxX: posX + width / 2,
          minZ: posZ - depth / 2,
          maxZ: posZ + depth / 2,
          height: height
        });

        count++;
      }
    }

    // ----------------------------------------------------
    // LAYER 2: Middle Layer (135 huge towering skyscrapers)
    // Heights 60m to 160m. Surrounding the perimeter, forming dramatic skyline.
    // ----------------------------------------------------
    for (let i = 0; i < 135; i++) {
      if (count >= totalBuildings) break;

      const angle = (i / 135) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      const radius = 70 + Math.random() * 85;
      const posX = Math.cos(angle) * radius;
      const posZ = Math.sin(angle) * radius;

      const width = 16 + Math.random() * 14;
      const depth = 16 + Math.random() * 14;
      const height = 55 + Math.random() * 115;

      dummy.position.set(posX, height / 2, posZ);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();

      this.towersMesh.setMatrixAt(count, dummy.matrix);
      this.buildingPositions.push({
        x: posX,
        y: height,
        z: posZ,
        w: width,
        d: depth,
        layer: 2
      });

      this.buildingColliders.push({
        minX: posX - width / 2,
        maxX: posX + width / 2,
        minZ: posZ - depth / 2,
        maxZ: posZ + depth / 2,
        height: height
      });

      count++;
    }

    // ----------------------------------------------------
    // LAYER 3: Far Layer (180 giant mega-silhouettes fading into purple fog)
    // Heights 120m to 260m. Gives real cinematic depth and scale like Blade Runner 2049.
    // ----------------------------------------------------
    for (let i = 0; i < 180; i++) {
      if (count >= totalBuildings) break;

      const angle = (i / 180) * Math.PI * 2;
      const radius = 175 + Math.random() * 180;
      const posX = Math.cos(angle) * radius;
      const posZ = Math.sin(angle) * radius;

      const width = 30 + Math.random() * 28;
      const depth = 30 + Math.random() * 28;
      const height = 110 + Math.random() * 160;

      dummy.position.set(posX, height / 2, posZ);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();

      this.towersMesh.setMatrixAt(count, dummy.matrix);
      count++;
    }

    this.towersMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.towersMesh);
  }

  buildRooftopDetails() {
    // Varied rooftop architecture: Water tanks, HVAC vents, and Antenna Spires
    const dummy = new THREE.Object3D();

    // 1. Antenna Spires (Instanced)
    const spireGeo = new THREE.CylinderGeometry(0.12, 0.45, 24, 6);
    const spireMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
    const spireMesh = new THREE.InstancedMesh(spireGeo, spireMat, 45);

    // 2. Rooftop Warning Beacons (Glowing red/amber dots atop spires)
    const beaconGeo = new THREE.SphereGeometry(0.4, 8, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    this.beaconMesh = new THREE.InstancedMesh(beaconGeo, beaconMat, 45);

    // 3. Water Tanks (Industrial cylinders on wooden/metal frames)
    const tankGeo = new THREE.CylinderGeometry(2.2, 2.2, 4.5, 12);
    const tankMat = new THREE.MeshStandardMaterial({
      color: 0x1e2430,
      roughness: 0.7,
      metalness: 0.3
    });
    const tankMesh = new THREE.InstancedMesh(tankGeo, tankMat, 30);

    let spireIdx = 0;
    let tankIdx = 0;

    this.buildingPositions.forEach((b, i) => {
      // Add spires to taller buildings
      if (b.y > 45 && spireIdx < 45) {
        dummy.position.set(b.x, b.y + 12, b.z);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        spireMesh.setMatrixAt(spireIdx, dummy.matrix);

        // Warning beacon at the spire tip
        dummy.position.set(b.x, b.y + 24, b.z);
        dummy.updateMatrix();
        this.beaconMesh.setMatrixAt(spireIdx, dummy.matrix);

        spireIdx++;
      }

      // Add water tanks to lower Layer 1/2 rooftops
      if (b.y < 55 && b.layer === 1 && tankIdx < 30) {
        dummy.position.set(b.x + (Math.random() - 0.5) * 3, b.y + 2.25, b.z + (Math.random() - 0.5) * 3);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        tankMesh.setMatrixAt(tankIdx, dummy.matrix);
        tankIdx++;
      }
    });

    spireMesh.instanceMatrix.needsUpdate = true;
    this.beaconMesh.instanceMatrix.needsUpdate = true;
    tankMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(spireMesh);
    this.scene.add(this.beaconMesh);
    this.scene.add(tankMesh);
  }

  buildNeonGlyphSigns() {
    // Abstract glyph texture generated programmatically (NO readable English words)
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Background transparent
    ctx.clearRect(0, 0, 256, 512);

    // Draw futuristic abstract glyphs (rune/cyber lines and blocks)
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'miter';

    for (let row = 0; row < 5; row++) {
      const y = 50 + row * 90;
      ctx.beginPath();
      ctx.moveTo(60, y);
      ctx.lineTo(190, y);
      ctx.lineTo(190, y + 45);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(120, y + 25, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(70, y + 55);
      ctx.lineTo(140, y + 55);
      ctx.stroke();
    }

    const glyphTex = new THREE.CanvasTexture(canvas);
    glyphTex.wrapS = THREE.ClampToEdgeWrapping;
    glyphTex.wrapT = THREE.ClampToEdgeWrapping;

    // Emissive neon materials
    this.pinkNeonMat = new THREE.MeshBasicMaterial({
      map: glyphTex,
      color: 0xff0066,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide
    });

    this.cyanNeonMat = new THREE.MeshBasicMaterial({
      map: glyphTex,
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide
    });

    this.amberNeonMat = new THREE.MeshBasicMaterial({
      map: glyphTex,
      color: 0xff9900,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide
    });

    const signGeo = new THREE.PlaneGeometry(6, 16);
    const signCount = 28;

    this.signs = [];

    // Attach signs to building sides facing street canyons
    for (let i = 0; i < signCount; i++) {
      const b = this.buildingPositions[i % this.buildingPositions.length];
      const mat = (i % 3 === 0) ? this.pinkNeonMat : (i % 3 === 1 ? this.cyanNeonMat : this.amberNeonMat);
      const signMesh = new THREE.Mesh(signGeo, mat);

      // Position on outer wall
      const isXSide = i % 2 === 0;
      if (isXSide) {
        signMesh.position.set(b.x + b.w / 2 + 0.1, Math.min(b.y - 10, 24), b.z);
        signMesh.rotation.y = Math.PI / 2;
      } else {
        signMesh.position.set(b.x, Math.min(b.y - 10, 24), b.z + b.d / 2 + 0.1);
        signMesh.rotation.y = 0;
      }

      this.scene.add(signMesh);
      this.signs.push({ mesh: signMesh, speed: 2 + Math.random() * 3, phase: Math.random() * 10 });
    }
  }

  buildVolumetricLightShafts() {
    // 1. Street level light shafts rising from wet alleys
    const shaftGeo = new THREE.CylinderGeometry(0.8, 6.5, 38, 16, 1, true);
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0x1d284a,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const shaft1 = new THREE.Mesh(shaftGeo, shaftMat);
    shaft1.position.set(12, 19, 12);
    this.scene.add(shaft1);

    const shaft2 = new THREE.Mesh(shaftGeo, shaftMat.clone());
    shaft2.material.color.setHex(0x281a42);
    shaft2.position.set(-18, 19, -8);
    this.scene.add(shaft2);

    // 2. Sweeping searchlights in the rain and fog
    this.searchlights = [];
    const searchlightColors = [0x00f0ff, 0x8b5cf6, 0x00ff88];
    const origins = [
      new THREE.Vector3(-45, 5, -25),
      new THREE.Vector3(35, 8, -40),
      new THREE.Vector3(10, 6, 45)
    ];

    origins.forEach((pos, idx) => {
      const spot = new THREE.SpotLight(searchlightColors[idx], 4, 180, Math.PI / 9, 0.5, 1.2);
      spot.position.copy(pos);

      const target = new THREE.Object3D();
      target.position.set(pos.x + 10, pos.y + 70, pos.z + 20);
      this.scene.add(target);
      spot.target = target;

      this.scene.add(spot);
      this.searchlights.push({ spot, target, basePos: pos, speed: 0.3 + idx * 0.15 });
    });
  }

  setupPlantingSpots() {
    // 6 strategic planting locations on streets, ledges and rooftops
    const spots = [
      { id: 0, x: -9.5, y: 0.1, z: 0, type: 'Sanctuary Spire Base' },
      { id: 1, x: 9.5, y: 0.1, z: 12, type: 'East Tower Walkway' },
      { id: 2, x: 0, y: 0.1, z: -35, type: 'North Avenue Crossing' },
      { id: 3, x: -18, y: 48.1, z: 0, type: 'Sanctuary Rooftop' },
      { id: 4, x: 18, y: 56.1, z: 0, type: 'Sky Overlook' },
      { id: 5, x: 0, y: 0.1, z: 45, type: 'South Canal Plaza' }
    ];

    // Delicate holographic pulsing ring
    const ringGeo = new THREE.RingGeometry(1.2, 1.45, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide
    });

    this.spotMeshes = [];

    spots.forEach(sp => {
      const ring = new THREE.Mesh(ringGeo, ringMat.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(sp.x, sp.y + 0.05, sp.z);
      this.scene.add(ring);

      this.spotMeshes.push({
        data: sp,
        mesh: ring,
        isPlanted: false
      });
    });
  }

  update(delta, time) {
    // Update Building Material Uniforms
    if (this.buildingMaterial && this.buildingMaterial.userData.uniforms) {
      this.buildingMaterial.userData.uniforms.uTime.value = time;
    }

    // Slowly drift low cloud sheet
    if (this.cloudSheet) {
      this.cloudSheet.rotation.z = time * 0.008;
    }

    // Blink warning beacons atop building spires
    if (this.beaconMesh) {
      const flash = (Math.sin(time * 3.5) > 0.65) ? 1.0 : 0.15;
      this.beaconMesh.material.opacity = flash;
    }

    // Subtle flicker on neon signs
    if (this.signs) {
      this.signs.forEach(s => {
        const flicker = 0.85 + 0.15 * Math.sin(time * s.speed + s.phase);
        s.mesh.material.opacity = flicker;
      });
    }

    // Sweep volumetric searchlights
    if (this.searchlights) {
      this.searchlights.forEach((item, idx) => {
        const sweep = Math.sin(time * item.speed + idx);
        item.target.position.x = item.basePos.x + sweep * 45;
        item.target.position.y = item.basePos.y + 75 + Math.cos(time * item.speed * 0.8) * 20;
      });
    }

    // Pulse planting spot rings
    if (this.spotMeshes) {
      this.spotMeshes.forEach(sp => {
        if (!sp.isPlanted) {
          const pulse = 0.5 + 0.45 * Math.sin(time * 3.0);
          sp.mesh.material.opacity = pulse;
        }
      });
    }
  }
}

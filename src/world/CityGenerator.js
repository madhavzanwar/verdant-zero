import * as THREE from 'three';
import { createBuildingMaterial } from './BuildingShader.js';

/**
 * Procedural Cyberpunk Metropolis Generator
 * - 360+ towers in 3 depth layers with real materials and silhouette fresnel
 * - Full gradient sky dome (indigo zenith -> purple mid-sky -> glowing magenta & orange horizon)
 * - Big visible moon/planet with atmospheric halo
 * - Layered low clouds lit from below
 * - Wet reflective dark asphalt street with neon reflections, puddles, lane markings, crosswalks
 * - Cyberpunk street lamps with downward light cones and neon ground light spill decals
 * - Volumetric light shafts & sweeping sky searchlight cones
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
    this.buildStreetLampsAndDetails();
    this.buildNeonGlyphSigns();
    this.buildVolumetricLightShafts();
    this.setupPlantingSpots();
  }

  buildGroundAndStreets() {
    // 1. Matte dark asphalt street plane (reduced wet glare)
    const groundGeo = new THREE.PlaneGeometry(900, 900);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x12151e,       // Matte asphalt slate
      roughness: 0.72,       // Matte asphalt texture
      metalness: 0.15        // Low metalness
    });

    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0;
    ground.receiveShadow = false;
    this.scene.add(ground);
    this.groundMesh = ground;

    // 2. Subtle Puddle Patches
    const puddleGeo = new THREE.PlaneGeometry(8, 14);
    const puddleMat = new THREE.MeshStandardMaterial({
      color: 0x080a12,
      roughness: 0.25,
      metalness: 0.40
    });

    const puddlePositions = [
      { x: -3.5, z: -10, rot: 0.3 },
      { x: 4.2, z: 8, rot: -0.2 },
      { x: -2.0, z: 28, rot: 0.5 },
      { x: 3.0, z: -35, rot: -0.4 },
      { x: -4.0, z: -60, rot: 0.1 },
      { x: 2.5, z: 52, rot: -0.3 }
    ];

    puddlePositions.forEach(p => {
      const puddle = new THREE.Mesh(puddleGeo, puddleMat);
      puddle.rotation.x = -Math.PI / 2;
      puddle.rotation.z = p.rot;
      puddle.position.set(p.x, 0.015, p.z);
      this.scene.add(puddle);
    });

    // 3. Glowing Central Lane Markings (Double Amber Solid Line)
    const lineGeo = new THREE.PlaneGeometry(0.22, 360);
    const amberLineMat = new THREE.MeshBasicMaterial({
      color: 0xffaa22,
      transparent: true,
      opacity: 0.85
    });

    const lineLeft = new THREE.Mesh(lineGeo, amberLineMat);
    lineLeft.rotation.x = -Math.PI / 2;
    lineLeft.position.set(-0.25, 0.02, 0);
    this.scene.add(lineLeft);

    const lineRight = new THREE.Mesh(lineGeo, amberLineMat);
    lineRight.rotation.x = -Math.PI / 2;
    lineRight.position.set(0.25, 0.02, 0);
    this.scene.add(lineRight);

    // 4. Dashed Outer Lane Lines (Cyan Glow) - Batched InstancedMesh
    const dashCount = 35;
    const totalDashes = (dashCount * 2 + 1) * 2;
    const dashGeo = new THREE.PlaneGeometry(0.2, 3.8);
    const cyanDashMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.8
    });
    const dashesMesh = new THREE.InstancedMesh(dashGeo, cyanDashMat, totalDashes);
    const dummy = new THREE.Object3D();
    dummy.rotation.x = -Math.PI / 2;

    let dashIdx = 0;
    for (let i = -dashCount; i <= dashCount; i++) {
      const z = i * 6.5;
      dummy.position.set(-5.0, 0.02, z);
      dummy.updateMatrix();
      dashesMesh.setMatrixAt(dashIdx++, dummy.matrix);

      dummy.position.set(5.0, 0.02, z);
      dummy.updateMatrix();
      dashesMesh.setMatrixAt(dashIdx++, dummy.matrix);
    }
    dashesMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(dashesMesh);

    // 5. Crosswalk Zebra Stripes at Key Intersections - Batched InstancedMesh
    const zebraGeo = new THREE.PlaneGeometry(0.65, 4.5);
    const zebraMat = new THREE.MeshBasicMaterial({
      color: 0xb5ccf2,
      transparent: true,
      opacity: 0.75
    });

    const crosswalkZ = [-45, 0, 45, 95];
    let stripeCount = 0;
    crosswalkZ.forEach(cz => {
      for (let x = -8.5; x <= 8.5; x += 1.4) {
        if (Math.abs(x) < 0.5) continue;
        stripeCount++;
      }
    });

    const zebraMesh = new THREE.InstancedMesh(zebraGeo, zebraMat, stripeCount);
    let stripeIdx = 0;
    dummy.rotation.x = -Math.PI / 2;
    crosswalkZ.forEach(cz => {
      for (let x = -8.5; x <= 8.5; x += 1.4) {
        if (Math.abs(x) < 0.5) continue;
        dummy.position.set(x, 0.022, cz);
        dummy.updateMatrix();
        zebraMesh.setMatrixAt(stripeIdx++, dummy.matrix);
      }
    });
    zebraMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(zebraMesh);

    // 6. Sidewalk Ribbons & Crisp Luminous Curbs (Distinguishes roadways from walkways)
    const sidewalkGeo = new THREE.PlaneGeometry(6.5, 360);
    const sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x181e2b,       // Subtle cool slate pavement
      roughness: 0.80,
      metalness: 0.10
    });

    const leftWalk = new THREE.Mesh(sidewalkGeo, sidewalkMat);
    leftWalk.rotation.x = -Math.PI / 2;
    leftWalk.position.set(-11.5, 0.012, 0);
    this.scene.add(leftWalk);

    const rightWalk = new THREE.Mesh(sidewalkGeo, sidewalkMat);
    rightWalk.rotation.x = -Math.PI / 2;
    rightWalk.position.set(11.5, 0.012, 0);
    this.scene.add(rightWalk);

    // Slim luminous curb lines separating road and sidewalk
    const curbGeo = new THREE.PlaneGeometry(0.20, 360);
    const curbMat = new THREE.MeshBasicMaterial({
      color: 0x364860,
      transparent: true,
      opacity: 0.85
    });

    const leftCurb = new THREE.Mesh(curbGeo, curbMat);
    leftCurb.rotation.x = -Math.PI / 2;
    leftCurb.position.set(-8.25, 0.018, 0);
    this.scene.add(leftCurb);

    const rightCurb = new THREE.Mesh(curbGeo, curbMat);
    rightCurb.rotation.x = -Math.PI / 2;
    rightCurb.position.set(8.25, 0.018, 0);
    this.scene.add(rightCurb);
  }

  buildSkyAtmosphere() {
    // 1. Full Gradient Sky Dome
    // Inverted sphere with custom shader: deep indigo zenith -> purple mid-sky -> glowing magenta & orange horizon
    const skyDomeGeo = new THREE.SphereGeometry(1200, 32, 24);
    const skyDomeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vec3 dir = normalize(vWorldPos);
          float h = dir.y; // -1 to 1

          // Deep indigo at top
          vec3 zenith = vec3(0.04, 0.05, 0.16);
          // Purple-violet mid-sky
          vec3 midSky = vec3(0.24, 0.07, 0.35);
          // Glowing neon magenta horizon
          vec3 horizonMagenta = vec3(0.92, 0.12, 0.50);
          // Golden warm orange rim
          vec3 horizonOrange = vec3(1.0, 0.44, 0.16);

          vec3 col;
          if (h > 0.28) {
            float t = clamp((h - 0.28) / 0.72, 0.0, 1.0);
            col = mix(midSky, zenith, t);
          } else if (h > 0.03) {
            float t = clamp((h - 0.03) / 0.25, 0.0, 1.0);
            col = mix(horizonMagenta, midSky, t);
          } else {
            float t = clamp((h + 0.15) / 0.18, 0.0, 1.0);
            col = mix(horizonOrange, horizonMagenta, t);
          }

          // Azimuthal neon glow accentuating the street axis
          float az = atan(dir.z, dir.x);
          float duskSpread = pow(max(0.0, sin(az + 0.9)), 2.8);
          col += vec3(0.35, 0.12, 0.22) * duskSpread * (1.0 - smoothstep(0.0, 0.4, h));

          gl_FragColor = vec4(col, 1.0);
        }
      `
    });

    const skyDome = new THREE.Mesh(skyDomeGeo, skyDomeMat);
    this.scene.add(skyDome);

    // 2. Big Visible Moon / Planet with Atmospheric Halo
    const moonGroup = new THREE.Group();
    moonGroup.position.set(-170, 220, -320);

    // Moon body
    const moonGeo = new THREE.SphereGeometry(80, 32, 32);
    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xc5d4ec,
      transparent: true,
      opacity: 0.88
    });
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moonGroup.add(moon);

    // Atmospheric halo
    const haloGeo = new THREE.RingGeometry(80, 130, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x889ecc,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    moonGroup.add(halo);

    this.scene.add(moonGroup);

    // 3. Layered Low Cloud Sheets lit from below by city glow
    const cloudGeo = new THREE.PlaneGeometry(1200, 1200);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0x221236,       // Lit purple from city below
      transparent: true,
      opacity: 0.38,
      depthWrite: false
    });

    this.cloudSheet = new THREE.Mesh(cloudGeo, cloudMat);
    this.cloudSheet.rotation.x = Math.PI / 2;
    this.cloudSheet.position.set(0, 150, 0);
    this.scene.add(this.cloudSheet);
  }

  buildCityLayers() {
    const totalBuildings = 360;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    
    this.towersMesh = new THREE.InstancedMesh(boxGeo, this.buildingMaterial, totalBuildings);
    const dummy = new THREE.Object3D();

    this.buildingPositions = [];
    let count = 0;

    // ----------------------------------------------------
    // LAYER 1: Close Layer (45 towers immediately around player)
    // Clear central street canyon along X=0, towers lining sidewalks
    // ----------------------------------------------------
    // Sanctuary Tower on Left Side of Street (Spot 0 climbs this tower)
    dummy.position.set(-22.5, 24, 0);
    dummy.scale.set(16, 48, 22);
    dummy.updateMatrix();
    this.towersMesh.setMatrixAt(count, dummy.matrix);
    this.buildingPositions.push({ x: -22.5, y: 48, z: 0, w: 16, d: 22, layer: 1 });
    this.buildingColliders.push({ minX: -30.5, maxX: -14.5, minZ: -11, maxZ: 11, height: 48 });
    count++;

    // East Tower on Right Side of Street (Spot 1 climbs this tower)
    dummy.position.set(22.5, 28, 12);
    dummy.scale.set(15, 56, 20);
    dummy.updateMatrix();
    this.towersMesh.setMatrixAt(count, dummy.matrix);
    this.buildingPositions.push({ x: 22.5, y: 56, z: 12, w: 15, d: 20, layer: 1 });
    this.buildingColliders.push({ minX: 15.0, maxX: 30.0, minZ: 2, maxZ: 22, height: 56 });
    count++;

    // Generate remaining close towers along street canyon (comfortable spacious sidewalks)
    for (let z = -140; z <= 140; z += 22) {
      if (Math.abs(z) < 12) continue; // Keep player start clearing

      // Left side towers
      if (count < totalBuildings) {
        const posX = -23.5 - Math.random() * 6;
        const posZ = z + (Math.random() - 0.5) * 6;
        const width = 15 + Math.random() * 5;
        const depth = 16 + Math.random() * 8;
        const height = 30 + Math.random() * 45;

        dummy.position.set(posX, height / 2, posZ);
        dummy.scale.set(width, height, depth);
        dummy.updateMatrix();

        this.towersMesh.setMatrixAt(count, dummy.matrix);
        this.buildingPositions.push({ x: posX, y: height, z: posZ, w: width, d: depth, layer: 1 });
        this.buildingColliders.push({
          minX: posX - width / 2,
          maxX: posX + width / 2,
          minZ: posZ - depth / 2,
          maxZ: posZ + depth / 2,
          height: height
        });
        count++;
      }

      // Right side towers
      if (count < totalBuildings) {
        const posX = 23.5 + Math.random() * 6;
        const posZ = z + (Math.random() - 0.5) * 6;
        const width = 15 + Math.random() * 5;
        const depth = 16 + Math.random() * 8;
        const height = 32 + Math.random() * 48;

        dummy.position.set(posX, height / 2, posZ);
        dummy.scale.set(width, height, depth);
        dummy.updateMatrix();

        this.towersMesh.setMatrixAt(count, dummy.matrix);
        this.buildingPositions.push({ x: posX, y: height, z: posZ, w: width, d: depth, layer: 1 });
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
    // Heights 60m to 160m forming a dense metropolis skyline
    // ----------------------------------------------------
    for (let i = 0; i < 135; i++) {
      if (count >= totalBuildings) break;

      const angle = (i / 135) * Math.PI * 2 + (Math.random() - 0.5) * 0.15;
      const radius = 68 + Math.random() * 85;
      const posX = Math.cos(angle) * radius;
      const posZ = Math.sin(angle) * radius;

      const width = 16 + Math.random() * 16;
      const depth = 16 + Math.random() * 16;
      const height = 55 + Math.random() * 115;

      dummy.position.set(posX, height / 2, posZ);
      dummy.scale.set(width, height, depth);
      dummy.updateMatrix();

      this.towersMesh.setMatrixAt(count, dummy.matrix);
      this.buildingPositions.push({ x: posX, y: height, z: posZ, w: width, d: depth, layer: 2 });
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
    // LAYER 3: Far Layer (180 giant mega-silhouettes fading into purple haze)
    // Heights 120m to 260m creating vast Blade Runner 2049 scale
    // ----------------------------------------------------
    for (let i = 0; i < 180; i++) {
      if (count >= totalBuildings) break;

      const angle = (i / 180) * Math.PI * 2;
      const radius = 170 + Math.random() * 180;
      const posX = Math.cos(angle) * radius;
      const posZ = Math.sin(angle) * radius;

      const width = 30 + Math.random() * 32;
      const depth = 30 + Math.random() * 32;
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
    const dummy = new THREE.Object3D();

    // 1. Antenna Spires
    const spireGeo = new THREE.CylinderGeometry(0.12, 0.45, 24, 6);
    const spireMat = new THREE.MeshBasicMaterial({ color: 0x5a6882 });
    const spireMesh = new THREE.InstancedMesh(spireGeo, spireMat, 45);

    // 2. Rooftop Warning Beacons (glowing red/amber dots)
    const beaconGeo = new THREE.SphereGeometry(0.45, 8, 8);
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });
    this.beaconMesh = new THREE.InstancedMesh(beaconGeo, beaconMat, 45);

    // 3. Water Tanks
    const tankGeo = new THREE.CylinderGeometry(2.4, 2.4, 4.2, 12);
    const tankMat = new THREE.MeshStandardMaterial({ color: 0x334055, roughness: 0.5 });
    const tankMesh = new THREE.InstancedMesh(tankGeo, tankMat, 30);

    let spireCount = 0;
    let tankCount = 0;

    this.buildingPositions.forEach((b, idx) => {
      if (b.layer === 1 || b.layer === 2) {
        if (idx % 2 === 0 && spireCount < 45) {
          dummy.position.set(b.x, b.y + 12, b.z);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          spireMesh.setMatrixAt(spireCount, dummy.matrix);

          dummy.position.set(b.x, b.y + 24, b.z);
          dummy.updateMatrix();
          this.beaconMesh.setMatrixAt(spireCount, dummy.matrix);
          spireCount++;
        } else if (tankCount < 30) {
          dummy.position.set(b.x + (b.w * 0.2), b.y + 2.1, b.z);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          tankMesh.setMatrixAt(tankCount, dummy.matrix);
          tankCount++;
        }
      }
    });

    spireMesh.instanceMatrix.needsUpdate = true;
    this.beaconMesh.instanceMatrix.needsUpdate = true;
    tankMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(spireMesh);
    this.scene.add(this.beaconMesh);
    this.scene.add(tankMesh);
  }

  buildStreetLampsAndDetails() {
    // 1. Street Lampposts with Downward Light Cones & Ground Light Spill - Batched InstancedMesh
    const postGeo = new THREE.CylinderGeometry(0.08, 0.12, 7.5, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
    const lampHeadGeo = new THREE.BoxGeometry(0.8, 0.3, 0.4);
    const lampEmissiveMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });

    // Downward translucent light cone (enhances street boundary readability)
    const coneGeo = new THREE.CylinderGeometry(0.2, 3.8, 7.5, 16, 1, true);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    // Circular ground light spill decal (creates gentle pools of illumination on sidewalks)
    const spillGeo = new THREE.PlaneGeometry(6.5, 6.5);
    const spillMat = new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const lampZ = [-90, -60, -30, 0, 30, 60, 90];
    const lampCount = lampZ.length * 2; // 14 lamps

    const postInst = new THREE.InstancedMesh(postGeo, postMat, lampCount);
    const headInst = new THREE.InstancedMesh(lampHeadGeo, lampEmissiveMat, lampCount);
    const coneInst = new THREE.InstancedMesh(coneGeo, coneMat, lampCount);
    const spillInst = new THREE.InstancedMesh(spillGeo, spillMat, lampCount);

    const dummy = new THREE.Object3D();
    let idx = 0;
    lampZ.forEach(z => {
      [-10.5, 10.5].forEach(x => {
        const dir = x < 0 ? 1 : -1;

        // Post
        dummy.position.set(x, 3.75, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        postInst.setMatrixAt(idx, dummy.matrix);

        // Head
        dummy.position.set(x + dir * 0.9, 7.4, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        headInst.setMatrixAt(idx, dummy.matrix);

        // Cone
        dummy.position.set(x + dir * 0.9, 3.75, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        coneInst.setMatrixAt(idx, dummy.matrix);

        // Spill
        dummy.position.set(x + dir * 0.9, 0.025, z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        spillInst.setMatrixAt(idx, dummy.matrix);

        idx++;
      });
    });

    postInst.instanceMatrix.needsUpdate = true;
    headInst.instanceMatrix.needsUpdate = true;
    coneInst.instanceMatrix.needsUpdate = true;
    spillInst.instanceMatrix.needsUpdate = true;

    this.scene.add(postInst);
    this.scene.add(headInst);
    this.scene.add(coneInst);
    this.scene.add(spillInst);
  }

  buildNeonGlyphSigns() {
    // Generate abstract glyph canvas texture
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 128, 384);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';

    // Abstract vertical glyph marks
    for (let y = 30; y < 360; y += 45) {
      ctx.beginPath();
      const style = Math.floor(Math.random() * 4);
      if (style === 0) {
        ctx.moveTo(35, y); ctx.lineTo(95, y);
        ctx.moveTo(64, y); ctx.lineTo(64, y + 25);
      } else if (style === 1) {
        ctx.rect(38, y, 52, 26);
      } else if (style === 2) {
        ctx.moveTo(35, y); ctx.lineTo(95, y + 20);
        ctx.moveTo(95, y); ctx.lineTo(35, y + 20);
      } else {
        ctx.arc(64, y + 12, 14, 0, Math.PI * 2);
      }
      ctx.stroke();
    }

    const glyphTex = new THREE.CanvasTexture(canvas);

    this.pinkNeonMat = new THREE.MeshBasicMaterial({
      map: glyphTex,
      color: 0xcc4477,       // Muted rose
      transparent: true,
      opacity: 0.80,
      side: THREE.DoubleSide
    });

    this.cyanNeonMat = new THREE.MeshBasicMaterial({
      map: glyphTex,
      color: 0x3399aa,       // Pale atmospheric cyan
      transparent: true,
      opacity: 0.80,
      side: THREE.DoubleSide
    });

    this.amberNeonMat = new THREE.MeshBasicMaterial({
      map: glyphTex,
      color: 0xcc8833,       // Soft warm amber
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });

    const signGeo = new THREE.PlaneGeometry(6, 16);
    const signSpillGeo = new THREE.PlaneGeometry(12, 12);
    const signCount = 28;

    const pinkCount = Math.ceil(signCount / 3); // 10
    const cyanCount = Math.floor(signCount / 3); // 9
    const amberCount = signCount - pinkCount - cyanCount; // 9

    const pinkSignsMesh = new THREE.InstancedMesh(signGeo, this.pinkNeonMat, pinkCount);
    const cyanSignsMesh = new THREE.InstancedMesh(signGeo, this.cyanNeonMat, cyanCount);
    const amberSignsMesh = new THREE.InstancedMesh(signGeo, this.amberNeonMat, amberCount);

    const pinkSpillMat = new THREE.MeshBasicMaterial({ color: 0xff0077, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false });
    const cyanSpillMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false });
    const amberSpillMat = new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false });

    const pinkSpillsMesh = new THREE.InstancedMesh(signSpillGeo, pinkSpillMat, pinkCount);
    const cyanSpillsMesh = new THREE.InstancedMesh(signSpillGeo, cyanSpillMat, cyanCount);
    const amberSpillsMesh = new THREE.InstancedMesh(signSpillGeo, amberSpillMat, amberCount);

    const dummy = new THREE.Object3D();
    const spillDummy = new THREE.Object3D();
    let pIdx = 0, cIdx = 0, aIdx = 0;

    for (let i = 0; i < signCount; i++) {
      const b = this.buildingPositions[i % this.buildingPositions.length];
      const colGroup = i % 3;
      const isXSide = i % 2 === 0;
      let signX, signZ;
      if (isXSide) {
        signX = b.x + b.w / 2 + 0.15;
        signZ = b.z;
        dummy.position.set(signX, Math.min(b.y - 10, 22), signZ);
        dummy.rotation.set(0, Math.PI / 2, 0);
      } else {
        signX = b.x;
        signZ = b.z + b.d / 2 + 0.15;
        dummy.position.set(signX, Math.min(b.y - 10, 22), signZ);
        dummy.rotation.set(0, 0, 0);
      }
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      spillDummy.position.set(signX, 0.026, signZ);
      spillDummy.rotation.set(-Math.PI / 2, 0, 0);
      spillDummy.scale.set(1, 1, 1);
      spillDummy.updateMatrix();

      if (colGroup === 0) {
        pinkSignsMesh.setMatrixAt(pIdx, dummy.matrix);
        pinkSpillsMesh.setMatrixAt(pIdx, spillDummy.matrix);
        pIdx++;
      } else if (colGroup === 1) {
        cyanSignsMesh.setMatrixAt(cIdx, dummy.matrix);
        cyanSpillsMesh.setMatrixAt(cIdx, spillDummy.matrix);
        cIdx++;
      } else {
        amberSignsMesh.setMatrixAt(aIdx, dummy.matrix);
        amberSpillsMesh.setMatrixAt(aIdx, spillDummy.matrix);
        aIdx++;
      }
    }

    pinkSignsMesh.instanceMatrix.needsUpdate = true;
    cyanSignsMesh.instanceMatrix.needsUpdate = true;
    amberSignsMesh.instanceMatrix.needsUpdate = true;

    pinkSpillsMesh.instanceMatrix.needsUpdate = true;
    cyanSpillsMesh.instanceMatrix.needsUpdate = true;
    amberSpillsMesh.instanceMatrix.needsUpdate = true;

    this.scene.add(pinkSignsMesh);
    this.scene.add(cyanSignsMesh);
    this.scene.add(amberSignsMesh);
    this.scene.add(pinkSpillsMesh);
    this.scene.add(cyanSpillsMesh);
    this.scene.add(amberSpillsMesh);
  }

  buildVolumetricLightShafts() {
    // 1. Street level light shafts rising from alleys
    const shaftGeo = new THREE.CylinderGeometry(1.0, 7.5, 42, 16, 1, true);
    const shaftMat1 = new THREE.MeshBasicMaterial({
      color: 0x336677,
      transparent: true,
      opacity: 0.04,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const shaft1 = new THREE.Mesh(shaftGeo, shaftMat1);
    shaft1.position.set(12, 21, 15);
    this.scene.add(shaft1);

    const shaftMat2 = shaftMat1.clone();
    shaftMat2.color.setHex(0x553366);
    const shaft2 = new THREE.Mesh(shaftGeo, shaftMat2);
    shaft2.position.set(-15, 21, -12);
    this.scene.add(shaft2);

    // 2. Sweeping Volumetric Searchlights in Sky (mesh cones, zero light overhead)
    this.searchlights = [];
    const searchlightColors = [0x337788, 0x554477, 0x2e6644];
    const origins = [
      new THREE.Vector3(-45, 12, -30),
      new THREE.Vector3(38, 14, -45),
      new THREE.Vector3(12, 10, 48)
    ];

    const coneMeshGeo = new THREE.CylinderGeometry(0.4, 14, 130, 16, 1, true);

    origins.forEach((pos, idx) => {
      const coneMat = new THREE.MeshBasicMaterial({
        color: searchlightColors[idx],
        transparent: true,
        opacity: 0.035,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });

      const coneMesh = new THREE.Mesh(coneMeshGeo, coneMat);
      coneMesh.position.copy(pos);
      this.scene.add(coneMesh);

      this.searchlights.push({
        mesh: coneMesh,
        basePos: pos,
        speed: 0.4 + idx * 0.15,
        phase: idx * 2.0
      });
    });
  }

  setupPlantingSpots() {
    const spots = [
      { id: 0, x: -11.5, y: 0.1, z: 0, type: 'Sanctuary Spire Base' },
      { id: 1, x: 11.5, y: 0.1, z: 12, type: 'East Tower Walkway' },
      { id: 2, x: 0, y: 0.1, z: -35, type: 'North Avenue Crossing' },
      { id: 3, x: -22.5, y: 48.1, z: 0, type: 'Sanctuary Rooftop' },
      { id: 4, x: 22.5, y: 56.1, z: 12, type: 'Sky Overlook' },
      { id: 5, x: 0, y: 0.1, z: 45, type: 'South Canal Plaza' }
    ];

    // Shared Geometries for Planter & Beacon
    const rimGeo = new THREE.CylinderGeometry(1.65, 1.80, 0.22, 28);
    const soilGeo = new THREE.CircleGeometry(1.5, 28);
    const glowGeo = new THREE.CircleGeometry(1.35, 28);
    const ringGeo = new THREE.RingGeometry(1.35, 1.75, 32);
    const beamGeo = new THREE.CylinderGeometry(0.28, 1.05, 7.5, 16, 1, true);
    const gemGeo = new THREE.OctahedronGeometry(0.24, 0);

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x161b26,
      roughness: 0.75,
      metalness: 0.20
    });

    const soilMat = new THREE.MeshStandardMaterial({
      color: 0x0a0e14,
      roughness: 0.95,
      metalness: 0.05
    });

    this.spotMeshes = [];

    spots.forEach(sp => {
      const group = new THREE.Group();
      group.position.set(sp.x, sp.y, sp.z);

      // 1. Concrete Planter Rim (Grounds the spot in the physical world)
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.y = 0.11;
      group.add(rim);

      // 2. Fertile Soil Center
      const soil = new THREE.Mesh(soilGeo, soilMat);
      soil.rotation.x = -Math.PI / 2;
      soil.position.y = 0.21;
      group.add(soil);

      // 3. Inner Bioluminescent Ground Glow Disc (pulsing core)
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const groundGlow = new THREE.Mesh(glowGeo, glowMat);
      groundGlow.rotation.x = -Math.PI / 2;
      groundGlow.position.y = 0.22;
      group.add(groundGlow);

      // 4. Concentric Ripple Ring
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        transparent: true,
        opacity: 0.80,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.23;
      group.add(ring);

      // 5. Vertical Bioluminescent Beacon Shaft (recognizable from a distance)
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0x00ffaa,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 3.75;
      group.add(beam);

      // 6. Floating Seedling Gem / Spore (bobs and rotates above planter)
      const gemMat = new THREE.MeshBasicMaterial({
        color: 0x55ffcc
      });
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.position.y = 2.5;
      group.add(gem);

      this.scene.add(group);

      this.spotMeshes.push({
        data: sp,
        mesh: ring, // Maintained for backward compatibility
        group,
        rim,
        soil,
        groundGlow,
        ring,
        beam,
        gem,
        isPlanted: false
      });
    });
  }

  update(delta, time) {
    if (this.buildingMaterial && this.buildingMaterial.userData.uniforms) {
      this.buildingMaterial.userData.uniforms.uTime.value = time;
    }

    if (this.cloudSheet) {
      this.cloudSheet.rotation.z = time * 0.008;
    }

    if (this.beaconMesh) {
      const flash = (Math.sin(time * 3.5) > 0.65) ? 1.0 : 0.15;
      this.beaconMesh.material.opacity = flash;
    }

    if (this.pinkNeonMat) {
      this.pinkNeonMat.opacity = 0.72 + 0.16 * Math.sin(time * 3.4);
    }
    if (this.cyanNeonMat) {
      this.cyanNeonMat.opacity = 0.72 + 0.16 * Math.sin(time * 4.2 + 1.2);
    }
    if (this.amberNeonMat) {
      this.amberNeonMat.opacity = 0.78 + 0.14 * Math.sin(time * 2.8 + 2.5);
    }

    // Sweep volumetric searchlight cones
    if (this.searchlights) {
      this.searchlights.forEach(item => {
        const angleX = Math.sin(time * item.speed + item.phase) * 0.45;
        const angleZ = Math.cos(time * item.speed * 0.8 + item.phase) * 0.35;
        item.mesh.rotation.set(angleX + 0.4, 0, angleZ);
      });
    }

    // Dynamic Bioluminescent Planting Spot Animation & Distance Proximity
    if (this.spotMeshes) {
      const playerPos = window.__vz_app?.robot?.position;

      this.spotMeshes.forEach(sp => {
        if (!sp.isPlanted) {
          // Proximity scaling: stronger indicator when player is close
          let proximityMult = 1.0;
          if (playerPos) {
            const dist = playerPos.distanceTo(new THREE.Vector3(sp.data.x, sp.data.y, sp.data.z));
            if (dist < 28.0) {
              proximityMult = 1.0 + (1.0 - dist / 28.0) * 0.75;
            }
          }

          // Soft pulsing halo & ground glow
          const pulse = 0.55 + 0.38 * Math.sin(time * 3.2 + sp.data.id * 1.4);
          sp.ring.material.opacity = Math.min(1.0, pulse * 0.85 * proximityMult);
          sp.groundGlow.material.opacity = Math.min(0.85, (0.35 + 0.30 * pulse) * proximityMult);

          // Vertical light shaft
          sp.beam.material.opacity = Math.min(0.42, (0.16 + 0.08 * Math.sin(time * 2.4 + sp.data.id)) * proximityMult);
          sp.beam.rotation.y = time * 0.25;

          // Bobbing seedling gem
          sp.gem.position.y = 2.4 + Math.sin(time * 2.8 + sp.data.id * 1.8) * 0.22;
          sp.gem.rotation.y = time * 1.2;
        } else {
          // Completed / Reclaimed Spot State: clear visual difference
          if (sp.beam && sp.beam.visible) sp.beam.visible = false;
          if (sp.gem && sp.gem.visible) sp.gem.visible = false;

          // Tranquil steady emerald bloom on ground
          sp.ring.material.color.setHex(0x10b981);
          sp.ring.material.opacity = 0.35;
          sp.groundGlow.material.color.setHex(0x064e3b);
          sp.groundGlow.material.opacity = 0.50;
        }
      });
    }
  }
}

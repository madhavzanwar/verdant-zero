import * as THREE from 'three';
import { createBuildingMaterial } from './BuildingShader.js';
import { createRng } from '../core/random.js';

// Fixed city plan (all values in metres). Towers line the street on a 24m rhythm,
// leaving 6m alleys at z = -120, -96, ... 120.
const STREET_BLOCK_Z = [-132, -108, -84, -60, -36, -12, 12, 36, 60, 84, 108, 132];

// Skyways bridge the street at 11m. A 5m crate under each one acts as a stepping stone.
export const SKYWAYS = [
  { z: -60, deckY: 11, crateSide: -1 },
  { z: 36, deckY: 11, crateSide: 1 },
  { z: 108, deckY: 11, crateSide: -1 }
];

// Low "garden" towers beside each skyway; their roofs are reachable by hovering up from the deck.
const GARDEN_TOWERS = [
  { side: -1, z: -60, height: 19 },
  { side: 1, z: 36, height: 22 },
  { side: -1, z: 108, height: 18 }
];

// Sidewalk awnings (shelter from acid rain).
const AWNINGS = [
  { side: -1, z: -108 }, { side: -1, z: -36 }, { side: -1, z: 12 }, { side: -1, z: 84 },
  { side: 1, z: -132 }, { side: 1, z: -84 }, { side: 1, z: -12 }, { side: 1, z: 60 }, { side: 1, z: 108 }
];

// 28 fertile planters: street, alleys, skyways, garden rooftops and the smog-heavy outer district.
export const PLANTER_LAYOUT = [
  // Street canyon
  { x: -12, y: 0.1, z: -10, type: 'Main Street West' },
  { x: 12, y: 0.1, z: -18, type: 'Main Street East' },
  { x: -12, y: 0.1, z: -44, type: 'North Sidewalk' },
  { x: 12, y: 0.1, z: -80, type: 'Transit Stop' },
  { x: -12, y: 0.1, z: -100, type: 'Old Market Curb' },
  { x: 0, y: 0.1, z: -112, type: 'North Median' },
  { x: -12, y: 0.1, z: -128, type: 'North Gate' },
  { x: 12, y: 0.1, z: 20, type: 'Arcade Walk' },
  { x: -12, y: 0.1, z: 52, type: 'South Sidewalk' },
  { x: 0, y: 0.1, z: 64, type: 'South Median' },
  { x: 12, y: 0.1, z: 72, type: 'Canal Corner' },
  { x: -12, y: 0.1, z: 88, type: 'Noodle Bar Awning' },
  { x: 12, y: 0.1, z: 124, type: 'South Gate' },
  // Alleys
  { x: -25, y: 0.1, z: 0, type: 'Lantern Alley' },
  { x: 25, y: 0.1, z: -48, type: 'Cable Alley' },
  { x: -25, y: 0.1, z: -96, type: 'Rust Alley' },
  { x: 25, y: 0.1, z: 72, type: 'Steam Alley' },
  { x: 25, y: 0.1, z: -120, type: 'Drain Alley' },
  // Skyways
  { x: -6, y: 11.1, z: -60, type: 'North Skyway' },
  { x: 7, y: 11.1, z: 36, type: 'Central Skyway' },
  { x: -7, y: 11.1, z: 108, type: 'South Skyway' },
  // Garden rooftops
  { x: -24, y: 19.1, z: -60, type: 'Hanging Garden Roof' },
  { x: 24, y: 22.1, z: 36, type: 'Water Tower Roof' },
  { x: -24, y: 18.1, z: 108, type: 'Greenhouse Roof' },
  // Outer district (thick smog, risk bonus)
  { x: -46, y: 0.1, z: -20, type: 'West Wastes' },
  { x: 46, y: 0.1, z: -70, type: 'East Scrapyard' },
  { x: -46, y: 0.1, z: 60, type: 'Drowned Plaza' },
  { x: 46, y: 0.1, z: 110, type: 'Dead Reservoir' }
];

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
    this.shelters = [];
    this.playerPosition = null;
    this.rng = createRng(20260);

    // Building material with procedural window hash & living green wave
    this.buildingMaterial = createBuildingMaterial();

    this.generate();
  }

  generate() {
    this.buildGroundAndStreets();
    this.buildSkyAtmosphere();
    this.buildCityLayers();
    this.buildTraversalStructures();
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
    const rng = this.rng;
    const totalBuildings = 360;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);

    this.towersMesh = new THREE.InstancedMesh(boxGeo, this.buildingMaterial, totalBuildings);
    const dummy = new THREE.Object3D();

    this.buildingPositions = [];
    let count = 0;

    const addTower = (x, z, w, d, h, layer, collide = true) => {
      if (count >= totalBuildings) return;
      dummy.position.set(x, h / 2, z);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      this.towersMesh.setMatrixAt(count++, dummy.matrix);
      if (layer < 3) this.buildingPositions.push({ x, y: h, z, w, d, layer });
      if (collide) {
        this.buildingColliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, height: h });
      }
    };

    // ----------------------------------------------------
    // LAYER 1: Street canyon. Towers on a fixed 24m rhythm leave 6m alleys between them.
    // Garden towers (low roofs) sit beside each skyway so their roofs are reachable by hover.
    // ----------------------------------------------------
    for (const z of STREET_BLOCK_Z) {
      for (const side of [-1, 1]) {
        const garden = GARDEN_TOWERS.find(g => g.side === side && g.z === z);
        const height = garden ? garden.height : 34 + rng() * 50;
        const width = 16;
        addTower(side * 24, z, width, 18, height, 1);
      }
    }

    // ----------------------------------------------------
    // LAYER 2: Skyline ring (kept clear of outer-district planters)
    // ----------------------------------------------------
    const outerSpots = PLANTER_LAYOUT.filter(p => Math.abs(p.x) > 30);
    for (let i = 0; i < 135; i++) {
      const angle = (i / 135) * Math.PI * 2 + (rng() - 0.5) * 0.15;
      const radius = 72 + rng() * 80;
      const posX = Math.cos(angle) * radius;
      const posZ = Math.sin(angle) * radius;
      const width = 16 + rng() * 16;
      const depth = 16 + rng() * 16;
      const height = 55 + rng() * 115;

      // Never overlap the street canyon or block an outer-district planter
      if (Math.abs(posX) - width / 2 < 36) continue;
      const blocksSpot = outerSpots.some(p =>
        p.x > posX - width / 2 - 7 && p.x < posX + width / 2 + 7 &&
        p.z > posZ - depth / 2 - 7 && p.z < posZ + depth / 2 + 7);
      if (blocksSpot) continue;

      addTower(posX, posZ, width, depth, height, 2);
    }

    // ----------------------------------------------------
    // LAYER 3: Far mega-silhouettes fading into haze (visual only, no collision)
    // ----------------------------------------------------
    for (let i = 0; i < 180 && count < totalBuildings; i++) {
      const angle = (i / 180) * Math.PI * 2;
      const radius = 170 + rng() * 180;
      addTower(Math.cos(angle) * radius, Math.sin(angle) * radius,
        30 + rng() * 32, 30 + rng() * 32, 110 + rng() * 160, 3, false);
    }

    this.towersMesh.count = count;
    this.towersMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.towersMesh);
  }

  /**
   * Walkable skyways, awnings and crates. Their undersides shelter the player from acid rain
   * (colliders with minY > 0), and their tops are hover-reachable platforms.
   */
  buildTraversalStructures() {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x1c2333, roughness: 0.6, metalness: 0.4 });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x00e5a0 });
    const awningMat = new THREE.MeshStandardMaterial({ color: 0x232a3d, roughness: 0.7, metalness: 0.3 });
    const awningTrimMat = new THREE.MeshBasicMaterial({ color: 0xff3d8b });
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x2b3448, roughness: 0.8, metalness: 0.2 });

    const box = new THREE.BoxGeometry(1, 1, 1);
    const pieces = { deck: [], trim: [], awning: [], awningTrim: [], crate: [] };
    const add = (list, x, y, z, w, h, d) => list.push({ x, y, z, w, h, d });

    this.shelters = [];

    // Skyways spanning the street at deck height 11m
    SKYWAYS.forEach(s => {
      const minY = s.deckY - 0.8;
      add(pieces.deck, 0, s.deckY - 0.4, s.z, 32, 0.8, 7);
      add(pieces.trim, 0, s.deckY + 0.05, s.z - 3.45, 32, 0.12, 0.12);
      add(pieces.trim, 0, s.deckY + 0.05, s.z + 3.45, 32, 0.12, 0.12);
      add(pieces.trim, 0, minY - 0.05, s.z - 3.45, 32, 0.1, 0.1);
      add(pieces.trim, 0, minY - 0.05, s.z + 3.45, 32, 0.1, 0.1);
      this.buildingColliders.push({ minX: -16, maxX: 16, minZ: s.z - 3.5, maxZ: s.z + 3.5, minY, height: s.deckY, isPlatform: true });
      this.shelters.push({ minX: -16, maxX: 16, minZ: s.z - 3.5, maxZ: s.z + 3.5, minY });

      // Stepping crate on the sidewalk below each skyway
      const cx = s.crateSide * 12.6;
      const cz = s.z + 6.5;
      add(pieces.crate, cx, 2.5, cz, 3.2, 5, 3.2);
      this.buildingColliders.push({ minX: cx - 1.6, maxX: cx + 1.6, minZ: cz - 1.6, maxZ: cz + 1.6, minY: 0, height: 5, isPlatform: true });
    });

    // Awnings over the sidewalks (shelter from acid rain)
    AWNINGS.forEach(a => {
      const faceX = a.side * 16;
      const cx = faceX - a.side * 1.75;
      const top = 4.6;
      add(pieces.awning, cx, top - 0.15, a.z, 3.5, 0.3, 9);
      add(pieces.awningTrim, faceX - a.side * 3.5, top - 0.15, a.z, 0.12, 0.34, 9);
      const minX = Math.min(faceX, faceX - a.side * 3.5);
      const maxX = Math.max(faceX, faceX - a.side * 3.5);
      this.buildingColliders.push({ minX, maxX, minZ: a.z - 4.5, maxZ: a.z + 4.5, minY: top - 0.3, height: top, isPlatform: true });
      this.shelters.push({ minX, maxX, minZ: a.z - 4.5, maxZ: a.z + 4.5, minY: top - 0.3 });
    });

    const materials = { deck: deckMat, trim: trimMat, awning: awningMat, awningTrim: awningTrimMat, crate: crateMat };
    const dummy = new THREE.Object3D();
    Object.keys(pieces).forEach(key => {
      const list = pieces[key];
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(box, materials[key], list.length);
      list.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.set(p.w, p.h, p.d);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
    });
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
      if ((b.layer === 1 || b.layer === 2) && b.y > 26) {
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
      opacity: 0.06,
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
      const style = Math.floor(this.rng() * 4);
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
    const count = PLANTER_LAYOUT.length;
    const additive = (color, opacity) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    });

    const rimGeo = new THREE.CylinderGeometry(1.65, 1.80, 0.22, 28);
    const soilGeo = new THREE.CircleGeometry(1.5, 28).rotateX(-Math.PI / 2);
    const glowGeo = new THREE.CircleGeometry(1.35, 28).rotateX(-Math.PI / 2);
    const ringGeo = new THREE.RingGeometry(1.35, 1.75, 32).rotateX(-Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(0.28, 1.05, 7.5, 16, 1, true).translate(0, 3.75, 0);
    const gemGeo = new THREE.OctahedronGeometry(0.24, 0);

    this.spotRims = new THREE.InstancedMesh(rimGeo, new THREE.MeshStandardMaterial({ color: 0x161b26, roughness: 0.75, metalness: 0.2 }), count);
    this.spotSoil = new THREE.InstancedMesh(soilGeo, new THREE.MeshStandardMaterial({ color: 0x0a0e14, roughness: 0.95, metalness: 0.05 }), count);
    // Additive materials: per-instance colour brightness acts as per-instance opacity.
    this.spotGlows = new THREE.InstancedMesh(glowGeo, additive(0xffffff, 0.75), count);
    this.spotRings = new THREE.InstancedMesh(ringGeo, additive(0xffffff, 1.0), count);
    this.spotBeams = new THREE.InstancedMesh(beamGeo, additive(0xffffff, 0.5), count);
    this.spotGems = new THREE.InstancedMesh(gemGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), count);

    const dummy = new THREE.Object3D();
    const black = new THREE.Color(0, 0, 0);
    this.spotMeshes = PLANTER_LAYOUT.map((sp, i) => {
      dummy.position.set(sp.x, sp.y + 0.11, sp.z);
      dummy.updateMatrix();
      this.spotRims.setMatrixAt(i, dummy.matrix);
      dummy.position.set(sp.x, sp.y + 0.21, sp.z);
      dummy.updateMatrix();
      this.spotSoil.setMatrixAt(i, dummy.matrix);
      dummy.position.set(sp.x, sp.y + 0.22, sp.z);
      dummy.updateMatrix();
      this.spotGlows.setMatrixAt(i, dummy.matrix);
      dummy.position.set(sp.x, sp.y + 0.23, sp.z);
      dummy.updateMatrix();
      this.spotRings.setMatrixAt(i, dummy.matrix);
      [this.spotGlows, this.spotRings, this.spotBeams, this.spotGems].forEach(m => m.setColorAt(i, black));
      return { data: { id: i, ...sp }, index: i, isPlanted: false, isWithering: false, health: 1, deniedTimer: 0 };
    });

    [this.spotRims, this.spotSoil, this.spotGlows, this.spotRings, this.spotBeams, this.spotGems].forEach(m => {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.frustumCulled = false;
      this.scene.add(m);
    });

    this._spotDummy = dummy;
    this._spotColor = new THREE.Color();
  }

  setPlayerPosition(pos) {
    this.playerPosition = pos;
  }

  flashSpotDenied(spot) {
    if (spot) spot.deniedTimer = 0.45;
  }

  updatePlantingSpots(delta, time) {
    if (!this.spotMeshes) return;
    const dummy = this._spotDummy;
    const c = this._spotColor;
    const playerPos = this.playerPosition;

    for (let i = 0; i < this.spotMeshes.length; i++) {
      const sp = this.spotMeshes[i];
      const d = sp.data;
      if (sp.deniedTimer > 0) sp.deniedTimer -= delta;

      if (!sp.isPlanted) {
        let proximity = 1.0;
        let beamFade = 1.0;
        if (playerPos) {
          const dist = Math.hypot(playerPos.x - d.x, playerPos.y - d.y, playerPos.z - d.z);
          if (dist < 28.0) proximity = 1.0 + (1.0 - dist / 28.0) * 0.75;
          // The beam is a long-range beacon; fade it up close so the camera never sits inside it
          beamFade = Math.min(1, Math.max(0, (dist - 4) / 8));
        }
        const pulse = 0.55 + 0.38 * Math.sin(time * 3.2 + d.id * 1.4);
        const denied = sp.deniedTimer > 0;

        c.setHex(denied ? 0xff3344 : 0x00ffcc).multiplyScalar(Math.min(1.0, pulse * 0.85 * proximity));
        this.spotRings.setColorAt(i, c);
        c.setHex(denied ? 0xff2233 : 0x00ff88).multiplyScalar(Math.min(0.85, (0.35 + 0.3 * pulse) * proximity));
        this.spotGlows.setColorAt(i, c);
        c.setHex(0x00ffaa).multiplyScalar(Math.min(0.85, (0.32 + 0.16 * Math.sin(time * 2.4 + d.id)) * proximity) * beamFade);
        this.spotBeams.setColorAt(i, c);
        c.setHex(0x55ffcc);
        this.spotGems.setColorAt(i, c);

        dummy.position.set(d.x, d.y, d.z);
        dummy.rotation.set(0, time * 0.25, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        this.spotBeams.setMatrixAt(i, dummy.matrix);

        dummy.position.set(d.x, d.y + 2.4 + Math.sin(time * 2.8 + d.id * 1.8) * 0.22, d.z);
        dummy.rotation.set(0, time * 1.2, 0);
        dummy.updateMatrix();
        this.spotGems.setMatrixAt(i, dummy.matrix);
      } else {
        // Reclaimed: steady emerald bed (amber when the vine is withering), no beacon
        c.setHex(sp.isWithering ? 0xffaa00 : 0x10b981).multiplyScalar(sp.isWithering ? 0.4 + 0.3 * Math.sin(time * 6) : 0.35);
        this.spotRings.setColorAt(i, c);
        c.setHex(0x064e3b);
        this.spotGlows.setColorAt(i, c);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        this.spotBeams.setMatrixAt(i, dummy.matrix);
        this.spotGems.setMatrixAt(i, dummy.matrix);
      }
    }

    this.spotRings.instanceColor.needsUpdate = true;
    this.spotGlows.instanceColor.needsUpdate = true;
    this.spotBeams.instanceColor.needsUpdate = true;
    this.spotGems.instanceColor.needsUpdate = true;
    this.spotBeams.instanceMatrix.needsUpdate = true;
    this.spotGems.instanceMatrix.needsUpdate = true;
  }

  update(delta, time) {
    if (this.buildingMaterial && this.buildingMaterial.userData.uniforms) {
      this.buildingMaterial.userData.uniforms.uTime.value = time;
    }

    if (this.cloudSheet) {
      this.cloudSheet.rotation.z = time * 0.008;
    }

    if (this.beaconMesh) {
      this.beaconMesh.material.opacity = (Math.sin(time * 3.5) > 0.65) ? 1.0 : 0.15;
    }

    if (this.pinkNeonMat) this.pinkNeonMat.opacity = 0.72 + 0.16 * Math.sin(time * 3.4);
    if (this.cyanNeonMat) this.cyanNeonMat.opacity = 0.72 + 0.16 * Math.sin(time * 4.2 + 1.2);
    if (this.amberNeonMat) this.amberNeonMat.opacity = 0.78 + 0.14 * Math.sin(time * 2.8 + 2.5);

    if (this.searchlights) {
      for (const item of this.searchlights) {
        const angleX = Math.sin(time * item.speed + item.phase) * 0.45;
        const angleZ = Math.cos(time * item.speed * 0.8 + item.phase) * 0.35;
        item.mesh.rotation.set(angleX + 0.4, 0, angleZ);
      }
    }

    this.updatePlantingSpots(delta, time);
  }
}

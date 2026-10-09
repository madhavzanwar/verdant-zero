import * as THREE from 'three';

/**
 * Robot Gardener Entity
 * - Cute, friendly robot gardener (~1.5 units tall)
 * - Clean rounded primitives with matte finish (warm off-white ceramic-alloy, verdant green accents, graphite joints)
 * - Articulated head with dark tinted visor and single glowing green eye that blinks and tracks gaze
 * - Full procedural animation hierarchy:
 *   - Idle cycle: breathing bob, lantern sway, subtle curious glance
 *   - Walk & run cycles: driven by distance traveled (zero foot sliding!), two-bone leg IK, torso bob/twist, arm counter-swings, forward run lean
 *   - Hover cycle: tucked legs, forward float tilt, thruster flame particles, limited regenerating hover energy
 *   - Landing: squash on impact and ground dust puff
 * - Movement physics:
 *   - Walk default (~5 u/s), run on Shift (~10 u/s)
 *   - Dash burst on 'F' key with short cooldown and camera FOV kick
 *   - Jump on Space when grounded, hover when airborne
 *   - Real acceleration (~0.15s walk, ~0.3s run) & deceleration (~0.15s stop)
 *   - Camera-relative normalized diagonal movement
 *   - Swept substepped collision with silky-smooth wall sliding
 *   - Gamepad support: left stick moves, right stick looks, buttons for jump, dash, plant
 * - Real point light: gentle seed lantern glow (strictly 1 player light to preserve performance)
 * - Soft contact blob shadow on ground
 */

/**
 * Tunable Robot Physics and Traversal Configuration
 * All movement parameters can be tuned in one place.
 */
export const ROBOT_CONFIG = {
  // Base Speeds (units / sec)
  baseSpeed: 14.0,           // Fast, responsive base movement speed (restored)
  sprintMultiplier: 1.4,     // 40% speed burst on Shift/run (19.6 u/s)
  dashSpeed: 28.0,           // Snappy kinetic dash covering 3-4 robot lengths instantly
  dashDuration: 0.18,        // Duration of dash burst (seconds)
  dashCooldown: 1.0,         // Dash cooldown (seconds)
  hoverSpeed: 17.5,          // Traversal hover speed (faster than base walk)
  hoverThrust: 26.0,         // Upward thruster impulse
  hoverDrainRate: 32.0,      // Sustained hover energy consumption
  hoverRechargeRate: 50.0,   // Ground recharge rate
  
  // Acceleration & Deceleration curves
  accelRate: 20.0,           // Reaches full speed in ~0.15s
  decelRate: 30.0,           // Stops cleanly in ~0.10s without sluggish vehicle inertia
  
  // Jump & Gravity (snappy upward pop and fast crisp fall)
  jumpImpulse: 8.8,          // Snappy vertical jump pop
  gravity: 24.0,             // Crisp, non-floaty gravity
  
  // Procedural Stride Dynamics (Synced with actual velocity)
  walkStrideLength: 1.75,    // Stride length during base walk
  runStrideLength: 2.35,     // Stride length during sprint
  walkStepHeight: 0.09,      // Vertical foot arc during walk
  runStepHeight: 0.16,       // Vertical foot arc during sprint
  
  // User Speed Multiplier (Loaded from localStorage: 0.8x to 1.5x)
  userSpeedScale: 1.0
};

export class RobotGardener {
  static CONFIG = ROBOT_CONFIG;

  constructor(scene, colliders = []) {
    this.scene = scene;
    this.colliders = colliders;

    // Movement speed scale setting (80% to 150%)
    const savedScale = parseFloat(localStorage.getItem('vz_move_speed_scale') || '1.0');
    this.speedScale = (!isNaN(savedScale) && savedScale >= 0.8 && savedScale <= 1.5) ? savedScale : 1.0;
    ROBOT_CONFIG.userSpeedScale = this.speedScale;

    // Transform & Physics state
    this.position = new THREE.Vector3(-6.8, 0.9, 0);
    this.velocity = new THREE.Vector3();
    this.walkSpeed = ROBOT_CONFIG.baseSpeed * this.speedScale;
    this.runSpeed = ROBOT_CONFIG.baseSpeed * ROBOT_CONFIG.sprintMultiplier * this.speedScale;
    this.speed = this.walkSpeed;
    this.dashSpeed = ROBOT_CONFIG.dashSpeed * this.speedScale;
    this.jumpImpulse = ROBOT_CONFIG.jumpImpulse;
    this.hoverThrust = ROBOT_CONFIG.hoverThrust;
    this.gravity = ROBOT_CONFIG.gravity;

    // Movement & Ability timers
    this.isDashing = false;
    this.dashTimer = 0.0;
    this.dashDuration = ROBOT_CONFIG.dashDuration;
    this.dashCooldown = ROBOT_CONFIG.dashCooldown;
    this.dashCooldownTimer = 0.0;
    this.dashVector = new THREE.Vector2();
    this._moveVector = new THREE.Vector2();
    this._origin2 = new THREE.Vector2();
    // Set externally each frame (smog slows the robot down)
    this.moveSpeedMultiplier = 1.0;

    // Hover & Energy state
    this.isHovering = false;
    this.maxHoverEnergy = 100.0;
    this.hoverEnergy = 100.0;
    this.hoverDrainRate = ROBOT_CONFIG.hoverDrainRate;
    this.hoverRechargeRate = ROBOT_CONFIG.hoverRechargeRate;

    // Ground & Collision state
    this.isGrounded = true;
    this.wasGrounded = true;
    this.currentGroundY = 0.9;
    this.collisionRadius = 0.45;

    // Animation & Personality state
    this.walkCyclePhase = 0.0;
    this.distanceTraveled = 0.0;
    this.tilt = { x: 0, z: 0 };
    this.squash = { y: 1.0, xz: 1.0 };
    this.blinkTimer = 0.0;
    this.isBlinking = false;
    this.isNearPlantSpot = false;
    this.idleGazeTimer = 0.0;
    this.idleGazeOffset = { x: 0, y: 0 };
    this.hoverBlend = 0.0; // 0 = walking/idle, 1 = tucked hover

    // Leg Kinematics Bone Lengths
    this.thighLength = 0.22;
    this.shinLength = 0.22;
    this.hipHeightLocal = 0.44;
    this.footRestY = -0.40;

    // Root Group
    this.mesh = new THREE.Group();
    this.mesh.rotation.y = Math.PI; // Face down main street at spawn
    this.buildRobotMesh();
    this.scene.add(this.mesh);

    // Soft blob contact shadow
    this.initBlobShadow();

    // Landing dust puff particles
    this.initDustParticles();

    // Thruster exhaust particles
    this.initThrusterParticles();
  }

  buildRobotMesh() {
    // Shared Materials
    this.offWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf4efe6,       // Warm matte off-white ceramic
      roughness: 0.56,
      metalness: 0.12
    });

    this.accentGreenMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,       // Vivid emerald gardener green
      roughness: 0.46,
      metalness: 0.16
    });

    this.darkGreenMat = new THREE.MeshStandardMaterial({
      color: 0x15803d,       // Deep forest green trim
      roughness: 0.50,
      metalness: 0.18
    });

    this.graphiteMat = new THREE.MeshStandardMaterial({
      color: 0x222730,       // Slate graphite metallic for joints & neck
      roughness: 0.40,
      metalness: 0.72
    });

    this.brassMat = new THREE.MeshStandardMaterial({
      color: 0xd4a359,       // Brushed brass for watering nozzle & lantern fittings
      roughness: 0.32,
      metalness: 0.85
    });

    this.visorMat = new THREE.MeshStandardMaterial({
      color: 0x0c1017,       // Dark glossy obsidian glass
      roughness: 0.18,
      metalness: 0.85
    });

    // Iris Material (must support .color.setHex for smog and proximity effects)
    this.irisMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });

    // Tilt Group (handles banking, acceleration pitch, landing squash)
    this.tiltGroup = new THREE.Group();
    this.mesh.add(this.tiltGroup);

    // 1. Torso Group
    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.y = 0.44; // Above hips
    this.tiltGroup.add(this.torsoGroup);

    // Torso Base Chassis (Warm off-white rounded capsule)
    const torsoGeo = new THREE.CapsuleGeometry(0.24, 0.26, 12, 16);
    this.torsoMesh = new THREE.Mesh(torsoGeo, this.offWhiteMat);
    this.torsoMesh.position.y = 0.22;
    this.torsoGroup.add(this.torsoMesh);

    // Front Chest Apron / Gardener Plate (Green accent)
    const chestPlateGeo = new THREE.CylinderGeometry(0.22, 0.24, 0.22, 16, 1, false, -Math.PI * 0.35, Math.PI * 0.7);
    const chestPlate = new THREE.Mesh(chestPlateGeo, this.accentGreenMat);
    chestPlate.position.set(0, 0.22, 0.04);
    this.torsoGroup.add(chestPlate);

    // Cute Leaf/Seed emblem on chest
    const emblemGeo = new THREE.SphereGeometry(0.04, 12, 12);
    emblemGeo.scale(1.0, 1.6, 0.4);
    const emblemMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    const emblem = new THREE.Mesh(emblemGeo, emblemMat);
    emblem.position.set(0, 0.24, 0.26);
    this.torsoGroup.add(emblem);

    // Graphite Waist & Collar Rings
    const collarGeo = new THREE.TorusGeometry(0.22, 0.025, 8, 24);
    const collar = new THREE.Mesh(collarGeo, this.graphiteMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.45;
    this.torsoGroup.add(collar);

    const waistGeo = new THREE.TorusGeometry(0.23, 0.028, 8, 24);
    const waist = new THREE.Mesh(waistGeo, this.graphiteMat);
    waist.rotation.x = Math.PI / 2;
    waist.position.y = 0.04;
    this.torsoGroup.add(waist);

    // 2. Neck & Head
    this.neckGroup = new THREE.Group();
    this.neckGroup.position.y = 0.48;
    this.torsoGroup.add(this.neckGroup);

    const neckGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.07, 16);
    const neckMesh = new THREE.Mesh(neckGeo, this.graphiteMat);
    neckMesh.position.y = 0.035;
    this.neckGroup.add(neckMesh);

    // Head Group (Smoothly tracks camera gaze)
    this.headGroup = new THREE.Group();
    this.headGroup.position.y = 0.07;
    this.neckGroup.add(this.headGroup);

    // Friendly rounded head (off-white sphere with cute slight squash)
    const headGeo = new THREE.SphereGeometry(0.22, 24, 20);
    this.headMesh = new THREE.Mesh(headGeo, this.offWhiteMat);
    this.headMesh.position.y = 0.18;
    this.headMesh.scale.set(1.05, 0.95, 1.0);
    this.headGroup.add(this.headMesh);

    // Green Top Cap / Gardener Cap detail
    const capGeo = new THREE.SphereGeometry(0.225, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.35);
    const capMesh = new THREE.Mesh(capGeo, this.accentGreenMat);
    capMesh.position.y = 0.18;
    capMesh.scale.set(1.05, 0.95, 1.0);
    this.headGroup.add(capMesh);

    // Curved Dark Visor on front of head
    const visorGeo = new THREE.CylinderGeometry(0.215, 0.215, 0.15, 24, 1, false, -Math.PI * 0.42, Math.PI * 0.84);
    const visorMesh = new THREE.Mesh(visorGeo, this.visorMat);
    visorMesh.position.set(0, 0.18, 0.02);
    this.headGroup.add(visorMesh);

    // Side Ear Sensors (cute graphite pucks)
    const earGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16);
    const leftEar = new THREE.Mesh(earGeo, this.graphiteMat);
    leftEar.rotation.z = Math.PI / 2;
    leftEar.position.set(-0.24, 0.18, 0);
    this.headGroup.add(leftEar);

    const rightEar = leftEar.clone();
    rightEar.position.x = 0.24;
    this.headGroup.add(rightEar);

    // Glowing Green Eye (Single Expressive Eye inside Visor)
    this.eyePivot = new THREE.Group();
    this.eyePivot.position.set(0, 0.18, 0.20);
    this.headGroup.add(this.eyePivot);

    const irisGeo = new THREE.SphereGeometry(0.065, 20, 20);
    irisGeo.scale(1.0, 1.0, 0.35);
    this.eyeMesh = new THREE.Mesh(irisGeo, this.irisMat);
    this.eyePivot.add(this.eyeMesh);

    // Bright White Pupil Center
    const pupilGeo = new THREE.SphereGeometry(0.028, 16, 16);
    pupilGeo.scale(1.0, 1.0, 0.3);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.pupilMesh = new THREE.Mesh(pupilGeo, pupilMat);
    this.pupilMesh.position.z = 0.02;
    this.eyePivot.add(this.pupilMesh);

    // Soft Eye Halo Glow
    const haloGeo = new THREE.RingGeometry(0.065, 0.13, 24);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.eyeHalo = new THREE.Mesh(haloGeo, haloMat);
    this.eyeHalo.position.z = 0.01;
    this.eyePivot.add(this.eyeHalo);

    // Eyelid for Blinking (Off-white dome closing from top)
    const lidGeo = new THREE.SphereGeometry(0.072, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    this.eyelid = new THREE.Mesh(lidGeo, this.offWhiteMat);
    this.eyelid.position.set(0, 0, 0.005);
    this.eyelid.rotation.x = -Math.PI / 2;
    this.eyelid.scale.set(1.02, 0.05, 1.02); // Start fully open
    this.eyePivot.add(this.eyelid);

    // 3. Backpack (Chassis, Seed Lantern, Watering Nozzle, Thruster Port)
    this.backpackGroup = new THREE.Group();
    this.backpackGroup.position.set(0, 0.24, -0.22);
    this.torsoGroup.add(this.backpackGroup);

    // Backpack Main Body (Rounded graphite & green utility box)
    const packGeo = new THREE.CapsuleGeometry(0.14, 0.22, 10, 14);
    packGeo.scale(1.15, 1.0, 0.75);
    const packMesh = new THREE.Mesh(packGeo, this.graphiteMat);
    this.backpackGroup.add(packMesh);

    // Green Accent Panel on Backpack
    const packPanelGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.18, 12, 1, false, Math.PI * 0.6, Math.PI * 0.8);
    const packPanel = new THREE.Mesh(packPanelGeo, this.accentGreenMat);
    packPanel.position.set(0, 0, -0.04);
    this.backpackGroup.add(packPanel);

    // Seed Lantern on Backpack (hanging bracket on right side)
    this.lanternPivot = new THREE.Group();
    this.lanternPivot.position.set(0.18, 0.02, -0.05);
    this.backpackGroup.add(this.lanternPivot);

    const bracketGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8);
    const bracket = new THREE.Mesh(bracketGeo, this.brassMat);
    bracket.rotation.z = Math.PI / 3;
    bracket.position.set(-0.04, 0.08, 0);
    this.lanternPivot.add(bracket);

    // Lantern Glass Cylinder & Brass Caps
    const lanternGlassGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.14, 16);
    const lanternGlassMat = new THREE.MeshStandardMaterial({
      color: 0x88ffd8,
      transparent: true,
      opacity: 0.38,
      roughness: 0.1,
      metalness: 0.1
    });
    const lanternGlass = new THREE.Mesh(lanternGlassGeo, lanternGlassMat);
    lanternGlass.position.y = -0.05;
    this.lanternPivot.add(lanternGlass);

    const lanternCapGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.025, 16);
    const lanternCapTop = new THREE.Mesh(lanternCapGeo, this.brassMat);
    lanternCapTop.position.y = 0.025;
    this.lanternPivot.add(lanternCapTop);

    const lanternCapBottom = new THREE.Mesh(lanternCapGeo, this.brassMat);
    lanternCapBottom.position.y = -0.125;
    this.lanternPivot.add(lanternCapBottom);

    // Glowing Seed inside Lantern
    const seedGeo = new THREE.SphereGeometry(0.038, 14, 14);
    seedGeo.scale(1.0, 1.4, 0.8);
    const seedMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    this.seedMesh = new THREE.Mesh(seedGeo, seedMat);
    this.seedMesh.position.y = -0.05;
    this.lanternPivot.add(this.seedMesh);

    // Gentle Point Light from Seed Lantern (Strictly 1 player light to stay <= 8 total in scene)
    this.seedLight = new THREE.PointLight(0x33ff88, 1.8, 10, 1.6);
    this.seedLight.position.y = -0.05;
    this.lanternPivot.add(this.seedLight);

    // Tiny Watering Nozzle on Left Side of Backpack
    const nozzleGroup = new THREE.Group();
    nozzleGroup.position.set(-0.16, 0.08, -0.04);
    this.backpackGroup.add(nozzleGroup);

    // Curved brass spout pipe
    const spoutPipeGeo = new THREE.CylinderGeometry(0.016, 0.020, 0.16, 8);
    const spoutPipe = new THREE.Mesh(spoutPipeGeo, this.brassMat);
    spoutPipe.rotation.z = -Math.PI / 4;
    spoutPipe.position.set(-0.05, 0.05, 0);
    nozzleGroup.add(spoutPipe);

    // Perforated mini rose shower head
    const roseGeo = new THREE.ConeGeometry(0.04, 0.05, 12);
    const roseMesh = new THREE.Mesh(roseGeo, this.brassMat);
    roseMesh.rotation.z = Math.PI / 2;
    roseMesh.position.set(-0.12, 0.10, 0);
    nozzleGroup.add(roseMesh);

    // Backpack Thruster Nozzle at Base (for hover mode)
    const thrusterGeo = new THREE.CylinderGeometry(0.07, 0.09, 0.08, 14);
    const thrusterMesh = new THREE.Mesh(thrusterGeo, this.graphiteMat);
    thrusterMesh.position.set(0, -0.18, 0);
    this.backpackGroup.add(thrusterMesh);

    // Glowing Thruster Ring
    const thrusterRingGeo = new THREE.TorusGeometry(0.075, 0.018, 8, 16);
    this.thrusterRingMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa });
    this.thrusterRing = new THREE.Mesh(thrusterRingGeo, this.thrusterRingMat);
    this.thrusterRing.rotation.x = Math.PI / 2;
    this.thrusterRing.position.set(0, -0.22, 0);
    this.backpackGroup.add(this.thrusterRing);

    // 4. Arms & Hands
    this.buildArms();

    // 5. Two-Bone Legs & Feet
    this.buildLegs();
  }

  buildArms() {
    const shoulderGeo = new THREE.SphereGeometry(0.055, 12, 12);
    const upperArmGeo = new THREE.CylinderGeometry(0.038, 0.034, 0.16, 10);
    upperArmGeo.translate(0, -0.08, 0);
    const elbowGeo = new THREE.SphereGeometry(0.042, 10, 10);
    const forearmGeo = new THREE.CylinderGeometry(0.034, 0.030, 0.14, 10);
    forearmGeo.translate(0, -0.07, 0);

    // Cute Mitten Hand
    const palmGeo = new THREE.BoxGeometry(0.065, 0.07, 0.04);
    palmGeo.translate(0, -0.035, 0);
    const thumbGeo = new THREE.CapsuleGeometry(0.014, 0.03, 6, 8);

    // Left Arm Hierarchy
    this.leftShoulder = new THREE.Group();
    this.leftShoulder.position.set(-0.28, 0.35, 0);
    this.torsoGroup.add(this.leftShoulder);

    const leftShoulderMesh = new THREE.Mesh(shoulderGeo, this.graphiteMat);
    this.leftShoulder.add(leftShoulderMesh);

    this.leftUpperArm = new THREE.Group();
    this.leftShoulder.add(this.leftUpperArm);
    const leftUpperMesh = new THREE.Mesh(upperArmGeo, this.offWhiteMat);
    this.leftUpperArm.add(leftUpperMesh);

    this.leftElbow = new THREE.Group();
    this.leftElbow.position.y = -0.16;
    this.leftUpperArm.add(this.leftElbow);
    const leftElbowMesh = new THREE.Mesh(elbowGeo, this.graphiteMat);
    this.leftElbow.add(leftElbowMesh);

    this.leftForearm = new THREE.Group();
    this.leftElbow.add(this.leftForearm);
    const leftForearmMesh = new THREE.Mesh(forearmGeo, this.offWhiteMat);
    this.leftForearm.add(leftForearmMesh);

    this.leftHand = new THREE.Group();
    this.leftHand.position.y = -0.14;
    this.leftForearm.add(this.leftHand);
    const leftPalm = new THREE.Mesh(palmGeo, this.graphiteMat);
    this.leftHand.add(leftPalm);
    const leftThumb = new THREE.Mesh(thumbGeo, this.accentGreenMat);
    leftThumb.rotation.z = Math.PI / 4;
    leftThumb.position.set(0.03, -0.02, 0);
    this.leftHand.add(leftThumb);

    // Right Arm Hierarchy
    this.rightShoulder = new THREE.Group();
    this.rightShoulder.position.set(0.28, 0.35, 0);
    this.torsoGroup.add(this.rightShoulder);

    const rightShoulderMesh = new THREE.Mesh(shoulderGeo, this.graphiteMat);
    this.rightShoulder.add(rightShoulderMesh);

    this.rightUpperArm = new THREE.Group();
    this.rightShoulder.add(this.rightUpperArm);
    const rightUpperMesh = new THREE.Mesh(upperArmGeo, this.offWhiteMat);
    this.rightUpperArm.add(rightUpperMesh);

    this.rightElbow = new THREE.Group();
    this.rightElbow.position.y = -0.16;
    this.rightUpperArm.add(this.rightElbow);
    const rightElbowMesh = new THREE.Mesh(elbowGeo, this.graphiteMat);
    this.rightElbow.add(rightElbowMesh);

    this.rightForearm = new THREE.Group();
    this.rightElbow.add(this.rightForearm);
    const rightForearmMesh = new THREE.Mesh(forearmGeo, this.offWhiteMat);
    this.rightForearm.add(rightForearmMesh);

    this.rightHand = new THREE.Group();
    this.rightHand.position.y = -0.14;
    this.rightForearm.add(this.rightHand);
    const rightPalm = new THREE.Mesh(palmGeo, this.graphiteMat);
    this.rightHand.add(rightPalm);
    const rightThumb = new THREE.Mesh(thumbGeo, this.accentGreenMat);
    rightThumb.rotation.z = -Math.PI / 4;
    rightThumb.position.set(-0.03, -0.02, 0);
    this.rightHand.add(rightThumb);
  }

  buildLegs() {
    // Pelvis base mount at bottom of tiltGroup
    this.pelvisGroup = new THREE.Group();
    this.pelvisGroup.position.y = this.hipHeightLocal; // 0.44
    this.tiltGroup.add(this.pelvisGroup);

    // Pelvis central connector
    const pelvisMeshGeo = new THREE.CylinderGeometry(0.16, 0.14, 0.09, 14);
    const pelvisMesh = new THREE.Mesh(pelvisMeshGeo, this.graphiteMat);
    this.pelvisGroup.add(pelvisMesh);

    const hipJointGeo = new THREE.SphereGeometry(0.052, 12, 12);
    const thighGeo = new THREE.CylinderGeometry(0.044, 0.038, this.thighLength, 12);
    thighGeo.translate(0, -this.thighLength / 2, 0);

    const kneeJointGeo = new THREE.SphereGeometry(0.046, 12, 12);
    const shinGeo = new THREE.CylinderGeometry(0.038, 0.034, this.shinLength, 12);
    shinGeo.translate(0, -this.shinLength / 2, 0);

    // Rounded Boot / Foot (sole rests flat on ground, rounded front toe cap)
    const footGroupBase = () => {
      const g = new THREE.Group();
      // Sole
      const soleGeo = new THREE.BoxGeometry(0.095, 0.04, 0.17);
      soleGeo.translate(0, -0.02, 0.03);
      const sole = new THREE.Mesh(soleGeo, this.graphiteMat);
      g.add(sole);

      // Boot Top
      const bootGeo = new THREE.CapsuleGeometry(0.046, 0.06, 8, 12);
      bootGeo.scale(1.0, 0.7, 1.4);
      const boot = new THREE.Mesh(bootGeo, this.offWhiteMat);
      boot.position.set(0, 0.01, 0.02);
      g.add(boot);

      // Green toe band
      const toeBandGeo = new THREE.BoxGeometry(0.096, 0.022, 0.04);
      toeBandGeo.translate(0, -0.01, 0.08);
      const toeBand = new THREE.Mesh(toeBandGeo, this.accentGreenMat);
      g.add(toeBand);

      return g;
    };

    // --- Left Leg ---
    this.leftHip = new THREE.Group();
    this.leftHip.position.set(-0.16, 0, 0);
    this.pelvisGroup.add(this.leftHip);
    this.leftHip.add(new THREE.Mesh(hipJointGeo, this.graphiteMat));

    this.leftThigh = new THREE.Group();
    this.leftHip.add(this.leftThigh);
    this.leftThigh.add(new THREE.Mesh(thighGeo, this.offWhiteMat));

    this.leftKnee = new THREE.Group();
    this.leftKnee.position.y = -this.thighLength;
    this.leftThigh.add(this.leftKnee);
    this.leftKnee.add(new THREE.Mesh(kneeJointGeo, this.graphiteMat));

    this.leftShin = new THREE.Group();
    this.leftKnee.add(this.leftShin);
    this.leftShin.add(new THREE.Mesh(shinGeo, this.offWhiteMat));

    this.leftFoot = new THREE.Group();
    this.leftFoot.position.y = -this.shinLength;
    this.leftShin.add(this.leftFoot);
    this.leftFoot.add(footGroupBase());

    // --- Right Leg ---
    this.rightHip = new THREE.Group();
    this.rightHip.position.set(0.16, 0, 0);
    this.pelvisGroup.add(this.rightHip);
    this.rightHip.add(new THREE.Mesh(hipJointGeo, this.graphiteMat));

    this.rightThigh = new THREE.Group();
    this.rightHip.add(this.rightThigh);
    this.rightThigh.add(new THREE.Mesh(thighGeo, this.offWhiteMat));

    this.rightKnee = new THREE.Group();
    this.rightKnee.position.y = -this.thighLength;
    this.rightThigh.add(this.rightKnee);
    this.rightKnee.add(new THREE.Mesh(kneeJointGeo, this.graphiteMat));

    this.rightShin = new THREE.Group();
    this.rightKnee.add(this.rightShin);
    this.rightShin.add(new THREE.Mesh(shinGeo, this.offWhiteMat));

    this.rightFoot = new THREE.Group();
    this.rightFoot.position.y = -this.shinLength;
    this.rightShin.add(this.rightFoot);
    this.rightFoot.add(footGroupBase());
  }

  initBlobShadow() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
    grad.addColorStop(0.0, 'rgba(10, 14, 24, 0.75)');
    grad.addColorStop(0.45, 'rgba(10, 14, 24, 0.45)');
    grad.addColorStop(0.80, 'rgba(10, 14, 24, 0.12)');
    grad.addColorStop(1.0, 'rgba(10, 14, 24, 0.0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const shadowTex = new THREE.CanvasTexture(canvas);
    const shadowGeo = new THREE.PlaneGeometry(1.5, 1.5);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });

    this.blobShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.blobShadow.rotation.x = -Math.PI / 2;
    this.blobShadow.position.set(this.position.x, 0.02, this.position.z);
    this.scene.add(this.blobShadow);
  }

  initDustParticles() {
    const pCount = 18;
    const pGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(pCount * 3);
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const pMat = new THREE.PointsMaterial({
      color: 0x94a3b8,
      size: 0.24,
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    });

    this.dustParticles = new THREE.Points(pGeo, pMat);
    this.dustData = Array.from({ length: pCount }, () => ({
      x: 0, y: -100, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0.0,
      active: false
    }));
    this.scene.add(this.dustParticles);
  }

  spawnLandingDust() {
    const pCount = this.dustData.length;
    for (let i = 0; i < pCount; i++) {
      const angle = (i / pCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 1.4 + Math.random() * 1.8;
      this.dustData[i].x = this.position.x + Math.cos(angle) * 0.2;
      this.dustData[i].y = this.currentGroundY + 0.04;
      this.dustData[i].z = this.position.z + Math.sin(angle) * 0.2;
      this.dustData[i].vx = Math.cos(angle) * speed;
      this.dustData[i].vy = 0.3 + Math.random() * 0.5;
      this.dustData[i].vz = Math.sin(angle) * speed;
      this.dustData[i].life = 0.38 + Math.random() * 0.15;
      this.dustData[i].maxLife = this.dustData[i].life;
      this.dustData[i].active = true;
    }
  }

  updateDustParticles(delta) {
    if (!this.dustParticles) return;
    const positions = this.dustParticles.geometry.attributes.position.array;
    let anyActive = false;

    for (let i = 0; i < this.dustData.length; i++) {
      const p = this.dustData[i];
      if (p.active && p.life > 0) {
        anyActive = true;
        p.life -= delta;
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.z += p.vz * delta;
        p.vy -= 1.8 * delta; // slight gravity settle
      } else {
        p.active = false;
        p.y = -100;
      }
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }

    this.dustParticles.geometry.attributes.position.needsUpdate = true;
    this.dustParticles.material.opacity = anyActive ? 0.65 : 0.0;
  }

  initThrusterParticles() {
    const pCount = 24;
    const pGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(pCount * 3);
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const pMat = new THREE.PointsMaterial({
      color: 0x33ffaa,
      size: 0.20,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.thrusterParticles = new THREE.Points(pGeo, pMat);
    this.thrusterData = Array.from({ length: pCount }, () => ({
      x: 0, y: -100, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0.0
    }));
    this.scene.add(this.thrusterParticles);
  }

  updateThrusterParticles(delta, isHovering, isDashing) {
    if (!this.thrusterParticles) return;
    const positions = this.thrusterParticles.geometry.attributes.position.array;
    const emit = isHovering || isDashing;
    const thrustStrength = isDashing ? 3.5 : (isHovering ? 2.2 : 0.0);

    for (let i = 0; i < this.thrusterData.length; i++) {
      const p = this.thrusterData[i];
      p.life -= delta * (isDashing ? 4.5 : 3.2);

      if (p.life <= 0) {
        if (emit) {
          // Backpack world position estimate
          p.x = this.position.x - Math.sin(this.mesh.rotation.y) * 0.22 + (Math.random() - 0.5) * 0.12;
          p.y = this.position.y + 0.48;
          p.z = this.position.z - Math.cos(this.mesh.rotation.y) * 0.22 + (Math.random() - 0.5) * 0.12;
          p.vx = (Math.random() - 0.5) * 0.4 - Math.sin(this.mesh.rotation.y) * 0.5;
          p.vy = (-2.0 - Math.random() * 2.2) * thrustStrength;
          p.vz = (Math.random() - 0.5) * 0.4 - Math.cos(this.mesh.rotation.y) * 0.5;
          p.life = 0.25 + Math.random() * 0.15;
        } else {
          p.y = -100;
        }
      } else {
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.z += p.vz * delta;
      }

      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }

    this.thrusterParticles.geometry.attributes.position.needsUpdate = true;
  }

  setSpeedScale(scale) {
    this.speedScale = Math.max(0.8, Math.min(1.5, scale));
    ROBOT_CONFIG.userSpeedScale = this.speedScale;
    this.walkSpeed = ROBOT_CONFIG.baseSpeed * this.speedScale;
    this.runSpeed = ROBOT_CONFIG.baseSpeed * ROBOT_CONFIG.sprintMultiplier * this.speedScale;
    this.dashSpeed = ROBOT_CONFIG.dashSpeed * this.speedScale;
    try {
      localStorage.setItem('vz_move_speed_scale', this.speedScale.toFixed(2));
    } catch (e) {}
  }

  update(delta, time, input, cameraAngle = 0, cameraPitch = 0) {
    // 1. Input Processing (Keyboard & Gamepad)
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

    // Gamepad API integration
    const gamepads = (input.allowGamepad && navigator.getGamepads) ? navigator.getGamepads() : null;
    const gp = gamepads && gamepads[0];
    let gpRun = false;
    let gpDash = false;
    let gpHover = false;

    if (gp) {
      // Left stick for movement (radial deadzone 0.15)
      const stickX = gp.axes[0];
      const stickZ = gp.axes[1];
      if (Math.hypot(stickX, stickZ) > 0.15) {
        moveX += stickX;
        moveZ += stickZ;
      }
      // Buttons
      gpHover = !!gp.buttons[0]?.pressed; // A (cross)
      gpDash = !!gp.buttons[5]?.pressed; // RB
      gpRun = !!gp.buttons[6]?.pressed || !!gp.buttons[10]?.pressed; // LT or L3
    }

    // Camera-relative movement with normalized diagonals
    const moveVector = this._moveVector.set(moveX, moveZ);
    if (moveVector.lengthSq() > 1.0) {
      moveVector.normalize();
    }
    if (moveVector.lengthSq() > 0.001) {
      moveVector.rotateAround(this._origin2, -cameraAngle);
    }

    // Run modifier (Shift key or gamepad trigger/stick)
    const isRunning = input.isKeyPressed('ShiftLeft') || input.isKeyPressed('ShiftRight') || gpRun;
    let targetSpeed = this.walkSpeed;
    if (this.isHovering) {
      targetSpeed = ROBOT_CONFIG.hoverSpeed * this.speedScale;
    } else if (isRunning) {
      targetSpeed = this.runSpeed;
    }
    targetSpeed *= this.moveSpeedMultiplier;
    this.speed = targetSpeed;

    // Dash Ability on 'F' key (short cooldown, kinetic burst covering 3-4 robot lengths)
    this.dashCooldownTimer = Math.max(0, this.dashCooldownTimer - delta);
    const dashPressed = input.isKeyPressed('KeyF') || gpDash;

    if (dashPressed && this.dashCooldownTimer <= 0 && !this.isDashing) {
      this.isDashing = true;
      this.dashTimer = this.dashDuration;
      this.dashCooldownTimer = this.dashCooldown;

      // Dash direction: movement direction if moving, else robot facing
      if (moveVector.lengthSq() > 0.01) {
        this.dashVector.copy(moveVector).normalize();
      } else {
        this.dashVector.set(Math.sin(this.mesh.rotation.y), Math.cos(this.mesh.rotation.y));
      }
    }

    if (this.isDashing) {
      this.dashTimer -= delta;
      if (this.dashTimer <= 0) {
        this.isDashing = false;
      }
    }

    // 2. Real Snappy Acceleration (~0.15s) and Deceleration (~0.10s)
    if (this.isDashing) {
      // Kinetic burst
      this.velocity.x = this.dashVector.x * this.dashSpeed;
      this.velocity.z = this.dashVector.y * this.dashSpeed;
    } else {
      const isInputActive = moveVector.lengthSq() > 0.001;
      const targetVx = moveVector.x * targetSpeed;
      const targetVz = moveVector.y * targetSpeed;
      const rate = isInputActive ? ROBOT_CONFIG.accelRate : ROBOT_CONFIG.decelRate;

      this.velocity.x += (targetVx - this.velocity.x) * Math.min(1.0, delta * rate);
      this.velocity.z += (targetVz - this.velocity.z) * Math.min(1.0, delta * rate);
    }

    // 3. Jump and Hover Thruster Mechanics
    const spacePressed = input.isKeyPressed('Space') || gpHover;

    // Ground Jump on Space
    if (spacePressed && this.isGrounded && !this.lastSpacePressed) {
      this.velocity.y = this.jumpImpulse;
      this.isGrounded = false;
      this.isHovering = false;
    }

    // Airborne Hover (Holding Space in air with limited regenerating hover energy)
    if (spacePressed && !this.isGrounded && this.hoverEnergy > 0) {
      this.isHovering = true;
      this.hoverEnergy = Math.max(0, this.hoverEnergy - this.hoverDrainRate * delta);
      // Buoyant climb/float
      this.velocity.y += (this.hoverThrust - this.gravity) * delta * 1.5;
      this.velocity.y = Math.min(this.velocity.y, 4.5);
    } else {
      this.isHovering = false;
      if (!this.isGrounded) {
        this.velocity.y -= this.gravity * delta;
      }
    }

    // Hover energy regeneration when grounded
    if (this.isGrounded) {
      this.hoverEnergy = Math.min(this.maxHoverEnergy, this.hoverEnergy + this.hoverRechargeRate * delta);
    }

    this.lastSpacePressed = spacePressed;

    // 4. Substepped Swept Collision & Wall Sliding (prevents snagging or tunneling)
    const substeps = 4;
    const subDelta = delta / substeps;
    this.wasGrounded = this.isGrounded;

    for (let step = 0; step < substeps; step++) {
      this.position.x += this.velocity.x * subDelta;
      this.position.y += this.velocity.y * subDelta;
      this.position.z += this.velocity.z * subDelta;

      // Map boundary clamping [-140, 140]
      const mapBound = 138.0;
      if (this.position.x < -mapBound) { this.position.x = -mapBound; this.velocity.x = Math.max(0, this.velocity.x); }
      if (this.position.x > mapBound) { this.position.x = mapBound; this.velocity.x = Math.min(0, this.velocity.x); }
      if (this.position.z < -mapBound) { this.position.z = -mapBound; this.velocity.z = Math.max(0, this.velocity.z); }
      if (this.position.z > mapBound) { this.position.z = mapBound; this.velocity.z = Math.min(0, this.velocity.z); }

      this.resolveCollisions();
    }

    // Landing detection (Squash impact & Dust puff)
    if (!this.wasGrounded && this.isGrounded) {
      this.squash.y = 0.78;
      this.squash.xz = 1.18;
      this.spawnLandingDust();
    }

    // Squash recovery spring-damping
    this.squash.y += (1.0 - this.squash.y) * Math.min(1.0, delta * 14.0);
    this.squash.xz += (1.0 - this.squash.xz) * Math.min(1.0, delta * 14.0);
    this.tiltGroup.scale.set(this.squash.xz, this.squash.y, this.squash.xz);

    // Update Root Mesh Position
    this.mesh.position.copy(this.position);

    // 5. Procedural Animation Hierarchy (Walk, Run, Idle, Hover)
    this.updateAnimation(delta, time, moveVector, isRunning, cameraAngle, cameraPitch);

    // 6. Particles & Shadows
    this.updateBlobShadow();
    this.updateDustParticles(delta);
    this.updateThrusterParticles(delta, this.isHovering, this.isDashing);

    // Thruster ring glow color
    if (this.thrusterRingMat) {
      if (this.isDashing) {
        this.thrusterRingMat.color.setHex(0x00ffff);
      } else if (this.isHovering) {
        this.thrusterRingMat.color.setHex(0x33ffbb);
      } else {
        this.thrusterRingMat.color.setHex(0x116644);
      }
    }
  }

  resolveCollisions() {
    const r = this.collisionRadius;
    let groundY = 0.9;

    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const withinX = this.position.x > c.minX - r && this.position.x < c.maxX + r;
      const withinZ = this.position.z > c.minZ - r && this.position.z < c.maxZ + r;
      if (!withinX || !withinZ) continue;

      const minY = c.minY || 0;
      const headY = this.position.y + 0.6;

      if (this.position.y >= c.height - 0.25) {
        // Standing on the roof / deck
        groundY = Math.max(groundY, c.height + 0.9);
      } else if (minY > 0 && headY <= minY + 0.05) {
        // Passing underneath a skyway or awning
        continue;
      } else if (minY > 0 && this.position.y < minY) {
        // Head bump against the underside
        this.position.y = minY - 0.6;
        if (this.velocity.y > 0) this.velocity.y = 0;
      } else {
        // Wall sliding: push out along the closest face and zero only the perpendicular velocity
        const distMinX = Math.abs(this.position.x - (c.minX - r));
        const distMaxX = Math.abs(this.position.x - (c.maxX + r));
        const distMinZ = Math.abs(this.position.z - (c.minZ - r));
        const distMaxZ = Math.abs(this.position.z - (c.maxZ + r));
        const minDist = Math.min(distMinX, distMaxX, distMinZ, distMaxZ);

        if (minDist === distMinX) {
          this.position.x = c.minX - r;
          if (this.velocity.x > 0) this.velocity.x = 0;
        } else if (minDist === distMaxX) {
          this.position.x = c.maxX + r;
          if (this.velocity.x < 0) this.velocity.x = 0;
        } else if (minDist === distMinZ) {
          this.position.z = c.minZ - r;
          if (this.velocity.z > 0) this.velocity.z = 0;
        } else {
          this.position.z = c.maxZ + r;
          if (this.velocity.z < 0) this.velocity.z = 0;
        }
      }
    }

    this.currentGroundY = groundY;

    if (this.position.y <= groundY + 0.001) {
      this.position.y = groundY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.isGrounded = true;
    } else {
      this.isGrounded = false;
    }
  }

  updateAnimation(delta, time, moveVector, isRunning, cameraAngle, cameraPitch) {
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const isMoving = horizontalSpeed > 0.15;

    // 1. Torso Heading & Turn Banking
    if (isMoving) {
      const targetHeading = Math.atan2(this.velocity.x, this.velocity.z);
      let diff = targetHeading - this.mesh.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.mesh.rotation.y += diff * Math.min(1.0, delta * 9.0);

      // Bank into turn (roll proportional to turning rate)
      const targetRoll = -diff * 0.45;
      this.tilt.z += (targetRoll - this.tilt.z) * Math.min(1.0, delta * 10.0);
    } else {
      this.tilt.z += (0 - this.tilt.z) * Math.min(1.0, delta * 8.0);
    }

    // Acceleration Pitch (lean into speed)
    const targetPitchLean = (this.isHovering ? 0.22 : (isRunning ? 0.18 : 0.06)) * (isMoving ? 1.0 : 0.0);
    this.tilt.x += (targetPitchLean - this.tilt.x) * Math.min(1.0, delta * 8.0);

    this.tiltGroup.rotation.z = this.tilt.z;
    this.tiltGroup.rotation.x = this.tilt.x;

    // 2. Hover Stance Blend
    const targetHoverBlend = this.isHovering ? 1.0 : 0.0;
    this.hoverBlend += (targetHoverBlend - this.hoverBlend) * Math.min(1.0, delta * 8.0);

    // 3. Stride Sync: Driven by Distance Traveled (ZERO FOOT SLIDING!)
    const strideLength = isRunning ? ROBOT_CONFIG.runStrideLength : ROBOT_CONFIG.walkStrideLength;
    const stepHeight = isRunning ? ROBOT_CONFIG.runStepHeight : ROBOT_CONFIG.walkStepHeight;
    const torsoBobAmp = isRunning ? 0.045 : 0.024;
    const armSwingAmp = isRunning ? 0.85 : 0.48;

    if (this.isGrounded && isMoving) {
      this.distanceTraveled += horizontalSpeed * delta;
      this.walkCyclePhase = (this.distanceTraveled / strideLength) * Math.PI * 2;
    }

    // 4. Two-Bone Leg Kinematics Solver
    const solve2BoneLeg = (targetY, targetZ, thighGroup, kneeGroup, footGroup) => {
      const d = Math.max(0.08, Math.min(this.thighLength + this.shinLength - 0.005, Math.hypot(targetY, targetZ)));
      const psi = Math.atan2(targetZ, -targetY);

      const cosAlpha = Math.max(-1, Math.min(1, (this.thighLength * this.thighLength + d * d - this.shinLength * this.shinLength) / (2 * this.thighLength * d)));
      const alpha = Math.acos(cosAlpha);

      const cosBeta = Math.max(-1, Math.min(1, (this.thighLength * this.thighLength + this.shinLength * this.shinLength - d * d) / (2 * this.thighLength * this.shinLength)));
      const beta = Math.acos(cosBeta);

      const thighRot = psi + alpha;
      const kneeRot = -(Math.PI - beta);
      const ankleRot = -(thighRot + kneeRot);

      thighGroup.rotation.x = thighRot;
      kneeGroup.rotation.x = kneeRot;
      footGroup.rotation.x = ankleRot;
    };

    if (this.hoverBlend > 0.01) {
      // Tucked Hover Pose (hips forward, knees bent back, feet pointed)
      const tuckThigh = 0.62 * this.hoverBlend;
      const tuckKnee = -1.25 * this.hoverBlend;
      const tuckFoot = 0.45 * this.hoverBlend;

      this.leftThigh.rotation.x = THREE.MathUtils.lerp(this.leftThigh.rotation.x, tuckThigh, this.hoverBlend);
      this.leftKnee.rotation.x = THREE.MathUtils.lerp(this.leftKnee.rotation.x, tuckKnee, this.hoverBlend);
      this.leftFoot.rotation.x = THREE.MathUtils.lerp(this.leftFoot.rotation.x, tuckFoot, this.hoverBlend);

      this.rightThigh.rotation.x = THREE.MathUtils.lerp(this.rightThigh.rotation.x, tuckThigh, this.hoverBlend);
      this.rightKnee.rotation.x = THREE.MathUtils.lerp(this.rightKnee.rotation.x, tuckKnee, this.hoverBlend);
      this.rightFoot.rotation.x = THREE.MathUtils.lerp(this.rightFoot.rotation.x, tuckFoot, this.hoverBlend);
    } else if (this.isGrounded && isMoving) {
      // Walk / Run Cycle with Grounded Foot Stance & Swing
      const phaseL = (this.walkCyclePhase) % (Math.PI * 2);
      const phaseR = (this.walkCyclePhase + Math.PI) % (Math.PI * 2);

      const computeFootPos = (phase) => {
        let z, y;
        if (phase < Math.PI) {
          // Stance: foot is planted firmly on ground moving backwards relative to hip
          const u = phase / Math.PI;
          z = strideLength * (0.5 - u) * 0.5;
          y = this.footRestY;
        } else {
          // Swing: foot lifts in a parabolic arc moving forwards
          const u = (phase - Math.PI) / Math.PI;
          z = strideLength * (u - 0.5) * 0.5;
          y = this.footRestY + Math.sin(u * Math.PI) * stepHeight;
        }
        return { y, z };
      };

      const footL = computeFootPos(phaseL);
      const footR = computeFootPos(phaseR);

      solve2BoneLeg(footL.y, footL.z, this.leftThigh, this.leftKnee, this.leftFoot);
      solve2BoneLeg(footR.y, footR.z, this.rightThigh, this.rightKnee, this.rightFoot);
    } else {
      // Idle Breathing Stance (subtle knee flexion)
      const idleBreathing = Math.sin(time * 2.2) * 0.012;
      const targetY = this.footRestY + idleBreathing;
      solve2BoneLeg(targetY, 0, this.leftThigh, this.leftKnee, this.leftFoot);
      solve2BoneLeg(targetY, 0, this.rightThigh, this.rightKnee, this.rightFoot);
    }

    // 5. Torso Bob & Twist
    if (this.isGrounded && isMoving) {
      const bob = -Math.abs(Math.sin(this.walkCyclePhase)) * torsoBobAmp;
      const twist = Math.sin(this.walkCyclePhase) * (isRunning ? 0.10 : 0.06);
      this.torsoGroup.position.y = 0.44 + bob;
      this.torsoGroup.rotation.y = twist;
    } else {
      const idleBob = Math.sin(time * 2.2) * 0.015;
      this.torsoGroup.position.y = 0.44 + idleBob;
      this.torsoGroup.rotation.y = 0;
    }

    // 6. Arm Swings (opposite to legs)
    if (this.isHovering) {
      // Stabilizing float arms (raised slightly forward and outward)
      this.leftShoulder.rotation.x = -0.35;
      this.leftShoulder.rotation.z = 0.35;
      this.leftElbow.rotation.x = -0.45;

      this.rightShoulder.rotation.x = -0.35;
      this.rightShoulder.rotation.z = -0.35;
      this.rightElbow.rotation.x = -0.45;
    } else if (this.isGrounded && isMoving) {
      const armSwing = Math.sin(this.walkCyclePhase) * armSwingAmp;
      this.leftShoulder.rotation.x = -armSwing;
      this.leftShoulder.rotation.z = 0.12;
      this.leftElbow.rotation.x = Math.max(0, -armSwing * 0.5) - 0.2;

      this.rightShoulder.rotation.x = armSwing;
      this.rightShoulder.rotation.z = -0.12;
      this.rightElbow.rotation.x = Math.max(0, armSwing * 0.5) - 0.2;
    } else {
      // Idle relaxed arms with gentle breathing sway
      const armBreath = Math.sin(time * 2.2) * 0.04;
      this.leftShoulder.rotation.x = armBreath;
      this.leftShoulder.rotation.z = 0.08;
      this.leftElbow.rotation.x = -0.15;

      this.rightShoulder.rotation.x = armBreath;
      this.rightShoulder.rotation.z = -0.08;
      this.rightElbow.rotation.x = -0.15;
    }

    // 7. Seed Lantern Sway & Micro-Interactions
    this.lanternPivot.rotation.z = -this.tilt.z * 1.4 + Math.sin(time * 2.2) * 0.06;
    this.lanternPivot.rotation.x = -this.tilt.x * 1.4 + Math.cos(time * 2.2) * 0.05;

    // 8. Head Camera Tracking & Eye Blinking
    this.updateHeadAndEye(delta, time, cameraAngle, cameraPitch, isMoving);
  }

  updateHeadAndEye(delta, time, cameraAngle, cameraPitch, isMoving) {
    // Relative yaw between camera direction and robot body facing
    let lookYaw = cameraAngle - this.mesh.rotation.y;
    while (lookYaw > Math.PI) lookYaw -= Math.PI * 2;
    while (lookYaw < -Math.PI) lookYaw += Math.PI * 2;

    // Clamp head look angles to natural range
    const clampedYaw = Math.max(-1.15, Math.min(1.15, lookYaw));
    const clampedPitch = Math.max(-0.35, Math.min(0.65, cameraPitch));

    // Idle curious glance when stationary
    if (!isMoving) {
      this.idleGazeTimer += delta;
      if (this.idleGazeTimer > 3.8) {
        this.idleGazeOffset.x = (Math.random() - 0.5) * 0.25;
        this.idleGazeOffset.y = (Math.random() - 0.5) * 0.12;
        this.idleGazeTimer = 0.0;
      }
    } else {
      this.idleGazeOffset.x = 0;
      this.idleGazeOffset.y = 0;
    }

    const targetHeadYaw = clampedYaw * 0.75 + this.idleGazeOffset.x;
    const targetHeadPitch = clampedPitch * 0.65 + this.idleGazeOffset.y;

    this.headGroup.rotation.y += (targetHeadYaw - this.headGroup.rotation.y) * Math.min(1.0, delta * 8.0);
    this.headGroup.rotation.x += (targetHeadPitch - this.headGroup.rotation.x) * Math.min(1.0, delta * 8.0);

    // Eye shift inside visor
    const eyeShiftX = Math.max(-0.045, Math.min(0.045, (clampedYaw - this.headGroup.rotation.y) * 0.08));
    const eyeShiftY = Math.max(-0.035, Math.min(0.035, (clampedPitch - this.headGroup.rotation.x) * 0.06));
    this.eyePivot.position.x = eyeShiftX;
    this.eyePivot.position.y = 0.18 + eyeShiftY;

    // Proximity iris glow
    if (this.isNearPlantSpot) {
      this.irisMat.color.setHex(0x38ef7d);
      this.eyeMesh.scale.set(1.25, 1.25, 0.4);
      this.eyeHalo.scale.set(1.25, 1.25, 1.0);
    } else {
      this.irisMat.color.setHex(0x00ff88);
      this.eyeMesh.scale.set(1.0, 1.0, 0.35);
      this.eyeHalo.scale.set(1.0, 1.0, 1.0);
    }

    // Blinking cycle
    this.blinkTimer += delta;
    if (this.blinkTimer > 4.2) {
      this.isBlinking = true;
      this.eyelid.scale.y = 1.05; // Closed
      if (this.blinkTimer > 4.34) {
        this.isBlinking = false;
        this.eyelid.scale.y = 0.05; // Open
        this.blinkTimer = (Math.random() - 0.5) * 1.5;
      }
    }
  }

  updateBlobShadow() {
    if (!this.blobShadow) return;
    this.blobShadow.position.set(this.position.x, this.currentGroundY + 0.02, this.position.z);
    const heightAboveGround = Math.max(0, this.position.y - this.currentGroundY);
    const scale = Math.max(0.65, 1.0 + heightAboveGround * 0.24);
    this.blobShadow.scale.set(scale, scale, 1);
    this.blobShadow.material.opacity = Math.max(0.12, 0.75 - heightAboveGround * 0.14);
  }

  reset() {
    this.position.set(-6.8, 0.9, 0);
    this.velocity.set(0, 0, 0);
    this.isDashing = false;
    this.isHovering = false;
    this.isGrounded = true;
    this.wasGrounded = true;
    this.hoverEnergy = this.maxHoverEnergy;
    this.dashTimer = 0.0;
    this.dashCooldownTimer = 0.0;
    this.currentGroundY = 0.9;
    this.distanceTraveled = 0.0;
    this.walkCyclePhase = 0.0;
    this.tilt = { x: 0, z: 0 };
    this.squash = { y: 1.0, xz: 1.0 };
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(0, Math.PI, 0);
    this.tiltGroup.rotation.set(0, 0, 0);
    this.torsoGroup.position.set(0, 0.44, 0);
    this.torsoGroup.rotation.set(0, 0, 0);
    this.headGroup.rotation.set(0, 0, 0);
  }
}

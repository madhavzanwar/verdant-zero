import * as THREE from 'three';

/**
 * Camera Controller
 * - Title Mode: Cinematic flight through clouds into street canyon with mouse parallax
 * - Gameplay Mode: 360° Mouse look with pointer lock, vertical pitch clamping,
 *   building collision prevention, ground clamp, spring damping, and dash FOV effect
 * - Configurable Sensitivity and Invert-Y persisted in localStorage
 */

export class CameraController {
  constructor(camera, colliders = []) {
    this.camera = camera;
    this.colliders = colliders;
    this.mode = 'TITLE'; // 'TITLE' | 'TRANSITIONING' | 'GAMEPLAY'

    // Mouse Settings
    this.sensitivity = parseFloat(localStorage.getItem('vz_mouse_sensitivity') || '1.0');
    this.invertY = localStorage.getItem('vz_invert_y') === 'true';

    // Title screen mouse parallax
    this.titleMouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.initTitleMouseListener();

    // Orbital Angles for Gameplay Mouse Look
    // Yaw: horizontal rotation (radians)
    // Pitch: vertical tilt (radians)
    this.yaw = 0.0;
    this.pitch = 0.22;
    this.targetYaw = 0.0;
    this.targetPitch = 0.22;

    // Pitch Clamping: never flip, never go below ground
    this.minPitch = -0.38; // Looking down at street (~ -22 deg)
    this.maxPitch = 1.18;  // Looking up at sky & towering skyscrapers (~ +68 deg)

    // Distance & Spring Damping
    this.baseDistance = 5.4;
    this.currentDistance = 5.4;
    this.damping = 12.0;

    // Camera FOV
    this.baseFov = 50;
    this.dashFov = 57;

    // Title Camera Parameters
    this.titleTime = 0;
    this.camera.position.set(0, 80, 80);
    this.camera.lookAt(0, 14, -50);

    // Transition State
    this.transitionProgress = 0;
    this.startPos = new THREE.Vector3();
    this.startLook = new THREE.Vector3();
  }

  setColliders(colliders) {
    this.colliders = colliders;
  }

  initTitleMouseListener() {
    window.addEventListener('pointermove', (e) => {
      if (this.mode === 'TITLE') {
        this.titleMouse.targetX = (e.clientX / window.innerWidth - 0.5) * 2;
        this.titleMouse.targetY = (e.clientY / window.innerHeight - 0.5) * 2;
      }
    });
  }

  setSensitivity(val) {
    this.sensitivity = Math.max(0.1, Math.min(4.0, val));
    localStorage.setItem('vz_mouse_sensitivity', this.sensitivity.toString());
  }

  setInvertY(val) {
    this.invertY = !!val;
    localStorage.setItem('vz_invert_y', this.invertY.toString());
  }

  /**
   * Process mouse movement delta from Pointer Lock
   */
  handlePointerMove(movementX, movementY) {
    if (this.mode !== 'GAMEPLAY') return;

    const sensFactor = this.sensitivity * 0.0022;

    // Mouse right -> turns view to right
    this.targetYaw -= movementX * sensFactor;

    // Mouse up -> tilts view up toward sky; Mouse down -> tilts toward street
    const yDir = this.invertY ? 1 : -1;
    this.targetPitch -= movementY * yDir * sensFactor;

    // Clamp pitch
    this.targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.targetPitch));
  }

  /**
   * Fallback for mouse position when pointer lock is not active
   */
  handleScreenMouseFallback(normX, normY) {
    if (this.mode !== 'GAMEPLAY') return;

    // Gentle look offset based on screen position
    const targetOffsetYaw = -normX * 0.8;
    const targetOffsetPitch = (this.invertY ? normY : -normY) * 0.5;

    this.targetPitch = Math.max(this.minPitch, Math.min(this.maxPitch, targetOffsetPitch + 0.2));
  }

  startGameplayTransition(robotPos) {
    this.mode = 'TRANSITIONING';
    this.transitionProgress = 0;
    this.startPos.copy(this.camera.position);
    this.startLook.set(0, 14, -50);

    // Initial orientation facing down street
    this.targetYaw = 0.0;
    this.yaw = 0.0;
    this.targetPitch = 0.22;
    this.pitch = 0.22;
  }

  update(delta, time, robot) {
    if (this.mode === 'TITLE') {
      this.updateTitleCamera(delta, time);
    } else if (this.mode === 'TRANSITIONING') {
      this.updateTransition(delta, robot);
    } else if (this.mode === 'GAMEPLAY') {
      this.updateGameplayCamera(delta, robot);
    }
  }

  updateTitleCamera(delta, time) {
    this.titleTime += delta;

    // Mouse parallax
    this.titleMouse.x += (this.titleMouse.targetX - this.titleMouse.x) * 0.05;
    this.titleMouse.y += (this.titleMouse.targetY - this.titleMouse.y) * 0.05;

    // Descent phase (first 4 seconds: flies down from clouds into the street canyon)
    const descent = Math.min(1.0, this.titleTime / 4.0);
    const easeDescent = 1 - Math.pow(1 - descent, 3);

    const startY = 85;
    const targetY = 22;
    const currentY = startY + (targetY - startY) * easeDescent;

    // Gentle drifting flight along street canyon
    const x = Math.sin(time * 0.06) * 4.5 + this.titleMouse.x * 4.0;
    const z = 48 + Math.cos(time * 0.05) * 4.0 - this.titleMouse.y * 3.0;
    const y = currentY + Math.sin(time * 0.08) * 2.0;

    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 14, -50);
  }

  updateTransition(delta, robot) {
    this.transitionProgress += delta * 1.0; // ~1.0s smooth transition

    const t = Math.min(1.0, this.transitionProgress);
    const ease = t * t * (3.0 - 2.0 * t); // smoothstep

    // Desired initial gameplay position
    const targetLook = robot.position.clone().add(new THREE.Vector3(0, 1.0, 0));
    const offset = this.calculateOrbitalOffset(this.yaw, this.pitch, this.baseDistance);
    const desiredPos = targetLook.clone().add(offset);

    this.camera.position.lerpVectors(this.startPos, desiredPos, ease);
    this.camera.lookAt(
      THREE.MathUtils.lerp(this.startLook.x, targetLook.x, ease),
      THREE.MathUtils.lerp(this.startLook.y, targetLook.y, ease),
      THREE.MathUtils.lerp(this.startLook.z, targetLook.z, ease)
    );

    if (t >= 1.0) {
      this.mode = 'GAMEPLAY';
    }
  }

  calculateOrbitalOffset(yaw, pitch, distance) {
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    return new THREE.Vector3(
      sinYaw * cosPitch * distance,
      sinPitch * distance + 0.6,
      cosYaw * cosPitch * distance
    );
  }

  updateGameplayCamera(delta, robot) {
    // 1. Smoothly damp yaw and pitch towards target angles (cinematic, non-jittery)
    const dampFactor = Math.min(1.0, delta * this.damping);
    this.yaw += (this.targetYaw - this.yaw) * dampFactor;
    this.pitch += (this.targetPitch - this.pitch) * dampFactor;

    // 2. Center of focus on robot
    const targetLook = robot.position.clone().add(new THREE.Vector3(0, 1.1, 0));
    // Subtle look-ahead in robot velocity direction
    targetLook.addScaledVector(robot.velocity, 0.04);

    // 3. Calculate ideal camera position along orbital angles
    let idealOffset = this.calculateOrbitalOffset(this.yaw, this.pitch, this.baseDistance);
    let idealPos = targetLook.clone().add(idealOffset);

    // 4. Building Collision Prevention (camera never clips through buildings)
    idealPos = this.preventBuildingClipping(targetLook, idealPos);

    // 5. Ground Clamp (camera never goes below ground)
    idealPos.y = Math.max(1.2, idealPos.y);

    // 6. Smooth camera position interpolation
    this.camera.position.lerp(idealPos, Math.min(1.0, delta * 14.0));
    this.camera.lookAt(targetLook);

    // 7. Dynamic Dash FOV expansion
    const targetFov = robot.isDashing ? this.dashFov : this.baseFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.08) {
      this.camera.fov += (targetFov - this.camera.fov) * delta * 5.5;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Prevents camera from penetrating building walls
   */
  preventBuildingClipping(origin, target) {
    const rayDir = target.clone().sub(origin);
    const maxDist = rayDir.length();
    rayDir.normalize();

    let closestDist = maxDist;
    const safetyMargin = 0.5;

    for (let c of this.colliders) {
      // Simple ray-AABB test
      const t = this.rayAABB(origin, rayDir, c);
      if (t !== null && t > 0.1 && t < closestDist) {
        closestDist = Math.max(1.6, t - safetyMargin);
      }
    }

    if (closestDist < maxDist) {
      return origin.clone().addScaledVector(rayDir, closestDist);
    }
    return target;
  }

  rayAABB(origin, dir, box) {
    let tmin = -Infinity;
    let tmax = Infinity;

    // X axis
    if (Math.abs(dir.x) > 0.0001) {
      const tx1 = (box.minX - origin.x) / dir.x;
      const tx2 = (box.maxX - origin.x) / dir.x;
      tmin = Math.max(tmin, Math.min(tx1, tx2));
      tmax = Math.min(tmax, Math.max(tx1, tx2));
    } else if (origin.x < box.minX || origin.x > box.maxX) {
      return null;
    }

    // Y axis (ground to building height)
    if (Math.abs(dir.y) > 0.0001) {
      const ty1 = (0 - origin.y) / dir.y;
      const ty2 = (box.height - origin.y) / dir.y;
      tmin = Math.max(tmin, Math.min(ty1, ty2));
      tmax = Math.min(tmax, Math.max(ty1, ty2));
    } else if (origin.y < 0 || origin.y > box.height) {
      return null;
    }

    // Z axis
    if (Math.abs(dir.z) > 0.0001) {
      const tz1 = (box.minZ - origin.z) / dir.z;
      const tz2 = (box.maxZ - origin.z) / dir.z;
      tmin = Math.max(tmin, Math.min(tz1, tz2));
      tmax = Math.min(tmax, Math.max(tz1, tz2));
    } else if (origin.z < box.minZ || origin.z > box.maxZ) {
      return null;
    }

    if (tmax >= tmin && tmax > 0) {
      return tmin > 0 ? tmin : tmax;
    }
    return null;
  }

  /**
   * Returns current camera horizontal angle for player movement
   */
  getHorizontalAngle() {
    return this.yaw;
  }

  /**
   * Returns current camera pitch for robot eye tracking
   */
  getPitchAngle() {
    return this.pitch;
  }
}

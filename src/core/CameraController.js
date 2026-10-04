import * as THREE from 'three';

/**
 * Camera Controller
 * - Cinematic Title Camera: flies down through clouds & towers, settles into drifting orbit looking down the street canyon
 * - Smooth transition from Title to Gameplay
 * - Third-person follow camera: spring damping, look-ahead, and dynamic dash FOV expansion
 */

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'TITLE'; // 'TITLE' | 'TRANSITIONING' | 'GAMEPLAY'

    // Mouse parallax
    this.mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
    this.initMouseListener();

    // Cinematic Title Camera parameters
    this.titleTime = 0;
    this.camera.position.set(0, 80, 80);
    this.camera.lookAt(0, 14, -40);

    // Gameplay follow parameters (behind robot looking toward wall and street)
    this.followOffset = new THREE.Vector3(3.8, 2.4, 3.2);
    this.baseFov = 50;
    this.dashFov = 56;

    // Transition state
    this.transitionProgress = 0;
    this.startPos = new THREE.Vector3();
    this.startLook = new THREE.Vector3();
  }

  initMouseListener() {
    window.addEventListener('pointermove', (e) => {
      this.mouse.targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      this.mouse.targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    });
  }

  startGameplayTransition(robotPos) {
    this.mode = 'TRANSITIONING';
    this.transitionProgress = 0;
    this.startPos.copy(this.camera.position);

    // Initial look direction
    this.startLook.set(0, 14, -40);
  }

  update(delta, time, robot) {
    // Smooth mouse parallax
    this.mouse.x += (this.mouse.targetX - this.mouse.x) * 0.05;
    this.mouse.y += (this.mouse.targetY - this.mouse.y) * 0.05;

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

    // Descent phase (first 4 seconds: flies down from clouds into the street canyon)
    const descent = Math.min(1.0, this.titleTime / 4.0);
    const easeDescent = 1 - Math.pow(1 - descent, 3);

    const startY = 85;
    const targetY = 22;
    const currentY = startY + (targetY - startY) * easeDescent;

    // Gentle drifting flight along street canyon
    const x = Math.sin(time * 0.06) * 4.5 + this.mouse.x * 4.0;
    const z = 48 + Math.cos(time * 0.05) * 4.0 - this.mouse.y * 3.0;
    const y = currentY + Math.sin(time * 0.08) * 2.0;

    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 14, -50);
  }

  updateTransition(delta, robot) {
    this.transitionProgress += delta * 0.9; // ~1.1s smooth transition

    const t = Math.min(1.0, this.transitionProgress);
    const ease = t * t * (3.0 - 2.0 * t); // smoothstep

    const desiredPos = robot.position.clone().add(this.followOffset);
    const desiredLook = robot.position.clone().add(new THREE.Vector3(-1.0, 1.0, 0));

    this.camera.position.lerpVectors(this.startPos, desiredPos, ease);
    this.camera.lookAt(
      THREE.MathUtils.lerp(this.startLook.x, desiredLook.x, ease),
      THREE.MathUtils.lerp(this.startLook.y, desiredLook.y, ease),
      THREE.MathUtils.lerp(this.startLook.z, desiredLook.z, ease)
    );

    if (t >= 1.0) {
      this.mode = 'GAMEPLAY';
    }
  }

  updateGameplayCamera(delta, robot) {
    // 1. Spring-Damped Follow Position
    const desiredPos = robot.position.clone().add(this.followOffset);
    desiredPos.x += this.mouse.x * 1.2;
    desiredPos.y -= this.mouse.y * 0.8;

    this.camera.position.lerp(desiredPos, delta * 5.0);

    // 2. Look-Ahead Targeting (faces robot and wall ahead)
    const lookTarget = robot.position.clone().add(new THREE.Vector3(-1.0, 0.8, 0));
    lookTarget.addScaledVector(robot.velocity, 0.08);

    this.camera.lookAt(lookTarget);

    // 3. Dynamic Dash FOV expansion
    const targetFov = robot.isDashing ? this.dashFov : this.baseFov;
    if (Math.abs(this.camera.fov - targetFov) > 0.1) {
      this.camera.fov += (targetFov - this.camera.fov) * delta * 5.0;
      this.camera.updateProjectionMatrix();
    }
  }
}

/**
 * VERDANT ZERO // Input Manager
 * Normalizes Keyboard, Mouse, and Touch interactions for 60fps gameplay.
 */
export class InputManager {
  constructor() {
    this.keys = new Map();
    this.mouse = {
      x: 0,
      y: 0,
      isDown: false,
      rightDown: false
    };

    this.bindEvents();
  }

  bindEvents() {
    window.addEventListener('keydown', (e) => {
      this.keys.set(e.code, true);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);
    });

    window.addEventListener('pointermove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    window.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.mouse.isDown = true;
      if (e.button === 2) this.mouse.rightDown = true;
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouse.isDown = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });
  }

  isKeyPressed(code) {
    return !!this.keys.get(code);
  }
}

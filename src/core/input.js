// =============================================================================
// FLATLINE: 2050 — core/input.js
// Keyboard + mouse state (gamepad arrives in Phase 11).
//
//   input.isDown('KeyW')        held right now
//   input.wasPressed('KeyR')    went down this frame
//   input.wasReleased('KeyT')   went up this frame
//   input.heldTime('KeyR')      seconds held (tap R = reload, hold R = rewind)
//   input.lastHold('KeyR')      how long it was held before its last release
//   input.mouse.dx / dy         mouse movement this frame (pointer lock)
//   input.pad                   gamepad sticks/triggers (Phase 11); buttons act as keys
//
// Call input.endFrame() once at the END of every frame.
// Key names are KeyboardEvent.code values, so they work on any layout.
// =============================================================================

class Input {
  constructor() {
    this.down = new Map();      // code -> timestamp when pressed (ms)
    this.pressed = new Set();
    this.released = new Set();
    this.holds = new Map();     // code -> how long it was held last time (s)
    // Gamepad (Xbox / PlayStation standard mapping): sticks + triggers, buttons → keys
    this.pad = { connected: false, lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
    this._padDown = new Set();
    this.mouse = { dx: 0, dy: 0, wheel: 0, buttons: new Set(), locked: false };
    this.enabled = true;
    this._attached = false;
  }

  attach(target = window) {
    if (this._attached) return;
    this._attached = true;

    target.addEventListener('keydown', (e) => {
      if (!this.enabled || e.repeat) return;
      this.down.set(e.code, performance.now());
      this.pressed.add(e.code);
      // Stop the browser scrolling / searching on game keys.
      if (['Space', 'Tab', 'AltLeft', 'AltRight', 'F9'].includes(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      const t = this.down.get(e.code);
      if (t !== undefined) this.holds.set(e.code, (performance.now() - t) / 1000);
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    target.addEventListener('mousedown', (e) => {
      this.mouse.buttons.add(e.button);
      this.pressed.add(`Mouse${e.button}`);
    });
    target.addEventListener('mouseup', (e) => {
      this.mouse.buttons.delete(e.button);
      this.released.add(`Mouse${e.button}`);
    });
    target.addEventListener('mousemove', (e) => {
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    target.addEventListener('wheel', (e) => (this.mouse.wheel += Math.sign(e.deltaY)), { passive: true });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    // Losing focus would leave keys "stuck down" — clear everything.
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('pointerlockchange', () => {
      this.mouse.locked = !!document.pointerLockElement;
    });
  }

  isDown(code) {
    return this.down.has(code) || (code.startsWith('Mouse') && this.mouse.buttons.has(Number(code.slice(5))));
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  wasReleased(code) {
    return this.released.has(code);
  }

  heldTime(code) {
    const t = this.down.get(code);
    return t === undefined ? 0 : (performance.now() - t) / 1000;
  }

  /**
   * Poll the first gamepad (call once per frame, before the world updates).
   * Buttons press/release virtual keys, so every system reads them for free:
   *   A Space · B KeyC · X KeyR (tap reload / hold rewind) · Y KeyE · LB KeyR · RB KeyT
   *   LT aim (Mouse2) · RT fire (Mouse0) · Back KeyV · Start Escape · L3 Shift · R3 KeyQ
   *   D-pad: up Digit1 · right Digit2 · left Digit3 · down KeyF
   * The right stick turns the camera (as mouse movement).
   */
  pollGamepad() {
    const gp = navigator.getGamepads?.().find((g) => g && g.connected);
    const p = this.pad;
    p.connected = !!gp;
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    p.lx = dz(gp.axes[0] ?? 0);
    p.ly = dz(gp.axes[1] ?? 0);
    p.rx = dz(gp.axes[2] ?? 0);
    p.ry = dz(gp.axes[3] ?? 0);
    p.lt = gp.buttons[6]?.value ?? 0;
    p.rt = gp.buttons[7]?.value ?? 0;
    this.mouse.dx += p.rx * 16;
    this.mouse.dy += p.ry * 12;
    const MAP = { 0: 'Space', 1: 'KeyC', 2: 'KeyR', 3: 'KeyE', 4: 'KeyR', 5: 'KeyT', 6: 'Mouse2', 7: 'Mouse0', 8: 'KeyV', 9: 'Escape', 10: 'ShiftLeft', 11: 'KeyQ', 12: 'Digit1', 13: 'KeyF', 14: 'Digit3', 15: 'Digit2' };
    for (const [i, code] of Object.entries(MAP)) {
      const on = (gp.buttons[i]?.value ?? 0) > 0.5;
      const was = this._padDown.has(code + i);
      if (on && !was) {
        this._padDown.add(code + i);
        if (code.startsWith('Mouse')) this.mouse.buttons.add(Number(code.slice(5)));
        else this.down.set(code, performance.now());
        this.pressed.add(code);
        if (code === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
      } else if (!on && was) {
        this._padDown.delete(code + i);
        if (code.startsWith('Mouse')) this.mouse.buttons.delete(Number(code.slice(5)));
        else {
          const t = this.down.get(code);
          if (t !== undefined) this.holds.set(code, (performance.now() - t) / 1000);
          this.down.delete(code);
        }
        this.released.add(code);
      }
    }
  }

  /** True when a gamepad or captured mouse is steering the camera. */
  get lookActive() {
    return this.mouse.locked || this.pad.connected;
  }

  /** Seconds the key was held the last time it was released (tap vs hold). */
  lastHold(code) {
    return this.holds.get(code) ?? Infinity;
  }

  /** True if any key or mouse button went down this frame (skip prompts). */
  anyPressed() {
    return this.pressed.size > 0;
  }

  requestPointerLock(element) {
    element.requestPointerLock?.();
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }

  reset() {
    this.down.clear();
    this.mouse.buttons.clear();
    this.endFrame();
  }
}

export const input = new Input();

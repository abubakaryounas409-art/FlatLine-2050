// =============================================================================
// FLATLINE: 2050 — player/playerController.js
// Kael on foot, 2020 (CLAUDE.md Phase 5): a Rapier kinematic capsule driven by
// Rapier's character controller (slopes, steps, snap-to-ground).
//
//   WASD move (camera-relative) · Shift sprint · Ctrl/C crouch · Space jump,
//   or vault over a low obstacle in front · Alt roll · E cover (A/D slide,
//   right mouse peeks) · F interact · Q shoulder swap (camera rig)
//
// Input is read once per frame into `intent`; movement runs on the fixed
// 60 Hz physics step (rule A7.6). The body origin is at the FEET.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { input } from '../core/input.js';
import { timeScale } from '../core/timeScale.js';
import { audio } from '../core/audio.js';
import { createModelInstance } from '../assets/loader.js';
import { styleKael2020 } from '../assets/modelStyles.js';
import { PlayerAnims } from './playerAnims.js';

const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/** Shortest signed angle from a to b. */
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

export class PlayerController {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {object} o.template   loaded model template (characters.kael_2020)
   * @param {THREE.Vector3} o.position  feet
   * @param {number} o.yaw        facing (0 = +Z)
   * @param {CameraRig} o.rig     for camera-relative movement and aiming
   * @param {(m: THREE.Material) => THREE.Material} o.track  material disposal tracker
   */
  constructor({ scene, template, position, yaw = 0, rig, track = (m) => m }) {
    const P = CONFIG.player;
    const R = physics.RAPIER;
    this.rig = rig;

    // --- Visual: root follows the body (position only), `model` turns ---------------
    this.root = new THREE.Group();
    this.root.name = 'player';
    this.model = createModelInstance(template);
    if (!template.isPlaceholder) styleKael2020(this.model, track);
    this.root.add(this.model);
    scene.add(this.root);
    this.anims = new PlayerAnims(this.model, template.animations);
    this.yaw = yaw;
    this.model.rotation.y = yaw;

    // --- Physics ----------------------------------------------------------------------------
    this.standHalf = (P.height - 2 * P.radius) / 2;
    this.crouchHalf = (P.crouchHeight - 2 * P.radius) / 2;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z),
    );
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(this.standHalf, P.radius).setTranslation(0, this.standHalf + P.radius, 0).setFriction(0),
      this.body,
    );
    this.kcc = physics.world.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setMaxSlopeClimbAngle(P.maxSlope * DEG);
    this.kcc.setMinSlopeSlideAngle((P.maxSlope - 8) * DEG);
    this.kcc.enableAutostep(P.stepHeight, 0.2, false);
    this.kcc.enableSnapToGround(P.snapToGround);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    physics.link(this.body, this.root);

    // --- State ------------------------------------------------------------------------------
    this.state = 'move';        // move | roll | vault | cover | dead
    this.velocity = new THREE.Vector3(); // horizontal, m/s
    this.vy = 0;
    this.grounded = true;
    this.airTime = 0;
    this.crouched = false;
    this.sprinting = false;
    this.aiming = false;
    this.combat = false;        // weapon up after firing (set by weapons.js): face the crosshair
    this.cinematic = false;     // cutscenes play clips directly
    this.carrying = false;      // someone on his shoulder (Mission 6): no sprint, no guns
    this.armed = false;         // carrying a gun → armed idle
    this.locked = false;        // cutscenes / menus: no control
    this.intent = { move: new THREE.Vector2(), sprint: false, crouch: false, jump: false, roll: false, aim: false, cover: false, interact: false };
    this.inputOverride = null;  // tests / scripted moments
    this.maxHealth = CONFIG.player.health;
    this.health = this.maxHealth;
    this.onDeath = null;        // world hook: costs heartbeats, respawns
    this._sinceHurt = 99;
    this._lastFlinch = 0;
    this.interactables = [];    // { position, radius, prompt, enabled?, onInteract }
    this.focus = null;          // interactable currently in reach
    this._roll = null;
    this._vault = null;
    this.cover = null;          // { normal, tangent, high, edge }
    this._rollCooldown = 0;
    this._coyote = 0;
    this._jumpBuffer = 0;
    this._fixedOff = physics.onFixedUpdate((dt) => this.fixedUpdate(dt));
    this._generation = physics.generation;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  get position() {
    return this.root.position;
  }

  /** Physics position of the feet (not interpolated). */
  get feet() {
    const t = this.body.translation();
    return tmp2.set(t.x, t.y, t.z);
  }

  get speed() {
    return this.velocity.length();
  }

  /** Camera pivot height above the feet. */
  get eyeHeight() {
    const C = CONFIG.cameraRig;
    return this.crouched || this.state === 'roll' || (this.cover && !this.cover.high && !this.aiming) ? C.crouchHeight : C.height;
  }

  facing(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  _ray(origin, dir, maxToi, normal = false) {
    const R = physics.RAPIER;
    const ray = new R.Ray(origin, dir);
    const flags = R.QueryFilterFlags.EXCLUDE_SENSORS;
    return normal
      ? physics.world.castRayAndGetNormal(ray, maxToi, true, flags, undefined, this.collider)
      : physics.world.castRay(ray, maxToi, true, flags, undefined, this.collider);
  }

  // ---------------------------------------------------------------------------
  // Per frame: input → intent, animation, facing
  // ---------------------------------------------------------------------------
  readInput() {
    const i = this.intent;
    if (this.inputOverride) return Object.assign(i, this.inputOverride);
    const k = input;
    i.move.set((k.isDown('KeyD') ? 1 : 0) - (k.isDown('KeyA') ? 1 : 0), (k.isDown('KeyW') ? 1 : 0) - (k.isDown('KeyS') ? 1 : 0));
    if (k.pad.connected && (k.pad.lx || k.pad.ly)) i.move.set(k.pad.lx, -k.pad.ly); // left stick
    if (i.move.lengthSq() > 1) i.move.normalize();
    i.sprint = k.isDown('ShiftLeft') || k.isDown('ShiftRight');
    i.crouch ||= k.wasPressed('ControlLeft') || k.wasPressed('KeyC');
    i.jump ||= k.wasPressed('Space');
    i.roll ||= k.wasPressed('AltLeft') || k.wasPressed('AltRight');
    i.aim = k.isDown('Mouse2');
    i.cover ||= k.wasPressed('KeyE');
    i.interact ||= k.wasPressed('KeyF');
    return i;
  }

  update(dt) {
    if (this._generation !== physics.generation) return; // world was torn down
    const P = CONFIG.player;
    const i = this.locked ? this._idleIntent() : this.readInput();
    this.aiming = i.aim && !this.carrying && this.state !== 'roll' && this.state !== 'vault' && this.state !== 'dead';
    this.sprinting = i.sprint && !this.aiming && !this.crouched && !this.carrying && i.move.y > 0.2;

    // One-frame actions (consumed here; fixed steps act on the flags below)
    if (i.crouch) {
      i.crouch = false;
      if (this.state === 'move') this.setCrouched(!this.crouched);
    }
    if (i.jump) {
      i.jump = false;
      this._jumpBuffer = P.jumpBuffer;
    }
    if (i.roll) {
      i.roll = false;
      this._wantRoll = true;
    }
    if (i.cover) {
      i.cover = false;
      if (this.state === 'cover') this.leaveCover();
      else if (this.state === 'move') this.tryCover();
    }
    this._updateFocus();
    if (i.interact) {
      i.interact = false;
      if (this.focus && this.state !== 'dead') this.interact(this.focus);
    }

    // Cover peeks look past the edge Kael leans out of → camera on that shoulder
    if (this.state === 'cover' && this.aiming && this.cover.high) {
      const edge = this.cover.edge || this.cover.peekSide || 0;
      if (edge) this.rig.side = Math.sign(this.cover.tangent.dot(this.rig.right(tmp)) * edge) || this.rig.side;
    }
    // Camera squeezed against the body (low ceilings, tight corners): hide Kael instead of filling the screen
    this.model.visible = this.rig.distance > CONFIG.cameraRig.hideBodyBelow;

    this._updateFacing(dt);
    this._updateAnimation();
    this._footsteps(dt);
    // health comes back after a few seconds out of danger
    this._sinceHurt += dt;
    if (this.state !== 'dead' && this._sinceHurt > CONFIG.player.regenDelay) this.health = Math.min(this.maxHealth, this.health + CONFIG.player.regenPerSecond * dt);
    this.anims.update(dt);
  }

  /** Footstep sounds on the stride (quieter crouched — stealth). */
  _footsteps(dt) {
    if (!this.grounded || this.state === 'vault' || this.state === 'dead') return;
    const v = this.speed;
    if (v < 0.4) return (this._stride = 0.5);
    const stride = v > CONFIG.player.runSpeed * 0.8 ? 1.5 : 0.85;
    this._stride = (this._stride ?? 0) + (v * dt) / stride;
    if (this._stride >= 1) {
      this._stride -= 1;
      const vol = this.crouched ? 0.12 : this.sprinting ? 0.55 : 0.35;
      audio.sfx('footstep_concrete', { volume: vol, rate: 0.9 + Math.random() * 0.2 });
    }
  }

  _idleIntent() {
    const i = this.intent;
    i.move.set(0, 0);
    i.sprint = i.aim = i.jump = i.roll = i.cover = i.interact = i.crouch = false;
    return i;
  }

  /** Model yaw: face the movement, or the camera while aiming / in cover peeks. */
  _updateFacing(dt) {
    const P = CONFIG.player;
    let target = null;
    if (this.state === 'cover') {
      target = this.aiming ? this.rig.yaw : Math.atan2(-this.cover.normal.x, -this.cover.normal.z);
    } else if ((this.aiming || this.combat) && this.state === 'move') {
      target = this.rig.yaw;
    } else if (this.state === 'move' && this.velocity.lengthSq() > 0.25) {
      target = Math.atan2(this.velocity.x, this.velocity.z);
    }
    if (target !== null) this.yaw += angleDelta(this.yaw, target) * damp(this.aiming ? P.turnRate * 1.6 : P.turnRate, dt);
    this.model.rotation.y = this.yaw;
  }

  _updateAnimation() {
    if (this.cinematic) return; // a cutscene is directing the body
    if (this.state === 'dead' || this.state === 'roll' || this.state === 'vault') return;
    const a = this.anims;
    const v = this.speed;
    a.aimPitch = this.rig.pitch; // upper-body aim follows the camera (hero model)
    a.moveAngle = 0;
    if (this.state === 'cover') {
      if (this.aiming) return a.setLocomotion('coverAim');
      const side = this.velocity.dot(this.rig.right(tmp));
      if (v < 0.2) return a.setLocomotion('coverIdle');
      return a.setLocomotion(side > 0 ? 'coverRight' : 'coverLeft', v);
    }
    if (!this.grounded && this.airTime > 0.18) return a.setLocomotion('air', 0, CONFIG.animation.blendSlow);
    if (this.crouched) return a.setLocomotion(v > 0.3 ? 'crouchWalk' : 'crouchIdle', v);
    if (this.carrying) return a.setLocomotion(v > 0.3 ? 'carryWalk' : 'carryIdle', v);
    if (this.aiming || this.combat) {
      if (v < 0.3) return a.setLocomotion('aimIdle');
      // direction of travel relative to where Kael faces
      const f = this.facing(tmp);
      const fwd = this.velocity.dot(f) / v;
      const side = (this.velocity.x * f.z - this.velocity.z * f.x) / v; // + = left
      a.moveAngle = Math.atan2(side, fwd); // legs turn toward the travel direction (strafe without strafe clips)
      if (Math.abs(fwd) >= Math.abs(side)) return a.setLocomotion(fwd > 0 ? 'aimForward' : 'aimBack', v);
      return a.setLocomotion(side > 0 ? 'aimLeft' : 'aimRight', v);
    }
    const P = CONFIG.player;
    if (v < 0.2) return a.setLocomotion(this.armed ? 'armedIdle' : 'idle');
    if (v < (P.walkSpeed + P.runSpeed) / 2) return a.setLocomotion('walk', v);
    if (v < (P.runSpeed + P.sprintSpeed) / 2) return a.setLocomotion('run', v);
    return a.setLocomotion('sprint', v);
  }

  // ---------------------------------------------------------------------------
  // Fixed step: movement
  // ---------------------------------------------------------------------------
  fixedUpdate(dt) {
    if (timeScale.rewinding || this.state === 'dead') return;
    const P = CONFIG.player;
    this._rollCooldown = Math.max(0, this._rollCooldown - dt);
    this._jumpBuffer = Math.max(0, this._jumpBuffer - dt);

    if (this.state === 'vault') return this._fixedVault(dt);
    if (this.state === 'roll') return this._fixedRoll(dt);
    if (this.state === 'cover') return this._fixedCover(dt);

    // Desired horizontal velocity, camera-relative
    const i = this.intent;
    const wish = new THREE.Vector3();
    if (!this.locked && i.move.lengthSq() > 0) {
      wish.addScaledVector(this.rig.forward(tmp), i.move.y).addScaledVector(this.rig.right(tmp), i.move.x);
      if (wish.lengthSq() > 1) wish.normalize();
    }
    let top = P.runSpeed;
    if (this.crouched) top = P.crouchSpeed;
    else if (this.aiming) top = P.aimSpeed;
    else if (this.sprinting) top = P.sprintSpeed;
    wish.multiplyScalar(top);

    const accel = this.grounded ? (wish.lengthSq() > 0 ? P.accel : P.decel) : P.accel * P.airControl;
    this.velocity.lerp(wish, damp(accel, dt));

    // Roll (Alt) — from the ground, while moving or standing
    if (this._wantRoll) {
      this._wantRoll = false;
      if (this.grounded && this._rollCooldown <= 0) return this._startRoll(wish);
    }

    // Jump / vault
    this._coyote = this.grounded ? P.coyoteTime : Math.max(0, this._coyote - dt);
    if (this._jumpBuffer > 0 && this._coyote > 0) {
      this._jumpBuffer = 0;
      const vault = this._findVault();
      if (vault) return this._startVault(vault);
      if (this.crouched) this.setCrouched(false);
      if (!this.crouched) {
        this.vy = P.jumpSpeed;
        this._coyote = 0;
        this.grounded = false;
        this.anims.oneShot('jump', { duration: 0.45 }).then(() => this.anims.cancelOneShot());
        audio.sfx('footstep_concrete', { volume: 0.5, rate: 0.8 });
      }
    }

    this.vy += P.gravity * dt;
    if (this.grounded && this.vy < 0) this.vy = -1; // keep contact on slopes / steps
    this._move(this.velocity.x * dt, this.vy * dt, this.velocity.z * dt, dt);
  }

  /** Move through the character controller; updates grounded / landing. */
  _move(dx, dy, dz) {
    this.kcc.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz }, physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.kcc.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    if (this.grounded) {
      if (!wasGrounded && this.airTime > 0.35) this._land();
      this.airTime = 0;
      if (this.vy < 0) this.vy = 0;
    } else {
      this.airTime += 1 / CONFIG.loop.physicsHz;
      if (m.y > dy * 0.5 && this.vy > 0 && Math.abs(m.y) < 1e-4) this.vy = 0; // bumped the head
    }
    // Lose the velocity that walls absorbed (no sliding "ghost" speed)
    const hz = Math.hypot(dx, dz);
    if (hz > 1e-5) {
      const kept = Math.min(1, Math.hypot(m.x, m.z) / hz);
      if (kept < 0.98) this.velocity.multiplyScalar(0.4 + 0.6 * kept);
    }
  }

  _land() {
    audio.sfx('footstep_concrete', { volume: 0.8, rate: 0.75 });
    this.rig.shake = Math.max(this.rig.shake, Math.min(0.6, this.airTime * 0.5));
    this.anims.oneShot('land', { duration: 0.3 }).then(() => this.anims.cancelOneShot());
  }

  // ---------------------------------------------------------------------------
  // Crouch
  // ---------------------------------------------------------------------------
  setCrouched(on) {
    if (on === this.crouched) return;
    if (!on && !this._headroom()) return; // something above — stay down
    this.crouched = on;
    this._setColliderHalf(on ? this.crouchHalf : this.standHalf);
  }

  _setColliderHalf(half) {
    const r = CONFIG.player.radius;
    this.collider.setHalfHeight(half);
    this.collider.setTranslationWrtParent({ x: 0, y: half + r, z: 0 });
  }

  /** True if there is room to stand up. */
  _headroom() {
    const P = CONFIG.player;
    const f = this.feet;
    const hit = this._ray({ x: f.x, y: f.y + P.crouchHeight - 0.05, z: f.z }, { x: 0, y: 1, z: 0 }, P.height - P.crouchHeight + 0.1);
    return !hit;
  }

  // ---------------------------------------------------------------------------
  // Roll (Alt)
  // ---------------------------------------------------------------------------
  _startRoll(wish) {
    const P = CONFIG.player.roll;
    const dir = wish.lengthSq() > 0.01 ? wish.clone().normalize() : this.facing(new THREE.Vector3());
    this.state = 'roll';
    this.yaw = Math.atan2(dir.x, dir.z);
    this._roll = { dir, t: 0, wasCrouched: this.crouched };
    this._setColliderHalf(this.crouchHalf);
    this.anims.oneShot('roll', { duration: P.time });
    audio.sfx('footstep_concrete', { volume: 0.7, rate: 0.6 });
  }

  _fixedRoll(dt) {
    const P = CONFIG.player.roll;
    const r = this._roll;
    r.t += dt;
    const k = r.t / P.time;
    const speed = P.speed * (1 - 0.55 * k * k);
    this.velocity.copy(r.dir).multiplyScalar(speed);
    this.vy += CONFIG.player.gravity * dt;
    if (this.grounded && this.vy < 0) this.vy = -1;
    this._move(this.velocity.x * dt, this.vy * dt, this.velocity.z * dt);
    if (r.t >= P.time) {
      this.state = 'move';
      this._rollCooldown = P.cooldown;
      this.anims.cancelOneShot();
      this.velocity.multiplyScalar(0.7);
      // stand up again if there is room (rolling under things keeps you crouched)
      this.crouched = true;
      if (!r.wasCrouched) this.setCrouched(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Vault (Space at a low obstacle)
  // ---------------------------------------------------------------------------
  _findVault() {
    const V = CONFIG.player.vault;
    if (this.crouched) return null;
    const moving = this.velocity.lengthSq() > 0.5;
    const dir = moving ? this.velocity.clone().setY(0).normalize() : this.facing(new THREE.Vector3());
    const f = this.feet.clone();
    const reach = V.reach + CONFIG.player.radius;
    const low = this._ray({ x: f.x, y: f.y + V.minHeight * 0.8, z: f.z }, dir, reach, true);
    if (!low || Math.abs(low.normal.y) > 0.4) return null;
    // the space above the obstacle must be free
    if (this._ray({ x: f.x, y: f.y + V.maxHeight + 0.35, z: f.z }, dir, low.timeOfImpact + 0.9)) return null;
    // top of the obstacle
    const over = f.clone().addScaledVector(dir, low.timeOfImpact + 0.2);
    over.y += V.maxHeight + 0.3;
    const down = this._ray(over, { x: 0, y: -1, z: 0 }, V.maxHeight + 0.3);
    if (!down) return null;
    const top = over.y - down.timeOfImpact;
    const h = top - f.y;
    if (h < V.minHeight || h > V.maxHeight) return null;
    // landing spot: first place past the obstacle where the ground is low again
    for (let d = 0.45; d <= V.maxDepth; d += 0.15) {
      const p = f.clone().addScaledVector(dir, low.timeOfImpact + d);
      p.y = top + 0.25;
      const g = this._ray(p, { x: 0, y: -1, z: 0 }, h + 1.5);
      const groundY = g ? p.y - g.timeOfImpact : f.y - 1;
      if (top - groundY > V.minHeight * 0.8) {
        const land = p.clone().addScaledVector(dir, 0.35 + CONFIG.player.radius);
        land.y = groundY;
        return { dir, from: f, top, land, height: h };
      }
    }
    return null; // a long box: climb isn't in scope, so no vault
  }

  _startVault(v) {
    const V = CONFIG.player.vault;
    this.state = 'vault';
    this.yaw = Math.atan2(v.dir.x, v.dir.z);
    this._vault = { ...v, t: 0, time: V.time * (0.8 + v.height * 0.25) };
    this.anims.oneShot('vault', { duration: this._vault.time });
    audio.sfx('footstep_concrete', { volume: 0.6, rate: 1.2 });
    this.collider.setEnabled(false); // pass over the obstacle cleanly
  }

  _fixedVault(dt) {
    const v = this._vault;
    v.t += dt;
    const k = Math.min(1, v.t / v.time);
    const p = new THREE.Vector3().lerpVectors(v.from, v.land, k);
    // arc: clear the top at the middle of the move
    const peak = v.top + 0.15 - Math.min(v.from.y, v.land.y);
    p.y = THREE.MathUtils.lerp(v.from.y, v.land.y, k) + Math.sin(k * Math.PI) * peak;
    this.body.setNextKinematicTranslation(p);
    this.velocity.copy(v.dir).multiplyScalar(v.from.distanceTo(v.land) / v.time);
    if (k >= 1) {
      this.collider.setEnabled(true);
      this.state = 'move';
      this.vy = 0;
      this.grounded = true;
      this.anims.cancelOneShot();
      this.velocity.multiplyScalar(0.75);
    }
  }

  // ---------------------------------------------------------------------------
  // Cover (E)
  // ---------------------------------------------------------------------------
  tryCover() {
    const C = CONFIG.player.cover;
    const f = this.feet;
    const dir = this.velocity.lengthSq() > 1 ? this.velocity.clone().normalize() : this.rig.forward(new THREE.Vector3());
    const hit = this._ray({ x: f.x, y: f.y + 0.7, z: f.z }, dir, C.reach + CONFIG.player.radius, true);
    if (!hit || Math.abs(hit.normal.y) > 0.3) return false;
    const n = new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize();
    const wall = new THREE.Vector3(f.x, f.y + 0.7, f.z).addScaledVector(dir, hit.timeOfImpact);
    // tall cover hides a standing body; low cover only a crouched one
    const high = !!this._ray({ x: wall.x + n.x * 0.3, y: f.y + 1.55, z: wall.z + n.z * 0.3 }, { x: -n.x, y: 0, z: -n.z }, 0.6);
    this.cover = { normal: n, tangent: new THREE.Vector3().crossVectors(UP, n), high, target: wall.clone().addScaledVector(n, CONFIG.player.radius + 0.06).setY(f.y), edge: 0 };
    this.state = 'cover';
    this.velocity.set(0, 0, 0);
    if (!high) this._setColliderHalf(this.crouchHalf);
    audio.sfx('footstep_concrete', { volume: 0.6, rate: 0.7 });
    return true;
  }

  leaveCover() {
    if (this.state !== 'cover') return;
    this.state = 'move';
    this.cover = null;
    this.crouched = true;
    this.setCrouched(false);
  }

  _fixedCover(dt) {
    const C = CONFIG.player.cover;
    const c = this.cover;
    const i = this.intent;
    const f = this.feet.clone();

    // Slide along the wall with A/D (relative to the camera), stop at its edges
    const camRight = this.rig.right(tmp);
    const along = Math.sign(c.tangent.dot(camRight) || 1) * i.move.x;
    let move = along * C.speed;
    c.edge = 0;
    if (move !== 0) {
      const probe = f.clone().addScaledVector(c.tangent, Math.sign(move) * (CONFIG.player.radius + 0.12));
      const still = this._ray({ x: probe.x, y: f.y + 0.6, z: probe.z }, { x: -c.normal.x, y: 0, z: -c.normal.z }, 0.6);
      if (!still) {
        move = 0;
        c.edge = Math.sign(along);
      }
    }
    // Peek: aiming at an edge steps out; aiming over low cover just stands up
    if (this.aiming && c.high && !c.peekSide) c.peekSide = c.edge || this._edgeSide();
    if (!this.aiming) c.peekSide = 0;
    const peekOut = this.aiming && c.high ? C.peek * c.peekSide : 0;
    const anchor = c.target.clone().addScaledVector(c.tangent, peekOut);

    // Hug the wall: pull toward the anchor line
    const toWall = anchor.clone().sub(f);
    toWall.y = 0;
    const normalPart = toWall.dot(c.normal);
    const tangentPart = peekOut ? toWall.dot(c.tangent) : 0;
    const v = c.tangent.clone().multiplyScalar(move + tangentPart * 10).addScaledVector(c.normal, normalPart * 10);
    if (v.length() > 4) v.setLength(4);
    this.velocity.copy(c.tangent).multiplyScalar(move);
    this._move(v.x * dt, -2 * dt, v.z * dt);
    // keep the anchor moving with the slide
    c.target.addScaledVector(c.tangent, move * dt);

    // low cover: stand to shoot, crouch to hide
    this._setColliderHalf(!c.high && !this.aiming ? this.crouchHalf : this.standHalf);

    // break cover: back away, jump, roll
    if (i.move.y < -0.5 && Math.abs(i.move.x) < 0.5 && c.normal.dot(this.rig.forward(tmp)) < 0) this.leaveCover();
    if (this._wantRoll || this._jumpBuffer > 0) {
      this.leaveCover();
    }
  }

  /** Which edge of a tall wall is closer (for peeking without sliding first). */
  _edgeSide() {
    const f = this.feet;
    const c = this.cover;
    for (let d = 0.3; d < 2.4; d += 0.3) {
      for (const s of [1, -1]) {
        const p = f.clone().addScaledVector(c.tangent, s * d);
        if (!this._ray({ x: p.x, y: f.y + 0.6, z: p.z }, { x: -c.normal.x, y: 0, z: -c.normal.z }, 0.6)) return s;
      }
    }
    return 1;
  }

  // ---------------------------------------------------------------------------
  // Interaction (F)
  // ---------------------------------------------------------------------------
  /** @param {{position: THREE.Vector3, radius?: number, prompt: string, onInteract: Function, enabled?: boolean}} it */
  addInteractable(it) {
    this.interactables.push(it);
    return () => (this.interactables = this.interactables.filter((x) => x !== it));
  }

  _updateFocus() {
    const range = CONFIG.player.interactRange;
    const p = this.root.position;
    const fwd = this.facing(tmp);
    let best = null;
    let bestScore = Infinity;
    for (const it of this.interactables) {
      if (it.enabled === false) continue;
      const d = tmp2.subVectors(it.position, p).setY(0);
      const dist = d.length();
      if (dist > (it.radius ?? range)) continue;
      const facingPenalty = dist > 0.6 ? 1 - d.normalize().dot(fwd) : 0; // prefer what Kael looks at
      const score = dist + facingPenalty * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    this.focus = this.state === 'move' ? best : null;
  }

  async interact(it) {
    const d = tmp.subVectors(it.position, this.root.position);
    this.yaw = Math.atan2(d.x, d.z);
    this.velocity.set(0, 0, 0);
    this.locked = true;
    const anim = this.anims.oneShot('interact', { duration: 0.9 });
    try {
      await it.onInteract(this);
    } finally {
      await Promise.race([anim, new Promise((r) => setTimeout(r, 900))]);
      this.anims.cancelOneShot();
      this.locked = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Damage hooks (weapons / enemies arrive in Phase 6–8)
  // ---------------------------------------------------------------------------
  hitReaction() {
    if (this.state !== 'move' && this.state !== 'cover') return;
    this.anims.oneShot('hit', { blend: 0.1 }).then(() => this.anims.cancelOneShot());
    this.rig.shake = Math.max(this.rig.shake, 0.4);
  }

  /** Take damage (bullets, fire, explosions). */
  hurt(amount) {
    if (this.state === 'dead' || amount <= 0) return;
    this.health -= amount;
    this._sinceHurt = 0;
    const now = performance.now();
    if (amount >= 4 && now - this._lastFlinch > 600) {
      this._lastFlinch = now;
      this.hitReaction();
    }
    if (this.health <= 0) {
      this.health = 0;
      this.die();
      this.onDeath?.();
    }
  }

  die() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.velocity.set(0, 0, 0);
    this.anims.oneShot('death', { hold: true, blend: 0.15 });
  }

  /** Back to life at a spot (checkpoints). */
  respawn(position, yaw = this.yaw) {
    this.state = 'move';
    this.health = this.maxHealth;
    this.anims.busy = null;
    this.cover = null;
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.crouched = false;
    this._setColliderHalf(this.standHalf);
    this.collider.setEnabled(true);
    this.body.setTranslation(position, true);
    this.body.setNextKinematicTranslation(position);
    this.yaw = yaw;
  }

  // ---------------------------------------------------------------------------
  // ⏳ TIME rewind adapter
  // ---------------------------------------------------------------------------
  snapshot() {
    const t = this.body.translation();
    return { p: [t.x, t.y, t.z], yaw: this.yaw, v: this.velocity.toArray(), vy: this.vy, crouched: this.crouched, health: this.health };
  }

  restore(s) {
    if (this.state === 'vault') this.collider.setEnabled(true);
    if (this.state !== 'move') {
      this.state = 'move';
      this.cover = null;
      this.anims.busy = null;
    }
    const p = { x: s.p[0], y: s.p[1], z: s.p[2] };
    this.body.setTranslation(p, true);
    this.body.setNextKinematicTranslation(p);
    this.root.position.set(p.x, p.y, p.z);
    this.yaw = s.yaw;
    this.model.rotation.y = s.yaw;
    this.velocity.fromArray(s.v);
    this.vy = s.vy;
    if (s.health !== undefined) this.health = s.health;
    if (s.crouched !== this.crouched) {
      this.crouched = s.crouched;
      this._setColliderHalf(s.crouched ? this.crouchHalf : this.standHalf);
    }
    // play the locomotion backwards-feeling: walk clip at the recorded speed
    this.anims.setLocomotion(this.velocity.lengthSq() > 0.3 ? 'run' : 'idle', this.speed);
  }

  dispose() {
    this._fixedOff();
    physics.unlink(this.root);
    if (this._generation === physics.generation) {
      physics.world.removeCharacterController(this.kcc);
      physics.world.removeRigidBody(this.body);
    }
    this.root.removeFromParent();
  }
}

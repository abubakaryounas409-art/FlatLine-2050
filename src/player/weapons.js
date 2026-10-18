// =============================================================================
// FLATLINE: 2050 — player/weapons.js
// Kael's guns (CLAUDE.md Phase 6): pistol, rifle, sniper.
//
//   LMB fire (pistol semi · rifle auto · sniper bolt) · RMB aim · tap R reload
//   1 / 2 / 3 or mouse wheel switch · V incendiary rounds (🔥 FIRE)
//   Sniper: scope, breath sway, hold Shift to steady (costs 1 heartbeat),
//   real projectiles with travel time and bullet drop.
//
// Pistol / rifle are hitscan: a ray from the camera through the (spread)
// crosshair finds the target, then a ray from the muzzle to it checks that
// nothing is in the way. Bulbs can be shot out (🌑 SHADOWS, systems/lights.js).
// The gun model is held at the right-hand bone and aimed at the crosshair.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { createModelInstance } from '../assets/loader.js';
import { lights } from '../systems/lights.js';
import { heartbeat } from '../systems/heartbeat.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
// GLTFLoader strips '.' and ':' from node names: 'Wrist.R' → 'WristR', 'mixamorig:RightHand' → 'mixamorigRightHand'
const HAND_BONES = ['hand_r', 'mixamorigRightHand', 'RightHand', 'WristR', 'Wrist_R', 'Hand_R', 'handR', 'HandR'];
// Middle-finger base: the grip sits between the wrist and the knuckles (in the palm), not at the wrist joint
const PALM_BONES = ['middle_01_r', 'mixamorigRightHandMiddle1', 'RightHandMiddle1', 'Middle1R'];
const ORDER = ['pistol', 'rifle', 'sniper'];
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

export class WeaponSystem {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {PlayerController} o.player
   * @param {CameraRig} o.rig
   * @param {Map} o.assets          preloaded assets (weapons.pistol / rifle / sniper)
   * @param {CombatFX} o.fx
   * @param {CombatHUD} o.hud
   * @param {string[]} [o.loadout]  which guns Kael carries
   */
  constructor({ scene, player, rig, assets, fx, hud, loadout = ORDER }) {
    this.scene = scene;
    this.player = player;
    this.rig = rig;
    this.fx = fx;
    this.hud = hud;
    this.hittables = new Map();   // collider handle → { surface, onHit(info) → { killed } }
    this.surfaces = new Map();    // collider handle → surface name (walls, props)
    this.echo = () => null;       // (point) → { delay, volume } inside alleys / tunnels
    this.onIncendiary = null;     // (point, normal, collider) → start a fire (Phase 7)
    this.onShot = null;           // (muzzle) → enemies hear it (Phase 8)
    this.stats = { shots: 0, hits: 0, kills: 0 }; // mission accuracy

    const W = CONFIG.weapons;
    this.guns = loadout.map((id) => {
      const def = W[id];
      const tpl = assets.get(`weapons.${id}`);
      const model = tpl ? createModelInstance(tpl) : new THREE.Group();
      model.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      model.visible = false;
      scene.add(model);
      // muzzle + grip from the model's own size (barrel along +X)
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const len = box.max.x - box.min.x;
      return {
        id,
        def,
        model,
        mag: def.mag,
        reserve: def.reserve,
        muzzle: new THREE.Vector3(box.max.x, box.min.y + (box.max.y - box.min.y) * def.muzzleHeight, 0),
        grip: new THREE.Vector3(box.min.x + len * def.gripAt, box.min.y + (box.max.y - box.min.y) * 0.35, 0),
      };
    });
    this.index = 0;
    this.state = 'ready';       // ready | reloading | switching
    this.stateT = 0;
    this.cooldown = 0;
    this.spread = W[this.gun.id].spread.hip;
    this.incendiaryRounds = W.incendiary.rounds;
    this.incendiaryOn = false;
    this.bullets = [];          // sniper projectiles in flight
    this.combat = 0;            // seconds of "weapon up" after firing
    this.scoped = false;
    this.steady = { active: false, time: 0, paid: false };
    this._swayT = 0;
    this._sway = { yaw: 0, pitch: 0 };
    this._hand = this._findHand(player.model);
    this.pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), ready: false };
    this.offFixed = physics.onFixedUpdate((dt) => this._fixedBullets(dt));
    this._generation = physics.generation;
    this.gun.model.visible = true;
    this._refreshHud();
  }

  get gun() {
    return this.guns[this.index];
  }

  /** Register something bullets can damage (enemies, barrels, dummies). */
  register(collider, target) {
    this.hittables.set(collider.handle, target);
    return () => this.hittables.delete(collider.handle);
  }

  /** Tag a static collider with a surface for impact effects. */
  setSurface(collider, surface) {
    this.surfaces.set(collider.handle, surface);
  }

  _findHand(model) {
    let hand = null;
    for (const name of HAND_BONES) {
      model.traverse((o) => {
        if (!hand && o.isBone && o.name === name) hand = o;
      });
      if (hand) break;
    }
    if (!hand) console.warn('[weapons] no right-hand bone found — guns float at the hip');
    this._palm = null;
    if (hand) for (const name of PALM_BONES) this._palm ??= hand.getObjectByName(name) ?? null;
    return hand;
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  update(dt, realDt) {
    if (this._generation !== physics.generation) return;
    const p = this.player;
    const W = CONFIG.weapons;
    const def = this.gun.def;
    const canAct = !this.disabled && !p.carrying && !p.locked && p.state !== 'dead' && p.state !== 'roll' && p.state !== 'vault' && !timeScale.rewinding;

    // --- switching: 1/2/3, wheel ---------------------------------------------------------
    let want = -1;
    ORDER.forEach((id, i) => {
      if (input.wasPressed(`Digit${i + 1}`)) want = this.guns.findIndex((g) => g.id === id);
    });
    if (input.mouse.wheel) want = (this.index + Math.sign(input.mouse.wheel) + this.guns.length) % this.guns.length;
    if (canAct && want >= 0 && want !== this.index) this._switchTo(want);

    // --- incendiary toggle (V) ------------------------------------------------------------
    if (input.wasPressed('KeyV') && this.incendiaryRounds > 0) {
      this.incendiaryOn = !this.incendiaryOn;
      audio.sfx('ui_click', { volume: 0.5, rate: this.incendiaryOn ? 1.2 : 0.9 });
      this._refreshHud();
    }

    // --- tap R = reload (hold R = rewind, handled by the time system) -----------------------
    // (measured from the key events themselves, so slow frames can't turn a tap into a hold)
    if (input.wasReleased('KeyR') && input.lastHold('KeyR') < CONFIG.time.holdToRewind && canAct) this.reload();

    // --- state timers ----------------------------------------------------------------------
    // a held auto trigger keeps its time debt (cooldown < 0) so slow frames still fire at the full rate
    const held = this.gun.def.mode === 'auto' && input.isDown('Mouse0');
    this.cooldown = held ? Math.max(-0.2, this.cooldown - dt) : Math.max(0, this.cooldown - dt);
    if (this.state !== 'ready') {
      this.stateT -= dt;
      if (this.state === 'reloading') this.hud.reloadProgress(1 - this.stateT / def.reload);
      if (this.stateT <= 0) this._finishState();
    }

    // --- aim + scope ------------------------------------------------------------------------
    const aiming = p.aiming;
    this.scoped = aiming && this.gun.id === 'sniper' && this.state === 'ready' && this.rig.aim > 0.6;
    this.rig.fovOverride = aiming && this.gun.id === 'sniper' ? def.scopeFov : null;
    p.model.visible = p.model.visible && !this.scoped;
    this._updateSway(realDt);

    // --- trigger ------------------------------------------------------------------------------
    const pull = def.mode === 'auto' ? input.isDown('Mouse0') : input.wasPressed('Mouse0');
    if (pull && canAct) {
      if (p.state === 'cover' && !aiming) {
        // in cover, the trigger pops you out to aim first
      } else if (this.state === 'ready' && this.cooldown <= 0) {
        if (this.gun.mag > 0) {
          this._fire();
          // full auto keeps its rate even on slow frames (up to 3 rounds per frame)
          for (let n = 0; def.mode === 'auto' && n < 2 && this.cooldown <= 0 && this.gun.mag > 0; n++) this._fire();
        } else {
          audio.sfx('ui_click', { volume: 0.4, rate: 0.6, minInterval: 200 });
          this.reload();
        }
      }
    }
    if (aiming) this.combat = Math.max(this.combat, 0.25);
    this.combat = Math.max(0, this.combat - dt);
    p.combat = this.combat > 0; // controller: face the crosshair, aim locomotion

    // --- spread recovers toward its base (more while moving) -----------------------------------
    const moveK = Math.min(1, p.speed / CONFIG.player.runSpeed);
    const base = (aiming ? def.spread.aim : def.spread.hip) + def.spread.move * moveK + (p.grounded ? 0 : def.spread.move);
    this.spread += (base - this.spread) * Math.min(1, dt * def.spread.recover);

    this._poseGun(realDt);
    if (this.disabled) this.gun.model.visible = false;
    this.hud.update({ spread: this._spreadPixels(), visible: !this.disabled && (aiming || this.combat > 0), scoped: this.scoped, steadying: this.steady.active, realDt });
  }

  _spreadPixels() {
    const cam = this.rig.camera;
    return Math.tan(this.spread * DEG) * (window.innerHeight / 2) / Math.tan((cam.fov * DEG) / 2) + 4;
  }

  /** Breath sway while scoped; hold Shift to steady (1 beat per hold). */
  _updateSway(realDt) {
    const S = this.gun.def.sway;
    let amount = 0;
    if (this.scoped && S) {
      const holding = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      if (holding && !this.steady.active && !this.steady.used) {
        if (this.steady.paid || heartbeat.spend(CONFIG.heartbeat.cost.steadyAim, 'steady aim')) {
          this.steady = { active: true, time: S.steadySeconds, paid: true, used: false };
          audio.sfx('heartbeat', { volume: 0.6, rate: 0.8 });
          timeScale.set(CONFIG.time.steadySlowMo, 0.15); // ⏳ the world slows while he holds his breath
        } else this.steady.used = true;
      }
      if (this.steady.active) {
        this.steady.time -= realDt;
        if (!holding || this.steady.time <= 0) {
          this.steady.active = false;
          this.steady.used = true;
          timeScale.set(1, 0.2);
        }
      }
      if (!holding) this.steady.used = false;
      if (!holding && !this.steady.active) this.steady.paid = false;
      amount = this.steady.active ? S.amount * 0.08 : S.amount;
    } else if (this.steady.active) {
      this.steady.active = false;
      timeScale.set(1, 0.2);
    }
    this._swayT += realDt * (S?.rate ?? 0.5) * Math.PI * 2;
    const yaw = Math.sin(this._swayT) * amount;
    const pitch = Math.sin(this._swayT * 2.1 + 0.7) * amount * 0.6;
    // additive: apply only the change since last frame, so the player keeps control
    this.rig.yaw += yaw - this._sway.yaw;
    this.rig.pitch += pitch - this._sway.pitch;
    this._sway.yaw = yaw;
    this._sway.pitch = pitch;
  }

  // ---------------------------------------------------------------------------
  // Gun pose: at the right hand, barrel to the crosshair (low-ready otherwise)
  // ---------------------------------------------------------------------------
  _poseGun(realDt) {
    const p = this.player;
    const gun = this.gun;
    const hand = this._hand;
    const handPos = v1;
    if (hand) {
      hand.getWorldPosition(handPos);
      if (this._palm) handPos.lerp(this._palm.getWorldPosition(v2), 0.5);
    } else handPos.copy(p.position).add(v2.set(0, 1.15, 0)).addScaledVector(this.rig.right(), 0.25);

    // where the barrel should point
    const up = this.combat > 0 || p.aiming;
    const dir = v2;
    if (up) dir.copy(this._aimPoint()).sub(handPos).normalize();
    else p.facing(dir).multiplyScalar(Math.cos(0.6)).addScaledVector(UP, -Math.sin(0.6)).normalize();
    // reload / switch: dip the muzzle
    if (this.state !== 'ready') dir.addScaledVector(UP, -0.9).normalize();

    const x = dir;
    const z = new THREE.Vector3().crossVectors(x, UP).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    tmpM.makeBasis(x, y, z);
    tmpQ.setFromRotationMatrix(tmpM);
    const k = this.pose.ready ? 1 - Math.exp(-realDt * 22) : 1;
    this.pose.quat.slerp(tmpQ, k);
    this.pose.ready = true;
    // grip sits in the hand
    const gripOffset = gun.grip.clone().applyQuaternion(this.pose.quat);
    gun.model.quaternion.copy(this.pose.quat);
    gun.model.position.copy(handPos).sub(gripOffset);
    gun.model.visible = p.model.visible && p.state !== 'dead';
  }

  /** World point under the crosshair (first hit along the camera ray, or far away). */
  _aimPoint(spreadDeg = 0) {
    const cam = this.rig.camera;
    const origin = cam.getWorldPosition(new THREE.Vector3());
    const dir = cam.getWorldDirection(new THREE.Vector3());
    if (spreadDeg > 0) {
      // random point in a cone
      const r = Math.sqrt(Math.random()) * Math.tan(spreadDeg * DEG);
      const a = Math.random() * Math.PI * 2;
      const right = new THREE.Vector3().crossVectors(dir, UP).normalize(); // (v1 holds the hand position)
      const up = new THREE.Vector3().crossVectors(right, dir).normalize();
      dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    }
    const range = this.gun.def.range;
    const hit = this._ray(origin, dir, range);
    const point = origin.clone().addScaledVector(dir, hit ? hit.timeOfImpact : range);
    point.userData = { dir, hit };
    return point;
  }

  muzzleWorld(out = new THREE.Vector3()) {
    return out.copy(this.gun.muzzle).applyQuaternion(this.gun.model.quaternion).add(this.gun.model.position);
  }

  _ray(origin, dir, maxToi) {
    const R = physics.RAPIER;
    return physics.world.castRayAndGetNormal(new R.Ray(origin, dir), maxToi, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.player.collider);
  }

  // ---------------------------------------------------------------------------
  // Firing
  // ---------------------------------------------------------------------------
  _fire() {
    const gun = this.gun;
    const def = gun.def;
    const W = CONFIG.weapons;
    gun.mag -= 1;
    this.cooldown = (def.mode === 'auto' ? Math.min(0, this.cooldown) : 0) + 60 / def.rpm;
    this.combat = 1.4;
    const incendiary = this.incendiaryOn && this.incendiaryRounds > 0;
    if (incendiary) {
      this.incendiaryRounds -= 1;
      if (this.incendiaryRounds <= 0) this.incendiaryOn = false;
    }

    // make sure the gun is pointing before the shot leaves it
    this._poseGun(1);
    const muzzle = this.muzzleWorld();
    const target = this._aimPoint(this.steady.active ? def.spread.aim * 0.1 : this.spread);
    const dir = target.clone().sub(muzzle).normalize();

    if (def.projectile) {
      // sniper: a real bullet, from the camera line so the scope is honest
      const cam = this.rig.camera.getWorldPosition(new THREE.Vector3());
      const camDir = target.userData.dir;
      this.bullets.push({ pos: cam.addScaledVector(camDir, 0.5), vel: camDir.clone().multiplyScalar(def.projectile.speed), life: 3, incendiary, drawFrom: muzzle.clone(), def });
    } else {
      const hit = this._ray(muzzle, dir, muzzle.distanceTo(target) + 0.5);
      const end = hit ? muzzle.clone().addScaledVector(dir, hit.timeOfImpact) : target;
      this.fx.tracer(muzzle, end, incendiary ? new THREE.Color(3, 1.2, 0.3) : null);
      if (hit) this._hit(hit, end, dir, def, incendiary);
    }

    this.stats.shots += 1;
    this.onShot?.(muzzle);
    // feel: flash, sound (+ alley echo), casing, recoil, spread
    this.fx.flash(muzzle, dir, def.flashScale);
    audio.sfxAt(def.sound, muzzle, { volume: def.volume, rate: 0.95 + Math.random() * 0.1, refDistance: 6, echo: this.echo(muzzle) });
    const right = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const eject = gun.model.position.clone().addScaledVector(dir, 0.05).addScaledVector(UP, 0.05);
    if (def.mode === 'bolt') setTimeout(() => this.fx.casing(eject, right, UP), 450);
    else this.fx.casing(eject, right, UP);
    const r = def.recoil;
    this.rig.kick.pitch += r.pitch * (0.8 + Math.random() * 0.4) * (this.player.aiming ? 0.7 : 1);
    this.rig.kick.yaw += (Math.random() - 0.5) * 2 * r.yaw;
    this.rig.shake = Math.max(this.rig.shake, def.shake);
    this.spread = Math.min(def.spread.max, this.spread + def.spread.perShot);
    if (def.mode === 'bolt') {
      this.steady.active && timeScale.set(1, 0.2);
      this.steady.active = false;
      setTimeout(() => audio.sfx('reload', { volume: 0.35, rate: 1.6 }), 380);
    }
    this._refreshHud();
    if (gun.mag === 0 && gun.reserve > 0) setTimeout(() => this.state === 'ready' && this.reload(), 250);
  }

  /** Something was hit: lights, targets, physics bodies, surfaces. */
  _hit(hit, point, dir, def, incendiary) {
    const collider = hit.collider;
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    // 🌑 a bulb?
    if (lights.hit(collider)) {
      this.fx.impact(point, normal, 'glass', { decal: false });
      this.hud.hitMarker(false);
      return;
    }
    const target = this.hittables.get(collider.handle);
    let surface = this.surfaces.get(collider.handle) ?? 'concrete';
    if (target) {
      surface = target.surface ?? 'flesh';
      const res = target.onHit?.({ point, normal, dir, damage: def.damage, weapon: this.gun.id, incendiary, collider }) ?? {};
      if (res.counted !== false) {
        this.hud.hitMarker(!!res.killed);
        if (res.headshot) {
          timeScale.hitStop(CONFIG.weapons.headshotHitStop); // 2 frames of freeze sell the hit
          this.rig.shake = Math.max(this.rig.shake, 0.25);
        }
        this.stats.hits += 1;
        if (res.killed) this.stats.kills += 1;
      }
    }
    // push loose objects
    const body = collider.parent();
    if (body && body.isDynamic()) body.applyImpulseAtPoint(dir.clone().multiplyScalar(def.impulse), point, true);
    this.fx.impact(point, normal, surface, { decal: !target, incendiary });
    audio.sfxAt('bullet_impact', point, { volume: 0.35, rate: 0.9 + Math.random() * 0.3, refDistance: 3, minInterval: 40 });
    if (incendiary) this.onIncendiary?.(point, normal, collider, target);
  }

  /** Sniper bullets: fly, drop, hit (fixed step, time-scaled → slow-mo shows the bullet). */
  _fixedBullets(dt) {
    if (!this.bullets.length || timeScale.rewinding) return;
    for (const b of this.bullets) {
      const g = b.def.projectile.gravity;
      const from = b.pos.clone();
      b.vel.y += g * dt;
      const step = b.vel.clone().multiplyScalar(dt);
      const len = step.length();
      const dir = step.clone().normalize();
      const hit = this._ray(from, dir, len);
      b.life -= dt;
      if (hit) {
        const point = from.clone().addScaledVector(dir, hit.timeOfImpact);
        this.fx.tracer(b.drawFrom, point, b.incendiary ? new THREE.Color(3, 1.2, 0.3) : new THREE.Color(2.4, 2.4, 3));
        this._hit(hit, point, dir, b.def, b.incendiary);
        b.life = 0;
      } else {
        b.pos.add(step);
        this.fx.tracer(b.drawFrom, b.pos.clone(), b.incendiary ? new THREE.Color(3, 1.2, 0.3) : new THREE.Color(2.4, 2.4, 3));
        b.drawFrom = from;
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  // ---------------------------------------------------------------------------
  // Reload / switch
  // ---------------------------------------------------------------------------
  reload() {
    const gun = this.gun;
    if (this.state !== 'ready' || gun.mag >= gun.def.mag || gun.reserve <= 0) return false;
    this.state = 'reloading';
    this.stateT = gun.def.reload;
    audio.sfx('reload', { volume: 0.7 });
    return true;
  }

  _switchTo(i) {
    this.state = 'switching';
    this.stateT = CONFIG.weapons.switchTime;
    this.hud.reloadProgress(0);
    this._next = i;
    audio.sfx('reload', { volume: 0.3, rate: 1.8 });
  }

  _finishState() {
    if (this.state === 'reloading') {
      const gun = this.gun;
      const need = gun.def.mag - gun.mag;
      const take = Math.min(need, gun.reserve);
      gun.mag += take;
      gun.reserve -= take;
      this.hud.reloadProgress(1);
    } else if (this.state === 'switching') {
      this.gun.model.visible = false;
      this.index = this._next;
      this.pose.ready = false;
      this.spread = this.gun.def.spread.hip;
    }
    this.state = 'ready';
    this._refreshHud();
  }

  _refreshHud() {
    const g = this.gun;
    this.hud.setWeapon({ name: g.def.name, mag: g.mag, reserve: g.reserve, incendiary: this.incendiaryRounds, incendiaryOn: this.incendiaryOn });
  }

  addAmmo(id, n) {
    const g = this.guns.find((x) => x.id === id);
    if (g) g.reserve += n;
    this._refreshHud();
  }

  dispose() {
    this.offFixed();
    if (this.steady.active) timeScale.set(1, 0.01);
    this.rig.fovOverride = null;
    this.guns.forEach((g) => g.model.removeFromParent());
  }
}

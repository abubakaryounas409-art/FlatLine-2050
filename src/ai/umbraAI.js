// =============================================================================
// FLATLINE: 2050 — ai/umbraAI.js
// UMBRA — Kael's shadow double, his guilt (CLAUDE.md Phase 8.2, Mission 5).
//
//   • Kael's own model in a void shader: black, violet rim, white eyes,
//     smoke trailing from him.
//   • 🌑 Only vulnerable in LIGHT: bullets that hit him in a dark spot
//     dissolve into smoke. Shoot out the wrong lamp and you can't hurt him.
//   • Mirrors Kael: strafes the opposite way, keeps his distance.
//   • Uses Kael's powers: Shadow Step (re-forms in darkness near Kael) and
//     ⏳ Rewind (twice, at 2/3 and 1/3 health: he takes back the damage).
//   • Whispers.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { lights } from '../systems/lights.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { addDissolve } from '../vfx/dissolveShader.js';

const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

const WHISPERS = [
  'You ran from the fire.',
  'Look at your hands, Kael.',
  'Every beat is borrowed.',
  'He called your name. You kept running.',
  'You can\'t shoot what you are.',
];

/** Black body, violet fresnel rim — works on any skinned mesh. */
function voidMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0, emissive: 0x000000 });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.5);
       gl_FragColor.rgb = gl_FragColor.rgb * 0.15 + vec3(0.45, 0.25, 1.0) * rim * 1.6;`,
    );
  };
  m.customProgramCacheKey = () => 'umbra-void';
  return m;
}

export class Umbra {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {Map} o.assets
   * @param {PlayerController} o.player
   * @param {WeaponSystem} o.weapons
   * @param {CombatFX} o.fx
   * @param {CameraRig} o.rig
   * @param {number[]} o.position
   * @param {THREE.Vector3[]} [o.arena]   points he may Shadow Step to (dark ones are used)
   */
  constructor({ scene, assets, player, weapons, fx, rig, position, arena = [] }) {
    const R = physics.RAPIER;
    const U = CONFIG.umbra;
    this.player = player;
    this.weapons = weapons;
    this.fx = fx;
    this.rig = rig;
    this.scene = scene;
    this.arena = arena;
    this.maxHealth = U.health;
    this.health = U.health;
    this.dead = false;
    this.position = new THREE.Vector3(...position);
    this.yaw = 0;
    this.state = 'fight';      // fight | stepping | rewinding | dying
    this.shotT = 2;
    this.stepT = rand(U.stepEvery[0], U.stepEvery[1]);
    this.whisperT = 4;
    this.rewindsLeft = [U.health * (2 / 3), U.health * (1 / 3)];
    this.history = [];         // his own rewind buffer
    this.onDeath = null;

    const tpl = assets.get('characters.umbra') ?? assets.get('characters.kael_2020');
    this.model = createModelInstance(tpl);
    const mat = voidMaterial();
    // glowing white eyes: the model's own eye meshes when it has them (hero model), else two spheres on the head
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6) });
    let hasEyes = false;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      const eyes = /^(MI_Eyes|Eye)$/.test(o.material?.name ?? '');
      o.material = eyes ? eyeMat : mat;
      hasEyes ||= eyes;
    });
    this.mat = mat;
    const head = this.model.getObjectByName('Head');
    if (head && !hasEyes) {
      [-0.035, 0.035].forEach((x) => {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), eyeMat);
        head.add(e);
        e.position.set(x / 0.01, 0.075 / 0.01, 0.1 / 0.01); // bone space is centimetres on the stand-in
        e.scale.setScalar(100);
      });
    }
    scene.add(this.model);
    this.actor = new Actor('umbra', this.model, tpl.animations);
    this.actor.play('idle_gun_pointing', 0.01);
    this.dissolve = addDissolve(this.model, { color: 0x9a6aff });
    this.light = new THREE.PointLight(0x8a4dff, 2.5, 5, 2);
    scene.add(this.light);

    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.position.x, this.position.y, this.position.z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(0.55, 0.32).setTranslation(0, 0.88, 0), this.body);
    this.kcc = physics.world.createCharacterController(0.02);
    this.kcc.enableSnapToGround(0.4);
    this.offHit = weapons.register(this.collider, {
      surface: 'flesh',
      onHit: (hit) => this._onHit(hit),
    });
    this._generation = physics.generation;
  }

  /** Hittable? Lamps light him, and so does a stage spotlight on him (spotlit, set by the level). */
  get inLight() {
    return !!this.spotlit || lights.darkness(this.position) < CONFIG.umbra.lightThreshold;
  }

  _onHit(hit) {
    if (this.dead || this.state !== 'fight') return { counted: false };
    if (!this.inLight) {
      // 🌑 the bullet passes through smoke
      for (let i = 0; i < 8; i++) this.fx.puffs.emit(hit.point, new THREE.Vector3().randomDirection().multiplyScalar(0.8), [0.12, 0.05, 0.22], 0.25, 0.8, 0.2, 3);
      audio.sfxAt('shadow_step', hit.point, { volume: 0.25, rate: 1.8, minInterval: 200 });
      if (Math.random() < 0.3) subtitles.show('umbra', 'Not in the dark.', 1.6);
      return { counted: false };
    }
    this.health -= hit.damage * (hit.point.y - this.position.y > 1.45 ? 2 : 1);
    this.actor.gesture('hit', 'idle_gun_pointing', 0.1);
    game.postfx.glitch(0.12, 0.3);
    // ⏳ rewind thresholds
    if (this.rewindsLeft.length && this.health <= this.rewindsLeft[0]) {
      this.rewindsLeft.shift();
      this._rewind();
      return { killed: false };
    }
    if (this.health <= 0) {
      this._die();
      return { killed: true };
    }
    // getting hurt in the light → flee into shadow
    if (Math.random() < 0.35) this.stepT = Math.min(this.stepT, 0.4);
    return { killed: false };
  }

  _whisper() {
    const line = WHISPERS[Math.floor(Math.random() * WHISPERS.length)];
    subtitles.show('umbra', line, 2.8);
    audio.sfxAt('reverse_whoosh', this.position, { volume: 0.3, rate: 0.6 });
  }

  /** A dark spot near Kael (but not on top of him). */
  _darkSpot() {
    const p = this.player.position;
    const cands = [...this.arena];
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(6, 11);
      cands.push(new THREE.Vector3(p.x + Math.sin(a) * r, p.y, p.z + Math.cos(a) * r));
    }
    const R = physics.RAPIER;
    const ok = cands.filter((c) => {
      const d = c.distanceTo(p);
      if (d < 4 || d > 14 || !lights.isDark(c)) return false;
      // must be floor with headroom
      const down = physics.world.castRay(new R.Ray({ x: c.x, y: c.y + 2, z: c.z }, { x: 0, y: -1, z: 0 }), 3, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider);
      if (!down || down.timeOfImpact < 1.6) return false;
      c.y = c.y + 2 - down.timeOfImpact;
      return true;
    });
    return ok[Math.floor(Math.random() * ok.length)] ?? null;
  }

  async _shadowStep() {
    const to = this._darkSpot();
    this.stepT = rand(CONFIG.umbra.stepEvery[0], CONFIG.umbra.stepEvery[1]);
    if (!to) return;
    this.state = 'stepping';
    const st = { v: 0 };
    audio.sfxAt('shadow_step', this.position, { volume: 0.8 });
    this._smoke(this.position, 22);
    await gsap.to(st, { v: 1, duration: 0.35, onUpdate: () => this.dissolve.set(st.v, this.position.y) });
    if (this.dead) return;
    this._teleport(to);
    this._smoke(to, 22);
    await gsap.to(st, { v: 0, duration: 0.45, onUpdate: () => this.dissolve.set(st.v, this.position.y) });
    if (!this.dead) this.state = 'fight';
  }

  async _rewind() {
    // ⏳ he takes back the last few seconds: position and the damage
    this.state = 'rewinding';
    subtitles.show('umbra', 'Again.', 1.8);
    game.postfx.setMood('TIME', 0.2);
    audio.sfxAt('reverse_whoosh', this.position, { volume: 0.9 });
    const target = this.history[0];
    const from = this.position.clone();
    const st = { k: 0 };
    await gsap.to(st, {
      k: 1, duration: 1.2, ease: 'power1.inOut',
      onUpdate: () => {
        if (target) this._teleport(from.clone().lerp(target.p, st.k));
      },
    });
    this.health = Math.min(this.maxHealth, this.health + CONFIG.umbra.rewindHeal);
    game.postfx.setMood('SHADOWS', 0.4);
    if (!this.dead) this.state = 'fight';
  }

  async _die() {
    this.dead = true;
    this.state = 'dying';
    this.collider.setEnabled(false);
    subtitles.show('umbra', 'You ran from the fire. You\'ll always run.', 4);
    this.actor.play('death', 0.2, { loop: false, clamp: true });
    const st = { v: 0 };
    await gsap.to(st, { v: 1, duration: 2.6, ease: 'power1.in', onUpdate: () => this.dissolve.set(st.v, this.position.y) });
    this._smoke(this.position, 40);
    this.model.visible = false;
    this.light.intensity = 0;
    this.onDeath?.();
  }

  _smoke(at, n) {
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rand(-0.8, 0.8), rand(0.4, 1.6), rand(-0.8, 0.8));
      this.fx.puffs.emit(at.clone().add(new THREE.Vector3(0, rand(0, 1.7), 0)), v, [0.05, 0.02, 0.09], rand(0.3, 0.6), rand(0.8, 1.5), 0.3, 3);
    }
  }

  _teleport(p) {
    this.position.copy(p);
    this.body.setTranslation(p, true);
    this.body.setNextKinematicTranslation(p);
  }

  _shoot() {
    const U = CONFIG.umbra;
    const p = this.player;
    const hand = this.model.getObjectByName('hand_r') ?? this.model.getObjectByName('WristR');
    const muzzle = hand ? hand.getWorldPosition(new THREE.Vector3()) : this.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    const target = p.position.clone().add(new THREE.Vector3(0, 1.2, 0));
    const hit = Math.random() < U.accuracy * (p.state === 'cover' && !p.aiming ? 0.2 : 1) * (p.speed > 3 ? 0.6 : 1);
    if (!hit) target.add(new THREE.Vector3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)));
    const dir = target.clone().sub(muzzle).normalize();
    const R = physics.RAPIER;
    const ray = physics.world.castRay(new R.Ray(muzzle, dir), 60, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider);
    const end = ray ? muzzle.clone().addScaledVector(dir, ray.timeOfImpact) : muzzle.clone().addScaledVector(dir, 40);
    this.fx.flash(muzzle, dir, 0.8);
    this.fx.tracer(muzzle, end, new THREE.Color(1.6, 0.8, 3));
    audio.sfxAt('pistol_shot', muzzle, { volume: 0.7, rate: 0.8, echo: { delay: 0.14, volume: 0.4 } });
    if (ray && ray.collider.handle === p.collider.handle) p.hurt(rand(U.damage[0], U.damage[1]));
    this.actor.gesture('idle_gun_shoot', 'idle_gun_pointing', 0.08);
  }

  update(dt) {
    if (this._generation !== physics.generation) return;
    this.actor.update(dt);
    this.light.position.copy(this.position).add(new THREE.Vector3(0, 1.4, 0));
    this.model.position.copy(this.position);
    this.model.rotation.y = this.yaw;
    if (this.dead) return;
    // smoke trailing off him
    if (Math.random() < dt * 14) this.fx.puffs.emit(this.position.clone().add(new THREE.Vector3(rand(-0.25, 0.25), rand(0.2, 1.7), rand(-0.25, 0.25))), new THREE.Vector3(0, 0.5, 0), [0.04, 0.02, 0.07], 0.25, 1.2, 0.2, 3);
    // own rewind buffer (3 s)
    this.history.push({ p: this.position.clone(), t: performance.now() });
    while (this.history.length && performance.now() - this.history[0].t > 3000) this.history.shift();
    this.mat.emissive.setScalar(0);
    this.light.intensity = this.inLight ? 4 : 1.5; // he glows brighter when he's hittable

    const p = this.player;
    this.yaw += angleDelta(this.yaw, Math.atan2(p.position.x - this.position.x, p.position.z - this.position.z)) * Math.min(1, dt * 6);
    if (this.state !== 'fight' || p.state === 'dead') return;

    this.whisperT -= dt;
    if (this.whisperT <= 0) {
      this._whisper();
      this.whisperT = rand(9, 15);
    }
    this.stepT -= dt;
    if (this.stepT <= 0) {
      this._shadowStep();
      return;
    }
    this.shotT -= dt;
    if (this.shotT <= 0) {
      this.shotT = rand(CONFIG.umbra.fireEvery[0], CONFIG.umbra.fireEvery[1]);
      this._shoot();
    }
  }

  /** Fixed step: mirror Kael's strafing, keep the distance. */
  fixedUpdate(dt) {
    if (this.dead || this.state !== 'fight') return;
    const U = CONFIG.umbra;
    const p = this.player;
    const toMe = this.position.clone().sub(p.position).setY(0);
    const dist = toMe.length();
    toMe.normalize();
    const side = new THREE.Vector3().crossVectors(UP, toMe);
    const mirrored = -p.velocity.dot(side); // he moves the opposite way, like a reflection
    const want = side.multiplyScalar(mirrored * 0.9);
    if (dist < U.keepDistance[0]) want.addScaledVector(toMe, 3);
    else if (dist > U.keepDistance[1]) want.addScaledVector(toMe, -3);
    this.kcc.computeColliderMovement(this.collider, { x: want.x * dt, y: -0.2 * dt, z: want.z * dt });
    const m = this.kcc.computedMovement();
    this._teleport(this.position.clone().add(new THREE.Vector3(m.x, m.y, m.z)));
    const v = want.length();
    const clip = v > 0.6 ? (want.dot(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw))) > 0 ? 'run_right' : 'run_left') : 'idle_gun_pointing';
    if (this.actor.currentName !== clip && this.actor.currentName !== 'hit' && this.actor.currentName !== 'idle_gun_shoot') this.actor.play(clip, 0.2, { timeScale: 0.6 });
  }

  dispose() {
    this.offHit();
    this.dissolve.dispose();
    this.model.removeFromParent();
    this.light.removeFromParent();
    if (this._generation === physics.generation) {
      physics.world.removeCharacterController(this.kcc);
      physics.world.removeRigidBody(this.body);
    }
  }
}

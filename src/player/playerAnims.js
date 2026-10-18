// =============================================================================
// FLATLINE: 2050 — player/playerAnims.js
// Kael's animation state machine (CLAUDE.md Phase 5.3 / 5.4).
//
//   anims.setLocomotion('run', speed)   looping states, crossfaded (rule A7.5)
//   await anims.oneShot('roll')         roll / vault / hit / interact / death
//   anims.aimPitch / anims.moveAngle    set by the controller every frame
//
// Every logical state lists candidate clips, best first. The first clip the
// model actually has wins, so Kael's hero model (Quaternius UAL clips: idle,
// walk, run, sprint, pistol_aim…), the old Quaternius stand-in (idle/walk/
// run/roll…) and a full Mixamo set (crouch_walk, strafe_left, cover_idle…)
// all just work.
//
// Layers on top of the clip (only when the model has the clips / bones):
//  · AIM: legs keep walking (lower-body copy of the clip) while the upper body
//    holds the pistol aim, blended up/down with the camera pitch.
//  · TWIST: models without strafe clips strafe by turning the legs toward the
//    move direction and counter-twisting the spine, so the chest and gun stay
//    on the crosshair; backwards = the walk clip played in reverse.
// Locomotion clips are time-scaled to the real ground speed so feet don't
// slide (5.4). The clip's own ground speed is measured from its foot motion.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Actor } from '../cutscenes/actor.js';

// state → [[clip, timeScale, opts], …]   timeScale = base rate before speed matching (negative = reversed)
//   opts.aim   upper body from the aim layer (the clip only drives the legs)
//   opts.twist legs turn toward the move direction, the spine counter-twists
const AIM = { aim: true, twist: true };
const LOOPS = {
  idle:        [['idle'], ['idle_neutral']],
  armedIdle:   [['pistol_idle'], ['idle_gun'], ['idle']],
  walk:        [['walk']],
  run:         [['run'], ['jog']],
  sprint:      [['sprint'], ['run', 1.22]],
  crouchIdle:  [['crouch_idle'], ['idle_gun'], ['idle']],
  crouchWalk:  [['crouch_walk'], ['walk', 0.85]],
  carryIdle:   [['carry_idle'], ['carry', 0], ['idle']],
  carryWalk:   [['carry'], ['walk']],
  aimIdle:     [['rifle_idle'], ['idle', 1, { aim: true }], ['pistol_idle'], ['idle_gun_pointing'], ['idle_gun']],
  aimForward:  [['rifle_aim_walk'], ['pistol_walk'], ['walk', 1, AIM]],
  aimBack:     [['walk_back'], ['walk', -1, AIM], ['run_back', 0.75]],
  aimLeft:     [['strafe_left'], ['run_left', 0.75], ['walk', 1, AIM]],
  aimRight:    [['strafe_right'], ['run_right', 0.75], ['walk', 1, AIM]],
  air:         [['jump_air'], ['falling'], ['jump', 0.4], ['run', 0.25]],
  coverIdle:   [['cover_idle'], ['crouch_idle'], ['idle_gun']],
  coverLeft:   [['cover_left'], ['crouch_walk', 1, { twist: true }], ['run_left', 0.6]],
  coverRight:  [['cover_right'], ['crouch_walk', 1, { twist: true }], ['run_right', 0.6]],
  coverAim:    [['rifle_idle'], ['idle', 1, { aim: true }], ['idle_gun_pointing'], ['idle_gun']],
  dead:        [['death']],
};

const ONE_SHOTS = {
  roll:     [['roll'], ['dodge']],
  vault:    [['vault'], ['vault_start'], ['running_jump'], ['roll', 1.25]],
  jump:     [['jump'], ['running_jump']],
  land:     [['land_short'], ['land']],
  hit:      [['hit'], ['hit_2']],
  interact: [['interact'], ['pointing'], ['wave']],
  shoot:    [['rifle_fire'], ['pistol_shoot'], ['idle_gun_shoot'], ['gun_shoot']],
  death:    [['death']],
};

// Locomotion states that are speed-matched → fallback natural speed (m/s) from CONFIG if the clip can't be measured
const SPEED_MATCHED = { walk: 'walk', run: 'run', sprint: 'run', crouchWalk: 'walk', carryWalk: 'walk', aimForward: 'walk', aimBack: 'walk', aimLeft: 'walk', aimRight: 'walk', coverLeft: 'walk', coverRight: 'walk' };
const AIM_STATES = new Set(['aimIdle', 'aimForward', 'aimBack', 'aimLeft', 'aimRight', 'coverAim']);

// Bones (UE / Quaternius hero names first, then the stand-in and Mixamo)
const BONES = {
  pelvis: ['pelvis', 'Hips', 'mixamorigHips'],
  spine: [['spine_01', 'Abdomen', 'mixamorigSpine'], ['spine_02', 'Torso', 'mixamorigSpine1'], ['spine_03', 'Chest', 'mixamorigSpine2']],
  feet: [['ball_l', 'foot_l', 'FootL', 'mixamorigLeftToeBase', 'mixamorigLeftFoot'], ['ball_r', 'foot_r', 'FootR', 'mixamorigRightToeBase', 'mixamorigRightFoot']],
};
const UPPER = /^(spine_0\d|clavicle_|upperarm_|lowerarm_|hand_|thumb_|index_|middle_|ring_|pinky_|neck_|head)/i;
const DEG = Math.PI / 180;
const MAX_TWIST = 70 * DEG;         // legs turn at most this far from the chest
const SPINE_SHARE = [0.5, 0.3, 0.2]; // how the counter-twist spreads up the spine

// Derived clips are cached per source clip, so every mission reuses them
const derivedCache = new WeakMap(); // clip → { lower, upper }
const speedCache = new WeakMap();   // clip → measured ground speed (m/s) or 0

const UP = new THREE.Vector3(0, 1, 0);
const qA = new THREE.Quaternion();
const qB = new THREE.Quaternion();
const vA = new THREE.Vector3();
const damp = (k, dt) => 1 - Math.exp(-k * dt);

/** Copy of a clip that only keeps the tracks whose bone passes `keep`. */
function filterClip(clip, name, keep) {
  return new THREE.AnimationClip(name, clip.duration, clip.tracks.filter((t) => keep(t.name.split('.')[0])));
}

function findBone(root, names) {
  for (const n of names) {
    const o = root.getObjectByName(n);
    if (o) return o;
  }
  return null;
}

export class PlayerAnims {
  /**
   * @param {THREE.Object3D} object  the character root
   * @param {THREE.AnimationClip[]} clips
   */
  constructor(object, clips) {
    this.object = object;
    this.actor = new Actor('kael', object, clips);
    this.state = null;
    this.busy = null;         // running one-shot: { name, promise }
    this._resolved = new Map();
    this.aimPitch = 0;        // camera pitch (rad, + = up), set by the controller
    this.moveAngle = 0;       // travel direction relative to facing (rad, + = left), set by the controller
    this._own = null;         // the action this state machine started (a cutscene may take over)
    this._opts = {};

    // bones for the procedural layers
    this.bones = {
      pelvis: findBone(object, BONES.pelvis),
      spine: BONES.spine.map((n) => findBone(object, n)),
      feet: BONES.feet.map((n) => findBone(object, n)),
    };
    this._twist = 0;
    this._aimW = 0;
    this._aimActions = null;
    if (this.actor.mixer) this._deriveClips(clips);
  }

  get hasAnimations() {
    return !!this.actor.mixer;
  }

  // ---------------------------------------------------------------------------
  // Clip preparation
  // ---------------------------------------------------------------------------
  _deriveClips(clips) {
    const extra = [];
    const byName = (n) => clips.find((c) => c.name === n);
    // lower-body copies of every clip the aim layer can stand on; upper-body copies of the aim poses
    for (const c of clips) {
      let d = derivedCache.get(c);
      if (!d) {
        d = {
          lower: filterClip(c, `${c.name}__lower`, (b) => !UPPER.test(b)),
          upper: filterClip(c, `${c.name}__upper`, (b) => UPPER.test(b)),
        };
        derivedCache.set(c, d);
      }
      extra.push(d.lower, d.upper);
    }
    // a short landing: just the impact + recovery of the long jump-land clip
    const land = byName('land');
    if (land && land.duration > 0.8 && !byName('land_short')) {
      let short = derivedCache.get(land)?.short;
      if (!short) {
        short = land.clone();
        short.name = 'land_short';
        short.tracks.forEach((t) => t.trim(0, 0.55));
        short.resetDuration();
        derivedCache.get(land).short = short;
      }
      extra.push(short);
    }
    this.actor.clips = [...clips, ...extra]; // own array: the template's list is shared
    this.hasAimLayer = !!byName('pistol_aim') && !!this.bones.spine[0];
  }

  /**
   * Ground speed (m/s) at which a locomotion clip's feet don't slide, measured from
   * how fast the planted foot moves backwards. Falls back to CONFIG.player.clipSpeeds.
   */
  _naturalSpeed(clipName, fallbackKey) {
    const fallback = CONFIG.player.clipSpeeds[fallbackKey];
    const clip = THREE.AnimationClip.findByName(this.actor.clips, clipName);
    const [fl, fr] = this.bones.feet;
    if (!clip || !fl || !fr) return fallback;
    if (speedCache.has(clip)) return speedCache.get(clip) || fallback;
    let speed = 0;
    try {
      const mixer = new THREE.AnimationMixer(this.object);
      mixer.clipAction(clip).play();
      const N = 48, dt = clip.duration / N;
      const inv = new THREE.Matrix4();
      const samples = [[], []];
      for (let i = 0; i <= N; i++) {
        mixer.setTime(i * dt);
        this.object.updateMatrixWorld(true);
        inv.copy(this.object.matrixWorld).invert();
        [fl, fr].forEach((f, k) => samples[k].push(f.getWorldPosition(vA).applyMatrix4(inv).clone()));
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(this.object);
      // planted = within 3 cm of the foot's lowest point; speed = how fast it slides back
      const rates = [];
      for (const s of samples) {
        const minY = Math.min(...s.map((p) => p.y));
        for (let i = 0; i < N; i++) {
          if (s[i].y < minY + 0.03 && s[i + 1].y < minY + 0.03) rates.push((s[i].z - s[i + 1].z) / dt);
        }
      }
      rates.sort((a, b) => a - b);
      const median = rates.length > 4 ? rates[rates.length >> 1] : 0;
      speed = median > 0.3 && median < 12 ? median : 0;
    } catch (err) {
      speed = 0;
    }
    speedCache.set(clip, speed);
    return speed || fallback;
  }

  /** First available [clip, timeScale, opts] for a state, or null. */
  _resolve(table, state) {
    const key = `${table === LOOPS ? 'L' : 'O'}:${state}`;
    if (this._resolved.has(key)) return this._resolved.get(key);
    let pick = (table[state] ?? []).find(([clip, , o]) => this.actor.hasClip(clip) && (!o?.aim || this.hasAimLayer) && (!o?.twist || this.bones.pelvis)) ?? null;
    if (pick && pick[2]?.aim) pick = [`${pick[0]}__lower`, pick[1] ?? 1, pick[2], pick[0]];
    this._resolved.set(key, pick);
    return pick;
  }

  /** True if the model has a real clip for this state (not just a fallback). */
  hasExact(state) {
    const pick = this._resolve(LOOPS[state] ? LOOPS : ONE_SHOTS, state);
    return !!pick && pick[0] === (LOOPS[state] ?? ONE_SHOTS[state])[0][0];
  }

  /**
   * Looping state. `speed` (m/s) drives the clip rate for walk/run states.
   * Ignored while a one-shot is playing.
   */
  setLocomotion(state, speed = 0, blend = CONFIG.animation.blendDefault) {
    if (this.busy) return;
    // strafing by twist: forward or reversed walk depending on the real travel direction
    if ((state === 'aimLeft' || state === 'aimRight') && !this.hasExact(state)) {
      const pick = this._resolve(LOOPS, state);
      if (pick?.[2]?.twist) state = Math.abs(this.moveAngle) <= 100 * DEG ? 'aimForward' : 'aimBack';
    }
    const pick = this._resolve(LOOPS, state) ?? this._resolve(LOOPS, 'idle');
    if (!pick) return;
    const [clip, base = 1, opts = {}, source = clip] = pick;
    let rate = base;
    const matched = SPEED_MATCHED[state];
    if (matched) {
      const natural = this._naturalSpeed(source, matched);
      // walk-type clips may go a bit faster (quick tactical steps) before the feet start to slide
      const maxRate = matched === 'walk' ? 2 : 1.7;
      rate = Math.sign(base || 1) * Math.abs(base) * Math.min(maxRate, Math.max(0.55, speed / (natural * Math.abs(base))));
    }
    if (this.state !== state || this.actor.currentName !== clip) {
      this.actor.play(clip, blend, { timeScale: rate });
      this.state = state;
      this._own = this.actor.current;
      this._opts = opts;
    } else if (this.actor.current) {
      // smooth rate changes so speed-ups never pop
      this.actor.current.timeScale += (rate - this.actor.current.timeScale) * 0.2;
    }
  }

  /**
   * Play a one-shot over locomotion. Resolves when it ends (or right away if
   * the model has no such clip). `duration` stretches the clip to fit a move
   * (e.g. a 0.6 s roll), so the body and the animation stay in sync.
   */
  oneShot(name, { duration = 0, blend = CONFIG.animation.blendFast, hold = false } = {}) {
    const pick = this._resolve(ONE_SHOTS, name);
    if (!pick) return Promise.resolve(false);
    const [clip, base = 1] = pick;
    const action = this.actor.action(clip);
    const rate = duration > 0 ? action.getClip().duration / duration : base;
    this.actor.play(clip, blend, { loop: false, timeScale: rate, clamp: hold });
    this.state = null;
    this._own = action;
    this._opts = {};
    const mixer = this.actor.mixer;
    const promise = new Promise((resolve) => {
      const onDone = (e) => {
        if (e.action !== action) return;
        mixer.removeEventListener('finished', onDone);
        if (this.busy?.action === action) this.busy = null;
        resolve(true);
      };
      mixer.addEventListener('finished', onDone);
    });
    this.busy = hold ? { name, action, promise, held: true } : { name, action, promise };
    return promise;
  }

  /** Cut a one-shot short (e.g. landing out of a vault) — the next state crossfades in. */
  cancelOneShot() {
    if (this.busy?.held) return;
    this.busy = null;
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  update(dt) {
    const mixer = this.actor.mixer;
    if (!mixer) return;
    // a cutscene that plays clips directly switches the procedural layers off
    const mine = this.actor.current === this._own;
    const opts = mine ? this._opts : {};
    if (this.hasAimLayer) this._updateAimLayer(dt, mine && !!opts.aim && AIM_STATES.has(this.state));
    mixer.update(dt);
    this._updateTwist(dt, mine && !!opts.twist);
  }

  /** Upper-body aim pose: neutral / up / down weighted by the camera pitch. */
  _updateAimLayer(dt, on) {
    if (!this._aimActions) {
      const make = (n) => {
        const a = this.actor.action(`${n}__upper`);
        if (!a) return null;
        a.setLoop(THREE.LoopRepeat, Infinity);
        a.enabled = true;
        a.setEffectiveWeight(0);
        a.play();
        return a;
      };
      this._aimActions = { mid: make('pistol_aim'), up: make('pistol_aim_up'), down: make('pistol_aim_down') };
    }
    this._aimW += ((on ? 1 : 0) - this._aimW) * damp(on ? 14 : 10, dt);
    if (this._aimW < 0.002) this._aimW = 0;
    // the up/down poses are ~80° off neutral; the camera pitch maps onto them
    const p = THREE.MathUtils.clamp(this.aimPitch / (80 * DEG), -1, 1);
    const { mid, up, down } = this._aimActions;
    const wUp = up ? Math.max(0, p) : 0;
    const wDown = down ? Math.max(0, -p) : 0;
    mid?.setEffectiveWeight(this._aimW * (1 - wUp - wDown));
    up?.setEffectiveWeight(this._aimW * wUp);
    down?.setEffectiveWeight(this._aimW * wDown);
  }

  /** Legs toward the travel direction, spine back toward the crosshair (after the mixer). */
  _updateTwist(dt, on) {
    const { pelvis, spine } = this.bones;
    if (!pelvis) return;
    let target = 0;
    if (on) {
      let a = this.moveAngle;
      if (this.actor.current?.timeScale < 0) a = Math.atan2(Math.sin(a - Math.PI), Math.cos(a - Math.PI)); // walking backwards
      if (this.state === 'coverLeft' || this.state === 'coverRight') a = this.state === 'coverLeft' ? Math.PI / 2 : -Math.PI / 2;
      target = THREE.MathUtils.clamp(a, -MAX_TWIST, MAX_TWIST);
    }
    this._twist += (target - this._twist) * damp(10, dt);
    if (Math.abs(this._twist) < 1e-3) return;
    // rotate about the world up axis, expressed in each bone's parent space
    const twistBone = (bone, angle) => {
      bone.parent.getWorldQuaternion(qA).invert();
      vA.copy(UP).applyQuaternion(qA);
      bone.quaternion.premultiply(qB.setFromAxisAngle(vA, angle));
      bone.updateMatrixWorld(true);
    };
    twistBone(pelvis, this._twist);
    spine.forEach((b, i) => b && twistBone(b, -this._twist * SPINE_SHARE[i]));
  }
}

// =============================================================================
// FLATLINE: 2050 — runner/runnerHero.js
// Kael in THE RUN: three lanes, jump, roll, fast-fall, lane-change lean,
// squash & stretch, hand light-trails and a carbon suit whose seams glow in
// the colour of the theme he is using (🔥 orange, 🌑 purple, ⏳ blue).
//
//   const hero = new RunnerHero(assets.get('characters.kael_runner'), scene)
//   hero.update(dt, intent)    intent = { left, right, jump, roll } (this frame)
//   hero.snapshot() / restore(s)   used by the ⏳ crash rewind
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { NeonTrail } from '../vfx/neonTrail.js';

const R = () => CONFIG.runner;

export const THEME_COLORS = {
  none: new THREE.Color(0x9fd8ff),
  time: new THREE.Color(0x3fa9ff),
  shadow: new THREE.Color(0x9a5cff),
  fire: new THREE.Color(0xff6a1a),
};

/** Add a fresnel rim light to a standard material (the hero pops off dark backgrounds). */
function addRim(material, rim) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rim;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += uRim * fres;
        }`,
      );
  };
  material.customProgramCacheKey = () => 'runner-rim';
}

export class RunnerHero {
  constructor(template, scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'kael-runner';
    this.body = new THREE.Group(); // squash / lean happen here, gameplay position on root
    this.root.add(this.body);
    this.model = createModelInstance(template);
    this.body.add(this.model);
    scene.add(this.root);

    // --- look: dark carbon suit + glowing seams -------------------------------------------
    this.rim = { value: new THREE.Color(0x3fa9ff).multiplyScalar(0.55) };
    this.seamColor = new THREE.Color(0x9fd8ff);
    this.suit = new THREE.MeshStandardMaterial({ color: 0x15171d, metalness: 0.55, roughness: 0.32 });
    this.seams = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: this.seamColor.clone(), emissiveIntensity: 2.4, metalness: 0.2, roughness: 0.4 });
    addRim(this.suit, this.rim);
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      o.frustumCulled = false; // skinned bounds lag behind the animation at speed
      const name = [].concat(o.material)[0]?.name ?? '';
      o.material = /joint/i.test(name) ? this.seams : this.suit;
    });

    // --- animation ------------------------------------------------------------------------
    const clips = this.model.userData.animations ?? [];
    this.actor = new Actor('kael', this.model, clips);
    this.hasAnims = clips.length > 0;
    this.actor.play('sprint_loop', 0.01);

    // Hand bones carry the light trails (fall back to the body if the rig differs)
    const bone = (n) => this.model.getObjectByName(n);
    this.handL = bone('DEF-handL') ?? bone('DEF-hand.L') ?? this.body;
    this.handR = bone('DEF-handR') ?? bone('DEF-hand.R') ?? this.body;
    this.trails = [this.handL, this.handR].map((h) => {
      const t = new NeonTrail(h, { color: 0x9fd8ff, width: 0.035, points: 12, spacing: 0.55, intensity: 2.2 });
      scene.add(t.mesh);
      return t;
    });

    // --- state ----------------------------------------------------------------------------
    this.reset(0);
  }

  reset(z = 0, lane = 1) {
    this.lane = lane;
    this.x = R().lanes[lane];
    this.y = 0;
    this.z = z;
    this.vy = 0;
    this.grounded = true;
    this.rolling = 0;          // seconds of roll left
    this.queuedRoll = false;   // roll pressed in the air → roll on landing
    this.jumpBuffer = 0;
    this.squash = 0;           // -1 stretched … +1 squashed
    this.lean = 0;
    this.speed = 0;
    this.mode = 'run';         // 'run' | 'walk' | 'idle' | 'hit' | 'dead' | 'cine'
    this.prevX = this.x;
    this.events = [];          // 'jump' | 'land' | 'lane' | 'roll' this frame (read by the world)
    this.trails.forEach((t) => t.reset());
    this._anim('sprint_loop', 0.01);
  }

  /** Colour of the glowing seams / trails / rim (theme in use). */
  setTheme(key, strength = 1) {
    const c = THEME_COLORS[key] ?? THEME_COLORS.none;
    this.seams.emissive.copy(c);
    this.seams.emissiveIntensity = 2.2 + strength * 2.4;
    this.rim.value.copy(c).multiplyScalar(0.45 + strength * 0.5);
    this.trails.forEach((t) => t.material.uniforms.uColor.value.copy(c).multiplyScalar(1.6 + strength * 2));
  }

  get height() {
    return this.rolling > 0 ? R().hitbox.rollHeight : R().hitbox.height;
  }

  /** Hitbox (world): x ± halfWidth, y … y + height, z ± halfDepth. */
  hitbox(out = {}) {
    const hb = R().hitbox;
    out.x0 = this.x - hb.halfWidth;
    out.x1 = this.x + hb.halfWidth;
    out.y0 = this.y;
    out.y1 = this.y + this.height;
    out.z0 = this.z - hb.halfDepth;
    out.z1 = this.z + hb.halfDepth;
    return out;
  }

  _anim(name, blend = 0.12, opts) {
    if (!this.hasAnims) return null;
    this.actor.play(name, blend, opts);
    return this.actor.action(name);
  }

  /** Bounce back from a side-scrape (the lane you tried to enter was blocked). */
  bounceBack(toLane) {
    this.lane = toLane;
  }

  /**
   * @param {number} dt
   * @param {{left:boolean,right:boolean,jump:boolean,roll:boolean}} intent  presses this frame
   */
  update(dt, intent) {
    const cfg = R();
    this.events.length = 0;
    this.prevX = this.x;
    const playable = this.mode === 'run';

    if (playable) {
      // lanes
      if (intent.left && this.lane > 0) {
        this.lane -= 1;
        this.events.push('lane');
      }
      if (intent.right && this.lane < cfg.lanes.length - 1) {
        this.lane += 1;
        this.events.push('lane');
      }
      // jump (buffered so an early press still counts on landing)
      if (intent.jump) this.jumpBuffer = 0.16;
      if (this.jumpBuffer > 0 && this.grounded) {
        this.jumpBuffer = 0;
        this.vy = cfg.jumpVelocity;
        this.grounded = false;
        this.rolling = 0;
        this.squash = -0.6;
        this.events.push('jump');
        const a = this._anim('jump_start', 0.06, { loop: false, timeScale: 2.2 });
        if (a) a.time = 0.5; // skip the wind-up: Kael launches the moment you press
      }
      this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
      // roll — in the air it slams Kael down first (fast-fall), then rolls
      if (intent.roll) {
        if (this.grounded) this._startRoll();
        else {
          this.vy = Math.min(this.vy, cfg.fastFall * 0.35);
          this.queuedRoll = true;
        }
      }
    }

    // lateral spring towards the lane (≈ laneSwitchTime to settle)
    const tx = cfg.lanes[this.lane];
    const k = 1 - Math.exp(-dt * (4.6 / cfg.laneSwitchTime));
    this.x += (tx - this.x) * k;

    // vertical
    if (!this.grounded) {
      const fast = this.queuedRoll ? cfg.fastFall : 0;
      this.vy += (cfg.gravity + fast) * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.grounded = true;
        this.squash = 0.55;
        this.events.push('land');
        if (this.queuedRoll && playable) this._startRoll();
        else if (playable) this._anim('sprint_loop', 0.14);
        this.queuedRoll = false;
      } else if (this.vy < 2 && this.actor.currentName === 'jump_start') {
        this._anim('jump_loop', 0.2);
      }
    }

    // roll timer
    if (this.rolling > 0) {
      this.rolling -= dt;
      if (this.rolling <= 0 && this.grounded && playable) this._anim('sprint_loop', 0.16);
    }

    // forward
    this.z += this.speed * dt;

    // --- juice -----------------------------------------------------------------------------
    const vx = (this.x - this.prevX) / Math.max(dt, 1e-4);
    this.lean += (THREE.MathUtils.clamp(-vx * 0.03, -0.32, 0.32) - this.lean) * Math.min(1, dt * 14);
    this.squash += (0 - this.squash) * Math.min(1, dt * 9);
    const s = this.squash;
    this.body.scale.set(1 + s * 0.12, 1 - s * 0.16, 1 + s * 0.12);
    this.body.rotation.z = this.lean;
    this.body.rotation.y = -this.lean * 0.6;
    this.root.position.set(this.x, this.y, this.z);

    // sprint cadence follows speed; the walk in the finale keeps its own pace
    if (this.hasAnims && this.actor.currentName === 'sprint_loop') this.actor.current.timeScale = THREE.MathUtils.clamp(this.speed / 17, 0.8, 1.55);
    if (this.hasAnims && this.actor.currentName === 'roll') this.actor.current.timeScale = 1.47 / cfg.rollTime;
    this.actor.update(dt);
  }

  _startRoll() {
    this.rolling = R().rollTime;
    this.squash = 0.3;
    this.events.push('roll');
    this._anim('roll', 0.08, { loop: false });
  }

  /** Update the hand trails (after the camera moved). */
  updateTrails(camera, strength) {
    this.root.updateMatrixWorld(true); // this frame's hand positions, not last frame's
    this.trails.forEach((t) => {
      t.setOpacity(strength);
      t.update(camera);
    });
  }

  // --- story / fail states ---------------------------------------------------------------------
  hit() {
    this.mode = 'hit';
    this.rolling = 0;
    this._anim('hit_chest', 0.06, { loop: false });
  }

  die() {
    this.mode = 'dead';
    this._anim('death01', 0.15, { loop: false });
  }

  run() {
    this.mode = 'run';
    this._anim(this.grounded ? 'sprint_loop' : 'jump_loop', 0.2);
  }

  walk() {
    this.mode = 'walk';
    this.rolling = 0;
    this._anim('walk_loop', 0.5);
  }

  idle() {
    this.mode = 'idle';
    this._anim('idle_loop', 0.4);
  }

  // --- ⏳ rewind ------------------------------------------------------------------------------------
  snapshot() {
    return { x: this.x, y: this.y, z: this.z, vy: this.vy, lane: this.lane, grounded: this.grounded, rolling: this.rolling };
  }

  restore(s) {
    this.x = s.x;
    this.y = s.y;
    this.z = s.z;
    this.vy = s.vy;
    this.lane = s.lane;
    this.grounded = s.grounded;
    this.rolling = s.rolling;
    this.root.position.set(this.x, this.y, this.z);
  }

  dispose() {
    this.trails.forEach((t) => {
      t.mesh.removeFromParent();
      t.dispose?.();
    });
    this.root.removeFromParent();
    this.suit.dispose();
    this.seams.dispose();
  }
}

// =============================================================================
// FLATLINE: 2050 — ai/enemyAI.js
// Hale's enforcers (CLAUDE.md Phase 8.1).
//
//   patrol → suspicious ("?") → combat ("!": take cover, peek, burst-fire,
//   reload, flank, throw grenades) → search → patrol
//
// 🌑 They cannot see Kael inside shadow zones (only point-blank). They hear
// gunshots and explosions. Fairness rules: a reaction delay before the first
// shot, at most CONFIG.ai.maxShooters firing at once, accuracy that drops with
// distance, movement, cover and darkness, and a ground warning ring on every
// grenade. ⏳ Enemies rewind with the world (dead ones get back up).
//
// Levels give the director cover points: { position, low } — spots behind
// walls / crates. No navmesh: arenas are open, and blocked walkers sidestep.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { lights } from '../systems/lights.js';
import { timeRewind } from '../systems/timeRewind.js';
import { explode } from '../systems/explosions.js';

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
// clip → fallbacks for models without a full gun set
const CLIP_FALLBACKS = { idle_gun_pointing: ['idle_gun', 'idle'], idle_gun: ['idle'], run_shoot: ['run', 'walk'], run_back: ['walk', 'run'], run_left: ['run', 'walk'], run_right: ['run', 'walk'], run: ['walk'], walk: ['run'] };
const rand = (a, b) => a + Math.random() * (b - a);

/** "?" / "!" icon sprites. */
function iconTexture(ch, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '700 54px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(ch, 32, 34);
  ctx.fillStyle = color;
  ctx.fillText(ch, 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class AIDirector {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {Map} o.assets
   * @param {CombatFX} o.fx
   * @param {PlayerController} o.player
   * @param {WeaponSystem} o.weapons
   * @param {CameraRig} o.rig
   * @param {{position: THREE.Vector3, low?: boolean}[]} [o.cover]
   * @param {(p: THREE.Vector3) => object|null} [o.echo]
   */
  constructor({ scene, assets, fx, player, weapons, rig, cover = [], echo = () => null }) {
    this.scene = scene;
    this.assets = assets;
    this.fx = fx;
    this.player = player;
    this.weapons = weapons;
    this.rig = rig;
    this.echo = echo;
    this.cover = cover.map((c) => ({ position: c.position.clone(), low: !!c.low, owner: null }));
    this.enemies = [];
    this.grenades = [];
    this.shooters = new Set();
    this.grenadeCooldown = 4;
    this.icons = { '?': iconTexture('?', '#ffd23a'), '!': iconTexture('!', '#ff3040') };
    this.onKill = null; // (enemy) => void — e.g. ammo, objectives
    this.offFixed = physics.onFixedUpdate((dt) => this._fixed(dt));
    this.offRewind = timeRewind.register(this);
    this._generation = physics.generation;
    // a gunshot from Kael is heard by everyone nearby
    this._prevOnShot = weapons.onShot;
    weapons.onShot = (muzzle) => {
      this._prevOnShot?.(muzzle);
      this.noise(muzzle, CONFIG.ai.hearGunshot);
    };
  }

  spawn({ position, yaw = 0, patrol = [], model = 'characters.enemy', health = CONFIG.ai.health, armor = 0 }) {
    const e = new Enemy(this, { position: new THREE.Vector3(...position), yaw, patrol: patrol.map((p) => new THREE.Vector3(...p)), model, health, armor });
    this.enemies.push(e);
    return e;
  }

  get alive() {
    return this.enemies.filter((e) => !e.dead);
  }

  /** A sound at `pos` that carries `radius` metres (gunshot, explosion, sprint steps). */
  noise(pos, radius) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.position.distanceTo(pos) < radius) e.hear(pos);
    }
  }

  /** One enemy spotted Kael — the squad nearby joins in after a beat. */
  alertNearby(from, pos) {
    for (const e of this.enemies) {
      if (e === from || e.dead || e.state === 'combat') continue;
      if (e.position.distanceTo(from.position) < CONFIG.ai.shareAlertRadius) setTimeout(() => !e.dead && e.alert(pos), rand(400, 900));
    }
  }

  requestFire(e) {
    if (this.shooters.has(e)) return true;
    if (this.shooters.size >= CONFIG.ai.maxShooters) return false;
    this.shooters.add(e);
    return true;
  }

  releaseFire(e) {
    this.shooters.delete(e);
  }

  /** Best free cover point for an enemy against the player's position. */
  findCover(e, { flank = false } = {}) {
    const A = CONFIG.ai;
    const pp = this.player.position;
    let best = null;
    let bestScore = Infinity;
    for (const c of this.cover) {
      if (c.owner && c.owner !== e && !c.owner.dead) continue;
      const dToPlayer = c.position.distanceTo(pp);
      if (dToPlayer < A.coverMinDist || dToPlayer > A.coverMaxDist) continue;
      if (!this.protects(c)) continue;
      const dSelf = c.position.distanceTo(e.position);
      let score = dSelf;
      if (flank) {
        // prefer spots that change the angle on Kael
        const a0 = Math.atan2(e.position.x - pp.x, e.position.z - pp.z);
        const a1 = Math.atan2(c.position.x - pp.x, c.position.z - pp.z);
        score -= Math.abs(angleDelta(a0, a1)) * 6;
      }
      if (score < bestScore) {
        best = c;
        bestScore = score;
      }
    }
    return best;
  }

  /** Does this cover block Kael's view of a crouched / standing body? */
  protects(c) {
    const eye = v1.copy(this.player.position).add(v2.set(0, 1.5, 0));
    const h = c.low ? 0.7 : 1.3;
    const to = new THREE.Vector3(c.position.x, c.position.y + h, c.position.z);
    const dir = to.clone().sub(eye);
    const len = dir.length();
    const R = physics.RAPIER;
    const hit = physics.world.castRay(new R.Ray(eye, dir.normalize()), len - 0.4, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.player.collider);
    return !!hit;
  }

  throwGrenade(e, target) {
    const from = e.position.clone().add(new THREE.Vector3(0, 1.7, 0));
    const T = 1.1; // flight time
    const vel = target.clone().sub(from).divideScalar(T);
    vel.y = (target.y - from.y) / T - 0.5 * CONFIG.physics.gravity * T;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2a3a22, roughness: 0.6 }));
    mesh.position.copy(from);
    const ring = new THREE.Mesh(new THREE.RingGeometry(CONFIG.ai.grenade.radius - 0.15, CONFIG.ai.grenade.radius, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.3, 0.3), transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.scene.add(mesh, ring);
    this.grenades.push({ mesh, ring, vel, fuse: CONFIG.ai.grenade.fuse, landed: false });
    audio.sfxAt('whoosh', from, { volume: 0.4, rate: 1.6 });
  }

  _fixed(dt) {
    if (this._generation !== physics.generation || timeScale.rewinding) return;
    for (const e of this.enemies) e.fixedUpdate(dt);
    // grenades: ballistic arc, bounce, roll, fuse
    const R = physics.RAPIER;
    for (const g of this.grenades) {
      g.fuse -= dt;
      const p = g.mesh.position;
      if (!g.landed) {
        g.vel.y += CONFIG.physics.gravity * dt;
        const step = g.vel.clone().multiplyScalar(dt);
        const len = step.length();
        const hit = physics.world.castRayAndGetNormal(new R.Ray(p, step.clone().normalize()), len, true, R.QueryFilterFlags.EXCLUDE_SENSORS);
        if (hit) {
          p.addScaledVector(step.normalize(), Math.max(0, hit.timeOfImpact - 0.07));
          const n = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
          g.vel.reflect(n).multiplyScalar(0.35);
          if (n.y > 0.6 && g.vel.length() < 1.2) g.landed = true;
          audio.sfxAt('shell_casing', p, { volume: 0.6, rate: 0.5 });
        } else p.add(step);
      }
      g.ring.position.set(p.x, p.y - 0.05, p.z);
      g.ring.material.opacity = 0.35 + 0.35 * Math.sin(g.fuse * 18);
      if (g.fuse <= 0) {
        g.mesh.removeFromParent();
        g.ring.removeFromParent();
        const victims = [{ position: this.player.position, hurt: (n) => this.player.hurt(n) }, ...this.enemies.filter((x) => !x.dead).map((x) => ({ position: x.position, hurt: (n) => x.damage(n, { explosive: true }) }))];
        explode(p.clone(), { radius: CONFIG.ai.grenade.radius, damage: CONFIG.ai.grenade.damage, fx: this.fx, rig: this.rig, scene: this.scene, victims, echo: this.echo(p) });
        this.noise(p, 40);
      }
    }
    this.grenades = this.grenades.filter((g) => g.fuse > 0);
  }

  update(dt) {
    if (this._generation !== physics.generation) return;
    this.grenadeCooldown = Math.max(0, this.grenadeCooldown - dt);
    for (const e of this.enemies) e.update(dt);
  }

  // ⏳ rewind adapter: the whole squad
  snapshot() {
    return this.enemies.map((e) => e.snapshot());
  }

  restore(s) {
    s.forEach((st, i) => this.enemies[i]?.restore(st));
  }

  dispose() {
    this.offFixed();
    this.offRewind();
    this.weapons.onShot = this._prevOnShot;
    this.enemies.forEach((e) => e.dispose());
    this.grenades.forEach((g) => {
      g.mesh.removeFromParent();
      g.ring.removeFromParent();
    });
    Object.values(this.icons).forEach((t) => t.dispose());
  }
}

class Enemy {
  constructor(director, { position, yaw, patrol, model, health, armor = 0 }) {
    const R = physics.RAPIER;
    const A = CONFIG.ai;
    this.d = director;
    this.maxHealth = health;
    this.health = health;
    this.armor = armor;        // 0..1 of bullet damage stopped (🔥 fire and blasts go through)
    this.dead = false;
    this.state = 'patrol';
    this.patrol = patrol.length ? patrol : [position.clone()];
    this.patrolIndex = 0;
    this.waitT = rand(0.5, 2);
    this.suspicion = 0;
    this.knownPos = position.clone();
    this.lastSeen = 99;
    this.seen = false;
    this.reaction = 0;
    this.cover = null;
    this.coverT = 0;       // time in the current cover phase
    this.phase = 'move';   // combat: move | hide | peek
    this.burst = 0;
    this.shotT = 0;
    this.mag = A.mag;
    this.flankT = rand(6, 10);
    this.searchT = 0;
    this.lookT = 0;
    this.velocity = new THREE.Vector3();
    this.goal = null;
    this.speed = 0;
    this.stuckT = 0;
    this.sidestep = null;
    this.yaw = yaw;
    this.sink = 0;         // ducking behind low cover (the stand-in has no crouch clip)

    // body
    this.root = new THREE.Group();
    const tpl = director.assets.get(model);
    this.model = createModelInstance(tpl);
    this.root.add(this.model);
    director.scene.add(this.root);
    this.actor = new Actor('enemy', this.model, tpl.animations);
    this.actor.play(this._clip('idle_gun'), 0.01);
    this.hand = null;
    this.model.traverse((o) => {
      if (!this.hand && o.isBone && /^(WristR|mixamorigRightHand|RightHand)$/.test(o.name)) this.hand = o;
    });
    const gunTpl = director.assets.get('weapons.rifle');
    this.gun = gunTpl ? createModelInstance(gunTpl) : new THREE.Group();
    director.scene.add(this.gun);
    this.icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: director.icons['?'], depthTest: false, transparent: true }));
    this.icon.scale.setScalar(0.45);
    this.icon.renderOrder = 10;
    this.icon.visible = false;
    director.scene.add(this.icon);

    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x, position.y, position.z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(0.55, 0.3).setTranslation(0, 0.85, 0), this.body);
    this.kcc = physics.world.createCharacterController(0.02);
    this.kcc.enableAutostep(0.35, 0.2, false);
    this.kcc.enableSnapToGround(0.4);
    this.kcc.setMaxSlopeClimbAngle(0.8);
    this.position = position.clone();
    this.root.position.copy(position);
    this.offHit = director.weapons.register(this.collider, {
      surface: 'flesh',
      onHit: (hit) => {
        const head = hit.point.y - this.position.y > 1.45;
        const killed = this.damage(hit.damage * (head ? 2.5 : 1), { incendiary: hit.incendiary });
        return { killed, headshot: head };
      },
    });
    this.burn = 0;
  }

  // ---------------------------------------------------------------------------
  // Senses
  // ---------------------------------------------------------------------------
  hear(pos) {
    if (this.dead) return;
    this.knownPos.copy(pos);
    if (this.state === 'patrol') {
      this.state = 'suspicious';
      this.suspicion = Math.max(this.suspicion, 0.6);
      this.lookT = 0;
    } else if (this.state === 'search') this.searchT = 0;
  }

  alert(pos) {
    if (this.dead) return;
    this.everAlerted = true; // (Mission 2 "Ghost" achievement)
    if (this.state !== 'combat') {
      this.state = 'combat';
      this.reaction = CONFIG.ai.reactionTime * rand(0.8, 1.3);
      this.phase = 'move';
      this.cover = null;
      this.flashIcon('!');
      audio.sfxAt('radio_static', this.position, { volume: 0.25, rate: 1.4, minInterval: 600 });
    }
    this.suspicion = 1;
    if (pos) this.knownPos.copy(pos);
  }

  flashIcon(ch) {
    this.icon.material.map = this.d.icons[ch];
    this.icon.material.needsUpdate = true;
    this.icon.visible = true;
    this.iconT = ch === '!' ? 1.6 : 0;
  }

  /** Can this enemy see Kael right now? */
  _look() {
    const A = CONFIG.ai;
    const p = this.d.player;
    if (p.state === 'dead') return false;
    const eye = v1.copy(this.position).add(v2.set(0, 1.62 - this.sink, 0));
    const target = p.position.clone().add(new THREE.Vector3(0, p.crouched ? 0.8 : 1.3, 0));
    const toP = target.clone().sub(eye);
    const dist = toP.length();
    // 🌑 shadows: only point-blank
    const dark = lights.isDark(p.position);
    const range = dark ? A.darkSightRange : A.sightRange;
    if (dist > range) return false;
    if (this.state !== 'combat') {
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const flat = toP.clone().setY(0).normalize();
      if (fwd.dot(flat) < Math.cos((A.fov / 2) * (Math.PI / 180))) return false;
    }
    const R = physics.RAPIER;
    const hit = physics.world.castRay(new R.Ray(eye, toP.normalize()), dist + 0.5, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider);
    return !!hit && hit.collider.handle === p.collider.handle;
  }

  // ---------------------------------------------------------------------------
  // Per frame: senses, decisions, animation, gun pose
  // ---------------------------------------------------------------------------
  update(dt) {
    if (this.dead) {
      this.actor.update(dt);
      if (this.topple > 0 && this.topple < 1) {
        this.topple = Math.min(1, this.topple + dt * 2.2);
        this.model.rotation.x = (-this.topple * this.topple * Math.PI) / 2;
      }
      return;
    }
    const A = CONFIG.ai;
    const p = this.d.player;
    this._senseT = (this._senseT ?? 0) - dt;
    if (this._senseT <= 0) {
      this._senseT = 0.1;
      this.seen = this._look();
    }
    const dist = this.position.distanceTo(p.position);
    if (this.seen) {
      this.lastSeen = 0;
      this.knownPos.copy(p.position);
      if (this.state !== 'combat') {
        const close = 1 - Math.min(1, dist / A.sightRange);
        const rate = (0.4 + close * 2.6) * (p.crouched ? 0.55 : 1) * (p.sprinting ? 1.5 : 1);
        this.suspicion += dt * rate;
        if (this.state === 'patrol' && this.suspicion > 0.2) {
          this.state = 'suspicious';
          this.lookT = 0;
        }
        if (this.suspicion >= 1) {
          this.alert(p.position);
          this.d.alertNearby(this, p.position);
        }
      }
    } else {
      this.lastSeen += dt;
      if (this.state === 'suspicious') this.suspicion = Math.max(0, this.suspicion - dt * 0.12);
    }
    // sprinting footsteps are heard close by
    if (p.sprinting && dist < A.hearFootsteps && this.state === 'patrol') this.hear(p.position);

    switch (this.state) {
      case 'patrol': this._patrol(dt); break;
      case 'suspicious': this._suspicious(dt); break;
      case 'combat': this._combat(dt, dist); break;
      case 'search': this._search(dt); break;
    }

    // burning (🔥 incendiary rounds)
    if (this.burn > 0) {
      this.burn -= dt;
      if (Math.random() < dt * 25) this.d.fx.impact(this.position.clone().add(new THREE.Vector3(rand(-0.2, 0.2), rand(0.4, 1.6), rand(-0.2, 0.2))), UP, 'metal', { decal: false, incendiary: true });
      this.damage(CONFIG.weapons.incendiary.burnDamagePerSecond * dt, { tick: true });
    }

    // icon
    if (this.state === 'suspicious' || this.state === 'search') {
      if (this.icon.material.map !== this.d.icons['?'] || !this.icon.visible) this.flashIcon('?');
    } else if (this.state === 'patrol') this.icon.visible = false;
    if (this.iconT > 0) {
      this.iconT -= dt;
      if (this.iconT <= 0) this.icon.visible = false;
    }
    this.icon.position.copy(this.position).add(v2.set(0, 2.25 - this.sink, 0));

    // body yaw + sink
    this.root.position.copy(this.position);
    this.root.position.y -= this.sink;
    this.model.rotation.y = this.yaw;
    this._animate();
    this.actor.update(dt);
    this._poseGun();
  }

  _patrol(dt) {
    const target = this.patrol[this.patrolIndex];
    if (this.patrol.length < 2 || this.position.distanceTo(target) < 0.4) {
      this.goal = null;
      this.waitT -= dt;
      if (this.waitT <= 0) {
        this.patrolIndex = (this.patrolIndex + 1) % this.patrol.length;
        this.waitT = rand(1.5, 3.5);
      }
    } else {
      this.goal = target;
      this.speed = CONFIG.ai.walkSpeed;
    }
  }

  _suspicious(dt) {
    this.lookT += dt;
    this._face(this.knownPos, dt, 3);
    // stare first, then walk over to check
    if (this.lookT > 1.4) {
      this.goal = this.position.distanceTo(this.knownPos) > 1.5 ? this.knownPos : null;
      this.speed = CONFIG.ai.walkSpeed;
    } else this.goal = null;
    if (this.suspicion <= 0) {
      this.state = 'patrol';
      this.goal = null;
    }
  }

  _search(dt) {
    this.searchT += dt;
    this.goal = this.position.distanceTo(this.knownPos) > 1.2 && this.searchT < 6 ? this.knownPos : null;
    this.speed = CONFIG.ai.walkSpeed * 1.4;
    if (!this.goal) this.yaw += dt * 1.4 * Math.sin(this.searchT * 0.9); // look around
    if (this.searchT > CONFIG.ai.searchTime) {
      this.state = 'patrol';
      this.suspicion = 0;
    }
  }

  _combat(dt, dist) {
    const A = CONFIG.ai;
    const p = this.d.player;
    this.reaction = Math.max(0, this.reaction - dt);
    this.flankT -= dt;
    if (this.lastSeen > A.loseTime) {
      this.state = 'search';
      this.searchT = 0;
      this._leaveCover();
      this.d.releaseFire(this);
      return;
    }
    // need (new) cover?
    const coverBad = this.cover && !this.d.protects(this.cover);
    if (!this.cover || coverBad || (this.flankT <= 0 && this.phase === 'hide')) {
      const flank = this.flankT <= 0;
      if (flank) this.flankT = rand(9, 14);
      const c = this.d.findCover(this, { flank });
      if (c && c !== this.cover) {
        this._leaveCover();
        this.cover = c;
        c.owner = this;
        this.phase = 'move';
      }
    }
    // grenade when Kael hides for a while
    if (this.lastSeen > A.grenade.afterHidden && this.d.grenadeCooldown <= 0 && dist > 6 && dist < 22 && this.phase !== 'move') {
      this.d.grenadeCooldown = A.grenade.cooldown;
      this._face(this.knownPos, 1, 100);
      this.actor.gesture('interact', 'idle_gun', 0.15);
      setTimeout(() => !this.dead && this.d.throwGrenade(this, this.knownPos.clone()), 350);
    }

    if (this.cover && this.phase === 'move') {
      this.goal = this.cover.position;
      this.speed = A.runSpeed;
      this.sink = 0;
      if (this.position.distanceTo(this.cover.position) < 0.5) {
        this.phase = 'hide';
        this.coverT = rand(1, 2.2);
        this.goal = null;
      }
      // shoot on the move if they have the shot
      this._face(this.seen ? p.position : this.cover.position, dt, 6);
      this._tryShoot(dt, dist, 0.5);
      return;
    }
    if (!this.cover) {
      // no cover: hold ground, strafe a little, shoot
      this.goal = null;
      this._face(this.knownPos, dt, 6);
      this._tryShoot(dt, dist, 1);
      return;
    }
    this.coverT -= dt;
    if (this.phase === 'hide') {
      this.sink += ((this.cover.low ? 0.5 : 0) - this.sink) * Math.min(1, dt * 10);
      this._face(this.knownPos, dt, 4);
      this.d.releaseFire(this);
      if (this.mag <= 0) {
        this.mag = A.mag; // reload while hidden
        audio.sfxAt('reload', this.position, { volume: 0.4 });
        this.coverT = Math.max(this.coverT, 1.8);
      }
      if (this.coverT <= 0) {
        this.phase = 'peek';
        this.coverT = rand(1.4, 2.6);
        this.burst = 0;
      }
    } else if (this.phase === 'peek') {
      this.sink += (0 - this.sink) * Math.min(1, dt * 10);
      // high cover: lean out sideways
      if (!this.cover.low) {
        const side = new THREE.Vector3().crossVectors(UP, this.knownPos.clone().sub(this.cover.position).setY(0).normalize());
        this.goal = this.cover.position.clone().addScaledVector(side, 0.7 * (this.cover.position.x > this.knownPos.x ? -1 : 1));
        this.speed = A.walkSpeed;
      }
      this._face(this.knownPos, dt, 8);
      this._tryShoot(dt, dist, 1);
      if (this.coverT <= 0 || this.mag <= 0) {
        this.phase = 'hide';
        this.goal = this.cover.position;
        this.coverT = rand(1.2, 2.6);
        this.d.releaseFire(this);
      }
    }
  }

  /** The clip to play, or the closest one this model has. */
  _clip(name) {
    if (this.actor.hasClip(name)) return name;
    return (CLIP_FALLBACKS[name] ?? []).find((c) => this.actor.hasClip(c)) ?? name;
  }

  _leaveCover() {
    if (this.cover?.owner === this) this.cover.owner = null;
    this.cover = null;
    this.sink = 0;
  }

  _tryShoot(dt, dist, rateScale) {
    const A = CONFIG.ai;
    this.shotT -= dt;
    if (!this.seen || this.reaction > 0 || this.mag <= 0 || this.shotT > 0) return;
    if (!this.d.requestFire(this)) return;
    this.shotT = (60 / A.rpm) / rateScale + (this.burst >= A.burst ? rand(0.6, 1.2) : 0);
    if (this.burst >= A.burst) this.burst = 0;
    this.burst += 1;
    this.mag -= 1;
    this._shoot(dist);
  }

  _shoot(dist) {
    const A = CONFIG.ai;
    const p = this.d.player;
    const muzzle = this._muzzle();
    // hit chance: distance, Kael's movement, cover, darkness
    let chance = A.accuracy * (1 - Math.min(0.85, dist / A.sightRange));
    if (p.speed > 3) chance *= 0.65;
    if (p.state === 'cover' && !p.aiming) chance *= 0.25;
    if (p.crouched) chance *= 0.75;
    if (lights.isDark(p.position)) chance *= 0.5;
    if (p.state === 'roll' || p.state === 'vault') chance *= 0.2;
    const hit = Math.random() < chance;
    const aim = p.position.clone().add(new THREE.Vector3(0, p.crouched ? 0.8 : 1.25, 0));
    if (!hit) aim.add(new THREE.Vector3(rand(-1, 1), rand(-0.6, 0.9), rand(-1, 1)).multiplyScalar(0.9));
    const dir = aim.clone().sub(muzzle).normalize();
    const R = physics.RAPIER;
    const ray = physics.world.castRayAndGetNormal(new R.Ray(muzzle, dir), A.sightRange + 10, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider);
    const end = ray ? muzzle.clone().addScaledVector(dir, ray.timeOfImpact) : muzzle.clone().addScaledVector(dir, 40);
    this.d.fx.flash(muzzle, dir, 0.9);
    this.d.fx.tracer(muzzle, end, new THREE.Color(3, 1.6, 1.0));
    audio.sfxAt('rifle_shot', muzzle, { volume: 0.7, rate: rand(0.9, 1.05), refDistance: 6, echo: this.d.echo(muzzle) });
    if (ray && ray.collider.handle === p.collider.handle) {
      p.hurt(rand(A.damage[0], A.damage[1]));
      this.d.rig.kick.pitch += 0.008;
    } else if (ray) {
      const n = new THREE.Vector3(ray.normal.x, ray.normal.y, ray.normal.z);
      this.d.fx.impact(end, n, this.d.weapons.surfaces.get(ray.collider.handle) ?? 'concrete');
      if (end.distanceTo(p.position) < 3) audio.sfxAt('bullet_impact', end, { volume: 0.45, minInterval: 60 }); // near-miss crack
    }
  }

  _muzzle() {
    const m = new THREE.Vector3(0.45, 0.04, 0).applyQuaternion(this.gun.quaternion).add(this.gun.position);
    return m;
  }

  _poseGun() {
    const hand = v1;
    if (this.hand) this.hand.getWorldPosition(hand);
    else hand.copy(this.position).add(v2.set(0, 1.2 - this.sink, 0));
    const combat = this.state === 'combat';
    const dir = combat
      ? this.d.player.position.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(hand).normalize()
      : new THREE.Vector3(Math.sin(this.yaw), -0.55, Math.cos(this.yaw)).normalize();
    const z = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const y = new THREE.Vector3().crossVectors(z, dir).normalize();
    this.gun.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, y, z));
    this.gun.position.copy(hand).addScaledVector(dir, -0.25);
    this.gun.visible = !this.dead;
  }

  _face(point, dt, rate) {
    const yaw = Math.atan2(point.x - this.position.x, point.z - this.position.z);
    this.yaw += angleDelta(this.yaw, yaw) * Math.min(1, dt * rate);
  }

  _animate() {
    if (this.actor.currentName === 'hit' || this.actor.currentName === 'interact') return; // gesture playing
    const v = this.velocity.length();
    const combat = this.state === 'combat';
    let clip = combat ? 'idle_gun_pointing' : 'idle_gun';
    if (v > 0.3) {
      if (combat && this.seen) {
        // strafe / backpedal / run-and-gun relative to facing
        const f = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const fwd = this.velocity.dot(f) / v;
        const side = (this.velocity.x * f.z - this.velocity.z * f.x) / v;
        if (fwd > 0.6) clip = 'run_shoot';
        else if (fwd < -0.6) clip = 'run_back';
        else clip = side > 0 ? 'run_left' : 'run_right';
      } else clip = v > 2.6 ? 'run' : 'walk';
    }
    clip = this._clip(clip);
    if (this.actor.currentName !== clip) this.actor.play(clip, CONFIG.animation.blendDefault, { timeScale: v > 0.3 ? Math.min(1.4, Math.max(0.7, v / (v > 2.6 ? 4.2 : 1.6))) : 1 });
  }

  // ---------------------------------------------------------------------------
  // Fixed step: walking through the character controller
  // ---------------------------------------------------------------------------
  fixedUpdate(dt) {
    if (this.dead) return;
    const want = new THREE.Vector3();
    if (this.goal) {
      want.subVectors(this.goal, this.position).setY(0);
      const d = want.length();
      if (d > 0.15) want.multiplyScalar(Math.min(this.speed, d * 4) / d);
      else want.set(0, 0, 0);
      if (this.sidestep) {
        this.sidestep.t -= dt;
        want.copy(this.sidestep.dir).multiplyScalar(this.speed);
        if (this.sidestep.t <= 0) this.sidestep = null;
      }
      // face the walking direction unless fighting
      if (this.state !== 'combat' && want.lengthSq() > 0.01) this.yaw += angleDelta(this.yaw, Math.atan2(want.x, want.z)) * Math.min(1, dt * 6);
    }
    this.velocity.lerp(want, Math.min(1, dt * 8));
    const desired = { x: this.velocity.x * dt, y: -9.81 * dt * 0.5, z: this.velocity.z * dt };
    this.kcc.computeColliderMovement(this.collider, desired, physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    const m = this.kcc.computedMovement();
    const t = this.body.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    this.body.setNextKinematicTranslation(next);
    this.position.set(next.x, next.y, next.z);
    // stuck on something → sidestep around it
    const moved = Math.hypot(m.x, m.z);
    const asked = Math.hypot(desired.x, desired.z);
    if (asked > 0.005 && moved < asked * 0.3) {
      this.stuckT += dt;
      if (this.stuckT > 0.35 && !this.sidestep) {
        const s = new THREE.Vector3(-want.z, 0, want.x).normalize().multiplyScalar(Math.random() < 0.5 ? 1 : -1);
        this.sidestep = { dir: s, t: 0.6 };
        this.stuckT = 0;
      }
    } else this.stuckT = 0;
  }

  // ---------------------------------------------------------------------------
  // Damage
  // ---------------------------------------------------------------------------
  /** Returns true if this killed him. */
  damage(amount, { incendiary = false, explosive = false, tick = false } = {}) {
    if (this.dead) return false;
    if (this.armor && !incendiary && !explosive && !tick) amount *= 1 - this.armor;
    this.health -= amount;
    if (incendiary) this.burn = CONFIG.weapons.incendiary.burnSeconds;
    if (!tick) {
      // getting shot: he knows where Kael is, and his squad hears it
      const wasCombat = this.state === 'combat';
      this.alert(this.d.player.position);
      if (!wasCombat) this.d.alertNearby(this, this.d.player.position);
      if (this.phase === 'peek') this.coverT = Math.min(this.coverT, 0.3);
    }
    if (this.health <= 0) {
      this.dead = true;
      this.burn = 0;
      this.d.releaseFire(this);
      this._leaveCover();
      this.collider.setEnabled(false);
      this.icon.visible = false;
      this.velocity.set(0, 0, 0);
      if (this.actor.hasClip('death')) this.actor.play('death', 0.1, { loop: false, clamp: true });
      else this.topple = 0.001; // no death clip: fall over
      this.d.alertNearby(this, this.d.player.position); // a body hitting the floor is heard
      this.d.onKill?.(this);
      return true;
    }
    if ((!tick || explosive) && this.actor.hasClip('hit')) this.actor.gesture('hit', this._clip('idle_gun_pointing'), 0.1);
    return false;
  }

  snapshot() {
    return { p: this.position.toArray(), yaw: this.yaw, health: this.health, dead: this.dead, state: this.state, mag: this.mag };
  }

  restore(s) {
    if (this.dead && !s.dead) {
      // ⏳ back on his feet
      this.dead = false;
      this.collider.setEnabled(true);
      this.actor.play('idle_gun_pointing', 0.15);
    }
    this.position.fromArray(s.p);
    this.body.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, true);
    this.body.setNextKinematicTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] });
    this.yaw = s.yaw;
    this.health = s.health;
    this.mag = s.mag;
    this.root.position.copy(this.position);
    this.model.rotation.y = this.yaw;
  }

  dispose() {
    this.offHit();
    this.root.removeFromParent();
    this.gun.removeFromParent();
    this.icon.removeFromParent();
    this.icon.material.dispose();
    if (this.d._generation === physics.generation) {
      physics.world.removeCharacterController(this.kcc);
      physics.world.removeRigidBody(this.body);
    }
  }
}

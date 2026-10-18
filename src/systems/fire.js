// =============================================================================
// FLATLINE: 2050 — systems/fire.js
// 🔥 FIRE (CLAUDE.md Phase 7.4): fires that spread.
//
//   fire.init(scene, fx)                          once per world
//   fire.addFlammable({ position, object, fuel })  crates, barrels, curtains…
//   fire.ignite(point)                            incendiary rounds, explosions
//   fire.heatAt(point) → 0..1                     damage / AI avoidance
//   fire.hazeSources(camera)                      screen points for heat haze
//
// A burning thing heats every flammable within CONFIG.fire.spreadRadius;
// enough heat and it catches. Each fire burns its fuel down, chars its object
// and dies. Flames are flickering additive sprites with a light; embers and a
// black smoke column come from the shared particle pools (vfx/muzzleFX.js).
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { audio } from '../core/audio.js';

let flameTex = null;
function flameTexture() {
  if (flameTex) return flameTex;
  const w = 64;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w / 2, h * 0.72, 2, w / 2, h * 0.6, h * 0.55);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.25, 'rgba(255,190,70,0.95)');
  g.addColorStop(0.55, 'rgba(255,90,20,0.55)');
  g.addColorStop(1, 'rgba(120,20,0,0)');
  ctx.fillStyle = g;
  // a teardrop: round bottom, licking tip
  ctx.beginPath();
  ctx.moveTo(w / 2, 4);
  ctx.bezierCurveTo(w * 0.95, h * 0.45, w * 0.95, h * 0.95, w / 2, h - 4);
  ctx.bezierCurveTo(w * 0.05, h * 0.95, w * 0.05, h * 0.45, w / 2, 4);
  ctx.fill();
  flameTex = new THREE.CanvasTexture(c);
  flameTex.colorSpace = THREE.SRGBColorSpace;
  return flameTex;
}

class FireSystem {
  constructor() {
    this.fires = [];
    this.flammables = [];
    this.scene = null;
    this.fx = null;
  }

  /** Bind to a world (call after physics.clear / scene creation). */
  init(scene, fx) {
    this.clear();
    this.scene = scene;
    this.fx = fx;
    this.material = new THREE.SpriteMaterial({ map: flameTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(1.6, 1.25, 1) });
  }

  /**
   * @param {object} o
   * @param {THREE.Vector3} o.position   centre of the burnable thing
   * @param {THREE.Object3D} [o.object]  gets charred when it burns out
   * @param {number} [o.size]            flame size (m)
   * @param {number} [o.fuel]            seconds it burns
   * @param {Function} [o.onIgnite]
   */
  addFlammable({ position, object = null, size = 1, fuel = CONFIG.fire.fuel, onIgnite = null }) {
    const f = { position: position.clone(), object, size, fuel, heat: 0, burning: false, burnt: false, onIgnite };
    this.flammables.push(f);
    return f;
  }

  /** Start a fire at a point — catches the nearest flammable if one is close. */
  ignite(point, { size = 0.6, fuel = CONFIG.fire.groundFuel } = {}) {
    let best = null;
    let bestD = CONFIG.fire.catchRadius;
    for (const f of this.flammables) {
      if (f.burning || f.burnt) continue;
      const d = f.position.distanceTo(point);
      if (d < bestD) {
        best = f;
        bestD = d;
      }
    }
    if (best) return this._burn(best);
    return this._spawn(point, size, fuel, null);
  }

  _burn(f) {
    f.burning = true;
    f.onIgnite?.(f);
    return this._spawn(f.position, f.size, f.fuel, f);
  }

  _spawn(point, size, fuel, flammable) {
    if (!this.scene) return null;
    if (this.fires.length >= CONFIG.fire.maxFires) this._remove(this.fires[0]);
    const group = new THREE.Group();
    group.position.copy(point);
    const sprites = [];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(this.material);
      s.center.set(0.5, 0.05);
      s.position.set((Math.random() - 0.5) * size * 0.6, 0, (Math.random() - 0.5) * size * 0.6);
      s.userData.phase = Math.random() * 10;
      group.add(s);
      sprites.push(s);
    }
    this.scene.add(group);
    const sound = audio.sfxAt('fire_loop', point, { volume: 0.3 * Math.min(1, size), refDistance: 3 }); // loop, stopped on remove
    const fire = { point: point.clone(), size, fuel, maxFuel: fuel, life: 0, group, sprites, glow: 0, sound, flammable, emberAcc: 0, smokeAcc: 0 };
    this.fires.push(fire);
    return fire;
  }

  _remove(fire) {
    fire.group.removeFromParent();
    audio.stop('sfx', 'fire_loop', fire.sound, 0.8);
    if (fire.flammable) {
      fire.flammable.burning = false;
      fire.flammable.burnt = true;
      this._char(fire.flammable.object);
    }
    this.fires = this.fires.filter((f) => f !== fire);
  }

  /** Burnt-out objects go black. */
  _char(object) {
    object?.traverse((o) => {
      if (!o.isMesh) return;
      o.material = [].concat(o.material).map((m) => {
        const c = m.clone();
        c.color?.multiplyScalar(0.12);
        if (c.emissive) c.emissive.setScalar(0);
        c.roughness = 1;
        return c;
      });
      if (o.material.length === 1) o.material = o.material[0];
    });
  }

  /** 0..1 heat at a point (1 = standing in the flames). */
  heatAt(point) {
    let h = 0;
    for (const f of this.fires) {
      const r = f.size * CONFIG.fire.damageRadius;
      const d = Math.hypot(point.x - f.point.x, point.z - f.point.z);
      if (d < r && Math.abs(point.y - f.point.y) < 2.2) h = Math.max(h, (1 - d / r) * this._strength(f));
    }
    return h;
  }

  _strength(f) {
    const rampIn = Math.min(1, f.life / 0.6);
    const rampOut = Math.min(1, f.fuel / 1.5);
    return rampIn * rampOut;
  }

  /** Only the fires nearest the camera keep a real light (lights are expensive). */
  updateLights(camera, max = CONFIG.fire.maxLights) {
    const sorted = this.fires.slice().sort((a, b) => a.point.distanceToSquared(camera.position) - b.point.distanceToSquared(camera.position));
    // a fixed pool (the light count never changes, so no shader recompiles)
    if (!this.pool) {
      this.pool = Array.from({ length: max }, () => {
        const l = new THREE.PointLight(0xff7a2a, 0, 10, 2);
        this.scene.add(l);
        return l;
      });
    }
    this.pool.forEach((l, i) => {
      const f = sorted[i];
      l.intensity = f ? f.glow : 0;
      if (f) {
        l.distance = 7 * f.size + 3;
        l.position.copy(f.point).setY(f.point.y + f.size * 0.8);
      }
    });
  }

  /** Up to 4 fires as screen points for the heat-haze effect: [x, y, radius, strength]. */
  hazeSources(camera, out = []) {
    out.length = 0;
    const v = new THREE.Vector3();
    const sorted = this.fires.map((f) => [f, f.point.distanceToSquared(camera.position)]).sort((a, b) => a[1] - b[1]).slice(0, 4);
    for (const [f, d2] of sorted) {
      v.copy(f.point);
      v.y += f.size * 1.4;
      v.project(camera);
      if (v.z > 1) continue;
      const dist = Math.sqrt(d2);
      out.push([v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, Math.min(0.35, (f.size * 1.8) / Math.max(1, dist)), this._strength(f) * Math.min(1, 6 / Math.max(1, dist))]);
    }
    return out;
  }

  update(dt) {
    const F = CONFIG.fire;
    for (const fire of [...this.fires]) {
      fire.life += dt;
      fire.fuel -= dt;
      const k = this._strength(fire);
      // flicker
      fire.sprites.forEach((s, i) => {
        const t = fire.life * 9 + s.userData.phase;
        const hgt = fire.size * (1.1 + 0.35 * Math.sin(t) + 0.2 * Math.sin(t * 2.3)) * k;
        s.scale.set(fire.size * (0.7 + 0.15 * Math.sin(t * 1.7 + i)) * k, hgt, 1);
      });
      fire.glow = (6 + Math.random() * 4) * fire.size * k;
      // embers + black smoke column
      fire.emberAcc += dt * 16 * fire.size * k;
      while (fire.emberAcc > 1) {
        fire.emberAcc -= 1;
        const p = fire.point.clone().add(new THREE.Vector3((Math.random() - 0.5) * fire.size, fire.size * 0.6, (Math.random() - 0.5) * fire.size));
        this.fx.sparks.emit(p, new THREE.Vector3((Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.8), [1, 0.45 + Math.random() * 0.3, 0.1], 0.04, 1 + Math.random(), 0.6);
      }
      fire.smokeAcc += dt * 5 * fire.size * k;
      while (fire.smokeAcc > 1) {
        fire.smokeAcc -= 1;
        const p = fire.point.clone().add(new THREE.Vector3((Math.random() - 0.5) * fire.size * 0.5, fire.size * 1.4, (Math.random() - 0.5) * fire.size * 0.5));
        this.fx.puffs.emit(p, new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4), [0.05, 0.045, 0.045], 0.6 * fire.size + 0.3, 3.5 + Math.random() * 2, 0.15, 4);
      }
      // spread: heat the neighbours
      for (const f of this.flammables) {
        if (f.burning || f.burnt) continue;
        const d = f.position.distanceTo(fire.point);
        if (d > F.spreadRadius) continue;
        f.heat += dt * k * (1 - d / F.spreadRadius) * fire.size;
        if (f.heat >= F.igniteHeat) this._burn(f);
      }
      if (fire.fuel <= 0) this._remove(fire);
    }
    // neighbours cool down slowly when nothing burns near them
    for (const f of this.flammables) if (!f.burning) f.heat = Math.max(0, f.heat - dt * 0.05);
  }

  clear() {
    [...this.fires].forEach((f) => {
      f.group.removeFromParent();
      audio.stop('sfx', 'fire_loop', f.sound, 0.3);
    });
    this.fires = [];
    this.flammables = [];
    this.pool?.forEach((l) => l.removeFromParent());
    this.pool = null;
    this.material?.dispose();
    this.scene = null;
  }
}

export const fire = new FireSystem();

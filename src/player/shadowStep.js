// =============================================================================
// FLATLINE: 2050 — player/shadowStep.js
// 🌑 SHADOW STEP (CLAUDE.md Phase 7.3): hold T → the world slows a little and
// every dark patch around Kael lights up violet; aim at one and release →
// he dissolves into black smoke and re-forms there. Costs 2 heartbeats.
// Only dark ground is a valid target, so shooting out lamps opens new paths.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { physics } from '../core/physics.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { lights } from '../systems/lights.js';
import { heartbeat } from '../systems/heartbeat.js';
import { addDissolve } from '../vfx/dissolveShader.js';
import { glowTexture } from '../vfx/particleTextures.js';

const VIOLET = new THREE.Color(0x8a4dff);

export class ShadowStep {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {PlayerController} o.player
   * @param {CameraRig} o.rig
   * @param {CombatFX} o.fx   (smoke puffs)
   */
  constructor({ scene, player, rig, fx }) {
    const S = CONFIG.shadowStep;
    this.scene = scene;
    this.player = player;
    this.rig = rig;
    this.fx = fx;
    this.state = 'idle';     // idle | sight | stepping
    this.target = null;
    this.dissolve = addDissolve(player.model, { color: 0xa070ff });

    // Dark-zone tiles (instanced, additive violet)
    const n = Math.ceil((S.range * 2) / S.cell) ** 2;
    const tileMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: VIOLET.clone().multiplyScalar(0.9), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tiles = new THREE.InstancedMesh(new THREE.PlaneGeometry(S.cell * 1.25, S.cell * 1.25).rotateX(-Math.PI / 2), tileMat, n);
    this.tiles.count = 0;
    this.tiles.frustumCulled = false;
    this.tiles.renderOrder = 3;
    scene.add(this.tiles);

    // Target marker: ring + column
    const ringMat = new THREE.MeshBasicMaterial({ color: VIOLET.clone().multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.marker = new THREE.Group();
    this.marker.add(new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2), ringMat));
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2, 24, 1, true), ringMat.clone());
    col.material.opacity = 0.18;
    col.position.y = 1;
    this.marker.add(col);
    this.marker.visible = false;
    scene.add(this.marker);
    this._scanT = 0;
  }

  get busy() {
    return this.state !== 'idle';
  }

  update(realDt) {
    const p = this.player;
    const S = CONFIG.shadowStep;
    const blocked = p.locked || p.state === 'dead' || p.state === 'vault' || timeScale.rewinding;
    if (this.state === 'idle' && input.wasPressed('KeyT') && !blocked) this._enterSight();
    if (this.state !== 'sight') return;

    // keep the dark-zone map fresh (lamps can go out while you look)
    this._scanT -= realDt;
    if (this._scanT <= 0) {
      this._scan();
      this._scanT = 0.3;
    }
    this.tiles.material.opacity = Math.min(0.55, this.tiles.material.opacity + realDt * 2);

    // aim: crosshair ray onto the ground
    this.target = this._pick();
    this.marker.visible = !!this.target;
    if (this.target) {
      this.marker.position.copy(this.target.point);
      const ok = this.target.valid && heartbeat.canAfford(CONFIG.heartbeat.cost.shadowStep);
      this.marker.children.forEach((m) => m.material.color.copy(ok ? VIOLET : new THREE.Color(0xff3040)).multiplyScalar(ok ? 3 : 2));
      this.marker.rotation.y += realDt * 1.5;
    }

    if (!input.isDown('KeyT') || blocked) {
      const t = this.target;
      this._exitSight();
      if (!blocked && t?.valid) this._step(t.point);
      else if (t && !blocked) audio.sfx('ui_click', { volume: 0.4, rate: 0.6 });
    }
    void S;
  }

  _enterSight() {
    this.state = 'sight';
    this._scanT = 0;
    timeScale.set(CONFIG.shadowStep.sightSlowMo, 0.2);
    game.postfx.setMood('SHADOWS', 0.25);
    audio.sfx('shadow_step', { volume: 0.25, rate: 0.6 });
  }

  _exitSight() {
    if (this.state === 'sight') this.state = 'idle';
    this.marker.visible = false;
    gsap.to(this.tiles.material, { opacity: 0, duration: 0.25 });
    timeScale.set(1, 0.2);
    game.postfx.setMood('NEUTRAL', 0.4);
  }

  /** Lay violet tiles on every dark cell around Kael. */
  _scan() {
    const S = CONFIG.shadowStep;
    const c = this.player.position;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    let i = 0;
    const R = physics.RAPIER;
    for (let x = -S.range; x <= S.range; x += S.cell) {
      for (let z = -S.range; z <= S.range; z += S.cell) {
        if (x * x + z * z > S.range * S.range) continue;
        p.set(Math.round((c.x + x) / S.cell) * S.cell, c.y + 3, Math.round((c.z + z) / S.cell) * S.cell);
        const hit = physics.world.castRay(new R.Ray(p, { x: 0, y: -1, z: 0 }), 8, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.player.collider);
        if (!hit) continue;
        p.y -= hit.timeOfImpact - 0.03;
        if (!lights.isDark(p)) continue;
        m.makeTranslation(p.x, p.y, p.z);
        this.tiles.setMatrixAt(i++, m);
        if (i >= this.tiles.instanceMatrix.count) break;
      }
    }
    this.tiles.count = i;
    this.tiles.instanceMatrix.needsUpdate = true;
  }

  /** Crosshair → ground point within range; valid if dark and standable. */
  _pick() {
    const S = CONFIG.shadowStep;
    const R = physics.RAPIER;
    const cam = this.rig.camera;
    const o = cam.getWorldPosition(new THREE.Vector3());
    const d = cam.getWorldDirection(new THREE.Vector3());
    const hit = physics.world.castRayAndGetNormal(new R.Ray(o, d), S.range + 6, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.player.collider);
    if (!hit) return null;
    const point = o.clone().addScaledVector(d, hit.timeOfImpact);
    // walls: drop to the floor in front of them
    if (hit.normal.y < 0.6) {
      point.addScaledVector(new THREE.Vector3(hit.normal.x, 0, hit.normal.z), CONFIG.player.radius + 0.1);
      const down = physics.world.castRay(new R.Ray({ x: point.x, y: point.y + 0.2, z: point.z }, { x: 0, y: -1, z: 0 }), 10, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.player.collider);
      if (!down) return null;
      point.y += 0.2 - down.timeOfImpact;
    }
    const dist = point.distanceTo(this.player.position);
    // room to stand?
    const P = CONFIG.player;
    const head = physics.world.castRay(new R.Ray({ x: point.x, y: point.y + 0.1, z: point.z }, { x: 0, y: 1, z: 0 }), P.height, true, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.player.collider);
    const valid = dist <= S.range && dist > 1 && !head && lights.isDark(point);
    return { point, valid };
  }

  async _step(to) {
    if (!heartbeat.spend(CONFIG.heartbeat.cost.shadowStep, 'shadow step')) return;
    const p = this.player;
    this.state = 'stepping';
    p.locked = true;
    const from = p.position.clone();
    const smoke = (at) => {
      for (let i = 0; i < 26; i++) {
        const v = new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6);
        this.fx.puffs.emit(at.clone().add(new THREE.Vector3(0, Math.random() * 1.7, 0)), v, [0.06, 0.02, 0.1], 0.35 + Math.random() * 0.3, 0.8 + Math.random() * 0.6, 0.3, 3);
      }
    };
    audio.sfxAt('shadow_step', from, { volume: 0.9 });
    smoke(from);
    const st = { v: 0 };
    await gsap.to(st, { v: 1, duration: CONFIG.shadowStep.dissolveTime, ease: 'power2.in', onUpdate: () => this.dissolve.set(st.v, p.position.y) });
    p.respawn(to, Math.atan2(to.x - from.x, to.z - from.z));
    p.root.position.copy(to);
    this.rig.pivot.lerp(new THREE.Vector3(to.x, to.y + CONFIG.cameraRig.height, to.z), 0.6);
    smoke(to);
    audio.sfxAt('shadow_step', to, { volume: 0.7, rate: 1.3 });
    game.postfx.glitch(0.15, 0.35);
    await gsap.to(st, { v: 0, duration: CONFIG.shadowStep.dissolveTime * 1.3, ease: 'power2.out', onUpdate: () => this.dissolve.set(st.v, to.y) });
    p.locked = false;
    this.state = 'idle';
  }

  dispose() {
    if (this.state === 'sight') this._exitSight();
    this.dissolve.dispose();
    this.tiles.removeFromParent();
    this.tiles.geometry.dispose();
    this.tiles.material.dispose();
    this.marker.removeFromParent();
  }
}

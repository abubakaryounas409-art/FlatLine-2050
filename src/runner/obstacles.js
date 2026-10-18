// =============================================================================
// FLATLINE: 2050 — runner/obstacles.js
// Everything on the track: obstacles (pooled meshes + boxes for collision),
// shards (score), theme orbs (ability charges) and memory fragments
// (heartbeats + a piece of the story).
//
// Which power beats what (the rule the whole game teaches):
//   🔥 BURN smashes anything physical — barricades, squads, blocks, beams.
//      Not lasers (light) and not chrono shutters (time-steel).
//   🌑 SHADOW passes through anything solid or watching — lasers, squads,
//      blocks, cars. Not fire: the light burns shadows away.
//   ⏳ TIME freezes anything that MOVES — shutters, ghost cars, falling beams.
//      Once frozen it stays jammed.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { createFlames, flameMaterial, canvasTexture } from './runnerFX.js';

const LANES = () => CONFIG.runner.lanes;
const LANE_W = 2.3;

/** What each power can do to each kind. */
export const BEATS = {
  burn: new Set(['low', 'high', 'block', 'firewall', 'squad', 'beam', 'oncoming']),
  shadow: new Set(['low', 'high', 'block', 'laser', 'squad', 'oncoming']),
  time: new Set(['shutter', 'oncoming', 'beam']),
};
/** Kinds that span all three lanes. */
const FULL = new Set(['shutter', 'laser', 'squad', 'firewall', 'gap', 'beam']);
/** Which power a gate asks for (HUD hints). */
export const GATE_NEEDS = { shutter: 'time', laser: 'shadow', firewall: 'fire', squad: 'shadow' };

const ACCENT = {
  time: new THREE.Color(0.25, 0.66, 1.0),
  shadows: new THREE.Color(0.6, 0.36, 1.0),
  fire: new THREE.Color(1.0, 0.42, 0.1),
};

function stripeTexture(a, b, label) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = a;
    g.fillRect(0, 0, w, h);
    g.fillStyle = b;
    for (let x = -h; x < w + h; x += 48) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + 24, 0);
      g.lineTo(x + 24 - h, h);
      g.lineTo(x - h, h);
      g.fill();
    }
    if (label) {
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(0, h * 0.32, w, h * 0.36);
      g.fillStyle = b;
      g.font = '700 38px Rajdhani, Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText(label, w / 2, h * 0.62);
    }
  });
}

function shutterTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#060c18';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3fa9ff';
    g.lineWidth = 6;
    for (let y = 0; y < h; y += 64) g.strokeRect(6, y + 4, w - 12, 56);
    // a clock face
    g.lineWidth = 10;
    g.beginPath();
    g.arc(w / 2, h / 2, 150, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w / 2 + Math.sin(a) * 120, h / 2 - Math.cos(a) * 120);
      g.lineTo(w / 2 + Math.sin(a) * 145, h / 2 - Math.cos(a) * 145);
      g.stroke();
    }
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 + 70, h / 2 - 70);
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2, h / 2 - 115);
    g.stroke();
  }, { srgb: true });
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

export class TrackObjects {
  /**
   * @param {THREE.Scene} scene
   * @param {Map} assets
   * @param {string} act 'time' | 'shadows' | 'fire'
   * @param {object} course from buildCourse()
   * @param {import('./runnerFX.js').RunnerParticles} particles
   */
  constructor(scene, assets, act, course, particles) {
    this.scene = scene;
    this.assets = assets;
    this.act = act;
    this.particles = particles;
    this.group = new THREE.Group();
    this.group.name = 'track-objects';
    scene.add(this.group);
    this.disposables = [];
    this.pools = new Map();
    this.actors = new Set(); // animated squads (updated while visible)
    this.accent = ACCENT[act];
    this._buildMaterials();

    // runtime copies of the course
    const blocks = course.obstacles.filter((o) => o.kind === 'block');
    this.obstacles = course.obstacles.map((o) => ({ ...o, mesh: null, broken: false, passed: false, state: { p: 0, jammed: false, triggered: false, z: o.z } }));
    this.shards = course.shards
      .filter((s) => !blocks.some((b) => b.lane === s.lane && s.z > b.z - 1.5 && s.z < b.z + (b.len ?? 3) + 1.5))
      .map((s) => ({ ...s, taken: false }));
    this.orbs = course.orbs.map((o) => ({ ...o, taken: false, mesh: null }));
    this.fragments = course.fragments.map((f) => ({ ...f, taken: false, mesh: null }));
    this._buildShards();
    // build one of every mesh now, so the act's shaders compile under the black screen (no hitch later)
    for (const k of new Set(this.obstacles.map((o) => o.kind))) {
      const m = this._makeMesh(k);
      m.visible = false;
      this.pools.set(k, [m]);
    }
    this.warmups = [this._orbMesh('time'), this._fragMesh()];
  }

  /** Show every pooled mesh (for compileAsync), then hide again with `false`. */
  setWarm(on) {
    for (const pool of this.pools.values()) pool.forEach((m) => (m.visible = on));
    this.warmups.forEach((m) => (m.visible = on));
    if (!on) {
      this.warmups.forEach((m) => m.removeFromParent());
      this.warmups = [];
    }
  }

  // ---------------------------------------------------------------------------
  // Materials + meshes
  // ---------------------------------------------------------------------------
  _keep(x) {
    this.disposables.push(x);
    return x;
  }

  _buildMaterials() {
    const k = (x) => this._keep(x);
    const a = this.accent;
    this.mat = {
      body: k(new THREE.MeshStandardMaterial({ color: this.act === 'fire' ? 0x2a1d16 : this.act === 'shadows' ? 0x26262c : 0x14161e, roughness: 0.5, metalness: 0.4 })),
      steel: k(new THREE.MeshStandardMaterial({ color: 0x3a3c42, roughness: 0.35, metalness: 0.85 })),
      glow: k(new THREE.MeshBasicMaterial({ color: a.clone().multiplyScalar(4), toneMapped: false })),
      red: k(new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.35, 0.3), toneMapped: false })),
      laser: k(new THREE.MeshBasicMaterial({ color: new THREE.Color(5.5, 0.4, 2.4), toneMapped: false, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })),
      hot: k(new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: 0xff5010, emissiveIntensity: 1.6, roughness: 0.6 })),
      warn: k(new THREE.MeshStandardMaterial({
        map: k(this.act === 'fire' ? stripeTexture('#111', '#d9a413', 'DANGER') : this.act === 'shadows' ? stripeTexture('#111', '#e8c400', 'POLICE LINE') : stripeTexture('#0a0f1a', '#3fa9ff', '◄ ◄ ◄')),
        emissive: 0xffffff,
        emissiveMap: null,
        emissiveIntensity: 0,
        roughness: 0.5,
      })),
      shutter: k(new THREE.MeshStandardMaterial({ color: 0x0a1220, emissive: 0x3fa9ff, emissiveMap: k(shutterTexture()), emissiveIntensity: 2.2, metalness: 0.8, roughness: 0.3 })),
      jammed: k(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.4, 3.2), toneMapped: false, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })),
      shield: k(new THREE.MeshStandardMaterial({ color: 0x0e0e12, roughness: 0.25, metalness: 0.6, transparent: true, opacity: 0.85 })),
      visor: k(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3), toneMapped: false })),
      pit: k(new THREE.MeshBasicMaterial({ color: 0x000000 })),
      flame: k(flameMaterial({ intensity: 2.6 })),
      warnLane: k(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.4, 0.3), toneMapped: false, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })),
    };
    this.mat.warn.emissiveMap = this.mat.warn.map;
    this.mat.warn.emissiveIntensity = 0.9;
    this.geo = {
      box: k(new THREE.BoxGeometry(1, 1, 1)),
      cyl: k(new THREE.CylinderGeometry(0.5, 0.5, 1, 12)),
      plane: k(new THREE.PlaneGeometry(1, 1)),
    };
  }

  /** A unit box mesh (centre at its middle), positioned/scaled by the caller. */
  _box(mat, w, h, d, x, y, z) {
    const m = new THREE.Mesh(this.geo.box, mat);
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    m.castShadow = false;
    return m;
  }

  _makeMesh(kind) {
    const g = new THREE.Group();
    const M = this.mat;
    const W = LANE_W;
    switch (kind) {
      case 'low': {
        // a barrier you jump: warning face + glowing top edge
        g.add(this._box(M.body, W, 0.95, 0.6, 0, 0.475, 0.3));
        const face = this._box(M.warn, W - 0.1, 0.5, 0.02, 0, 0.55, -0.01);
        g.add(face);
        g.add(this._box(M.glow, W, 0.06, 0.62, 0, 0.98, 0.3));
        break;
      }
      case 'high': {
        // a board you roll under: posts + sign, glowing underside
        for (const s of [-1, 1]) g.add(this._box(M.steel, 0.14, 3.4, 0.14, s * (W / 2 - 0.08), 1.7, 0.2));
        g.add(this._box(M.body, W, 2.2, 0.4, 0, 2.3, 0.2));
        g.add(this._box(M.warn, W - 0.1, 0.6, 0.02, 0, 1.6, -0.01));
        g.add(this._box(M.glow, W, 0.06, 0.42, 0, 1.18, 0.2));
        break;
      }
      case 'block': {
        // unit length 1 along z — scaled per use (container / stair hut / furnace)
        const body = this._box(M.body, W, 3.2, 1, 0, 1.6, 0.5);
        body.name = 'stretch';
        g.add(body);
        const edge = this._box(M.glow, W + 0.04, 0.06, 1, 0, 3.2, 0.5);
        edge.name = 'stretch';
        g.add(edge);
        g.add(this._box(M.glow, 0.06, 3.2, 0.06, -W / 2, 1.6, -0.01));
        g.add(this._box(M.glow, 0.06, 3.2, 0.06, W / 2, 1.6, -0.01));
        g.add(this._box(M.warn, W - 0.3, 0.7, 0.02, 0, 1.6, -0.02));
        break;
      }
      case 'oncoming': {
        const tpl = this.assets.get('vehicles.car_2050_rival_lite') ?? this.assets.get('vehicles.car_2050_kael');
        const car = tpl ? createModelInstance(tpl) : this._box(M.body, 2, 1.1, 4.6, 0, 0.55, 0);
        // the racer's nose points to -Z, which is towards Kael already
        car.traverse((o) => {
          if (o.isMesh) o.castShadow = false;
        });
        if (car.isGroup || car.children.length) {
          const box = new THREE.Box3().setFromObject(car);
          const size = box.getSize(new THREE.Vector3());
          const k = 4.6 / Math.max(size.z, 0.01);
          car.scale.multiplyScalar(k);
          car.position.y -= box.min.y * k;
        }
        g.add(car);
        // ghost glow: the car is a replay of the crash
        g.add(this._box(M.red, 1.7, 0.08, 0.08, 0, 0.6, -2.3));
        // warning stripe on the floor ahead of it
        const warn = this._box(this._keep(M.warnLane.clone()), 0.25, 0.01, 30, 0, 0.02, -17); // own copy: each car blinks alone
        warn.name = 'warn';
        g.add(warn);
        break;
      }
      case 'shutter': {
        for (const s of [-1, 1]) g.add(this._box(M.steel, 0.6, 7, 0.8, s * 4.6, 3.5, 0));
        g.add(this._box(M.steel, 9.8, 0.8, 0.8, 0, 7.0, 0));
        for (const s of [-1, 1]) g.add(this._box(M.glow, 0.06, 6.6, 0.06, s * 4.28, 3.3, -0.42));
        const panel = this._box(M.shutter, 8.6, 6, 0.3, 0, 3, 0);
        panel.name = 'panel';
        g.add(panel);
        const ice = this._box(M.jammed, 8.8, 6.2, 0.6, 0, 3, 0);
        ice.name = 'ice';
        ice.visible = false;
        g.add(ice);
        break;
      }
      case 'laser': {
        for (const s of [-1, 1]) {
          g.add(this._box(M.steel, 0.35, 3.8, 0.35, s * 4.4, 1.9, 0));
          for (let y = 0.35; y < 3.6; y += 0.55) g.add(this._box(M.red, 0.38, 0.1, 0.38, s * 4.4, y, 0));
        }
        const beams = new THREE.Group();
        beams.name = 'beams';
        for (let y = 0.35; y < 3.6; y += 0.55) beams.add(this._box(M.laser, 8.6, 0.035, 0.035, 0, y, 0));
        for (let k = -2; k <= 2; k++) {
          const d = this._box(M.laser, 0.03, 4.6, 0.03, k * 1.6, 1.8, 0);
          d.rotation.z = k % 2 ? 0.6 : -0.6;
          beams.add(d);
        }
        g.add(beams);
        break;
      }
      case 'squad': {
        const tpl = this.assets.get('characters.enemy');
        for (const lane of [0, 1, 2]) {
          const x = LANES()[lane];
          let man;
          if (tpl) {
            man = createModelInstance(tpl);
            man.rotation.y = Math.PI; // face Kael
            const actor = new Actor('enforcer', man, man.userData.animations ?? []);
            if (actor.hasClip('idle_gun_pointing')) actor.play('idle_gun_pointing', 0.01);
            else if (actor.hasClip('idle_gun')) actor.play('idle_gun', 0.01);
            else actor.play('idle', 0.01);
            actor.mixer?.setTime(Math.random() * 2);
            man.userData.actor = actor;
          } else {
            man = this._box(M.body, 0.6, 1.85, 0.4, 0, 0.92, 0);
          }
          man.position.x = x;
          man.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = false;
              o.frustumCulled = false;
            }
          });
          g.add(man);
          // riot shield with a red visor strip
          g.add(this._box(M.shield, 1.0, 1.5, 0.08, x, 0.95, -0.6));
          g.add(this._box(M.visor, 0.8, 0.06, 0.1, x, 1.45, -0.62));
        }
        break;
      }
      case 'firewall': {
        for (let k = -4; k <= 4; k++) g.add(this._box(M.hot, 1.1, 0.8 + ((k * 7) % 3) * 0.4, 0.9, k * 1.0, 0.5, 0.3 + (k % 2) * 0.2));
        g.add(this._box(M.hot, 9.4, 0.25, 0.25, 0, 1.6, 0.1));
        g.add(this._box(M.hot, 9.4, 0.25, 0.25, 0, 2.4, 0.4));
        const spots = [];
        for (let k = 0; k < 11; k++) spots.push({ x: -4.5 + k * 0.9, y: 0.2, z: 0.2 + (k % 2) * 0.3, w: 1.5 + (k % 3) * 0.4, h: 2.8 + ((k * 5) % 4) * 0.6 });
        g.add(createFlames(spots, M.flame));
        break;
      }
      case 'gap': {
        // unit length along z (scaled per use): a black drop between rooftops
        const pit = this._box(M.pit, 9.2, 0.04, 1, 0, 0.012, 0.5);
        pit.name = 'stretch';
        g.add(pit);
        for (const z of [0, 1]) {
          const lip = this._box(M.glow, 8.6, 0.05, 0.08, 0, 0.04, z);
          g.add(lip);
        }
        break;
      }
      case 'beam': {
        const beam = new THREE.Group();
        beam.name = 'beam';
        beam.add(this._box(M.steel, 9.6, 0.25, 0.7, 0, 0.75, 0));
        beam.add(this._box(M.steel, 9.6, 0.25, 0.7, 0, 0.12, 0));
        beam.add(this._box(M.hot, 9.6, 0.5, 0.18, 0, 0.44, 0));
        beam.add(createFlames([{ x: -3, y: 0.8, z: 0, w: 1.4, h: 1.8 }, { x: 1.5, y: 0.8, z: 0, w: 1.2, h: 1.5 }, { x: 3.8, y: 0.8, z: 0, w: 1.0, h: 1.2 }], M.flame));
        g.add(beam);
        // shadow marker where it will land
        const mark = this._box(this._keep(M.warnLane.clone()), 9.4, 0.01, 0.8, 0, 0.02, 0);
        mark.name = 'mark';
        g.add(mark);
        break;
      }
    }
    this.group.add(g);
    return g;
  }

  _acquire(kind) {
    const pool = this.pools.get(kind) ?? [];
    this.pools.set(kind, pool);
    const m = pool.pop() ?? this._makeMesh(kind);
    m.visible = true;
    return m;
  }

  _release(o) {
    if (!o.mesh) return;
    o.mesh.visible = false;
    o.mesh.traverse((c) => c.userData.actor && this.actors.delete(c.userData.actor));
    this.pools.get(o.kind)?.push(o.mesh);
    o.mesh = null;
  }

  // ---------------------------------------------------------------------------
  // Shards (instanced), orbs, fragments
  // ---------------------------------------------------------------------------
  _buildShards() {
    const geo = this._keep(new THREE.OctahedronGeometry(0.2, 0));
    const mat = this._keep(new THREE.MeshBasicMaterial({ color: this.accent.clone().multiplyScalar(3.2), toneMapped: false }));
    this.shardMesh = new THREE.InstancedMesh(geo, mat, 120);
    this.shardMesh.count = 0;
    this.shardMesh.frustumCulled = false;
    this.group.add(this.shardMesh);

    this.orbGeo = this._keep(new THREE.IcosahedronGeometry(0.42, 2));
    this.ringGeo = this._keep(new THREE.TorusGeometry(0.62, 0.04, 8, 40));
    this.orbMats = {
      time: this._keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.4, 4), toneMapped: false })),
      shadow: this._keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.6, 4), toneMapped: false })),
      fire: this._keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.4, 0.3), toneMapped: false })),
    };
    this.fragGeo = this._keep(new THREE.OctahedronGeometry(0.34, 0).scale(0.8, 1.5, 0.8));
    this.fragMat = this._keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.4, 2.2), toneMapped: false }));
    this.beamGeo = this._keep(new THREE.CylinderGeometry(0.25, 0.5, 14, 12, 1, true).translate(0, 7, 0));
    this.beamMat = this._keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.0, 0.6), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  }

  _orbMesh(type) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.orbGeo, this.orbMats[type]));
    const ring = new THREE.Mesh(this.ringGeo, this.orbMats[type]);
    ring.name = 'ring';
    g.add(ring);
    const ring2 = new THREE.Mesh(this.ringGeo, this.orbMats[type]);
    ring2.name = 'ring2';
    ring2.rotation.x = Math.PI / 2;
    g.add(ring2);
    this.group.add(g);
    return g;
  }

  _fragMesh() {
    const g = new THREE.Group();
    const c = new THREE.Mesh(this.fragGeo, this.fragMat);
    c.name = 'crystal';
    g.add(c);
    g.add(new THREE.Mesh(this.beamGeo, this.beamMat));
    this.group.add(g);
    return g;
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  /**
   * Spawn what came into view, release what fell behind, animate.
   * @param {number} heroZ
   * @param {number} dt         world dt
   * @param {number} hazardDt   dt for moving hazards (0 while ⏳ time is stopped)
   * @param {number} time       seconds (for spin/bob)
   */
  update(heroZ, dt, hazardDt, time) {
    const ahead = CONFIG.runner.viewDistance;
    for (const o of this.obstacles) {
      if (o.state.z > heroZ + ahead + 40) break;
      const end = o.state.z + (o.len ?? 1) + 6;
      const visible = !o.broken && end > heroZ - 12 && o.state.z < heroZ + ahead + (o.kind === 'oncoming' ? 60 : 0);
      if (visible && !o.mesh) this._show(o);
      else if (!visible && o.mesh && !o.dying) this._release(o);
      if (o.mesh) this._animate(o, heroZ, dt, hazardDt, time);
    }
    // shards
    let n = 0;
    for (const s of this.shards) {
      if (s.z > heroZ + ahead) break;
      if (s.taken || s.z < heroZ - 4 || n >= this.shardMesh.instanceMatrix.count) continue;
      tmpQ.setFromAxisAngle(tmpP.set(0, 1, 0), time * 3 + s.z);
      tmpM.compose(tmpP.set(LANES()[s.lane], s.y + Math.sin(time * 4 + s.z) * 0.08, s.z), tmpQ, tmpS.set(1, 1.4, 1));
      this.shardMesh.setMatrixAt(n++, tmpM);
    }
    this.shardMesh.count = n;
    this.shardMesh.instanceMatrix.needsUpdate = true;
    // orbs + fragments
    for (const o of this.orbs) {
      const near = !o.taken && o.z < heroZ + ahead && o.z > heroZ - 6;
      if (near && !o.mesh) {
        o.mesh = this._orbMesh(o.type);
        o.mesh.position.set(LANES()[o.lane], 1.2, o.z);
      }
      if (!near && o.mesh) {
        o.mesh.removeFromParent();
        o.mesh = null;
      }
      if (o.mesh) {
        o.mesh.position.y = 1.2 + Math.sin(time * 3 + o.z) * 0.15;
        o.mesh.getObjectByName('ring').rotation.set(time * 2, time * 1.3, 0);
        o.mesh.getObjectByName('ring2').rotation.set(Math.PI / 2 + time, 0, time * 2.2);
      }
    }
    for (const f of this.fragments) {
      const near = !f.taken && f.z < heroZ + ahead && f.z > heroZ - 6;
      if (near && !f.mesh) {
        f.mesh = this._fragMesh();
        f.mesh.position.set(LANES()[f.lane], 1.0, f.z);
      }
      if (!near && f.mesh) {
        f.mesh.removeFromParent();
        f.mesh = null;
      }
      if (f.mesh) {
        const c = f.mesh.getObjectByName('crystal');
        c.rotation.y = time * 2;
        c.position.y = 0.2 + Math.sin(time * 2.5) * 0.12;
      }
    }
    for (const a of this.actors) a.update(dt);
  }

  _show(o) {
    o.mesh = this._acquire(o.kind);
    const x = FULL.has(o.kind) ? 0 : LANES()[o.lane];
    o.mesh.position.set(x, 0, o.state.z);
    o.mesh.rotation.set(0, 0, 0);
    o.mesh.scale.set(1, 1, 1);
    const len = o.len ?? 1;
    o.mesh.children.forEach((c) => {
      if (c.name === 'stretch') {
        c.scale.z = len;
        c.position.z = len / 2;
      }
    });
    // squads animate while on screen
    o.mesh.traverse((c) => c.userData.actor && this.actors.add(c.userData.actor));
    const ice = o.mesh.getObjectByName('ice');
    if (ice) ice.visible = o.state.jammed;
    o.dying = 0;
  }

  _animate(o, heroZ, dt, hazardDt, time) {
    const m = o.mesh;
    const st = o.state;
    if (o.dying > 0) {
      // smashed: pieces fly up and away (simple tumble of the whole group)
      o.dying -= dt;
      m.position.y += o.vel.y * dt;
      m.position.z += o.vel.z * dt;
      o.vel.y -= 22 * dt;
      m.rotation.x += o.spin * dt;
      m.scale.multiplyScalar(1 - dt * 0.8);
      if (o.dying <= 0) {
        o.dying = 0;
        this._release(o);
      }
      return;
    }
    switch (o.kind) {
      case 'oncoming': {
        // ghost racers wake up 90 m out and drive at Kael
        if (!st.triggered && st.z - heroZ < 95) st.triggered = true;
        if (st.triggered && !st.jammed) st.z -= 16 * hazardDt;
        m.position.z = st.z;
        const warn = m.getObjectByName('warn');
        if (warn) warn.material.opacity = st.jammed ? 0 : 0.35 + Math.sin(time * 14) * 0.25;
        break;
      }
      case 'shutter': {
        // closes as Kael approaches — too fast to beat on foot
        if (!st.triggered && st.z - heroZ < 52) st.triggered = true;
        if (st.triggered && !st.jammed) st.p = Math.min(1, st.p + hazardDt / 1.0);
        const panel = m.getObjectByName('panel');
        const bottom = 6.2 * (1 - st.p);
        panel.position.y = bottom + 3;
        m.getObjectByName('ice').position.y = bottom + 3;
        break;
      }
      case 'beam': {
        if (!st.triggered && st.z - heroZ < 38) st.triggered = true;
        if (st.triggered && !st.jammed && st.p < 1) {
          st.p = Math.min(1, st.p + hazardDt / 0.55);
          if (st.p >= 1) st.landed = true;
        }
        const beam = m.getObjectByName('beam');
        beam.position.y = 9 * (1 - st.p * st.p);
        beam.rotation.z = (1 - st.p) * 0.18;
        m.getObjectByName('mark').visible = st.p < 1;
        break;
      }
      case 'laser': {
        const beams = m.getObjectByName('beams');
        beams.visible = Math.sin(time * 40 + st.z) > -0.85; // electric flicker
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Collision
  // ---------------------------------------------------------------------------
  /** Collision boxes of an obstacle, world space. */
  boxes(o, out = []) {
    out.length = 0;
    const st = o.state;
    const W = LANE_W / 2;
    const x = LANES()[o.lane];
    const len = o.len ?? 1;
    switch (o.kind) {
      case 'low': out.push({ x0: x - W, x1: x + W, y0: 0, y1: 0.95, z0: st.z, z1: st.z + 0.6 }); break;
      case 'high': out.push({ x0: x - W, x1: x + W, y0: 1.18, y1: 3.4, z0: st.z, z1: st.z + 0.4 }); break;
      case 'block': out.push({ x0: x - W, x1: x + W, y0: 0, y1: 3.2, z0: st.z, z1: st.z + len }); break;
      case 'oncoming': out.push({ x0: x - 1.0, x1: x + 1.0, y0: 0, y1: 1.2, z0: st.z - 2.3, z1: st.z + 2.3 }); break;
      case 'shutter': out.push({ x0: -4.6, x1: 4.6, y0: 6.2 * (1 - st.p), y1: 7.5, z0: st.z - 0.15, z1: st.z + 0.15 }); break;
      case 'laser': out.push({ x0: -4.6, x1: 4.6, y0: 0, y1: 3.6, z0: st.z - 0.1, z1: st.z + 0.1 }); break;
      case 'squad': out.push({ x0: -4.6, x1: 4.6, y0: 0, y1: 1.9, z0: st.z - 0.7, z1: st.z + 0.3 }); break;
      case 'firewall': out.push({ x0: -4.6, x1: 4.6, y0: 0, y1: 3.0, z0: st.z - 0.2, z1: st.z + 0.8 }); break;
      case 'beam': {
        const y = 9 * (1 - st.p * st.p);
        out.push({ x0: -4.8, x1: 4.8, y0: y, y1: y + 0.9, z0: st.z - 0.35, z1: st.z + 0.35 });
        break;
      }
      case 'gap': break; // handled as "no floor" (see overGap)
    }
    return out;
  }

  /** Is z over a rooftop gap? */
  overGap(z) {
    for (const o of this.obstacles) {
      if (o.kind !== 'gap' || o.broken) continue;
      if (o.z > z) break;
      if (z > o.z + 0.4 && z < o.z + (o.len ?? 1) - 0.4) return o;
    }
    return null;
  }

  /** Obstacles near z (for collision / prompts). */
  *near(z, back = 6, ahead = 6) {
    for (const o of this.obstacles) {
      if (o.state.z - 10 > z + ahead) {
        if (o.kind !== 'oncoming') break;
        if (o.state.z - 3 > z + ahead) continue;
      }
      if (o.broken) continue;
      if (o.state.z + (o.len ?? 1) + 3 < z - back) continue;
      yield o;
    }
  }

  /** Next unbroken gate that needs a power, within `range` metres. */
  nextGate(z, range = 90) {
    for (const o of this.obstacles) {
      if (o.state.z < z) continue;
      if (o.state.z > z + range) return null;
      if (!o.broken && GATE_NEEDS[o.kind] && !(o.kind === 'shutter' && o.state.jammed)) return o;
    }
    return null;
  }

  /** Smash an obstacle (🔥 burn) — it tumbles away in sparks. */
  smash(o, heroSpeed) {
    if (o.broken) return;
    o.broken = true;
    if (!o.mesh) return;
    o.dying = 0.9;
    o.vel = { y: 7 + Math.random() * 4, z: heroSpeed * 0.9 };
    o.spin = (Math.random() - 0.5) * 8;
    const p = o.mesh.position.clone();
    p.y = 1;
    this.particles.burst(p, 40, [4, 1.4, 0.3], { speed: 12, size: 0.16, life: 0.7 });
    this.particles.puff(p, 10, [0.12, 0.1, 0.09], { speed: 3, size: 1.2, life: 1.2 });
  }

  /** Make an obstacle harmless after a crash rewind (time "forgets" it). */
  dissolve(o) {
    o.broken = true;
    if (o.mesh) {
      const p = o.mesh.position.clone();
      p.y = 1;
      this.particles.burst(p, 30, [0.6, 1.4, 4], { speed: 6, size: 0.14, life: 0.8, gravity: 2 });
      this._release(o);
    }
  }

  /** ⏳ Time stop: freeze every moving hazard in range (they stay jammed). */
  jamMoving(z, range = 140) {
    let n = 0;
    for (const o of this.obstacles) {
      if (o.state.z > z + range) break;
      if (o.broken || o.state.jammed || o.state.z < z - 5) continue;
      if (!BEATS.time.has(o.kind)) continue;
      if (o.kind === 'beam' && (o.state.landed || o.state.p > 0.55)) continue; // too low to run under: jump it
      o.state.jammed = true;
      n += 1;
      const ice = o.mesh?.getObjectByName('ice');
      if (ice) ice.visible = true;
    }
    return n;
  }

  // --- ⏳ rewind ------------------------------------------------------------------------------------
  snapshot() {
    const s = [];
    for (const o of this.obstacles) {
      if (o.kind === 'oncoming' || o.kind === 'shutter' || o.kind === 'beam') s.push([o, o.state.z, o.state.p, o.state.triggered, o.state.landed]);
    }
    return s;
  }

  restore(s) {
    for (const [o, z, p, trig, landed] of s) {
      if (o.state.jammed) continue; // a frozen hazard stays frozen
      o.state.z = z;
      o.state.p = p;
      o.state.triggered = trig;
      o.state.landed = landed;
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.disposables.forEach((d) => d.dispose?.());
    this.actors.clear();
  }
}

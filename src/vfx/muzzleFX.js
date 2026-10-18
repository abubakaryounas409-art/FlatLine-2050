// =============================================================================
// FLATLINE: 2050 — vfx/muzzleFX.js
// Gunfire effects (CLAUDE.md Phase 6.3), all pooled so firing never allocates:
//
//   fx.flash(muzzle, dir)            star sprite + a short light spike
//   fx.tracer(from, to)              hot streak along the bullet path
//   fx.impact(point, normal, surface)  sparks (metal) · dust (concrete/brick)
//                                    · splinters (wood) · blood (flesh) + decal
//   fx.casing(pos, right, up)        brass shell, a real little physics body
//
// Particles are CPU-simulated THREE.Points (cheap, two draw calls) and use
// time-scaled dt, so slow motion slows the sparks too.
// =============================================================================

import * as THREE from 'three';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { glowTexture, smokeTexture } from './particleTextures.js';

const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// surface → particle look
const SURFACES = {
  metal:    { additive: 22, color: [1.0, 0.75, 0.35], speed: 6, size: 0.05, life: 0.35, gravity: -9, puffs: 2, decal: 'hole' },
  concrete: { additive: 6, color: [1.0, 0.8, 0.5], speed: 4, size: 0.04, life: 0.25, gravity: -9, puffs: 7, puffColor: [0.55, 0.53, 0.5], decal: 'hole' },
  brick:    { additive: 4, color: [1.0, 0.7, 0.45], speed: 4, size: 0.04, life: 0.25, gravity: -9, puffs: 8, puffColor: [0.5, 0.3, 0.24], decal: 'hole' },
  wood:     { additive: 2, color: [1.0, 0.7, 0.4], speed: 3, size: 0.04, life: 0.2, gravity: -9, puffs: 6, puffColor: [0.42, 0.32, 0.2], decal: 'hole' },
  flesh:    { additive: 0, puffs: 10, puffColor: [0.45, 0.02, 0.03], puffSpeed: 2.2, decal: null },
  glass:    { additive: 10, color: [0.8, 0.9, 1.0], speed: 5, size: 0.035, life: 0.4, gravity: -9.8, puffs: 2, puffColor: [0.7, 0.75, 0.8], decal: 'hole' },
};

/** Canvas textures: muzzle star, bullet hole. */
function starTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  ctx.translate(s / 2, s / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s / 2);
  g.addColorStop(0, 'rgba(255,250,220,1)');
  g.addColorStop(0.18, 'rgba(255,200,90,0.95)');
  g.addColorStop(0.5, 'rgba(255,120,30,0.25)');
  g.addColorStop(1, 'rgba(255,80,0,0)');
  ctx.fillStyle = g;
  for (let i = 0; i < 7; i++) {
    ctx.rotate((Math.PI * 2) / 7);
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(s * (0.32 + (i % 2) * 0.16), 0);
    ctx.lineTo(0, 5);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function holeTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.22, 'rgba(10,8,6,0.95)');
  g.addColorStop(0.4, 'rgba(40,34,28,0.55)');
  g.addColorStop(1, 'rgba(40,34,28,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // a few cracks
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.random();
    ctx.beginPath();
    ctx.moveTo(s / 2, s / 2);
    ctx.lineTo(s / 2 + Math.cos(a) * s * 0.42, s / 2 + Math.sin(a) * s * 0.42);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A pool of CPU-driven particles in one THREE.Points. */
class ParticlePool {
  constructor(scene, { count, texture, additive }) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);    // remaining
    this.maxLife = new Float32Array(count);
    this.grav = new Float32Array(count);
    this.baseSize = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: window.innerHeight / 2 } },
      vertexShader: `
        attribute float size; attribute vec3 color; varying vec3 vColor;
        uniform float scale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec3 vColor;
        void main() {
          vec4 t = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.rgb, t.a * ${additive ? '1.0' : '0.85'});
          if (gl_FragColor.a < 0.01) discard;
        }`,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(p, v, color, size, life, gravity = 0, grow = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.col.set(color, i * 3);
    this.baseSize[i] = size;
    this.size[i] = size;
    this.life[i] = this.maxLife[i] = life;
    this.grav[i] = gravity;
    this.grow[i] = grow;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const j = i * 3;
      this.vel[j + 1] += this.grav[i] * dt;
      const drag = Math.exp(-dt * 2.5);
      this.vel[j] *= drag;
      this.vel[j + 1] *= drag;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      this.size[i] = this.life[i] > 0 ? this.baseSize[i] * (k + this.grow[i] * (1 - k)) * Math.min(1, k * 4) : 0;
    }
    if (!any) return;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

export class CombatFX {
  constructor(scene) {
    this.scene = scene;
    this.disposables = [];
    const keep = (x) => (this.disposables.push(x), x);

    this.sparks = new ParticlePool(scene, { count: 360, texture: glowTexture(), additive: true });
    this.puffs = new ParticlePool(scene, { count: 220, texture: smokeTexture(), additive: false });

    // Muzzle flash
    this.flashSprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(starTexture()), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(2.2, 1.7, 1.1) })));
    this.flashSprite.visible = false;
    this.flashSprite.renderOrder = 6;
    scene.add(this.flashSprite);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    scene.add(this.flashLight);
    this._flashT = 0;

    // Tracers: unit-length capsules stretched along the shot
    const tracerGeo = keep(new THREE.CylinderGeometry(0.008, 0.008, 1, 5, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5));
    this.tracers = Array.from({ length: 16 }, () => {
      const m = new THREE.Mesh(tracerGeo, keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      m.visible = false;
      m.userData.t = 0;
      scene.add(m);
      return m;
    });
    this._tracer = 0;

    // Decals
    const decalGeo = keep(new THREE.PlaneGeometry(1, 1));
    const holeMat = keep(new THREE.MeshStandardMaterial({ map: keep(holeTexture()), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 }));
    this.decals = Array.from({ length: 80 }, () => {
      const m = new THREE.Mesh(decalGeo, holeMat);
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      return m;
    });
    this._decal = 0;

    // Shell casings
    this.casingGeo = keep(new THREE.CylinderGeometry(0.0055, 0.0055, 0.022, 6));
    this.casingMat = keep(new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 1, roughness: 0.3 }));
    this.casings = [];
    this._casing = 0;
  }

  flash(pos, dir, scale = 1) {
    this.flashSprite.position.copy(pos).addScaledVector(dir, 0.06 * scale);
    this.flashSprite.scale.setScalar((0.28 + Math.random() * 0.12) * scale);
    this.flashSprite.material.rotation = Math.random() * Math.PI;
    this.flashSprite.visible = true;
    this.flashLight.position.copy(pos);
    this.flashLight.intensity = 6 * scale;
    this._flashT = 0.05;
  }

  tracer(from, to, color) {
    const len = from.distanceTo(to);
    if (len < 0.5) return;
    const m = this.tracers[this._tracer];
    this._tracer = (this._tracer + 1) % this.tracers.length;
    // a streak (not the whole path) that flies along it over its short life
    m.userData.from = from.clone();
    m.userData.to = to.clone();
    m.userData.t = 0;
    m.userData.dur = Math.min(0.12, len / 420);
    m.userData.streak = Math.min(len * 0.5, 6);
    if (color) m.material.color.copy(color);
    m.material.opacity = 1;
    m.visible = true;
  }

  impact(point, normal, surface = 'concrete', { decal = true, incendiary = false } = {}) {
    const S = SURFACES[surface] ?? SURFACES.concrete;
    const n = normal.clone().normalize();
    // sparks
    const sparkCount = S.additive + (incendiary ? 14 : 0);
    for (let i = 0; i < sparkCount; i++) {
      const v = n.clone().multiplyScalar(0.6).add(tmp.randomDirection().multiplyScalar(0.8)).normalize().multiplyScalar(((S.speed ?? 4) + (incendiary ? 2 : 0)) * (0.4 + Math.random()));
      const c = incendiary ? [1.0, 0.45 + Math.random() * 0.3, 0.1] : S.color;
      this.sparks.emit(point, v, c, (S.size ?? 0.04) * (incendiary ? 1.6 : 1), (S.life ?? 0.3) * (0.5 + Math.random()) * (incendiary ? 2 : 1), S.gravity ?? -9);
    }
    // dust / blood puffs
    for (let i = 0; i < S.puffs; i++) {
      const v = n.clone().multiplyScalar((S.puffSpeed ?? 1.2) * (0.4 + Math.random())).add(tmp.randomDirection().multiplyScalar(0.35));
      const c = S.puffColor ?? [0.5, 0.5, 0.5];
      this.puffs.emit(point.clone().addScaledVector(n, 0.03), v, c, 0.09 + Math.random() * 0.08, 0.5 + Math.random() * 0.5, surface === 'flesh' ? -4 : 0.3, 3);
    }
    if (decal && S.decal) this._placeDecal(point, n, incendiary);
  }

  _placeDecal(point, n, scorched) {
    const d = this.decals[this._decal];
    this._decal = (this._decal + 1) % this.decals.length;
    d.position.copy(point).addScaledVector(n, 0.004);
    tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    d.quaternion.copy(tmpQ);
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(scorched ? 0.22 : 0.07 + Math.random() * 0.03);
    d.visible = true;
  }

  /** Eject a casing from `pos`, to the gun's right and up. */
  casing(pos, right, up) {
    const R = physics.RAPIER;
    if (!physics.world) return;
    let c = this.casings[this._casing];
    if (!c || c.generation !== physics.generation) {
      const mesh = c?.mesh ?? new THREE.Mesh(this.casingGeo, this.casingMat);
      mesh.castShadow = false;
      this.scene.add(mesh);
      const body = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(0.3).setAngularDamping(0.6));
      physics.world.createCollider(R.ColliderDesc.cylinder(0.011, 0.0055).setDensity(8000).setRestitution(0.35).setFriction(0.6), body);
      physics.link(body, mesh);
      c = { mesh, body, generation: physics.generation };
      this.casings[this._casing] = c;
    }
    this._casing = (this._casing + 1) % 18;
    const v = right.clone().multiplyScalar(1.6 + Math.random() * 0.8).addScaledVector(up, 1.4 + Math.random()).addScaledVector(tmp.randomDirection(), 0.3);
    c.body.setTranslation(pos, true);
    c.body.setLinvel(v, true);
    c.body.setAngvel({ x: Math.random() * 30 - 15, y: Math.random() * 30 - 15, z: Math.random() * 30 - 15 }, true);
    c.mesh.visible = true;
    const at = pos.clone();
    setTimeout(() => audio.sfxAt?.('shell_casing', at, { volume: 0.25, rate: 0.9 + Math.random() * 0.3 }), 380 + Math.random() * 200);
  }

  update(dt) {
    this.sparks.update(dt);
    this.puffs.update(dt);
    if (this._flashT > 0) {
      this._flashT -= dt;
      this.flashLight.intensity *= 0.55;
      if (this._flashT <= 0) {
        this.flashSprite.visible = false;
        this.flashLight.intensity = 0;
      }
    }
    for (const m of this.tracers) {
      if (!m.visible) continue;
      const u = m.userData;
      u.t += dt;
      const k = Math.min(1, u.t / u.dur);
      const len = u.from.distanceTo(u.to);
      const head = Math.min(len, k * len + u.streak * 0.5);
      const tail = Math.max(0, head - u.streak);
      const dir = tmp.subVectors(u.to, u.from).normalize();
      m.position.copy(u.from).addScaledVector(dir, tail);
      m.lookAt(u.to);
      m.scale.set(1, 1, Math.max(0.01, head - tail));
      m.material.opacity = 1 - k * 0.6;
      if (k >= 1) m.visible = false;
    }
  }

  dispose() {
    this.sparks.dispose();
    this.puffs.dispose();
    [this.flashSprite, this.flashLight, ...this.tracers, ...this.decals].forEach((o) => o.removeFromParent());
    for (const c of this.casings) {
      if (!c) continue;
      physics.unlink(c.mesh);
      c.mesh.removeFromParent();
      if (c.generation === physics.generation) physics.world.removeRigidBody(c.body);
    }
    this.disposables.forEach((d) => d.dispose?.());
  }
}

export { SURFACES, UP, ParticlePool };

// =============================================================================
// FLATLINE: 2050 — runner/runnerFX.js
// Shared effects for THE RUN:
//   FlameField   GPU flames: camera-facing quads with an animated noise shader
//                (instanced, additive, bloom). Flames FREEZE when time stops.
//   RunnerParticles   embers / dust / sparks / smoke (CPU pools, two draw calls)
//   canvasTexture()   small helper for procedural textures (floors, screens)
// =============================================================================

import * as THREE from 'three';
import { ParticlePool } from '../vfx/muzzleFX.js';
import { glowTexture, smokeTexture } from '../vfx/particleTextures.js';

/** One shared clock for every flame (paused while ⏳ time is stopped). */
export const flameClock = { value: 0 };

const flameVertex = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  void main() {
    vUv = uv;
    vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float sx = length(instanceMatrix[0].xyz);
    float sy = length(instanceMatrix[1].xyz);
    vec4 mv = modelViewMatrix * vec4(center, 1.0);
    // camera-facing quad, bottom at the instance origin
    mv.xy += vec2(position.x * sx, position.y * sy);
    gl_Position = projectionMatrix * mv;
    vSeed = fract(center.x * 1.37 + center.z * 0.711 + center.y * 0.3);
  }`;

const flameFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vSeed;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }
  void main() {
    vec2 uv = vUv;
    float t = uTime * 1.7 + vSeed * 13.0;
    float n = fbm(vec2(uv.x * 3.2 + vSeed * 7.0, uv.y * 2.4 - t));
    float x = (uv.x - 0.5) * 2.0;
    float body = 1.0 - abs(x) * (1.15 + uv.y * 1.6);
    float h = body - uv.y * 0.9 + (n - 0.5) * 1.1 + 0.18;
    float f = smoothstep(0.0, 0.3, h);
    if (f <= 0.001) discard;
    vec3 col = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.55, 0.1), smoothstep(0.05, 0.45, h));
    col = mix(col, vec3(1.0, 0.92, 0.7), smoothstep(0.45, 0.95, h));
    col *= uTint;
    gl_FragColor = vec4(col * f * uIntensity * (1.0 - uv.y * 0.35), 1.0);
  }`;

let sharedFlameGeo = null;

/** A material for flames (one per tint/intensity). */
export function flameMaterial({ intensity = 2.2, tint = 0xffffff } = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: flameClock, uIntensity: { value: intensity }, uTint: { value: new THREE.Color(tint) } },
    vertexShader: flameVertex,
    fragmentShader: flameFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return m;
}

/**
 * Instanced flames. `spots` = [{ x, y, z, w, h }] in the parent's space.
 * Returns an InstancedMesh you add to a group.
 */
export function createFlames(spots, material = flameMaterial()) {
  sharedFlameGeo ??= new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(sharedFlameGeo, material, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  spots.forEach((s, i) => {
    m.makeScale(s.w, s.h, 1).setPosition(s.x, s.y ?? 0, s.z);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = spots.length;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}

// -----------------------------------------------------------------------------
// Particles
// -----------------------------------------------------------------------------
const v = new THREE.Vector3();
const p = new THREE.Vector3();

export class RunnerParticles {
  constructor(scene) {
    this.glow = new ParticlePool(scene, { count: 700, texture: glowTexture(), additive: true });
    this.smoke = new ParticlePool(scene, { count: 260, texture: smokeTexture(), additive: false });
  }

  /** A burst of glowing sparks. color = [r,g,b] (HDR ok). */
  burst(pos, count, color, { speed = 6, size = 0.12, life = 0.6, gravity = -9, up = 0.6 } = {}) {
    for (let i = 0; i < count; i++) {
      v.randomDirection();
      v.y = Math.abs(v.y) * up + v.y * (1 - up);
      v.multiplyScalar(speed * (0.35 + Math.random() * 0.8));
      this.glow.emit(pos, v, color, size * (0.6 + Math.random() * 0.8), life * (0.5 + Math.random()), gravity);
    }
  }

  puff(pos, count, color, { speed = 1.5, size = 0.6, life = 0.8, grow = 2.5, gravity = 0.4 } = {}) {
    for (let i = 0; i < count; i++) {
      v.randomDirection().multiplyScalar(speed * (0.3 + Math.random()));
      v.y = Math.abs(v.y);
      p.copy(pos).addScaledVector(v, 0.1);
      this.smoke.emit(p, v, color, size * (0.7 + Math.random() * 0.6), life * (0.6 + Math.random() * 0.6), gravity, grow);
    }
  }

  /** One ambient mote (embers rising, holo dust drifting…). */
  mote(pos, vel, color, size, life, gravity = 0) {
    this.glow.emit(pos, vel, color, size, life, gravity);
  }

  update(dt) {
    this.glow.update(dt);
    this.smoke.update(dt);
  }

  dispose() {
    this.glow.dispose();
    this.smoke.dispose();
  }
}

// -----------------------------------------------------------------------------
// Canvas textures
// -----------------------------------------------------------------------------
export function canvasTexture(w, h, draw, { repeat = null, srgb = true, anisotropy = 8 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = anisotropy;
  return t;
}

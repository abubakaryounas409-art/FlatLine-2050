// =============================================================================
// FLATLINE: 2050 — vfx/ambientLife.js
// Ambient world life: the small moving things that make a level feel alive.
// Pure decoration — nothing here touches gameplay, physics bodies or lights
// (performance rule: never add a light mid-game; this file never adds one).
//
//   const life = new AmbientLife(scene, { rain });       // one per world
//   life.dust({ center, size }); life.steam({ points }); life.birds({ perches }) …
//   life.update(dt, { camera, realDt, rewinding, player })   every frame
//   life.setQuality('low' | 'medium' | 'high')          from applyGraphics
//   life.noise(position)                                a gunshot: birds scatter
//   life.dispose()
//
// How it stays cheap:
//   • Most layers are ONE draw call of shader-animated points / instances whose
//     motion is a pure function of time (no per-particle CPU work at all).
//   • Every layer allocates its High-quality count; Medium / Low just draw
//     fewer (drawRange / instance count), so switching quality is free.
//   • Ambient time follows timeScale (slow-mo slows it, pause freezes it) and
//     runs BACKWARDS during ⏳ rewind — stateless layers simply replay in reverse.
//     `reverse: true` makes a whole world run backwards (Mission 7).
//
// Stadium (2050) layers live in vfx/ambientStadium.js, club layers in
// vfx/ambientClub.js; both build on the helpers exported here.
// =============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { physics } from '../core/physics.js';
import { glowTexture, smokeTexture } from './particleTextures.js';

const QUALITY_RANK = { low: 0, medium: 1, high: 2 };
const UP = new THREE.Vector3(0, 1, 0);

/** Small GLSL helpers shared by every ambient shader. */
export const AMBIENT_GLSL = /* glsl */ `
  float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  vec3 h31(float p) {
    vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xxy + p3.yzz) * p3.zyx);
  }
  float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  uniform float uFogDensity;
  uniform float uFogNear;
  uniform float uFogFar;
  float ambientFog(float d) {
    if (uFogDensity > 0.0) { float f = uFogDensity * d; return 1.0 - exp(-f * f); }
    if (uFogFar > 0.0) return smoothstep(uFogNear, uFogFar, d);
    return 0.0;
  }
`;

/** Deterministic random (so a level looks the same every time it loads). */
export function seeded(seed = 1) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

export class AmbientLife {
  /**
   * @param {THREE.Scene} scene
   * @param {object} [o]
   * @param {THREE.Object3D} [o.parent]   where layers are added (default: the scene)
   * @param {string} [o.quality]          'low' | 'medium' | 'high' (default: game.quality)
   * @param {boolean} [o.reverse]         the whole world runs backwards (Mission 7)
   * @param {object} [o.rain]             the level's Rain (vfx/rainFX.js), for lightning
   */
  constructor(scene, { parent = scene, quality = game.quality, reverse = false, rain = null } = {}) {
    this.scene = scene;
    this.parent = parent;
    this.rain = rain;
    this.direction = reverse ? -1 : 1;
    this.layers = [];
    this.time = 0;
    this.master = 1;               // global brightness (the garage powers on)
    this.listeners = [];           // noise listeners (birds)
    this.camera = null;
    this.player = null;
    this.exclude = null;           // () => collider the ground rays ignore (Kael's capsule)
    this.uniforms = {
      uTime: { value: 0 },
      uMaster: { value: 1 },
      uViewH: { value: 720 },
      uFogDensity: { value: 0 },
      uFogNear: { value: 0 },
      uFogFar: { value: 0 },
      uFogColor: { value: new THREE.Color() },
      uFlash: { value: 0 },        // lightning brightness 0…1
    };
    this.rng = seeded(20202050);
    this.setQuality(quality);
  }

  /** Count for the current quality (layers allocate the High count). */
  scaled(count) {
    return Math.max(1, Math.round(count * this.density));
  }

  setQuality(name) {
    this.quality = CONFIG.graphics.presets[name] ? name : 'high';
    this.density = CONFIG.ambient.density[this.quality] ?? 1;
    for (const l of this.layers) this._applyQuality(l);
  }

  _applyQuality(l) {
    const rank = QUALITY_RANK[this.quality];
    const on = rank >= QUALITY_RANK[l.minQuality ?? 'low'];
    if (l.object) l.object.visible = on && l.visible !== false;
    l.enabled = on;
    if (l.max != null && l.setCount) l.setCount(on ? Math.max(1, Math.round(l.max * (l.fixed ? 1 : this.density))) : 0);
  }

  /**
   * Register a layer: { object?, update?(dt, t, life), dispose?(), max?, setCount?(n), minQuality?, fixed? }
   * `object` is added to the parent (or `parent` option) and removed on dispose.
   */
  add(layer, parent = this.parent) {
    if (layer.object && !layer.object.parent) parent.add(layer.object);
    this.layers.push(layer);
    this._applyQuality(layer);
    return layer;
  }

  /** Shared + per-layer uniforms (shared ones are the same objects, so one write updates every material). */
  shaderUniforms(extra = {}) {
    return { ...this.uniforms, uFogK: { value: 1 }, ...extra };
  }

  /** A gunshot / explosion at `position`: birds take off. */
  noise(position, radius = CONFIG.ambient.city.birdHearShot) {
    this.listeners.forEach((fn) => fn(position, radius));
  }

  /**
   * @param {number} dt         time-scaled seconds
   * @param {object} o
   * @param {THREE.Camera} o.camera   the camera on screen (cutscene camera included)
   * @param {number} [o.realDt]
   * @param {boolean} [o.rewinding]   ⏳ play ambient motion backwards
   * @param {THREE.Vector3} [o.player]
   */
  update(dt, { camera, realDt = dt, rewinding = false, player = null } = {}) {
    const step = rewinding ? -realDt * CONFIG.ambient.rewindSpeed : dt * this.direction;
    this.time += step;
    this.camera = camera;
    this.player = player;
    const u = this.uniforms;
    u.uTime.value = this.time;
    u.uMaster.value = this.master;
    u.uViewH.value = game.renderer ? game.renderer.domElement.height : innerHeight;
    const fog = this.scene.fog;
    if (fog?.isFogExp2) {
      u.uFogDensity.value = fog.density;
      u.uFogFar.value = 0;
    } else if (fog?.isFog) {
      u.uFogDensity.value = 0;
      u.uFogNear.value = fog.near;
      u.uFogFar.value = fog.far;
    } else u.uFogDensity.value = u.uFogFar.value = 0;
    if (fog) u.uFogColor.value.copy(fog.color);
    u.uFlash.value = this.rain?.flash ? Math.min(1, this.rain.flash.intensity / 3.5) : 0;
    for (const l of this.layers) if (l.enabled && l.update) l.update(step, this.time, this);
  }

  dispose() {
    for (const l of this.layers) {
      l.dispose?.();
      if (l.object) {
        l.object.removeFromParent();
        l.object.traverse((o) => {
          o.geometry?.dispose();
          [].concat(o.material ?? []).forEach((m) => m.dispose());
        });
      }
    }
    this.layers = [];
    this.listeners = [];
  }

  // ===========================================================================
  // Generic building block: shader-animated points
  // ===========================================================================
  /**
   * @param {object} o
   * @param {number} o.count                 High-quality count (allocated)
   * @param {Function} o.fill                (i, set) — set(name, ...values) per point; 'position' + 'aSeed' (vec4) always exist
   * @param {object} [o.attributes]          extra attributes { name: itemSize }
   * @param {string} o.body                  GLSL: sets p (vec3), size (metres), vAlpha, vColor
   * @param {object} [o.uniforms]
   * @param {string} [o.uniformDecl]         GLSL uniform declarations
   * @param {THREE.Texture} [o.map]
   * @param {boolean} [o.additive]
   * @param {number} [o.fogK]                fog distance multiplier (0.2 = sees much further)
   * @param {THREE.Sphere} [o.bounds]        for frustum culling (null = never culled)
   */
  points({ count, fill, attributes = {}, body, uniforms = {}, uniformDecl = '', map = glowTexture(), additive = true, fogK = 1, bounds = null, renderOrder = 2, minQuality, fixed = false, minPixel = 1.5 }) {
    const geo = new THREE.BufferGeometry();
    const attrs = { position: 3, aSeed: 4, ...attributes };
    const arrays = {};
    for (const [name, size] of Object.entries(attrs)) arrays[name] = new Float32Array(count * size);
    const rnd = this.rng;
    for (let i = 0; i < count; i++) {
      arrays.aSeed.set([rnd(), rnd(), rnd(), rnd()], i * 4);
      fill(i, (name, ...v) => arrays[name].set(v, i * attrs[name]), rnd);
    }
    for (const [name, size] of Object.entries(attrs)) geo.setAttribute(name, new THREE.BufferAttribute(arrays[name], size));
    if (bounds) geo.boundingSphere = bounds;
    const decl = Object.entries(attributes).map(([n, s]) => `attribute ${s === 1 ? 'float' : `vec${s}`} ${n};`).join('\n');
    const mat = new THREE.ShaderMaterial({
      uniforms: this.shaderUniforms({ uMap: { value: map }, ...uniforms }),
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uViewH;
        uniform float uFogK;
        uniform float uMaster;
        uniform float uFlash;
        ${uniformDecl}
        attribute vec4 aSeed;
        ${decl}
        varying float vAlpha;
        varying vec3 vColor;
        varying float vFog;
        ${AMBIENT_GLSL}
        void main() {
          vec3 p = position;
          float size = 0.1;
          vAlpha = 1.0;
          vColor = vec3(1.0);
          ${body}
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float px = size * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.05);
          // sub-pixel points fade instead of shimmering
          if (px < ${minPixel.toFixed(2)}) { vAlpha *= px / ${minPixel.toFixed(2)}; px = ${minPixel.toFixed(2)}; }
          gl_PointSize = vAlpha <= 0.001 ? 0.0 : min(px, 256.0);
          vFog = ambientFog(length(mv.xyz) * uFogK);
          vAlpha *= uMaster;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uFogColor;
        varying float vAlpha;
        varying vec3 vColor;
        varying float vFog;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          if (a < 0.003) discard;
          ${additive ? 'gl_FragColor = vec4(vColor, a * (1.0 - vFog));' : 'gl_FragColor = vec4(mix(vColor, uFogColor, vFog), a);'}
        }`,
    });
    mat.uniforms.uFogK.value = fogK;
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = !!bounds;
    pts.renderOrder = renderOrder;
    return this.add({
      object: pts,
      max: count,
      fixed,
      minQuality,
      setCount: (n) => geo.setDrawRange(0, n),
      material: mat,
    });
  }

  // ===========================================================================
  // Particles: dust, embers, ash, drips, steam / smoke, sparks
  // ===========================================================================

  /** Floating dust motes in a box (light beams, the garage, the club). */
  dust({ center, size, count = 400, color = 0xc8d4ff, brightness = 0.6, pointSize = 0.03, speed = 1, rise = 0 } = {}) {
    const c = new THREE.Vector3(...center);
    const s = new THREE.Vector3(...size);
    return this.points({
      count,
      fill: () => {},
      bounds: new THREE.Sphere(c, s.length() / 2),
      uniforms: { uCenter: { value: c }, uSize: { value: s }, uColor: { value: new THREE.Color(color).multiplyScalar(brightness) }, uPt: { value: pointSize }, uSpeed: { value: speed }, uRise: { value: rise } },
      uniformDecl: 'uniform vec3 uCenter; uniform vec3 uSize; uniform vec3 uColor; uniform float uPt; uniform float uSpeed; uniform float uRise;',
      body: /* glsl */ `
        float t = uTime * uSpeed;
        vec3 q = aSeed.xyz + vec3(sin(t * 0.21 + aSeed.w * 40.0), sin(t * 0.17 + aSeed.x * 30.0) * 0.6, cos(t * 0.19 + aSeed.y * 50.0)) * 0.025
               + vec3(0.004, 0.003 + uRise * 0.01, -0.003) * t;
        q = fract(q);
        p = uCenter + (q - 0.5) * uSize;
        vec3 e = smoothstep(0.0, 0.1, q) * smoothstep(1.0, 0.9, q);
        vAlpha = e.x * e.y * e.z * (0.45 + 0.55 * sin(uTime * 1.3 + aSeed.w * 60.0));
        size = uPt * (0.5 + aSeed.w);
        vColor = uColor;`,
    });
  }

  /** Glowing embers rising (and swirling) out of a box. */
  embers({ center, size, count = CONFIG.ambient.factory.embers, rise = 1, wind = [0.6, 0, 0.2], brightness = 1, pointSize = 0.05 } = {}) {
    const c = new THREE.Vector3(...center);
    const s = new THREE.Vector3(...size);
    return this.points({
      count,
      fill: () => {},
      bounds: new THREE.Sphere(c, s.length()),
      uniforms: { uCenter: { value: c }, uSize: { value: s }, uWind: { value: new THREE.Vector3(...wind) }, uRiseK: { value: rise }, uBright: { value: brightness }, uPt: { value: pointSize } },
      uniformDecl: 'uniform vec3 uCenter; uniform vec3 uSize; uniform vec3 uWind; uniform float uRiseK; uniform float uBright; uniform float uPt;',
      body: /* glsl */ `
        float life = (4.0 + aSeed.w * 4.0) / uRiseK;
        float c = uTime / life + aSeed.x * 7.0;
        float age = fract(c);
        vec3 r = h31(floor(c) * 13.1 + aSeed.y * 997.0);
        vec3 b = uCenter + vec3(r.x - 0.5, -0.5, r.z - 0.5) * uSize;
        float tt = age * life;
        p = b + vec3(sin(tt * 1.7 + r.y * 20.0) * 0.6, age * uSize.y, cos(tt * 1.3 + r.x * 20.0) * 0.6) + uWind * tt;
        vAlpha = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.55, 1.0, age)) * (0.55 + 0.45 * sin(uTime * 17.0 + aSeed.z * 50.0));
        size = uPt * (0.5 + aSeed.w);
        vColor = mix(vec3(4.0, 1.5, 0.35), vec3(2.2, 0.35, 0.05), age) * uBright;`,
    });
  }

  /** Grey ash flakes drifting down (tumbling = flickering). */
  ash({ center, size, count = CONFIG.ambient.factory.ash, color = 0x8a8580, fall = 0.6, wind = [0.3, 0, 0.15], pointSize = 0.045, glow = 0.12 } = {}) {
    const c = new THREE.Vector3(...center);
    const s = new THREE.Vector3(...size);
    return this.points({
      count,
      fill: () => {},
      additive: false,
      bounds: new THREE.Sphere(c, s.length()),
      uniforms: { uCenter: { value: c }, uSize: { value: s }, uWind: { value: new THREE.Vector3(...wind) }, uFall: { value: fall }, uColor: { value: new THREE.Color(color) }, uPt: { value: pointSize }, uGlow: { value: glow } },
      uniformDecl: 'uniform vec3 uCenter; uniform vec3 uSize; uniform vec3 uWind; uniform float uFall; uniform vec3 uColor; uniform float uPt; uniform float uGlow;',
      body: /* glsl */ `
        float life = uSize.y / (uFall * (0.6 + aSeed.w * 0.8));
        float c = uTime / life + aSeed.x * 5.0;
        float age = fract(c);
        vec3 r = h31(floor(c) * 7.7 + aSeed.y * 613.0);
        float tt = age * life;
        p = uCenter + vec3(r.x - 0.5, 0.5, r.z - 0.5) * uSize
          + vec3(sin(tt * 0.9 + r.y * 9.0) * 0.5, -age * uSize.y, cos(tt * 0.7 + r.x * 9.0) * 0.5) + uWind * tt;
        float flip = abs(sin(uTime * (2.0 + aSeed.z * 3.0) + aSeed.w * 30.0));
        vAlpha = smoothstep(0.0, 0.06, age) * smoothstep(1.0, 0.9, age) * (0.25 + 0.75 * flip) * 0.85;
        size = uPt * (0.6 + aSeed.z * 0.8);
        // a few still glow at the edge
        vColor = uColor * (0.6 + 0.4 * flip) + vec3(1.6, 0.5, 0.1) * step(0.93, aSeed.y) * uGlow * 8.0;`,
      map: smokeTexture(),
    });
  }

  /**
   * Water drops gathering on edges and falling.
   * @param {Array} edges  [[ax, ay, az, bx, by, bz, dropLength], …]
   */
  drips({ edges, count = 160, color = 0xbcd2ff, brightness = 0.9 } = {}) {
    const box = new THREE.Box3();
    edges.forEach(([ax, ay, az, bx, by, bz, len]) => box.expandByPoint(new THREE.Vector3(ax, ay, az)).expandByPoint(new THREE.Vector3(bx, by - len, bz)));
    return this.points({
      count,
      fill: (i, set, rnd) => {
        const e = edges[i % edges.length];
        const t = rnd();
        set('position', e[0] + (e[3] - e[0]) * t, e[1] + (e[4] - e[1]) * t, e[2] + (e[5] - e[2]) * t);
        set('aDrop', e[6]);
      },
      attributes: { aDrop: 1 },
      bounds: box.getBoundingSphere(new THREE.Sphere()),
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(brightness) } },
      uniformDecl: 'uniform vec3 uColor;',
      body: /* glsl */ `
        float period = 1.4 + aSeed.y * 3.0;
        float age = fract(uTime / period + aSeed.x * 10.0) * period;
        float hold = period * 0.6;
        float tf = max(age - hold, 0.0);
        float fall = 4.9 * tf * tf;
        p = position - vec3(0.0, min(fall, aDrop), 0.0);
        vAlpha = (fall < aDrop ? 1.0 : 0.0) * (age < hold ? smoothstep(0.0, hold, age) * 0.6 : 1.0);
        size = 0.03 + 0.015 * aSeed.z;
        vColor = uColor * (age < hold ? 0.6 : 1.0);`,
    });
  }

  /**
   * Rising plumes: steam from vents / manholes (light) or smoke columns (dark).
   * @param {Array} points  [[x, y, z], …]
   */
  steam({ points, perPoint = 40, color = 0x9aa4b4, opacity = 0.18, height = 3.5, spread = 1.2, life = 4, puff = 0.9, wind = [0.25, 0, 0.1], fogK = 1, additive = false, minQuality } = {}) {
    const count = points.length * perPoint;
    const box = new THREE.Box3();
    points.forEach((p) => box.expandByPoint(new THREE.Vector3(...p)).expandByPoint(new THREE.Vector3(p[0], p[1] + height, p[2])));
    box.expandByScalar(spread * 2 + puff * 2);
    return this.points({
      count,
      fill: (i, set) => set('position', ...points[Math.floor(i / perPoint)]),
      additive,
      fogK,
      minQuality,
      map: smokeTexture(),
      bounds: box.getBoundingSphere(new THREE.Sphere()),
      uniforms: {
        uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uHeight: { value: height }, uSpread: { value: spread },
        uLife: { value: life }, uPuff: { value: puff }, uWind: { value: new THREE.Vector3(...wind) },
      },
      uniformDecl: 'uniform vec3 uColor; uniform float uOpacity; uniform float uHeight; uniform float uSpread; uniform float uLife; uniform float uPuff; uniform vec3 uWind;',
      body: /* glsl */ `
        float life = uLife * (0.7 + 0.6 * aSeed.x);
        float c = uTime / life + aSeed.y * 10.0;
        float age = fract(c);
        vec3 r = h31(floor(c) * 7.3 + aSeed.z * 500.0);
        float tt = age * life;
        p = position + vec3(0.0, age * uHeight, 0.0)
          + vec3(r.x - 0.5, 0.0, r.z - 0.5) * uSpread * age
          + vec3(sin(tt * 1.3 + r.y * 6.0), 0.0, cos(tt * 1.1 + r.x * 6.0)) * 0.2 * age * uSpread
          + uWind * tt * age;
        size = uPuff * (0.35 + age * 1.8);
        vAlpha = uOpacity * smoothstep(0.0, 0.12, age) * (1.0 - age) * (0.7 + 0.3 * aSeed.w);
        // dark smoke picks up the fire glow underneath
        vColor = uColor * (1.0 + uFlash * 1.5);`,
    });
  }

  /** Big dark smoke columns (burning buildings), lit orange at the base. */
  smokeColumns({ points, height = 40, spread = 10, puff = 9, life = 14, color = 0x1c1714, glow = 0x5a2408, opacity = 0.5, perPoint = 46, fogK = 0.35 } = {}) {
    const layer = this.steam({ points, perPoint, color, opacity, height, spread, life, puff, wind: [0.5, 0, 0.25], fogK });
    // fire-lit underside: blend the colour toward the glow near the bottom
    const m = layer.material;
    m.uniforms.uGlow = { value: new THREE.Color(glow) };
    m.vertexShader = m.vertexShader.replace('uniform vec3 uColor;', 'uniform vec3 uColor; uniform vec3 uGlow;')
      .replace('vColor = uColor * (1.0 + uFlash * 1.5);', 'vColor = mix(uGlow * 1.6, uColor, smoothstep(0.0, 0.35, age));');
    return layer;
  }

  /**
   * Electrical sparks: random bursts from points (broken cables, junction boxes).
   * @param {Array} points  [[x, y, z], …]
   */
  sparks({ points, perPoint = 28, interval = 2.6, floor = 0, color = [5, 3.2, 1.4] } = {}) {
    const count = points.length * perPoint;
    const box = new THREE.Box3();
    points.forEach((p) => box.expandByPoint(new THREE.Vector3(...p)));
    box.expandByScalar(4);
    return this.points({
      count,
      fixed: true, // few particles, and a burst needs all of them
      fill: (i, set, rnd) => {
        const src = Math.floor(i / perPoint);
        set('position', ...points[src]);
        set('aSrc', src * 17.13 + 3.1, i % perPoint === 0 ? 1 : 0);
        void rnd;
      },
      attributes: { aSrc: 2 },
      bounds: box.getBoundingSphere(new THREE.Sphere()),
      uniforms: { uInterval: { value: interval }, uFloor: { value: floor }, uColor: { value: new THREE.Vector3(...color) } },
      uniformDecl: 'uniform float uInterval; uniform float uFloor; uniform vec3 uColor;',
      body: /* glsl */ `
        float iv = uInterval * (0.6 + h11(aSrc.x) * 0.8);
        float c = uTime / iv + h11(aSrc.x * 3.3) * 13.0;
        float cyc = floor(c);
        float age = fract(c) * iv;
        float on = step(0.4, h11(cyc * 3.7 + aSrc.x * 91.0));
        if (aSrc.y > 0.5) {
          // the arc flash itself
          p = position;
          size = 0.5 + 0.3 * h11(cyc);
          vAlpha = on * (1.0 - smoothstep(0.0, 0.14, age)) * (0.6 + 0.4 * sin(uTime * 90.0));
          vColor = vec3(2.5, 3.2, 5.0);
        } else {
          vec3 r = h31(cyc * 11.0 + aSeed.x * 517.0);
          vec3 v = normalize(vec3(r.x - 0.5, r.y * 0.5 - 0.1, r.z - 0.5)) * (1.5 + r.y * 3.5);
          float life = 0.45 + r.z * 0.6;
          float tt = min(age, life);
          p = position + v * tt + vec3(0.0, -4.9 * tt * tt, 0.0);
          p.y = max(p.y, uFloor + 0.02);
          size = 0.035 + 0.02 * r.x;
          vAlpha = on * step(age, life) * (1.0 - age / life);
          vColor = uColor * (1.2 - age / life * 0.6);
        }`,
    });
  }

  // ===========================================================================
  // Distant life: skyline, traffic, beacons, lightning, helicopter
  // ===========================================================================

  /**
   * A ring of far buildings with lit windows (some switch on and off).
   * Has its own, much thinner haze, so it reads through the level fog.
   */
  skyline({ center = [0, 0, 0], radius = [120, 260], count = 90, height = [20, 90], width = [14, 34], clear = null, tint = 0xffc78a, cool = 0x9cc8ff, litRatio = 0.32, fogK = 0.22, beacons = true, glow = 1 } = {}) {
    const rnd = seeded(77 + count);
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.shaderUniforms({ uTint: { value: new THREE.Color(tint) }, uCool: { value: new THREE.Color(cool) }, uLit: { value: litRatio }, uGlow: { value: glow } }),
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        varying vec3 vWorld;
        varying vec3 vN;
        varying vec4 vSeed;
        varying float vDist;
        varying float vH;
        void main() {
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vSeed = aSeed;
          vH = position.y;
          vec4 mv = viewMatrix * w;
          vDist = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uFogK;
        uniform vec3 uFogColor;
        uniform vec3 uTint;
        uniform vec3 uCool;
        uniform float uLit;
        uniform float uGlow;
        uniform float uFlash;
        uniform float uMaster;
        varying vec3 vWorld;
        varying vec3 vN;
        varying vec4 vSeed;
        varying float vDist;
        varying float vH;
        ${AMBIENT_GLSL}
        void main() {
          vec3 col = vec3(0.012, 0.014, 0.02) * (0.6 + 0.4 * vH);
          if (abs(vN.y) < 0.5) {
            float u = abs(vN.x) > 0.5 ? vWorld.z : vWorld.x;
            vec2 cell = vec2(floor(u / 2.6), floor(vWorld.y / 3.4));
            vec2 f = vec2(fract(u / 2.6), fract(vWorld.y / 3.4));
            float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.78);
            float seed = vSeed.x * 311.0 + cell.x * 7.0 + cell.y * 131.0 + (vN.x + vN.z * 2.0) * 17.0;
            // windows switch on/off every so often
            float slot = floor(uTime / (25.0 + 40.0 * h11(seed)) + h11(seed * 1.7));
            float lit = step(1.0 - uLit, h11(seed + slot * 0.37));
            vec3 wc = mix(uTint, uCool, step(0.7, h11(seed * 2.3))) * (0.5 + 0.9 * h11(seed * 5.1));
            // a TV flicker in some rooms
            wc *= 1.0 - 0.35 * step(0.96, h11(seed * 9.0)) * (0.5 + 0.5 * sin(uTime * 13.0 + seed));
            col += win * lit * wc * 1.25 * uGlow;
            col += vec3(0.02, 0.025, 0.04) * win;
          }
          col += vec3(0.25, 0.3, 0.45) * uFlash * 0.25;
          float fog = ambientFog(vDist * uFogK);
          gl_FragColor = vec4(mix(col, uFogColor, fog) * uMaster, 1.0);
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const seeds = new Float32Array(count * 4);
    const m = new THREE.Matrix4();
    const tops = [];
    const c = new THREE.Vector3(...center);
    let n = 0;
    for (let tries = 0; n < count && tries < count * 20; tries++) {
      const a = rnd() * Math.PI * 2;
      const r = radius[0] + rnd() * (radius[1] - radius[0]);
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      if (clear && clear(x, z)) continue;
      const h = height[0] + Math.pow(rnd(), 1.8) * (height[1] - height[0]);
      const w = width[0] + rnd() * (width[1] - width[0]);
      const d = width[0] + rnd() * (width[1] - width[0]);
      m.compose(new THREE.Vector3(x, c.y, z), new THREE.Quaternion().setFromAxisAngle(UP, Math.round(rnd() * 4) * (Math.PI / 2) + (rnd() - 0.5) * 0.2), new THREE.Vector3(w, h, d));
      mesh.setMatrixAt(n, m);
      seeds.set([rnd(), rnd(), rnd(), rnd()], n * 4);
      if (h > height[0] + (height[1] - height[0]) * 0.45) tops.push([x, c.y + h + 1.5, z]);
      n++;
    }
    mesh.count = n;
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    mesh.computeBoundingSphere();
    const layer = this.add({ object: mesh });
    if (beacons && tops.length) this.beacons({ points: tops, fogK: fogK * 0.6 });
    return layer;
  }

  /** Blinking red aircraft-warning lights on towers. */
  beacons({ points, color = [5, 0.35, 0.25], size = 1.4, period = 1.6, fogK = 0.2 } = {}) {
    const box = new THREE.Box3();
    points.forEach((p) => box.expandByPoint(new THREE.Vector3(...p)));
    return this.points({
      count: points.length,
      fixed: true,
      fill: (i, set) => set('position', ...points[i]),
      fogK,
      bounds: box.getBoundingSphere(new THREE.Sphere()).expandByPoint(box.max),
      uniforms: { uColor: { value: new THREE.Vector3(...color) }, uSz: { value: size }, uPeriod: { value: period } },
      uniformDecl: 'uniform vec3 uColor; uniform float uSz; uniform float uPeriod;',
      body: /* glsl */ `
        float ph = fract(uTime / (uPeriod * (0.85 + 0.3 * aSeed.y)) + aSeed.x);
        vAlpha = 0.08 + smoothstep(0.0, 0.04, ph) * (1.0 - smoothstep(0.12, 0.3, ph));
        size = uSz;
        vColor = uColor;`,
      minPixel: 2.2,
    });
  }

  /**
   * Distant cars: white headlights / red tail lights driving along straight lanes.
   * @param {Array} lanes  [[ax, ay, az, bx, by, bz], …]  (each lane is one direction)
   */
  traffic({ lanes, cars = 60, speed = 13, fogK = 0.5, size = 0.35 } = {}) {
    const count = cars * 4;
    const box = new THREE.Box3();
    lanes.forEach((l) => box.expandByPoint(new THREE.Vector3(l[0], l[1], l[2])).expandByPoint(new THREE.Vector3(l[3], l[4], l[5])));
    return this.points({
      count,
      fill: (i, set, rnd) => {
        const car = Math.floor(i / 4);
        const l = lanes[car % lanes.length];
        set('position', l[0], l[1], l[2]);
        set('aB', l[3], l[4], l[5]);
        set('aCar', ((car * 0.61803) % 1) + rnd() * 0.02, i % 4);
      },
      attributes: { aB: 3, aCar: 2 },
      fogK,
      bounds: box.getBoundingSphere(new THREE.Sphere()),
      uniforms: { uSpeed: { value: speed }, uSz: { value: size } },
      uniformDecl: 'uniform float uSpeed; uniform float uSz;',
      body: /* glsl */ `
        vec3 d = aB - position;
        float L = length(d);
        vec3 dir = d / L;
        vec3 side = normalize(cross(dir, vec3(0.0, 1.0, 0.0)));
        float carSeed = h11(aCar.x * 977.0);
        float s = fract(aCar.x + uTime * uSpeed * (0.75 + 0.5 * carSeed) / L);
        float k = aCar.y;
        float rear = step(1.5, k);                  // 0,1 = headlights · 2,3 = tail lights
        float lr = mod(k, 2.0) * 2.0 - 1.0;
        p = position + d * s + side * lr * 0.75 - dir * rear * 4.2 + vec3(0.0, 0.7, 0.0);
        vAlpha = smoothstep(0.0, 0.03, s) * smoothstep(1.0, 0.97, s);
        vColor = mix(vec3(3.2, 3.0, 2.6), vec3(3.5, 0.25, 0.15), rear);
        size = uSz * mix(1.0, 0.8, rear);`,
      minPixel: 1.8,
    });
  }

  /** Lightning bolts in the sky while the level's Rain flashes (vfx/rainFX.js). */
  lightningBolts({ rain = this.rain, distance = [140, 240], height = 110 } = {}) {
    if (!rain?.flash) return null;
    const rnd = seeded(4242);
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.6, 4.5), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    // a few pre-built jagged bolts (with branches), as flat ribbons
    const bolts = [];
    for (let b = 0; b < 4; b++) {
      const geos = [];
      const branch = (x, y, len, w, depth) => {
        let px = x;
        let py = y;
        const segs = Math.round(len / 7);
        const pts = [[px, py]];
        for (let i = 0; i < segs; i++) {
          px += (rnd() - 0.5) * 9;
          py -= len / segs;
          pts.push([px, py]);
          if (depth < 2 && rnd() < 0.18) branch(px, py, len * 0.35, w * 0.55, depth + 1);
        }
        const pos = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, y0] = pts[i];
          const [x1, y1] = pts[i + 1];
          pos.push(x0 - w, y0, 0, x0 + w, y0, 0, x1 + w, y1, 0, x0 - w, y0, 0, x1 + w, y1, 0, x1 - w, y1, 0);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geos.push(g);
      };
      branch(0, height, height, 0.55, 0);
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      geos.forEach((g) => g.dispose());
      mesh.visible = false;
      mesh.frustumCulled = false;
      group.add(mesh);
      bolts.push(mesh);
    }
    const bg = this.scene.background?.isColor ? this.scene.background.clone() : null;
    let active = null;
    let wasOn = false;
    return this.add({
      object: group,
      update: (dt, t, life) => {
        const f = life.uniforms.uFlash.value;
        const on = f > 0.01;
        if (on && !wasOn && life.camera) {
          active?.visible && (active.visible = false);
          active = bolts[Math.floor(rnd() * bolts.length)];
          const cam = life.camera.position;
          const a = rnd() * Math.PI * 2;
          const d = distance[0] + rnd() * (distance[1] - distance[0]);
          active.position.set(cam.x + Math.cos(a) * d, 0, cam.z + Math.sin(a) * d);
          active.lookAt(cam.x, 0, cam.z);
          active.scale.x = rnd() < 0.5 ? -1 : 1;
          active.visible = true;
        }
        wasOn = on;
        mat.opacity = f;
        if (active) active.visible = on;
        if (bg && this.scene.background?.isColor) this.scene.background.copy(bg).lerp(new THREE.Color(0x3a4460), f * 0.35);
      },
      dispose: () => {
        if (bg && this.scene.background?.isColor) this.scene.background.copy(bg);
      },
    });
  }

  /**
   * A helicopter circling the area with a sweeping searchlight (visual cone
   * only — it never makes anything "lit" for gameplay).
   */
  helicopter({ center, radius = 45, height = 38, speed = 0.09, beam = true, color = 0xdfe8ff, sweep = 1 } = {}) {
    const c = new THREE.Vector3(...center);
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 2.4, 4, 8).rotateZ(Math.PI / 2), dark);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.25, 0.25).translate(-3.4, 0.2, 0), dark);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1, 0.08).translate(-5.4, 0.6, 0), dark);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.02, 24), new THREE.MeshBasicMaterial({ color: 0x0a0a0c, transparent: true, opacity: 0.28, depthWrite: false }));
    rotor.position.y = 1.05;
    const blades = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.04, 0.25), dark);
    blades.position.y = 1.08;
    g.add(body, tail, fin, rotor, blades);
    const navMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.3, 0.2) });
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), navMat);
    nav.position.set(-5.5, 1.1, 0);
    const strobeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6) });
    const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), strobeMat);
    strobe.position.set(0, -0.95, 0);
    g.add(nav, strobe);
    let cone = null;
    if (beam) {
      cone = makeBeamCone(this, { color, opacity: 0.11, radiusTop: 0.35, radiusBottom: 1, length: 1 });
      g.add(cone);
    }
    const target = new THREE.Vector3();
    const pos = new THREE.Vector3();
    return this.add({
      object: g,
      update: (dt, t) => {
        const a = t * speed;
        pos.set(c.x + Math.cos(a) * radius, c.y + height + Math.sin(t * 0.4) * 2, c.z + Math.sin(a) * radius);
        g.position.copy(pos);
        g.rotation.set(Math.sin(t * 0.7) * 0.05, -a - Math.PI / 2 * Math.sign(speed), 0.12 * Math.sign(speed));
        blades.rotation.y = t * 38;
        const blink = (t % 1.2) < 0.08;
        strobe.visible = blink;
        nav.visible = (t % 2) < 1.6;
        if (cone) {
          // the searchlight sweeps the ground around the centre
          target.set(c.x + Math.sin(t * 0.23 * sweep) * radius * 0.6, c.y, c.z + Math.cos(t * 0.31 * sweep) * radius * 0.6);
          aimCone(cone, g, pos.clone().add(new THREE.Vector3(0, -1, 0)), target, 0.16);
        }
      },
    });
  }

  // ===========================================================================
  // Signs, cables, chains, light bars, beams
  // ===========================================================================

  /**
   * Neon signs (emissive only — no lights) with a soft halo on the wall.
   * items: [{ position, rotY, text, color, height = 0.8, mode: 'steady' | 'flicker' | 'broken' | 'blink', font }]
   */
  neonSigns(items) {
    const group = new THREE.Group();
    const signs = items.map((it, i) => {
      const { text, color = '#ff2a8a', height = 0.8, mode = 'steady', font = '700 120px Rajdhani, sans-serif', border = true } = it;
      const tex = neonTexture(text, color, font, border);
      const aspect = tex.image.width / tex.image.height;
      const col = new THREE.Color(color);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: col.clone().multiplyScalar(0), blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), mat);
      const haloMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: col.clone().multiplyScalar(0.25), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect * 1.7, height * 3.2), haloMat);
      halo.position.z = -0.02;
      const s = new THREE.Group();
      s.add(halo, mesh);
      s.position.set(...it.position);
      s.rotation.y = it.rotY ?? 0;
      group.add(s);
      return { mat, haloMat, col, mode, seed: i * 3.7 + 1.3, level: 1, until: 0, tex };
    });
    return this.add({
      object: group,
      update: (dt, t, life) => {
        for (const s of signs) {
          let lv = 0.94 + 0.06 * Math.sin(t * 50 + s.seed); // mains hum
          if (s.mode === 'flicker' || s.mode === 'broken') {
            const slot = Math.floor(t * (s.mode === 'broken' ? 9 : 4) + s.seed);
            const r = hash1(slot * 1.37 + s.seed);
            if (s.mode === 'broken') lv *= r < 0.35 ? 0.05 : r < 0.5 ? 0.45 : 1;
            else if (r > 0.9) lv *= hash1(Math.floor(t * 30) + s.seed) < 0.5 ? 0.1 : 1;
          } else if (s.mode === 'blink') lv *= (t + s.seed) % 2.4 < 1.6 ? 1 : 0.04;
          lv *= life.master;
          s.mat.color.copy(s.col).multiplyScalar(2.6 * lv);
          s.haloMat.color.copy(s.col).multiplyScalar(0.22 * lv);
        }
      },
      dispose: () => signs.forEach((s) => s.tex.dispose()),
    });
  }

  /**
   * Swaying cables between points, optionally hung with festoon bulbs
   * (emissive only). spans: [[ax, ay, az, bx, by, bz, sag = 0.6], …]
   */
  cables({ spans, radius = 0.014, sway = 0.12, wind = 1, bulbs = 0, bulbColor = 0xffc070, color = 0x08080a } = {}) {
    const decl = /* glsl */ `
      uniform float uTime; uniform float uSway; uniform float uWind;
      vec3 cableOffset(float t, float sag, float seed, vec3 side) {
        float arc = 4.0 * t * (1.0 - t);
        float s = sin(uTime * (0.9 + seed * 0.6) * uWind + seed * 20.0) + 0.4 * sin(uTime * 2.3 * uWind + seed * 9.0);
        return vec3(0.0, -sag * arc, 0.0) + side * (s * uSway * arc) + vec3(0.0, s * uSway * 0.25 * arc, 0.0);
      }`;
    const geos = [];
    spans.forEach(([ax, ay, az, bx, by, bz, sag = 0.6], i) => {
      const a = new THREE.Vector3(ax, ay, az);
      const b = new THREE.Vector3(bx, by, bz);
      const len = a.distanceTo(b);
      const g = new THREE.TubeGeometry(new THREE.LineCurve3(a, b), Math.max(8, Math.round(len * 1.5)), radius, 4, false);
      const n = g.attributes.position.count;
      const side = new THREE.Vector3().subVectors(b, a).cross(UP).normalize();
      const aCable = new Float32Array(n * 2);
      const aSide = new Float32Array(n * 3);
      const uv = g.attributes.uv;
      for (let k = 0; k < n; k++) {
        aCable[k * 2] = sag;
        aCable[k * 2 + 1] = (i * 0.37) % 1;
        aSide.set([side.x, side.y, side.z], k * 3);
      }
      g.setAttribute('aCable', new THREE.BufferAttribute(aCable, 2));
      g.setAttribute('aSide', new THREE.BufferAttribute(aSide, 3));
      g.setAttribute('aT', new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, k) => uv.getX(k)), 1));
      geos.push(g);
    });
    const geo = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    geo.computeBoundingSphere();
    geo.boundingSphere.radius += 2;
    const uniforms = this.shaderUniforms({ uSway: { value: sway }, uWind: { value: wind }, uColor: { value: new THREE.Color(color) } });
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        ${decl}
        attribute vec2 aCable; attribute vec3 aSide; attribute float aT;
        varying float vDist;
        void main() {
          vec3 p = position + cableOffset(aT, aCable.x, aCable.y, aSide);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vDist = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform vec3 uFogColor; uniform float uFogK; uniform float uFlash;
        varying float vDist;
        ${AMBIENT_GLSL}
        void main() { gl_FragColor = vec4(mix(uColor + uFlash * 0.05, uFogColor, ambientFog(vDist * uFogK)), 1.0); }`,
    });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(geo, mat));
    if (bulbs > 0) {
      const total = spans.length * bulbs;
      const bGeo = new THREE.SphereGeometry(0.045, 6, 4);
      const aA = new Float32Array(total * 3);
      const aB = new Float32Array(total * 3);
      const aInfo = new Float32Array(total * 4);
      spans.forEach(([ax, ay, az, bx, by, bz, sag = 0.6], i) => {
        const side = new THREE.Vector3(bx - ax, by - ay, bz - az).cross(UP).normalize();
        for (let k = 0; k < bulbs; k++) {
          const j = i * bulbs + k;
          aA.set([ax, ay, az], j * 3);
          aB.set([bx, by, bz], j * 3);
          aInfo.set([(k + 0.5) / bulbs, sag, (i * 0.37) % 1, Math.atan2(side.z, side.x)], j * 4);
        }
      });
      const bMesh = new THREE.InstancedMesh(bGeo, new THREE.ShaderMaterial({
        uniforms: this.shaderUniforms({ uSway: { value: sway }, uWind: { value: wind }, uColor: { value: new THREE.Color(bulbColor).multiplyScalar(3) } }),
        vertexShader: /* glsl */ `
          ${decl}
          attribute vec3 aA; attribute vec3 aB; attribute vec4 aInfo;
          varying float vSeed;
          void main() {
            vec3 side = vec3(cos(aInfo.w), 0.0, sin(aInfo.w));
            vec3 c = mix(aA, aB, aInfo.x) + cableOffset(aInfo.x, aInfo.y, aInfo.z, side) - vec3(0.0, 0.06, 0.0);
            vSeed = aInfo.x * 31.0 + aInfo.z * 97.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position + c, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uTime; uniform float uMaster;
          varying float vSeed;
          float hh(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
          void main() {
            float dead = step(0.93, hh(vSeed));                          // a couple of bulbs are dead…
            float buzz = step(0.86, hh(vSeed * 1.3)) * step(0.5, hh(floor(uTime * 12.0) + vSeed)); // …some buzz
            gl_FragColor = vec4(uColor * (1.0 - dead * 0.95) * (1.0 - buzz * 0.8) * uMaster, 1.0);
          }`,
      }), total);
      bMesh.geometry.setAttribute('aA', new THREE.InstancedBufferAttribute(aA, 3));
      bMesh.geometry.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 3));
      bMesh.geometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(aInfo, 4));
      bMesh.frustumCulled = false;
      group.add(bMesh);
    }
    return this.add({ object: group });
  }

  /**
   * Hanging chains (with a hook) that sway like slow pendulums.
   * points: [[x, y, z, length], …]  (x, y, z = the anchor at the top)
   */
  chains({ points, color = 0x3a3632, linkSize = 0.07 } = {}) {
    const maxLen = Math.max(...points.map((p) => p[3]));
    const links = Math.ceil(maxLen / (linkSize * 1.5));
    const geos = [];
    for (let i = 0; i < links; i++) {
      const t = new THREE.TorusGeometry(linkSize * 0.5, linkSize * 0.13, 4, 8);
      t.scale(0.7, 1.1, 1);
      if (i % 2) t.rotateY(Math.PI / 2);
      t.translate(0, -i * linkSize * 1.5 - linkSize * 0.5, 0);
      geos.push(t);
    }
    const hook = new THREE.TorusGeometry(linkSize * 1.4, linkSize * 0.3, 5, 10, Math.PI * 1.4);
    hook.rotateZ(Math.PI * 0.8).translate(0, -links * linkSize * 1.5 - linkSize * 1.2, 0);
    geos.push(hook);
    const geo = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.45 });
    const mesh = new THREE.InstancedMesh(geo, mat, points.length);
    const sway = new Float32Array(points.length * 3);
    const m = new THREE.Matrix4();
    points.forEach(([x, y, z, len], i) => {
      const s = len / maxLen;
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, s, 1));
      mesh.setMatrixAt(i, m);
      sway.set([Math.sqrt(9.8 / Math.max(0.5, len)), i * 1.93, 0.05 + (i % 3) * 0.025], i * 3);
    });
    geo.setAttribute('aSway', new THREE.InstancedBufferAttribute(sway, 3));
    mesh.computeBoundingSphere();
    const uTime = this.uniforms.uTime;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      const rot = /* glsl */ `
        float ang = aSway.z * sin(uTime * aSway.x + aSway.y);
        float ang2 = aSway.z * 0.6 * sin(uTime * aSway.x * 0.83 + aSway.y * 2.1);
        mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, cos(ang), sin(ang), 0.0, -sin(ang), cos(ang));
        mat3 rz = mat3(cos(ang2), sin(ang2), 0.0, -sin(ang2), cos(ang2), 0.0, 0.0, 0.0, 1.0);
        mat3 swayM = rz * rx;`;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec3 aSway;')
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${rot}\nobjectNormal = swayM * objectNormal;`)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = swayM * transformed;');
    };
    return this.add({ object: mesh });
  }

  /** A police light bar that strobes in sync with the level's siren lights (emissive only). */
  lightBar({ position, rotY = 0, red = null, blue = null, width = 1.2 } = {}) {
    const g = new THREE.Group();
    const redMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const blueMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.26), new THREE.MeshStandardMaterial({ color: 0x111114 }));
    const r = new THREE.Mesh(new THREE.BoxGeometry(width * 0.46, 0.12, 0.24), redMat);
    r.position.set(-width * 0.25, 0.09, 0);
    const b = new THREE.Mesh(new THREE.BoxGeometry(width * 0.46, 0.12, 0.24), blueMat);
    b.position.set(width * 0.25, 0.09, 0);
    const haloR = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.4), new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    const haloB = haloR.clone();
    haloB.material = haloR.material.clone();
    haloR.position.set(-width * 0.3, 0.1, 0);
    haloB.position.set(width * 0.3, 0.1, 0);
    g.add(base, r, b, haloR, haloB);
    g.position.set(...position);
    g.rotation.y = rotY;
    const redI0 = 18;
    return this.add({
      object: g,
      update: (dt, t, life) => {
        // follow the level's real siren lights when given (same rhythm as the light they cast)
        const rk = red ? Math.min(1, red.intensity / redI0) : Math.floor(t * 4) % 2 ? 1 : 0;
        const bk = blue ? Math.min(1, blue.intensity / redI0) : 1 - rk;
        const pulse = 0.7 + 0.3 * Math.sin(t * 40);
        redMat.color.setRGB(5 * rk * pulse + 0.05, 0.1 * rk, 0.1 * rk);
        blueMat.color.setRGB(0.1 * bk, 0.3 * bk, 6 * bk * pulse + 0.05);
        haloR.material.color.setRGB(0.6 * rk, 0.02, 0.02);
        haloB.material.color.setRGB(0.02, 0.06, 0.8 * bk);
        if (life.camera) {
          haloR.quaternion.copy(life.camera.quaternion);
          haloB.quaternion.copy(life.camera.quaternion);
          g.updateMatrixWorld();
          const inv = g.getWorldQuaternion(new THREE.Quaternion()).invert();
          haloR.quaternion.premultiply(inv);
          haloB.quaternion.premultiply(inv);
        }
      },
    });
  }

  /**
   * Visible beams for existing SpotLights (they follow the light and its
   * target; brightness follows the light's intensity). Nothing is lit by them.
   */
  spotBeams({ lights, color = null, opacity = 0.14, maxIntensity = 140 } = {}) {
    const group = new THREE.Group();
    const cones = lights.map((light) => {
      const cone = makeBeamCone(this, { color: color ?? light.color.getHex(), opacity, radiusTop: 0.12, radiusBottom: 1, length: 1 });
      group.add(cone);
      return { cone, light };
    });
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    return this.add({
      object: group,
      update: () => {
        for (const { cone, light } of cones) {
          const k = THREE.MathUtils.clamp(light.intensity / maxIntensity, 0, 1);
          cone.visible = k > 0.01;
          if (!cone.visible) continue;
          light.getWorldPosition(from);
          light.target.getWorldPosition(to);
          aimCone(cone, group, from, to, Math.tan(light.angle) * 0.9);
          cone.material.uniforms.uOpacity.value = opacity * k;
        }
      },
    });
  }

  /** Static god-ray shafts (moonlight through a broken roof). items: [{ from, to, radius }] */
  lightShafts({ items, color = 0x9fb8ff, opacity = 0.05, shimmer = true } = {}) {
    const group = new THREE.Group();
    const cones = items.map((it) => {
      const cone = makeBeamCone(this, { color, opacity, radiusTop: 0.8, radiusBottom: 1, length: 1, soft: 1.2 });
      group.add(cone);
      aimCone(cone, group, new THREE.Vector3(...it.from), new THREE.Vector3(...it.to), it.radius / new THREE.Vector3(...it.from).distanceTo(new THREE.Vector3(...it.to)), it.radius * 0.8);
      return cone;
    });
    return this.add({
      object: group,
      update: (dt, t) => {
        if (!shimmer) return;
        cones.forEach((c, i) => (c.material.uniforms.uOpacity.value = opacity * (0.8 + 0.2 * Math.sin(t * 0.7 + i * 2.1))));
      },
    });
  }

  // ===========================================================================
  // CPU-driven life: rain splashes, blowing paper, birds
  // ===========================================================================

  /** Splash rings where rain hits the ground near the camera (rays find roofs, ledges, ground). */
  splashes({ count = CONFIG.ambient.city.splashes, radius = CONFIG.ambient.city.splashRadius, color = 0x9fb4d8, brightness = 0.55, exclude = null, center = null } = {}) {
    const fixedCenter = center ? new THREE.Vector3(...center) : null;
    const geo = new THREE.RingGeometry(0.55, 1, 16).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const base = new THREE.Color(color).multiplyScalar(brightness);
    const drops = Array.from({ length: count }, () => ({ pos: new THREE.Vector3(), age: Math.random(), life: 0.3 + Math.random() * 0.25, live: false }));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const black = new THREE.Color(0, 0, 0);
    const col = new THREE.Color();
    const R = physics.RAPIER;
    const ray = R ? new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }) : null;
    let active = count;
    const layer = this.add({
      object: mesh,
      max: count,
      setCount: (n) => {
        active = n;
        mesh.count = n;
      },
      update: (dt, t, life) => {
        const cam = life.camera;
        if (!cam || !physics.world) return;
        const step = Math.abs(dt);
        const fwd = cam.getWorldDirection(s).setY(0).normalize();
        for (let i = 0; i < active; i++) {
          const d = drops[i];
          d.age += step / d.life;
          if (d.age >= 1) {
            d.age = 0;
            d.live = false;
            // a new drop lands somewhere in front of the camera
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * radius;
            const bx = fixedCenter ? fixedCenter.x : cam.position.x + fwd.x * radius * 0.5;
            const bz = fixedCenter ? fixedCenter.z : cam.position.z + fwd.z * radius * 0.5;
            const top = (fixedCenter ? fixedCenter.y : cam.position.y) + 25;
            const x = bx + Math.cos(a) * r;
            const z = bz + Math.sin(a) * r;
            ray.origin = { x, y: top, z };
            const hit = physics.world.castRay(ray, 60, true, undefined, undefined, (exclude ?? this.exclude)?.() ?? undefined);
            if (hit) {
              const y = top - hit.timeOfImpact;
              if (fixedCenter || y < cam.position.y + 6) {
                d.pos.set(x, y + 0.02, z);
                d.live = true;
              }
            }
          }
          if (!d.live || step === 0) {
            if (!d.live) {
              m.makeScale(0, 0, 0);
              mesh.setMatrixAt(i, m);
            }
            continue;
          }
          const k = d.age;
          const sc = 0.05 + k * 0.22;
          m.compose(d.pos, q, s.set(sc, 1, sc));
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, col.copy(base).multiplyScalar((1 - k) * (1 - k) * life.master));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      },
    });
    for (let i = 0; i < count; i++) mesh.setColorAt(i, black);
    return layer;
  }

  /** Paper and litter skittering along the ground in the wind, now and then lifted into a tumble. */
  papers({ count = CONFIG.ambient.city.papers, radius = 14, wind = [1.6, 0, 0.7], exclude = null } = {}) {
    const geo = new THREE.PlaneGeometry(0.24, 0.32, 2, 2);
    // a slight fold
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.abs(p.getX(i)) * 0.25);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const tints = [0xd8d4c8, 0xbfb7a2, 0x8a7356, 0xe8e8e8, 0x9a9488].map((c) => new THREE.Color(c));
    const W = new THREE.Vector3(...wind);
    const R = physics.RAPIER;
    const ray = R ? new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }) : null;
    const bits = Array.from({ length: count }, (_, i) => ({
      pos: new THREE.Vector3(1e5, -50, 0), vel: new THREE.Vector3(), rot: new THREE.Euler(-Math.PI / 2, Math.random() * 6, 0), spin: new THREE.Vector3(), ground: -50, placed: false, seed: i * 1.7,
    }));
    const m = new THREE.Matrix4();
    bits.forEach((b, i) => {
      mesh.setColorAt(i, tints[i % tints.length]);
      mesh.setMatrixAt(i, m.makeScale(0, 0, 0)); // hidden until placed
    });
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    let active = count;
    const groundAt = (x, z, fromY) => {
      if (!ray || !physics.world) return null;
      ray.origin = { x, y: fromY, z };
      const hit = physics.world.castRay(ray, 40, true, undefined, undefined, (exclude ?? this.exclude)?.() ?? undefined);
      return hit ? fromY - hit.timeOfImpact : null;
    };
    return this.add({
      object: mesh,
      max: count,
      setCount: (n) => {
        active = n;
        mesh.count = n;
      },
      update: (dt, t, life) => {
        const center = life.player ?? life.camera?.position;
        if (!center) return;
        const gust = 0.5 + 0.5 * Math.sin(t * 0.35) * Math.sin(t * 0.13 + 1);
        for (let i = 0; i < active; i++) {
          const b = bits[i];
          const dx = b.pos.x - center.x;
          const dz = b.pos.z - center.z;
          if (!b.placed || dx * dx + dz * dz > radius * radius * 1.4) {
            // respawn upwind, on whatever surface is there
            const a = Math.atan2(-W.z, -W.x) + (Math.random() - 0.5) * 2.4;
            const r = b.placed ? radius * (0.85 + Math.random() * 0.15) : Math.random() * radius;
            const x = center.x + Math.cos(a) * r;
            const z = center.z + Math.sin(a) * r;
            const g = groundAt(x, z, center.y + 2.5);
            if (g == null || g > center.y + 1.5) continue;
            b.pos.set(x, g + 0.02, z);
            b.ground = g;
            b.vel.set(0, 0, 0);
            b.placed = true;
          }
          if (dt <= 0) continue; // paper just hangs during rewind
          // wind push, with a tumble when a gust gets underneath
          const push = (0.35 + gust * 1.1) * (0.6 + 0.4 * Math.sin(t * 1.7 + b.seed));
          b.vel.x += (W.x * push - b.vel.x) * Math.min(1, Math.abs(dt) * 1.5);
          b.vel.z += (W.z * push - b.vel.z) * Math.min(1, Math.abs(dt) * 1.5);
          const airborne = b.pos.y > b.ground + 0.03;
          if (!airborne && gust > 0.75 && Math.random() < Math.abs(dt) * 0.6) {
            b.vel.y = 1.2 + Math.random() * 1.6;
            b.spin.set((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9);
          }
          if (airborne) b.vel.y -= 2.2 * dt; // paper falls slowly
          b.pos.addScaledVector(b.vel, dt);
          if (b.pos.y <= b.ground + 0.02) {
            b.pos.y = b.ground + 0.02;
            b.vel.y = 0;
            b.rot.x += (-Math.PI / 2 - b.rot.x) * Math.min(1, Math.abs(dt) * 6);
            b.rot.z *= 0.9;
            b.spin.multiplyScalar(0.9);
            b.rot.y += b.vel.length() * 0.6 * dt;
          } else {
            b.rot.x += b.spin.x * dt;
            b.rot.y += b.spin.y * dt;
            b.rot.z += b.spin.z * dt;
          }
          // keep it on the surface it is sliding over (rarely: walls / drops)
          if (Math.random() < 0.08) {
            const g = groundAt(b.pos.x, b.pos.z, b.pos.y + 0.6);
            if (g != null && g < b.pos.y + 0.5) b.ground = g;
            else b.placed = false;
          }
          m.compose(b.pos, q.setFromEuler(b.rot), one);
          mesh.setMatrixAt(i, m);
        }
        mesh.instanceMatrix.needsUpdate = true;
      },
    });
  }

  /**
   * Pigeons: perched on ledges, they bob and peck; they take off when Kael
   * gets close or a shot is fired, circle away and come back later.
   * perches: [[x, y, z], …]
   */
  birds({ perches, count = CONFIG.ambient.city.birds, scareRadius = CONFIG.ambient.city.birdScareRadius, color = 0x4a4c52, circle = null } = {}) {
    // body + two wing triangles; aWing marks the wing tip vertices for the flap
    const pos = [
      // body (a thin diamond)
      0, 0, 0.16, 0.05, 0, 0, 0, 0.05, 0,
      0, 0, 0.16, 0, 0.05, 0, -0.05, 0, 0,
      0, 0, -0.14, 0, 0.05, 0, 0.05, 0, 0,
      0, 0, -0.14, -0.05, 0, 0, 0, 0.05, 0,
      0, 0, 0.16, 0, -0.03, 0, 0.05, 0, 0,
      0, 0, 0.16, -0.05, 0, 0, 0, -0.03, 0,
      // wings
      0.03, 0.02, 0.06, 0.3, 0.02, -0.02, 0.03, 0.02, -0.06,
      -0.03, 0.02, 0.06, -0.03, 0.02, -0.06, -0.3, 0.02, -0.02,
    ];
    const wing = pos.map((_, i) => (i % 3 === 0 ? Math.abs(pos[i]) > 0.2 ? Math.sign(pos[i]) : 0 : null)).filter((v) => v !== null);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    geo.computeVertexNormals();
    const total = count + (circle ? circle.count ?? 8 : 0);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, side: THREE.DoubleSide });
    const mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const flap = new THREE.InstancedBufferAttribute(new Float32Array(total * 2), 2);
    flap.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', flap);
    const uTime = this.uniforms.uTime;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aWing;\nattribute vec2 aFlap;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float fl = sin(uTime * 22.0 + aFlap.y) * aFlap.x;
          transformed.y += abs(aWing) * fl * 0.2;
          transformed.x *= 1.0 - abs(aWing) * abs(fl) * 0.25;`);
    };
    const rnd = seeded(99);
    const birds = Array.from({ length: total }, (_, i) => {
      const circling = i >= count;
      const perch = perches.length ? new THREE.Vector3(...perches[i % perches.length]).add(new THREE.Vector3((rnd() - 0.5) * 0.8, 0, (rnd() - 0.5) * 0.8)) : new THREE.Vector3();
      return {
        state: circling ? 'circle' : 'perch', perch, pos: perch.clone(), vel: new THREE.Vector3(), yaw: rnd() * 6.28, timer: rnd() * 3, phase: rnd() * 6.28,
        hop: 0, flapAmp: 0, circling, ang: rnd() * 6.28, r: circle ? circle.radius * (0.7 + rnd() * 0.6) : 0, h: circle ? circle.height + (rnd() - 0.5) * 6 : 0,
      };
    });
    const scare = (from, radius) => {
      for (const b of birds) {
        if (b.state !== 'perch' || b.pos.distanceTo(from) > radius) continue;
        b.state = 'flee';
        b.timer = 0;
        const away = b.pos.clone().sub(from).setY(0);
        if (away.lengthSq() < 0.01) away.set(rnd() - 0.5, 0, rnd() - 0.5);
        away.normalize();
        b.vel.copy(away).multiplyScalar(4 + rnd() * 3).setY(3 + rnd() * 2.5);
      }
    };
    this.listeners.push(scare);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    let active = total;
    return this.add({
      object: mesh,
      max: total,
      setCount: (n) => {
        active = n;
        mesh.count = n;
      },
      update: (dt, t, life) => {
        const step = Math.max(0, dt); // birds don't fly backwards
        const pp = life.player;
        if (pp && step > 0) scare(pp, scareRadius);
        for (let i = 0; i < active; i++) {
          const b = birds[i];
          b.timer += step;
          let pitch = 0;
          if (b.state === 'perch') {
            b.flapAmp = 0;
            // peck / hop / turn now and then
            b.hop = Math.max(0, b.hop - step * 6);
            if (b.timer > 1.5 + (i % 5) * 0.7) {
              b.timer = 0;
              const r = rnd();
              if (r < 0.35) b.yaw += (rnd() - 0.5) * 2;
              else if (r < 0.55) b.hop = 1;
            }
            pitch = Math.max(0, Math.sin(t * 6 + b.phase)) ** 8 * 0.7; // pecking
            b.pos.copy(b.perch);
            b.pos.y += Math.sin(b.hop * Math.PI) * 0.06;
          } else if (b.state === 'flee') {
            b.flapAmp = b.timer < 2.5 ? 1 : 0.6 + 0.4 * Math.sin(b.timer * 2);
            b.vel.y += (1.2 - b.vel.y) * Math.min(1, step * 0.8);
            b.pos.addScaledVector(b.vel, step);
            b.yaw = Math.atan2(b.vel.x, b.vel.z);
            pitch = -0.35;
            if (b.timer > 9) {
              b.state = 'away';
              b.timer = 0;
            }
          } else if (b.state === 'away') {
            b.pos.y = -100; // out of sight
            const far = !pp || pp.distanceTo(b.perch) > scareRadius * 3;
            if (b.timer > 12 + (i % 4) * 5 && far) {
              // glide back in to the perch
              b.state = 'return';
              b.timer = 0;
              b.pos.copy(b.perch).add(new THREE.Vector3((rnd() - 0.5) * 30, 14, (rnd() - 0.5) * 30));
            }
          } else if (b.state === 'return') {
            const to = b.perch.clone().sub(b.pos);
            const d = to.length();
            b.flapAmp = d < 3 ? 1 : 0.35;
            b.vel.copy(to.normalize().multiplyScalar(Math.min(6, d * 2 + 1)));
            b.pos.addScaledVector(b.vel, step);
            b.yaw = Math.atan2(b.vel.x, b.vel.z);
            if (d < 0.08) {
              b.state = 'perch';
              b.timer = 0;
            }
          } else if (b.state === 'circle') {
            b.flapAmp = (Math.sin(t * 0.8 + b.phase) > 0.2) ? 0.8 : 0.05; // flap, glide, flap
            b.ang += step * 0.35 * (i % 2 ? 1 : -1) * (12 / Math.max(6, b.r));
            b.pos.set(circle.center[0] + Math.cos(b.ang) * b.r, b.h + Math.sin(t * 0.5 + b.phase) * 1.5, circle.center[2] + Math.sin(b.ang) * b.r);
            b.yaw = b.ang + (i % 2 ? 0 : Math.PI);
            pitch = 0;
          }
          flap.setXY(i, b.flapAmp, b.phase);
          m.compose(b.pos, q.setFromEuler(e.set(pitch, b.yaw, b.state === 'circle' ? (i % 2 ? -0.3 : 0.3) : 0, 'YXZ')), one);
          mesh.setMatrixAt(i, m);
        }
        flap.needsUpdate = true;
        mesh.instanceMatrix.needsUpdate = true;
      },
    });
  }

  /**
   * Debris / glass shards around the camera. Falling + spinning forward in
   * time, so in a reversed world (Mission 7) they float back up off the road.
   */
  debris({ count = 260, area = 30, height = 7, color = 0xbfd4ff, fall = 1.2 } = {}) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.07, 0, -0.05, -0.04, 0.01, 0.06, -0.03, -0.01], 3));
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: this.shaderUniforms({ uCam: { value: new THREE.Vector3() }, uArea: { value: area }, uHeight: { value: height }, uFall: { value: fall }, uColor: { value: new THREE.Color(color) } }),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float uTime; uniform vec3 uCam; uniform float uArea; uniform float uHeight; uniform float uFall; uniform float uFogK;
        attribute vec4 aSeed;
        varying float vGlint; varying float vFog; varying float vA;
        ${AMBIENT_GLSL}
        mat3 rotAxis(vec3 a, float g) { float s = sin(g), c = cos(g), oc = 1.0 - c;
          return mat3(oc*a.x*a.x+c, oc*a.x*a.y+a.z*s, oc*a.z*a.x-a.y*s, oc*a.x*a.y-a.z*s, oc*a.y*a.y+c, oc*a.y*a.z+a.x*s, oc*a.z*a.x+a.y*s, oc*a.y*a.z-a.x*s, oc*a.z*a.z+c); }
        void main() {
          float life = uHeight / (uFall * (0.6 + aSeed.w));
          float c = uTime / life + aSeed.x * 9.0;
          float age = fract(c);
          vec3 r = h31(floor(c) * 3.1 + aSeed.y * 431.0);
          // wrap the field around the camera
          vec2 xz = mod(r.xz * uArea - uCam.xz + uArea * 0.5, uArea) - uArea * 0.5 + uCam.xz;
          // falls fast, then settles: a slow drift near the road
          float y = mix(uHeight, 0.03, 1.0 - pow(max(1.0 - age, 0.0), 1.6));
          vec3 axis = normalize(r - 0.5 + 0.001);
          mat3 R = rotAxis(axis, uTime * (2.0 + aSeed.z * 5.0) * (1.0 - age * 0.9) + aSeed.w * 30.0);
          vec3 n = R * vec3(0.0, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(R * (position * (0.6 + aSeed.z * 1.2)) + vec3(xz.x, y, xz.y), 1.0);
          gl_Position = projectionMatrix * mv;
          vGlint = pow(abs(dot(n, normalize(-mv.xyz))), 12.0);
          vFog = ambientFog(length(mv.xyz) * uFogK);
          vA = smoothstep(0.0, 0.05, age) * smoothstep(1.0, 0.85, age);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uMaster;
        varying float vGlint; varying float vFog; varying float vA;
        void main() { gl_FragColor = vec4(uColor * (0.25 + vGlint * 5.0), vA * (1.0 - vFog) * uMaster); }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const seeds = new Float32Array(count * 4).map(() => Math.random());
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    mesh.frustumCulled = false;
    return this.add({
      object: mesh,
      max: count,
      setCount: (n) => (mesh.count = n),
      update: (dt, t, life) => {
        if (life.camera) mat.uniforms.uCam.value.copy(life.camera.position);
      },
    });
  }

  /** Simple ticking of any object (turntables, fans…): fn(dt, t, life). */
  animate(fn) {
    return this.add({ update: fn });
  }
}

// =============================================================================
// Helpers (exported for ambientStadium.js / ambientClub.js)
// =============================================================================

export function hash1(x) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * An additive, soft-edged open cone (light beam). Unit length along -Y from
 * the origin; aimCone() points and scales it.
 */
export function makeBeamCone(life, { color = 0xffffff, opacity = 0.1, radiusTop = 0.1, radiusBottom = 1, length = 1, soft = 1.6 } = {}) {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, 28, 1, true).translate(0, -length / 2, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: life.shaderUniforms({ uOpacity: { value: opacity }, uColor: { value: new THREE.Color(color) }, uSoft: { value: soft } }),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uFogK;
      varying float vAlong; varying vec3 vN; varying vec3 vV; varying float vFog;
      ${AMBIENT_GLSL}
      void main() {
        vAlong = uv.y;                                  // 1 at the lamp, 0 at the far end
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vFog = ambientFog(length(mv.xyz) * uFogK);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity; uniform vec3 uColor; uniform float uSoft; uniform float uMaster;
      varying float vAlong; varying vec3 vN; varying vec3 vV; varying float vFog;
      void main() {
        float edge = pow(abs(dot(vN, vV)), uSoft);
        float fall = pow(max(vAlong, 0.0), 0.8) * smoothstep(0.0, 0.25, vAlong);
        gl_FragColor = vec4(uColor, uOpacity * edge * fall * (1.0 - vFog) * uMaster);
      }`,
  });
  const cone = new THREE.Mesh(geo, mat);
  cone.renderOrder = 3;
  cone.frustumCulled = false;
  return cone;
}

const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0);
const _inv = new THREE.Matrix4();
/** Point a beam cone (child of `parent`) from `from` to `to` (world space). radius = tan(half angle). */
export function aimCone(cone, parent, from, to, slope, minRadius = 0) {
  parent.updateMatrixWorld();
  _inv.copy(parent.matrixWorld).invert();
  const a = from.clone().applyMatrix4(_inv);
  const b = to.clone().applyMatrix4(_inv);
  _dir.subVectors(b, a);
  const len = _dir.length();
  cone.position.copy(a);
  cone.quaternion.copy(_q.setFromUnitVectors(_down, _dir.normalize()));
  const r = Math.max(minRadius, len * slope);
  cone.scale.set(r, len, r);
}

/** Canvas texture of neon-tube lettering (glow by repeated strokes, never shadowBlur). */
function neonTexture(text, color, font, border) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 120;
  c.width = Math.min(2048, w);
  c.height = 200;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const cx = c.width / 2;
  const cy = c.height / 2 + 6;
  // glow: wide faint strokes → narrow bright ones
  for (const [lw, a] of [[22, 0.06], [14, 0.12], [8, 0.25], [4, 0.6]]) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = a;
    ctx.lineWidth = lw;
    ctx.strokeText(text, cx, cy);
    if (border) ctx.strokeRect(14, 14, c.width - 28, c.height - 28);
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, cx, cy); // the hot white core of the tube
  if (border) {
    ctx.lineWidth = 2;
    ctx.strokeRect(14, 14, c.width - 28, c.height - 28);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

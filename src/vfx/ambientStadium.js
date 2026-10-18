// =============================================================================
// FLATLINE: 2050 — vfx/ambientStadium.js
// The Neon Velodrome comes alive (race, Mission 1 cutscenes, the ending):
//   • an instanced crowd that bounces, waves its arms and does Mexican waves
//   • phone lights swaying in the stands + camera-flash sparkles
//   • a drone light show over the infield (ECG line → 20:20 → heart → globe)
//   • searchlights sweeping the sky from the light towers
//   • fireworks bursting over the stands
//   • holographic screens with paging content + a scrolling ticker ring
//   • the 2050 skyline with flying traffic lanes
// All of it is ambient (no lights, no physics) and scales with Low/Medium/High.
//
//   const stadium = addVelodromeLife(life, track, { parent })
//   stadium.hype = 1        // everyone on their feet (0 … 1)
// =============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config.js';
import { AMBIENT_GLSL, aimCone, makeBeamCone, seeded } from './ambientLife.js';

const PALETTE = [0xffffff, 0x3fa9ff, 0xff6a1a, 0x8a4dff, 0xff2340, 0x1a1c24, 0x2b3a55, 0xd8d8d8, 0x3fa9ff, 0xffd400];

/**
 * @param {import('./ambientLife.js').AmbientLife} life
 * @param {import('../vehicles/raceTrack.js').RaceTrack} track
 * @param {object} [o]
 * @param {THREE.Object3D} [o.parent]  the group the track was built in (ending: the offset stadium)
 */
export function addVelodromeLife(life, track, { parent = life.parent, show = true } = {}) {
  const S = CONFIG.ambient.stadium;
  const state = { hype: S.hype, waveOn: 1 };
  const hypeU = { value: state.hype };
  const waveU = { value: 1 };
  const add = (layer) => {
    if (layer?.object && layer.object.parent !== parent) parent.add(layer.object);
    return layer;
  };

  // ---- the crowd -------------------------------------------------------------------------------------------
  const seats = track.seats ?? [];
  if (seats.length) addCrowd(life, seats, parent, hypeU, waveU);

  // ---- phone lights + camera flashes ------------------------------------------------------------------------
  if (seats.length) {
    const nSeats = seats.length / 5;
    const rnd = seeded(31);
    add(life.points({
      count: S.phones,
      fill: (i, set) => {
        const k = Math.floor(rnd() * nSeats) * 5;
        const yaw = seats[k + 3];
        set('position', seats[k] + Math.sin(yaw) * 0.3, seats[k + 1] + 1.55, seats[k + 2] + Math.cos(yaw) * 0.3);
        set('aU', seats[k + 4]);
      },
      attributes: { aU: 1 },
      uniforms: { uHype: hypeU, uWave: waveU, uWaveSpeed: { value: S.waveSpeed } },
      uniformDecl: 'uniform float uHype; uniform float uWave; uniform float uWaveSpeed;',
      body: /* glsl */ `
        float d = fract(aU - uTime * uWaveSpeed + 0.5) - 0.5;
        float wave = exp(-d * d * 900.0) * uWave;
        p.y += wave * 0.6 + sin(uTime * 2.0 + aSeed.x * 40.0) * 0.12 * uHype;
        p.x += sin(uTime * (1.2 + aSeed.y) + aSeed.z * 30.0) * 0.25;
        // a camera flash now and then (1/8 s slots)
        float slot = floor(uTime * 8.0 + aSeed.w * 8.0);
        float flash = step(0.985 - uHype * 0.01, h11(slot * 1.31 + aSeed.x * 977.0));
        float phone = step(0.45, aSeed.y);
        vAlpha = max(phone * (0.55 + 0.25 * sin(uTime * 0.7 + aSeed.z * 20.0)), flash * (1.0 - fract(uTime * 8.0 + aSeed.w * 8.0)));
        size = mix(0.28, 1.1, flash);
        vColor = mix(vec3(0.75, 0.9, 1.4), vec3(6.0, 6.0, 6.5), flash);`,
      minPixel: 1.6,
    }));
  }

  // ---- 2050 skyline + flying traffic -----------------------------------------------------------------------------
  const center = new THREE.Vector3(0, 0, 180);
  add(life.skyline({
    center: center.toArray(), radius: [760, 1350], count: 120, height: [60, 280], width: [30, 70],
    tint: 0x9fd0ff, cool: 0xff6ad5, litRatio: 0.42, fogK: 0.42, glow: 1.3,
  }));
  addSkyTraffic(life, center, parent);

  // ---- searchlights from the light towers ----------------------------------------------------------------------------
  const towers = (track.towers ?? []).slice(0, S.searchlights);
  if (towers.length) {
    const group = new THREE.Group();
    const colors = [0xcfe2ff, 0xcfe2ff, 0x8a4dff, 0xcfe2ff, 0x3fa9ff, 0xcfe2ff, 0xff6a1a, 0xcfe2ff];
    const beams = towers.map((t, i) => {
      const cone = makeBeamCone(life, { color: colors[i % colors.length], opacity: 0.08, radiusTop: 0.04, radiusBottom: 1, length: 1, soft: 1.3 });
      cone.material.uniforms.uFogK.value = 0.45;
      group.add(cone);
      return { cone, t, from: new THREE.Vector3(t.x, t.top + 2, t.z), to: new THREE.Vector3(), phase: i * 1.7 };
    });
    life.add({
      object: group,
      minQuality: 'medium',
      update: (dt, time) => {
        for (const b of beams) {
          const out = Math.atan2(-b.t.inward.x, -b.t.inward.z); // point away from the track, over the crowd
          const az = out + Math.sin(time * 0.17 + b.phase) * 1.2;
          const el = 0.95 + 0.3 * Math.sin(time * 0.11 + b.phase * 1.3);
          const L = 320;
          b.to.set(b.from.x + Math.sin(az) * Math.cos(el) * L, b.from.y + Math.sin(el) * L, b.from.z + Math.cos(az) * Math.cos(el) * L);
          aimCone(b.cone, group, b.from, b.to, 0.035, 0.5);
        }
      },
    }, parent);
  }

  // ---- drone light show over the infield --------------------------------------------------------------------------------
  if (show) addDroneShow(life, parent, new THREE.Vector3(10, 95, 205));

  // ---- fireworks ---------------------------------------------------------------------------------------------------------------
  addFireworks(life, parent, track);

  // ---- holo screens + ticker ring ---------------------------------------------------------------------------------------------------
  addHoloScreens(life, parent, track);

  return {
    get hype() { return state.hype; },
    set hype(v) {
      state.hype = THREE.MathUtils.clamp(v, 0, 1);
      hypeU.value = state.hype;
    },
    /** Mexican wave on/off. */
    set wave(on) { waveU.value = on ? 1 : 0; },
  };
}

// -----------------------------------------------------------------------------
// Crowd: instanced low-poly fans, animated in the vertex shader
// -----------------------------------------------------------------------------
function personGeometry() {
  const parts = [];
  const tag = (g, part, pivot = [0, 0, 0], color = [1, 1, 1]) => {
    const n = g.attributes.position.count;
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
    g.setAttribute('aPivot', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => pivot).flat(), 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => color).flat(), 3));
    g.deleteAttribute('uv');
    parts.push(g.index ? g.toNonIndexed() : g);
  };
  tag(new THREE.BoxGeometry(0.42, 0.62, 0.26).translate(0, 1.12, 0), 0);                                   // torso (shirt colour)
  tag(new THREE.BoxGeometry(0.36, 0.8, 0.24).translate(0, 0.42, 0), 3, [0, 0, 0], [0.05, 0.05, 0.07]);      // legs (dark, untinted)
  tag(new THREE.OctahedronGeometry(0.13, 1).scale(1, 1.15, 1).translate(0, 1.6, 0), 3, [0, 0, 0], [0.55, 0.4, 0.32]); // head
  tag(new THREE.BoxGeometry(0.09, 0.6, 0.09).translate(0, -0.3, 0), 1, [-0.26, 1.38, 0]);                  // left arm (pivot = shoulder)
  tag(new THREE.BoxGeometry(0.09, 0.6, 0.09).translate(0, -0.3, 0), 2, [0.26, 1.38, 0]);                   // right arm
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  g.computeVertexNormals();
  return g;
}

function addCrowd(life, seats, parent, hypeU, waveU) {
  const S = CONFIG.ambient.stadium;
  const nSeats = seats.length / 5;
  const max = Math.min(S.crowd, nSeats);
  const rnd = seeded(7);
  // pick `max` seats spread evenly (keep stand order, so chunks stay compact for culling)
  const picks = [];
  const stride = nSeats / max;
  for (let i = 0; i < max; i++) picks.push(Math.min(nSeats - 1, Math.floor(i * stride + rnd() * stride)) * 5);
  // shuffle within each chunk so the quality setting thins the crowd evenly
  const CHUNKS = 8;
  const per = Math.ceil(max / CHUNKS);
  const geo = personGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uTime = life.uniforms.uTime;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uTime, uHype: hypeU, uWave: waveU, uWaveSpeed: { value: S.waveSpeed } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform float uTime; uniform float uHype; uniform float uWave; uniform float uWaveSpeed;
        attribute float aPart; attribute vec3 aPivot; attribute vec4 aCrowd;
        float crowdWave() { float d = fract(aCrowd.z - uTime * uWaveSpeed + 0.5) - 0.5; return exp(-d * d * 900.0) * uWave; }
        float crowdArm(float wave) {
          float energy = aCrowd.y;
          float hype = clamp(uHype * (0.3 + energy), 0.0, 1.0);
          float cheer = hype * step(0.45, fract(aCrowd.w * 7.0));
          float up = max(wave, cheer * (0.7 + 0.3 * sin(uTime * 0.6 + aCrowd.x * 6.28)));
          return mix(0.1, 2.75, up) + sin(uTime * (5.0 + energy * 3.0) + aCrowd.x * 6.28) * 0.35 * up;
        }
        vec3 crowdRot(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x - s * v.y, s * v.x + c * v.y, v.z); }`)
      .replace('#include <beginnormal_vertex>', /* glsl */ `#include <beginnormal_vertex>
        float cWave = crowdWave();
        float cArm = crowdArm(cWave);
        if (aPart > 0.5 && aPart < 2.5) objectNormal = crowdRot(objectNormal, cArm * (aPart < 1.5 ? -1.0 : 1.0));`)
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        if (aPart > 0.5 && aPart < 2.5) transformed = crowdRot(position, cArm * (aPart < 1.5 ? -1.0 : 1.0)) + aPivot;
        float energy = aCrowd.y;
        float jump = pow(max(0.0, sin(uTime * (2.0 + energy * 1.6) * 3.1416 + aCrowd.x * 6.28)), 2.0) * clamp(uHype * 1.4 - 0.3, 0.0, 1.0) * step(0.5, energy) * 0.22;
        transformed.y += max(jump, cWave * 0.35);
        transformed.x += sin(uTime * 1.3 + aCrowd.x * 6.28) * 0.025 * transformed.y;`)
      .replace('#include <color_vertex>', '#include <color_vertex>\n if (aPart > 2.5) vColor.rgb = color.rgb;');
  };
  const palette = PALETTE.map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const group = new THREE.Group();
  const meshes = [];
  for (let c = 0; c < CHUNKS; c++) {
    const list = picks.slice(c * per, (c + 1) * per);
    if (!list.length) break;
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    const crowd = new Float32Array(list.length * 4);
    list.forEach((k, i) => {
      m.compose(new THREE.Vector3(seats[k], seats[k + 1], seats[k + 2]), q.setFromAxisAngle(UP, seats[k + 3] + (rnd() - 0.5) * 0.5), one.setScalar(0.92 + rnd() * 0.16));
      mesh.setMatrixAt(i, m);
      const col = palette[Math.floor(rnd() * palette.length)].clone().multiplyScalar(0.55 + rnd() * 0.45);
      mesh.setColorAt(i, col);
      crowd.set([rnd(), rnd(), seats[k + 4], rnd()], i * 4);
    });
    mesh.geometry = geo.clone();
    mesh.geometry.setAttribute('aCrowd', new THREE.InstancedBufferAttribute(crowd, 4));
    mesh.computeBoundingSphere();
    mesh.frustumCulled = true;
    group.add(mesh);
    meshes.push({ mesh, n: list.length });
  }
  geo.dispose();
  life.add({
    object: group,
    max: 1,
    setCount: () => meshes.forEach(({ mesh, n }) => (mesh.count = Math.max(1, Math.round(n * life.density)))),
  }, parent);
}

// -----------------------------------------------------------------------------
// Flying traffic lanes around the stadium (2050 skyline)
// -----------------------------------------------------------------------------
function addSkyTraffic(life, center, parent) {
  const S = CONFIG.ambient.stadium;
  const rings = [
    { r: 820, h: 90, speed: 55 }, { r: 860, h: 96, speed: -48 },
    { r: 1050, h: 150, speed: 62 }, { r: 1100, h: 158, speed: -58 },
    { r: 700, h: 210, speed: 40 },
  ];
  const layer = life.points({
    count: S.skyTraffic * 2,
    fill: (i, set, rnd) => {
      const car = Math.floor(i / 2);
      const ring = rings[car % rings.length];
      set('position', ring.r, ring.h + (rnd() - 0.5) * 6, rnd() * Math.PI * 2);
      set('aLane', ring.speed, i % 2);
    },
    attributes: { aLane: 2 },
    fogK: 0.38,
    uniforms: { uCenter: { value: center } },
    uniformDecl: 'uniform vec3 uCenter;',
    body: /* glsl */ `
      float R = position.x;
      float ang = position.z + uTime * aLane.x / R;
      float dirS = sign(aLane.x);
      float tail = aLane.y;
      // tail lights sit 5 m behind the head lights along the lane
      ang -= tail * dirS * 5.0 / R;
      p = uCenter + vec3(cos(ang) * R, position.y + sin(ang * 3.0 + aSeed.x * 6.28) * 4.0, sin(ang) * R);
      vColor = mix(vec3(3.0, 3.2, 3.6), mix(vec3(3.5, 0.3, 0.2), vec3(0.4, 1.2, 3.5), step(0.75, aSeed.y)), tail);
      size = 1.4;
      vAlpha = 0.9;`,
    minPixel: 1.7,
  });
  if (layer.object.parent !== parent) parent.add(layer.object);
}

// -----------------------------------------------------------------------------
// Drone light show: four formations morphing into each other
// -----------------------------------------------------------------------------
function textPoints(text, n, width, rnd) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.font = '700 132px Rajdhani, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 84);
  const data = ctx.getImageData(0, 0, 512, 160).data;
  const px = [];
  for (let y = 0; y < 160; y += 2) for (let x = 0; x < 512; x += 2) if (data[(y * 512 + x) * 4 + 3] > 128) px.push([x, y]);
  const k = width / 512;
  return Array.from({ length: n }, () => {
    const [x, y] = px.length ? px[Math.floor(rnd() * px.length)] : [256, 80];
    return [(x - 256) * k, (80 - y) * k, (rnd() - 0.5) * 2];
  });
}

function addDroneShow(life, parent, C) {
  const S = CONFIG.ambient.stadium;
  const N = S.droneShow;
  const rnd = seeded(2020);
  // F0 · the ECG line, F1 · 20:20, F2 · a heart, F3 · a turning globe
  const ecgY = (x) => {
    const u = x / 70;
    if (u > -0.12 && u < -0.05) return (u + 0.12) / 0.07 * -6;
    if (u >= -0.05 && u < 0.02) return -6 + (u + 0.05) / 0.07 * 40;
    if (u >= 0.02 && u < 0.09) return 34 - (u - 0.02) / 0.07 * 44;
    if (u >= 0.09 && u < 0.14) return -10 + (u - 0.09) / 0.05 * 10;
    if (u > 0.3 && u < 0.45) return Math.sin((u - 0.3) / 0.15 * Math.PI) * 6;
    return 0;
  };
  const F = [[], [], [], []];
  const Cc = [[], [], [], []];
  const txt = textPoints('20:20', N, 150, rnd);
  for (let i = 0; i < N; i++) {
    const x = -75 + (i / N) * 150;
    F[0].push([x, ecgY(x), 0]);
    const g = (x + 75) / 150;
    Cc[0].push([3.5 * (1 - g) + 0.4 * g, 0.5 + 0.5 * g, 0.4 * (1 - g) + 3.5 * g]);
    F[1].push(txt[i]);
    Cc[1].push([0.6, 1.8, 4.2]);
    const t = (i / N) * Math.PI * 2;
    const ring = i % 3 === 0 ? 0.7 : 1;
    F[2].push([16 * Math.sin(t) ** 3 * 3.2 * ring, (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * 3.2 * ring + 6, 0]);
    Cc[2].push([4.2, 0.7 + 0.5 * rnd(), 0.25]);
    const k = i + 0.5;
    const phi = Math.acos(1 - (2 * k) / N);
    const th = Math.PI * (1 + Math.sqrt(5)) * k;
    F[3].push([Math.cos(th) * Math.sin(phi) * 42, Math.cos(phi) * 42, Math.sin(th) * Math.sin(phi) * 42]);
    Cc[3].push(rnd() < 0.2 ? [4, 4, 4.4] : [2.2, 0.9, 4.2]);
  }
  const W = new THREE.Vector4(1, 0, 0, 0);
  const layer = life.points({
    count: N,
    fixed: true, // a formation needs all its drones
    fill: (i, set) => {
      set('position', ...F[0][i]);
      set('aF1', ...F[1][i]);
      set('aF2', ...F[2][i]);
      set('aF3', ...F[3][i]);
      set('aC0', ...Cc[0][i]);
      set('aC1', ...Cc[1][i]);
      set('aC2', ...Cc[2][i]);
      set('aC3', ...Cc[3][i]);
    },
    attributes: { aF1: 3, aF2: 3, aF3: 3, aC0: 3, aC1: 3, aC2: 3, aC3: 3 },
    fogK: 0.5,
    bounds: new THREE.Sphere(C, 120),
    uniforms: { uC: { value: C }, uW: { value: W } },
    uniformDecl: 'uniform vec3 uC; uniform vec4 uW;',
    body: /* glsl */ `
      float a = uTime * 0.35;
      vec3 g = vec3(cos(a) * aF3.x + sin(a) * aF3.z, aF3.y, -sin(a) * aF3.x + cos(a) * aF3.z);
      vec3 f = position * uW.x + aF1 * uW.y + aF2 * uW.z + g * uW.w;
      // mid-transition the swarm loosens up
      float mixAmt = 1.0 - max(max(uW.x, uW.y), max(uW.z, uW.w));
      vec3 n = (h31(aSeed.x * 911.0) - 0.5) * 2.0;
      f += n * mixAmt * 28.0 + vec3(sin(uTime * 1.3 + aSeed.y * 30.0), cos(uTime * 1.1 + aSeed.z * 30.0), 0.0) * 0.4;
      p = uC + vec3(f.x, f.y, -f.z);
      vColor = aC0 * uW.x + aC1 * uW.y + aC2 * uW.z + aC3 * uW.w;
      vAlpha = 0.85 + 0.15 * sin(uTime * 3.0 + aSeed.w * 40.0);
      size = 1.1;`,
    minPixel: 1.8,
  });
  if (layer.object.parent !== parent) parent.add(layer.object);
  const T = S.droneFormationSeconds;
  const BLEND = 2.6;
  life.add({
    update: (dt, t) => {
      const c = ((t / T) % 4 + 4) % 4;
      const i = Math.floor(c);
      const into = (c - i) * T;
      const k = THREE.MathUtils.smoothstep(into, T - BLEND, T);
      W.set(0, 0, 0, 0);
      W.setComponent(i, 1 - k);
      W.setComponent((i + 1) % 4, k);
    },
  });
}

// -----------------------------------------------------------------------------
// Fireworks: pooled shader bursts (no CPU particles)
// -----------------------------------------------------------------------------
function addFireworks(life, parent, track) {
  const S = CONFIG.ambient.stadium;
  const SLOTS = S.fireworkSlots;
  const PER = 110;
  const origins = Array.from({ length: SLOTS }, () => new THREE.Vector3(0, -1000, 0));
  const starts = new Array(SLOTS).fill(-100);
  const colors = Array.from({ length: SLOTS }, () => new THREE.Color());
  const layer = life.points({
    count: SLOTS * PER,
    fixed: true,
    fill: (i, set, rnd) => {
      const v = new THREE.Vector3().randomDirection();
      set('position', v.x, v.y, v.z);
      set('aSlot', Math.floor(i / PER), (i % PER) < 6 ? 1 : 0);
      void rnd;
    },
    attributes: { aSlot: 2 },
    fogK: 0.45,
    uniforms: { uOrigin: { value: origins }, uStart: { value: starts }, uFw: { value: colors } },
    uniformDecl: `uniform vec3 uOrigin[${SLOTS}]; uniform float uStart[${SLOTS}]; uniform vec3 uFw[${SLOTS}];`,
    body: /* glsl */ `
      int s = int(aSlot.x + 0.5);
      vec3 o = uOrigin[s];
      float age = uTime - uStart[s];
      vAlpha = 0.0;
      size = 0.0;
      if (aSlot.y > 0.5) {
        // the rocket climbing, with a short trail
        float lt = age + 1.1;
        if (lt > 0.0 && age < 0.0) {
          p = o + vec3(0.0, age * 32.0 - aSeed.x * 3.0, 0.0);
          vAlpha = 1.0 - aSeed.x * 0.7;
          size = 0.9;
          vColor = vec3(4.0, 2.6, 1.2);
        }
      } else if (age > 0.0 && age < 2.8) {
        float v = 26.0 * (0.7 + 0.3 * aSeed.x);
        float k = 1.7;
        p = o + position * v * (1.0 - exp(-k * age)) / k + vec3(0.0, -2.6 * age * age, 0.0);
        float fade = pow(max(1.0 - age / 2.8, 0.0), 1.4);
        float twinkle = age > 1.4 ? step(0.4, h11(floor(uTime * 20.0) + aSeed.y * 300.0)) : 1.0;
        vAlpha = fade * twinkle;
        size = mix(1.6, 0.6, age / 2.8);
        vColor = mix(vec3(6.0), uFw[s] * 4.0, smoothstep(0.0, 0.25, age));
      }`,
    minPixel: 1.6,
  });
  if (layer.object.parent !== parent) parent.add(layer.object);
  const FW = [0x3fa9ff, 0xff6a1a, 0x8a4dff, 0xffffff, 0xff2340, 0xffd400];
  const rnd = seeded(9);
  let next = 1.5;
  life.add({
    update: (dt, t) => {
      if (dt <= 0) return;
      next -= dt;
      if (next > 0) return;
      next = S.fireworkEvery[0] + rnd() * (S.fireworkEvery[1] - S.fireworkEvery[0]);
      // reuse the slot that finished longest ago
      let best = 0;
      for (let i = 1; i < SLOTS; i++) if (starts[i] < starts[best]) best = i;
      if (t - starts[best] < 3) return;
      const g = track.sampleAt(rnd() * track.length);
      const side = rnd() < 0.5 ? 1 : -1;
      origins[best].copy(g.position).addScaledVector(g.normal, side * (track.width / 2 + 30 + rnd() * 50)).setY(60 + rnd() * 45);
      starts[best] = t + 1.1; // bursts after the rocket climbs
      colors[best].setHex(FW[Math.floor(rnd() * FW.length)]);
    },
  });
}

// -----------------------------------------------------------------------------
// Holographic screens: paging content with glitch transitions + a ticker ring
// -----------------------------------------------------------------------------
const HOLO_VERT = /* glsl */ `
  varying vec2 vUv; varying float vFog;
  uniform float uFogK;
  ${AMBIENT_GLSL}
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFog = ambientFog(length(mv.xyz) * uFogK);
    gl_Position = projectionMatrix * mv;
  }`;
const HOLO_FRAG = /* glsl */ `
  uniform sampler2D uMap; uniform sampler2D uTicker;
  uniform float uTime; uniform float uPages; uniform float uPageDur; uniform float uTickRepeat; uniform float uTickSpeed;
  uniform float uTickerOnly; uniform vec3 uTint; uniform float uBright; uniform float uSeed; uniform float uMaster;
  varying vec2 vUv; varying float vFog;
  float hh(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  void main() {
    vec2 uv = vUv;
    float tIn = fract(uTime / uPageDur + uSeed) * uPageDur;
    float page = mod(floor(uTime / uPageDur + uSeed), uPages);
    float glitch = 1.0 - smoothstep(0.0, 0.4, tIn);
    glitch = max(glitch, step(0.985, hh(floor(uTime * 6.0) + uSeed * 91.0)) * 0.6);
    vec3 col;
    float tickerH = uTickerOnly > 0.5 ? 1.0 : 0.18;
    if (uv.y > tickerH) {
      vec2 puv = vec2(uv.x, (uv.y - tickerH) / (1.0 - tickerH));
      float line = floor(puv.y * 48.0);
      puv.x += (hh(line + floor(uTime * 24.0)) - 0.5) * 0.12 * glitch;
      float sh = 0.006 + glitch * 0.02;
      vec2 a = vec2(puv.x, (page + puv.y) / uPages);
      col = vec3(texture2D(uMap, a + vec2(sh, 0.0)).r, texture2D(uMap, a).g, texture2D(uMap, a - vec2(sh, 0.0)).b);
    } else {
      vec2 tuv = vec2(uv.x * uTickRepeat + uTime * uTickSpeed, uv.y / tickerH);
      col = texture2D(uTicker, tuv).rgb;
    }
    float scan = 0.78 + 0.22 * sin(uv.y * 420.0 + uTime * 8.0);
    float flick = 0.92 + 0.08 * sin(uTime * 37.0 + uSeed * 10.0);
    float edge = smoothstep(0.0, 0.02, uv.x) * smoothstep(1.0, 0.98, uv.x) * smoothstep(0.0, 0.03, uv.y) * smoothstep(1.0, 0.97, uv.y);
    vec3 c = col * uTint * uBright * scan * flick + uTint * 0.04;
    gl_FragColor = vec4(c, edge * (1.0 - vFog) * uMaster * (1.0 - glitch * 0.25));
  }`;

function drawPages(pages, w = 1024, h = 360) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h * pages.length;
  const ctx = c.getContext('2d');
  pages.forEach((draw, i) => {
    ctx.save();
    // canvas y runs down, texture v runs up: page 0 is drawn at the bottom
    ctx.translate(0, (pages.length - 1 - i) * h);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    ctx.fillStyle = 'rgba(6,14,30,0.55)';
    ctx.fillRect(0, 0, w, h);
    draw(ctx, w, h);
    ctx.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function tickerTexture(text, color = '#9fd8ff') {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(4,10,24,0.8)';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.font = '600 58px Rajdhani, Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  const w = ctx.measureText(text).width;
  for (let x = 0; x < c.width + w; x += w) ctx.fillText(text, x, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** A holo screen mesh: pages = [draw(ctx, w, h), …]. */
export function holoScreen(life, { w = 24, h = 9, pages, ticker = '', tint = 0x9fd8ff, bright = 1.6, pageDur = 6, seed = 0, geometry = null, tickerOnly = false, tickRepeat = 1, tickSpeed = 0.05, fogK = 0.6 }) {
  const map = pages?.length ? drawPages(pages) : null;
  const tick = tickerTexture(ticker || ' ');
  const mat = new THREE.ShaderMaterial({
    uniforms: life.shaderUniforms({
      uMap: { value: map ?? tick }, uTicker: { value: tick }, uPages: { value: pages?.length ?? 1 }, uPageDur: { value: pageDur },
      uTickRepeat: { value: tickRepeat }, uTickSpeed: { value: tickSpeed }, uTickerOnly: { value: tickerOnly ? 1 : 0 },
      uTint: { value: new THREE.Color(tint) }, uBright: { value: bright }, uSeed: { value: seed },
    }),
    vertexShader: HOLO_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  mat.uniforms.uFogK.value = fogK;
  const mesh = new THREE.Mesh(geometry ?? new THREE.PlaneGeometry(w, h), mat);
  mesh.renderOrder = 4;
  mesh.userData.textures = [map, tick].filter(Boolean);
  return mesh;
}

function addHoloScreens(life, parent, track) {
  const names = CONFIG.rivals.names ?? [];
  const title = (ctx, w, text, y, size, color) => {
    ctx.font = `700 ${size}px Rajdhani, Arial, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, y);
  };
  const ecg = (ctx, w, h, color) => {
    ctx.strokeStyle = color;
    ctx.lineJoin = 'round';
    for (const [lw, a] of [[10, 0.15], [5, 0.35], [2, 1]]) {
      ctx.globalAlpha = a;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const mid = h * 0.55;
      ctx.moveTo(40, mid);
      for (let x = 40; x < w - 40; x += 4) {
        const u = ((x - 40) / 240) % 1;
        const y = u > 0.4 && u < 0.45 ? mid - 90 : u > 0.45 && u < 0.5 ? mid + 50 : u > 0.6 && u < 0.7 ? mid - Math.sin((u - 0.6) * 31.4) * 18 : mid;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const pages = [
    (ctx, w, h) => {
      title(ctx, w, 'KAEL RAYNE', h * 0.42, 130, '#ffffff');
      title(ctx, w, '#20 · UNDEFEATED · ONE LAP FROM HISTORY', h * 0.72, 46, '#ff3a4a');
    },
    (ctx, w, h) => {
      title(ctx, w, 'LIVE · DRIVER BIOMETRICS', 64, 44, '#9fd8ff');
      ecg(ctx, w, h, '#ff3a4a');
      title(ctx, w, '72 BPM', h * 0.92, 54, '#ffffff');
    },
    (ctx, w, h) => {
      title(ctx, w, 'STANDINGS · FINAL LAP', 60, 46, '#9fd8ff');
      ctx.textAlign = 'left';
      ctx.font = '600 40px Rajdhani, Arial, sans-serif';
      ['RAYNE', ...names].slice(0, 5).forEach((n, i) => {
        ctx.fillStyle = i === 0 ? '#ffd400' : '#e8f1ff';
        ctx.fillText(`P${i + 1}   ${n.toUpperCase()}`, 300, 120 + i * 48);
      });
    },
    (ctx, w, h) => {
      ctx.strokeStyle = '#3fa9ff';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.42, 70, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.42, 30, 0, Math.PI * 2);
      ctx.stroke();
      title(ctx, w, 'HALE INDUSTRIES', h * 0.8, 70, '#ffffff');
      title(ctx, w, 'POWERING TOMORROW — MAG-DRIVE™', h * 0.95, 34, '#9fd8ff');
    },
  ];
  const ticker = '  WORLD GRAND PRIX 2050  ·  NEON VELODROME  ·  200,000 FANS  ·  KAEL RAYNE #20 — ONE LAP FROM HISTORY  ·  HALE INDUSTRIES — POWERING TOMORROW  ·';
  const group = new THREE.Group();
  // floating screens over the infield, facing the main straight
  const spots = [
    { s: 70, off: 34, y: 30, w: 26, h: 10, tint: 0xa8dcff, seed: 0.0 },
    { s: track.length * 0.18, off: 40, y: 34, w: 24, h: 9, tint: 0xffb38a, seed: 0.37 },
    { s: track.length * 0.88, off: 40, y: 32, w: 24, h: 9, tint: 0xc8a8ff, seed: 0.71 },
  ];
  const screens = spots.map((sp) => {
    const f = track.sampleAt(sp.s);
    const p = f.position.clone().addScaledVector(f.normal, -sp.off);
    const mesh = holoScreen(life, { w: sp.w, h: sp.h, pages, ticker, tint: sp.tint, seed: sp.seed, pageDur: 6.5 });
    mesh.position.set(p.x, sp.y, p.z);
    mesh.lookAt(f.position.x, sp.y - 4, f.position.z);
    group.add(mesh);
    return { mesh, y: sp.y, seed: sp.seed };
  });
  // the ticker ring turning over the start / finish gantry
  const g0 = track.sampleAt(6);
  const ring = holoScreen(life, {
    geometry: new THREE.CylinderGeometry(9, 9, 2.4, 64, 1, true), ticker, tickerOnly: true, tickRepeat: 3, tickSpeed: 0.03, tint: 0xa8dcff, bright: 1.8,
  });
  ring.position.set(g0.position.x, 15, g0.position.z);
  group.add(ring);
  life.add({
    object: group,
    update: (dt, t) => {
      screens.forEach((s) => (s.mesh.position.y = s.y + Math.sin(t * 0.6 + s.seed * 6) * 0.6));
      ring.rotation.y = t * 0.12;
    },
    dispose: () => group.traverse((o) => o.userData.textures?.forEach((tx) => tx.dispose())),
  }, parent);
}

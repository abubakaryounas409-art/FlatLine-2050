// =============================================================================
// FLATLINE: 2050 — runner/environment.js
// The three worlds Kael runs through, built from merged procedural geometry
// (a handful of draw calls) and recycled in 40 m chunks as he runs:
//
//   ⏳ time     2050 — the Neon Velodrome: banked neon walls, crowd lights,
//               clock arches, holo screens glitching "20.20.20"
//   🌑 shadows  2020 — rain on the rooftops: parapets, lit windows, water
//               towers, neon signs, police searchlights, lightning
//   🔥 fire     20:20 — the factory burning: brick walls, girders, pipes,
//               flames along the walls, embers and smoke
//
// No lights are created here (lights are made once by the world); the look is
// emissive materials + bloom + fog.
// =============================================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createFlames, flameMaterial, canvasTexture } from './runnerFX.js';

export const CHUNK = 40;
const CHUNKS = 6;

// -----------------------------------------------------------------------------
// Theme settings (sky, fog, lights) — read by the world
// -----------------------------------------------------------------------------
export const ACT_LOOKS = {
  time: {
    skyTop: 0x02040c, skyBottom: 0x0a1a3a, fog: 0x07112a, fogNear: 30, fogFar: 175,
    hemiSky: 0x5a8cff, hemiGround: 0x0a0a18, hemi: 0.9, sun: 0x9fc4ff, sunI: 1.6, accent: [0.25, 0.66, 1.0],
    mood: 'TIME',
  },
  shadows: {
    skyTop: 0x030208, skyBottom: 0x1a1430, fog: 0x0e0b1a, fogNear: 22, fogFar: 150,
    hemiSky: 0x6a5a9a, hemiGround: 0x08060c, hemi: 0.75, sun: 0x8a8ac0, sunI: 1.1, accent: [0.6, 0.36, 1.0],
    mood: 'SHADOWS',
  },
  fire: {
    skyTop: 0x080302, skyBottom: 0x3a1206, fog: 0x1c0904, fogNear: 20, fogFar: 140,
    hemiSky: 0xff8a4a, hemiGround: 0x1a0804, hemi: 0.85, sun: 0xffa060, sunI: 1.4, accent: [1.0, 0.42, 0.1],
    mood: 'FIRE',
  },
};

// -----------------------------------------------------------------------------
// Geometry helpers: pieces carry a vertex colour, then get merged per material
// -----------------------------------------------------------------------------
function colorize(g, c) {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function box(w, h, d, x, y, z, c, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return colorize(g, c);
}
function cyl(r, h, x, y, z, c, axis = 'y', seg = 10) {
  const g = new THREE.CylinderGeometry(r, r, h, seg);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return colorize(g, c);
}
/** A flat quad facing ±x (side = 1 faces +x) or the camera (-z facing +z). */
function quad(w, h, x, y, z, c, facing = 'x', side = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  if (facing === 'x') g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  if (facing === 'z') g.rotateY(side > 0 ? 0 : Math.PI);
  if (facing === 'y') g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return colorize(g, c);
}
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// -----------------------------------------------------------------------------
// Chunk builders — each returns { solid: geo[], glow: geo[], flames: spot[] }
// Local coordinates: x across, y up, z 0..CHUNK along the run.
// -----------------------------------------------------------------------------
const BUILDERS = {
  time(r) {
    const solid = [];
    const glow = [];
    const blue = [0.25, 0.66, 1.0];
    const dark = [0.05, 0.055, 0.075];
    for (const s of [-1, 1]) {
      // banked barrier with a neon top
      solid.push(box(0.4, 1.1, CHUNK, s * 5.0, 0.55, CHUNK / 2, [0.09, 0.1, 0.13]));
      glow.push(box(0.1, 0.08, CHUNK, s * 4.8, 1.12, CHUNK / 2, mul(blue, 3.2)));
      glow.push(box(0.05, 0.05, CHUNK, s * 4.25, 0.02, CHUNK / 2, mul(blue, 1.6)));
      // apron
      solid.push(box(12, 0.2, CHUNK, s * 11.2, -0.1, CHUNK / 2, [0.03, 0.035, 0.05]));
      // grandstands: steps rising away from the track
      for (let i = 0; i < 7; i++) {
        const x = s * (8.5 + i * 2.6);
        const h = 1.4 + i * 1.7;
        solid.push(box(2.6, h, CHUNK, x, h / 2, CHUNK / 2, i % 2 ? dark : [0.06, 0.065, 0.09]));
        // crowd: phone lights + glow sticks facing the track
        const n = 14 + Math.floor(r() * 10);
        for (let k = 0; k < n; k++) {
          const pal = r();
          const c = pal < 0.5 ? [1.6, 1.6, 1.8] : pal < 0.8 ? mul(blue, 2.4) : [2.2, 0.4, 1.6];
          glow.push(quad(0.12, 0.12, x - s * 1.31, h + 0.25 + r() * 0.3, r() * CHUNK, c, 'x', -s));
        }
      }
      // light towers
      if (r() < 0.6) {
        const z = 6 + r() * 28;
        solid.push(box(0.5, 26, 0.5, s * 27, 13, z, [0.08, 0.08, 0.1]));
        glow.push(box(3.2, 1.0, 0.3, s * 27, 26.4, z, [3, 3, 3.4]));
      }
    }
    // the clock arch: two pylons and a beam, edged in neon; twelve ticks of a clock above
    const z = CHUNK / 2;
    for (const s of [-1, 1]) {
      solid.push(box(0.7, 11, 0.7, s * 6.4, 5.5, z, [0.07, 0.075, 0.1]));
      glow.push(box(0.08, 10.4, 0.08, s * 6.0, 5.2, z - 0.36, mul(blue, 4)));
    }
    solid.push(box(13.5, 0.7, 0.7, 0, 11.2, z, [0.07, 0.075, 0.1]));
    glow.push(box(12.2, 0.08, 0.08, 0, 10.8, z - 0.36, mul(blue, 4)));
    if (r() < 0.55) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const long = k % 3 === 0;
        const g = new THREE.BoxGeometry(0.14, long ? 0.9 : 0.5, 0.06);
        g.rotateZ(-a);
        g.translate(Math.sin(a) * 3.2, 16 + Math.cos(a) * 3.2, z);
        glow.push(colorize(g, mul(blue, long ? 4 : 2.4)));
      }
      const hand = new THREE.BoxGeometry(0.12, 2.6, 0.05).translate(0, 1.1, 0);
      hand.rotateZ(-0.35).translate(0, 16, z);
      glow.push(colorize(hand, [3.5, 1.0, 0.6]));
    }
    return { solid, glow, flames: [], screens: r() < 0.5 ? [{ x: -16, y: 14, z: 20, s: -1 }] : [{ x: 16, y: 14, z: 20, s: 1 }] };
  },

  shadows(r) {
    const solid = [];
    const glow = [];
    const purple = [0.6, 0.36, 1.0];
    const concrete = [0.15, 0.15, 0.17];
    for (const s of [-1, 1]) {
      solid.push(box(0.4, 0.9, CHUNK, s * 4.9, 0.45, CHUNK / 2, concrete));
      for (let z = 2; z < CHUNK; z += 4) glow.push(box(0.12, 0.08, 0.12, s * 4.9, 0.95, z, mul(purple, 3)));
      // the building under Kael (a wall falling away into the street)
      solid.push(box(1, 30, CHUNK, s * 5.6, -15, CHUNK / 2, [0.08, 0.08, 0.1]));
      // neighbouring rooftops at different heights
      const nh = -6 + r() * 10;
      const nx = s * (12 + r() * 4);
      solid.push(box(10, 40, CHUNK - 4, nx, nh - 20, CHUNK / 2, [0.1, 0.1, 0.12]));
      // windows on the facade facing the run
      const face = nx - s * 5.02;
      for (let y = nh - 3; y > nh - 30; y -= 3.2) {
        for (let z = 3; z < CHUNK - 3; z += 3.4) {
          if (r() < 0.32) glow.push(quad(1.4, 1.6, face, y, z, r() < 0.7 ? [1.5, 1.1, 0.6] : [0.6, 0.8, 1.5], 'x', -s));
        }
      }
      // roof clutter: AC units, a water tower, antennas with red beacons
      for (let k = 0; k < 3; k++) solid.push(box(1.2, 1, 1.4, nx + (r() - 0.5) * 6, nh + 0.5, 4 + r() * 32, [0.32, 0.32, 0.34]));
      if (r() < 0.5) {
        const wx = nx + (r() - 0.5) * 4;
        const wz = 8 + r() * 24;
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) solid.push(box(0.15, 3, 0.15, wx + dx, nh + 1.5, wz + dz, [0.2, 0.15, 0.1]));
        solid.push(cyl(1.6, 3.2, wx, nh + 4.6, wz, [0.24, 0.17, 0.11]));
        solid.push(colorize(new THREE.ConeGeometry(1.75, 1.2, 10).translate(wx, nh + 6.8, wz), [0.2, 0.14, 0.1]));
      }
      if (r() < 0.6) {
        const ax = nx + (r() - 0.5) * 5;
        const az = r() * CHUNK;
        solid.push(box(0.12, 7, 0.12, ax, nh + 3.5, az, [0.25, 0.25, 0.27]));
        glow.push(box(0.25, 0.25, 0.25, ax, nh + 7.1, az, [4, 0.3, 0.2]));
      }
      // far towers with window grids
      for (let k = 0; k < 2; k++) {
        const tx = s * (32 + r() * 30);
        const th = 25 + r() * 45;
        const tz = r() * CHUNK;
        const tw = 8 + r() * 6;
        solid.push(box(tw, th, 10, tx, th / 2 - 25, tz, [0.05, 0.05, 0.07]));
        const fx = tx - s * (tw / 2 + 0.02);
        for (let y = -20; y < th - 27; y += 2.6) {
          for (let w = -3.6; w <= 3.6; w += 2.4) if (r() < 0.25) glow.push(quad(1.1, 1.3, fx, y, tz + w, r() < 0.75 ? [1.3, 1.0, 0.6] : [0.5, 0.7, 1.3], 'x', -s));
        }
      }
      // a neon sign
      if (r() < 0.45) {
        const c = r() < 0.5 ? [3.2, 0.5, 2.4] : [0.5, 2.6, 3.2];
        const sz = 6 + r() * 28;
        const sy = nh + 2 + r() * 3;
        const sx = nx - s * 4.6;
        glow.push(box(0.12, 0.12, 4.2, sx, sy + 1.2, sz, c));
        glow.push(box(0.12, 0.12, 4.2, sx, sy - 1.2, sz, c));
        glow.push(box(0.12, 2.5, 0.12, sx, sy, sz - 2.1, c));
        glow.push(box(0.12, 2.5, 0.12, sx, sy, sz + 2.1, c));
        glow.push(box(0.1, 0.7, 2.6, sx, sy, sz, mul(c, 0.7)));
      }
    }
    return { solid, glow, flames: [], screens: [] };
  },

  fire(r) {
    const solid = [];
    const glow = [];
    const brick = [0.2, 0.1, 0.07];
    const steel = [0.13, 0.13, 0.14];
    const orange = [1.0, 0.42, 0.1];
    const flames = [];
    for (const s of [-1, 1]) {
      solid.push(box(0.6, 10, CHUNK, s * 7.6, 5, CHUNK / 2, brick));
      // tall windows glowing with the fire outside
      for (let z = 4; z < CHUNK; z += 8) {
        glow.push(quad(2.2, 3.2, s * 7.28, 6.2, z, mul(orange, 1.4 + r() * 1.2), 'x', -s));
        solid.push(box(0.12, 3.4, 0.14, s * 7.26, 6.2, z, [0.05, 0.05, 0.05]));
      }
      // pipes
      solid.push(cyl(0.22, CHUNK, s * 7.0, 3.2, CHUNK / 2, [0.25, 0.2, 0.16], 'z'));
      solid.push(cyl(0.14, CHUNK, s * 7.05, 4.0, CHUNK / 2, [0.18, 0.18, 0.2], 'z'));
      // machines / crates / barrels along the walls
      for (let k = 0; k < 4; k++) {
        const z = 2 + r() * (CHUNK - 4);
        const kind = r();
        if (kind < 0.4) solid.push(box(1.4, 1.2 + r() * 1.6, 1.4, s * (6.0 + r() * 0.4), 1.1, z, [0.22, 0.15, 0.08]));
        else if (kind < 0.7) solid.push(cyl(0.38, 1.0, s * 6.2, 0.5, z, [0.4, 0.08, 0.05]));
        else {
          solid.push(box(1.6, 2.4, 3.2, s * 6.1, 1.2, z, [0.16, 0.17, 0.18]));
          glow.push(box(0.05, 0.3, 0.3, s * 5.28, 1.9, z, [0.3, 3.5, 0.6]));
        }
      }
      // flames licking up the walls
      for (let k = 0; k < 4; k++) flames.push({ x: s * (5.6 + r() * 1.2), y: 0, z: r() * CHUNK, w: 1.6 + r() * 1.6, h: 2.6 + r() * 3.2 });
      if (r() < 0.5) flames.push({ x: s * 7.0, y: 5.5 + r() * 2, z: r() * CHUNK, w: 2.5, h: 3.5 });
    }
    // columns + roof girders with trusses
    for (let z = 5; z < CHUNK; z += 10) {
      for (const s of [-1, 1]) solid.push(box(0.5, 10, 0.5, s * 5.7, 5, z, steel));
      solid.push(box(15.2, 0.45, 0.45, 0, 9.6, z, steel));
      for (let k = -3; k <= 3; k++) {
        const g = new THREE.BoxGeometry(0.12, 2.2, 0.12);
        g.rotateZ(k % 2 ? 0.7 : -0.7);
        g.translate(k * 2, 8.6, z);
        solid.push(colorize(g, steel));
      }
    }
    // ceiling glow from the burning roof
    glow.push(quad(14, CHUNK, 0, 10.6, CHUNK / 2, mul(orange, 0.25), 'y'));
    return { solid, glow, flames, screens: [] };
  },
};

// -----------------------------------------------------------------------------
// Floors (one long plane that follows Kael, its texture stays in place)
// -----------------------------------------------------------------------------
const FLOOR_TILE = 8;

function floorTextures(act) {
  const W = 512;
  const H = 512;
  const map = canvasTexture(W, H, (g) => {
    const base = { time: '#0c0e14', shadows: '#16161a', fire: '#17120f' }[act];
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    // grain / plates
    for (let i = 0; i < 2600; i++) {
      const v = Math.random() * 18;
      g.fillStyle = `rgba(${v + 30},${v + 30},${v + 34},0.18)`;
      g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    if (act === 'fire') {
      g.strokeStyle = 'rgba(0,0,0,0.6)';
      g.lineWidth = 3;
      for (let y = 0; y < H; y += 128) g.strokeRect(2, y + 2, W - 4, 124);
      // hazard stripes on the outer edges
      for (let y = 0; y < H; y += 32) {
        g.fillStyle = '#c99b14';
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(26, y + 16);
        g.lineTo(26, y + 32);
        g.lineTo(0, y + 16);
        g.fill();
        g.beginPath();
        g.moveTo(W, y);
        g.lineTo(W - 26, y + 16);
        g.lineTo(W - 26, y + 32);
        g.lineTo(W, y + 16);
        g.fill();
      }
    }
    if (act === 'shadows') {
      // puddles
      for (let i = 0; i < 9; i++) {
        g.fillStyle = 'rgba(6,6,10,0.75)';
        g.beginPath();
        g.ellipse(Math.random() * W, Math.random() * H, 30 + Math.random() * 60, 18 + Math.random() * 40, Math.random() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
  }, { repeat: [1, 1] });
  // lane lines as emissive (they bloom)
  const emissive = canvasTexture(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const lane = W / 3;
    const col = { time: '#3fa9ff', shadows: '#7a4ad8', fire: '#ff6a1a' }[act];
    g.fillStyle = col;
    if (act === 'time') {
      [lane, lane * 2].forEach((x) => g.fillRect(x - 3, 0, 6, H));
      [8, W - 8].forEach((x) => g.fillRect(x - 4, 0, 8, H));
      // chevrons pointing forward
      g.globalAlpha = 0.35;
      for (let k = 0; k < 3; k++) {
        const cx = lane * k + lane / 2;
        g.beginPath();
        g.moveTo(cx - 40, 300);
        g.lineTo(cx, 260);
        g.lineTo(cx + 40, 300);
        g.lineTo(cx + 40, 316);
        g.lineTo(cx, 276);
        g.lineTo(cx - 40, 316);
        g.fill();
      }
    } else if (act === 'shadows') {
      g.globalAlpha = 0.5;
      [lane, lane * 2].forEach((x) => {
        for (let y = 0; y < H; y += 128) g.fillRect(x - 2, y, 4, 64);
      });
    } else {
      g.globalAlpha = 0.7;
      [lane, lane * 2].forEach((x) => g.fillRect(x - 2, 0, 4, H));
    }
  }, { repeat: [1, 1] });
  return { map, emissive };
}

// -----------------------------------------------------------------------------
// Holo screens (2050)
// -----------------------------------------------------------------------------
function screenTexture(lines, color) {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = 'rgba(4,10,24,1)';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = color;
    g.lineWidth = 6;
    g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = color;
    g.textAlign = 'center';
    g.font = '700 86px Rajdhani, Arial, sans-serif';
    g.fillText(lines[0], w / 2, 130);
    g.font = '600 34px Rajdhani, Arial, sans-serif';
    g.fillText(lines[1], w / 2, 200);
    for (let y = 0; y < h; y += 4) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(0, y, w, 2);
    }
  });
}

// -----------------------------------------------------------------------------
// The environment
// -----------------------------------------------------------------------------
export class RunnerEnvironment {
  constructor(scene, act, seed = 7) {
    this.scene = scene;
    this.act = act;
    this.group = new THREE.Group();
    this.group.name = `env-${act}`;
    scene.add(this.group);
    this.disposables = [];
    const keep = (x) => (this.disposables.push(x), x);

    // floor
    const tex = floorTextures(act);
    keep(tex.map);
    keep(tex.emissive);
    const floorMat = keep(new THREE.MeshStandardMaterial({
      map: tex.map,
      emissiveMap: tex.emissive,
      emissive: 0xffffff,
      emissiveIntensity: act === 'time' ? 1.6 : 1.0,
      roughness: act === 'shadows' ? 0.18 : act === 'time' ? 0.3 : 0.55,
      metalness: act === 'fire' ? 0.5 : 0.35,
    }));
    const LEN = 360;
    const floorGeo = keep(new THREE.PlaneGeometry(8.4, LEN, 1, 1).rotateX(-Math.PI / 2));
    // UVs: 1 texture tile per FLOOR_TILE metres
    const uv = floorGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (LEN / FLOOR_TILE));
    this.floor = new THREE.Mesh(floorGeo, floorMat);
    this.floor.receiveShadow = true;
    this.floorLen = LEN;
    this.group.add(this.floor);

    // chunk variants (merged geometry, 2–3 draw calls each)
    this.solidMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: act === 'time' ? 0.45 : 0.75, metalness: act === 'time' ? 0.4 : 0.2 }));
    this.glowMat = keep(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: true }));
    this.flameMat = act === 'fire' ? keep(flameMaterial({ intensity: 2.0 })) : null;
    const r = rng(seed * 977 + act.length * 131);
    this.variants = Array.from({ length: 3 }, () => {
      const b = BUILDERS[act](r);
      return {
        solid: b.solid.length ? keep(mergeGeometries(b.solid)) : null,
        glow: b.glow.length ? keep(mergeGeometries(b.glow)) : null,
        flames: b.flames,
        screens: b.screens,
      };
    });

    // screens (2050 only)
    this.screenMats = act === 'time'
      ? [
        keep(new THREE.MeshBasicMaterial({ map: keep(screenTexture(['20.20.20', 'SYSTEM TIME ERROR'], '#ff3a3a')), toneMapped: false, fog: true })),
        keep(new THREE.MeshBasicMaterial({ map: keep(screenTexture(['KAEL RAYNE', 'FINAL LAP · P1'], '#3fa9ff')), toneMapped: false, fog: true })),
        keep(new THREE.MeshBasicMaterial({ map: keep(screenTexture(['HALE MOTORS', 'THE FUTURE IS OURS'], '#e8e8e8')), toneMapped: false, fog: true })),
      ]
      : [];
    const screenGeo = keep(new THREE.PlaneGeometry(12, 6));

    this.chunks = [];
    for (let i = 0; i < CHUNKS; i++) {
      const g = new THREE.Group();
      const solid = new THREE.Mesh(this.variants[0].solid ?? undefined, this.solidMat);
      solid.receiveShadow = true;
      const glow = new THREE.Mesh(this.variants[0].glow ?? undefined, this.glowMat);
      g.add(solid, glow);
      let flames = null;
      if (this.flameMat) {
        // enough instances for any variant
        const max = Math.max(...this.variants.map((v) => v.flames.length), 1);
        flames = createFlames(Array.from({ length: max }, () => ({ x: 0, z: 0, w: 1, h: 1 })), this.flameMat);
        g.add(flames);
      }
      let screen = null;
      if (this.screenMats.length) {
        screen = new THREE.Mesh(screenGeo, this.screenMats[i % this.screenMats.length]);
        g.add(screen);
      }
      this.group.add(g);
      const chunk = { group: g, solid, glow, flames, screen, z: 0 };
      this._place(chunk, (i - 1) * CHUNK, i);
      this.chunks.push(chunk);
    }
    this._next = (CHUNKS - 1) * CHUNK;
    this._count = CHUNKS;
  }

  _place(chunk, z, n) {
    const v = this.variants[n % this.variants.length];
    chunk.z = z;
    chunk.group.position.z = z;
    chunk.solid.geometry = v.solid ?? chunk.solid.geometry;
    chunk.glow.geometry = v.glow ?? chunk.glow.geometry;
    if (chunk.flames) {
      const m = new THREE.Matrix4();
      v.flames.forEach((s, i) => {
        m.makeScale(s.w, s.h, 1).setPosition(s.x, s.y, s.z);
        chunk.flames.setMatrixAt(i, m);
      });
      chunk.flames.count = v.flames.length;
      chunk.flames.instanceMatrix.needsUpdate = true;
    }
    if (chunk.screen) {
      const sc = v.screens[0];
      chunk.screen.visible = !!sc;
      if (sc) {
        chunk.screen.position.set(sc.x, sc.y, sc.z);
        chunk.screen.rotation.y = sc.s > 0 ? -Math.PI / 2 : Math.PI / 2;
        chunk.screen.material = this.screenMats[n % this.screenMats.length];
      }
    }
  }

  /** Move the floor and recycle chunks that fell behind. */
  update(heroZ) {
    this.floor.position.z = Math.floor(heroZ / FLOOR_TILE) * FLOOR_TILE + this.floorLen / 2 - 40;
    for (const c of this.chunks) {
      if (c.z + CHUNK < heroZ - 30) {
        this._place(c, this._next, this._count);
        this._next += CHUNK;
        this._count += 1;
      }
    }
  }

  /** Jump all chunks to a new start (after an act restart). */
  resetTo(z) {
    this.chunks.forEach((c, i) => this._place(c, z + (i - 1) * CHUNK, i));
    this._next = z + (CHUNKS - 1) * CHUNK;
    this._count = CHUNKS;
    this.update(z);
  }

  dispose() {
    this.group.removeFromParent();
    this.disposables.forEach((d) => d.dispose?.());
  }
}

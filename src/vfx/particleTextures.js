// =============================================================================
// FLATLINE: 2050 — vfx/particleTextures.js
// Particle sprites drawn in code (no downloads needed):
//   glow   — soft round spark (embers, sparks, dust)
//   smoke  — soft, lumpy puff (smoke, shadow smoke)
// Textures are created once and shared.
// =============================================================================

import * as THREE from 'three';

const cache = new Map();

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft radial glow with a hot centre. */
export function glowTexture() {
  if (cache.has('glow')) return cache.get('glow');
  const size = 64;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = toTexture(c);
  cache.set('glow', tex);
  return tex;
}

/** Lumpy smoke puff: many overlapping soft blobs, faded at the edges. */
export function smokeTexture() {
  if (cache.has('smoke')) return cache.get('smoke');
  const size = 128;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  // Deterministic pseudo-random so the texture is identical every run.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  for (let i = 0; i < 28; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = rand() * size * 0.22;
    const x = size / 2 + Math.cos(angle) * dist;
    const y = size / 2 + Math.sin(angle) * dist;
    const r = size * (0.12 + rand() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.12 + rand() * 0.12})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // Fade the square edges away so no sprite borders ever show.
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);

  const tex = toTexture(c);
  cache.set('smoke', tex);
  return tex;
}

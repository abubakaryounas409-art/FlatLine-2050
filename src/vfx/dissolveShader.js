// =============================================================================
// FLATLINE: 2050 — vfx/dissolveShader.js
// Noise dissolve for Shadow Step (and Umbra later): the body breaks up into
// black smoke from the feet up, with a glowing violet edge.
//
//   const d = addDissolve(kaelModel, { color: 0xa070ff })
//   d.set(0)   whole · d.set(1) gone · d.dispose() restores the materials
//
// Works on any mesh (skinned too) by patching cloned materials through
// onBeforeCompile, so the original shared materials are never touched.
// =============================================================================

import * as THREE from 'three';

const NOISE = /* glsl */ `
  float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float dNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dHash(i + vec3(0,0,0)), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }`;

/**
 * @param {THREE.Object3D} root
 * @param {object} o
 * @param {number} o.color      edge glow
 * @param {number} o.height     model height (m) — the dissolve sweeps up it
 */
export function addDissolve(root, { color = 0xa070ff, height = 1.8 } = {}) {
  const uniforms = {
    uDissolve: { value: 0 },
    uEdgeColor: { value: new THREE.Color(color).multiplyScalar(4) },
    uBase: { value: 0 },
    uHeight: { value: height },
  };
  const swaps = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const original = o.material;
    const patched = [].concat(original).map((m) => {
      const c = m.clone();
      c.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vDissolvePos;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDissolvePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vDissolvePos;\nuniform float uDissolve; uniform vec3 uEdgeColor; uniform float uBase; uniform float uHeight;\n${NOISE}`)
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            {
              float h = clamp((vDissolvePos.y - uBase) / uHeight, 0.0, 1.0);
              float n = dNoise(vDissolvePos * 9.0) * 0.55 + h * 0.45;   // feet go first
              float cut = uDissolve * 1.15;
              if (n < cut - 0.08) discard;
              float edge = smoothstep(cut + 0.06, cut - 0.08, n) * step(0.001, uDissolve);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdgeColor, edge);
            }`);
      };
      c.customProgramCacheKey = () => 'dissolve';
      return c;
    });
    o.material = Array.isArray(original) ? patched : patched[0];
    swaps.push({ mesh: o, original, patched });
  });

  return {
    uniforms,
    /** 0 = whole … 1 = gone. `base` = feet height (world y). */
    set(v, base = uniforms.uBase.value) {
      uniforms.uDissolve.value = v;
      uniforms.uBase.value = base;
    },
    dispose() {
      for (const s of swaps) {
        s.mesh.material = s.original;
        [].concat(s.patched).forEach((m) => m.dispose());
      }
    },
  };
}

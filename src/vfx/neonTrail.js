// =============================================================================
// FLATLINE: 2050 — vfx/neonTrail.js
// Neon light trail behind a car's tail light (CLAUDE.md Phase 3.4): a ribbon
// through the anchor's recent positions, always facing the camera, fading
// toward its tail. Additive + HDR colour so it blooms.
// =============================================================================

import * as THREE from 'three';

const tmp = new THREE.Vector3();
const dir = new THREE.Vector3();
const side = new THREE.Vector3();
const toCam = new THREE.Vector3();

export class NeonTrail {
  /**
   * @param {THREE.Object3D} anchor  follows this object's world position
   * @param {object} o  { color, width, points, spacing, intensity }
   */
  constructor(anchor, { color = 0x3fa9ff, width = 0.14, points = 48, spacing = 0.9, intensity = 2.6 } = {}) {
    this.anchor = anchor;
    this.width = width;
    this.max = points;
    this.spacing = spacing;
    this.history = [];

    const geo = new THREE.BufferGeometry();
    this.positions = new Float32Array(points * 2 * 3);
    this.alphas = new Float32Array(points * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < points - 1; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vAlpha;
        void main() { gl_FragColor = vec4(uColor * vAlpha * uOpacity, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** Strength 0..1 (e.g. fade in with speed). */
  setOpacity(v) {
    this.material.uniforms.uOpacity.value = v;
  }

  reset() {
    this.history.length = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  update(camera) {
    this.anchor.getWorldPosition(tmp);
    const h = this.history;
    if (!h.length || h[0].distanceToSquared(tmp) > this.spacing * this.spacing) {
      h.unshift(tmp.clone());
      if (h.length > this.max) h.pop();
    } else {
      h[0].copy(tmp); // keep the head glued to the light
    }
    const n = h.length;
    if (n < 2) return;
    const P = this.positions;
    const A = this.alphas;
    for (let i = 0; i < n; i++) {
      const a = h[Math.max(0, i - 1)];
      const b = h[Math.min(n - 1, i + 1)];
      dir.subVectors(a, b).normalize();
      toCam.subVectors(camera.position, h[i]).normalize();
      side.crossVectors(dir, toCam).normalize();
      const t = i / (n - 1);
      const w = this.width * (1 - t * 0.6);
      P.set([h[i].x + side.x * w, h[i].y + side.y * w, h[i].z + side.z * w, h[i].x - side.x * w, h[i].y - side.y * w, h[i].z - side.z * w], i * 6);
      const alpha = (1 - t) ** 2.2;
      A[i * 2] = A[i * 2 + 1] = alpha;
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.alpha.needsUpdate = true;
    g.setDrawRange(0, (n - 1) * 6);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}

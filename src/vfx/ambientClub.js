// =============================================================================
// FLATLINE: 2050 — vfx/ambientClub.js
// Mission 5's mirror-maze nightclub: laser fans sweeping through the haze, a
// turning mirror ball throwing light specks over the walls, ceiling strobe
// panels firing in bursts. Emissive / additive only — no lights are added, so
// the 🌑 darkness gameplay (lights.isDark) is untouched.
//
//   addClubLife(life, { room: { min: [x, y, z], max: [x, y, z] }, emitters, ball })
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { AMBIENT_GLSL, hash1 } from './ambientLife.js';

/**
 * @param {import('./ambientLife.js').AmbientLife} life
 * @param {object} o
 * @param {{min: number[], max: number[]}} o.room   inner walls of the club (the sparkles land on them)
 * @param {number[][]} o.emitters                   laser heads [[x, y, z], …]
 * @param {number[]} o.ball                         mirror-ball centre
 * @param {number[][]} [o.strobes]                  strobe panels [[x, y, z], …] (on the ceiling)
 */
export function addClubLife(life, { room, emitters, ball, strobes = [] }) {
  const C = CONFIG.ambient.club;
  addLasers(life, emitters, C.lasers);
  addMirrorBall(life, room, ball, C.sparkles);
  if (strobes.length) addStrobes(life, strobes);
  // haze: dust motes everywhere, catching the lasers
  const min = new THREE.Vector3(...room.min);
  const max = new THREE.Vector3(...room.max);
  life.dust({ center: min.clone().add(max).multiplyScalar(0.5).toArray(), size: max.clone().sub(min).toArray(), count: C.dust, color: 0xc8b0ff, brightness: 0.5, pointSize: 0.035, speed: 0.8 });
}

// -----------------------------------------------------------------------------
// Lasers: thin additive beams in fans, sweeping / rotating / scanning in turns
// -----------------------------------------------------------------------------
function addLasers(life, emitters, total) {
  const per = Math.max(2, Math.round(total / emitters.length));
  const count = per * emitters.length;
  const geo = new THREE.CylinderGeometry(0.012, 0.03, 1, 5, 1, true).translate(0, -0.5, 0).rotateX(-Math.PI / 2); // along +Z
  const mat = new THREE.ShaderMaterial({
    uniforms: life.shaderUniforms(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uFogK;
      varying float vAlong; varying vec3 vCol; varying float vFog;
      ${AMBIENT_GLSL}
      void main() {
        vAlong = position.z;    // 0 at the laser head → 1 at the far end
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vFog = ambientFog(length(mv.xyz) * uFogK * 0.6);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uMaster;
      varying float vAlong; varying vec3 vCol; varying float vFog;
      void main() {
        float a = (1.0 - smoothstep(0.55, 1.0, vAlong)) * (1.0 - vFog);
        gl_FragColor = vec4(vCol, a * uMaster);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  const heads = emitters.map((e) => new THREE.Vector3(...e));
  const cols = [new THREE.Color(5, 0.4, 3.5), new THREE.Color(0.6, 2, 6), new THREE.Color(3.2, 0.8, 6), new THREE.Color(0.5, 5, 1.2)];
  const col = new THREE.Color();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const LEN = 34;
  let active = count;
  for (let i = 0; i < count; i++) mesh.setColorAt(i, cols[0]);
  life.add({
    object: mesh,
    max: count,
    minQuality: 'low',
    setCount: (n) => {
      active = Math.max(emitters.length, n);
      mesh.count = active;
    },
    update: (dt, t) => {
      // a show of 3 patterns, 8 s each, colour changes per pattern
      const pattern = Math.floor(t / 8) % 3;
      const pc = cols[Math.floor(t / 8) % cols.length];
      const onBeat = 0.65 + 0.35 * (Math.sin(t * Math.PI * 2 * 2.1) > 0 ? 1 : 0.2); // 126 bpm pulse
      const usePer = Math.max(1, Math.floor(active / emitters.length));
      let k = 0;
      heads.forEach((h, ei) => {
        const facing = Math.atan2(-h.x, -h.z); // toward the room centre
        for (let j = 0; j < per; j++, k++) {
          if (j >= usePer) {
            m.makeScale(0, 0, 0);
            mesh.setMatrixAt(k, m);
            continue;
          }
          const u = per > 1 ? j / (per - 1) - 0.5 : 0;
          let yaw;
          let pitch;
          if (pattern === 0) { // sweeping fan
            yaw = facing + u * 1.1 + Math.sin(t * 0.9 + ei) * 0.5;
            pitch = -0.25 - 0.1 * Math.sin(t * 1.3 + ei);
          } else if (pattern === 1) { // rotating cone
            const a = u * Math.PI * 2 + t * 1.4 * (ei % 2 ? 1 : -1);
            yaw = facing + Math.cos(a) * 0.45;
            pitch = -0.38 + Math.sin(a) * 0.22;
          } else { // scanning sheet, up and down
            yaw = facing + u * 1.4;
            pitch = -0.1 - 0.45 * (0.5 + 0.5 * Math.sin(t * 2.2 + ei * 1.4));
          }
          q.setFromEuler(e.set(-pitch, yaw, 0, 'YXZ'));
          mesh.setMatrixAt(k, m.compose(pos.copy(h), q, scl.set(1, 1, LEN)));
          mesh.setColorAt(k, col.copy(pc).multiplyScalar(onBeat * (0.8 + 0.2 * hash1(j + ei * 7))));
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  });
  // the laser heads themselves
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 1.2, 3.5) });
  const group = new THREE.Group();
  heads.forEach((h) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.22, 0.35), new THREE.MeshStandardMaterial({ color: 0x111116, metalness: 0.7, roughness: 0.4 }));
    b.position.copy(h);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), headMat);
    lens.position.copy(h);
    group.add(b, lens);
  });
  life.add({ object: group });
}

// -----------------------------------------------------------------------------
// Mirror ball: a faceted ball turning slowly, specks of light orbiting over the walls
// -----------------------------------------------------------------------------
function addMirrorBall(life, room, ball, count) {
  const c = new THREE.Vector3(...ball);
  const ballMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 2),
    new THREE.MeshStandardMaterial({ color: 0xd8dce8, metalness: 1, roughness: 0.08, flatShading: true, envMapIntensity: 1.6, emissive: 0x222233 }),
  );
  ballMesh.position.copy(c);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  rod.position.copy(c).add(new THREE.Vector3(0, 0.85, 0));
  const g = new THREE.Group();
  g.add(ballMesh, rod);
  life.add({ object: g, update: (dt, t) => (ballMesh.rotation.y = t * 0.45) });
  // the specks: directions from the ball, rotated in the shader, projected onto the room box
  const min = new THREE.Vector3(...room.min);
  const max = new THREE.Vector3(...room.max);
  life.points({
    count,
    minQuality: 'low',
    fill: (i, set, rnd) => {
      const d = new THREE.Vector3().randomDirection();
      d.y = -Math.abs(d.y) * 0.8 - 0.05; // mostly thrown down and out
      d.normalize();
      set('position', d.x, d.y, d.z);
      void rnd;
    },
    uniforms: { uBall: { value: c }, uMin: { value: min }, uMax: { value: max } },
    uniformDecl: 'uniform vec3 uBall; uniform vec3 uMin; uniform vec3 uMax;',
    body: /* glsl */ `
      float a = uTime * 0.45;
      vec3 d = vec3(cos(a) * position.x + sin(a) * position.z, position.y, -sin(a) * position.x + cos(a) * position.z);
      // ray from the ball to the room's inner walls / floor
      vec3 t1 = (uMin - uBall) / d;
      vec3 t2 = (uMax - uBall) / d;
      vec3 tf = max(t1, t2);
      float tHit = min(min(tf.x, tf.y), tf.z);
      p = uBall + d * tHit * 0.985;
      size = 0.13 + 0.06 * aSeed.x;
      vAlpha = 0.5 + 0.5 * sin(uTime * 3.0 + aSeed.y * 40.0);
      vColor = mix(vec3(2.2, 2.0, 2.6), vec3(2.6, 1.2, 3.0), aSeed.z);`,
    minPixel: 1.6,
  });
}

// -----------------------------------------------------------------------------
// Strobes: ceiling panels that fire in quick bursts every few seconds
// -----------------------------------------------------------------------------
function addStrobes(life, strobes) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const group = new THREE.Group();
  strobes.forEach((s) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.3), mat);
    p.position.set(...s);
    group.add(p);
  });
  life.add({
    object: group,
    update: (dt, t) => {
      const cycle = t % 7;
      const burst = cycle < 0.9 && Math.floor(cycle * 14) % 2 === 0;
      const k = burst ? 9 : 0.04;
      mat.color.setRGB(k, k, k * 1.05);
    },
  });
}

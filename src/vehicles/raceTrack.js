// =============================================================================
// FLATLINE: 2050 — vehicles/raceTrack.js
// The Neon Velodrome circuit, built in code from one closed spline:
//   road (asphalt), kerbs on corners, neon edge lines, barriers + physics walls,
//   grandstands with crowd lights, light towers, holo screens, start gantry.
//
// Queries used by the race / AI / minimap:
//   track.length                         metres per lap
//   track.sampleAt(s)                    { position, tangent, normal, curvature } at distance s
//   track.closest(position, hintS)       { s, lateral } — distance along + signed offset
//   track.gridSlot(i)                    { position, yaw } start grid (2 columns)
//   track.outline                        [[x, z], …] for the minimap
// If public/models/env/stadium.glb exists it is placed as extra scenery.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';

// Control points (x, z) in metres. Main straight runs +X along z = 0; the last
// corner (the long left sweeper back onto the straight) is where Mission 1's
// crash happens.
const POINTS = [
  [-280, 0], [0, 0], [280, 0], [400, 30], [460, 140], [430, 250], [320, 300], [190, 285],
  [90, 330], [-40, 365], [-220, 345], [-380, 270], [-450, 150], [-420, 50],
];
const SAMPLE_STEP = 2; // metres between precomputed samples
const BARRIER_OFFSET = 4.5; // run-off beyond the road edge
const UP = new THREE.Vector3(0, 1, 0);

/** Clone a PBR material with its own texture repeat (textures are shared by the loader). */
function withRepeat(material, rx, ry) {
  const m = material.clone();
  for (const key of ['map', 'normalMap', 'roughnessMap']) {
    if (!m[key]) continue;
    m[key] = m[key].clone();
    m[key].repeat.set(rx, ry);
    m[key].needsUpdate = true;
  }
  return m;
}

export class RaceTrack {
  constructor(scene, { asphalt, concrete } = {}) {
    const { RAPIER, world } = physics;
    this.width = CONFIG.race.trackWidth;
    this.curve = new THREE.CatmullRomCurve3(POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    this.length = this.curve.getLength();
    this.group = new THREE.Group();
    this.group.name = 'track';
    scene.add(this.group);
    this.disposables = [];
    this.animated = [];   // { update(t) } — screens, light flicker

    this._buildSamples();
    this._buildGround(concrete);
    this._buildRoad(asphalt);
    this._buildKerbsAndLines();
    this._buildBarriers(RAPIER, world);
    this._buildStartLine();
    this._buildGantry();
    this._buildGrandstands();
    this._buildLightTowers();
    this._buildScreens();
    this.lastCornerS = this.length - 260; // Phase 4: the crash corner (approach)
  }

  // ---------------------------------------------------------------------------
  // Samples + queries
  // ---------------------------------------------------------------------------
  _buildSamples() {
    const n = Math.ceil(this.length / SAMPLE_STEP);
    this.samples = [];
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const position = this.curve.getPointAt(u);
      const tangent = this.curve.getTangentAt(u).setY(0).normalize();
      const normal = new THREE.Vector3().crossVectors(UP, tangent).normalize(); // points left of travel
      this.samples.push({ s: u * this.length, position, tangent, normal, curvature: 0 });
    }
    // Signed curvature from tangent change (positive = turning left)
    for (let i = 0; i < n; i++) {
      const a = this.samples[(i - 2 + n) % n].tangent;
      const b = this.samples[(i + 2) % n].tangent;
      const ang = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);
      this.samples[i].curvature = -ang / (4 * SAMPLE_STEP);
    }
    this.outline = this.samples.filter((_, i) => i % 4 === 0).map((p) => [p.position.x, p.position.z]);
  }

  /** Wrap any distance into [0, length). */
  wrap(s) {
    return ((s % this.length) + this.length) % this.length;
  }

  /** Interpolated frame at distance s. */
  sampleAt(s, out = {}) {
    const n = this.samples.length;
    const f = this.wrap(s) / SAMPLE_STEP;
    const i = Math.floor(f) % n;
    const j = (i + 1) % n;
    const t = f - Math.floor(f);
    const a = this.samples[i];
    const b = this.samples[j];
    out.position = (out.position ?? new THREE.Vector3()).lerpVectors(a.position, b.position, t);
    out.tangent = (out.tangent ?? new THREE.Vector3()).lerpVectors(a.tangent, b.tangent, t).normalize();
    out.normal = (out.normal ?? new THREE.Vector3()).crossVectors(UP, out.tangent).normalize();
    out.curvature = a.curvature + (b.curvature - a.curvature) * t;
    return out;
  }

  /**
   * Closest point on the centre line. With a hint (last known s) only a window
   * around it is searched, so it stays cheap and never jumps across the infield.
   */
  closest(pos, hintS = null) {
    const n = this.samples.length;
    let best = -1;
    let bestD = Infinity;
    const scan = (i) => {
      const p = this.samples[(i + n) % n].position;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = (i + n) % n;
      }
    };
    if (hintS == null) for (let i = 0; i < n; i++) scan(i);
    else {
      const c = Math.round(this.wrap(hintS) / SAMPLE_STEP);
      for (let k = -40; k <= 40; k++) scan(c + k);
    }
    const smp = this.samples[best];
    const dx = pos.x - smp.position.x;
    const dz = pos.z - smp.position.z;
    const along = dx * smp.tangent.x + dz * smp.tangent.z;
    return { s: this.wrap(smp.s + along), lateral: dx * smp.normal.x + dz * smp.normal.z };
  }

  /** Start grid: 2 columns, staggered, behind the line (slot 0 = pole). */
  gridSlot(i) {
    const row = Math.floor(i / 2);
    const col = i % 2 === 0 ? 1 : -1;
    const progress = -14 - row * 9 - (i % 2) * 4.5; // unwrapped: negative = behind the line
    const f = this.sampleAt(progress);
    const lateral = col * this.width * 0.22;
    const position = f.position.clone().addScaledVector(f.normal, lateral);
    return { position: [position.x, 0, position.z], yaw: Math.atan2(-f.tangent.z, f.tangent.x), progress, lateral };
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------
  /** A ribbon following the track at lateral offsets [a, b] (b > a), height y. */
  _ribbon(a, b, y, vRepeat = 8, step = 2) {
    const verts = [];
    const uvs = [];
    const idx = [];
    const n = Math.ceil(this.length / step);
    const f = {};
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * this.length;
      this.sampleAt(s, f);
      const pa = f.position.clone().addScaledVector(f.normal, a);
      const pb = f.position.clone().addScaledVector(f.normal, b);
      verts.push(pa.x, y, pa.z, pb.x, y, pb.z);
      uvs.push(0, s / vRepeat, 1, s / vRepeat);
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.disposables.push(g);
    return g;
  }

  _mat(m) {
    this.disposables.push(m);
    return m;
  }

  // ---------------------------------------------------------------------------
  // Build steps
  // ---------------------------------------------------------------------------
  _buildGround(concrete) {
    const mat = concrete ? withRepeat(concrete, 220, 220) : new THREE.MeshStandardMaterial({ color: 0x15161a });
    mat.color.multiplyScalar(0.035); // dark infield / run-off at night
    mat.envMapIntensity = 0.04; // no bright HDRI glare at grazing angles
    mat.roughness = 1;
    this._mat(mat);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);
    physics.world.createCollider(physics.RAPIER.ColliderDesc.cuboid(1200, 0.5, 1200).setTranslation(0, -0.5, 0).setFriction(1.0));
  }

  _buildRoad(asphalt) {
    const w = this.width / 2;
    // The ribbon's UVs run 0..1 across and s/9 along: two tiles across, one per 9 m along
    const mat = asphalt ? withRepeat(asphalt, 2, 1) : new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6 });
    mat.roughness = 0.75;
    mat.envMapIntensity = 0.6;
    this._mat(mat);
    const road = new THREE.Mesh(this._ribbon(-w, w, 0.01, 9), mat);
    road.receiveShadow = true;
    this.group.add(road);
  }

  _buildKerbsAndLines() {
    const w = this.width / 2;
    // Neon edge lines: TIME blue on the left, FIRE orange on the right
    const neon = (color) => this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) }));
    this.group.add(new THREE.Mesh(this._ribbon(w - 0.5, w - 0.25, 0.03, 4, 3), neon(CONFIG.colors.time)));
    this.group.add(new THREE.Mesh(this._ribbon(-w + 0.25, -w + 0.5, 0.03, 4, 3), neon(CONFIG.colors.fire)));

    // Kerbs on the inside of corners: red/white blocks every 2.5 m
    const kerbGeo = new THREE.BoxGeometry(2.4, 0.08, 1.4);
    this.disposables.push(kerbGeo);
    const red = this._mat(new THREE.MeshStandardMaterial({ color: 0xc41a2a, roughness: 0.5 }));
    const white = this._mat(new THREE.MeshStandardMaterial({ color: 0xe8e8ec, roughness: 0.5 }));
    const spots = [];
    const f = {};
    for (let s = 0; s < this.length; s += 2.5) {
      this.sampleAt(s, f);
      if (Math.abs(f.curvature) < 0.004) continue;
      const side = Math.sign(f.curvature); // inside of the turn
      const p = f.position.clone().addScaledVector(f.normal, side * (w + 0.7));
      spots.push({ p, yaw: Math.atan2(-f.tangent.z, f.tangent.x), red: Math.floor(s / 2.5) % 2 === 0 });
    }
    for (const [mat, isRed] of [[red, true], [white, false]]) {
      const list = spots.filter((k) => k.red === isRed);
      const inst = new THREE.InstancedMesh(kerbGeo, mat, list.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      list.forEach((k, i) => {
        q.setFromAxisAngle(UP, k.yaw);
        m4.compose(k.p.setY(0.04), q, new THREE.Vector3(1, 1, 1));
        inst.setMatrixAt(i, m4);
      });
      inst.receiveShadow = true;
      this.group.add(inst);
    }
  }

  _buildBarriers(RAPIER, world) {
    const off = this.width / 2 + BARRIER_OFFSET;
    const wallMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.8, metalness: 0.2, side: THREE.DoubleSide }));
    const topMat = this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8a4dff).multiplyScalar(1.8) }));
    for (const side of [1, -1]) {
      // Visual wall: vertical ribbon
      const verts = [];
      const idx = [];
      const n = Math.ceil(this.length / 4);
      const f = {};
      for (let i = 0; i <= n; i++) {
        this.sampleAt((i / n) * this.length, f);
        const p = f.position.clone().addScaledVector(f.normal, side * off);
        verts.push(p.x, 0, p.z, p.x, 1.1, p.z);
        if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.disposables.push(g);
      this.group.add(new THREE.Mesh(g, wallMat));
      // Glowing top rail
      this.group.add(new THREE.Mesh(this._ribbon(side > 0 ? off - 0.12 : -off - 0.12, side > 0 ? off + 0.12 : -off + 0.12, 1.12, 4, 4), topMat));

      // Physics: thin boxes every 6 m along the wall
      const seg = 6;
      for (let s = 0; s < this.length; s += seg) {
        const a = this.sampleAt(s);
        const b = this.sampleAt(s + seg);
        const pa = a.position.clone().addScaledVector(a.normal, side * off);
        const pb = b.position.clone().addScaledVector(b.normal, side * off);
        const mid = pa.clone().add(pb).multiplyScalar(0.5);
        const len = pa.distanceTo(pb);
        const yaw = Math.atan2(-(pb.z - pa.z), pb.x - pa.x);
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(len / 2 + 0.4, 1.2, 0.3)
            .setTranslation(mid.x, 1.0, mid.z)
            .setRotation(new THREE.Quaternion().setFromAxisAngle(UP, yaw))
            .setFriction(0.1)
            .setRestitution(0.2),
        );
      }
    }
  }

  _buildStartLine() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const ctx = c.getContext('2d');
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(tex);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(2, this.width), this._mat(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })));
    // The line sits at s = 0 (where laps are counted), across the road
    const f = this.sampleAt(0);
    line.rotation.set(-Math.PI / 2, 0, Math.atan2(-f.tangent.z, f.tangent.x));
    line.position.copy(f.position).setY(0.02);
    this.group.add(line);
    this.startLinePosition = f.position.clone();
  }

  _buildGantry() {
    const f = this.sampleAt(6);
    const g = new THREE.Group();
    g.position.copy(f.position);
    g.rotation.y = Math.atan2(-f.tangent.z, f.tangent.x);
    const metal = this._mat(new THREE.MeshStandardMaterial({ color: 0x1b1d24, metalness: 0.8, roughness: 0.35 }));
    const half = this.width / 2 + 2;
    for (const z of [half, -half]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), metal);
      leg.position.set(0, 4.5, z);
      g.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, half * 2 + 0.8), metal);
    beam.position.set(0, 8.6, 0);
    g.add(beam);
    // Five start lights facing the grid (-X side)
    this.startLights = [];
    for (let i = 0; i < 5; i++) {
      const m = this._mat(new THREE.MeshStandardMaterial({ color: 0x050505, emissive: 0xff1020, emissiveIntensity: 0 }));
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), m);
      l.position.set(-0.62, 8.6, (i - 2) * 1.3);
      l.rotation.y = -Math.PI / 2;
      g.add(l);
      this.startLights.push(m);
    }
    // "WORLD GRAND PRIX 2050" banner
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 1, 1.1), this._mat(new THREE.MeshBasicMaterial({ map: this._textTexture('WORLD GRAND PRIX · 2050', '#3fa9ff'), transparent: true })));
    banner.position.set(-0.62, 7.4, 0);
    banner.rotation.y = -Math.PI / 2;
    g.add(banner);
    this.group.add(g);
  }

  /** Light the gantry: n red lights (0-5), or 'green'. */
  setStartLights(state) {
    this.startLights.forEach((m, i) => {
      if (state === 'green') {
        m.emissive.setHex(0x20ff60);
        m.emissiveIntensity = 6;
      } else {
        m.emissive.setHex(0xff1020);
        m.emissiveIntensity = i < state ? 6 : 0;
      }
    });
  }

  _buildGrandstands() {
    // Stepped stands along both sides of the main straight + the far curve
    const standMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x14151b, roughness: 0.9 }));
    const crowdPositions = [];
    const crowdColors = [];
    this.seats = [];      // flat [x, y, z, yaw, u, …] (see below)
    const palette = [0xffffff, 0x3fa9ff, 0xff6a1a, 0x8a4dff, 0xffd400].map((c) => new THREE.Color(c));
    const stands = [
      { s: 20, side: 1, len: 360 },
      { s: 20, side: -1, len: 300 },
      { s: this.length * 0.36, side: -1, len: 180 },
      { s: this.length * 0.62, side: 1, len: 200 },
    ];
    for (const st of stands) {
      const steps = 10;
      for (let k = 0; k < steps; k++) {
        const off = this.width / 2 + BARRIER_OFFSET + 6 + k * 2.2;
        const height = 1.2 + k * 1.3;
        const verts = [];
        const idx = [];
        const n = Math.ceil(st.len / 6);
        const f = {};
        // Seats for the animated crowd (vfx/ambientStadium.js): one row per tier,
        // 0.8 m apart — [x, y, z, yaw (facing the track), u (wave position)]
        const seats = [];
        const sf = {};
        for (let d = 0; d <= st.len; d += 0.8) {
          const sS = st.s - st.len / 2 + d;
          this.sampleAt(sS, sf);
          const p = sf.position.clone().addScaledVector(sf.normal, st.side * (off + 1.1 + (Math.random() - 0.5) * 0.5));
          const face = sf.normal.clone().multiplyScalar(-st.side);
          seats.push(p.x, height, p.z, Math.atan2(face.x, face.z), this.wrap(sS) / this.length);
        }
        this.seats.push(...seats);
        for (let i = 0; i <= n; i++) {
          this.sampleAt(st.s - st.len / 2 + (i / n) * st.len, f);
          const p = f.position.clone().addScaledVector(f.normal, st.side * off);
          const q = f.position.clone().addScaledVector(f.normal, st.side * (off + 2.2));
          verts.push(p.x, height, p.z, q.x, height, q.z);
          if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
          // Crowd: phone lights and LED wristbands
          for (let c = 0; c < 6; c++) {
            const t = Math.random();
            const r = p.clone().lerp(q, 0.3 + Math.random() * 0.4).addScaledVector(f.tangent, (Math.random() - 0.5) * 6);
            if (Math.random() < 0.85) {
              crowdPositions.push(r.x, height + 0.9 + Math.random() * 0.3, r.z);
              const col = palette[Math.floor(t * palette.length)];
              crowdColors.push(col.r, col.g, col.b);
            }
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        this.disposables.push(g);
        const tier = new THREE.Mesh(g, standMat);
        tier.material.side = THREE.DoubleSide;
        this.group.add(tier);
      }
    }
    const crowdGeo = new THREE.BufferGeometry();
    crowdGeo.setAttribute('position', new THREE.Float32BufferAttribute(crowdPositions, 3));
    crowdGeo.setAttribute('color', new THREE.Float32BufferAttribute(crowdColors, 3));
    this.disposables.push(crowdGeo);
    const crowdMat = this._mat(new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.crowd = new THREE.Points(crowdGeo, crowdMat);
    this.group.add(this.crowd);
    this.animated.push({ update: (t) => (crowdMat.opacity = 0.75 + Math.sin(t * 3) * 0.15) });
  }

  _buildLightTowers() {
    const poleMat = this._mat(new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.7, roughness: 0.4 }));
    const panelMat = this._mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xdfe9ff).multiplyScalar(3) }));
    const poleGeo = new THREE.CylinderGeometry(0.5, 0.8, 42, 10);
    const panelGeo = new THREE.BoxGeometry(6, 3, 0.4);
    this.disposables.push(poleGeo, panelGeo);
    const f = {};
    for (let i = 0; i < 10; i++) {
      this.sampleAt((i / 10) * this.length + 30, f);
      const side = i % 2 === 0 ? 1 : -1;
      const p = f.position.clone().addScaledVector(f.normal, side * (this.width / 2 + 40));
      (this.towers ??= []).push({ x: p.x, z: p.z, top: 42, inward: f.position.clone().sub(p).setY(0).normalize() }); // searchlights
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(p.x, 21, p.z);
      const panel = new THREE.Mesh(panelGeo, panelMat);
      panel.position.set(p.x, 42, p.z);
      panel.lookAt(f.position.x, 0, f.position.z);
      this.group.add(pole, panel);
    }
  }

  _buildScreens() {
    const f = {};
    const screens = [
      { s: 140, side: -1, text: 'RAYNE · #20', color: '#ff2a3a' },
      { s: this.length * 0.5, side: 1, text: 'NEON VELODROME', color: '#3fa9ff' },
      { s: this.length * 0.8, side: -1, text: 'FINAL LAP', color: '#ffd400' },
    ];
    for (const sc of screens) {
      this.sampleAt(sc.s, f);
      const p = f.position.clone().addScaledVector(f.normal, sc.side * (this.width / 2 + 34));
      const mat = this._mat(new THREE.MeshBasicMaterial({ map: this._textTexture(sc.text, sc.color, true), transparent: true, side: THREE.DoubleSide }));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(28, 8), mat);
      screen.position.set(p.x, 16, p.z);
      screen.lookAt(f.position.x, 12, f.position.z);
      this.group.add(screen);
      this.animated.push({ update: (t) => (mat.opacity = 0.82 + (Math.random() < 0.02 ? -0.5 : 0) + Math.sin(t * 7 + sc.s) * 0.05) });
    }
  }

  _textTexture(text, color, scanlines = false) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 288;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(4,8,18,0.55)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.font = '700 120px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.fillStyle = color;
    ctx.fillText(text, c.width / 2, c.height / 2 + 6);
    if (scanlines) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let y = 0; y < c.height; y += 6) ctx.fillRect(0, y, c.width, 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(tex);
    return tex;
  }

  update(elapsed) {
    this.animated.forEach((a) => a.update(elapsed));
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose?.());
    this.group.removeFromParent();
  }
}

// =============================================================================
// FLATLINE: 2050 — showcase/set2020.js
// One on-foot world (scenes/onFootWorld.js) dressed with every 2020 location
// the two videos need, laid out side by side so shots can cut between them
// without loading anything:
//
//   ALLEY      (0, 0, 0)     the rainy back alley (dev/footSandbox buildAlley) — wake-up,
//                            radio, guns, lamps, Shadow Step, rewind, sniper (reel)
//   FACTORY    (60, 0, 0)    Elias's burnt factory — the watch stopped at 20:20, the memory
//   OFFICE     (-60, 0, 0)   Victor Hale's office, the city burning beyond the window
//   MIRROR     (0, 0, -60)   the mirror room — Umbra steps out of Kael's reflection
//   STREET     (0, 0, 75)    the district on fire — cars, explosions, people running
//   YARD       (60, 0, 60)   a courtyard with cover for the enemy-AI demo (reel)
//   CORRIDOR   (-60, 0, 60)  the walk into the fire — Elias at the end, Umbra in the way
//
// Lights follow the performance rule (CLAUDE.md): everything is created with
// the level; a few "stage" lights are moved between shots, never added.
// =============================================================================

import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { physics } from '../core/physics.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { createOnFootWorld, ON_FOOT_ASSETS, repeatMaterial } from '../scenes/onFootWorld.js';
import { buildAlley, alleyEcho } from '../dev/footSandbox.js';
import { addShootingRange } from '../dev/shootingRange.js';
import { Umbra } from '../ai/umbraAI.js';
import { fire } from '../systems/fire.js';

export const SET_ASSETS = [
  ...ON_FOOT_ASSETS,
  'props.radio', 'props.dumpster', 'props.ac_unit',
  'characters.victor', 'characters.elias', 'characters.umbra', 'characters.civilian', 'characters.civilian_f',
  'textures.charred', 'textures.burnt_wood', 'textures.tiles',
  'vehicles.car_2020_sedan', 'vehicles.suv', 'vehicles.police_car',
  'voice.m2_clockmaker_01', 'voice.m4_clockmaker_01', 'voice.m5_umbra_01', 'voice.m6_victor_01', 'voice.m8_elias_01',
  'sfx.siren', 'sfx.monitor_beep', 'sfx.ui_glitch', 'sfx.car_crash',
];

export const ZONES = {
  alley: new THREE.Vector3(0, 0, 0),
  factory: new THREE.Vector3(60, 0, 0),
  office: new THREE.Vector3(-60, 0, 0),
  mirror: new THREE.Vector3(0, 0, -60),
  street: new THREE.Vector3(0, 0, 75),
  yard: new THREE.Vector3(60, 0, 60),
  corridor: new THREE.Vector3(-60, 0, 60),
};

/** First clip the actor really has (models differ: Mixamo Kael vs Quaternius stand-ins). */
export function playFirst(actor, names, blend = 0.3, opts = {}) {
  const name = names.find((n) => actor?.hasClip?.(n));
  if (name) actor.play(name, blend, opts);
  return name ?? null;
}

/** A dial stopped at 20:20 (canvas), cracked glass, scorch marks. */
function clockFaceTexture({ burnt = true } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 20, 128, 128, 126);
  g.addColorStop(0, burnt ? '#d8cdb4' : '#ece6d6');
  g.addColorStop(0.75, burnt ? '#a8977a' : '#ddd6c4');
  g.addColorStop(1, burnt ? '#2a1d12' : '#8a8478');
  x.fillStyle = g;
  x.beginPath();
  x.arc(128, 128, 124, 0, Math.PI * 2);
  x.fill();
  x.strokeStyle = '#1a140e';
  x.lineWidth = 3;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const r0 = i % 5 === 0 ? 96 : 104;
    x.lineWidth = i % 5 === 0 ? 4 : 1.5;
    x.beginPath();
    x.moveTo(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0);
    x.lineTo(128 + Math.sin(a) * 112, 128 - Math.cos(a) * 112);
    x.stroke();
  }
  x.fillStyle = '#1a140e';
  x.font = '600 26px Rajdhani, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  [12, 3, 6, 9].forEach((n) => {
    const a = (n / 12) * Math.PI * 2;
    x.fillText(String(n), 128 + Math.sin(a) * 78, 128 - Math.cos(a) * 78);
  });
  const hand = (a, len, w, col = '#120c08') => {
    x.strokeStyle = col;
    x.lineWidth = w;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(128 - Math.sin(a) * 14, 128 + Math.cos(a) * 14);
    x.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
    x.stroke();
  };
  hand(((8 + 20 / 60) / 12) * Math.PI * 2, 58, 9);   // 20:20 → hour hand just past 8
  hand((20 / 60) * Math.PI * 2, 90, 6);               // minute hand on 4
  x.fillStyle = '#120c08';
  x.beginPath();
  x.arc(128, 128, 8, 0, Math.PI * 2);
  x.fill();
  if (burnt) {
    // soot + cracks
    for (let i = 0; i < 26; i++) {
      x.fillStyle = `rgba(20,12,6,${0.08 + Math.random() * 0.22})`;
      x.beginPath();
      x.arc(40 + Math.random() * 176, 40 + Math.random() * 176, 8 + Math.random() * 30, 0, Math.PI * 2);
      x.fill();
    }
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    x.lineWidth = 1.2;
    const crack = (sx, sy, a, n) => {
      let px = sx;
      let py = sy;
      x.beginPath();
      x.moveTo(px, py);
      for (let i = 0; i < n; i++) {
        a += (Math.random() - 0.5) * 0.8;
        px += Math.cos(a) * 14;
        py += Math.sin(a) * 14;
        x.lineTo(px, py);
      }
      x.stroke();
    };
    for (let i = 0; i < 6; i++) crack(170, 92, (i / 6) * Math.PI * 2, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Night skyline with the district burning (Victor's window). */
function skylineTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 460;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#05040a');
  sky.addColorStop(0.45, '#2a0c06');
  sky.addColorStop(0.8, '#a8360c');
  sky.addColorStop(1, '#ff8a2a');
  x.fillStyle = sky;
  x.fillRect(0, 0, c.width, c.height);
  // smoke columns
  for (let i = 0; i < 7; i++) {
    const sx = 80 + i * 140 + Math.random() * 60;
    const g = x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, 'rgba(10,6,6,0)');
    g.addColorStop(0.6, 'rgba(18,10,8,0.85)');
    g.addColorStop(1, 'rgba(30,14,8,0.2)');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(sx - 18, c.height);
    x.bezierCurveTo(sx - 90, c.height * 0.5, sx + 60, c.height * 0.3, sx - 40, 0);
    x.lineTo(sx + 120, 0);
    x.bezierCurveTo(sx + 140, c.height * 0.3, sx + 30, c.height * 0.5, sx + 24, c.height);
    x.fill();
  }
  // buildings
  let bx = 0;
  while (bx < c.width) {
    const w = 30 + Math.random() * 70;
    const h = 90 + Math.random() * 230;
    x.fillStyle = '#060406';
    x.fillRect(bx, c.height - h, w, h);
    for (let wy = c.height - h + 10; wy < c.height - 10; wy += 14) {
      for (let wx = bx + 5; wx < bx + w - 6; wx += 10) {
        if (Math.random() < 0.3) {
          x.fillStyle = Math.random() < 0.3 ? '#ff7a2a' : '#e8b060';
          x.fillRect(wx, wy, 4, 6);
        }
      }
    }
    bx += w + 2;
  }
  // fire glow along the bottom
  const fireG = x.createLinearGradient(0, c.height * 0.75, 0, c.height);
  fireG.addColorStop(0, 'rgba(255,120,30,0)');
  fireG.addColorStop(1, 'rgba(255,150,60,0.9)');
  x.fillStyle = fireG;
  x.fillRect(0, c.height * 0.75, c.width, c.height * 0.25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Build the set. Returns the on-foot world; world.level holds the set API:
 *   level.zones, level.stage(i, {...}), level.actors, level.umbra, level.watch,
 *   level.range, level.enemies, level.clearFires(), level.rain(on), level.umbraActive
 */
export function createShowcaseSet(renderer, assets) {
  const world = createOnFootWorld(renderer, assets, {
    spawn: [0, 0, -11],
    yaw: 0,
    fog: 0.032,
    rain: false,
    rainFX: true,
    echo: alleyEcho,
    exitTitle: 'Stop the video?',
    build: (kit) => buildSet(kit),
  });
  // Videos never touch the save or kill Kael: no incendiary achievement counter, no damage.
  world.weapons.onIncendiary = (point, normal, collider, target) => {
    if (!target) fire.ignite(point.clone().addScaledVector(normal, 0.05), { size: 0.8, fuel: 8 });
  };
  const p = world.player;
  p.hurt = (amount) => {
    if (amount >= 4 && p.state === 'move' && !p.cinematic) p.hitReaction?.();
  };
  if (world.rain) {
    world.rain.storm = false; // lightning only when a shot asks for it
    world.rain.lines.visible = false;
  }
  return world;
}

function buildSet(kit) {
  const { THREE: T, scene, mats, addBox, addProp, addLamp, addCover, assets, ai, player, weapons, fx, rig } = kit;
  const R = physics.RAPIER;
  const track = kit.track;
  const Z = ZONES;
  const charred = track(repeatMaterial(assets.get('textures.charred'), 3, 2, 0x141110));
  const burntWood = track(repeatMaterial(assets.get('textures.burnt_wood'), 1, 3, 0x2a1d16));
  const tiles = track(repeatMaterial(assets.get('textures.tiles'), 6, 5, 0xb8bcc0));
  const black = track(new T.MeshStandardMaterial({ color: 0x07070a, roughness: 0.6, metalness: 0.2 }));
  const glossy = track(new T.MeshStandardMaterial({ color: 0x0a0a10, roughness: 0.12, metalness: 0.6 }));
  const neon = (hex, k = 3) => track(new T.MeshBasicMaterial({ color: new T.Color(hex).multiplyScalar(k), toneMapped: false }));
  const plane = (w, h, mat, pos, rotX = -Math.PI / 2, rotY = 0) => {
    const m = new T.Mesh(track(new T.PlaneGeometry(w, h)), mat);
    m.position.set(...pos);
    m.rotation.set(rotX, rotY, 0, 'YXZ');
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const actors = {};
  const spawnActor = (name, key, pos, yaw, clips = ['idle']) => {
    const tpl = assets.get(key);
    const a = new Actor(name, createModelInstance(tpl), tpl.animations);
    a.object.traverse((o) => o.isMesh && (o.castShadow = true));
    scene.add(a.object);
    a.place(pos, yaw);
    playFirst(a, clips, 0.01);
    return a;
  };

  // ---- stage lights: moved between shots, never added later ----------------------------------------------
  const stageLights = [0, 1, 2].map(() => {
    const l = new T.PointLight(0xffffff, 0, 12, 2);
    scene.add(l);
    return l;
  });
  const spot = new T.SpotLight(0xffffff, 0, 30, 0.45, 0.6, 1.5);
  scene.add(spot, spot.target);
  function stage(i, { pos, color = 0xffffff, intensity = 0, distance = 12 } = {}) {
    const l = i === 'spot' ? spot : stageLights[i];
    if (pos) l.position.set(...pos);
    l.color.set(color);
    l.intensity = intensity;
    l.distance = distance;
    return l;
  }
  const stageOff = () => {
    stageLights.forEach((l) => (l.intensity = 0));
    spot.intensity = 0;
  };

  // =====================================================================================================
  // ALLEY — the sandbox alley, a radio on the low wall, targets for the reel
  // =====================================================================================================
  buildAlley(kit);
  const radio = addProp('props.radio', [1.4, 0.95, -2.05], 0.35, { collide: false });
  const radioGlow = new T.Mesh(track(new T.PlaneGeometry(0.08, 0.03)), neon(0xffb347, 2));
  radioGlow.position.set(1.4, 1.08, -1.93);
  scene.add(radioGlow);
  const range = addShootingRange({
    scene, assets, weapons, fx,
    dummies: [{ position: [1.6, 0, 11.5], yaw: Math.PI }, { position: [-2.4, 1.08, 26], yaw: Math.PI }, { position: [2.8, 0, 21.5], yaw: Math.PI * 1.1 }],
    barrel: [3.4, 0, 16.2],
  });
  kit.addFragment([3.9, 0, 12.6], 'Dad used to hum while he soldered. Always the same song.');

  // =====================================================================================================
  // FACTORY — burnt shell, the workbench, the watch stopped at 20:20
  // =====================================================================================================
  const F = Z.factory;
  const f = (x, y, z) => [F.x + x, F.y + y, F.z + z];
  plane(24, 22, charred, f(0, 0.012, -2));
  addBox([24, 8, 0.6], f(0, 4, -13), charred);
  addBox([0.6, 8, 22], f(-12, 4, -2), charred);
  addBox([0.6, 8, 22], f(12, 4, -2), charred);
  addBox([7, 8, 0.6], f(-8.5, 4, 9), charred);
  addBox([7, 8, 0.6], f(8.5, 4, 9), charred);
  [[-6, -6], [6, -6], [-6, 3], [6, 3]].forEach(([x, z]) => addBox([0.6, 8, 0.6], f(x, 4, z), burntWood));
  // fallen roof beams
  [[-3, 0.25, -4, 0.5, 0.15], [4, 0.6, 0, -0.7, 0.3], [-7, 1.2, 5, 1.1, 0.5], [2, 3.5, -10, 0.2, 0.9]].forEach(([x, y, z, ry, rz]) => {
    const b = addBox([0.4, 0.4, 9], f(x, y, z), burntWood, { collide: false, rotY: ry });
    b.rotation.z = rz;
  });
  // machines
  [[-9, -10, 2.2, 2.6, 2], [9, -10, 2.6, 3.2, 2.2], [-9, 4, 2, 1.6, 3]].forEach(([x, z, w, h, d]) => addBox([w, h, d], f(x, h / 2, z), mats.metal, { surface: 'metal' }));
  // workbench + the magnetic engine (cold blue: the invention)
  addBox([3, 0.9, 1.2], f(0, 0.45, -8), mats.metal, { surface: 'metal' });
  const engineMat = track(new T.MeshStandardMaterial({ color: 0x8a9ab0, metalness: 1, roughness: 0.25, emissive: new T.Color(0x3fa9ff), emissiveIntensity: 0.9 }));
  const engine = new T.Mesh(track(new T.TorusGeometry(0.36, 0.13, 14, 32)), engineMat);
  engine.position.set(...f(0.3, 1.25, -8));
  engine.rotation.x = Math.PI / 2.4;
  engine.castShadow = true;
  scene.add(engine);
  // the watch, face up on the ash
  const watch = new T.Group();
  const caseMat = track(new T.MeshStandardMaterial({ color: 0x3a2c22, metalness: 0.85, roughness: 0.45 }));
  const watchCase = new T.Mesh(track(new T.CylinderGeometry(0.052, 0.055, 0.016, 40)), caseMat);
  const bezel = new T.Mesh(track(new T.TorusGeometry(0.05, 0.006, 10, 40)), caseMat);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.y = 0.008;
  const face = new T.Mesh(track(new T.CircleGeometry(0.046, 40)), track(new T.MeshStandardMaterial({ map: track(clockFaceTexture()), roughness: 0.35, metalness: 0.05, emissive: 0x2a1a0a, emissiveIntensity: 0.25 })));
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.0085;
  const crown = new T.Mesh(track(new T.CylinderGeometry(0.008, 0.008, 0.014, 12)), caseMat);
  crown.rotation.z = Math.PI / 2;
  crown.position.set(0.062, 0, 0);
  const strapMat = track(new T.MeshStandardMaterial({ color: 0x140e0a, roughness: 0.95 }));
  [-1, 1].forEach((s) => {
    const strap = new T.Mesh(track(new T.BoxGeometry(0.036, 0.004, 0.12)), strapMat);
    strap.position.set(0, -0.004, s * 0.11);
    strap.rotation.x = s * 0.12;
    watch.add(strap);
  });
  watch.add(watchCase, bezel, face, crown);
  watch.position.set(...f(1.6, 0.02, -1.4));
  watch.rotation.y = -0.5;
  watch.traverse((o) => o.isMesh && (o.castShadow = true));
  scene.add(watch);
  // Elias in the memory (hidden until the flashback)
  actors.elias = spawnActor('elias', 'characters.elias', f(0, 0, -9.2), 0, ['interact', 'idle']);
  actors.elias.object.visible = false;
  [f(-6, 0.4, -10), f(6, 0.5, -9), f(-4, 0.3, -2), f(5, 0.3, 2), f(-9, 0.4, 5)].forEach((p) => kit.addFlammable(p, 1.2));

  // =====================================================================================================
  // OFFICE — Victor Hale at the window, the district burning outside
  // =====================================================================================================
  const O = Z.office;
  const o = (x, y, z) => [O.x + x, O.y + y, O.z + z];
  plane(12, 11, tiles, o(0, 0.012, -0.5));
  const wallMat = track(new T.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.8 }));
  addBox([12, 1, 0.4], o(0, 0.5, -6), wallMat);          // under the window
  addBox([12, 1.6, 0.4], o(0, 5.2, -6), wallMat);        // above it
  addBox([2, 6, 0.4], o(-5, 3, -6), wallMat);
  addBox([2, 6, 0.4], o(5, 3, -6), wallMat);
  addBox([0.4, 6, 11], o(-6, 3, -0.5), wallMat);
  addBox([0.4, 6, 11], o(6, 3, -0.5), wallMat);
  addBox([12, 0.3, 11], o(0, 6.1, -0.5), wallMat, { cast: false });
  const skyline = plane(8.4, 3.8, track(new T.MeshBasicMaterial({ map: track(skylineTexture()), toneMapped: true })), o(0, 2.75, -6.6), 0);
  // window mullions
  [-2, 0, 2].forEach((x) => addBox([0.08, 3.6, 0.08], o(x, 2.8, -5.85), black, { collide: false, cast: false }));
  addBox([8, 0.08, 0.08], o(0, 2.8, -5.85), black, { collide: false, cast: false });
  const deskMat = track(new T.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.35, metalness: 0.1 }));
  addBox([2.6, 0.08, 1.2], o(0.6, 0.78, -2), deskMat);
  addBox([0.08, 0.74, 1.1], o(-0.65, 0.37, -2), deskMat);
  addBox([0.08, 0.74, 1.1], o(1.85, 0.37, -2), deskMat);
  const lampShade = new T.Mesh(track(new T.ConeGeometry(0.16, 0.2, 20, 1, true)), track(new T.MeshStandardMaterial({ color: 0x1a3020, emissive: 0xffc070, emissiveIntensity: 0.6, side: T.DoubleSide })));
  lampShade.position.set(...o(1.5, 1.2, -2.2));
  scene.add(lampShade);
  actors.victor = spawnActor('victor', 'characters.victor', o(0, 0, -4.8), Math.PI, ['idle']);

  // =====================================================================================================
  // MIRROR ROOM — a real reflection, violet neon, Umbra
  // =====================================================================================================
  const M = Z.mirror;
  const m = (x, y, z) => [M.x + x, M.y + y, M.z + z];
  plane(14, 14, glossy, m(0, 0.012, -1));
  addBox([14, 6, 0.4], m(0, 3, -8), black);
  addBox([0.4, 6, 14], m(-7, 3, -1), black);
  addBox([0.4, 6, 14], m(7, 3, -1), black);
  addBox([14, 0.3, 14], m(0, 6.1, -1), black, { cast: false });
  let mirror = null;
  try {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    mirror = new Reflector(new T.PlaneGeometry(4.4, 3.3), { color: 0x8c8c96, textureWidth: Math.round(900 * dpr), textureHeight: Math.round(675 * dpr), clipBias: 0.003 });
    mirror.position.set(...m(0, 1.75, -7.75));
    scene.add(mirror);
  } catch (err) {
    console.warn('[showcase] mirror reflection unavailable', err);
  }
  const violet = neon(0x8a4dff, 3.2);
  // neon frame around the mirror + floor lines
  [[0, 3.48, -7.7, 4.8, 0.05], [0, 0.04, -7.7, 4.8, 0.05]].forEach(([x, y, z, w, h]) => addBox([w, h, 0.05], m(x, y, z), violet, { collide: false, cast: false }));
  [-2.38, 2.38].forEach((x) => addBox([0.05, 3.45, 0.05], m(x, 1.75, -7.7), violet, { collide: false, cast: false }));
  [-3.5, 3.5].forEach((x) => addBox([0.05, 0.02, 12], m(x, 0.02, -1), violet, { collide: false, cast: false }));
  // angled panels (the maze), polished black
  const panelMat = track(new T.MeshStandardMaterial({ color: 0x0c0c14, roughness: 0.05, metalness: 1 }));
  [[-4.8, -4.5, 0.7], [4.8, -4.5, -0.7], [-5.2, 1, 1.2], [5.2, 1, -1.2]].forEach(([x, z, r]) => addBox([2.6, 3.4, 0.08], m(x, 1.7, z), panelMat, { rotY: r, collide: false }));

  // Umbra (dormant until a shot or the boss demo wakes him)
  const umbra = new Umbra({ scene, assets, player, weapons, fx, rig, position: m(0, 0, -6.6), arena: [m(-3, 0, -3), m(3, 0, -3), m(0, 0, 1)].map((p) => new T.Vector3(...p)) });
  umbra.state = 'dormant';
  umbra.model.visible = false;
  umbra.light.intensity = 0;
  const offUmbraFixed = physics.onFixedUpdate((dt) => umbraFight && umbra.fixedUpdate(dt));
  let umbraFight = false;

  // =====================================================================================================
  // STREET — the district on fire
  // =====================================================================================================
  const S = Z.street;
  const s = (x, y, z) => [S.x + x, S.y + y, S.z + z];
  const winLit = neon(0xffb36a, 1.4);
  const winFire = track(new T.MeshBasicMaterial({ color: new T.Color(0xff6a1a).multiplyScalar(2.2), toneMapped: false }));
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let z = -22; z <= 24; z += 11) {
    for (const side of [-1, 1]) {
      const h = 10 + rnd() * 12;
      addBox([10, h, 10], s(side * 13.2, h / 2, z), mats.brick);
      for (let wy = 2.6; wy < h - 1; wy += 3.2) {
        for (let wz = -3.5; wz <= 3.5; wz += 2.3) {
          if (rnd() < 0.35) continue;
          const w = plane(1.1, 1.5, rnd() < 0.3 ? winFire : winLit, s(side * 8.15, wy, z + wz), 0, side < 0 ? Math.PI / 2 : -Math.PI / 2);
          w.receiveShadow = false;
        }
      }
    }
  }
  addBox([2.4, 0.15, 50], s(-6.8, 0.075, 0), mats.concrete);
  addBox([2.4, 0.15, 50], s(6.8, 0.075, 0), mats.concrete);
  addBox([30, 14, 1], s(0, 7, 26.5), mats.brick);           // street end (far)
  const sedan = addProp('vehicles.car_2020_sedan', s(-3.4, 0, -10), 0.5, { surface: 'metal' });
  const suv = addProp('vehicles.suv', s(3.2, 0, 6), -0.4, { surface: 'metal' });
  suv.rotation.z = Math.PI * 0.95; // flipped onto its roof
  suv.position.y += 1.7;
  const police = addProp('vehicles.police_car', s(-2.2, 0, 15), -0.35, { surface: 'metal' });
  void sedan;
  void police;
  addProp('props.barrel_explosive', s(4.6, 0, -6), 0, { surface: 'metal' });
  addProp('props.barrel_explosive', s(-5.2, 0, 2), 0, { surface: 'metal' });
  addProp('props.dumpster', s(5.6, 0, 18), 0.1, { surface: 'metal' });
  [s(-3.4, 0.8, -10), s(3.2, 0.6, 6), s(-2.2, 0.8, 15), s(5.6, 0.9, 18), s(-6, 0.4, -4), s(6, 0.4, 10)].forEach((p) => kit.addFlammable(p, 1.5));
  const civilians = [
    spawnActor('civ1', 'characters.civilian', s(-1.5, 0, 22), Math.PI, ['idle']),
    spawnActor('civ2', 'characters.civilian_f', s(1.8, 0, 24), Math.PI, ['idle']),
    spawnActor('civ3', 'characters.civilian', s(-3.6, 0, 26), Math.PI, ['idle']),
  ];
  actors.civilians = civilians;

  // =====================================================================================================
  // YARD — cover for the enemy-AI demo (reel)
  // =====================================================================================================
  const Y = Z.yard;
  const y = (x, yy, z) => [Y.x + x, Y.y + yy, Y.z + z];
  plane(28, 28, track(repeatMaterial(assets.get('textures.concrete'), 7, 7, 0x5a5a5a)), y(0, 0.012, 2));
  addBox([28, 3.2, 0.6], y(0, 1.6, 16), mats.brick);
  addBox([0.6, 3.2, 28], y(-14, 1.6, 2), mats.brick);
  addBox([0.6, 3.2, 28], y(14, 1.6, 2), mats.brick);
  addBox([10, 3.2, 0.6], y(-9, 1.6, -12), mats.brick);
  addBox([10, 3.2, 0.6], y(9, 1.6, -12), mats.brick);
  [[-4, -2, 2.6, 1.1, 0.6], [4, 0, 2.6, 1.1, 0.6], [-2, 6, 2.2, 1.1, 0.6], [5, 8, 1.4, 2.4, 1.4], [-7, 9, 1.4, 2.4, 1.4], [0, 2.5, 1.2, 1.2, 1.2]].forEach(([x, z, w, h, d], i) => {
    if (h > 2) addBox([w, h, d], y(x, h / 2, z), mats.metal, { surface: 'metal' });
    else if (i === 5) addProp('props.crate', y(x, 0, z), 0.3, { surface: 'wood' });
    else addBox([w, h, d], y(x, h / 2, z), mats.concrete);
    const low = h < 2;
    for (const [dx, dz] of [[0, -1.1], [0, 1.1], [-1.2, 0], [1.2, 0]]) addCover(y(x + dx, 0, z + dz), low);
  });
  addLamp(y(-13.2, 0, -2), { rotY: Math.PI / 2, intensity: 26, reach: 14 });
  addLamp(y(13.2, 0, 8), { rotY: -Math.PI / 2, intensity: 26, reach: 14 });
  const enemies = [
    ai.spawn({ position: y(-3, 0, 11), yaw: Math.PI, patrol: [y(-3, 0, 11), y(3, 0, 11)] }),
    ai.spawn({ position: y(4, 0, 13), yaw: Math.PI, patrol: [] }),
    ai.spawn({ position: y(-8, 0, 13), yaw: Math.PI, patrol: [y(-8, 0, 13), y(-8, 0, 6)] }),
  ];

  // =====================================================================================================
  // CORRIDOR — the walk into the fire, Elias at the end
  // =====================================================================================================
  const C = Z.corridor;
  const c = (x, yy, z) => [C.x + x, C.y + yy, C.z + z];
  plane(8.6, 46, charred, c(0, 0.012, 4));
  addBox([0.6, 8, 44], c(-4.3, 4, 4), charred);
  addBox([0.6, 8, 44], c(4.3, 4, 4), charred);
  addBox([9, 8, 0.6], c(0, 4, 26.3), charred);
  addBox([9, 0.4, 44], c(0, 8.2, 4), charred, { cast: false });
  [-12, -4, 4, 12].forEach((z) => addBox([8, 0.5, 0.5], c(0, 7.6, z), burntWood, { collide: false }));
  addBox([2.6, 0.9, 1.1], c(1.6, 0.45, 23.6), mats.metal, { surface: 'metal' });
  const engine2 = engine.clone();
  engine2.position.set(...c(1.8, 1.25, 23.6));
  scene.add(engine2);
  actors.eliasEnd = spawnActor('elias2', 'characters.elias', c(0, 0, 22.4), Math.PI, ['idle']);

  // ---------------------------------------------------------------------------------------------------
  let rainOn = false;
  const offs = [offUmbraFixed];
  return {
    zones: Z,
    stage,
    stageOff,
    spot,
    actors,
    umbra,
    watch,
    radio,
    engine,
    skyline,
    mirror,
    range,
    enemies,
    winFire,
    get umbraFight() {
      return umbraFight;
    },
    set umbraFight(v) {
      umbraFight = v;
      umbra.state = v ? 'fight' : 'dormant';
    },
    umbraActive: false,
    rain(on) {
      rainOn = on;
      if (kit.rain) kit.rain.lines.visible = on;
    },
    get raining() {
      return rainOn;
    },
    clearFires() {
      fire.fires.slice().forEach((fl) => fire._remove(fl));
    },
    update(dt) {
      range.update(dt);
      Object.values(actors).flat().forEach((a) => a.update?.(dt));
      if (this.umbraActive) umbra.update(dt);
      engine.rotation.z += dt * 0.6;
      engine2.rotation.z += dt * 0.6;
      winFire.color.setRGB(2.2 + Math.random() * 0.6, 0.9 + Math.random() * 0.25, 0.2);
    },
    dispose() {
      offs.forEach((off) => off());
      range.dispose();
      umbra.dispose();
      mirror?.dispose?.();
      Object.values(actors).flat().forEach((a) => a.object?.removeFromParent());
    },
  };
}

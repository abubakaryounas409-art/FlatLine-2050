// =============================================================================
// FLATLINE: 2050 — scenes/garageScene.js
// Main-menu background: Kael's 2050 car in a dark garage, flickering neon,
// a slow orbiting camera, and Kael standing by the car in an idle pose.
//
// The garage is built in code. If public/models/env/garage.glb exists it is
// placed on top (the procedural floor and lights stay).
//
// Extra API used by the boot intro / menu:
//   powerOn(seconds)           lights flicker on one by one (garage reveal)
//   setFraming(x, seconds)     shift the subject right so the menu fits on the left
//   setAtmosphere({ embers, smoke })   0..1 strength of the screen embers / side smoke
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { BatchedRenderer } from 'three.quarks';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

import { CONFIG } from '../config.js';
import { MODELS } from '../assets/manifest.js';
import { createModelInstance } from '../assets/loader.js';
import { styleCar2050, styleKael2050 } from '../assets/modelStyles.js';
import { Actor } from '../cutscenes/actor.js';
import { createEmbers } from '../vfx/fireFX.js';
import { createShadowSmoke } from '../vfx/smokeFX.js';
import { glowTexture } from '../vfx/particleTextures.js';
import { AmbientLife } from '../vfx/ambientLife.js';
import { holoScreen } from '../vfx/ambientStadium.js';

const BLUE = CONFIG.colors.time;
const ORANGE = CONFIG.colors.fire;
const PURPLE = 0x8a4dff;

// Camera: a slow arc around a 3/4-front "hero" angle of the car (radians,
// 0 = camera on +Z). An arc keeps Kael beside the car, never in front of it.
const USE_GARAGE_MODEL = false; // set true to layer public/models/env/garage.glb over the procedural room

const ORBIT = {
  radius: 8.4,
  height: 1.75,
  bob: 0.22,
  hero: 0.02,
  sweep: 0.55,      // ± radians around the hero angle
  speed: 0.05,      // arc cycles per second × 2π
  target: new THREE.Vector3(0, 0.7, 0),
};

export function createGarageScene(renderer, assets) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x05060c, 16, 40);

  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 120);
  scene.add(camera); // camera children (screen-anchored particles) must be in the scene

  const disposables = [];
  const track = (...items) => (disposables.push(...items), items[0]);

  // Everything except camera-anchored particles lives in `garage`, so the boot
  // intro can show pure black + particles, then power the garage on.
  const garage = new THREE.Group();
  scene.add(garage);

  // ---------------------------------------------------------------------------
  // Environment lighting (reflections on the car paint)
  // ---------------------------------------------------------------------------
  const hdri = assets.get('hdri.stadium_2050');
  if (hdri?.texture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = track(pmrem.fromEquirectangular(hdri.texture).texture);
    pmrem.dispose();
  }
  scene.environmentIntensity = 0; // powered on with the lights

  // ---------------------------------------------------------------------------
  // Room
  // ---------------------------------------------------------------------------
  const wallMat = track(new THREE.MeshStandardMaterial({ color: 0x0c0c11, roughness: 0.92, metalness: 0.05 }));
  const room = new THREE.Mesh(track(new THREE.BoxGeometry(30, 8, 26)), wallMat);
  room.material.side = THREE.BackSide;
  room.position.y = 4;
  room.receiveShadow = true;
  garage.add(room);

  // Floor: a mirror underneath a dark, slightly see-through floor = glossy
  // wet-concrete look. The mirror is skipped on Low graphics.
  let reflector = null;
  const floorMat = track(
    new THREE.MeshStandardMaterial({ color: 0x0b0b0f, roughness: 0.5, metalness: 0.35, transparent: true, opacity: 0.86 }),
  );
  const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(30, 26)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.002;
  floor.receiveShadow = true;
  garage.add(floor);

  function buildReflector(scale) {
    if (reflector) {
      garage.remove(reflector);
      reflector.dispose();
      reflector = null;
    }
    if (!scale) {
      floorMat.opacity = 1;
      floorMat.transparent = false;
      floorMat.needsUpdate = true;
      return;
    }
    floorMat.opacity = 0.86;
    floorMat.transparent = true;
    floorMat.needsUpdate = true;
    const ratio = Math.min(window.devicePixelRatio, 2);
    reflector = new Reflector(new THREE.PlaneGeometry(30, 26), {
      clipBias: 0.003,
      textureWidth: window.innerWidth * ratio * scale,
      textureHeight: window.innerHeight * ratio * scale,
      color: 0x8a8a90,
    });
    reflector.rotation.x = -Math.PI / 2;
    garage.add(reflector);
  }

  // Skirting LED line along the walls
  const ledMat = track(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: BLUE, emissiveIntensity: 0 }));
  [
    [0, -12.95, 30, 0],
    [-14.95, 0, 26, Math.PI / 2],
    [14.95, 0, 26, Math.PI / 2],
  ].forEach(([x, z, len, rot]) => {
    const led = new THREE.Mesh(track(new THREE.BoxGeometry(len, 0.03, 0.03)), ledMat);
    led.position.set(x, 0.25, z);
    led.rotation.y = rot;
    garage.add(led);
  });

  // ---------------------------------------------------------------------------
  // Neon: ceiling tubes (flicker) + coloured wall tubes
  // ---------------------------------------------------------------------------
  const tubes = []; // { mesh, material, base, on, flickerUntil, chance, light? }
  const tubeGeo = track(new THREE.CylinderGeometry(0.035, 0.035, 3.2, 12));

  function addTube({ position, rotation, color, intensity, chance, light }) {
    const material = track(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 0 }));
    const mesh = new THREE.Mesh(tubeGeo, material);
    mesh.position.copy(position);
    mesh.rotation.set(...rotation);
    garage.add(mesh);
    const tube = { mesh, material, base: intensity, on: 0, power: 0, flickerUntil: 0, chance, light, lightBase: light?.intensity ?? 0 };
    if (light) light.intensity = 0;
    tubes.push(tube);
    return tube;
  }

  // Two rows of cool-white ceiling tubes above the car. One is "broken".
  for (let i = 0; i < 6; i++) {
    const x = (i % 3 - 1) * 2.4;
    const z = i < 3 ? -1.4 : 1.4;
    addTube({
      position: new THREE.Vector3(x, 6.2, z),
      rotation: [0, 0, Math.PI / 2],
      color: 0xdbe9ff,
      intensity: 7,
      chance: i === 4 ? 0.35 : 0.02, // the broken one flickers far more often
    });
  }

  // Coloured vertical tubes on the back and side walls (theme colours)
  const wallTubes = [
    [ORANGE, -9, -12.8, 0.6],
    [BLUE, 9, -12.8, 0.4],
    [PURPLE, -14.8, -5, 0.8],
    [BLUE, 14.8, -5, 0.5],
    [ORANGE, 14.8, 5, 0.3],
  ];
  wallTubes.forEach(([color, x, z, chance]) => {
    const light = new THREE.PointLight(color, 9, 12, 1.6);
    light.position.set(x * 0.9, 2.2, z * 0.9);
    garage.add(light);
    addTube({ position: new THREE.Vector3(x, 2.3, z), rotation: [0, 0, 0], color, intensity: 9, chance: chance * 0.05, light });
  });

  // ---------------------------------------------------------------------------
  // Key light over the car + a soft visible light beam
  // ---------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0x30344a, 0x050505, 0);
  garage.add(hemi);

  const key = new THREE.SpotLight(0xe6eeff, 0, 16, Math.PI / 5.5, 0.6, 1.4);
  key.position.set(0, 6.1, 0);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(2048);
  key.shadow.bias = -0.0002;
  key.shadow.radius = 5;
  garage.add(key, key.target);
  const KEY_INTENSITY = 105;

  const rimL = new THREE.SpotLight(ORANGE, 0, 18, Math.PI / 7, 0.8, 1.5);
  rimL.position.set(-7, 3.2, -6);
  const rimR = new THREE.SpotLight(BLUE, 0, 18, Math.PI / 7, 0.8, 1.5);
  rimR.position.set(7, 3.2, -6);
  garage.add(rimL, rimR);
  const RIM_INTENSITY = 70;

  // Light beam: an open cone that fades toward the floor and at its edges.
  const beamMat = track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xbfd6ff) } },
      vertexShader: /* glsl */ `
        varying float vHeight;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vHeight = uv.y;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vHeight;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          float edge = pow(abs(dot(vNormalV, vViewDir)), 1.6);   // soft silhouette
          float fall = smoothstep(0.0, 0.9, vHeight);              // fade near the floor
          gl_FragColor = vec4(uColor, uOpacity * edge * fall);
        }`,
    }),
  );
  const beam = new THREE.Mesh(track(new THREE.CylinderGeometry(0.25, 3.6, 6.1, 48, 1, true)), beamMat);
  beam.position.y = 3.05;
  beam.renderOrder = 3;
  garage.add(beam);

  // ---------------------------------------------------------------------------
  // Turntable platform with a pulsing TIME-blue ring
  // ---------------------------------------------------------------------------
  const platform = new THREE.Mesh(
    track(new THREE.CylinderGeometry(3.3, 3.4, 0.08, 64)),
    track(new THREE.MeshStandardMaterial({ color: 0x0e0e12, metalness: 0.7, roughness: 0.45, envMapIntensity: 0.25 })),
  );
  platform.position.y = 0.04;
  platform.receiveShadow = true;
  garage.add(platform);

  const ringMat = track(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: BLUE, emissiveIntensity: 0 }));
  const ring = new THREE.Mesh(track(new THREE.TorusGeometry(3.32, 0.025, 8, 128)), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.085;
  garage.add(ring);

  // ---------------------------------------------------------------------------
  // Kael's car — restyled white/red with neon underglow
  // ---------------------------------------------------------------------------
  const carTemplate = assets.get('vehicles.car_2050_kael');
  const car = createModelInstance(carTemplate);
  car.position.y = 0.08;
  car.rotation.y = Math.PI * 0.82;
  if (!carTemplate.isPlaceholder) styleCar2050(car, track);
  garage.add(car);

  const underglow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(4.8, 7.2)), // wider than the car so the glow spills out
    track(
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color: new THREE.Color(BLUE).multiplyScalar(0),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    ),
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.01; // car origin sits at floor level
  car.add(underglow);          // inherits the car's rotation
  const underLight = new THREE.PointLight(BLUE, 0, 5, 2);
  underLight.position.set(0, 0.25, 0);
  car.add(underLight);

  // ---------------------------------------------------------------------------
  // Kael (2050 racing suit) — placeholder capsule until kael_2050.glb exists
  // ---------------------------------------------------------------------------
  // An Actor, so cutscenes can direct him (world.actors.kael).
  const kaelTemplate = assets.get('characters.kael_2050');
  const kael = createModelInstance(kaelTemplate);
  if (!kaelTemplate.isPlaceholder) styleKael2050(kael, track);
  const KAEL_HOME = { position: [2.25, 0.08, 1.9], yaw: -0.45 }; // front-right of the car, in view of the menu camera's whole arc
  garage.add(kael);
  const kaelActor = new Actor('kael', kael, kaelTemplate.animations);
  kaelActor.place(KAEL_HOME.position, KAEL_HOME.yaw);
  kaelActor.play('idle', 0.01);
  const animated = !!kaelActor.mixer;

  // ---------------------------------------------------------------------------
  // Props: tool cabinets, tyre stack, team sign
  // ---------------------------------------------------------------------------
  const cabinetMat = track(new THREE.MeshStandardMaterial({ color: 0x5a0d14, metalness: 0.6, roughness: 0.4 }));
  const cabinetGeo = track(new THREE.BoxGeometry(1.6, 1.1, 0.7));
  [-6.5, -4.8].forEach((x) => {
    const cab = new THREE.Mesh(cabinetGeo, cabinetMat);
    cab.position.set(x, 0.55, -12.4);
    cab.castShadow = cab.receiveShadow = true;
    garage.add(cab);
  });

  const tyreMat = track(new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.85 }));
  const tyreGeo = track(new THREE.TorusGeometry(0.38, 0.17, 12, 32));
  for (let i = 0; i < 4; i++) {
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    tyre.rotation.x = Math.PI / 2;
    tyre.position.set(6.2 + (i % 2) * 0.05, 0.17 + i * 0.33, -11.6);
    tyre.castShadow = true;
    garage.add(tyre);
  }

  const signMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: track(makeSignTexture()),
      emissiveIntensity: 0,
    }),
  );
  const sign = new THREE.Mesh(track(new THREE.PlaneGeometry(6, 1.5)), signMat);
  sign.position.set(0, 4.4, -12.94);
  garage.add(sign);

  // Back-wall LED backdrop: soft blue → purple glow with vertical light panels,
  // so the space behind the car reads as a lit garage instead of a black void.
  const backdropTex = (() => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0, '#120a26');
    grad.addColorStop(0.5, '#0a1a33');
    grad.addColorStop(1, '#1a0c2c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 256);
    const v = g.createLinearGradient(0, 0, 0, 256); // brighter near the floor
    v.addColorStop(0, 'rgba(0,0,0,0.65)');
    v.addColorStop(1, 'rgba(63,169,255,0.18)');
    g.fillStyle = v;
    g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 9; i++) { // vertical light panels
      const x = 24 + i * 58;
      const pg = g.createLinearGradient(x, 0, x + 10, 0);
      const col = i % 3 === 1 ? '154,92,255' : '63,169,255';
      pg.addColorStop(0, `rgba(${col},0)`);
      pg.addColorStop(0.5, `rgba(${col},0.55)`);
      pg.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = pg;
      g.fillRect(x, 30, 10, 200);
    }
    g.strokeStyle = 'rgba(120,160,255,0.06)'; // faint panel grid
    for (let x = 0; x <= 512; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
    for (let y = 0; y <= 256; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
    const t = track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const backdropMat = track(
    new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.6, emissive: 0xffffff, emissiveMap: backdropTex, emissiveIntensity: 0, fog: false }),
  );
  [[0, -12.97, 0, 28], [-14.97, 0, Math.PI / 2, 24], [14.97, 0, -Math.PI / 2, 24]].forEach(([x, z, ry, w]) => {
    const wall = new THREE.Mesh(track(new THREE.PlaneGeometry(w, 6.5)), backdropMat);
    wall.position.set(x, 3.4, z);
    wall.rotation.y = ry;
    garage.add(wall);
  });

  // Optional downloaded garage model on top of the procedural room.
  const garageModel = assets.get('env.garage');
  // Off by default: the current env/garage.glb is a wooden shed that blacks out the neon backdrop.
  if (USE_GARAGE_MODEL && garageModel && !garageModel.isPlaceholder) garage.add(createModelInstance(garageModel));
  else if (MODELS.env.garage) console.info('[garage] Using the procedural garage (env/garage.glb is optional).');

  // ---------------------------------------------------------------------------
  // Particles: dust in the light beam (world) + embers / shadow smoke (screen)
  // ---------------------------------------------------------------------------
  const batch = new BatchedRenderer();
  scene.add(batch);

  const dust = createEmbers({ width: 3, depth: 3, rate: 10, worldSpace: true });
  dust.emitter.position.set(0, 0.5, 0);
  dust.emitter.rotation.x = -Math.PI / 2;
  garage.add(dust.emitter);
  batch.addSystem(dust);
  tintDust(dust);

  // Screen-anchored atmosphere: attached to the camera so it frames the view.
  const atmosphere = new THREE.Group();
  atmosphere.position.z = -5;
  camera.add(atmosphere);

  // Not prewarmed: when switched on they rise in from below the frame.
  const embers = createEmbers({ width: 9, depth: 1.5, rate: 0, prewarm: false });
  embers.emitter.position.set(0, -2.6, 0);
  embers.emitter.rotation.x = -Math.PI / 2;
  atmosphere.add(embers.emitter);
  batch.addSystem(embers);

  const smokeL = createShadowSmoke({ width: 1.2, depth: 2, rate: 0, prewarm: false });
  const smokeR = createShadowSmoke({ width: 1.2, depth: 2, rate: 0, prewarm: false });
  smokeL.emitter.position.set(-4.4, -2.4, 0);
  smokeR.emitter.position.set(4.4, -2.4, 0);
  [smokeL, smokeR].forEach((s) => {
    s.emitter.rotation.x = -Math.PI / 2;
    atmosphere.add(s.emitter);
    batch.addSystem(s);
  });

  // ---------------------------------------------------------------------------
  // Ambient life (subtle): dust in the key beam, a swaying chain hoist, a
  // drooping cable, a telemetry hologram and a turning ring on the turntable.
  // Everything dims with the power-on (ambient.master).
  // ---------------------------------------------------------------------------
  const ambient = new AmbientLife(scene, { parent: garage });
  ambient.dust({ center: [0, 3, 0], size: [6.5, 6, 6.5], count: 420, color: 0xdfe8ff, brightness: 0.55, pointSize: 0.022, speed: 0.6 });
  ambient.dust({ center: [0, 2.5, -4], size: [26, 5, 16], count: 260, color: 0xb8c4e0, brightness: 0.3, pointSize: 0.03, speed: 0.4 });
  ambient.chains({ points: [[-4.2, 8, -9.5, 4.6], [-3.8, 8, -9.6, 4.1], [8.5, 8, -6, 3.2]] });
  ambient.cables({ spans: [[-14.6, 7.6, -8, -5, 7.9, -12.6, 0.9], [5, 7.9, -12.6, 14.6, 7.4, -4, 1.1]], radius: 0.02, sway: 0.03, wind: 0.5 });
  const telemetry = holoScreen(ambient, {
    w: 2.6, h: 1.3, tint: 0x9fd8ff, bright: 1.3, pageDur: 5, fogK: 0.3,
    ticker: '  CAR #20 · MAG-DRIVE v3 · CORE 98% · BRAKE SYS OK · TYRES 92 °C · NEON VELODROME — FINAL TONIGHT  ·',
    pages: [
      (ctx, w, h) => {
        ctx.font = '700 64px Rajdhani, Arial, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText('CAR #20 · DIAGNOSTICS', w / 2, 90);
        ctx.font = '600 40px Rajdhani, Arial, sans-serif';
        ctx.fillStyle = '#9fd8ff';
        ['MAG-DRIVE CORE ....... 98 %', 'BRAKE SYSTEM ......... OK', 'STEERING ............. OK'].forEach((l, i) => ctx.fillText(l, w / 2, 170 + i * 56));
      },
      (ctx, w, h) => {
        ctx.font = '700 54px Rajdhani, Arial, sans-serif';
        ctx.fillStyle = '#9fd8ff';
        ctx.textAlign = 'center';
        ctx.fillText('DRIVER · K. RAYNE · 72 BPM', w / 2, 80);
        ctx.strokeStyle = '#ff3a4a';
        for (const [lw, a] of [[10, 0.15], [4, 0.5], [2, 1]]) {
          ctx.globalAlpha = a;
          ctx.lineWidth = lw;
          ctx.beginPath();
          for (let x = 40; x < w - 40; x += 4) {
            const u = ((x - 40) / 300) % 1;
            const y = u > 0.4 && u < 0.45 ? 130 : u > 0.45 && u < 0.5 ? 270 : 210;
            x === 40 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      },
    ],
  });
  telemetry.position.set(3.7, 2.35, -12.9);
  ambient.add({ object: telemetry, dispose: () => telemetry.userData.textures?.forEach((t) => t.dispose()) });
  // turntable: a dashed ring creeping round the platform edge
  const dashC = document.createElement('canvas');
  dashC.width = 512;
  dashC.height = 8;
  const dctx = dashC.getContext('2d');
  for (let i = 0; i < 48; i++) {
    dctx.fillStyle = i % 6 === 0 ? '#ffffff' : '#6fb8ff';
    dctx.fillRect((i / 48) * 512, 0, i % 6 === 0 ? 6 : 3, 8);
  }
  const dashTex = track(new THREE.CanvasTexture(dashC));
  const dashMat = track(new THREE.MeshBasicMaterial({ map: dashTex, color: 0x000000, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const dashes = new THREE.Mesh(track(new THREE.RingGeometry(2.95, 3.1, 96, 1)), dashMat);
  // ring UVs are planar: remap them to (angle, radius) so the texture wraps round
  {
    const pos = dashes.geometry.attributes.position;
    const uv = dashes.geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const a = Math.atan2(pos.getY(i), pos.getX(i));
      uv.setXY(i, (a / (Math.PI * 2) + 1) % 1, Math.hypot(pos.getX(i), pos.getY(i)) > 3 ? 1 : 0);
    }
  }
  dashes.rotation.x = -Math.PI / 2;
  dashes.position.y = 0.088;
  garage.add(dashes);
  ambient.animate((dt, t, life) => {
    dashes.rotation.z = t * 0.08;
    dashMat.color.setScalar(1.6 * life.master);
  });

  // ---------------------------------------------------------------------------
  // Power-on reveal + per-frame animation
  // ---------------------------------------------------------------------------
  const power = { value: 0 }; // 0 = blackout, 1 = full lights

  /** Lights flicker on one by one, like fluorescent tubes starting up. */
  function powerOn(seconds = 2.2) {
    const tl = gsap.timeline();
    tubes.forEach((tube, i) => {
      const t = (i / tubes.length) * seconds * 0.7 + Math.random() * 0.15;
      // a few quick stutters, then on
      tl.call(() => (tube.flickerUntil = performance.now() + 250 + Math.random() * 300), null, t);
      tl.to(tube, { power: 1, duration: 0.05 }, t);
    });
    tl.to(power, { value: 1, duration: seconds, ease: 'power2.inOut' }, 0);
    return tl;
  }

  /** Instantly lit (used when the intro is skipped). */
  function setPowered() {
    tubes.forEach((t) => (t.power = 1));
    power.value = 1;
  }

  // Menu framing: shift the image so the subject sits right of the menu.
  const framing = { x: 0 };
  function applyFraming() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const shift = w > h ? framing.x : 0; // no shift on portrait / phones
    if (shift) camera.setViewOffset(w, h, -w * shift, 0, w, h);
    else camera.clearViewOffset();
  }
  function setFraming(x, seconds = 1.2) {
    gsap.to(framing, { x, duration: seconds, ease: 'power3.inOut', onUpdate: applyFraming });
  }

  // Atmosphere strength 0..1 per effect × graphics particle scale.
  const atmo = { embers: 0, smoke: 0, quality: 1 };
  const EMBER_RATE = 45;
  const SMOKE_RATE = 4;
  function updateEmission() {
    embers.emissionOverTime.value = EMBER_RATE * atmo.embers * atmo.quality;
    smokeL.emissionOverTime.value = smokeR.emissionOverTime.value = SMOKE_RATE * atmo.smoke * atmo.quality;
  }
  function setAtmosphere({ embers: e = atmo.embers, smoke: sm = atmo.smoke } = {}) {
    atmo.embers = e;
    atmo.smoke = sm;
    updateEmission();
  }

  const tmp = new THREE.Vector3();

  function update(dt, elapsed, realDt) {
    // Slow arc with a gentle height bob
    const orbitAngle = ORBIT.hero + Math.sin(elapsed * ORBIT.speed * Math.PI * 2) * ORBIT.sweep;
    camera.position.set(
      Math.sin(orbitAngle) * ORBIT.radius,
      ORBIT.height + Math.sin(elapsed * 0.25) * ORBIT.bob,
      Math.cos(orbitAngle) * ORBIT.radius,
    );
    camera.lookAt(tmp.copy(ORBIT.target));

    // Tube flicker: random bursts of on/off at ~25 Hz
    const now = performance.now();
    let ceilingOn = 0;
    tubes.forEach((tube, i) => {
      if (tube.power > 0 && now > tube.flickerUntil && Math.random() < tube.chance * realDt) {
        tube.flickerUntil = now + 80 + Math.random() * 500;
      }
      const flickering = now < tube.flickerUntil;
      tube.on = flickering ? (Math.random() < 0.45 ? 0.08 : 1) : 1;
      const level = tube.on * tube.power;
      tube.material.emissiveIntensity = tube.base * level;
      if (tube.light) tube.light.intensity = tube.lightBase * level;
      if (i < 6) ceilingOn += level / 6;
    });

    // Lights follow the ceiling tubes (so the broken tube flickers the room)
    const p = power.value;
    const visible = p > 0.001; // true blackout before power-on (emissives included)
    if (visible && !garage.visible) renderer.shadowMap.needsUpdate = true; // shadows were baked while hidden
    garage.visible = visible;
    key.intensity = KEY_INTENSITY * p * (0.35 + 0.65 * ceilingOn);
    beamMat.uniforms.uOpacity.value = 0.07 * p * ceilingOn;
    rimL.intensity = rimR.intensity = RIM_INTENSITY * p;
    hemi.intensity = 0.35 * p;
    scene.environmentIntensity = 0.45 * p;
    ledMat.emissiveIntensity = 1.6 * p;
    backdropMat.emissiveIntensity = 1.1 * p * (0.75 + 0.25 * ceilingOn);
    signMat.emissiveIntensity = 1.4 * p * (0.8 + 0.2 * ceilingOn);

    // Ring + underglow pulse at a resting 60 bpm heartbeat
    const beat = Math.pow(Math.max(0, Math.sin(elapsed * Math.PI * 2 * 1.0)), 16);
    ringMat.emissiveIntensity = (3 + beat * 6) * p;
    underglow.material.color.setHex(BLUE).multiplyScalar((2.2 + beat * 1.2) * p);
    underLight.intensity = (10 + beat * 6) * p;

    // Ambient life fades in with the power
    ambient.master = p;
    ambient.update(dt, { camera, realDt });

    // Kael: animation + any movement a cutscene gave him.
    kaelActor.update(dt);
    if (kael.userData.isPlaceholder) kael.scale.y = 1 + Math.sin(elapsed * 1.6) * 0.008; // placeholder "breathing"

    // Shadows: the car and room never move, so the shadow map only needs
    // refreshing for an animated Kael — 30 times a second is plenty.
    if (animated) {
      shadowClock += realDt;
      if (shadowClock >= 1 / 30) {
        shadowClock = 0;
        renderer.shadowMap.needsUpdate = true;
      }
    }

    batch.update(dt);
  }

  let shadowClock = 0;

  function applyGraphics(preset) {
    // The shadow map is NOT re-rendered every frame (big saving with a
    // 350k-triangle car): see the throttled refresh in update().
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    buildReflector(preset.shadows ? (preset.pixelRatio >= 2 ? 0.5 : 0.35) : 0);
    key.castShadow = preset.shadows;
    key.shadow.mapSize.setScalar(preset.shadowMapSize);
    key.shadow.map?.dispose();
    key.shadow.map = null;
    // Particle density scales with quality (emission rate is a ConstantValue)
    atmo.quality = preset.particleScale;
    updateEmission();
    dust.emitter.visible = preset.particleScale > 0.5;
    ambient.setQuality(Object.keys(CONFIG.graphics.presets).find((k) => CONFIG.graphics.presets[k] === preset) ?? 'high');
  }

  function resize() {
    applyFraming();
    if (reflector) {
      const ratio = Math.min(window.devicePixelRatio, 2);
      reflector.getRenderTarget().setSize(window.innerWidth * ratio * 0.4, window.innerHeight * ratio * 0.4);
    }
  }

  function dispose() {
    renderer.shadowMap.autoUpdate = true;
    reflector?.dispose();
    ambient.dispose();
    disposables.forEach((d) => d.dispose?.());
    gsap.killTweensOf(framing);
  }

  return {
    scene,
    camera,
    actors: { kael: kaelActor },
    update,
    resize,
    applyGraphics,
    dispose,
    powerOn,
    setPowered,
    setFraming,
    setAtmosphere,
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Dust motes: tiny, pale and faint instead of fiery. */
function tintDust(system) {
  system.startSize.a = 0.008;
  system.startSize.b = 0.02;
  system.startSpeed.a = 0.02;
  system.startSpeed.b = 0.08;
  system.startColor.a.set(0.9, 0.95, 1.2, 0.5);
  system.startColor.b.set(0.6, 0.7, 0.9, 0.3);
}

/** Team sign on the back wall: "RAYNE" with the race number 20.
 *  main.js waits for the Rajdhani font before building the scene. */
function makeSignTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.textBaseline = 'middle';
  ctx.font = '700 150px Rajdhani, "Segoe UI", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('RAYNE', 40, 118);
  ctx.font = '600 44px Rajdhani, "Segoe UI", sans-serif';
  ctx.fillStyle = '#9aa3b5';
  ctx.fillText('MOTORSPORT', 46, 210);
  ctx.font = '700 190px Rajdhani, "Segoe UI", sans-serif';
  ctx.fillStyle = '#e0142e';
  ctx.textAlign = 'right';
  ctx.fillText('20', 990, 135);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

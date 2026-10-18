// =============================================================================
// FLATLINE: 2050 — scenes/raceScene.js
// The 2050 race world (CLAUDE.md Phase 3): Neon Velodrome track, Kael's car,
// 5 rivals, chase camera, speed effects, engine audio, HUD and race rules.
//
//   const world = createRaceScene(renderer, assets, { laps, onExit });
//   game.setWorld(world); await world.start();     // countdown → race
//   onExit('retry' | 'menu') is called when the player leaves.
//
// Phase 4 builds Mission 1 on top of this (world.car, world.race, world.track).
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { game } from '../core/game.js';
import { MODELS } from '../assets/manifest.js';
import { createModelInstance } from '../assets/loader.js';
import { styleCar2050, styleRival } from '../assets/modelStyles.js';
import { CarController } from '../vehicles/carController.js';
import { CarCamera } from '../vehicles/carCamera.js';
import { CarAudio } from '../vehicles/carAudio.js';
import { RaceTrack } from '../vehicles/raceTrack.js';
import { RivalCar } from '../vehicles/rivalCar.js';
import { Race } from '../vehicles/race.js';
import { NeonTrail } from '../vfx/neonTrail.js';
import { SpeedLines } from '../vfx/speedLines.js';
import { glowTexture } from '../vfx/particleTextures.js';
import { RaceHUD } from '../ui/hud.js';
import { CarAbilities } from '../vehicles/carAbilities.js';
import { modal } from '../ui/modal.js';
import { AmbientLife } from '../vfx/ambientLife.js';
import { addVelodromeLife } from '../vfx/ambientStadium.js';

const PLAYER_SLOT = 3;            // default: start 4th — you have to fight for the lead
const TAIL_LIGHTS = [[-2.15, 0.78, 0.62], [-2.15, 0.78, -0.62]]; // car (physics) space

/** Equirectangular night sky: deep navy horizon glow fading to black, with stars. */
function makeNightSky() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0, '#000003');
  g.addColorStop(0.38, '#04061a');
  g.addColorStop(0.5, '#151a3c');   // horizon: city / stadium light pollution
  g.addColorStop(0.53, '#0b0d1c');
  g.addColorStop(1, '#020205');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 900; i++) {
    const y = Math.random() * c.height * 0.46;
    ctx.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.7})`;
    const r = Math.random() < 0.06 ? 1.6 : 0.8;
    ctx.fillRect(Math.random() * c.width, y, r, r);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param {object} o
 * @param {number} o.laps
 * @param {number} o.playerSlot   grid slot (0 = pole)
 * @param {boolean} o.mission     story mode: no results screen, the mission drives the flow
 * @param {(choice: 'retry'|'menu') => void} o.onExit
 */
export function createRaceScene(renderer, assets, { laps = CONFIG.race.laps, playerSlot = PLAYER_SLOT, mission = false, onExit = () => {} } = {}) {
  const physicsGen = physics.clear(); // fresh physics world for this race
  let leaving = false;
  let paused = false;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070812, 0.0016);
  const camera = new THREE.PerspectiveCamera(CONFIG.carCamera.fovBase, window.innerWidth / window.innerHeight, 0.1, 3000);
  scene.add(camera);

  // --- Night stadium lighting ---------------------------------------------------------
  const hdri = assets.get('hdri.stadium_2050');
  // The HDRI only lights / reflects; the visible sky is a night gradient + stars.
  if (hdri?.texture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(hdri.texture).texture;
    pmrem.dispose();
  }
  const sky = makeNightSky();
  scene.background = sky;
  scene.environmentIntensity = 0.55;
  scene.add(new THREE.HemisphereLight(0x7c8cc8, 0x0a0a12, 0.7));
  const sun = new THREE.DirectionalLight(0xdfe8ff, 1.6);
  sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -30;
  sun.shadow.camera.right = sun.shadow.camera.top = 30;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // --- Track ---------------------------------------------------------------------------------
  const track = new RaceTrack(scene, { asphalt: assets.get('textures.asphalt'), concrete: assets.get('textures.concrete') });

  // --- Ambient life: crowd, drones, searchlights, fireworks, holo screens, skyline ---------
  const ambient = new AmbientLife(scene);
  const stadium = addVelodromeLife(ambient, track);

  // --- Player car ------------------------------------------------------------------------------
  // Low graphics: the light model for the player too (weak laptops)
  const playerTpl = game.quality === 'low' && !assets.get('vehicles.car_2050_rival_lite').isPlaceholder
    ? assets.get('vehicles.car_2050_rival_lite')
    : assets.get('vehicles.car_2050_kael');
  const playerModel = createModelInstance(playerTpl);
  if (!playerTpl.isPlaceholder) styleCar2050(playerModel);
  const slot = track.gridSlot(playerSlot);
  const car = new CarController({ object: playerModel, wheelNames: MODELS.vehicles.car_2050_kael.nodes.wheels, position: slot.position, yaw: slot.yaw });
  car.locked = true; // stays on the grid until the lights go green
  scene.add(car.root);
  car.root.traverse((o) => o.isMesh && (o.castShadow = true));

  // --- Rivals -----------------------------------------------------------------------------------
  const rivalTpl = assets.get('vehicles.car_2050_rival_lite');
  const R = CONFIG.rivals;
  const rivals = [];
  const rivalSlots = [0, 1, 2, 3, 4, 5].filter((i) => i !== playerSlot).slice(0, R.count);
  rivalSlots.forEach((slotIndex, i) => {
    const obj = createModelInstance(rivalTpl);
    if (!rivalTpl.isPlaceholder) styleRival(obj, R.colors[i]);
    obj.traverse((o) => o.isMesh && (o.castShadow = false));
    const g = track.gridSlot(slotIndex);
    const rival = new RivalCar({
      object: obj,
      wheelNames: MODELS.vehicles.car_2050_rival_lite.nodes.wheels,
      track,
      start: { s: g.progress, lateral: g.lateral },
      skill: [0.95, 0.75, 0.6, 0.45, 0.3][i] ?? 0.5,
      name: R.names[i],
      color: R.colors[i],
    });
    scene.add(rival.root);
    rivals.push(rival);
  });

  // Soft blob shadows under every car (cheap; real shadows only for the player)
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: glowTexture(), transparent: true, opacity: 0.55, depthWrite: false });
  const blobGeo = new THREE.PlaneGeometry(5.6, 3.0);
  [car.root, ...rivals.map((r) => r.root)].forEach((root) => {
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.03;
    blob.renderOrder = 1;
    root.add(blob);
  });

  // --- Neon trails from the tail lights ----------------------------------------------------------
  const trails = [];
  const addTrails = (root, color) => {
    TAIL_LIGHTS.forEach((p) => {
      const anchor = new THREE.Object3D();
      anchor.position.set(...p);
      root.add(anchor);
      const t = new NeonTrail(anchor, { color, width: 0.035, points: 22, spacing: 0.8, intensity: 1.4 });
      scene.add(t.mesh);
      trails.push(t);
    });
  };
  addTrails(car.root, 0xff2340);
  rivals.forEach((r) => addTrails(r.root, r.color));

  // --- Race, camera, effects, audio, HUD ------------------------------------------------------------
  const race = new Race({ track, player: car, rivals, playerStart: slot.progress, laps });
  car.onReset = () => race.respawnSpot();
  const offRaceStep = physics.onFixedUpdate((dt) => race.fixedUpdate(dt));

  // 🔥 Burn · 🌑 Shadow Dash · ⏳ Rewind
  const abilities = new CarAbilities({ scene, car, rivals, race, postfx: game.postfx, trails });
  abilities.onEvent((type) => {
    if (type === 'dash') hud.message('Shadow dash', 0.9, 'shadow');
  });

  const carCam = new CarCamera(camera);
  carCam.snap(car);
  const speedLines = new SpeedLines(camera);
  const carAudio = new CarAudio();
  const hud = new RaceHUD({ track, laps });
  race.on('light', (n) => hud.lights(n));
  race.on('lap', ({ lap, final }) => hud.message(final ? 'Final lap' : `Lap ${lap}`, 1.8, final ? 'final' : ''));
  race.on('finish', async (results) => {
    if (mission) return; // story missions handle their own ending
    hud.message(`${results.position}${['ST', 'ND', 'RD'][results.position - 1] ?? 'TH'} place`, 2.5, results.position === 1 ? 'go' : '');
    leaving = true;
    await new Promise((r) => setTimeout(r, 2600));
    const choice = await hud.showResults(results);
    onExit(choice);
  });

  const onKey = async (e) => {
    if (e.code !== 'Escape' || leaving || paused) return;
    paused = true;
    car.locked = true;
    const ok = await modal.confirm('Leave the race?', 'Progress in this race will be lost.', [
      { label: 'Keep racing', value: false },
      { label: 'Leave', value: true, primary: true },
    ]);
    paused = false;
    if (ok) {
      leaving = true;
      onExit('menu');
    } else if (race.state === 'racing') car.locked = false;
  };
  window.addEventListener('keydown', onKey);

  /** Engines + crowd on (missions call this before their intro). */
  let engaged = false;
  function engage() {
    if (engaged) return;
    engaged = true;
    carAudio.start();
    audio.sfx('crowd_cheer', { volume: 0.25 });
  }

  /** Free race: countdown, then race. */
  async function start() {
    engage();
    hud.message('World Grand Prix', 2.2, 'title');
    await race.startCountdown();
    audio.playMusic('race_2050', 1.5);
  }

  // --- Per frame ----------------------------------------------------------------------------------------
  const k = input;
  const world = { inputOverride: null };
  function readInput() {
    if (world.inputOverride) return car.setInput(world.inputOverride); // scripted moments (Mission 1 crash)
    // Dev only: automated tests can drive the car (window.__flatlineAutopilot)
    if (import.meta.env.DEV && window.__flatlineAutopilot) return window.__flatlineAutopilot({ car, race, track, input: k });
    if (leaving && race.state === 'finished') {
      car.setInput({ throttle: 0, brake: 0.15, steer: 0, handbrake: false, boost: false }); // coast down
      return;
    }
    const axis = (pos, neg) => (pos.some((c) => k.isDown(c)) ? 1 : 0) - (neg.some((c) => k.isDown(c)) ? 1 : 0);
    const pad = k.pad;
    car.setInput({
      throttle: Math.max(k.isDown('KeyW') || k.isDown('ArrowUp') ? 1 : 0, pad.rt),
      brake: Math.max(k.isDown('KeyS') || k.isDown('ArrowDown') ? 1 : 0, pad.lt),
      steer: axis(['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']) || pad.lx,
      handbrake: k.isDown('Space'),
      boost: k.isDown('ShiftLeft') || k.isDown('ShiftRight'),
    });
    if (k.wasPressed('Backspace') && race.state === 'racing') {
      const spot = race.respawnSpot();
      car.reset(spot.position, spot.yaw);
      carCam.snap(car);
      trails.slice(0, 2).forEach((t) => t.reset());
    }
  }

  function update(dt, elapsed, realDt) {
    readInput();
    race.update(dt);
    abilities.update(realDt);
    car.syncVisual();
    rivals.forEach((r) => r.syncVisual());
    track.update(elapsed);
    ambient.update(dt, { camera: game.activeCamera ?? camera, realDt, rewinding: abilities.rewinding });

    carCam.update(realDt, car, { lookBack: k.isDown('KeyC') && !world.inputOverride });
    // Hide any rival sitting right on the camera instead of seeing through its body
    rivals.forEach((r) => (r.root.visible = r.root.position.distanceToSquared(camera.position) > 5.5 * 5.5 || !!game.cameraOverride));
    trails.forEach((t) => t.update(camera));

    // Speed effects
    const ratio = Math.min(1.3, Math.abs(car.speed) / CONFIG.car.topSpeed);
    const fast = THREE.MathUtils.clamp((ratio - 0.55) / 0.45, 0, 1);
    game.postfx.setSpeedBlur(fast * 0.55 + (car.boosting ? 0.35 : 0));
    game.postfx.setChromaticAberration(car.boosting ? 0.75 : fast * 0.2, 0.2);
    speedLines.update(realDt, Math.abs(car.speed), fast * 0.8 + (car.boosting ? 0.4 : 0));
    carAudio.update(realDt, car, car.input.throttle);

    // Player shadow light follows the car
    sun.position.copy(car.position).add(new THREE.Vector3(-30, 60, 20));
    sun.target.position.copy(car.position);

    const standings = race.standings();
    hud.update({
      speedKmh: car.speedKmh,
      boost: car.boost,
      boosting: car.boosting,
      shadow: car.shadow,
      drafting: race.drafting,
      phased: car.phased,
      time: car.time,
      rewinding: abilities.rewinding,
      position: standings.indexOf(race.playerEntry) + 1,
      total: standings.length,
      lap: race.playerLap,
      lapTime: race.state === 'racing' ? race.time - race.lapStart : race.state === 'finished' ? race.lapTimes.at(-1) : 0,
      bestLap: race.bestLap,
      wrongWay: race.wrongWayTime > 1,
      cars: [
        { x: car.position.x, z: car.position.z, isPlayer: true },
        ...rivals.map((r) => ({ x: r.root.position.x, z: r.root.position.z, color: r.color })),
      ],
    });
  }

  function applyGraphics(preset) {
    sun.castShadow = preset.shadows;
    sun.shadow.mapSize.setScalar(Math.min(preset.shadowMapSize, 2048));
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    renderer.shadowMap.autoUpdate = true;
    ambient.setQuality(game.quality);
  }

  function dispose() {
    window.removeEventListener('keydown', onKey);
    offRaceStep();
    abilities.dispose();
    carAudio.stop(0.4);
    hud.destroy();
    speedLines.dispose();
    trails.forEach((t) => t.dispose());
    car.dispose();
    rivals.forEach((r) => r.dispose());
    ambient.dispose();
    track.dispose();
    blobGeo.dispose();
    blobMat.dispose();
    sky.dispose();
    game.postfx.setSpeedBlur(0);
    game.postfx.setChromaticAberration(0, 0.01);
    // Only wipe physics if no newer world (e.g. a retry) has claimed it since.
    if (physics.generation === physicsGen) physics.clear();
  }

  return Object.assign(world, { scene, camera, update, applyGraphics, dispose, start, engage, car, race, track, rivals, hud, abilities, ambient, stadium });
}

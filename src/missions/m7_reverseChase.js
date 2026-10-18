// =============================================================================
// FLATLINE: 2050 — missions/m7_reverseChase.js
// MISSION 7 · REVERSE CHASE (2020 · ⏳ TIME + racing) — Phase 9.6
//
//   intro: Victor escapes in a car. Kael takes a 2020 sports car. The
//          Clockmaker: "Your hands remember. Drive." The world freezes — then
//          starts running BACKWARDS.
//   play:  the Phase 3 driving system through a city where time flows in
//          reverse: rain falls upward, a crashed car un-crashes and drives
//          back at you, an explosion implodes, bullets fly back into guns,
//          lamp posts stand back up. Keep Victor in reach (Shift = Burn,
//          hold R = ⏳ rewind your own mistakes) all the way to the factory.
//   outro: the factory gates at 20:19. Victor runs inside. The clock ticks.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { physics } from '../core/physics.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { createModelInstance } from '../assets/loader.js';
import { MODELS } from '../assets/manifest.js';
import { Actor } from '../cutscenes/actor.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { at, cam, sfx, voice, subtitle, fade, call, setMood, letterbox, glitch, flash } from '../cutscenes/steps.js';
import { objectives } from '../ui/objectiveHUD.js';
import { modal } from '../ui/modal.js';
import { CarController } from '../vehicles/carController.js';
import { CarCamera } from '../vehicles/carCamera.js';
import { CarAudio } from '../vehicles/carAudio.js';
import { CombatFX } from '../vfx/muzzleFX.js';
import { Rain } from '../vfx/rainFX.js';
import { AmbientLife } from '../vfx/ambientLife.js';
import { timeRewind } from '../systems/timeRewind.js';
import { heartbeat } from '../systems/heartbeat.js';
import { repeatMaterial } from '../scenes/onFootWorld.js';
import { runMission } from './missionManager.js';

export const ASSETS = [
  'vehicles.car_2020_sport', 'vehicles.car_2020_sedan', 'vehicles.suv', 'characters.victor', 'characters.enemy', 'characters.kael_2020', 'weapons.rifle',
  'textures.wet_asphalt', 'textures.brick', 'props.street_lamp', 'hdri.night_city_2020',
  'sfx.engine_2020', 'sfx.tire_skid', 'sfx.boost', 'sfx.whoosh', 'sfx.reverse_whoosh', 'sfx.clock_tick', 'sfx.explosion', 'sfx.rifle_shot',
  'sfx.car_crash', 'sfx.glass_shatter', 'sfx.rain_heavy', 'sfx.thunder', 'sfx.heartbeat', 'sfx.ui_click', 'sfx.ui_glitch',
  'voice.m7_clockmaker_01', 'music.reverse_chase',
];

// The route: a winding drive across the city to the factory (open ends)
const ROUTE = [[0, 0], [0, 160], [40, 300], [140, 380], [260, 400], [360, 470], [400, 600], [380, 740], [300, 840], [180, 900], [60, 980], [0, 1110], [20, 1240], [100, 1330]];
const ROAD_W = 18;

export function playMission7() {
  return runMission({
    number: 7,
    assets: ASSETS,
    parTime: 150,
    music: 'reverse_chase',
    create: (assets, ctx) => createChaseWorld(assets, ctx),
    intro: introScript,
    outro: outroScript,
  });
}

export function createChaseWorld(assets, ctx) {
  const C = CONFIG.mission7;
  const R = (physics.clear(), physics.RAPIER);
  const physicsGen = physics.generation;
  timeRewind.clear();
  heartbeat.reset(Math.max(heartbeat.beats, 30));
  const disposables = [];
  const track = (x) => (disposables.push(x), x);
  const world = { inputOverride: null, paused: false };

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060812);
  scene.fog = new THREE.FogExp2(0x0a0e1a, 0.0045);
  const camera = new THREE.PerspectiveCamera(CONFIG.carCamera.fovBase, innerWidth / innerHeight, 0.1, 1200);
  scene.add(camera);
  const env = assets.get('hdri.night_city_2020');
  if (env?.texture) {
    const pmrem = new THREE.PMREMGenerator(game.renderer);
    scene.environment = pmrem.fromEquirectangular(env.texture).texture;
    pmrem.dispose();
  }
  scene.environmentIntensity = 0.4;
  scene.add(new THREE.HemisphereLight(0x405080, 0x0a0a10, 0.5));
  const moon = new THREE.DirectionalLight(0x9ab0e0, 0.8);
  moon.position.set(-100, 200, -50);
  scene.add(moon);

  // ---- the road -------------------------------------------------------------------------------------------------------
  const curve = new THREE.CatmullRomCurve3(ROUTE.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const length = curve.getLength();
  const N = Math.ceil(length / 4);
  const pts = curve.getSpacedPoints(N);
  const frames = pts.map((p, i) => {
    const t = curve.getTangentAt(Math.min(1, i / N)).setY(0).normalize();
    return { p, t, n: new THREE.Vector3(-t.z, 0, t.x) };
  });
  const roadGeo = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const idx = [];
  frames.forEach((f, i) => {
    const l = f.p.clone().addScaledVector(f.n, -ROAD_W / 2);
    const r = f.p.clone().addScaledVector(f.n, ROAD_W / 2);
    pos.push(l.x, 0.02, l.z, r.x, 0.02, r.z);
    uv.push(0, i * 0.5, 2, i * 0.5);
    if (i > 0) idx.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, (i - 1) * 2 + 1, i * 2, i * 2 + 1);
  });
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roadGeo.setIndex(idx);
  roadGeo.computeVertexNormals();
  const roadMat = track(repeatMaterial(assets.get('textures.wet_asphalt'), 1, 1, 0x1a1a1f));
  scene.add(new THREE.Mesh(track(roadGeo), roadMat));
  const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(2400, 2400)), track(new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 1 })));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(200, 0, 650);
  scene.add(ground);
  physics.world.createCollider(R.ColliderDesc.cuboid(1200, 0.5, 1200).setTranslation(200, -0.5, 650).setFriction(1));
  // barriers + buildings along both sides
  const barrierMat = track(new THREE.MeshStandardMaterial({ color: 0x5a5e66, roughness: 0.6, metalness: 0.4 }));
  const brick = track(repeatMaterial(assets.get('textures.brick'), 6, 4, 0x5a2a22));
  const winMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb36a).multiplyScalar(1.4) }));
  const lampSpots = [];
  const lampHeadGeo = track(new THREE.SphereGeometry(0.22, 10, 8));
  const lampHeadMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc070).multiplyScalar(4) }));
  const lampPool = Array.from({ length: C.lampLights }, () => {
    const l = new THREE.PointLight(0xffa54a, 30, 26, 2);
    scene.add(l);
    return l;
  });
  for (let i = 0; i < frames.length - 1; i += 2) {
    const a = frames[i];
    const b = frames[Math.min(frames.length - 1, i + 2)];
    const mid = a.p.clone().lerp(b.p, 0.5);
    const segLen = a.p.distanceTo(b.p);
    const yaw = Math.atan2(b.p.x - a.p.x, b.p.z - a.p.z);
    for (const side of [-1, 1]) {
      const c = mid.clone().addScaledVector(a.n, side * (ROAD_W / 2 + 0.4));
      const m = new THREE.Mesh(track(new THREE.BoxGeometry(0.5, 1.1, segLen + 0.2)), barrierMat);
      m.position.set(c.x, 0.55, c.z);
      m.rotation.y = yaw;
      scene.add(m);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      physics.world.createCollider(R.ColliderDesc.cuboid(0.25, 0.55, segLen / 2 + 0.1).setTranslation(c.x, 0.55, c.z).setRotation(q).setFriction(0.3));
      if (i % 8 === 0) {
        const h = 10 + ((i * 37) % 23);
        const bpos = mid.clone().addScaledVector(a.n, side * (ROAD_W / 2 + 14));
        const bm = new THREE.Mesh(track(new THREE.BoxGeometry(18, h, 18)), brick);
        bm.position.set(bpos.x, h / 2, bpos.z);
        bm.rotation.y = yaw;
        scene.add(bm);
        for (let k = 0; k < 3; k++) {
          const wm = new THREE.Mesh(track(new THREE.PlaneGeometry(1.4, 1.6)), winMat);
          wm.position.copy(bpos).addScaledVector(a.n, -side * 9.05).setY(3 + k * 3.5);
          wm.rotation.y = side > 0 ? yaw - Math.PI / 2 : yaw + Math.PI / 2;
          if ((i + k) % 3) scene.add(wm);
        }
      }
      if (i % 16 === 0) {
        const lp = mid.clone().addScaledVector(a.n, side * (ROAD_W / 2 + 1));
        lampSpots.push(new THREE.Vector3(lp.x, 6, lp.z));
        const head = new THREE.Mesh(lampHeadGeo, lampHeadMat);
        head.position.set(lp.x, 6, lp.z);
        scene.add(head);
      }
    }
  }
  // the factory gates at the end
  const end = frames[frames.length - 1];
  const gateMat = track(new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 0.9 }));
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(track(new THREE.BoxGeometry(1.5, 6, 1.5)), gateMat);
    g.position.copy(end.p).addScaledVector(end.n, side * 8).setY(3);
    scene.add(g);
  }
  const factory = new THREE.Mesh(track(new THREE.BoxGeometry(60, 18, 30)), gateMat);
  factory.position.copy(end.p).addScaledVector(end.t, 30).setY(9);
  scene.add(factory);

  /** Arc position along the road (s in metres). */
  const atS = (s) => {
    const u = THREE.MathUtils.clamp(s / length, 0, 1);
    return { p: curve.getPointAt(u), t: curve.getTangentAt(u).setY(0).normalize() };
  };
  const progressOf = (p) => {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const d = frames[i].p.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return (best / N) * length;
  };

  // ---- Kael's car ----------------------------------------------------------------------------------------------------
  const sportKey = 'car_2020_sport';
  const sportModel = createModelInstance(assets.get(`vehicles.${sportKey}`));
  sportModel.rotation.y = Math.PI; // its nose is +Z; the controller expects −Z
  const sport = new THREE.Group();
  sport.add(sportModel);
  const start = atS(30);
  const car = new CarController({ object: sport, wheelNames: MODELS.vehicles[sportKey].nodes.wheels, position: start.p.clone().setY(0.6).toArray(), yaw: Math.atan2(start.t.x, start.t.z) - Math.PI / 2 });
  scene.add(car.root);
  car.locked = true;
  const offCarRewind = timeRewind.register(car);
  const carCam = new CarCamera(camera);
  const carAudio = new CarAudio();
  const fx = new CombatFX(scene);
  const rain = new Rain(scene, { count: game.quality === 'low' ? 1500 : 3500, area: 40, speed: 16 });
  rain.storm = false;
  // ⏳ ambient life runs BACKWARDS here: shards float up off the road, steam sinks into the manholes
  const ambient = new AmbientLife(scene, { reverse: true, rain });
  dressAmbient(ambient, { scene, frames, track });

  // ---- Victor's car (kinematic, on the racing line) -----------------------------------------------------------------------
  const vModel = createModelInstance(assets.get('vehicles.car_2020_sedan'));
  const victorCar = new THREE.Group();
  victorCar.add(vModel);
  const tail = new THREE.PointLight(0xff2020, 6, 10, 2);
  tail.position.set(0, 0.8, -2.4);
  victorCar.add(tail);
  scene.add(victorCar);
  const vBody = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
  physics.world.createCollider(R.ColliderDesc.cuboid(0.95, 0.7, 2.25).setTranslation(0, 0.7, 0), vBody);
  let vS = 90;
  let vSpeed = 0;
  let lostT = 0;

  // ---- ⏳ the reversed world: scripted events by Kael's progress -----------------------------------------------------------------
  const events = buildReverseEvents({ scene, assets, atS, fx, track, frames, N, length });

  // ---- HUD ------------------------------------------------------------------------------------------------------------------------------
  const hud = document.createElement('div');
  hud.className = 'chase-hud';
  hud.innerHTML = `<div class="chase-clock">20:19:59</div><div class="chase-gap"><span>VICTOR</span><div><i></i></div></div><div class="chase-speed"><b>0</b> KM/H</div><div class="chase-burn"><span>🔥 BURN</span><div><i></i></div></div>`;
  document.getElementById('ui-root').appendChild(hud);
  const $ = (s) => hud.querySelector(s);
  let clockSecs = 20 * 3600 + 19 * 60 + 59;

  // ---- input --------------------------------------------------------------------------------------------------------------------------------
  let rewindSound = null;
  function readInput() {
    if (world.inputOverride) return car.setInput(world.inputOverride);
    const k = input;
    // same steering convention as the race (raceScene.js)
    car.setInput({
      throttle: Math.max(k.isDown('KeyW') || k.isDown('ArrowUp') ? 1 : 0, k.pad.rt),
      brake: Math.max(k.isDown('KeyS') || k.isDown('ArrowDown') ? 1 : 0, k.pad.lt),
      steer: ((k.isDown('KeyD') || k.isDown('ArrowRight') ? 1 : 0) - (k.isDown('KeyA') || k.isDown('ArrowLeft') ? 1 : 0)) || k.pad.lx,
      handbrake: k.isDown('Space'),
      boost: k.isDown('ShiftLeft') || k.isDown('ShiftRight'),
    });
  }
  const offFixed = physics.onFixedUpdate((dt) => {
    if (physics.generation !== physicsGen) return;
    car.fixedUpdate(dt); // (skips itself while rewinding)
    if (!timeRewind.rewinding) timeRewind.record(dt);
  });

  // Esc
  let paused = false;
  let leaving = false;
  const onKey = async (e) => {
    if (e.code !== 'Escape' || paused || leaving) return;
    paused = true;
    timeScale.paused = true;
    const ok = await modal.confirm('Leave the chase?', 'Progress since the last checkpoint will be lost.', [{ label: 'Keep driving', value: false }, { label: 'Leave', value: true, primary: true }]);
    timeScale.paused = false;
    setTimeout(() => (paused = false), 0);
    if (ok) {
      leaving = true;
      ctx.onExit('menu');
    }
  };
  window.addEventListener('keydown', onKey);

  let checkpointS = 30;
  let finished = false;
  function resetTo(s) {
    const a = atS(s);
    car.reset(a.p.clone().setY(0.3).toArray(), Math.atan2(a.t.x, a.t.z) - Math.PI / 2);
    carCam.snap(car);
    vS = s + 70;
    lostT = 0;
    events.resetFrom(s);
  }

  function update(dt, elapsed, realDt) {
    if (physics.generation !== physicsGen) return;
    readInput();
    // ⏳ hold R to rewind (costs heartbeats like on foot)
    const wantsRewind = input.isDown('KeyR') && input.heldTime('KeyR') > CONFIG.time.holdToRewind && !car.locked;
    if (wantsRewind && !timeRewind.rewinding && timeRewind.history.length > 1 && heartbeat.spend(CONFIG.heartbeat.cost.rewind, 'rewind') && timeRewind.start()) {
      game.postfx.setChromaticAberration(0.7, 0.2);
      rewindSound = audio.sfx('reverse_whoosh', { volume: 0.7 });
    }
    if (timeRewind.rewinding) {
      const more = timeRewind.step(realDt, CONFIG.footThemes.time.rewindSpeed);
      if (!input.isDown('KeyR') || !more) {
        timeRewind.stop();
        game.postfx.setChromaticAberration(0.25, 0.3);
        if (rewindSound != null) audio.stop('sfx', 'reverse_whoosh', rewindSound, 0.2);
      }
    }
    car.syncVisual();
    carCam.update(realDt, car, { lookBack: input.isDown('KeyC') });
    carAudio.update(realDt, car, car.input?.throttle ?? 0);
    // Victor stays ahead: faster when Kael is close, slower when he falls back
    const kS = progressOf(car.position);
    const gap = vS - kS;
    let target = C.victorSpeed;
    if (gap < C.minGap) target += 10;
    if (gap > C.maxGap * 0.6) target -= 8;
    if (vS > length - 60) target = Math.max(0, (length - 10 - vS) * 0.8);
    vSpeed += (target - vSpeed) * Math.min(1, dt * 1.5);
    if (!car.locked && !timeRewind.rewinding) vS = Math.min(length - 10, vS + vSpeed * dt);
    const v = atS(vS);
    const lane = v.p.clone().addScaledVector(new THREE.Vector3(-v.t.z, 0, v.t.x), 2.2);
    victorCar.position.copy(lane);
    victorCar.rotation.y = Math.atan2(v.t.x, v.t.z);
    vBody.setNextKinematicTranslation(lane);
    vBody.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(victorCar.rotation));
    // lose him and you start over from the last checkpoint
    if (!car.locked && !finished) {
      lostT = gap > C.maxGap ? lostT + dt : 0;
      if (lostT > C.loseSeconds) {
        subtitles.show('clockmaker', 'You lost him. Again — from the last turn.', 2.4);
        resetTo(checkpointS);
      }
      for (const cp of C.checkpoints) if (kS > cp && checkpointS < cp) checkpointS = cp;
      if (kS > length - 40 && gap < C.maxGap) {
        finished = true;
        car.locked = true;
        ctx.complete();
      }
    }
    events.update(dt, kS, car);
    // the pooled street lights follow the lamps nearest the car
    const cp = car.position;
    lampSpots.sort((a, b) => a.distanceToSquared(cp) - b.distanceToSquared(cp));
    lampPool.forEach((l, i) => lampSpots[i] && l.position.copy(lampSpots[i]));
    rain.speed = -Math.abs(rain.speed); // ⏳ rain falls UP
    rain.update(dt, camera);
    ambient.update(dt, { camera: game.activeCamera ?? camera, realDt, rewinding: timeRewind.rewinding });
    fx.update(dt);
    // HUD
    clockSecs -= realDt * C.clockRate;
    const cs = Math.max(0, clockSecs);
    $('.chase-clock').textContent = `${String(Math.floor(cs / 3600)).padStart(2, '0')}:${String(Math.floor((cs % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(cs % 60)).padStart(2, '0')}`;
    $('.chase-gap i').style.transform = `scaleX(${THREE.MathUtils.clamp(1 - gap / C.maxGap, 0, 1).toFixed(3)})`;
    $('.chase-gap').classList.toggle('is-losing', gap > C.maxGap * 0.8);
    $('.chase-speed b').textContent = Math.round(Math.abs(car.speedKmh));
    $('.chase-burn i').style.transform = `scaleX(${(car.boost ?? 0).toFixed(3)})`;
    audio.setListener(camera);
  }

  function dispose() {
    window.removeEventListener('keydown', onKey);
    offFixed();
    offCarRewind();
    timeRewind.clear();
    carAudio.stop(0.3);
    hud.remove();
    rain.dispose();
    ambient.dispose();
    fx.dispose();
    events.dispose();
    car.dispose?.();
    disposables.forEach((d) => d.dispose?.());
    if (physics.generation === physicsGen) physics.clear();
    timeScale.paused = false;
    timeScale.set(1, 0.01);
    game.postfx.setChromaticAberration(0, 0.1);
  }

  return Object.assign(world, {
    scene, camera, update, dispose, car, carCam, carAudio, rain, fx, victorCar, events, length, atS, ambient,
    applyGraphics: () => ambient.setQuality(game.quality),
    player: { locked: false, set locked(v) { car.locked = v; }, get locked() { return car.locked; } },
    setHudVisible: (v) => (hud.style.opacity = v ? 1 : 0),
    level: {
      start() {
        car.locked = false;
        carAudio.start();
        objectives.set('Catch Victor — time is running backwards');
        objectives.hint('[W] drive · [Shift] 🔥 Burn · hold [R] ⏳ rewind · dodge what un-happens', 7);
        game.postfx.setMood('TIME', 1);
        game.postfx.setChromaticAberration(0.25, 1);
      },
      get progress() {
        return progressOf(car.position);
      },
      get gap() {
        return vS - progressOf(car.position);
      },
    },
  });
}

/** The world in reverse: crashes un-crash, explosions implode, bullets return. */
function buildReverseEvents({ scene, assets, atS, fx, track, length }) {
  const list = [];
  const side = (s, off) => {
    const a = atS(s);
    return a.p.clone().addScaledVector(new THREE.Vector3(-a.t.z, 0, a.t.x), off);
  };
  // 1 · a crashed car un-crashes and drives backwards at you
  const crashTpl = assets.get('vehicles.suv');
  [[260, -3], [700, 3], [1050, -2]].forEach(([s, off]) => {
    const m = createModelInstance(crashTpl);
    const g = new THREE.Group();
    g.add(m);
    scene.add(g);
    const body = physics.world.createRigidBody(physics.RAPIER.RigidBodyDesc.kinematicPositionBased());
    physics.world.createCollider(physics.RAPIER.ColliderDesc.cuboid(1, 0.9, 2.4).setTranslation(0, 0.9, 0), body);
    const ev = {
      s, fired: false,
      reset() {
        this.fired = false;
        this.k = 0;
        const p = side(s + 60, off);
        g.position.copy(p).setY(0.9);
        g.rotation.set(0, Math.atan2(atS(s).t.x, atS(s).t.z), Math.PI); // upside down, smoking
        body.setNextKinematicTranslation(g.position);
      },
      update(dt, kS) {
        if (!this.fired && kS > s - 40) {
          this.fired = true;
          audio.sfxAt('car_crash', g.position, { volume: 0.9, rate: -1 > 0 ? 1 : 0.6 });
          audio.sfxAt('reverse_whoosh', g.position, { volume: 0.8 });
        }
        if (!this.fired) {
          if (Math.random() < dt * 8) fx.puffs.emit(g.position.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, 1.2, 0), [0.1, 0.1, 0.1], 0.5, 2, 0.2, 3);
          return;
        }
        this.k = Math.min(1, this.k + dt * 0.9);
        // flip back upright, then reverse down the road toward Kael
        g.rotation.z = Math.PI * (1 - Math.min(1, this.k * 1.6));
        g.position.y = 0.9 + Math.sin(Math.min(1, this.k * 1.6) * Math.PI) * 2.5;
        if (this.k > 0.6) {
          const back = atS(Math.max(0, s + 60 - (this.k - 0.6) * 140));
          const p = back.p.clone().addScaledVector(new THREE.Vector3(-back.t.z, 0, back.t.x), off);
          g.position.x = p.x;
          g.position.z = p.z;
        }
        body.setNextKinematicTranslation(g.position);
        body.setNextKinematicRotation(new THREE.Quaternion().setFromEuler(g.rotation));
      },
      dispose() { g.removeFromParent(); },
    };
    list.push(ev);
  });
  // 2 · explosions that implode
  [[480, 0], [900, 4]].forEach(([s, off]) => {
    const ball = new THREE.Mesh(track(new THREE.SphereGeometry(1, 20, 14)), track(new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.8, 0.5), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })));
    scene.add(ball);
    const light = new THREE.PointLight(0xff8a3a, 0, 40, 2);
    scene.add(light);
    list.push({
      s, fired: false,
      reset() {
        this.fired = false;
        this.k = 0;
        ball.visible = false;
        light.intensity = 0;
        ball.position.copy(side(s + 30, off)).setY(2.5);
        light.position.copy(ball.position);
      },
      update(dt, kS) {
        if (!this.fired && kS > s - 50) {
          this.fired = true;
          ball.visible = true;
          audio.sfxAt('reverse_whoosh', ball.position, { volume: 1, rate: 0.7 });
          // debris rushes INTO the fireball
          for (let i = 0; i < 60; i++) {
            const from = ball.position.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(9));
            fx.sparks.emit(from, ball.position.clone().sub(from).multiplyScalar(1.4), [1, 0.6, 0.2], 0.12, 0.7, 0);
          }
        }
        if (!this.fired || this.k >= 1) return;
        this.k = Math.min(1, this.k + dt * 0.7);
        const sc = 6 * (1 - this.k) + 0.01; // shrinking — un-exploding
        ball.scale.setScalar(sc);
        ball.material.opacity = 0.9 * (1 - this.k * 0.6);
        light.intensity = 300 * (1 - this.k);
        if (this.k >= 1) {
          ball.visible = false;
          audio.sfxAt('explosion', ball.position, { volume: 0.5, rate: 0.5 }); // the bang arrives last
        }
      },
      dispose() { ball.removeFromParent(); light.removeFromParent(); },
    });
  });
  // 3 · bullets flying back into guns
  const eTpl = assets.get('characters.enemy');
  [[620, -1], [1180, 1]].forEach(([s, sd]) => {
    const shooters = [0, 1, 2].map((i) => {
      const o = createModelInstance(eTpl);
      scene.add(o);
      const a = new Actor('shooter', o, eTpl.animations);
      const p = side(s + 25 + i * 6, sd * (ROAD_W / 2 + 2.5));
      a.place(p, Math.atan2(-sd * atS(s).t.z, sd * atS(s).t.x));
      a.play('idle_gun_pointing', 0.01);
      return { a, p };
    });
    list.push({
      s, fired: false, t: 0,
      reset() { this.fired = false; this.t = 0; },
      update(dt, kS, car) {
        shooters.forEach((x) => x.a.update(dt));
        if (!this.fired && kS > s - 60) this.fired = true;
        if (!this.fired || this.t > 3) return;
        this.t += dt;
        if (Math.random() < dt * 9) {
          const sh = shooters[Math.floor(Math.random() * shooters.length)];
          const gun = sh.p.clone().add(new THREE.Vector3(0, 1.4, 0));
          const impact = car.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 1.5, (Math.random() - 0.5) * 8));
          fx.tracer(impact, gun, new THREE.Color(1.2, 2, 3)); // from the impact BACK to the muzzle
          fx.flash(gun, impact.clone().sub(gun).normalize(), 0.6);
          if (Math.random() < 0.4) audio.sfxAt('rifle_shot', gun, { volume: 0.5, rate: 0.7 });
        }
      },
      dispose() { shooters.forEach((x) => x.a.object.removeFromParent()); },
    });
  });
  return {
    update(dt, kS, car) {
      list.forEach((e) => e.update(dt, kS, car));
    },
    resetFrom(s) {
      list.forEach((e) => {
        if (e.s >= s) e.reset();
      });
    },
    dispose() {
      list.forEach((e) => e.dispose());
    },
    list,
    init() {
      list.forEach((e) => e.reset());
    },
  };
}

// -----------------------------------------------------------------------------
// Ambient life (vfx/ambientLife.js) for the reversed city. The AmbientLife runs
// with reverse: true, so every layer here plays backwards.
// -----------------------------------------------------------------------------
function dressAmbient(life, { scene, frames, track }) {
  // glass and debris lifting off the road around the car
  life.debris({ count: 320, area: 44, height: 6, fall: 1.4 });
  // steam that sinks back into the manholes along the route
  const iron = track(new THREE.MeshStandardMaterial({ color: 0x18181a, metalness: 0.8, roughness: 0.5 }));
  const coverGeo = track(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 18));
  const vents = [];
  for (let i = 12; i < frames.length - 4; i += 26) {
    const f = frames[i];
    const p = f.p.clone().addScaledVector(f.n, (i % 52 ? 1 : -1) * 3.5);
    const cover = new THREE.Mesh(coverGeo, iron);
    cover.position.set(p.x, 0.04, p.z);
    scene.add(cover);
    vents.push([p.x, 0.06, p.z]);
  }
  if (vents.length) life.steam({ points: vents, perPoint: 26, height: 4, opacity: 0.16, spread: 1.4, wind: [0.3, 0, 0.2] });
  // the city around the route: lit windows + beacons, kept clear of the road
  const near = (x, z) => frames.some((f, i) => i % 3 === 0 && (f.p.x - x) ** 2 + (f.p.z - z) ** 2 < 75 * 75);
  life.skyline({ center: [200, 0, 665], radius: [0, 760], count: 170, height: [18, 95], width: [16, 34], clear: near, fogK: 0.35 });
  // cross-street traffic, driving in reverse like everything else
  life.traffic({ lanes: [[-300, 0, 230, 700, 0, 230], [700, 0, 236, -300, 0, 236], [-300, 0, 1000, 700, 0, 1000], [700, 0, 1006, -300, 0, 1006], [620, 0, -100, 620, 0, 1400]], cars: 70, fogK: 0.4 });
}

// -----------------------------------------------------------------------------
// Cutscenes
// -----------------------------------------------------------------------------
function introScript(world) {
  const { car, victorCar, rain } = world;
  world.events.init();
  const kTpl = world.car && null;
  void kTpl;
  return {
    id: 'm7_intro',
    mood: 'NEUTRAL',
    handheld: 0.014,
    missionCard: 7,
    steps: [
      at(0, letterbox(true)),
      at(0, call(() => {
        world.carCam.snap(car);
        rain.speed = 16;
      })),
      // Victor's car tears away
      at(0, cam.cut([victorCar.position.x + 6, 1.6, victorCar.position.z - 10], [victorCar.position.x, 1, victorCar.position.z])),
      at(0, fade.in(1)),
      at(0.3, sfx('tire_skid', { volume: 0.8 })),
      at(0.4, subtitle('kael', 'Hale!', 1.2)),
      at(1.8, cam.cut([car.position.x - 3, 1.4, car.position.z - 4], [car.position.x, 1, car.position.z])),
      at(2.0, subtitle('kael', 'Keys are in it. Of course they are.', 2.2)),
      at(4.2, sfx('radio_static', { volume: 0.7 })),
      at(4.6, voice('m7_clockmaker_01')),
      // the world freezes…
      at(7.2, call(() => { rain.speed = 0.0001; })),
      at(7.2, glitch(0.4, 0.8)),
      at(7.2, setMood('TIME', 0.4)),
      at(7.3, sfx('clock_tick', { volume: 0.9 })),
      at(7.6, subtitle('kael', 'The rain… stopped. In the air.', 2.2)),
      // …and runs backwards
      at(10, call(() => { rain.speed = -16; })),
      at(10, sfx('reverse_whoosh', { volume: 1 })),
      at(10, flash('#9fd8ff', 0.4)),
      at(10.4, subtitle('clockmaker', 'Time\'s running backwards around you. Drive with it.', 3)),
      at(13.6, letterbox(false)),
    ],
    duration: 13.8,
  };
}

function outroScript(world) {
  const { victorCar } = world;
  const end = world.atS(world.length - 6);
  const vTpl = world.scene && null;
  void vTpl;
  return {
    id: 'm7_outro',
    mood: 'TIME',
    handheld: 0.01,
    steps: [
      at(0, letterbox(true)),
      at(0, cam.cut(end.p.clone().add(new THREE.Vector3(8, 2, -8)).toArray(), victorCar.position.clone().setY(1.2).toArray())),
      at(0.4, subtitle('kael', 'The factory. Twenty-nineteen.', 2.2)),
      at(2.8, call(() => audio.sfx('clock_tick', { volume: 1 }))),
      at(3.8, call(() => audio.sfx('clock_tick', { volume: 1 }))),
      at(3.0, subtitle('kael', 'He\'s going inside. One minute until the fire.', 3)),
      at(4.8, call(() => audio.sfx('clock_tick', { volume: 1 }))),
      at(5.8, call(() => audio.sfx('clock_tick', { volume: 1 }))),
      at(6.4, fade.out(1.4)),
    ],
    duration: 8,
  };
}

void gsap;
void Actor;

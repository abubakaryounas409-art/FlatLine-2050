// =============================================================================
// FLATLINE: 2050 — missions/m4_snipersClock.js
// MISSION 4 · SNIPER'S CLOCK (2020 · ⏳ TIME) — Phase 9.3
//
//   intro: Kael climbs a water tower in a thunderstorm. The Clockmaker:
//          "Every shot is a heartbeat. Make them count."
//   play:  protect Mara Voss at a meeting in the plaza below from three waves
//          of Hale's enforcers. ⏳ Time your shots: a gunshot inside the
//          thunder window is masked (nobody hears it); outside it they hear,
//          rush Mara and shoot back at the tower. A freight train crosses the
//          plaza and blocks the view. Steady aim (Shift) costs a heartbeat.
//          If Mara goes down, the wave restarts.
//   outro: Mara looks up at the tower. Their eyes meet through the scope.
//          She lowers her gun.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { at, cam, sfx, voice, subtitle, fade, call, setMood, letterbox, music } from '../cutscenes/steps.js';
import { objectives } from '../ui/objectiveHUD.js';
import { createOnFootWorld, ON_FOOT_ASSETS } from '../scenes/onFootWorld.js';
import { runMission } from './missionManager.js';

const ASSETS = [...ON_FOOT_ASSETS, 'characters.mara', 'characters.civilian', 'sfx.engine_2020', 'voice.m4_clockmaker_01', 'music.combat'];
const TOWER = new THREE.Vector3(0, 13.75, 0);
const MARA = new THREE.Vector3(0, 0, 85);
const rand = (a, b) => a + Math.random() * (b - a);

const WAVES = [
  [{ from: [-20, 0, 125], to: [-12, 0, 100] }, { from: [0, 0, 128], to: [2, 0, 104] }, { from: [20, 0, 125], to: [12, 0, 100] }],
  [{ from: [-60, 0, 80], to: [-22, 0, 82] }, { from: [-60, 0, 92], to: [-20, 0, 95] }, { from: [60, 0, 80], to: [22, 0, 80] }, { from: [60, 0, 92], to: [20, 0, 96] }],
  [{ from: [-30, 0, 125], to: [-16, 0, 104] }, { from: [30, 0, 125], to: [16, 0, 104] }, { from: [-60, 0, 86], to: [-24, 0, 88] }, { from: [60, 0, 86], to: [24, 0, 88] }, { from: [0, 0, 130], to: [0, 0, 108], heavy: true }],
];

export function playMission4() {
  return runMission({
    number: 4,
    assets: ASSETS,
    parTime: 420,
    music: 'combat',
    create: (assets, ctx) => createOnFootWorld(game.renderer, assets, {
      spawn: TOWER.toArray(),
      yaw: 0,
      fog: 0.009,
      groundSize: 320,
      rainFX: true,
      loadout: ['sniper', 'pistol'],
      onExit: ctx.onExit,
      build: (kit) => buildLevel(kit, ctx),
    }),
    intro: introScript,
    outro: outroScript,
  });
}

function buildLevel(kit, ctx) {
  const { scene, mats, addBox, addLamp, player, weapons, fx, assets } = kit;
  const R = physics.RAPIER;
  const M = CONFIG.mission4;

  // ---- the water tower (Kael's perch) ------------------------------------------------------------
  for (const [x, z] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) addBox([0.35, 13.6, 0.35], [x, 6.8, z], mats.metal, { surface: 'metal' });
  addBox([6.4, 0.3, 6.4], [0, 13.6, 0], mats.metal, { surface: 'metal' });
  for (const [s, p] of [[[6.4, 0.85, 0.08], [0, 14.18, 3.2]], [[6.4, 0.85, 0.08], [0, 14.18, -3.2]], [[0.08, 0.85, 6.4], [3.2, 14.18, 0]], [[0.08, 0.85, 6.4], [-3.2, 14.18, 0]]]) addBox(s, p, mats.metal, { surface: 'metal' });
  const tank = new THREE.Mesh(kit.track(new THREE.CylinderGeometry(2.6, 2.6, 5, 24)), mats.metal);
  tank.position.set(0, 16.9, -1.2); // behind Kael, a silhouette against the lightning
  tank.castShadow = true;
  scene.add(tank);
  physics.world.createCollider(R.ColliderDesc.cylinder(2.5, 2.6).setTranslation(0, 16.9, -1.2));

  // ---- the plaza + warehouses ---------------------------------------------------------------------------
  [[-40, 100, 22, 14, 30], [40, 100, 22, 14, 30], [0, 140, 70, 18, 14], [-50, 60, 18, 10, 26], [50, 60, 18, 10, 26]].forEach(([x, z, w, h, d]) => addBox([w, h, d], [x, h / 2, z], mats.brick));
  [[-8, 92], [8, 92], [-14, 78], [14, 78], [0, 100]].forEach(([x, z]) => addBox([2.4, 1, 0.6], [x, 0.5, z], mats.concrete));
  addLamp([-3, 0, 85], { rotY: Math.PI / 2, intensity: 40, reach: 14 });
  addLamp([18, 0, 100], { rotY: -Math.PI / 2, intensity: 30, reach: 14 });
  addLamp([-18, 0, 100], { rotY: Math.PI / 2, intensity: 30, reach: 14 });
  addLamp([24, 0, 82], { rotY: -Math.PI / 2, intensity: 30, reach: 14 });
  addLamp([-24, 0, 82], { rotY: Math.PI / 2, intensity: 30, reach: 14 });
  // rails
  addBox([320, 0.15, 0.12], [0, 0.08, 69.3], mats.metal, { collide: false });
  addBox([320, 0.15, 0.12], [0, 0.08, 70.7], mats.metal, { collide: false });

  // ---- Mara + the informant ---------------------------------------------------------------------------------
  const maraTpl = assets.get('characters.mara');
  const mara = new Actor('mara', createModelInstance(maraTpl), maraTpl.animations);
  scene.add(mara.object);
  mara.place(MARA, Math.PI * 0.85);
  mara.play('idle', 0.01);
  const infTpl = assets.get('characters.civilian');
  const informant = new Actor('informant', createModelInstance(infTpl), infTpl.animations);
  scene.add(informant.object);
  informant.place([1.2, 0, 86.2], -Math.PI * 0.7);
  informant.play('idle', 0.01);
  const maraState = { health: 100, down: false };
  // she can't be shot by Kael (friendly) — her collider just stops bullets
  const maraCol = physics.world.createCollider(R.ColliderDesc.capsule(0.5, 0.3).setTranslation(MARA.x, 0.85, MARA.z));
  weapons.register(maraCol, { surface: 'flesh', onHit: () => { subtitles.show('clockmaker', 'Not her, Kael.', 1.6); return { counted: false }; } });

  // ---- the train --------------------------------------------------------------------------------------------------
  const train = new THREE.Group();
  const cars = [];
  const trainMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.7, metalness: 0.5 }));
  for (let i = 0; i < 7; i++) {
    const car = new THREE.Mesh(kit.track(new THREE.BoxGeometry(12, 4.2, 3.2)), trainMat);
    car.position.set(i * 12.6, 2.4, 0);
    car.castShadow = true;
    train.add(car);
    const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(-400, 2.4, 70));
    const col = physics.world.createCollider(R.ColliderDesc.cuboid(6, 2.1, 1.6), body);
    weapons.setSurface(col, 'metal');
    cars.push({ mesh: car, body });
  }
  const headlight = new THREE.SpotLight(0xfff0c8, 0, 60, 0.4, 0.5, 1);
  headlight.position.set(-6.2, 1.5, 0);
  headlight.target.position.set(-30, 0, 0);
  train.add(headlight, headlight.target);
  scene.add(train);
  let trainX = -400;
  let trainT = M.trainEvery * 0.4;
  let rumble = null;

  dressAmbient(kit, { cars, headlight });

  // ---- enforcers (scripted approachers) -----------------------------------------------------------------------------
  const tpl = assets.get('characters.enemy');
  const gunTpl = assets.get('weapons.rifle');
  const foes = [];
  let wave = -1;
  let alerted = false;
  function spawnWave(n) {
    wave = n;
    alerted = false;
    objectives.progress('Wave', n + 1, WAVES.length);
    for (const def of WAVES[n]) {
      const obj = createModelInstance(tpl);
      if (def.heavy) obj.scale.setScalar(1.12);
      scene.add(obj);
      const actor = new Actor('enforcer', obj, tpl.animations);
      actor.place(def.from, 0);
      actor.play('run', 0.01);
      const gun = createModelInstance(gunTpl);
      scene.add(gun);
      const body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(...def.from));
      const col = physics.world.createCollider(R.ColliderDesc.capsule(0.55, 0.32).setTranslation(0, 0.88, 0), body);
      const f = { actor, gun, body, col, pos: new THREE.Vector3(...def.from), to: new THREE.Vector3(...def.to), health: def.heavy ? 300 : 100, dead: false, shootT: rand(1.5, 3), state: 'advance' };
      f.off = weapons.register(col, {
        surface: 'flesh',
        onHit: (hit) => {
          if (f.dead) return { counted: false };
          f.health -= hit.damage * (hit.point.y - f.pos.y > 1.45 ? 3 : 1);
          if (f.health <= 0) {
            f.dead = true;
            f.col.setEnabled(false);
            actor.play('death', 0.1, { loop: false, clamp: true });
            return { killed: true };
          }
          actor.gesture('hit', 'run', 0.1);
          return { killed: false };
        },
      });
      foes.push(f);
    }
  }
  function clearFoes() {
    foes.splice(0).forEach((f) => {
      f.off();
      f.actor.object.removeFromParent();
      f.gun.removeFromParent();
      physics.world.removeRigidBody(f.body);
    });
  }

  // ---- ⏳ thunder masking -----------------------------------------------------------------------------------------------
  if (kit.rain) kit.rain.storm = false; // strikes are scripted here, so every thunder masks
  let maskedUntil = 0;
  let thunderT = M.thunderEvery[0];
  const thunderEl = document.createElement('div');
  thunderEl.className = 'thunder-meter';
  thunderEl.innerHTML = '🌩 <b>THUNDER</b> <span>fire now — masked</span>';
  document.getElementById('ui-root').appendChild(thunderEl);
  function strike() {
    kit.rain?.lightning({ thunder: false });
    // the thunder roll is what hides the shot
    setTimeout(() => {
      maskedUntil = performance.now() + M.maskSeconds * 1000;
      audio.sfx('thunder', { volume: 0.9, rate: rand(0.85, 1) });
      thunderEl.classList.add('is-on');
      setTimeout(() => thunderEl.classList.remove('is-on'), M.maskSeconds * 1000);
    }, M.thunderDelay * 1000);
  }
  weapons.onShot = (muzzle) => {
    if (performance.now() < maskedUntil) return; // masked by the thunder
    if (!alerted && foes.some((f) => !f.dead)) {
      alerted = true;
      subtitles.show('mara', 'Shots! Where did that come from?!', 2.2);
      objectives.hint('They heard you. Wait for the [🌩 thunder] to fire unheard', 5);
    }
  };

  // ---- Mara's health HUD -------------------------------------------------------------------------------------------------
  const maraEl = document.createElement('div');
  maraEl.className = 'escort-bar';
  maraEl.innerHTML = '<span>MARA VOSS</span><div><i></i></div>';
  document.getElementById('ui-root').appendChild(maraEl);
  const maraFill = maraEl.querySelector('i');

  const UP = new THREE.Vector3(0, 1, 0);
  let nextWaveT = -1;
  return {
    mara,
    informant,
    start() {
      kit.rig.setYaw(0, 0.02); // look out over the railing at the plaza
      objectives.set('Protect Mara Voss');
      objectives.hint('[RMB] scope · [Shift] steady (1 beat) · fire in the [🌩 thunder]', 7);
      spawnWave(0);
    },
    update(dt) {
      const now = performance.now();
      mara.update(dt);
      informant.update(dt);
      // thunder schedule
      thunderT -= dt;
      if (thunderT <= 0) {
        strike();
        thunderT = rand(M.thunderEvery[0], M.thunderEvery[1]);
      }
      // train
      trainT -= dt;
      if (trainT <= 0 && trainX < -300) {
        trainX = -170;
        trainT = M.trainEvery;
        headlight.intensity = 80;
        rumble = audio.sfxAt('engine_2020', new THREE.Vector3(0, 2, 70), { volume: 0.6, rate: 0.55, refDistance: 25 });
        objectives.hint('A train — it blocks your view for a while', 3);
      }
      if (trainX > -300) {
        trainX += M.trainSpeed * dt;
        train.position.set(trainX, 0, 70);
        cars.forEach((c, i) => c.body.setNextKinematicTranslation({ x: trainX + i * 12.6, y: 2.4, z: 70 }));
        if (trainX > 170) {
          trainX = -400;
          headlight.intensity = 0;
          if (rumble != null) audio.stop('sfx', 'engine_2020', rumble, 1.5);
          cars.forEach((c) => c.body.setNextKinematicTranslation({ x: -400, y: 2.4, z: 70 }));
        }
      }
      // enforcers
      let shooting = 0;
      for (const f of foes) {
        f.actor.update(dt);
        if (f.dead) continue;
        const speed = (alerted ? M.runSpeed * 1.5 : M.runSpeed) * (f.state === 'advance' ? 1 : 0);
        if (f.state === 'advance') {
          const d = f.to.clone().sub(f.pos).setY(0);
          if (d.length() < 0.4) {
            f.state = 'fire';
            f.actor.play('idle_gun_pointing', 0.2);
          } else {
            f.pos.addScaledVector(d.normalize(), Math.min(d.length(), speed * dt));
            f.actor.object.rotation.y = Math.atan2(d.x, d.z);
          }
        } else {
          const toM = MARA.clone().sub(f.pos);
          f.actor.object.rotation.y = Math.atan2(toM.x, toM.z);
          shooting += 1;
          f.shootT -= dt;
          if (f.shootT <= 0) {
            f.shootT = rand(0.9, 1.8);
            // they shoot at Mara — and, once alerted, sometimes up at the tower
            const atTower = alerted && Math.random() < 0.35;
            const target = atTower ? player.position.clone().add(new THREE.Vector3(0, 1.2, 0)) : MARA.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.6, 1.6), rand(-0.6, 0.6)));
            const muzzle = f.pos.clone().add(new THREE.Vector3(0, 1.4, 0));
            const dir = target.clone().sub(muzzle).normalize();
            fx.flash(muzzle.clone().addScaledVector(dir, 0.5), dir, 0.8);
            fx.tracer(muzzle, atTower ? muzzle.clone().addScaledVector(dir, 30) : target, new THREE.Color(3, 1.6, 1));
            audio.sfxAt('rifle_shot', muzzle, { volume: 0.6, refDistance: 12 });
            if (atTower && Math.random() < 0.4) player.hurt(rand(4, 8));
          }
        }
        f.actor.object.position.copy(f.pos);
        f.body.setNextKinematicTranslation(f.pos);
        // gun at the hip
        const yaw = f.actor.object.rotation.y;
        const dir = new THREE.Vector3(Math.sin(yaw), f.state === 'fire' ? 0 : -0.4, Math.cos(yaw)).normalize();
        const z = new THREE.Vector3().crossVectors(dir, UP).normalize();
        f.gun.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, new THREE.Vector3().crossVectors(z, dir), z));
        f.gun.position.copy(f.pos).add(new THREE.Vector3(0, 1.25, 0)).addScaledVector(z, -0.2);
      }
      // Mara takes fire
      if (!maraState.down && shooting > 0) {
        maraState.health -= shooting * M.maraDps * dt;
        if (Math.random() < dt * shooting * 2) mara.gesture('hit', 'idle_gun_pointing', 0.1);
        if (mara.currentName === 'idle') mara.play('idle_gun_pointing', 0.2);
        if (maraState.health <= 0) {
          maraState.down = true;
          mara.play('death', 0.2, { loop: false, clamp: true });
          subtitles.show('clockmaker', 'She\'s down. Again, Kael. Again.', 2.6);
          setTimeout(() => {
            // restart this wave
            clearFoes();
            maraState.health = 100;
            maraState.down = false;
            mara.play('idle', 0.3);
            spawnWave(wave);
          }, 3000);
        }
      }
      maraFill.style.transform = `scaleX(${Math.max(0, maraState.health / 100).toFixed(3)})`;
      maraEl.classList.toggle('is-low', maraState.health < 35);
      // waves
      if (wave >= 0 && foes.length && foes.every((f) => f.dead) && nextWaveT < 0) {
        if (wave + 1 >= WAVES.length) {
          wave = 99;
          ctx.complete();
        } else {
          nextWaveT = 6;
          subtitles.show('mara', 'Who\'s out there…? Somebody\'s watching my back.', 2.6);
        }
      }
      if (nextWaveT >= 0) {
        nextWaveT -= dt;
        if (nextWaveT < 0) {
          clearFoes();
          spawnWave(wave + 1);
          objectives.hint(wave === 2 ? 'The last of them — one is armoured. Head shots.' : 'More of them. From the sides.', 4);
        }
      }
      void now;
    },
    dispose() {
      clearFoes();
      thunderEl.remove();
      maraEl.remove();
      train.removeFromParent();
      mara.object.removeFromParent();
      informant.object.removeFromParent();
      if (rumble != null) audio.stop('sfx', 'engine_2020', rumble, 0.2);
    },
  };
}

// -----------------------------------------------------------------------------
// Ambient life (vfx/ambientLife.js): the storm over the warehouse district: rain, the lit train, the city
// -----------------------------------------------------------------------------
function dressAmbient(kit, { cars, headlight }) {
  const life = kit.ambient;
  life.splashes({ count: 90, radius: 7 });                         // on the tower
  life.splashes({ count: 200, radius: 24, center: [0, 0, 90] });   // the plaza in the scope
  life.drips({ edges: [[-3.2, 13.72, 3.2, 3.2, 13.72, 3.2, 13.7], [-3.2, 13.72, -3.2, 3.2, 13.72, -3.2, 13.7], [3.2, 13.72, -3.2, 3.2, 13.72, 3.2, 13.7]], count: 70 });
  life.steam({ points: [[6, 0.05, 88], [-10, 0.05, 96], [14, 0.05, 108]], perPoint: 30, height: 3.4, opacity: 0.15 });
  life.neonSigns([
    { position: [-28.95, 9, 100], rotY: Math.PI / 2, text: 'HALE LOGISTICS', color: '#3fa9ff', height: 2, mode: 'steady' },
    { position: [28.95, 8, 96], rotY: -Math.PI / 2, text: 'DOCK 7', color: '#ff8a1a', height: 1.8, mode: 'broken' },
    { position: [0, 15.5, 132.95], rotY: Math.PI, text: 'HALE INDUSTRIES', color: '#ff2a4a', height: 3, mode: 'steady', border: false },
    { position: [-40, 7, 84.95], rotY: Math.PI, text: '24H', color: '#ff2a8a', height: 1.6, mode: 'blink' },
  ]);
  life.cables({ spans: [[-29, 12.5, 88, 29, 12.5, 90, 2.4], [-29, 11.5, 112, 29, 11.8, 108, 2.2], [-41, 10, 45, -41, 10, 85, 1.8]], radius: 0.03, sway: 0.25 });
  // pigeons on the tank roof: the first shot of the night scatters them
  life.birds({ perches: [[1.8, 19.42, -1.2], [-1.4, 19.42, 0.2], [0.4, 19.42, -3.1]], count: 7 });
  // the train: lit windows down both sides, a visible headlight beam
  const winMat = kit.track(new THREE.MeshBasicMaterial({ map: kit.track(trainWindowTexture()), color: new THREE.Color(1.5, 1.25, 0.9), transparent: true }));
  const winGeo = kit.track(new THREE.PlaneGeometry(10.6, 1.1));
  cars.forEach(({ mesh }) => {
    for (const side of [1, -1]) {
      const w = new THREE.Mesh(winGeo, winMat);
      w.position.set(0, 0.55, side * 1.61);
      w.rotation.y = side > 0 ? 0 : Math.PI;
      mesh.add(w);
    }
  });
  life.spotBeams({ lights: [headlight], opacity: 0.12, maxIntensity: 80 });
  // the water-tower beacon, the city, distant traffic, the storm itself
  life.beacons({ points: [[0, 19.7, -1.2]], size: 0.5, fogK: 1 });
  life.skyline({ center: [0, 0, 90], radius: [190, 330], count: 120, height: [20, 110], fogK: 0.2 });
  life.traffic({ lanes: [[-170, 0, 168, 170, 0, 168], [170, 0, 172, -170, 0, 172], [86, 0, -120, 86, 0, 250], [-86, 0, 250, -86, 0, -120]], cars: 60 });
  life.lightningBolts({ distance: [160, 280], height: 140 });
}

/** Train windows: warm light behind dark frames, a few dark (empty) compartments. */
function trainWindowTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 48;
  const x = c.getContext('2d');
  for (let i = 0; i < 12; i++) {
    const lit = (i * 7) % 5 !== 0;
    x.fillStyle = lit ? 'rgba(255,214,150,0.95)' : 'rgba(60,70,90,0.5)';
    x.fillRect(8 + i * 42, 8, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// -----------------------------------------------------------------------------
// Cutscenes
// -----------------------------------------------------------------------------
function introScript(world) {
  const p = world.player;
  return {
    id: 'm4_intro',
    mood: 'TIME',
    handheld: 0.012,
    missionCard: 4,
    steps: [
      at(0, letterbox(true)),
      at(0, music('combat', 3)),
      at(0, call(() => { p.cinematic = true; p.anims.actor.play('idle', 0.01); })),
      // looking up the tower legs into the storm
      at(0, cam.cut([5, 1.6, 6], [0, 14, 0])),
      at(0, fade.in(2)),
      at(0.2, cam.moveTo([4, 6, 5], [0, 15, 0], 5, 'sine.inOut')),
      at(1.2, call(() => world.rain?.lightning())),
      at(2.6, subtitle('kael', 'Mara\'s meeting an informant at nine. Hale\'s men know.', 3)),
      at(5.4, cam.cut([1.6, 15.4, -2.2], [0, 1, 85])),
      at(5.4, call(() => world.rain?.lightning())),
      at(5.8, cam.moveTo([0.8, 15.0, -1.4], [0, 1, 85], 4, 'sine.inOut')),
      at(6.2, sfx('radio_static', { volume: 0.7 })),
      at(6.8, voice('m4_clockmaker_01')),
      at(10.2, subtitle('kael', 'Thunder hides a gunshot. Use it.', 2.6)),
      at(12.8, call(() => { p.cinematic = false; })),
      at(12.8, letterbox(false)),
    ],
    duration: 13,
  };
}

function outroScript(world) {
  const { mara } = world.level;
  const scope = document.createElement('div');
  scope.className = 'ch-scope is-on';
  scope.innerHTML = '<div class="ch-scope-ring"></div><div class="ch-scope-h"></div><div class="ch-scope-v"></div>';
  return {
    id: 'm4_outro',
    mood: 'TIME',
    handheld: 0.004,
    steps: [
      at(0, letterbox(true)),
      at(0, call(() => mara.play('idle_gun_pointing', 0.3))),
      // through the scope
      at(0, call(() => document.getElementById('ui-root').appendChild(scope))),
      at(0, cam.cut([0.3, 15.2, 2], [MARA.x, 1.6, MARA.z])),
      at(0, cam.fov(5, 0.01)),
      at(0.6, call(() => mara.lookAt([0, 14, 0], 2))),
      at(1.6, subtitle('mara', '…You.', 1.6)),
      at(3.4, call(() => mara.play('idle', 1.2))),
      at(3.6, subtitle('kael', 'She lowered her gun.', 2.2)),
      at(6.2, call(() => scope.remove())),
      at(6.2, cam.fov(40, 0.01)),
      at(6.2, cam.cut([MARA.x + 3, 1.7, MARA.z - 3], [MARA.x, 1.4, MARA.z])),
      at(6.4, subtitle('mara', 'Whoever you are… we\'re going to talk.', 3)),
      at(9.6, fade.out(1.2)),
      at(10.9, call(() => scope.remove())),
    ],
    duration: 11,
  };
}

void gsap;
void setMood;
void CONFIG;

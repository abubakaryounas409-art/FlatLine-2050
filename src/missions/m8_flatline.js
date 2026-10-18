// =============================================================================
// FLATLINE: 2050 — missions/m8_flatline.js
// MISSION 8 · FLATLINE (2020 · 🔥🌑⏳ all three · finale) — Phase 9.7
//
//   intro: the factory as it looked BEFORE the fire. Elias Rayne at the
//          engine. Young Victor walks in with a gas can. Kael watches through
//          a window. The clock reads 20:20. Fire.
//   part 1: fight through the burning factory; beams collapse — ⏳ rewind
//          to dodge them.
//   part 2: Victor in heavy armour. Bullets barely scratch it — 🔥 incendiary
//          rounds burn through; 🌑 he can't see you in the dark.
//   part 3: Umbra blocks the way to Elias inside the fire. Shooting him does
//          nothing. The guns lower by themselves. The only way is to WALK
//          INTO THE FIRE (hold W): the screen burns white, the heartbeat
//          crashes, Umbra fades with every step.
//   final:  Elias smiles: "You stopped running." White. The flatline tone…
//          then one beep. Then another.  (→ the ending, Phase 10)
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { physics } from '../core/physics.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { at, cam, sfx, voice, subtitle, fade, call, setMood, letterbox, glitch, flash, music } from '../cutscenes/steps.js';
import { objectives } from '../ui/objectiveHUD.js';
import { createOnFootWorld, ON_FOOT_ASSETS, repeatMaterial } from '../scenes/onFootWorld.js';
import { heartbeat } from '../systems/heartbeat.js';
import { addDissolve } from '../vfx/dissolveShader.js';
import { runMission } from './missionManager.js';

const ASSETS = [
  ...ON_FOOT_ASSETS, 'characters.elias', 'characters.victor', 'characters.umbra', 'textures.charred', 'textures.burnt_wood',
  'vehicles.car_2050_kael', 'voice.m8_elias_01', 'music.combat', 'music.ending', 'sfx.monitor_beep', 'sfx.clock_tick',
];
const ELIAS = new THREE.Vector3(0, 0, 84);
const FIRE_START = 64; // the wall of flame between Kael and his father

export function playMission8() {
  return runMission({
    number: 8,
    assets: ASSETS,
    parTime: 600,
    music: 'combat',
    create: (assets, ctx) => createOnFootWorld(game.renderer, assets, {
      spawn: [0, 0, 2],
      yaw: 0,
      fog: 0.022,
      background: 0x140806,
      rain: false,
      groundSize: 0,
      echo: () => CONFIG.weapons.echo,
      onExit: ctx.onExit,
      build: (kit) => buildLevel(kit, ctx),
    }),
    intro: introScript,
    outro: outroScript,
  });
}

function buildLevel(kit, ctx) {
  const { scene, mats, addBox, addProp, addLamp, addCover, ai, player, weapons, fx, fire, rig, assets } = kit;
  const R = physics.RAPIER;
  const F8 = CONFIG.mission8;
  const charred = kit.track(repeatMaterial(assets.get('textures.charred'), 4, 2, 0x141110));
  // floor
  const floor = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(60, 110)), mats.concrete);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 45);
  floor.receiveShadow = true;
  scene.add(floor);
  physics.world.createCollider(R.ColliderDesc.cuboid(30, 0.5, 55).setTranslation(0, -0.5, 45));

  // ---- the factory: corridor (part 1) → hall (part 2) → the fire (part 3) ---------------------------------------------------
  addBox([1, 10, 34], [-8.5, 5, 15], charred);
  addBox([1, 10, 34], [8.5, 5, 15], charred);
  addBox([18, 10, 1], [0, 5, -1.5], charred);
  // the hall
  addBox([10, 10, 1], [-13, 5, 32], charred);
  addBox([10, 10, 1], [13, 5, 32], charred);
  addBox([1, 10, 30], [-18.5, 5, 47], charred);
  addBox([1, 10, 30], [18.5, 5, 47], charred);
  addBox([14, 10, 1], [-11.5, 5, 62], charred);
  addBox([14, 10, 1], [11.5, 5, 62], charred);
  // the fire corridor and Elias's workshop
  addBox([1, 10, 30], [-4.5, 5, 77], charred);
  addBox([1, 10, 30], [4.5, 5, 77], charred);
  addBox([10, 10, 1], [0, 5, 92.5], charred);
  // crates / machines as cover
  [[-4, 8], [4, 14], [-4, 22], [4, 27]].forEach(([x, z]) => {
    addBox([2.4, 1.1, 1.4], [x, 0.55, z], mats.metal, { surface: 'metal' });
    addCover([x, 0, z - 1.2], true);
    addCover([x, 0, z + 1.2], true);
    kit.addFlammable([x, 0.6, z], 1);
  });
  [[-10, 40], [10, 40], [-6, 50], [6, 50], [0, 45], [-12, 56], [12, 56]].forEach(([x, z], i) => {
    const tall = i % 3 === 0;
    addBox([2, tall ? 2.6 : 1.1, 2], [x, tall ? 1.3 : 0.55, z], tall ? charred : mats.metal, { surface: 'metal' });
    for (const [dx, dz] of [[0, -1.6], [0, 1.6], [-1.6, 0], [1.6, 0]]) addCover([x + dx, 0, z + dz], !tall);
  });
  // lamps (shootable: make the hall dark for part 2)
  addLamp([-7.8, 0, 10], { rotY: Math.PI / 2, intensity: 18, reach: 9 });
  addLamp([7.8, 0, 22], { rotY: -Math.PI / 2, intensity: 18, reach: 9 });
  [[-17.8, 38], [17.8, 38], [-17.8, 54], [17.8, 54]].forEach(([x, z], i) => addLamp([x, 0, z], { rotY: x < 0 ? Math.PI / 2 : -Math.PI / 2, intensity: 34, reach: 13, shadow: i === 0 }));
  kit.addFragment([6.5, 0, 3], '"Whatever happens, Kael — don\'t run from it."');
  kit.addFragment([-16, 0, 60], 'Dad\'s laugh. I\'d forgotten it.');

  // fire everywhere already
  setTimeout(() => {
    [[-6, 0.5, 4], [6, 0.5, 18], [-6, 0.5, 30], [0, 0.5, 35], [-15, 0.5, 46], [15, 0.5, 46]].forEach((p) => fire.ignite(new THREE.Vector3(...p), { size: 1, fuel: 999 }));
  }, 500);

  dressAmbient(kit);

  // ---- part 1: enforcers + collapsing beams (⏳ rewind to dodge) -----------------------------------------------------------------
  [[-3, 0, 12, [[-3, 0, 12], [3, 0, 12]]], [3, 0, 20, []], [-3, 0, 28, [[-3, 0, 28], [3, 0, 28]]]].forEach(([x, y, z, patrol]) => ai.spawn({ position: [x, y, z], yaw: Math.PI, patrol }));
  const beams = [9, 17, 25].map((z) => {
    const m = new THREE.Mesh(kit.track(new THREE.BoxGeometry(16, 0.6, 0.6)), charred);
    m.position.set(0, 9, z);
    m.castShadow = true;
    scene.add(m);
    return { m, z, state: 'up', t: 0 };
  });
  const offBeamRewind = kit.timeRewind.register({
    snapshot: () => beams.map((b) => [b.state, b.t, b.m.position.y]),
    restore: (s) => s.forEach(([st, t, y], i) => {
      beams[i].state = st;
      beams[i].t = t;
      beams[i].m.position.y = y;
    }),
  });

  // ---- part 2: Victor (heavy armour) -------------------------------------------------------------------------------------------------
  let victor = null;
  const bar = document.createElement('div');
  bar.className = 'boss-bar';
  bar.innerHTML = '<span>VICTOR HALE</span><div><i></i></div><em>armoured — burn it</em>';
  bar.style.opacity = 0;
  document.getElementById('ui-root').appendChild(bar);
  const barFill = bar.querySelector('i');

  // ---- part 3: Umbra + Elias -----------------------------------------------------------------------------------------------------------
  const uTpl = assets.get('characters.umbra');
  const umbra = new Actor('umbra', createModelInstance(uTpl), uTpl.animations);
  umbra.object.traverse((o) => {
    if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0x050308 });
  });
  scene.add(umbra.object);
  umbra.place([0, 0, FIRE_START + 2], Math.PI);
  umbra.play('idle_gun_pointing', 0.01);
  umbra.object.visible = false;
  const uDis = addDissolve(umbra.object, { color: 0x9a6aff });
  const uCol = physics.world.createCollider(R.ColliderDesc.capsule(0.55, 0.32).setTranslation(0, 0.88, FIRE_START + 2));
  uCol.setEnabled(false);
  weapons.register(uCol, {
    surface: 'flesh',
    onHit: (hit) => {
      for (let i = 0; i < 6; i++) fx.puffs.emit(hit.point, new THREE.Vector3().randomDirection().multiplyScalar(0.6), [0.1, 0.05, 0.18], 0.25, 0.8, 0.2, 3);
      shotsAtUmbra += 1;
      if (shotsAtUmbra === 3) subtitles.show('umbra', 'You can\'t shoot what you are.', 2.6);
      return { counted: false };
    },
  });
  let shotsAtUmbra = 0;
  const eTpl = assets.get('characters.elias');
  const elias = new Actor('elias', createModelInstance(eTpl), eTpl.animations);
  scene.add(elias.object);
  elias.place(ELIAS, Math.PI);
  elias.play('idle', 0.01);
  // the engine on the bench
  const engine = new THREE.Mesh(kit.track(new THREE.TorusGeometry(0.45, 0.16, 12, 28)), kit.track(new THREE.MeshStandardMaterial({ color: 0x8a9ab0, metalness: 1, roughness: 0.25, emissive: new THREE.Color(0x3fa9ff), emissiveIntensity: 0.6 })));
  engine.position.set(1.2, 1.2, ELIAS.z + 1);
  scene.add(engine);
  addBox([2.4, 1, 1.2], [1.2, 0.5, ELIAS.z + 1], mats.metal, { surface: 'metal' });
  // the wall of fire
  const flamePoints = [];
  for (let z = FIRE_START; z < ELIAS.z - 3; z += 2.2) for (const x of [-2.6, 0, 2.6]) flamePoints.push(new THREE.Vector3(x, 0.4, z));

  // white-out overlay for the walk
  const white = document.createElement('div');
  white.className = 'whiteout';
  document.getElementById('ui-root').appendChild(white);

  let stage = 'corridor';
  let walk = 0;
  let walkStartBeats = 0;
  const triggers = [];
  const trigger = (z, fn) => triggers.push({ z, fn, done: false });

  trigger(31, () => {
    stage = 'boss';
    kit.setCheckpoint([0, 0, 33], 0);
    objectives.set('Stop Victor Hale');
    objectives.hint('His armour shrugs off bullets. [V] 🔥 incendiary rounds burn through. Shoot the lamps — 🌑 he can\'t see you in the dark', 9);
    victor = ai.spawn({ position: [0, 0, 52], yaw: Math.PI, patrol: [], model: 'characters.victor', health: F8.victorHealth, armor: F8.victorArmor });
    victor.alert(player.position);
    weapons.incendiaryRounds = Math.max(weapons.incendiaryRounds, F8.incendiaryGift);
    weapons._refreshHud();
    subtitles.show('victor', 'Twenty years I\'ve kept this night buried. You don\'t get to dig it up.', 3.6);
    gsap.to(bar, { opacity: 1, duration: 0.6 });
    [[-12, 0, 58], [12, 0, 58]].forEach((p) => ai.spawn({ position: p, yaw: Math.PI, patrol: [] }).alert(player.position));
  });

  function startWalk() {
    stage = 'walk';
    walkStartBeats = heartbeat.beats;
    kit.setCheckpoint([0, 0, FIRE_START - 6], 0);
    gsap.to(bar, { opacity: 0, duration: 0.6 });
    objectives.set('Reach your father');
    umbra.object.visible = true;
    uCol.setEnabled(true);
    flamePoints.forEach((p, i) => setTimeout(() => fire.ignite(p.clone(), { size: 1.1, fuel: 999 }), i * 60));
    subtitles.show('umbra', 'You\'ll run. You always run.', 3);
    setTimeout(() => objectives.hint('Shoot him.', 2.5), 3000);
  }

  return {
    elias,
    umbra,
    get stage() {
      return stage;
    },
    get walk() {
      return walk;
    },
    get victor() {
      return victor;
    },
    start() {
      objectives.set('Fight through the burning factory');
      objectives.hint('Beams are coming down. Caught? Hold [R] — ⏳ rewind', 7);
      audio.playMusic('combat', 1);
    },
    update(dt) {
      elias.update(dt);
      umbra.update(dt);
      const pz = player.position.z;
      for (const t of triggers) {
        if (!t.done && pz > t.z) {
          t.done = true;
          t.fn();
        }
      }
      // beams fall when Kael gets close
      for (const b of beams) {
        if (b.state === 'up' && Math.abs(pz - b.z) < 4.5 && stage === 'corridor') {
          b.state = 'creak';
          b.t = F8.beamWarn;
          audio.sfxAt('car_crash', b.m.position, { volume: 0.25, rate: 0.4 }); // the creak
          objectives.hint('Above you —', 1.2);
        }
        if (b.state === 'creak') {
          b.t -= dt;
          b.m.rotation.z = Math.sin(b.t * 40) * 0.02;
          if (b.t <= 0) b.state = 'fall';
        }
        if (b.state === 'fall') {
          b.m.position.y = Math.max(0.3, b.m.position.y - dt * 18);
          if (b.m.position.y <= 0.3) {
            b.state = 'down';
            audio.sfxAt('explosion', b.m.position, { volume: 0.5, rate: 0.6 });
            rig.shake = Math.max(rig.shake, 0.6);
            if (Math.abs(pz - b.z) < 0.9 && player.state !== 'dead') player.hurt(F8.beamDamage);
            for (let i = 0; i < 20; i++) fx.sparks.emit(b.m.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 14, 0, 0)), new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3), [1, 0.5, 0.1], 0.08, 1, -9);
          }
        }
      }
      // Victor's bar; when he falls, part 3
      if (stage === 'boss' && victor) {
        barFill.style.transform = `scaleX(${Math.max(0, victor.health / F8.victorHealth).toFixed(3)})`;
        if (victor.dead && ai.alive.length === 0) {
          subtitles.show('victor', '…You were supposed to stay in 2050.', 3);
          setTimeout(startWalk, 3200);
          stage = 'victor-down';
        }
      }
      // ---- the walk into the fire ----
      if (stage === 'walk') {
        // the guns lower by themselves
        if (player.armed) {
          player.armed = false;
          weapons.guns.forEach((g) => (g.model.visible = false));
          weapons.disabled = true;
          setTimeout(() => subtitles.show('kael', '…My hands won\'t lift it.', 2.6), 400);
          setTimeout(() => objectives.hint('Walk into the fire. Hold [W].', 6), 3200);
        }
        player.aiming = false;
        // progress only by walking forward into the flames
        const k = THREE.MathUtils.clamp((pz - (FIRE_START - 2)) / (ELIAS.z - 2.5 - (FIRE_START - 2)), 0, 1);
        if (k > walk) walk = k;
        player.sprinting = false;
        // the fire doesn't kill him — it costs him: the heartbeat crashes toward the edge
        const targetBeats = Math.max(3, Math.round(walkStartBeats - (walkStartBeats - 3) * walk));
        if (walk > 0 && heartbeat.beats > targetBeats) heartbeat.spend(heartbeat.beats - targetBeats, 'fire', { force: true });
        player.health = player.maxHealth;
        white.style.opacity = (walk * 0.85).toFixed(3);
        uDis.set(walk * 1.05, 0);
        if (walk > 0.98) umbra.object.visible = false;
        if (walk > 0.15 && !this._toldShield) {
          this._toldShield = true;
          subtitles.show('kael', 'I\'m not running. Not this time.', 2.8);
        }
        if (walk >= 1 && stage === 'walk') {
          stage = 'done';
          ctx.complete();
        }
        // Umbra stays a step ahead, fading — he never fights back
        const uz = Math.max(FIRE_START + 2, pz + 2.2);
        umbra.object.position.set(0, 0, Math.min(uz, ELIAS.z - 1.5));
        uCol.setTranslation({ x: 0, y: 0.88, z: umbra.object.position.z });
        umbra.object.lookAt(player.position.x, 0, player.position.z);
      }
    },
    dispose() {
      offBeamRewind();
      bar.remove();
      white.remove();
      uDis.dispose();
      umbra.object.removeFromParent();
      elias.object.removeFromParent();
      engine.removeFromParent();
      weapons.disabled = false;
    },
  };
}

// -----------------------------------------------------------------------------
// Ambient life (vfx/ambientLife.js): the factory burning at 20:20: embers, ash, smoke, sparks, a crane
// -----------------------------------------------------------------------------
function dressAmbient(kit) {
  const life = kit.ambient;
  const { addBox, mats } = kit;
  life.embers({ center: [0, 4, 15], size: [16, 9, 32], count: 600, rise: 1.3, pointSize: 0.06 });
  life.embers({ center: [0, 4.5, 47], size: [36, 10, 30], count: 700, rise: 1.2, pointSize: 0.06 });
  life.embers({ center: [0, 4, 77], size: [9, 9, 30], count: 420, rise: 1.6, brightness: 1.3, pointSize: 0.07 });
  life.ash({ center: [0, 6, 45], size: [40, 12, 100], count: 1300, fall: 0.7, glow: 0.4 });
  life.smokeColumns({ points: [[-6, 1, 4], [6, 1, 18], [-6, 1, 30], [0, 1, 35], [-15, 1, 46], [15, 1, 46]], height: 26, spread: 5, puff: 3.5, life: 9, perPoint: 26, opacity: 0.4, fogK: 0.8 });
  life.sparks({ points: [[-7.6, 6, 12], [7.6, 5.5, 26], [-17.6, 6.5, 44], [17.6, 7, 54], [-4.2, 7.5, 70]], perPoint: 30, interval: 2 });
  // an overhead crane in the hall, its chains swinging in the updraft
  addBox([36, 0.6, 0.8], [0, 9.1, 47], mats.metal, { collide: false });
  life.chains({ points: [[-6, 8.8, 47, 3.6], [6, 8.8, 47, 4.4], [0.5, 8.8, 47, 2.4], [-12, 8.8, 47, 3]] });
  life.cables({ spans: [[-8, 9.6, 5, -8, 4.5, 9, 0.6], [8, 9.6, 20, 8, 5, 27, 0.8], [-18, 9.6, 38, -18, 6.5, 44, 0.7]], radius: 0.02, sway: 0.06 });
}

// -----------------------------------------------------------------------------
// Cutscenes
// -----------------------------------------------------------------------------
function introScript(world) {
  const { kit, scene } = world;
  const vTpl = kit.assets.get('characters.victor');
  const young = new Actor('victor', createModelInstance(vTpl), vTpl.animations);
  scene.add(young.object);
  young.place([10, 0, 72], -Math.PI / 2);
  young.play('walk', 0.01);
  const can = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.35, 0.15), new THREE.MeshStandardMaterial({ color: 0xaa2222, roughness: 0.6 }));
  young.object.add(can);
  can.position.set(-0.3, 0.6, 0.1);
  const clock = makeClock();
  clock.position.set(3.4, 3, ELIAS.z + 7.8);
  scene.add(clock);
  const { elias } = world.level;
  return {
    id: 'm8_intro',
    mood: 'MEMORY',
    handheld: 0.01,
    missionCard: 8,
    steps: [
      at(0, letterbox(true)),
      at(0, music('ending', 3)),
      // before the fire: Elias at his engine, warm light
      at(0, cam.cut([3, 1.8, ELIAS.z - 4], [0.6, 1.3, ELIAS.z + 0.6])),
      at(0, fade.in(2)),
      at(0.4, call(() => elias.play('interact', 0.3))),
      at(1.4, subtitle('kael', '(The factory. Before.)', 2.4)),
      at(4.0, cam.cut([-3.6, 1.7, ELIAS.z - 1], [0.6, 1.4, ELIAS.z + 0.4])),
      at(4.2, subtitle('kael', '(Dad. Alive.)', 2)),
      // young Victor with the gas can
      at(6.4, cam.cut([6, 1.6, 68], [10, 1.2, 72])),
      at(6.4, call(() => young.moveTo([4, 0, ELIAS.z - 3], 1.3, { arriveAnim: 'idle' }))),
      at(7.2, subtitle('kael', '(Victor. Younger. And that can—)', 2.6)),
      // the clock: 20:20
      at(10.2, cam.cut([3.4, 3, ELIAS.z + 6.2], [3.4, 3, ELIAS.z + 7.8])),
      at(10.4, sfx('clock_tick', { volume: 1 })),
      at(11.4, sfx('clock_tick', { volume: 1 })),
      at(12.0, flash('#ff8a3a', 0.6)),
      at(12.0, setMood('FIRE', 0.4)),
      at(12.0, call(() => {
        for (let i = 0; i < 5; i++) world.fire.ignite(new THREE.Vector3(4 + (Math.random() - 0.5) * 3, 0.4, ELIAS.z - 3 + (Math.random() - 0.5) * 3), { size: 1.4, fuel: 10 });
      })),
      at(12.2, sfx('explosion', { volume: 0.7, rate: 0.7 })),
      at(12.6, subtitle('kael', 'NO—', 1)),
      at(13.6, glitch(0.4, 0.8)),
      at(13.8, call(() => {
        young.object.removeFromParent();
        world.fire.fires.slice().forEach((f) => f.point.z > 60 && world.fire._remove(f));
      })),
      at(13.8, setMood('NEUTRAL', 0.3)),
      at(13.8, cam.cut([0, 1.7, -0.5], [0, 1.4, 10])),
      at(14.0, subtitle('clockmaker', 'Twenty-twenty. This is the night, Kael. Go.', 2.8)),
      at(17.0, letterbox(false)),
    ],
    duration: 17.2,
  };
}

function makeClock() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#e8e2d0';
  x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.fill();
  x.strokeStyle = '#222'; x.lineWidth = 4;
  x.beginPath(); x.arc(64, 64, 60, 0, Math.PI * 2); x.stroke();
  // 20:20 → hour hand near 8, minute hand on 4
  const hand = (a, l, w) => { x.lineWidth = w; x.beginPath(); x.moveTo(64, 64); x.lineTo(64 + Math.sin(a) * l, 64 - Math.cos(a) * l); x.stroke(); };
  hand(((8 + 20 / 60) / 12) * Math.PI * 2, 30, 6);
  hand((20 / 60) * Math.PI * 2, 46, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.6, 32), new THREE.MeshBasicMaterial({ map: t }));
  m.rotation.y = Math.PI;
  return m;
}

function outroScript(world) {
  const { elias } = world.level;
  const white = document.querySelector('.whiteout');
  return {
    id: 'm8_outro',
    mood: 'FIRE',
    handheld: 0.006,
    steps: [
      at(0, letterbox(true)),
      at(0, call(() => {
        if (white) white.style.opacity = 0.35;
        elias.lookAt(world.player.position, 3);
        elias.play('idle', 0.3);
      })),
      at(0, cam.cut([1.4, 1.65, ELIAS.z - 2.6], [0, 1.6, ELIAS.z])),
      at(0.8, voice('m8_elias_01')),
      at(0.8, subtitle('elias', 'You stopped running.', 3)),
      at(3.8, call(() => white && gsap.to(white, { opacity: 1, duration: 2.2 }))),
      at(4.0, setMood('NEUTRAL', 2)),
      at(5.0, call(() => audio.stopMusic(2))),
      at(6.2, sfx('flatline', { volume: 0.9, stopAfter: 3.6 })),
      at(10.2, sfx('monitor_beep', { volume: 1 })),
      at(11.4, sfx('monitor_beep', { volume: 1 })),
      at(12.6, fade.out(0.8, '#ffffff')),
    ],
    duration: 13.6,
  };
}

void input;
void voice;

// =============================================================================
// FLATLINE: 2050 — missions/m2_wakeInTheRain.js
// MISSION 2 · WAKE IN THE RAIN (2020 · 🌑 SHADOWS · tutorial) — Phase 9.1
//
//   intro: rain on Kael's face, he wakes gasping, the scar appears on his
//          hand, the Clockmaker on a broken radio, sirens.
//   play:  A  the alley — move, sprint, vault
//          B  the police checkpoint — cover, pistol, shoot out the gate lamp,
//             Shadow Step through the dark gate
//          C  fire stairs to the rooftop — a firefight with the raid team
//          D  Mara Voss chases him over the skybridge — sprint to the dark hut
//   outro: Mara's flashlight sweeps the hut and misses him. A newspaper:
//          "ENGINEER ELIAS RAYNE — FACTORY FIRE TONIGHT?" The date is today.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { at, cam, sfx, voice, subtitle, fade, call, setMood, music, letterbox } from '../cutscenes/steps.js';
import { objectives } from '../ui/objectiveHUD.js';
import { createOnFootWorld, ON_FOOT_ASSETS } from '../scenes/onFootWorld.js';
import { runMission } from './missionManager.js';

const ASSETS = [
  ...ON_FOOT_ASSETS,
  'props.radio', 'props.dumpster', 'props.ac_unit', 'vehicles.police_car', 'characters.mara',
  'sfx.siren', 'voice.m2_clockmaker_01', 'music.city_rain_2020',
];

const SPAWN = [0, 0, -9];

/** Hale's men in 2020 wear police blue tonight. */
function stylePolice(model) {
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.material = [].concat(o.material).map((m) => {
      const c = m.clone();
      if (c.color) c.color.lerp(new THREE.Color(0x101a3a), 0.65);
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
}

/** The front-page canvas for the outro. */
function newspaperTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 680;
  const x = c.getContext('2d');
  x.fillStyle = '#d9d2bf';
  x.fillRect(0, 0, 512, 680);
  x.fillStyle = '#1a1814';
  x.font = '700 46px Georgia, serif';
  x.textAlign = 'center';
  x.fillText('THE CITY HERALD', 256, 64);
  x.fillRect(24, 82, 464, 3);
  x.font = '18px Georgia, serif';
  const today = new Date(2020, 9, 20);
  x.fillText(today.toDateString().toUpperCase() + ' · EVENING EDITION', 256, 108);
  x.font = '700 40px Georgia, serif';
  ['ENGINEER ELIAS RAYNE —', 'FACTORY FIRE', 'TONIGHT?'].forEach((l, i) => x.fillText(l, 256, 176 + i * 48));
  x.fillStyle = '#8a8270';
  x.fillRect(40, 330, 432, 200);
  x.fillStyle = '#1a1814';
  x.font = '16px Georgia, serif';
  x.textAlign = 'left';
  ['Anonymous threats against the Rayne Motor Works', 'surfaced this week as the inventor prepares to', 'unveil his "magnetic engine". Business partner', 'Victor Hale declined to comment…'].forEach((l, i) => x.fillText(l, 40, 560 + i * 24));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function playMission2() {
  return runMission({
    number: 2,
    assets: ASSETS,
    parTime: 420,
    music: 'city_rain_2020',
    create: (assets, ctx) => createOnFootWorld(game.renderer, assets, {
      spawn: SPAWN,
      yaw: 0,
      fog: 0.028,
      rainFX: true,
      echo: (p) => (p.y < 3 && Math.abs(p.x) < 11.5 ? CONFIG.weapons.echo : null),
      loadout: ['pistol'],
      onExit: ctx.onExit,
      build: (kit) => buildLevel(kit, ctx),
    }),
    intro: introScript,
    outro: outroScript,
  });
}

// -----------------------------------------------------------------------------
// Level
// -----------------------------------------------------------------------------
function buildLevel(kit, ctx) {
  const { THREE: T, scene, mats, addBox, addProp, addLamp, addCover, addStairs, ai, player, assets } = kit;
  const brick = mats.brick;

  // ---- A · the alley (z −12 … 10) -----------------------------------------------------------
  addBox([1, 12, 23], [-4.5, 6, -1], brick);
  addBox([1, 12, 23], [4.5, 6, -1], brick);
  addBox([10, 12, 1], [0, 6, -12.5], brick);
  addProp('props.dumpster', [-3.2, 0, -4], Math.PI / 2, { surface: 'metal' });
  addProp('props.crate', [2.8, 0, -7], 0.2, { surface: 'wood' });
  const radio = addProp('props.radio', [2.8, 0.8, -7], -0.8, { collide: false });
  addBox([8, 0.9, 0.4], [0, 0.45, 9], mats.concrete); // vault me
  addLamp([-4, 0, -1], { rotY: Math.PI / 2, intensity: 10, reach: 7 });
  kit.addFragment([3.4, 0, 1], 'Rain. It never rained in the Velodrome.');

  // ---- B · the checkpoint street (z 10 … 38) ------------------------------------------------------
  addBox([7, 12, 1], [-8, 6, 10], brick);
  addBox([7, 12, 1], [8, 6, 10], brick);
  addBox([1, 12, 28], [-11.5, 6, 24], brick);
  addBox([1, 12, 28], [11.5, 6, 24], brick);
  const car = addProp('vehicles.police_car', [6, 0, 22], 0.35, { surface: 'metal' });
  addProp('props.crate', [-6, 0, 18], 0.3, { surface: 'wood' });
  addProp('props.crate', [-7, 0, 27], -0.4, { surface: 'wood' });
  addProp('props.crate', [-6.2, 0.8, 27.2], 0.1, { surface: 'wood' });
  // gate wall with a 4 m gap at x 4…8
  addBox([15, 4, 0.6], [-3.5, 2, 38], mats.concrete);
  addBox([3.5, 4, 0.6], [9.75, 2, 38], mats.concrete);
  const gateLamp = addLamp([6, 0, 35.2], { rotY: Math.PI, intensity: 38, reach: 12 });
  addLamp([-10.8, 0, 16], { rotY: Math.PI / 2, intensity: 14, reach: 8 });
  // siren lights on the police car
  const sirenRed = new T.PointLight(0xff1a2a, 0, 12, 2);
  const sirenBlue = new T.PointLight(0x1a4aff, 0, 12, 2);
  sirenRed.position.set(5.6, 1.9, 22);
  sirenBlue.position.set(6.4, 1.9, 22);
  scene.add(sirenRed, sirenBlue);
  [[-6, 0, 16.9], [-6, 0, 19.1], [-7, 0, 25.9], [4.6, 0, 22.5], [7.6, 0, 21.4], [-2, 0, 37.2], [10, 0, 37.2]].forEach((p, i) => addCover(p, i < 5));
  [[-6, 0.4, 18], [-7, 0.4, 27]].forEach((p) => kit.addFlammable(p));
  const gateA = ai.spawn({ position: [5, 0, 36.4], yaw: Math.PI, patrol: [] });
  const gateB = ai.spawn({ position: [7, 0, 36.4], yaw: Math.PI, patrol: [] });
  const walker = ai.spawn({ position: [-2, 0, 30], yaw: Math.PI, patrol: [[-2, 0, 30], [2, 0, 20], [-4, 0, 22]] });
  [gateA, gateB, walker].forEach((e) => stylePolice(e.model));

  // ---- C · courtyard → fire stairs → rooftop 1 (y 4, z 46.4 … 76.4) -----------------------------
  addBox([1, 12, 10], [-11.5, 6, 43], brick);
  addBox([1, 12, 10], [11.5, 6, 43], brick);
  addStairs([-6, 0, 40], { width: 3, steps: 16, rise: 0.25, depth: 0.4, mat: mats.metal });
  addBox([22, 4, 30], [0, 2, 61.4], brick);              // the building (its roof is the arena)
  addBox([0.4, 1, 30], [-10.8, 4.5, 61.4], mats.concrete); // parapets
  addBox([0.4, 1, 30], [10.8, 4.5, 61.4], mats.concrete);
  addBox([9.5, 1, 0.4], [-6.25, 4.5, 76.2], mats.concrete);
  addBox([9.5, 1, 0.4], [6.25, 4.5, 76.2], mats.concrete);
  addProp('props.ac_unit', [-4, 4, 55], 0, { surface: 'metal' });
  addProp('props.ac_unit', [5, 4, 62], 0, { surface: 'metal' });
  addBox([3, 1, 0.5], [4, 4.5, 55], mats.concrete);
  addBox([3, 1, 0.5], [-5, 4.5, 64], mats.concrete);
  addBox([3, 1, 0.5], [2, 4.5, 70], mats.concrete);
  addLamp([9.5, 4, 58], { rotY: -Math.PI / 2, intensity: 30, reach: 12 });
  addLamp([-9.5, 4, 70], { rotY: Math.PI / 2, intensity: 30, reach: 12 });
  [[4, 4, 54.2], [4, 4, 55.8], [-5, 4, 63.2], [-5, 4, 64.8], [2, 4, 69.2], [2, 4, 70.8], [-4, 4, 54], [5, 4, 61]].forEach((p) => addCover(p, true));
  const roofTeam = [
    ai.spawn({ position: [0, 4, 72], yaw: Math.PI, patrol: [[0, 4, 72], [-6, 4, 72]] }),
    ai.spawn({ position: [6, 4, 66], yaw: Math.PI, patrol: [[6, 4, 66], [8, 4, 74]] }),
    ai.spawn({ position: [-7, 4, 60], yaw: Math.PI / 2, patrol: [[-7, 4, 60], [-7, 4, 68]] }),
  ];
  roofTeam.forEach((e) => stylePolice(e.model));
  kit.addFragment([9, 4, 74.5], 'Dad\'s voice on the phone: "Come by the factory tonight."');

  // ---- D · skybridge → rooftop 2 → the dark hut -----------------------------------------------------
  addBox([3, 0.3, 6], [0, 3.85, 79.4], mats.metal, { surface: 'metal' });
  addBox([0.1, 1, 6], [-1.5, 4.5, 79.4], mats.metal);
  addBox([0.1, 1, 6], [1.5, 4.5, 79.4], mats.metal);
  addBox([16, 4, 24], [0, 2, 94.4], brick);
  addBox([0.4, 1, 24], [-7.8, 4.5, 94.4], mats.concrete);
  addBox([0.4, 1, 24], [7.8, 4.5, 94.4], mats.concrete);
  addBox([16, 1, 0.4], [0, 4.5, 106.2], mats.concrete);
  // the hut: dark inside, door gap x −1 … 1 facing −Z
  addBox([6, 3, 0.3], [0, 5.5, 106], brick);
  addBox([0.3, 3, 4], [-3, 5.5, 104], brick);
  addBox([0.3, 3, 4], [3, 5.5, 104], brick);
  addBox([2, 3, 0.3], [-2, 5.5, 102], brick);
  addBox([2, 3, 0.3], [2, 5.5, 102], brick);
  addBox([6.3, 0.3, 4.3], [0, 7.1, 104], brick);
  addProp('props.crate', [1.8, 4, 105], 0, { surface: 'wood' });
  const paper = new T.Mesh(kit.track(new T.PlaneGeometry(0.42, 0.56)), kit.track(new T.MeshStandardMaterial({ map: kit.track(newspaperTexture()), roughness: 0.9 })));
  paper.rotation.x = -Math.PI / 2;
  paper.rotation.z = Math.PI + 0.3; // headline toward the viewer
  paper.position.set(1.8, 4.81, 105);
  scene.add(paper);
  addLamp([7, 4, 86], { rotY: -Math.PI / 2, intensity: 22, reach: 10 });

  // ---- Mara Voss (chases in part D) --------------------------------------------------------------------
  const maraTpl = assets.get('characters.mara');
  const mara = new Actor('mara', createModelInstance(maraTpl), maraTpl.animations, { runSpeed: 4.2 });
  scene.add(mara.object);
  mara.place([-6, 4, 47.5], 0);
  mara.object.visible = false;
  mara.play('idle_gun', 0.01);
  const flashlight = new T.SpotLight(0xfff2d8, 0, 18, 0.35, 0.5, 1.5);
  scene.add(flashlight, flashlight.target);

  dressAmbient(kit, { sirenRed, sirenBlue });

  // ---- Objectives & triggers -----------------------------------------------------------------------------
  const triggers = [];
  const trigger = (p, r, fn) => triggers.push({ p: new T.Vector3(...p), r, fn, done: false });
  let stage = 'alley';
  let chase = false;
  let caughtT = 0;
  const say = (who, text, s = 3) => subtitles.show(who, text, s);

  // the radio repeats the Clockmaker's line if you want it again
  kit.addInteractable({
    position: radio.position, prompt: 'Listen to the radio', height: 0.5,
    onInteract: async () => {
      audio.sfx('radio_static', { volume: 0.8 });
      await new Promise((r) => setTimeout(r, 500));
      audio.play('voice', 'm2_clockmaker_01');
      say('clockmaker', 'Your body is dying in 2050. Find the truth in this year, or you never wake up.', 5);
    },
  });

  trigger([0, 0, 4], 3, () => objectives.hint('[Shift] sprint · [Space] at a low wall to vault', 6));
  trigger([0, 0, 12], 3.5, () => {
    stage = 'street';
    kit.setCheckpoint([0, 0, 12], 0);
    objectives.set('Get past the police checkpoint');
    objectives.hint('[E] next to the car or crates to take cover', 6);
    audio.sfxAt('siren', new T.Vector3(6, 1.5, 22), { volume: 0.6 });
  });
  trigger([0, 0, 24], 5, () => objectives.hint('The gate lamp gives you away. [RMB] aim · [LMB] shoot it out', 7));
  let gateHinted = false;
  trigger([-6, 4, 47.5], 2.5, () => {
    stage = 'roof';
    kit.setCheckpoint([-6, 4, 47.6], 0);
    objectives.set('Fight through the raid team on the roof');
    objectives.hint('Shoot out the roof lights — in the dark they can\'t see you', 6);
  });
  trigger([0, 4, 77.5], 2.5, () => {
    stage = 'chase';
    chase = true;
    mara.object.visible = true;
    mara.place([-6, 4, 47.5], 0);
    objectives.set('Lose Mara Voss — reach the dark hut');
    objectives.hint('[Shift] sprint over the bridge', 5);
    say('mara', 'Rayne! Police! Stay where you are!', 3);
    audio.sfxAt('siren', mara.object.position, { volume: 0.5 });
  });
  trigger([0, 4, 104.2], 1.4, () => {
    stage = 'done';
    chase = false;
    ctx.complete();
  });

  let sirenT = 0;
  return {
    mara,
    paper,
    flashlight,
    start() {
      objectives.set('Escape the police raid');
      objectives.hint('[WASD] move · [Mouse] look — click to capture the mouse', 6);
    },
    update(dt) {
      const pp = player.position;
      for (const t of triggers) {
        if (t.done || t.p.distanceTo(pp) > t.r) continue;
        t.done = true;
        t.fn();
      }
      // gate hint once the lamp is out
      if (!gateHinted && stage === 'street' && !gateLamp.on) {
        gateHinted = true;
        objectives.hint('It\'s dark now. Hold [T], aim through the gate, release to 🌑 Shadow Step', 8);
      }
      // siren lights
      sirenT += dt;
      const ph = Math.floor(sirenT * 4) % 2;
      sirenRed.intensity = ph ? 18 : 0;
      sirenBlue.intensity = ph ? 0 : 18;
      void car;
      // Mara's chase
      mara.update(dt);
      if (chase && player.state !== 'dead') {
        const target = pp.clone();
        const d = mara.object.position.distanceTo(target);
        if (d > 1.4) {
          // run along the roof line (she follows Kael's path)
          const dir = target.sub(mara.object.position).setY(0).normalize();
          mara.object.position.addScaledVector(dir, Math.min(d, CONFIG.mission2.maraSpeed * dt));
          mara.object.position.y = pp.y > 3 ? 4 : mara.object.position.y;
          mara.object.rotation.y = Math.atan2(dir.x, dir.z);
          if (mara.currentName !== 'run') mara.play('run', 0.2);
          caughtT = 0;
        } else {
          caughtT += dt;
          if (mara.currentName !== 'idle_gun_pointing') mara.play('idle_gun_pointing', 0.2);
          if (caughtT > 0.8) {
            say('mara', 'Got you. Hands where I can see them.', 2.5);
            chase = false;
            setTimeout(() => {
              kit.player.respawn(new T.Vector3(-6, 4, 47.6), 0);
              mara.place([-6, 4, 40], 0);
              mara.object.visible = false;
              triggers.forEach((t) => {
                if (t.p.z > 77 && t.p.z < 78) t.done = false;
              });
              objectives.hint('She\'s faster than you think. Sprint the whole way.', 5);
            }, 1800);
          }
        }
        flashlight.intensity = 0;
      }
    },
    dispose() {
      sirenRed.removeFromParent();
      sirenBlue.removeFromParent();
      mara.object.removeFromParent();
      flashlight.removeFromParent();
    },
  };
}

// -----------------------------------------------------------------------------
// Ambient life (vfx/ambientLife.js): the rainy city around the raid
// -----------------------------------------------------------------------------
function dressAmbient(kit, { sirenRed, sirenBlue }) {
  const { THREE: T, scene, mats, addBox } = kit;
  const life = kit.ambient;
  // ground-level details the ambient layers hang off: ledges, a manhole, wall vents
  addBox([0.5, 0.18, 20], [-10.75, 3.5, 24], mats.concrete, { collide: false, cast: false });
  addBox([0.5, 0.18, 20], [10.75, 3.5, 24], mats.concrete, { collide: false, cast: false });
  const iron = kit.track(new T.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.8, roughness: 0.5 }));
  for (const [x, z] of [[0.5, 30], [-1.5, 1.5]]) {
    const cover = new T.Mesh(kit.track(new T.CylinderGeometry(0.42, 0.42, 0.04, 20)), iron);
    cover.position.set(x, 0.02, z);
    cover.receiveShadow = true;
    scene.add(cover);
  }
  addBox([0.6, 0.45, 0.12], [3.96, 1.6, -6], mats.metal, { collide: false });
  addBox([0.6, 0.45, 0.12], [-10.96, 2.4, 33], mats.metal, { collide: false });

  life.splashes();
  life.drips({
    edges: [
      [-10.5, 3.4, 15, -10.5, 3.4, 33, 3.4], [10.5, 3.4, 15, 10.5, 3.4, 33, 3.4], // street ledges
      [-1.5, 3.7, 76.6, -1.5, 3.7, 82.2, 3.7], [1.5, 3.7, 76.6, 1.5, 3.7, 82.2, 3.7], // skybridge
      [-11, 3.95, 46.3, 11, 3.95, 46.3, 3.95],                                          // roof edge over the courtyard
      [-3, 7.2, 101.8, 3, 7.2, 101.8, 2.4],                                              // the hut's eave
    ],
    count: 220,
  });
  life.steam({ points: [[0.5, 0.05, 30], [-1.5, 0.05, 1.5]], perPoint: 34, height: 3.2, opacity: 0.16 });
  life.steam({ points: [[3.8, 1.6, -6], [-10.8, 2.4, 33], [8, 4.3, 66], [-6.5, 4.3, 92]], perPoint: 18, height: 2.2, spread: 0.8, puff: 0.6, opacity: 0.12, wind: [-0.4, 0, 0.1] });
  life.neonSigns([
    { position: [-3.97, 4.2, 1], rotY: Math.PI / 2, text: 'NOODLES 24H', color: '#ff2a8a', height: 0.7, mode: 'steady' },
    { position: [3.97, 5.4, -8], rotY: -Math.PI / 2, text: 'HOTEL', color: '#3fa9ff', height: 0.9, mode: 'flicker' },
    { position: [-10.97, 5.2, 29], rotY: Math.PI / 2, text: 'PAWN · GOLD', color: '#ff8a1a', height: 0.8, mode: 'broken' },
    { position: [10.97, 5, 15], rotY: -Math.PI / 2, text: 'BAR', color: '#ff2340', height: 1, mode: 'blink' },
    { position: [0, 7.6, 106.6], rotY: Math.PI, text: 'HALE INDUSTRIES', color: '#9fd8ff', height: 1.3, mode: 'steady', border: false },
  ]);
  // wires across the alley (festoon bulbs) and the street
  life.cables({
    spans: [[-4, 6.6, -8, 4, 6.4, -7, 0.7], [-4, 6.2, -2, 4, 6.5, -2.5, 0.8], [-4, 6.8, 4.5, 4, 6.6, 4, 0.6]],
    bulbs: 9,
  });
  life.cables({ spans: [[-11, 8, 14, 11, 8.2, 13, 1.1], [-11, 7.6, 25, 11, 7.9, 27, 1.3], [-11, 9, 26, 11, 9.4, 18, 1.5]], sway: 0.18 });
  life.birds({ perches: [[-10.7, 3.6, 19], [-10.7, 3.6, 22], [10.7, 3.6, 27], [10.7, 3.6, 31], [10.8, 5, 52], [-10.8, 5, 68], [-7.8, 5, 96]] });
  life.papers({ wind: [0.9, 0, 1.4] });
  // the police car's light bar strobes with its siren lights
  life.lightBar({ position: [6, 1.62, 22], rotY: 0.35 + Math.PI / 2, red: sirenRed, blue: sirenBlue });
  // the raid's helicopter sweeping the rooftops, the city beyond, the storm
  life.helicopter({ center: [0, 0, 60], radius: 55, height: 32, speed: 0.07 });
  life.skyline({ center: [0, 0, 50], radius: [75, 210], count: 110, height: [16, 80] });
  life.traffic({ lanes: [[-220, 0, 128, 220, 0, 128], [220, 0, 132, -220, 0, 132], [62, 0, -150, 62, 0, 250], [-62, 0, 250, -62, 0, -150]], cars: 50 });
  life.lightningBolts();
}

// -----------------------------------------------------------------------------
// Cutscenes
// -----------------------------------------------------------------------------
function introScript(world) {
  const p = world.player;
  const kael = p.anims.actor;
  const [x, , z] = SPAWN;
  const hand = p.model.getObjectByName('WristL');
  const scar = new THREE.PointLight(0xff3a1a, 0, 0.6, 2);
  return {
    id: 'm2_intro',
    mood: 'SHADOWS',
    handheld: 0.012,
    missionCard: 2,
    steps: [
      at(0, call(() => {
        p.cinematic = true;
        kael.play('death', 0.01, { loop: false, clamp: true });
        kael.action('death').time = kael.action('death').getClip().duration;
        hand?.add(scar);
      })),
      at(0, letterbox(true)),
      at(0, music('city_rain_2020', 4)),
      at(0, sfx('rain_heavy', { volume: 0.6, stopAfter: 12 })),
      // rain on his face, from above
      at(0, cam.cut([x + 0.3, 1.2, z + 0.4], [x, 0.1, z])),
      at(0, fade.in(3)),
      at(0.2, cam.moveTo([x + 0.6, 0.9, z + 0.9], [x, 0.2, z - 0.2], 5, 'sine.inOut')),
      at(3.2, sfx('heartbeat', { volume: 0.9 })),
      at(3.4, call(() => kael.play('idle', 1.6))), // he gasps awake and gets up
      at(3.4, subtitle('kael', '—!', 1.2)),
      at(4.2, sfx('heartbeat', { volume: 0.8 })),
      at(5.0, cam.moveTo([x - 0.5, 1.5, z + 1.1], [x + 0.2, 1.1, z], 2.2, 'sine.inOut')),
      at(5.6, subtitle('kael', 'Where… This isn\'t the track.', 2.6)),
      // the hands: no scar… then it burns through
      at(7.6, call((ctx) => {
        const w = hand ? hand.getWorldPosition(new THREE.Vector3()) : p.position.clone().add(new THREE.Vector3(0, 1, 0));
        ctx.camera.cut([w.x + 0.45, w.y + 0.25, w.z + 0.45], [w.x, w.y, w.z]);
      })),
      at(7.8, subtitle('kael', 'No scar…', 1.8)),
      at(9.0, call(() => { scar.intensity = 0; })),
      at(9.2, call(() => {
        const s = { v: 0 };
        const id = setInterval(() => { s.v = Math.min(3, s.v + 0.15); scar.intensity = s.v; if (s.v >= 3) clearInterval(id); }, 50);
      })),
      at(9.6, subtitle('kael', '…no. No, no—', 1.8)),
      // the radio
      at(11.2, cam.moveTo([x + 1.4, 1.5, z - 0.6], [x + 2.8, 0.85, z + 2], 1.4, 'sine.inOut')),
      at(11.4, sfx('radio_static', { volume: 0.9 })),
      at(12.2, voice('m2_clockmaker_01')),
      at(12.2, setMood('TIME', 1.5)),
      at(17.6, setMood('SHADOWS', 1)),
      at(17.4, sfx('siren', { volume: 0.7, stopAfter: 5 })),
      at(17.6, call(() => world.lights.items.forEach((it) => it.light.color.setHex(0xffa54a)))),
      at(17.8, subtitle('kael', 'Sirens. They\'re coming for me.', 2.4)),
      at(18.2, cam.moveTo([x, 2.2, z - 2.6], [x, 1.2, z + 6], 2.4, 'sine.inOut')),
      at(20.6, call(() => {
        p.cinematic = false;
        scar.removeFromParent();
      })),
      at(20.6, letterbox(false)),
    ],
    duration: 20.8,
  };
}

function outroScript(world) {
  const level = world.level;
  const mara = level.mara;
  const flash = level.flashlight; // made with the level (no new light mid-game)
  return {
    id: 'm2_outro',
    mood: 'SHADOWS',
    handheld: 0.01,
    steps: [
      at(0, letterbox(true)),
      at(0, call(() => {
        world.player.respawn(new THREE.Vector3(-1.8, 4, 104.6), Math.PI);
        mara.object.visible = true;
        mara.place([-6, 4, 96], 0);
        mara.play('walk', 0.2);
      })),
      // inside the dark hut, looking out through the door
      at(0, cam.cut([-1.6, 5.2, 105.4], [0.6, 4.8, 99])),
      at(0.2, subtitle('kael', '(Don\'t breathe.)', 2)),
      at(0.4, call(() => mara.moveTo([1.4, 4, 100.4], 1.3, { arriveAnim: 'idle_gun' }))),
      at(0.4, call(() => {
        // her flashlight follows her, sweeping
        const t0 = performance.now();
        const id = setInterval(() => {
          const m = mara.object.position;
          flash.position.set(m.x, m.y + 1.4, m.z);
          const k = (performance.now() - t0) / 1000;
          flash.target.position.set(0.3 + Math.sin(k * 1.4) * 1.6, 4.2, 104);
          flash.intensity = 40;
          if (k > 8.5) clearInterval(id);
        }, 30);
      })),
      at(4.2, subtitle('mara', 'Rayne…? I know you\'re up here.', 2.8)),
      at(7.2, call(() => mara.moveTo([7, 4, 92], 1.6, { arriveAnim: 'idle' }))),
      at(7.4, subtitle('mara', '…Dispatch, he\'s gone. Roof\'s clear.', 2.6)),
      at(8.6, call(() => { flash.intensity = 0; })),
      // the newspaper
      at(10, cam.cut([1.55, 5.45, 104.7], [1.8, 4.8, 105])),
      at(10, setMood('NEUTRAL', 1)),
      at(10.4, subtitle('kael', '"Engineer Elias Rayne — factory fire tonight?"', 3)),
      at(13.6, subtitle('kael', 'October 20th, 2020. That\'s… today. That\'s the night he died.', 3.4)),
      at(15.4, cam.moveTo([1.65, 5.0, 104.9], [1.8, 4.8, 105], 2.5, 'sine.in')),
      at(17.2, fade.out(1.2)),
      at(18.4, call(() => { flash.intensity = 0; })),
    ],
    duration: 18.6,
  };
}


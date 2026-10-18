// =============================================================================
// FLATLINE: 2050 — showcase/teaser.js
// STORY TEASER (Settings → Media, or ?teaser): a ~90 s cinematic teaser
// rendered live in the game's own worlds.
//
//   2050  cold open on the Neon Velodrome's final lap → Victor's tablet → the
//         helmet glitches 20.20.20 → BRAKE FAILURE → the crash in slow motion
//         → white → the heart monitor slows → flatline
//   2020  rain; Kael wakes in an alley → the Clockmaker on a broken radio →
//         the burnt factory, the watch stopped at 20:20, his father →
//         Victor Hale ("Burn the whole district") → Umbra steps out of the
//         mirror → the city on fire → the reverse chase → the walk into the
//         fire ("You stopped running.") → FLATLINE: 2050 + tagline
//
// Built on showcase/director.js; skippable (hold SPACE / Esc). Ends on black.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { preload } from '../assets/loader.js';
import { PRELOAD } from '../assets/manifest.js';
import { LoadingScreen } from '../assets/loadingScreen.js';
import { at, cam, sfx, voice, fade, call, setMood, flash, glitch, slowMo, music } from '../cutscenes/steps.js';
import { letterbox } from '../ui/letterbox.js';
import { screenFade } from '../ui/screenFade.js';
import { objectives } from '../ui/objectiveHUD.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { HelmetHUD } from '../ui/helmetHUD.js';
import { createRaceScene } from '../scenes/raceScene.js';
import { ScriptedCrash } from '../vehicles/crash.js';
import { createChaseWorld, ASSETS as CHASE_ASSETS } from '../missions/m7_reverseChase.js';
import { explode } from '../systems/explosions.js';
import { heartbeat } from '../systems/heartbeat.js';
import { Showcase } from './director.js';
import { createShowcaseSet, SET_ASSETS, ZONES, playFirst } from './set2020.js';
import { startRaceNow, raceAutopilot, chaseAutopilot, buildVipBox, buildFireworks } from './driving.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const MUSIC = ['music.race_2050', 'music.city_rain_2020', 'music.umbra', 'music.combat', 'music.reverse_chase', 'music.ending'];
export const TEASER_ASSETS = [...new Set([...PRELOAD.race, ...PRELOAD.mission1, ...SET_ASSETS, ...CHASE_ASSETS, ...MUSIC, 'voice.m1_commentator_01', 'sfx.flatline'])];

/** Play the story teaser. Expects a black screen; ends on black. Resolves { completed, skipped }. */
export async function playStoryTeaser({ from = null } = {}) {
  // --- load everything up front so the cuts never wait ---------------------------------------------
  const loading = new LoadingScreen();
  loading.show();
  const assets = await preload(TEASER_ASSETS, (p) => loading.setProgress(p));
  await loading.hide();

  const sc = new Showcase('teaser');
  document.body.classList.add('sc-hud-off');
  const sections = [
    ['race', () => coldOpen(sc, assets)],
    ['wake', () => wakeInTheRain(sc, assets)],
    ['factory', () => ashes(sc)],
    ['victor', () => victorReveal(sc)],
    ['umbra', () => umbraReveal(sc)],
    ['fire', () => cityOnFire(sc)],
    ['chase', () => reverseChase(sc, assets)],
    ['walk', () => walkIntoFire(sc, assets)],
    ['title', () => titleCard(sc)],
  ];
  const start = Math.max(0, sections.findIndex(([id]) => id === from));
  return sc.run(async () => {
    await sc.guard(screenFade.toBlack(0.01));
    letterbox.show(0.01);
    for (let i = start; i < sections.length; i++) {
      // sections after a jump-in need their world: the set is (re)built on demand
      if (i === start && ['factory', 'victor', 'umbra', 'fire'].includes(sections[i][0])) await sc.setWorld(buildSet(sc, assets));
      sc.beat(sections[i][0]);
      await sections[i][1]();
    }
  });
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function buildSet(sc, assets) {
  const world = createShowcaseSet(game.renderer, assets);
  world.setHudVisible(false);
  world.player.locked = true;
  heartbeat.reset();
  return world;
}

/** Put Kael somewhere (cinematic = the shot plays his clips). */
function placeKael(world, pos, yaw, { cinematic = true, armed = false } = {}) {
  const p = world.player;
  p.cinematic = cinematic;
  p.locked = cinematic;
  p.armed = armed;
  world.weapons.disabled = !armed;
  if (!armed) world.weapons.guns.forEach((g) => g.model && (g.model.visible = false));
  world.inputOverride = null;
  const v = Array.isArray(pos) ? V(...pos) : pos.clone();
  p.respawn(v, yaw);
  p.root.position.copy(v);
  p.yaw = yaw;
  p.model.rotation.y = yaw;
  world.rig.pivot.set(v.x, v.y + 1.6, v.z);
  world.rig.setYaw(yaw, -0.12);
  return p;
}

function kaelPlay(world, names, blend = 0.3, opts) {
  return playFirst(world.player.anims.actor, names, blend, opts);
}

/** Tween a value with gsap, owned by the director (killed on skip). */
function tween(sc, target, vars) {
  const tw = gsap.to(target, vars);
  sc.timelines.add(tw);
  return tw;
}

// =============================================================================
// 2050 — THE LAST LAP
// =============================================================================
async function coldOpen(sc, assets) {
  // black: heartbeat, the card, the world builds behind it
  sc.sfx('heartbeat', { volume: 0.9 });
  const cardP = sc.card('The Neon Velodrome · 2050', 'WORLD GRAND PRIX', 'Final lap', 2.6, { theme: 'TIME' });
  const world = createRaceScene(game.renderer, assets, { laps: 5, playerSlot: 0, mission: true, onExit: () => {} });
  await sc.setWorld(world);
  world.hud.setVisible(false);
  const vip = buildVipBox(world, assets);
  const fireworks = buildFireworks(world);
  const helmet = new HelmetHUD();
  const crash = new ScriptedCrash({ world, helmet, triggerProgress: Infinity });
  sc.own(() => vip.dispose());
  sc.own(() => fireworks.dispose());
  sc.own(() => helmet.destroy());
  sc.own(() => crash.dispose());
  // the dressing brought new materials: compile them too, still under the card
  await sc.guard(game.renderer.compileAsync?.(world.scene, world.camera).catch(() => {}) ?? Promise.resolve());
  await cardP;

  const { car, track } = world;
  const start = track.sampleAt(0).position;
  const ahead = track.sampleAt(120).position;
  startRaceNow(world);
  const pilot = raceAutopilot(world, { boost: false });
  sc.task(pilot);
  sc.sfx('crowd_cheer', { volume: 0.6 });

  // 1 · drone over the stadium as the pack launches
  await sc.shot(4.2, [
    at(0, setMood('NEUTRAL', 0.01)),
    at(0, cam.cut([start.x - 230, 135, start.z - 160], [start.x + 60, 0, start.z + 90])),
    at(0, cam.fov(42, 0.01)),
    at(0, music('race_2050', 0.6)),
    at(0, fade.in(1.0)),
    at(0.05, cam.moveTo([start.x - 72, 34, start.z - 48], [ahead.x, 2, ahead.z], 4.4, 'sine.inOut')),
    at(0.2, sfx('fireworks', { volume: 0.55, stopAfter: 5 })),
    ...[0.5, 1.2, 1.9, 2.7, 3.4].map((t) => at(t, call(() => fireworks.launch(Math.random() * 300)))),
  ]);

  // 2 · low tracking shot alongside car #20 · the commentator
  sc.track(car.root, { from: [-2.4, 0.55, 4.6], to: [1.4, 0.62, 4.1], look: [0.8, 0.6, 0], duration: 3.4, fov: 32 });
  sc.ui.nameTag('Kael Rayne', 'Undefeated · Car #20', 2.8, 'var(--time)');
  await sc.shot(3.2, [at(0.05, voice('m1_commentator_01'))]);

  // 3 · cockpit: the helmet HUD wakes up
  sc.track(car.root, { from: [0.05, 1.08, -0.35], to: [0.32, 1.06, -0.35], look: [30, 0.8, -0.35], duration: 3, fov: 54 });
  helmet.bootUp();
  await sc.shot(2.5, [at(0.2, sfx('heartbeat', { volume: 0.7 })), at(1.2, sfx('heartbeat', { volume: 0.7 }))]);

  // 4 · Victor in the VIP box — the tablet shows the clue
  helmet.clear(0.1);
  sc.ui.nameTag('Victor Hale', 'Owner · World Racing League', 2.6);
  vip.victor.lookAt(vip.trackLook, 1.2);
  await sc.shot(3.0, [
    at(0, cam.fov(38, 0.01)),
    at(0, cam.cut(vip.shotA, vip.tabletLook)),
    at(0, setMood('SHADOWS', 0.3)),
    at(0.05, cam.moveTo(vip.shotB, vip.faceLook, 3.2, 'sine.inOut')),
    at(1.5, call(() => vip.alarm())),
    at(1.5, glitch(0.25, 0.5)),
  ]);

  // 5 · cockpit — 20.20.20 · BRAKE FAILURE
  sc.track(car.root, { from: [0.1, 1.08, -0.35], to: [0.3, 1.07, -0.35], look: [30, 0.8, -0.35], duration: 2.6, fov: 56 });
  await sc.shot(2.6, [
    at(0, setMood('TIME', 0.25)),
    at(0.15, call(() => {
      game.postfx.glitch(0.9, 0.9);
      helmet.timeGlitch(1.25);
    })),
    at(1.45, call(() => {
      helmet.brakeFailure();
      sc.tasks.delete(pilot);
      world.race.state = 'scripted';
      car.brakesFailed = true;
      car.steerFailed = true;
      car.steer = -0.18;
      world.inputOverride = { throttle: 1, brake: 1, steer: 0, handbrake: false, boost: false };
    })),
    at(1.5, sfx('tire_skid', { volume: 0.9 })),
  ]);

  // 6 · outside: the car slides for the wall
  sc.ride(world.camera);
  await sc.shot(1.0, []);

  // 7 · impact — slow motion, glass, sparks, the visor cracks, the explosion
  const centre = () => car.position.clone().setY(Math.max(1, car.position.y));
  const f = car.forward();
  const behind = Math.atan2(-f.x, -f.z);
  const placeFx = (fx, dy) => fx.systems.forEach((s) => s.emitter.position.copy(car.position).add(V(0, dy, 0)));
  await sc.shot(5.0, [
    at(0, call(() => {
      crash._flip();
      placeFx(crash.fx.sparks, 0.3);
      placeFx(crash.fx.glass, 1.1);
      crash.fx.sparks.burst();
      crash.fx.glass.burst();
      helmet.crackVisor();
      game.postfx.setChromaticAberration(1, 0.1);
    })),
    at(0, music(null, 0.25)),
    at(0, slowMo(0.15, 2.8, 0.08)),
    at(0, sfx('car_crash', { volume: 1, rate: 0.7 })),
    at(0.05, sfx('glass_shatter', { volume: 1, rate: 0.75 })),
    at(0, cam.fov(44, 0.01)),
    at(0, cam.orbit(centre, 8.5, behind + 0.4, behind + 2.3, 1.6, 3.1, 'sine.inOut')),
    at(0.9, call(() => {
      placeFx(crash.fx.sparks, 0.2);
      crash.fx.sparks.burst();
    })),
    at(0.9, sfx('bullet_impact', { volume: 0.8, rate: 0.6 })),
    at(1.5, setMood('FIRE', 0.5)),
    at(2.8, call(() => {
      placeFx(crash.fx.explosion, 0.8);
      crash.fx.explosion.burst();
      crash.fireLight.position.copy(car.position).setY(2);
      crash.fireLight.intensity = 900;
      helmet.clear(0.2);
    })),
    at(2.8, sfx('explosion', { volume: 1 })),
    at(2.8, flash('#ffd2a0', 0.6)),
    at(2.85, cam.shake(0.55, 1.4)),
    at(2.9, glitch(0.5, 0.7)),
    at(4.0, fade.out(0.3, '#ffffff')),
    at(4.4, fade.out(0.6, '#000000')),
  ]);
  game.postfx.setChromaticAberration(0, 0.2);

  // black: the heart monitor slows… flatline
  sc.beat('flatline');
  for (const [d, rate, vol] of [[0.15, 1, 1], [0.8, 0.95, 0.9], [1.0, 0.9, 0.8], [1.25, 0.85, 0.7]]) {
    await sc.wait(d);
    sc.sfx('monitor_beep', { volume: vol, rate });
  }
  sc.ui.card('', 'KAEL RAYNE', 'Status: coma', { theme: 'TIME', size: 'm' });
  await sc.wait(0.5);
  sc.sfx('flatline', { volume: 0.8, stopAfter: 2.6 });
  await sc.wait(1.9);
  await sc.ui.hideCard(0.3);
}

// =============================================================================
// 2020 — WAKE IN THE RAIN
// =============================================================================
async function wakeInTheRain(sc, assets) {
  // card while the 2020 set builds
  const cardP = sc.card('', 'HE CRASHED IN THE FUTURE.', '', 1.9, { theme: 'TIME', scramble: false });
  const world = await sc.setWorld(buildSet(sc, assets));
  await cardP;
  const set = world.level;
  const p = placeKael(world, [0, 0, -8], 0.5);
  // lying in the rain: the end pose of the death clip
  const a = p.anims.actor;
  if (kaelPlay(world, ['death'], 0.01, { loop: false, clamp: true })) {
    const act = a.action('death');
    if (act) act.time = act.getClip().duration;
  }
  set.rain(true);
  world.scene.fog.density = 0.036;
  const rainId = sc.sfx('rain_heavy', { volume: 0 });
  if (rainId != null) audio.set('sfx', 'rain_heavy', rainId, { volume: 0 });
  tween(sc, { v: 0 }, { v: 0.65, duration: 2.5, onUpdate() { audio.set('sfx', 'rain_heavy', rainId, { volume: this.targets()[0].v }); } });
  set.stage(0, { pos: [1.4, 1.6, -2.4], color: 0xffa860, intensity: 3, distance: 6 }); // the radio's little glow

  // 1 · the ground, rain on his face
  await sc.shot(3.5, [
    at(0, setMood('SHADOWS', 0.01)),
    at(0, cam.fov(36, 0.01)),
    at(0, cam.cut([0.55, 0.32, -7.0], [0, 0.22, -8.1])),
    at(0, fade.in(1.6)),
    at(0, music('city_rain_2020', 2.5)),
    at(0.05, cam.moveTo([1.1, 0.55, -6.5], [0, 0.3, -8.2], 3.8, 'sine.inOut')),
    at(0.5, sfx('heartbeat', { volume: 0.9 })),
    at(1.0, call(() => sc.ui.stamp('2020 · THE SAME CITY', 'THIRTY YEARS EARLIER', 3.4))),
    at(1.5, sfx('heartbeat', { volume: 0.9 })),
    at(2.3, call(() => world.rain?.lightning({ thunder: false }))),
    at(2.4, sfx('thunder', { volume: 0.8 })),
  ]);

  // 2 · he gets up · the radio crackles
  const rose = kaelPlay(world, ['stand_up', 'get_up', 'waking_up'], 0.6, { loop: false, clamp: true });
  if (!rose) kaelPlay(world, ['idle'], 1.4);
  else setTimeout(() => !sc.aborted && kaelPlay(world, ['look_around', 'idle'], 0.6), 1800);
  await sc.shot(2.5, [
    at(0, cam.fov(40, 0.01)),
    at(0, cam.cut([2.4, 1.0, -5.4], [0, 0.8, -8])),
    at(0.05, cam.moveTo([2.1, 1.55, -5.1], [0, 1.35, -8], 2.6, 'sine.out')),
    at(0.5, sfx('radio_static', { volume: 0.75 })),
    at(1.1, voice('m2_clockmaker_01')),
  ]);

  // 3 · the radio in the foreground, Kael behind it in the rain
  p.yaw = Math.atan2(1.4 - 0, -2.05 + 8);
  await sc.shot(5.5, [
    at(0, cam.fov(34, 0.01)),
    at(0, cam.cut([1.75, 1.22, -0.85], [1.15, 1.05, -4.5])),
    at(0.05, cam.moveTo([1.6, 1.18, -1.25], [0.9, 1.15, -5.5], 5.4, 'sine.inOut')),
    at(2.6, call(() => world.rain?.lightning({ thunder: false }))),
    at(2.7, sfx('thunder', { volume: 0.5, rate: 0.9 })),
  ]);
  void rainId;
  await sc.card('', 'HE WOKE UP IN THE PAST.', '', 1.7, { theme: 'TIME', scramble: false, fade: 0.4 });
  if (rainId != null) sc.stopSound('rain_heavy', rainId, 0.6);
  set.rain(false);
}

// =============================================================================
// THE FACTORY — ASHES, THE WATCH, THE MEMORY
// =============================================================================
async function ashes(sc) {
  const world = sc.world;
  const set = world.level;
  const F = ZONES.factory;
  set.stageOff();
  set.clearFires();
  world.scene.fog.density = 0.03;
  placeKael(world, [F.x + 3.4, 0, F.z + 0.4], -2.2);
  kaelPlay(world, ['kneel', 'crouch_idle', 'idle'], 0.01);
  [[-6, 0.4, -10], [6, 0.5, -9], [-4, 0.3, -2], [5, 0.3, 2], [-9, 0.4, 5], [8, 0.3, -3]].forEach(([x, y, z]) => world.fire.ignite(V(F.x + x, y, F.z + z), { size: 1.3, fuel: 60 }));
  const w = set.watch.position;
  set.stage(0, { pos: [w.x + 0.5, 0.7, w.z + 0.4], color: 0xffa060, intensity: 1.6, distance: 3 });
  set.stage(1, { pos: [F.x, 3.5, F.z - 4], color: 0xff7a30, intensity: 18, distance: 16 });

  // 1 · inside the burnt factory
  await sc.shot(2.8, [
    at(0, setMood('FIRE', 0.01)),
    at(0, cam.fov(42, 0.01)),
    at(0, cam.cut([F.x - 7.5, 1.8, F.z + 7.5], [F.x + 0.5, 1.2, F.z - 4])),
    at(0, music('umbra', 1.2)),
    at(0, fade.in(0.6)),
    at(0.05, cam.moveTo([F.x - 5, 1.45, F.z + 4.6], [F.x + 1.4, 0.8, F.z - 2.4], 3, 'sine.inOut')),
    at(0.3, call(() => sc.ui.stamp('THE RAYNE FACTORY', 'THE NIGHT HIS FATHER DIED', 2.6))),
  ]);

  // 2 · macro: the watch, stopped at 20:20
  await sc.shot(2.9, [
    at(0, cam.fov(30, 0.01)),
    at(0, cam.cut([w.x + 0.3, 0.26, w.z + 0.26], [w.x, 0.01, w.z])),
    at(0.05, cam.moveTo([w.x + 0.13, 0.15, w.z + 0.1], [w.x, 0.008, w.z], 2.9, 'sine.inOut')),
    at(0.3, sfx('clock_tick', { volume: 1 })),
    at(1.3, sfx('clock_tick', { volume: 1 })),
    at(1.3, call(() => sc.ui.card('', '20:20', '', { theme: 'FIRE', size: 'xl', scramble: false }))),
    at(2.3, call(() => sc.ui.hideCard(0.3))),
    at(2.3, glitch(0.3, 0.6)),
  ]);

  // 3 · the memory: his father at the engine, the fire
  set.actors.elias.object.visible = true;
  set.stage(2, { pos: [F.x + 0.5, 2.2, F.z - 6.4], color: 0xffd9a0, intensity: 8, distance: 7 });
  await sc.shot(2.5, [
    at(0, flash('#ffffff', 0.5)),
    at(0, setMood('MEMORY', 0.01)),
    at(0, cam.fov(36, 0.01)),
    at(0, cam.cut([F.x - 2.4, 1.6, F.z - 5.2], [F.x, 1.35, F.z - 8.8])),
    at(0.05, cam.moveTo([F.x - 1.6, 1.62, F.z - 6.0], [F.x, 1.4, F.z - 8.9], 2.6, 'sine.out')),
    at(0.2, call(() => sc.ui.nameTag('Elias Rayne', 'His father · Inventor of the magnetic engine', 2.1, '#9be3a8'))),
    at(1.9, glitch(0.35, 0.8)),
    at(2.2, fade.out(0.3)),
  ]);
  set.actors.elias.object.visible = false;
  set.stageOff();
}

// =============================================================================
// VICTOR HALE — "Burn the whole district."
// =============================================================================
async function victorReveal(sc) {
  const world = sc.world;
  const set = world.level;
  const O = ZONES.office;
  set.clearFires();
  placeKael(world, [O.x, 0, O.z + 12], 0); // out of shot
  const victor = set.actors.victor;
  victor.place([O.x + 0.2, 0, O.z - 4.7], Math.PI);
  playFirst(victor, ['talking', 'idle'], 0.01);
  set.stage(0, { pos: [O.x + 1.5, 1.4, O.z - 2.1], color: 0xffc070, intensity: 6, distance: 6 });
  set.stage(1, { pos: [O.x, 2.6, O.z - 5.4], color: 0xff7a3a, intensity: 5, distance: 8 });
  await sc.shot(4.2, [
    at(0, setMood('FIRE', 0.01)),
    at(0, cam.fov(36, 0.01)),
    at(0, cam.cut([O.x + 1.2, 1.75, O.z - 0.6], [O.x + 0.1, 1.6, O.z - 5.6])),
    at(0, fade.in(0.5)),
    at(0.05, cam.moveTo([O.x + 2.5, 1.62, O.z - 3.3], [O.x + 0.1, 1.55, O.z - 4.8], 4.2, 'sine.inOut')),
    at(0.4, voice('m6_victor_01')),
    at(0.6, call(() => sc.ui.nameTag('Victor Hale', 'His father\'s partner · 2020', 3))),
    at(2.0, call(() => victor.lookAt([O.x + 2.5, 0, O.z - 3.3], 1.6))),
    at(3.7, fade.out(0.45)),
  ]);
  set.stageOff();
}

// =============================================================================
// UMBRA — the man with my face
// =============================================================================
async function umbraReveal(sc) {
  const world = sc.world;
  const set = world.level;
  const M = ZONES.mirror;
  placeKael(world, [M.x, 0, M.z - 3.6], Math.PI);
  kaelPlay(world, ['idle'], 0.01);
  const umbra = set.umbra;
  const startZ = M.z - 6.7;
  umbra._teleport(V(M.x, 0, startZ));
  umbra.yaw = 0;
  umbra.model.visible = false;
  umbra.dissolve.set(1, 0);
  playFirst(umbra.actor, ['idle', 'idle_neutral'], 0.01);
  set.stage(0, { pos: [M.x, 3.2, M.z - 2], color: 0x8a4dff, intensity: 10, distance: 10 });
  const spot = set.stage('spot', { pos: [M.x + 0.4, 5.6, M.z - 2.6], color: 0xd8d0ff, intensity: 60, distance: 14 });
  spot.target.position.set(M.x, 0, M.z - 3.6);
  const flicker = (seconds) => {
    const t0 = performance.now();
    const off = sc.task(() => {
      const on = Math.random() < 0.45;
      spot.intensity = on ? 60 : 0;
      set.stage(0, { color: 0x8a4dff, intensity: on ? 10 : 1, distance: 10 });
      if (performance.now() - t0 > seconds * 1000) {
        off();
        spot.intensity = 60;
      }
    });
  };

  // 1 · over his shoulder: Kael and his reflection
  await sc.shot(2.6, [
    at(0, setMood('SHADOWS', 0.01)),
    at(0, cam.fov(38, 0.01)),
    at(0, cam.cut([M.x + 0.75, 1.72, M.z - 1.4], [M.x - 0.1, 1.55, M.z - 7.7])),
    at(0, fade.in(0.5)),
    at(0.05, cam.moveTo([M.x + 0.5, 1.7, M.z - 2.2], [M.x - 0.05, 1.6, M.z - 7.7], 2.8, 'sine.inOut')),
    at(1.1, call(() => flicker(0.9))),
    at(1.1, sfx('ui_glitch', { volume: 0.5, rate: 0.6 })),
    at(1.9, call(() => {
      set.umbraActive = true;
      umbra.model.visible = true;
      umbra.light.intensity = 3;
      tween(sc, { v: 1 }, { v: 0, duration: 1.6, ease: 'power2.out', onUpdate() { umbra.dissolve.set(this.targets()[0].v, 0); } });
      world.fx && umbra._smoke?.(umbra.position, 30);
    })),
    at(1.9, sfx('shadow_step', { volume: 1, rate: 0.7 })),
    at(1.95, glitch(0.3, 0.7)),
  ]);

  // 2 · Umbra steps out of the mirror · white eyes
  tween(sc, umbra.position, { z: startZ + 0.9, duration: 4, ease: 'sine.inOut', onUpdate: () => umbra._teleport(umbra.position) });
  await sc.shot(4.9, [
    at(0, cam.fov(34, 0.01)),
    at(0, cam.cut([M.x + 0.55, 1.62, M.z - 4.6], [M.x, 1.6, startZ + 0.3])),
    at(0.05, cam.moveTo([M.x + 0.3, 1.64, M.z - 5.2], [M.x, 1.62, startZ + 0.6], 4.4, 'sine.inOut')),
    at(0.05, voice('m5_umbra_01')),
    at(0.3, call(() => sc.ui.nameTag('Umbra', 'His shadow · His guilt', 2.6, 'var(--shadows-glow)'))),
    at(4.4, fade.out(0.45)),
  ]);
  subtitles.clear(0.2);
  set.umbraActive = false;
  umbra.model.visible = false;
  umbra.light.intensity = 0;
  set.stageOff();
}

// =============================================================================
// THE CITY ON FIRE
// =============================================================================
async function cityOnFire(sc) {
  const world = sc.world;
  const set = world.level;
  const S = ZONES.street;
  set.clearFires();
  world.scene.fog.color.set(0x1a0c06);
  world.scene.fog.density = 0.028;
  [[-3.4, 0.8, -10], [3.2, 0.6, 6], [-2.2, 0.8, 15], [5.6, 0.9, 18], [-6, 0.4, -4], [6, 0.4, 10]].forEach(([x, y, z]) => world.fire.ignite(V(S.x + x, y, S.z + z), { size: 1.6, fuel: 60 }));
  [[-1, 0.2, 23], [2.4, 0.2, 25], [-5.5, 0.3, 21], [0.8, 0.2, -2]].forEach(([x, y, z]) => world.fire.ignite(V(S.x + x, y, S.z + z), { size: 1.4, fuel: 60 }));
  set.stage(0, { pos: [S.x, 6, S.z + 10], color: 0xff6a1a, intensity: 30, distance: 30 });
  // Kael walks toward us with the rifle; people run past him
  const p = placeKael(world, [S.x, 0, S.z + 19], Math.PI, { cinematic: false, armed: true });
  const wpn = world.weapons;
  const rifle = wpn.guns.findIndex((g) => g.id === 'rifle');
  if (rifle >= 0 && rifle !== wpn.index) {
    wpn._switchTo(rifle);
    wpn._finishState();
  }
  world.inputOverride = { move: new THREE.Vector2(0, 0.42), sprint: false, aim: false, jump: false, roll: false, crouch: false, cover: false, interact: false };
  set.actors.civilians.forEach((c, i) => {
    c.place([S.x - 1.5 + i * 1.6, 0, S.z + 22 + i * 1.5], Math.PI);
    setTimeout(() => !sc.aborted && c.moveTo([S.x - 2 + i * 2.2, 0, S.z - 22], 4.4 + i * 0.3, { anim: 'run' }), 150 + i * 260);
  });
  const boom = (x, y, z) => explode(V(S.x + x, y, S.z + z), { radius: 4, damage: 0, fx: world.fx, scene: world.scene, rig: world.rig });

  // 1 · low and wide: Kael walks out of the fire, the street explodes behind him
  await sc.shot(3.4, [
    at(0, setMood('FIRE', 0.01)),
    at(0, cam.fov(38, 0.01)),
    at(0, cam.cut([S.x + 1.4, 0.45, S.z + 5.5], [S.x, 1.5, S.z + 18])),
    at(0, music('combat', 0.4)),
    at(0, fade.in(0.4)),
    at(0.05, cam.moveTo([S.x + 1.1, 0.5, S.z + 3.6], [S.x, 1.6, S.z + 16], 3.5, 'sine.out')),
    at(0.7, call(() => boom(-3, 0.6, 24.5))),
    at(0.7, cam.shake(0.25, 0.8)),
    at(0.75, flash('#ffb070', 0.3)),
    at(1.9, call(() => boom(3.6, 0.6, 22))),
    at(1.9, cam.shake(0.3, 0.9)),
    at(2.0, call(() => sc.ui.stamp('THE DISTRICT', 'HALE BURNS THE EVIDENCE', 2.2))),
  ]);

  // 2 · tracking with him, the fire behind
  sc.track(p.model, { from: [-1.7, 1.55, 2.8], to: [-1.5, 1.5, 2.0], look: [0, 1.35, -0.5], duration: 2.8, fov: 40 });
  await sc.shot(2.6, [
    at(0.9, call(() => boom(-4.5, 0.6, 17))),
    at(0.9, cam.shake(0.35, 0.8)),
    at(2.15, fade.out(0.45)),
  ]);
  world.inputOverride = null;
}

// =============================================================================
// THE REVERSE CHASE
// =============================================================================
async function reverseChase(sc, assets) {
  const cardP = sc.card('', 'HE HAS 72 HEARTBEATS', '', 1.9, { theme: 'HEART', scramble: false });
  const chase = createChaseWorld(assets, { onExit: () => {}, complete: () => {}, fail: () => {}, mission: null });
  await sc.setWorld(chase);
  chase.events.init();
  chase.setHudVisible(false);
  chase.level.start();
  objectives.destroy(); // the chase sets an objective; never in the video
  chase.carCam.snap(chase.car);
  // a rolling start (the chase begins at full speed)
  const car = chase.car;
  const fwd = car.forward();
  car.body.setLinvel({ x: fwd.x * 34, y: 0, z: fwd.z * 34 }, true);
  sc.task(chaseAutopilot(chase, { boost: true }));
  await cardP;

  // 1 · head-on: rain falling UP, the car tearing toward us
  sc.track(car.root, { from: [17, 0.55, -2.6], to: [11, 0.5, -3.0], look: [0, 0.8, 0], duration: 2.8, fov: 34 });
  await sc.shot(2.6, [
    at(0, setMood('TIME', 0.01)),
    at(0, music('reverse_chase', 0.4)),
    at(0, fade.in(0.4)),
    at(0, glitch(0.3, 0.6)),
    at(0.1, sfx('reverse_whoosh', { volume: 0.9 })),
    at(0.2, voice('m7_clockmaker_01')),
  ]);
  // 2 · ride with the chase cam: crashes un-crash, the world runs backwards
  sc.ride(chase.camera);
  await sc.shot(3.6, [
    at(0.4, call(() => sc.ui.stamp('20:19:59', 'TIME RUNS BACKWARDS', 2.4))),
    at(3.1, glitch(0.3, 0.6)),
    at(3.2, fade.out(0.4)),
  ]);
}

// =============================================================================
// THE WALK INTO THE FIRE
// =============================================================================
async function walkIntoFire(sc, assets) {
  const cardP = sc.card('', 'TO FIND HIS WAY BACK', '', 1.8, { theme: 'FIRE', scramble: false });
  const world = await sc.setWorld(buildSet(sc, assets));
  const set = world.level;
  const C = ZONES.corridor;
  world.scene.fog.color.set(0x160806);
  world.scene.fog.density = 0.03;
  for (let i = 0; i < 6; i++) {
    const z = C.z - 9 + i * 4.6;
    world.fire.ignite(V(C.x - 3.1, 0.3, z), { size: 1.6, fuel: 90 });
    world.fire.ignite(V(C.x + 3.1, 0.3, z + 2.3), { size: 1.6, fuel: 90 });
  }
  world.fire.ignite(V(C.x - 0.9, 0.2, C.z + 4), { size: 1.3, fuel: 90 });
  world.fire.ignite(V(C.x + 1.0, 0.2, C.z + 9), { size: 1.3, fuel: 90 });
  set.stage(0, { pos: [C.x, 2.6, C.z + 20.5], color: 0xffd9a0, intensity: 10, distance: 8 });
  set.stage(1, { pos: [C.x, 4, C.z], color: 0xff6a1a, intensity: 22, distance: 20 });
  const p = placeKael(world, [C.x, 0, C.z - 13], 0, { cinematic: false });
  const shield = p.anims.actor.hasClip('shield_face');
  if (shield) {
    p.cinematic = true;
    kaelPlay(world, ['shield_face'], 0.01);
  }
  world.inputOverride = { move: new THREE.Vector2(0, 0.36), sprint: false, aim: false, jump: false, roll: false, crouch: false, cover: false, interact: false };
  const umbra = set.umbra;
  set.umbraActive = true;
  umbra.model.visible = true;
  umbra.light.intensity = 2;
  umbra._teleport(V(C.x, 0, C.z - 6));
  playFirst(umbra.actor, ['idle_gun_pointing', 'idle'], 0.01);
  const zStart = C.z - 13;
  const zEnd = C.z + 19;
  sc.task(() => {
    const k = THREE.MathUtils.clamp((p.position.z - zStart) / (zEnd - zStart), 0, 1);
    const uz = Math.max(C.z - 6, p.position.z + 2.3);
    umbra._teleport(V(C.x, 0, Math.min(uz, C.z + 17)));
    umbra.dissolve.set(THREE.MathUtils.clamp((k - 0.12) / 0.45, 0, 1.05), 0);
    if (k > 0.6) umbra.model.visible = false;
    sc.ui.whiteout(Math.min(0.55, k * 0.6));
  });
  await cardP;

  // 1 · behind him: the corridor of flame, Umbra in the way, his father at the end
  sc.track(p.model, { from: [0.55, 1.15, -2.7], to: [0.45, 1.25, -2.1], look: [0, 1.3, 5], duration: 3.2, fov: 40 });
  await sc.shot(3.0, [
    at(0, setMood('FIRE', 0.01)),
    at(0, music('ending', 1.0)),
    at(0, fade.in(0.5)),
    at(0.3, sfx('heartbeat', { volume: 1 })),
    at(1.3, sfx('heartbeat', { volume: 1, rate: 0.92 })),
    at(2.4, sfx('heartbeat', { volume: 1, rate: 0.85 })),
  ]);
  // 2 · in front of him: he walks through Umbra, who burns away
  sc.track(p.model, { from: [0.4, 1.55, 3.6], to: [0.35, 1.55, 2.7], look: [0, 1.45, 0], duration: 2.8, fov: 38 });
  await sc.shot(2.6, [
    at(0.2, sfx('heartbeat', { volume: 1, rate: 0.8 })),
    at(1.6, sfx('heartbeat', { volume: 1, rate: 0.72 })),
  ]);
  // 3 · his father, in the light
  const E = V(C.x, 0, C.z + 22.4);
  await sc.shot(2.6, [
    at(0, setMood('NEUTRAL', 1.5)),
    at(0, cam.fov(34, 0.01)),
    at(0, cam.cut([E.x + 0.55, 1.62, E.z - 1.9], [E.x, 1.58, E.z])),
    at(0.05, cam.moveTo([E.x + 0.3, 1.62, E.z - 1.3], [E.x, 1.6, E.z], 2.6, 'sine.inOut')),
    at(0.2, voice('m8_elias_01')),
    at(0.3, call(() => sc.ui.whiteout(1, 2.2))),
  ]);
  world.inputOverride = null;
}

// =============================================================================
// FLATLINE: 2050
// =============================================================================
async function titleCard(sc) {
  sc.ui.whiteout(1);
  audio.stopMusic(2.5);
  sc.sfx('flatline', { volume: 0.8, stopAfter: 1.7 });
  await sc.wait(1.2);
  await sc.guard(screenFade.toBlack(0.8));
  sc.ui.whiteout(0);
  await sc.wait(0.4);
  sc.sfx('monitor_beep', { volume: 1 });
  await sc.wait(0.9);
  sc.sfx('monitor_beep', { volume: 1 });
  sc.ui.finalTitle(['He crashed in the future.', 'He woke up in the past.', 'He has 72 heartbeats to find his way back.'], { lineGap: 1.1 });
  sc.beat('title');
  await sc.wait(1.6);
  sc.sfx('heartbeat', { volume: 0.9 });
  await sc.wait(2.6);
  sc.sfx('heartbeat', { volume: 0.9 });
  await sc.wait(2.6);
}

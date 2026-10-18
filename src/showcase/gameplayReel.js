// =============================================================================
// FLATLINE: 2050 — showcase/gameplayReel.js
// GAMEPLAY OVERVIEW (Settings → Media, or ?reel): a ~2 minute reel of the
// real game systems, played live by an autopilot that presses the same keys
// a player would (virtual input → rewind, Shadow Step, guns, Burn, Dash…).
// Every chapter has a caption with its key caps.
//
//   2050 race ─ racing · 🔥 Burn + fire wake · 🌑 draft + Shadow Dash · ⏳ rewind
//   2020 chase ─ ⏳ the reverse chase
//   2020 on foot ─ movement · guns · 🌑 lights + Shadow Step · 🔥 incendiary +
//                  barrels · ⏳ rewind · ❤ the heartbeat meter · sniper +
//                  steady aim · enemy AI · Umbra · the walk into the fire
//   the mission rank screen → outro
// =============================================================================

import * as THREE from 'three';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { preload } from '../assets/loader.js';
import { PRELOAD } from '../assets/manifest.js';
import { LoadingScreen } from '../assets/loadingScreen.js';
import { at, cam, fade, call, setMood, music, glitch } from '../cutscenes/steps.js';
import { screenFade } from '../ui/screenFade.js';
import { objectives } from '../ui/objectiveHUD.js';
import { missionComplete } from '../ui/missionComplete.js';
import { createRaceScene } from '../scenes/raceScene.js';
import { createChaseWorld, ASSETS as CHASE_ASSETS } from '../missions/m7_reverseChase.js';
import { getMission } from '../missions/missionData.js';
import { heartbeat } from '../systems/heartbeat.js';
import { lights } from '../systems/lights.js';
import { Showcase } from './director.js';
import { createShowcaseSet, SET_ASSETS, ZONES, playFirst } from './set2020.js';
import { startRaceNow, raceAutopilot, chaseAutopilot } from './driving.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const MUSIC = ['music.race_2050', 'music.reverse_chase', 'music.combat', 'music.umbra', 'music.ending', 'music.main_theme'];
export const REEL_ASSETS = [...new Set([...PRELOAD.race, ...SET_ASSETS, ...CHASE_ASSETS, ...MUSIC])];
const TOTAL = 16; // chapters
const LENGTH = 118; // seconds (progress line)
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Play the gameplay reel. Expects a black screen; ends on black. Resolves { completed, skipped }. */
export async function playGameplayReel({ from = null } = {}) {
  const loading = new LoadingScreen();
  loading.show();
  const assets = await preload(REEL_ASSETS, (p) => loading.setProgress(p));
  await loading.hide();

  const sc = new Showcase('reel');
  const sections = [
    ['intro', () => intro(sc)],
    ['race', () => raceChapters(sc, assets)],
    ['chase', () => chaseChapter(sc, assets)],
    ['foot', () => footChapters(sc, assets)],
    ['ai', () => aiChapter(sc)],
    ['umbra', () => umbraChapter(sc)],
    ['finale', () => finaleChapter(sc)],
    ['rank', () => rankChapter(sc)],
    ['outro', () => outro(sc)],
  ];
  const start = Math.max(0, sections.findIndex(([id]) => id === from));
  return sc.run(async () => {
    await sc.guard(screenFade.toBlack(0.01));
    sc.task(() => sc.ui.progress(sc.elapsed / LENGTH));
    for (let i = start; i < sections.length; i++) {
      if (i === start && ['ai', 'umbra', 'finale'].includes(sections[i][0])) await sc.setWorld(buildSet(assets));
      sc.beat(sections[i][0]);
      await sections[i][1]();
    }
  });
}

function buildSet(assets) {
  const world = createShowcaseSet(game.renderer, assets);
  heartbeat.reset();
  world.setHudVisible(true);
  return world;
}

/** Chapter caption + beat marker. */
function chapter(sc, n, o) {
  sc.beat(`ch${n}`);
  return sc.ui.chapter({ ...o, index: n, total: TOTAL });
}

/** Fade to black, show the next caption on black while a world loads, fade in. */
async function bumper(sc, load, fadeOut = 0.4) {
  await sc.guard(screenFade.toBlack(fadeOut));
  const world = await load();
  await sc.wait(0.3);
  screenFade.fromBlack(0.5);
  return world;
}

// =============================================================================
// On-foot autopilot: walks waypoints, aims the camera, presses keys
// =============================================================================
class FootPilot {
  constructor(sc, world) {
    this.sc = sc;
    this.world = world;
    this.p = world.player;
    this.rig = world.rig;
    this.intent = { move: new THREE.Vector2(), sprint: false, aim: false, jump: false, roll: false, crouch: false, cover: false, interact: false };
    this.pulses = new Set();
    this.route = null;
    this.aimTarget = null;
    this.camYaw = null; // follow the movement with the camera when not aiming
    world.inputOverride = this.intent;
    this.off = sc.task((dt) => this.update(dt));
  }

  /** One-frame action: 'jump' | 'roll' | 'cover' | 'crouch' | 'interact'. */
  pulse(flag) {
    this.intent[flag] = true;
    this.pulses.add(flag);
  }

  /** Walk / run to (x, z). Resolves on arrival (or after `timeout` s). */
  goTo(x, z, { sprint = false, speed = 1, radius = 0.55, timeout = 6, follow = true } = {}) {
    return this.sc.guard(new Promise((resolve) => {
      this.route = { target: V(x, 0, z), sprint, speed, radius, resolve, until: performance.now() + timeout * 1000, follow };
    }));
  }

  stop() {
    this.route?.resolve();
    this.route = null;
    this.intent.move.set(0, 0);
    this.intent.sprint = false;
  }

  /** Point the crosshair at a world point (or a function returning one). null = free. */
  aimAt(target) {
    this.aimTarget = target;
  }

  update(dt) {
    // one-frame actions were seen by the world this frame (tasks run after world.update)
    this.pulses.forEach((f) => (this.intent[f] = false));
    this.pulses.clear();
    const p = this.p;
    const rig = this.rig;
    const r = this.route;
    if (r) {
      const d = r.target.clone().sub(p.position).setY(0);
      if (d.length() < r.radius || performance.now() > r.until) {
        this.stop();
      } else {
        d.normalize();
        const f = rig.forward(new THREE.Vector3());
        const right = rig.right(new THREE.Vector3());
        this.intent.move.set(d.dot(right) * r.speed, d.dot(f) * r.speed);
        this.intent.sprint = r.sprint;
        if (r.follow && !this.aimTarget) rig.yaw += angleDelta(rig.yaw, Math.atan2(d.x, d.z)) * Math.min(1, dt * 2.5);
      }
    }
    const t = typeof this.aimTarget === 'function' ? this.aimTarget() : this.aimTarget;
    if (t) {
      const from = rig.camera.getWorldPosition(new THREE.Vector3());
      const dir = t.clone().sub(from);
      const yaw = Math.atan2(dir.x, dir.z);
      const pitch = Math.asin(THREE.MathUtils.clamp(dir.y / Math.max(0.001, dir.length()), -1, 1));
      const k = Math.min(1, dt * 9);
      rig.yaw += angleDelta(rig.yaw, yaw) * k;
      rig.pitch += (pitch - rig.pitch) * k;
    } else if (!r) {
      rig.pitch += (-0.12 - rig.pitch) * Math.min(1, dt * 2);
    }
  }

  dispose() {
    this.off();
    this.world.inputOverride = null;
  }
}

function place(world, pos, yaw, { armed = true } = {}) {
  const p = world.player;
  p.cinematic = false;
  p.locked = false;
  p.armed = armed;
  world.weapons.disabled = !armed;
  if (!armed) world.weapons.guns.forEach((g) => g.model && (g.model.visible = false));
  const v = V(...pos);
  p.respawn(v, yaw);
  p.root.position.copy(v);
  world.rig.pivot.set(v.x, v.y + 1.6, v.z);
  world.rig.setYaw(yaw, -0.12);
}

function selectGun(world, id) {
  const w = world.weapons;
  const i = w.guns.findIndex((g) => g.id === id);
  if (i >= 0 && i !== w.index) {
    w._switchTo(i);
    w._finishState();
  }
}

// =============================================================================
// Intro
// =============================================================================
async function intro(sc) {
  sc.ui.card('FLATLINE: 2050', 'GAMEPLAY OVERVIEW', 'Everything you see runs live in the engine', { theme: 'TIME', size: 'm' });
  audio.playMusic('race_2050', 1.5);
  await sc.wait(3.2);
  await sc.ui.hideCard(0.3);
}

// =============================================================================
// 2050 — the race: 🔥 🌑 ⏳ as driving mechanics
// =============================================================================
async function raceChapters(sc, assets) {
  const world = createRaceScene(game.renderer, assets, { laps: 5, playerSlot: 2, mission: true, onExit: () => {} });
  await sc.setWorld(world);
  world.hud.setVisible(true);
  const { car } = world;
  startRaceNow(world);
  const pilot = raceAutopilot(world, { boost: false });
  sc.task(pilot);
  sc.gameplay();
  sc.ui.live();
  screenFade.fromBlack(0.6);

  // 1 · racing
  chapter(sc, 1, { icon: '🏁', title: 'Racing — 2050', sub: 'Rapier raycast-vehicle physics · 5 AI rivals · drift to heat up the Burn meter', keys: ['W A S D', 'Space'], theme: 'TIME' });
  await sc.wait(5.5);

  // 2 · 🔥 Burn + fire wake
  chapter(sc, 2, { icon: '🔥', title: 'FIRE — Burn boost & fire wake', sub: 'Burn from a full meter and you leave a trail of fire that scorches rivals', keys: ['Shift'], theme: 'FIRE' });
  car.boost = 1;
  sc.track(car.root, { from: [-10, 1.9, 3.4], to: [-7.5, 1.3, 2.4], look: [3, 0.6, 0], duration: 6, fov: 50 });
  await sc.wait(0.6);
  pilot.opts.boost = true;
  sc.ui.holdKey('Shift', true);
  await sc.wait(3.4);
  pilot.opts.boost = false;
  sc.ui.holdKey('Shift', false);
  await sc.wait(1.6);

  // 3 · 🌑 draft + Shadow Dash
  sc.gameplay();
  chapter(sc, 3, { icon: '🌑', title: 'SHADOWS — Draft & Shadow Dash', sub: 'Ride a rival\'s slipstream to charge it, then phase through traffic as void', keys: ['T'], theme: 'SHADOWS' });
  car.shadow = 1;
  await sc.wait(1.2);
  sc.tap('KeyT', 0.08);
  sc.ui.pressKey('T');
  sc.track(car.root, { from: [-1.5, 1.2, 6.2], to: [1.5, 1.0, 5.6], look: [0.5, 0.7, 0], duration: 3.2, fov: 40 });
  await sc.wait(3.0);
  sc.gameplay();
  await sc.wait(0.8);

  // 4 · ⏳ rewind
  chapter(sc, 4, { icon: '⏳', title: 'TIME — Rewind 5 seconds', sub: 'Everyone rewinds: rivals, the race clock, your mistakes · drains the time meter', keys: ['hold R'], theme: 'TIME' });
  car.time = 1;
  await sc.wait(1.6);
  sc.hold('KeyR');
  sc.ui.holdKey('R', true);
  await sc.wait(2.6);
  sc.release('KeyR');
  sc.ui.holdKey('R', false);
  await sc.wait(1.6);
}

// =============================================================================
// 2020 — the reverse chase
// =============================================================================
async function chaseChapter(sc, assets) {
  const chase = await bumper(sc, async () => {
    sc.ui.hideChapter();
    const w = createChaseWorld(assets, { onExit: () => {}, complete: () => {}, fail: () => {} });
    await sc.setWorld(w);
    w.events.init();
    w.level.start();
    objectives.destroy();
    w.setHudVisible(true);
    w.carCam.snap(w.car);
    const fwd = w.car.forward();
    w.car.body.setLinvel({ x: fwd.x * 32, y: 0, z: fwd.z * 32 }, true);
    sc.task(chaseAutopilot(w, { boost: true }));
    sc.gameplay();
    audio.playMusic('reverse_chase', 0.6);
    return w;
  });
  void chase;
  chapter(sc, 5, { icon: '⏳', title: 'The reverse chase — 2020', sub: 'Crashes un-crash, explosions implode, bullets fly back into guns — the clock runs backwards', keys: ['W', 'Shift', 'hold R'], theme: 'TIME' });
  sc.ui.holdKey('Shift', true);
  await sc.wait(8);
  sc.ui.holdKey('Shift', false);
}

// =============================================================================
// 2020 — on foot in the alley
// =============================================================================
async function footChapters(sc, assets) {
  const world = await bumper(sc, async () => {
    sc.ui.hideChapter();
    const w = buildSet(assets);
    await sc.setWorld(w);
    w.level.rain(true);
    w.scene.fog.density = 0.03;
    place(w, [0, 0, -11], 0);
    selectGun(w, 'pistol');
    sc.gameplay();
    audio.playMusic('combat', 0.8);
    return w;
  });
  const set = world.level;
  const pilot = new FootPilot(sc, world);
  sc.own(() => pilot.dispose());
  const rainId = sc.sfx('rain_heavy', { volume: 0.35 });
  const p = world.player;

  // 6 · movement
  chapter(sc, 6, { icon: '🏃', title: 'On foot — third person', sub: 'Over-the-shoulder camera · sprint · vault · cover · roll · never clips through walls', keys: ['W A S D', 'Shift', 'Space', 'E', 'Alt'], theme: 'NEUTRAL' });
  sc.ui.holdKey('Shift', true);
  await pilot.goTo(0.6, -3.3, { sprint: true, timeout: 3 });
  pilot.pulse('jump');
  sc.ui.pressKey('Space');
  sc.ui.holdKey('Shift', false);
  await sc.wait(0.9);
  await pilot.goTo(-0.9, 4.9, { timeout: 3 });
  pilot.pulse('cover');
  sc.ui.pressKey('E');
  await sc.wait(1.2);
  pilot.pulse('cover');
  await pilot.goTo(1.3, 9.2, { sprint: true, timeout: 2.5 });
  pilot.pulse('roll');
  sc.ui.pressKey('Alt');
  await sc.wait(0.9);

  // 7 · guns
  place(world, [0.6, 0, 7.6], 0.2);
  chapter(sc, 7, { icon: '🔫', title: 'Guns — pistol · rifle · sniper', sub: 'Hitscan from the crosshair · recoil & spread · tracers, casings, impacts per surface', keys: ['1 2 3', 'RMB', 'LMB', 'R'], theme: 'NEUTRAL' });
  const dummy = (i, h = 1.25) => () => set.range.targets?.[i]?.base?.clone().add(V(0, h, 0)) ?? V(1.6, 1.25, 11.5);
  sc.tap('Digit1');
  sc.ui.pressKey('1');
  pilot.aimAt(dummy(0));
  sc.hold('Mouse2');
  await sc.wait(0.7);
  for (let i = 0; i < 3; i++) {
    sc.tap('Mouse0');
    sc.ui.pressKey('LMB');
    await sc.wait(0.32);
  }
  sc.tap('Digit2');
  sc.ui.pressKey('2');
  pilot.aimAt(dummy(2));
  await sc.wait(0.75);
  sc.hold('Mouse0');
  sc.ui.holdKey('LMB', true);
  await sc.wait(1.1);
  sc.release('Mouse0');
  sc.ui.holdKey('LMB', false);
  await sc.wait(0.3);
  sc.tap('KeyR', 0.08);
  sc.ui.pressKey('R');
  await sc.wait(1.3);
  sc.release('Mouse2');

  // 8 · 🌑 shoot out a light → Shadow Step into the dark
  chapter(sc, 8, { icon: '🌑', title: 'SHADOWS — Shoot out lights · Shadow Step', sub: 'Darkness blinds enemies · Shadow Step (2 beats) only lands inside it', keys: ['LMB', 'hold T'], theme: 'SHADOWS' });
  place(world, [0.6, 0, 3.6], 0.3);
  selectGun(world, 'pistol');
  const lamp = world.lamps?.find((l) => Math.abs(l.position.z - 9) < 2) ?? lights.items.find((l) => l.on);
  if (lamp) pilot.aimAt(lamp.position.clone());
  sc.hold('Mouse2');
  await sc.wait(0.9);
  for (let i = 0; i < 2 && lamp?.on; i++) {
    sc.tap('Mouse0');
    sc.ui.pressKey('LMB');
    await sc.wait(0.35);
  }
  if (lamp?.on) lights.shootOut(lamp); // (never miss on camera)
  sc.release('Mouse2');
  await sc.wait(0.6);
  const dark = V(2.0, 0, 10.6);
  pilot.aimAt(dark);
  sc.hold('KeyT');
  sc.ui.holdKey('T', true);
  await sc.wait(1.5);
  const before = p.position.clone();
  sc.release('KeyT');
  sc.ui.holdKey('T', false);
  await sc.wait(0.25);
  if (world.shadowStep.state === 'idle' && p.position.distanceTo(before) < 0.5) world.shadowStep._step(dark);
  pilot.aimAt(null);
  await sc.wait(1.7);

  // 9 · 🔥 incendiary rounds + explosive barrel
  place(world, [0.3, 0, 11.2], 0.15);
  chapter(sc, 9, { icon: '🔥', title: 'FIRE — Incendiary rounds · explosive barrels', sub: 'Fire spreads to anything that burns, and hurts whoever stands in it', keys: ['V', 'LMB'], theme: 'FIRE' });
  selectGun(world, 'rifle');
  world.weapons.incendiaryRounds = Math.max(world.weapons.incendiaryRounds, 12);
  world.weapons._refreshHud();
  await sc.wait(0.4);
  sc.tap('KeyV');
  sc.ui.pressKey('V');
  pilot.aimAt(dummy(2, 1.1));
  sc.hold('Mouse2');
  await sc.wait(0.8);
  sc.hold('Mouse0');
  await sc.wait(0.6);
  sc.release('Mouse0');
  pilot.aimAt(() => V(3.4, 0.55, 16.2));
  await sc.wait(0.8);
  sc.hold('Mouse0');
  await sc.wait(0.5);
  sc.release('Mouse0');
  await sc.wait(0.4);
  sc.release('Mouse2');
  pilot.aimAt(null);
  await sc.wait(2.2);

  // 10 · ⏳ rewind
  chapter(sc, 10, { icon: '⏳', title: 'TIME — Rewind 5 seconds', sub: 'Hold R and the world plays backwards — Kael, enemies, bodies, bullets (3 beats)', keys: ['hold R'], theme: 'TIME' });
  world.rig.setYaw(Math.PI, -0.1);
  await pilot.goTo(1.3, 3.0, { sprint: true, timeout: 2.6 });
  await sc.wait(0.2);
  sc.hold('KeyR');
  sc.ui.holdKey('R', true);
  await sc.wait(2.3);
  sc.release('KeyR');
  sc.ui.holdKey('R', false);
  await sc.wait(0.9);

  // 11 · ❤ the heartbeat meter
  chapter(sc, 11, { icon: '❤', title: 'The Heartbeat — 72 beats', sub: 'Rewind 3 · Shadow Step 2 · steady aim 1 · death 10 — memory fragments give beats back', keys: [], theme: 'HEART' });
  sc.ui.highlight('.ch-heart', 'the shared cost', 4.6);
  await pilot.goTo(3.9, 12.6, { timeout: 3.2 });
  await sc.wait(0.5);
  heartbeat.spend(Math.max(0, heartbeat.beats - 15), 'video', { force: true });
  await sc.wait(2.2);
  heartbeat.restore(40);
  await sc.wait(0.6);

  // 12 · sniper: scope, sway, steady (1 beat), bullet flight
  place(world, [0.6, 0, 15.6], -0.25);
  chapter(sc, 12, { icon: '🎯', title: 'Sniper — scope · sway · steady aim', sub: 'Breath sway; hold Shift to steady (1 beat) — the world slows, the bullet really flies', keys: ['3', 'RMB', 'hold Shift', 'LMB'], theme: 'TIME' });
  sc.tap('Digit3');
  sc.ui.pressKey('3');
  pilot.aimAt(dummy(1, 1.55));
  await sc.wait(0.7);
  sc.hold('Mouse2');
  await sc.wait(1.3);
  sc.hold('ShiftLeft');
  sc.ui.holdKey('Shift', true);
  await sc.wait(1.1);
  sc.tap('Mouse0');
  sc.ui.pressKey('LMB');
  await sc.wait(1.6);
  sc.release('ShiftLeft');
  sc.ui.holdKey('Shift', false);
  sc.release('Mouse2');
  pilot.aimAt(null);
  await sc.wait(0.6);
  if (rainId != null) sc.stopSound('rain_heavy', rainId, 0.6);
}

// =============================================================================
// Enemy AI in the yard
// =============================================================================
async function aiChapter(sc) {
  const world = sc.world;
  const set = world.level;
  const Y = ZONES.yard;
  await sc.guard(screenFade.toBlack(0.35));
  set.rain(false);
  place(world, [Y.x - 1.5, 0, Y.z - 10.5], 0);
  selectGun(world, 'rifle');
  const pilot = new FootPilot(sc, world);
  sc.own(() => pilot.dispose());
  screenFade.fromBlack(0.4);
  chapter(sc, 13, { icon: '🎖', title: 'Enemy AI — patrol · search · cover · flank', sub: 'Hale\'s enforcers hear gunshots, call it in, fight from cover, throw grenades — and can\'t see you in the dark', keys: [], theme: 'NEUTRAL' });
  // a wide look at the squad reacting
  await sc.shot(3.4, [
    at(0, cam.fov(46, 0.01)),
    at(0, cam.cut([Y.x + 7, 6.5, Y.z - 13], [Y.x - 1, 0.6, Y.z + 6])),
    at(0.05, cam.moveTo([Y.x + 4.5, 5.2, Y.z - 12.5], [Y.x - 1.5, 0.8, Y.z + 5], 3.6, 'sine.inOut')),
    at(0.3, call(() => set.enemies.forEach((e) => !e.dead && e.alert?.(world.player.position.clone())))),
  ]);
  sc.gameplay();
  const target = () => set.enemies.filter((e) => !e.dead).sort((a, b) => a.position.distanceTo(world.player.position) - b.position.distanceTo(world.player.position))[0];
  pilot.aimAt(() => target()?.position.clone().add(V(0, 1.2, 0)) ?? null);
  sc.hold('Mouse2');
  for (let i = 0; i < 3; i++) {
    await sc.wait(0.7);
    sc.hold('Mouse0');
    await sc.wait(0.45);
    sc.release('Mouse0');
  }
  pilot.pulse('crouch');
  await sc.wait(1.0);
  sc.release('Mouse2');
  pilot.aimAt(null);
}

// =============================================================================
// Umbra in the mirror room
// =============================================================================
async function umbraChapter(sc) {
  const world = sc.world;
  const set = world.level;
  const M = ZONES.mirror;
  await sc.guard(screenFade.toBlack(0.35));
  place(world, [M.x + 0.5, 0, M.z + 2.5], Math.PI);
  selectGun(world, 'rifle');
  const umbra = set.umbra;
  umbra._teleport(V(M.x - 0.5, 0, M.z - 4.5));
  umbra.model.visible = true;
  umbra.dissolve.set(0, 0);
  umbra.spotlit = true; // the stage light pins him: hittable
  set.umbraActive = true;
  set.umbraFight = true;
  set.stage(0, { pos: [M.x, 3.2, M.z - 2], color: 0x8a4dff, intensity: 9, distance: 12 });
  const spot = set.stage('spot', { pos: [M.x, 5.6, M.z + 1], color: 0xd8d0ff, intensity: 45, distance: 16 });
  spot.target.position.set(M.x, 0, M.z - 3);
  const pilot = new FootPilot(sc, world);
  sc.own(() => pilot.dispose());
  sc.own(() => {
    set.umbraFight = false;
    set.umbraActive = false;
  });
  audio.playMusic('umbra', 0.6);
  screenFade.fromBlack(0.4);
  chapter(sc, 14, { icon: '🌑', title: 'Umbra — the man with your face', sub: 'A boss who mirrors your moves, Shadow Steps and rewinds — only vulnerable in light', keys: [], theme: 'SHADOWS' });
  await sc.shot(2.6, [
    at(0, setMood('SHADOWS', 0.01)),
    at(0, cam.fov(36, 0.01)),
    at(0, cam.cut([M.x + 1.2, 1.5, M.z - 1.2], [umbra.position.x, 1.5, umbra.position.z])),
    at(0.05, cam.moveTo([M.x + 0.8, 1.6, M.z - 2.0], [umbra.position.x, 1.55, umbra.position.z], 2.6, 'sine.inOut')),
  ]);
  sc.gameplay();
  pilot.aimAt(() => umbra.position.clone().add(V(0, 1.25, 0)));
  sc.hold('Mouse2');
  for (let i = 0; i < 3; i++) {
    await sc.wait(0.6);
    sc.hold('Mouse0');
    await sc.wait(0.5);
    sc.release('Mouse0');
  }
  await sc.wait(0.6);
  sc.release('Mouse2');
  pilot.aimAt(null);
  set.umbraFight = false;
}

// =============================================================================
// The finale: walk into the fire
// =============================================================================
async function finaleChapter(sc) {
  const world = sc.world;
  const set = world.level;
  const C = ZONES.corridor;
  await sc.guard(screenFade.toBlack(0.35));
  set.clearFires();
  set.stageOff();
  world.scene.fog.color.set(0x160806);
  for (let i = 0; i < 6; i++) {
    const z = C.z - 9 + i * 4.6;
    world.fire.ignite(V(C.x - 3.1, 0.3, z), { size: 1.6, fuel: 90 });
    world.fire.ignite(V(C.x + 3.1, 0.3, z + 2.3), { size: 1.6, fuel: 90 });
  }
  set.stage(0, { pos: [C.x, 2.6, C.z + 20.5], color: 0xffd9a0, intensity: 10, distance: 8 });
  set.stage(1, { pos: [C.x, 4, C.z], color: 0xff6a1a, intensity: 22, distance: 20 });
  place(world, [C.x, 0, C.z - 13], 0, { armed: false });
  const ammo = document.querySelector('.ch-ammo'); // the guns are gone: so is the ammo counter
  if (ammo) ammo.style.visibility = 'hidden';
  const umbra = set.umbra;
  umbra.spotlit = false;
  set.umbraActive = true;
  umbra.model.visible = true;
  umbra._teleport(V(C.x, 0, C.z - 6));
  playFirst(umbra.actor, ['idle_gun_pointing', 'idle'], 0.01);
  heartbeat.reset();
  const startBeats = heartbeat.beats;
  const zStart = C.z - 13;
  const zEnd = C.z + 19;
  const p = world.player;
  world.inputOverride = { move: new THREE.Vector2(0, 0.42), sprint: false, aim: false, jump: false, roll: false, crouch: false, cover: false, interact: false };
  sc.task(() => {
    const k = THREE.MathUtils.clamp((p.position.z - zStart) / (zEnd - zStart), 0, 1);
    umbra._teleport(V(C.x, 0, Math.min(Math.max(C.z - 6, p.position.z + 2.3), C.z + 17)));
    umbra.dissolve.set(THREE.MathUtils.clamp((k - 0.12) / 0.45, 0, 1.05), 0);
    if (k > 0.6) umbra.model.visible = false;
    const targetBeats = Math.max(3, Math.round(startBeats - (startBeats - 3) * k * 1.4));
    if (heartbeat.beats > targetBeats) heartbeat.spend(heartbeat.beats - targetBeats, 'fire', { force: true });
    sc.ui.whiteout(Math.min(0.85, k * 1.1));
    world.rig.yaw += angleDelta(world.rig.yaw, 0) * 0.1;
  });
  audio.playMusic('ending', 0.8);
  sc.gameplay();
  screenFade.fromBlack(0.5);
  chapter(sc, 15, { icon: '🔥', title: 'The finale — walk into the fire', sub: 'Shooting Umbra does nothing. The guns lower by themselves. Hold W as the heartbeat crashes', keys: ['hold W'], theme: 'FIRE' });
  sc.ui.holdKey('W', true);
  await sc.shot(7.4, [
    at(0.2, call(() => sc.sfx('heartbeat', { volume: 1 }))),
    at(1.4, call(() => sc.sfx('heartbeat', { volume: 1, rate: 0.9 }))),
    at(2.7, call(() => sc.sfx('heartbeat', { volume: 1, rate: 0.82 }))),
    at(4.1, call(() => sc.sfx('heartbeat', { volume: 1, rate: 0.75 }))),
    at(5.6, call(() => sc.sfx('heartbeat', { volume: 1, rate: 0.68 }))),
    at(6.4, fade.out(0.8, '#ffffff')),
  ]);
  sc.ui.holdKey('W', false);
  world.inputOverride = null;
}

// =============================================================================
// Mission rank → outro
// =============================================================================
async function rankChapter(sc) {
  sc.ui.whiteout(0);
  await sc.guard(screenFade.toBlack(0.5));
  audio.playMusic('main_theme', 1.5);
  chapter(sc, 16, { icon: '🏆', title: 'Mission rank — S · A · B · C', sub: 'Every mission is scored on time, accuracy and the heartbeats you kept', keys: [], theme: 'NEUTRAL' });
  document.body.classList.add('sc-over-modal');
  const shown = missionComplete.show(getMission(8), { time: 538, parTime: 600, accuracy: 0.86, beats: 58, maxBeats: 72 });
  sc.own(() => document.body.classList.remove('sc-over-modal'));
  // missionComplete waits for Enter: press it for the viewer (twice: reveal all, then continue)
  const press = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter', key: 'Enter' }));
  };
  sc.own(() => {
    if (!document.querySelector('.mcomplete')) return;
    press();
    press();
  });
  await sc.wait(4.6);
  press();
  press();
  await sc.guard(shown);
  sc.ui.hideChapter();
}

async function outro(sc) {
  await sc.guard(screenFade.toBlack(0.3));
  sc.ui.finalTitle(['8 story missions · 3 themes you can play', 'Fire · Shadows · Time — and 72 heartbeats', 'New Game to begin'], { lineGap: 0.7 });
  await sc.wait(5.2);
}

void glitch;
void music;

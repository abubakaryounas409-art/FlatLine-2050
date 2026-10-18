// =============================================================================
// FLATLINE: 2050 — missions/trailer.js
// TRAILER MODE (CLAUDE.md Phase 12): press F9 on the main menu for a ~60 s
// cinematic montage made from the real game — record it with OBS.
//
//   2050 crash card → rain wake-up → sniper shot (slow-mo) → Shadow Step →
//   the city on fire → the reverse chase → "20:20" → title
//
// Worlds load behind black title cards, so the cuts stay clean.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { preload } from '../assets/loader.js';
import { cutscenes } from '../cutscenes/cutscenePlayer.js';
import { at, cam, sfx, call, fade, setMood, letterbox, flash, slowMo, glitch } from '../cutscenes/steps.js';
import { screenFade } from '../ui/screenFade.js';
import { createFootSandbox, FOOT_SANDBOX_ASSETS } from '../dev/footSandbox.js';
import { createChaseWorld, ASSETS as CHASE_ASSETS } from './m7_reverseChase.js';
import { explode } from '../systems/explosions.js';
import { heartbeat } from '../systems/heartbeat.js';
import { objectives } from '../ui/objectiveHUD.js';
import { CONFIG } from '../config.js';

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

/** A line of white text on black (worlds load underneath). */
async function card(kicker, title, sub = '', seconds = 2.4) {
  await screenFade.toBlack(0.4);
  screenFade.setText(kicker, title, sub);
  await wait(seconds);
  screenFade.setText();
}

export async function playTrailer() {
  document.body.classList.add('trailer'); // hides every gameplay HUD (style.css)
  const hideBelow = CONFIG.cameraRig.hideBodyBelow;
  CONFIG.cameraRig.hideBodyBelow = -1; // the gameplay camera isn't on screen: never hide Kael
  audio.playMusic('main_theme', 1);
  // --- 2050: the crash (as sound and light) -----------------------------------------------
  await screenFade.toBlack(0.6);
  audio.sfx('crowd_cheer', { volume: 0.4 });
  await card('2050 · THE NEON VELODROME', 'ONE LAP FROM HISTORY', '', 2.2);
  audio.sfx('car_crash', { volume: 1, rate: 0.7 });
  await screenFade.flash('#ffffff', 0.5);
  audio.sfx('monitor_beep', { volume: 1 });
  await wait(0.6);
  audio.sfx('monitor_beep', { volume: 0.8, rate: 0.85 });
  const foot = await preload(FOOT_SANDBOX_ASSETS);
  await card('', 'HE CRASHED IN THE FUTURE.', '', 1.8);

  // --- 2020: the alley — wake, sniper, shadow step, fire ---------------------------------------
  const world = createFootSandbox(game.renderer, foot, { onExit: () => {} });
  game.setWorld(world);
  world.setHudVisible(false);
  world.player.locked = true;
  heartbeat.reset();
  await game.renderer.compileAsync?.(world.scene, world.camera).catch(() => {});
  game.renderOnce();
  await card('', 'HE WOKE UP IN THE PAST.', '', 1.6);
  await cutscenes.play(alleyMontage(world), { world });

  // --- the reverse chase ----------------------------------------------------------------------------------
  const chaseAssets = await preload(CHASE_ASSETS);
  await card('', 'HE HAS 72 HEARTBEATS', 'to find his way back', 2);
  const chase = createChaseWorld(chaseAssets, { onExit: () => {}, complete: () => {} });
  game.setWorld(chase);
  chase.setHudVisible(false);
  await game.renderer.compileAsync?.(chase.scene, chase.camera).catch(() => {});
  game.renderOnce();
  await cutscenes.play(chaseMontage(chase), { world: chase });

  objectives.destroy(); // the chase sets an objective; never let it reach the menu
  // --- 20:20 → title ------------------------------------------------------------------------------------------------
  await screenFade.toBlack(0.3);
  audio.stopMusic(1.5);
  audio.sfx('clock_tick', { volume: 1 });
  screenFade.setText('', '20:20', '');
  await wait(1.1);
  audio.sfx('clock_tick', { volume: 1 });
  await wait(1.1);
  audio.sfx('heartbeat', { volume: 1 });
  screenFade.setText('', 'FLATLINE: 2050', 'He crashed in the future. He woke up in the past.');
  await wait(4.5);
  screenFade.setText();
  CONFIG.cameraRig.hideBodyBelow = hideBelow;
  document.body.classList.remove('trailer');
}

function alleyMontage(world) {
  const p = world.player;
  const w = world.weapons;
  const dummy = () => world.level.range.targets[0];
  return {
    id: 'trailer_alley',
    mood: 'SHADOWS',
    handheld: 0.014,
    letterbox: true,
    steps: [
      // wake in the rain
      at(0, call(() => {
        p.cinematic = true;
        p.respawn(new THREE.Vector3(0, 0, -9), 0);
        p.anims.actor.play('death', 0.01, { loop: false, clamp: true });
        p.anims.actor.action('death').time = p.anims.actor.action('death').getClip().duration;
      })),
      at(0, cam.cut([0.4, 0.9, -8.4], [0, 0.2, -9])),
      at(0, fade.in(1.2)),
      at(0.2, cam.moveTo([0.9, 1.1, -7.9], [0, 0.3, -9.2], 3, 'sine.inOut')),
      at(1.8, call(() => p.anims.actor.play('idle', 1.4))),
      at(1.8, sfx('heartbeat', { volume: 0.9 })),
      at(3.4, sfx('thunder', { volume: 0.7 })),
      // sniper shot in slow motion
      at(3.6, call(() => {
        p.cinematic = false;
        p.respawn(new THREE.Vector3(0.6, 0, 2), 0);
        w._switchTo(w.guns.findIndex((g) => g.id === 'sniper'));
        w._finishState();
      })),
      at(3.6, cam.cut([1.4, 1.65, 0.6], [1.6, 1.3, 11.5])),
      at(3.6, setMood('TIME', 0.3)),
      at(4.4, call(() => {
        const d = dummy();
        w.combat = 2;
        p.combat = true;
        world.rig.yaw = Math.atan2(d.base.x - 0.6, d.base.z - 2);
        w._fire();
      })),
      at(4.4, slowMo(0.2, 1.4, 0.05)),
      at(4.5, cam.moveTo([1.2, 1.5, 6], [1.6, 1.3, 11.5], 1.6, 'sine.out')),
      at(4.9, call(() => dummy().actor.play('death', 0.1, { loop: false, clamp: true }))),
      // shadow step
      at(6.6, setMood('SHADOWS', 0.2)),
      at(6.6, call(() => {
        p.respawn(new THREE.Vector3(0, 0, 4), Math.PI);
        world.lights.items.forEach((l) => world.lights.shootOut(l));
      })),
      at(6.6, cam.cut([3, 1.8, 6.5], [0, 1, 2])),
      at(7.0, call(() => world.shadowStep._step(new THREE.Vector3(0, 0, -0.6)))),
      at(7.0, glitch(0.3, 0.6)),
      // fire
      at(9.2, setMood('FIRE', 0.2)),
      at(9.2, cam.cut([-1, 1.5, 11], [3.3, 0.8, 16])),
      at(9.4, call(() => explode(new THREE.Vector3(3.4, 0.5, 16.2), { radius: 4, damage: 0, fx: world.fx, scene: world.scene, rig: world.rig }))),
      at(9.4, flash('#ffb070', 0.4)),
      at(9.6, call(() => [[2.6, 0.4, 6.2], [3.3, 0.4, 7.1], [-3.6, 0.6, 11]].forEach((q) => world.fire.ignite(new THREE.Vector3(...q))))),
      at(9.8, cam.moveTo([-1.6, 1.1, 9], [3, 1.2, 15], 2.4, 'sine.inOut')),
      at(12.0, fade.out(0.4)),
    ],
    duration: 12.4,
  };
}

function chaseMontage(chase) {
  const car = chase.car;
  let iv = null;
  return {
    id: 'trailer_chase',
    mood: 'TIME',
    handheld: 0.012,
    letterbox: true,
    steps: [
      at(0, call(() => {
        chase.level.start();
        chase.setHudVisible(false);
        // a steady autopilot along the road
        iv = setInterval(() => {
          const s = chase.level.progress + 18 + Math.abs(car.speed) * 0.5;
          const a = chase.atS(s);
          const fwd = car.forward();
          const tx = a.p.x - car.position.x;
          const tz = a.p.z - car.position.z;
          const ang = Math.atan2(fwd.x * tz - fwd.z * tx, fwd.x * tx + fwd.z * tz);
          chase.inputOverride = { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, ang * 1.8)), handbrake: false, boost: true };
        }, 50);
      })),
      at(0, fade.in(0.8)),
      at(0, call((ctx) => {
        // ride along with the chase camera (the world's own camera)
        ctx.camera.copyFrom(chase.camera, car.position);
      })),
      at(0.1, call(() => game.setCameraOverride(null))),
      at(5.6, glitch(0.3, 0.6)),
      at(6.0, fade.out(0.5)),
      at(6.6, call(() => {
        clearInterval(iv);
        timeScale.set(1, 0.01);
      })),
    ],
    duration: 6.7,
  };
}

void gsap;
void letterbox;

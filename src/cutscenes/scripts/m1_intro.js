// =============================================================================
// FLATLINE: 2050 — cutscenes/scripts/m1_intro.js
// Mission 1 "Last Lap" opening (CLAUDE.md Phase 4). Built from the live race
// world so every shot is aimed at real positions.
//
//   Part A  drone over the Neon Velodrome + fireworks → cockpit, helmet HUD
//           boots, commentator → Victor in the VIP box, tablet: 20.20.20
//           → mission card
//   Part B  the start lights (red, red, red, GREEN) → whip pan to the chase cam
// =============================================================================

import * as THREE from 'three';
import { at, cam, actor, subtitle, voice, sfx, music, fade, glitch, setMood, call } from '../steps.js';

/** Part A. `scene` = mission dressing (helmet, fireworks, vip, nameTag). */
export function m1IntroA(world, dressing) {
  const { track, car } = world;
  const start = track.sampleAt(0).position;
  // Cockpit: driver's eye inside the car (car / physics space → world)
  const eye = car.root.localToWorld(new THREE.Vector3(0.05, 1.08, -0.35));
  const ahead = car.root.localToWorld(new THREE.Vector3(30, 0.8, -0.35));
  const inside = car.root.localToWorld(new THREE.Vector3(0.45, 1.06, -0.35));
  const vip = dressing.vip;

  return {
    id: 'm1_intro_a',
    mood: 'NEUTRAL',
    handheld: 0.01,
    missionCard: 1,
    actors: {
      victor: { model: 'characters.victor', position: vip.victorPosition.toArray(), yaw: vip.victorYaw, anim: 'idle' },
    },
    steps: [
      // --- Drone shot over the stadium at night --------------------------------------
      at(0, cam.cut([start.x - 260, 150, start.z - 170], [start.x + 120, 0, start.z + 160])),
      at(0, fade.in(1.6)),
      at(0, cam.moveTo([start.x - 70, 38, start.z - 55], [start.x + 10, 4, start.z], 9.2, 'sine.inOut')),
      at(0.2, sfx('crowd_cheer', { volume: 0.55 })),
      at(0.4, sfx('fireworks', { volume: 0.6, stopAfter: 9 })),
      ...[1.2, 1.9, 2.6, 3.4, 4.1, 5.0, 5.8, 6.6, 7.6, 8.3].map((t) => at(t, call(() => dressing.fireworks.launch()))),
      at(2.0, subtitle('commentator', 'Two hundred thousand fans. One final lap.', 3.2)),

      // --- Cockpit: the helmet HUD comes alive ------------------------------------------
      at(9.2, cam.cut(eye.toArray(), ahead.toArray())),
      at(9.2, cam.fov(52, 0.01)),
      at(9.25, cam.moveTo(inside.toArray(), ahead.toArray(), 6, 'sine.inOut')),
      at(9.6, call(() => dressing.helmet.bootUp())),
      at(9.6, sfx('heartbeat', { volume: 0.7 })),
      at(10.6, sfx('heartbeat', { volume: 0.7 })),
      at(11.0, voice('m1_commentator_01')),
      at(11.6, sfx('heartbeat', { volume: 0.7 })),

      // --- Victor Hale in the VIP box: the tablet shows the clue ------------------------
      at(15.6, call(() => dressing.helmet.clear(0.15))),
      at(15.6, cam.fov(40, 0.01)),
      at(15.6, cam.cut(vip.shotA.toArray(), vip.tabletLook.toArray())),
      at(15.6, setMood('SHADOWS', 0.3)),
      at(15.6, call(() => dressing.nameTag('Victor Hale', 'Owner · World Racing League'))),
      at(15.7, cam.moveTo(vip.shotB.toArray(), vip.faceLook.toArray(), 5, 'sine.inOut')),
      at(16.4, actor('victor').lookAt(vip.trackLook.toArray(), 1.2)),
      at(17.6, call(() => dressing.tabletGlitch())),
      at(17.6, glitch(0.25, 0.4)),
      at(20.6, fade.out(0.7)),
      at(20.6, music(null, 1.5)),
    ],
  };
}

/** Part B: start lights, then hand over to the player. */
export function m1IntroB(world) {
  const { track, race, car, camera } = world;
  const gantry = track.sampleAt(6);
  const lights = gantry.position.clone().setY(8.6);
  const low = car.root.localToWorld(new THREE.Vector3(9, 0.55, 1.6));

  return {
    id: 'm1_intro_b',
    handheld: 0.012,
    steps: [
      at(0, cam.cut(low.toArray(), lights.toArray())),
      at(0, cam.fov(46, 0.01)),
      at(0, fade.in(0.6)),
      at(0, setMood('NEUTRAL', 0.3)),
      at(0.2, cam.moveTo(car.root.localToWorld(new THREE.Vector3(7, 0.7, 2.2)).toArray(), lights.toArray(), 3.6, 'sine.in')),
      at(0.3, call(() => race.startCountdown())),
      // green at ≈ 3.9 s → whip pan onto the chase camera
      at(3.95, call((ctx) => {
        const fwd = car.forward();
        ctx.camera.moveTo(camera.position.clone(), car.position.clone().addScaledVector(fwd, 7).setY(0.9), 0.32, 'power4.in');
        ctx.camera.fov(camera.fov, 0.32);
      })),
      at(3.95, sfx('whoosh', { volume: 0.9 })),
      at(4.1, glitch(0.2, 0.35)),
    ],
    duration: 4.35,
  };
}

// =============================================================================
// FLATLINE: 2050 — missions/m5_manWithMyFace.js
// MISSION 5 · THE MAN WITH MY FACE (2020 · 🌑 SHADOWS · first boss) — 9.4
//
//   intro: a mirror-maze nightclub, lights flickering. Kael's reflection
//          smiles while he doesn't. UMBRA steps out of the mirror.
//   play:  the boss fight. Umbra can only be hurt in LIGHT; Kael needs the
//          DARK to survive (Umbra's aim is poor into shadow). Shoot out the
//          club lamps carefully, and throw the stage SPOTLIGHT switches (F)
//          to pin Umbra in light. He Shadow Steps and rewinds too.
//   outro: Umbra melts into the floor: "You ran from the fire. You'll
//          always run." Kael's heartbeat drops sharply.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { createModelInstance } from '../assets/loader.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { at, cam, sfx, voice, subtitle, fade, call, setMood, letterbox, glitch, flash } from '../cutscenes/steps.js';
import { objectives } from '../ui/objectiveHUD.js';
import { createOnFootWorld, ON_FOOT_ASSETS } from '../scenes/onFootWorld.js';
import { Umbra } from '../ai/umbraAI.js';
import { heartbeat } from '../systems/heartbeat.js';
import { addDissolve } from '../vfx/dissolveShader.js';
import { runMission } from './missionManager.js';
import { addClubLife } from '../vfx/ambientClub.js';

const ASSETS = [...ON_FOOT_ASSETS, 'characters.umbra', 'voice.m5_umbra_01', 'music.combat', 'textures.tiles'];
const MIRROR_Z = 6; // the big mirror Umbra steps out of

export function playMission5() {
  return runMission({
    number: 5,
    assets: ASSETS,
    parTime: 300,
    music: 'combat',
    create: (assets, ctx) => createOnFootWorld(game.renderer, assets, {
      spawn: [0, 0, 0],
      yaw: 0,
      fog: 0.02,
      rain: false,
      groundSize: 0,
      echo: () => ({ delay: 0.09, volume: 0.45 }),
      loadout: ['pistol', 'rifle'],
      onExit: ctx.onExit,
      build: (kit) => buildLevel(kit, ctx),
    }),
    intro: introScript,
    outro: outroScript,
  });
}

function buildLevel(kit, ctx) {
  const { scene, mats, addBox, addLamp, player, weapons, fx, rig, assets } = kit;
  const R = physics.RAPIER;
  // ---- the club: 36 × 36, black walls, mirror panels, a glowing dance floor ----
  const floorMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x07070c, roughness: 0.25, metalness: 0.6 }));
  const floor = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(40, 40)), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  physics.world.createCollider(R.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
  const black = kit.track(new THREE.MeshStandardMaterial({ color: 0x0c0c12, roughness: 0.9 }));
  addBox([37, 8, 1], [0, 4, -18.5], black);
  addBox([37, 8, 1], [0, 4, 18.5], black);
  addBox([1, 8, 37], [-18.5, 4, 0], black);
  addBox([1, 8, 37], [18.5, 4, 0], black);
  addBox([37, 0.5, 37], [0, 8.25, 0], black, { cast: false });
  // dance floor tiles
  const tileGeo = kit.track(new THREE.PlaneGeometry(1.9, 1.9));
  const tiles = [];
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) {
    const m = new THREE.Mesh(tileGeo, new THREE.MeshBasicMaterial({ color: 0x000000 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x * 2, 0.01, z * 2 - 2);
    scene.add(m);
    tiles.push(m);
  }
  // mirror maze (back half) + the big mirror
  const mirrorMat = kit.track(new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.14, metalness: 1, envMapIntensity: 0.3 }));
  const mirrors = [[[6, 3, 0.2], [0, 1.5, MIRROR_Z]], [[0.2, 3, 6], [-8, 1.5, 9]], [[0.2, 3, 6], [8, 1.5, 9]], [[6, 3, 0.2], [-11, 1.5, 13]], [[6, 3, 0.2], [11, 1.5, 13]], [[0.2, 3, 5], [-4, 1.5, 15]], [[0.2, 3, 5], [4, 1.5, 15]], [[5, 3, 0.2], [-13, 1.5, 4]], [[5, 3, 0.2], [13, 1.5, 4]]];
  mirrors.forEach(([s, p]) => addBox(s, p, mirrorMat, { surface: 'glass' }));
  // bar + booths (cover in the front half)
  addBox([10, 1.1, 1.2], [0, 0.55, -14], mats.metal, { surface: 'metal' });
  [[-12, -8], [12, -8], [-12, -2], [12, -2]].forEach(([x, z]) => addBox([3, 1.1, 1.4], [x, 0.55, z], black, { surface: 'wood' }));
  // neon strips
  const neon = (color, s, p) => {
    const m = new THREE.Mesh(kit.track(new THREE.BoxGeometry(...s)), kit.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.5) })));
    m.position.set(...p);
    scene.add(m);
  };
  neon(0x8a4dff, [36, 0.08, 0.08], [0, 7.6, -17.9]);
  neon(0xff2a8a, [0.08, 0.08, 36], [-17.9, 7.6, 0]);
  neon(0x3fa9ff, [0.08, 0.08, 36], [17.9, 7.6, 0]);

  // ---- 🌑 club lamps (shootable) and 💡 stage spotlights (switches) ----------------------------------------
  [[-14, -14], [14, -14], [-14, 10], [14, 10], [0, -16], [0, 16]].forEach(([x, z]) => {
    const it = addLamp([x, 2.6, z], { model: false, intensity: 18, reach: 10, color: 0xb070ff });
    it.light.position.y = 6.5;
    it.position.y = 6.5;
    if (it.bulb) it.bulb.position.y = 6.5;
  });
  const spots = [[-10, 0], [10, 0], [0, 10]].map(([x, z], i) => {
    const light = new THREE.SpotLight(0xffffff, 0, 30, 0.42, 0.35, 1.2);
    light.position.set(x * 0.4, 7.8, -12);
    light.target.position.set(x, 0, z);
    scene.add(light, light.target);
    // the switch on the wall
    const sw = new THREE.Mesh(kit.track(new THREE.BoxGeometry(0.3, 0.45, 0.12)), kit.track(new THREE.MeshStandardMaterial({ color: 0x222228, emissive: new THREE.Color(0xff3020), emissiveIntensity: 1.5 })));
    const swPos = new THREE.Vector3([-17.9, 17.9, 0][i], 1.4, [-6, -6, -17.9][i]);
    sw.position.copy(swPos);
    scene.add(sw);
    const spot = { light, sw, on: false, t: 0, target: light.target.position };
    kit.addInteractable({
      position: swPos, prompt: 'Throw the stage spotlight', height: 0.6,
      onInteract: () => {
        if (spot.on) return;
        spot.on = true;
        spot.t = CONFIG.mission5.spotSeconds;
        audio.sfx('ui_click', { volume: 0.8, rate: 0.7 });
        sw.material.emissive.setHex(0x30ff60);
      },
    });
    return spot;
  });
  // spotlights count as light for Umbra's vulnerability: a fake "lamp" that follows him while lit
  const kitLights = kit.lights;

  dressAmbient(kit, spots);

  // ---- Umbra ----------------------------------------------------------------------------------------------------
  const arena = [];
  for (let x = -14; x <= 14; x += 4) for (let z = -14; z <= 14; z += 4) arena.push(new THREE.Vector3(x, 0, z));
  const umbra = new Umbra({ scene, assets, player, weapons, fx, rig, position: [0, 0, MIRROR_Z + 1.2], arena });
  umbra.model.visible = false;
  umbra.state = 'dormant';
  const offFixed = physics.onFixedUpdate((dt) => umbra.fixedUpdate(dt));
  let started = false;
  umbra.onDeath = () => setTimeout(() => ctx.complete(), 2500);

  // boss bar
  const bar = document.createElement('div');
  bar.className = 'boss-bar';
  bar.innerHTML = '<span>UMBRA</span><div><i></i></div><em>only in light</em>';
  bar.style.opacity = 0;
  document.getElementById('ui-root').appendChild(bar);
  const fill = bar.querySelector('i');

  // Kael in the dark is hard to hit: wrap the Umbra shot
  const realShoot = umbra._shoot.bind(umbra);
  umbra._shoot = () => {
    if (kitLights.isDark(player.position) && Math.random() < 0.55) {
      // a wide miss into the dark
      const muzzle = umbra.position.clone().add(new THREE.Vector3(0, 1.3, 0));
      const end = player.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, 1 + Math.random(), (Math.random() - 0.5) * 4));
      fx.tracer(muzzle, end, new THREE.Color(1.6, 0.8, 3));
      audio.sfxAt('pistol_shot', muzzle, { volume: 0.6, rate: 0.8 });
      return;
    }
    realShoot();
  };

  let floorT = 0;
  return {
    umbra,
    mirrorZ: MIRROR_Z,
    start() {
      started = true;
      umbra.model.visible = true;
      umbra.state = 'fight';
      objectives.set('Survive Umbra');
      objectives.hint('He can only be hurt in LIGHT. Throw the stage spotlights [F] — stay in the dark yourself', 8);
      gsap.to(bar, { opacity: 1, duration: 0.6 });
      kit.setCheckpoint([0, 0, -10], 0);
    },
    update(dt) {
      umbra.update(dt);
      floorT += dt;
      // the dance floor pulses violet
      tiles.forEach((t, i) => t.material.color.setHSL(0.75, 1, Math.max(0, Math.sin(floorT * 3 + i * 0.7)) * 0.05));
      // spotlights: on for a while, they track Umbra a little
      let lit = false;
      for (const s of spots) {
        if (!s.on) continue;
        s.t -= dt;
        s.light.intensity = 140;
        s.target.lerp(umbra.position, Math.min(1, dt * CONFIG.mission5.spotTrack));
        if (s.target.distanceTo(umbra.position) < 2.4) lit = true;
        if (s.t <= 0) {
          s.on = false;
          s.light.intensity = 0;
          s.sw.material.emissive.setHex(0xff3020);
        }
      }
      umbra.spotlit = lit;
      if (started) fill.style.transform = `scaleX(${Math.max(0, umbra.health / umbra.maxHealth).toFixed(3)})`;
      bar.classList.toggle('is-vulnerable', !umbra.dead && (umbra.inLight || lit));
    },
    dispose() {
      offFixed();
      umbra.dispose();
      bar.remove();
      spots.forEach((s) => {
        s.light.removeFromParent();
        s.light.target.removeFromParent();
        s.sw.removeFromParent();
      });
    },
  };
}

// -----------------------------------------------------------------------------
// Ambient life (vfx/ambientLife.js): the nightclub: lasers, a mirror ball, strobes, haze, spotlight beams
// -----------------------------------------------------------------------------
function dressAmbient(kit, spots) {
  addClubLife(kit.ambient, {
    room: { min: [-18, 0, -18], max: [18, 8, 18] },
    emitters: [[-14, 7.6, -16.5], [14, 7.6, -16.5], [0, 7.75, -17.4], [-17.3, 7.4, 6], [17.3, 7.4, 6]],
    ball: [0, 6.7, -4],
    strobes: [[-6, 7.97, -7], [6, 7.97, -7], [-6, 7.97, 1], [6, 7.97, 1]],
  });
  // the stage spotlights get visible beams in the haze while they're switched on
  kit.ambient.spotBeams({ lights: spots.map((s) => s.light), opacity: 0.16, maxIntensity: 140 });
}

// -----------------------------------------------------------------------------
// Cutscenes
// -----------------------------------------------------------------------------
function introScript(world) {
  const p = world.player;
  const { umbra } = world.level;
  const z = MIRROR_Z;
  let dis = null;
  return {
    id: 'm5_intro',
    mood: 'SHADOWS',
    handheld: 0.014,
    missionCard: 5,
    steps: [
      at(0, letterbox(true)),
      at(0, call(() => {
        p.cinematic = true;
        p.respawn(new THREE.Vector3(0, 0, z - 1.6), 0);
        p.anims.actor.play('idle', 0.01);
        // the "reflection": Umbra wearing Kael's look, mirrored behind the glass
        umbra.model.visible = true;
        umbra._teleport(new THREE.Vector3(0, 0, z + 1.6));
        umbra.yaw = Math.PI;
        umbra.mat.color.setHex(0x2a2a30);
      })),
      at(0, cam.cut([1.4, 1.7, z - 4.2], [0, 1.5, z])),
      at(0, fade.in(1.6)),
      at(0.4, call(() => world.lamps.forEach((l, i) => setTimeout(() => (l.light.intensity = l.intensity * (Math.random() < 0.5 ? 0.2 : 1)), i * 120)))),
      at(1.2, subtitle('kael', 'Mirrors. Of course it had to be mirrors.', 2.6)),
      at(4.0, cam.moveTo([0.35, 1.68, z - 2.4], [0, 1.62, z + 1.6], 2.4, 'sine.inOut')),
      at(5.0, subtitle('kael', '…', 1.2)),
      at(6.0, glitch(0.3, 0.6)),
      at(6.2, subtitle('umbra', '(smiles)', 1.6)),
      at(6.4, sfx('reverse_whoosh', { volume: 0.7, rate: 0.6 })),
      at(7.6, call(() => {
        // the void takes him
        umbra.mat.color.setHex(0x000000);
        dis = { v: 1 };
        umbra.dissolve.set(1, 0);
      })),
      at(7.6, flash('#8a4dff', 0.5)),
      at(7.7, cam.cut([3.2, 1.4, z - 3.8], [0, 1.3, z])),
      at(7.8, call(() => {
        // he steps out through the glass, re-forming
        gsap.to(dis, { v: 0, duration: 1.6, onUpdate: () => umbra.dissolve.set(dis.v, 0) });
        gsap.to(umbra.position, { z: z - 0.4, duration: 1.8, ease: 'power1.inOut', onUpdate: () => umbra._teleport(umbra.position.clone()) });
        umbra.actor.play('walk', 0.2);
      })),
      at(9.8, call(() => umbra.actor.play('idle_gun_pointing', 0.3))),
      at(10, voice('m5_umbra_01')),
      at(10, setMood('SHADOWS', 0.5)),
      at(13.8, subtitle('kael', 'You\'re not real.', 1.8)),
      at(15.6, subtitle('umbra', 'Then shoot me.', 1.8)),
      at(17.4, call(() => {
        p.cinematic = false;
        p.respawn(new THREE.Vector3(0, 0, -10), 0);
        umbra._teleport(new THREE.Vector3(0, 0, z - 1));
      })),
      at(17.4, letterbox(false)),
    ],
    duration: 17.6,
  };
}

function outroScript(world) {
  const { umbra } = world.level;
  return {
    id: 'm5_outro',
    mood: 'SHADOWS',
    handheld: 0.012,
    steps: [
      at(0, letterbox(true)),
      at(0, cam.cut([umbra.position.x + 2.4, 1.2, umbra.position.z - 2.4], [umbra.position.x, 0.6, umbra.position.z])),
      at(0.4, subtitle('umbra', 'You ran from the fire.', 2.2)),
      at(2.8, subtitle('umbra', 'You\'ll always run.', 2.2)),
      at(5.2, call(() => {
        heartbeat.spend(CONFIG.mission5.beatsLost, 'umbra', { force: true });
        audio.sfx('heartbeat', { volume: 1, rate: 0.6 });
      })),
      at(5.2, setMood('TIME', 0.8)),
      at(5.4, cam.moveTo([world.player.position.x + 0.8, 1.7, world.player.position.z - 1.4], [world.player.position.x, 1.5, world.player.position.z], 2.4, 'sine.inOut')),
      at(6.0, sfx('heartbeat', { volume: 0.8, rate: 0.55 })),
      at(6.4, subtitle('kael', 'My heart— it\'s slowing. In 2050 I\'m… slipping.', 3.2)),
      at(7.4, sfx('heartbeat', { volume: 0.6, rate: 0.5 })),
      at(9.8, fade.out(1.4)),
    ],
    duration: 11.4,
  };
}

void addDissolve;
void createModelInstance;

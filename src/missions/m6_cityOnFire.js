// =============================================================================
// FLATLINE: 2050 — missions/m6_cityOnFire.js
// MISSION 6 · CITY ON FIRE (2020 · 🔥 FIRE) — Phase 9.5
//
//   intro: Victor on the phone in his office: "Burn the whole district. No
//          evidence." Explosions rip down the street. Kael and Mara meet.
//   play:  an open district with spreading fire. Carry 8 trapped civilians
//          (F) to the ambulance where Mara gives covering fire. Enforcers
//          hunt you; two buildings collapse on a timer (you get a warning).
//   outro: Mara hands Kael the factory files — Victor's name on every page,
//          and the last page: the magnetic engine.
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
import { at, cam, sfx, voice, subtitle, fade, call, setMood, letterbox, flash } from '../cutscenes/steps.js';
import { objectives } from '../ui/objectiveHUD.js';
import { createOnFootWorld, ON_FOOT_ASSETS } from '../scenes/onFootWorld.js';
import { explode } from '../systems/explosions.js';
import { runMission } from './missionManager.js';

const ASSETS = [
  ...ON_FOOT_ASSETS, 'characters.mara', 'characters.victor', 'characters.civilian', 'characters.civilian_f',
  'vehicles.car_2020_sedan', 'vehicles.suv', 'vehicles.police_car', 'props.dumpster', 'props.fire_hydrant',
  'voice.m6_victor_01', 'sfx.siren', 'music.combat',
];
const SAFE = new THREE.Vector3(0, 0, -34);
const TRAPPED = [[-22, 0, -10], [22, 0, -12], [-30, 0, 8], [8, 0, 6], [30, 0, 10], [-12, 0, 24], [16, 0, 28], [-26, 0, 32]];
const rand = (a, b) => a + Math.random() * (b - a);

export function playMission6() {
  return runMission({
    number: 6,
    assets: ASSETS,
    parTime: 540,
    music: 'combat',
    create: (assets, ctx) => createOnFootWorld(game.renderer, assets, {
      spawn: [0, 0, -30],
      yaw: 0,
      fog: 0.016,
      background: 0x140806,
      rain: false,
      groundSize: 140,
      echo: () => CONFIG.weapons.echo,
      onExit: ctx.onExit,
      build: (kit) => buildLevel(kit, ctx),
    }),
    intro: introScript,
    outro: outroScript,
  });
}

function buildLevel(kit, ctx) {
  const { scene, mats, addBox, addProp, addLamp, addCover, ai, player, weapons, fx, fire, assets } = kit;
  const M = CONFIG.mission6;
  scene.fog.color.setHex(0x1a0a06); // the sky glows with the fire

  // ---- the district: 3 × 3 blocks between streets ------------------------------------------------------------
  const blocks = [];
  for (const bx of [-38, 0, 38]) {
    for (const bz of [-2, 40]) {
      const w = 22;
      const d = 20;
      const h = rand(10, 18);
      const m = addBox([w, h, d], [bx, h / 2, bz], mats.brick);
      blocks.push({ mesh: m, x: bx, z: bz, w, d, h });
      // burning shopfronts along the street sides
      for (let k = -1; k <= 1; k++) kit.addFlammable([bx + k * 6, 0.6, bz - d / 2 - 0.6], 1.2);
    }
  }
  addBox([140, 10, 1], [0, 5, -50], mats.brick);
  addBox([140, 10, 1], [0, 5, 64], mats.brick);
  addBox([1, 10, 114], [-58, 5, 7], mats.brick);
  addBox([1, 10, 114], [58, 5, 7], mats.brick);
  // wrecks and cover in the streets (they burn too)
  const wrecks = [[-18, -18, 'car_2020_sedan', 0.4], [14, -20, 'suv', -0.3], [-6, 16, 'car_2020_sedan', 1.2], [20, 18, 'police_car', 2.0], [-34, 18, 'suv', 0.2], [34, -18, 'car_2020_sedan', -1.1]];
  wrecks.forEach(([x, z, k, r]) => {
    addProp(`vehicles.${k}`, [x, 0, z], r, { surface: 'metal' });
    kit.addFlammable([x, 0.8, z], 1.4);
    addCover([x + 2.8, 0, z], true);
    addCover([x - 2.8, 0, z], true);
  });
  [[-8, -24], [10, -6], [-20, 6], [24, 2], [-2, 30], [28, 30]].forEach(([x, z]) => {
    addProp('props.dumpster', [x, 0, z], rand(0, 3), { surface: 'metal' });
    kit.addFlammable([x, 0.6, z], 1);
    addCover([x + 1.6, 0, z], true);
    addCover([x - 1.6, 0, z], true);
  });
  // lamps (half of them are already out)
  [[-19, -20], [19, -20], [-19, 20], [19, 20], [0, 0]].forEach(([x, z], i) => addLamp([x, 0, z], { rotY: i % 2 ? -Math.PI / 2 : Math.PI / 2, intensity: 24, reach: 12 }));
  // the safe zone: an ambulance-white van and Mara
  addProp('vehicles.suv', [4, 0, -36], Math.PI / 2, { surface: 'metal' });
  const safeLight = new THREE.PointLight(0x9fd8ff, 20, 14, 2);
  safeLight.position.set(0, 4, -34);
  scene.add(safeLight);

  dressAmbient(kit, blocks);

  // ---- fires already burning ------------------------------------------------------------------------------------------
  setTimeout(() => {
    [[-38, 0.6, -12.6], [38, 0.6, -12.6], [0, 0.6, 29.4], [-14, 0.8, -18], [20, 0.8, 18]].forEach((p) => fire.ignite(new THREE.Vector3(...p)));
  }, 400);

  // ---- Mara: covering fire from the safe zone ----------------------------------------------------------------------------
  const maraTpl = assets.get('characters.mara');
  const mara = new Actor('mara', createModelInstance(maraTpl), maraTpl.animations);
  scene.add(mara.object);
  mara.place([-2.5, 0, -33], 0);
  mara.play('idle_gun', 0.01);
  let maraT = 2;

  // ---- trapped civilians -------------------------------------------------------------------------------------------------------
  const civTpls = [assets.get('characters.civilian'), assets.get('characters.civilian_f')];
  const beaconGeo = kit.track(new THREE.OctahedronGeometry(0.18, 0));
  const beaconMat = kit.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x6fd0ff).multiplyScalar(3) }));
  let carrying = null;
  let rescued = 0;
  const civs = TRAPPED.map((p, i) => {
    const tpl = civTpls[i % 2];
    const a = new Actor('civilian', createModelInstance(tpl), tpl.animations);
    scene.add(a.object);
    a.place(p, rand(0, 6));
    a.play('sitting', 0.01);
    kit.addFlammable([p[0] + 1.6, 0.5, p[2] + 1.2], 0.9);
    // a glowing marker (no real light: eight extra lights would cost too much)
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(p[0], 2.4, p[2]);
    scene.add(beacon);
    const c = { actor: a, pos: new THREE.Vector3(...p), state: 'trapped', beacon };
    c.item = {
      position: c.pos.clone(), prompt: 'Carry', height: 1, enabled: true,
      onInteract: () => {
        if (carrying) return;
        carrying = c;
        c.state = 'carried';
        c.item.enabled = false;
        audio.sfx('footstep_concrete', { volume: 0.8, rate: 0.7 });
        subtitles.show('kael', ['I\'ve got you.', 'Hold on.', 'Come on, up.'][Math.floor(Math.random() * 3)], 1.6);
        objectives.hint('Carry them to Mara at the ambulance — you can\'t sprint or shoot', 4);
      },
    };
    kit.addInteractable(c.item);
    return c;
  });

  // ---- enforcers ---------------------------------------------------------------------------------------------------------------------
  const enemySpots = [[-20, 0, -4, [[-20, 0, -4], [-30, 0, -4]]], [20, 0, -4, [[20, 0, -4], [30, 0, -4]]], [0, 0, 18, [[0, 0, 18], [10, 0, 18]]], [-24, 0, 20, []], [24, 0, 24, [[24, 0, 24], [24, 0, 34]]], [0, 0, 40, []]];
  enemySpots.forEach(([x, y, z, patrol]) => ai.spawn({ position: [x, y, z], yaw: Math.PI, patrol }));
  let reinforced = false;

  // ---- collapses -------------------------------------------------------------------------------------------------------------------------
  const collapses = [
    { t: M.collapseAt[0], block: blocks[1], warned: false, done: false },
    { t: M.collapseAt[1], block: blocks[4], warned: false, done: false },
  ];
  let clock = 0;
  const warnEl = document.createElement('div');
  warnEl.className = 'collapse-warn';
  document.getElementById('ui-root').appendChild(warnEl);

  function collapse(c) {
    c.done = true;
    const b = c.block;
    const at = new THREE.Vector3(b.x, 0, b.z - b.d / 2);
    audio.sfxAt('explosion', at, { volume: 1, rate: 0.6, refDistance: 20 });
    kit.rig.shake = Math.max(kit.rig.shake, 0.8);
    // the facade falls forward into the street
    const facade = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, 1.2), mats.brick);
    facade.position.set(b.x, b.h / 2, b.z - b.d / 2 - 0.6);
    scene.add(facade);
    const st = { a: 0 };
    gsap.to(st, {
      a: Math.PI / 2, duration: 1.6, ease: 'power2.in',
      onUpdate: () => {
        facade.rotation.x = -st.a;
        facade.position.y = (b.h / 2) * Math.cos(st.a) + 0.6;
        facade.position.z = b.z - b.d / 2 - 0.6 - (b.h / 2) * Math.sin(st.a);
      },
      onComplete: () => {
        const R = physics.RAPIER;
        physics.world.createCollider(R.ColliderDesc.cuboid(b.w / 2, 0.6, b.h / 2).setTranslation(b.x, 0.6, b.z - b.d / 2 - b.h / 2 - 0.6));
        for (let i = 0; i < 40; i++) fx.puffs.emit(new THREE.Vector3(b.x + rand(-b.w / 2, b.w / 2), 0.5, b.z - b.d / 2 - rand(0, b.h)), new THREE.Vector3(rand(-2, 2), rand(0.5, 2.5), rand(-2, 2)), [0.3, 0.27, 0.24], rand(0.6, 1.2), rand(2, 3.5), 0.2, 3);
        // anyone under it
        const pp = player.position;
        if (Math.abs(pp.x - b.x) < b.w / 2 && pp.z < b.z - b.d / 2 && pp.z > b.z - b.d / 2 - b.h) player.hurt(200);
        fire.ignite(new THREE.Vector3(b.x, 0.6, b.z - b.d / 2 - 3));
      },
    });
  }

  const hud = document.createElement('div');
  void hud;
  return {
    mara,
    civs,
    safeLight,
    get rescued() {
      return rescued;
    },
    start() {
      objectives.set('Rescue the trapped civilians');
      objectives.progress('Rescued', 0, TRAPPED.length);
      objectives.hint('Find the blue lights — [F] to carry. Mara covers you from the ambulance.', 7);
      kit.setCheckpoint(SAFE.toArray(), 0);
    },
    update(dt) {
      clock += dt;
      mara.update(dt);
      civs.forEach((c) => c.actor.update(dt));
      // carrying: the civilian rides on Kael's shoulder, Kael can't sprint or shoot
      player.carrying = !!carrying;
      if (carrying) {
        const o = carrying.actor.object;
        o.position.copy(player.position).add(new THREE.Vector3(0, 1.05, 0));
        o.rotation.set(0, player.yaw + Math.PI / 2, Math.PI / 2);
        player.intent.sprint = false;
        player.sprinting = false;
        weapons.combat = 0;
        if (player.position.distanceTo(SAFE) < M.safeRadius) {
          rescued += 1;
          carrying.state = 'safe';
          carrying.beacon.removeFromParent();
          o.rotation.set(0, Math.PI, 0);
          o.position.set(SAFE.x + rand(-3, 3), 0, SAFE.z - rand(1, 3));
          carrying.actor.play('idle', 0.3);
          carrying = null;
          objectives.progress('Rescued', rescued, TRAPPED.length);
          audio.sfx('scifi_beep', { volume: 0.5 });
          subtitles.show('mara', ['Got them. Go!', 'Another one — keep going!', 'They\'re safe. How many more?'][rescued % 3], 2);
          kit.setCheckpoint(SAFE.toArray(), 0);
          if (rescued >= 3 && !reinforced) {
            reinforced = true;
            [[-40, 0, 24], [40, 0, 24], [0, 0, 56]].forEach((p) => ai.spawn({ position: p, yaw: Math.PI, patrol: [] }).alert(player.position));
            subtitles.show('mara', 'More of Hale\'s men — from the north!', 2.4);
          }
          if (rescued >= TRAPPED.length) ctx.complete();
        }
        if (player.state === 'dead') {
          // dropped where he fell
          carrying.actor.object.rotation.set(0, 0, 0);
          carrying.pos.copy(player.position);
          carrying.item.position.copy(player.position);
          carrying.item.enabled = true;
          carrying.actor.object.position.copy(player.position);
          carrying.state = 'trapped';
          carrying = null;
        }
      }
      // Mara's covering fire
      maraT -= dt;
      if (maraT <= 0) {
        maraT = rand(1.2, 2);
        const muzzle = mara.object.position.clone().add(new THREE.Vector3(0, 1.4, 0));
        const target = ai.alive.filter((e) => e.position.distanceTo(muzzle) < M.maraRange).sort((a, b) => a.position.distanceTo(muzzle) - b.position.distanceTo(muzzle))[0];
        if (target) {
          const aim = target.position.clone().add(new THREE.Vector3(0, 1.2, 0));
          const dir = aim.clone().sub(muzzle).normalize();
          const R = physics.RAPIER;
          const hit = physics.world.castRay(new R.Ray(muzzle, dir), M.maraRange, true, R.QueryFilterFlags.EXCLUDE_SENSORS);
          mara.object.rotation.y = Math.atan2(dir.x, dir.z);
          mara.play('idle_gun_shoot', 0.1);
          fx.flash(muzzle.clone().addScaledVector(dir, 0.4), dir, 0.8);
          const end = hit ? muzzle.clone().addScaledVector(dir, hit.timeOfImpact) : aim;
          fx.tracer(muzzle, end, new THREE.Color(1.2, 2.6, 2.4));
          audio.sfxAt('pistol_shot', muzzle, { volume: 0.6 });
          if (hit && hit.collider.handle === target.collider.handle && Math.random() < M.maraAccuracy) target.damage(M.maraDamage);
        }
      }
      // collapse timers
      for (const c of collapses) {
        if (c.done) continue;
        const left = c.t - clock;
        if (left < 12 && !c.warned) {
          c.warned = true;
          subtitles.show('mara', 'That building\'s coming down — get clear of it!', 2.6);
        }
        if (c.warned) {
          warnEl.style.opacity = 1;
          warnEl.textContent = `⚠ BUILDING COLLAPSE · ${Math.max(0, left).toFixed(0)}s`;
        }
        if (left <= 0) {
          collapse(c);
          warnEl.style.opacity = 0;
        }
      }
    },
    dispose() {
      warnEl.remove();
      mara.object.removeFromParent();
      civs.forEach((c) => {
        c.actor.object.removeFromParent();
        c.beacon.removeFromParent();
      });
      safeLight.removeFromParent();
    },
  };
}

// -----------------------------------------------------------------------------
// Ambient life (vfx/ambientLife.js): the burning district: embers, ash, smoke columns, a news chopper
// -----------------------------------------------------------------------------
function dressAmbient(kit, blocks) {
  const life = kit.ambient;
  life.embers({ center: [0, 7, 7], size: [112, 14, 112], count: 1400, rise: 1.2, wind: [1.2, 0, 0.5], pointSize: 0.09 });
  life.ash({ center: [0, 9, 7], size: [100, 18, 100], count: 1600, fall: 0.8, wind: [1, 0, 0.4], pointSize: 0.06, glow: 0.3 });
  // smoke pouring off the roofs (fire-lit underneath), and from the city beyond
  life.smokeColumns({ points: blocks.filter((_, i) => i % 2 === 0 || i === 3).map((b) => [b.x + 4, b.h, b.z]), height: 36, spread: 9, puff: 7, perPoint: 40 });
  life.smokeColumns({ points: [[-120, 10, -70], [140, 14, 30], [-60, 8, 160], [90, 10, 170]], height: 90, spread: 22, puff: 22, life: 18, perPoint: 36, fogK: 0.25 });
  life.skyline({ center: [0, 0, 7], radius: [95, 230], count: 100, height: [16, 80], tint: 0xff9a5a, cool: 0xffc27a, litRatio: 0.12, fogK: 0.25 });
  // downed power lines, still live
  life.cables({ spans: [[-27, 8, -12.2, -11.5, 0.3, -14, 0.5], [27, 9, 29.5, 12, 0.2, 31, 0.6], [11, 10, -12.2, 27, 4.5, -18, 1.2]], radius: 0.025, sway: 0.08 });
  life.sparks({ points: [[-11.5, 0.3, -14], [12, 0.2, 31], [27, 4.5, -18]], perPoint: 30, interval: 1.8 });
  // the police wreck's light bar still strobing, a news chopper overhead
  life.lightBar({ position: [20, 1.55, 18], rotY: 2.0 + Math.PI / 2 });
  life.helicopter({ center: [0, 0, 7], radius: 62, height: 46, speed: -0.06, color: 0xfff1d8 });
  life.papers({ count: 22, radius: 16, wind: [2.2, 0, 0.9] });
}

// -----------------------------------------------------------------------------
// Cutscenes
// -----------------------------------------------------------------------------
function introScript(world) {
  const { scene, kit } = world;
  // Victor's office: a small lit box far from the district
  const office = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.7 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 0.2), wallMat);
  back.position.set(0, 2, 3);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.85, 1.1), new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.4, metalness: 0.2 }));
  desk.position.set(0, 0.42, 0.6);
  office.add(back, desk);
  // borrow the safe-zone light for the office (adding a light mid-game recompiles every shader)
  const lamp = world.level.safeLight;
  const lampHome = lamp.position.clone();
  lamp.position.set(199, 2.2, 200);
  lamp.color.setHex(0xffc890);
  office.position.set(200, 0, 200);
  scene.add(office);
  const vTpl = kit.assets.get('characters.victor');
  const victor = new Actor('victor', createModelInstance(vTpl), vTpl.animations);
  office.add(victor.object);
  victor.place([0, 0, 1.6], Math.PI);
  victor.play('idle', 0.01);
  const o = (x, y, z) => [200 + x, y, 200 + z];
  return {
    id: 'm6_intro',
    mood: 'FIRE',
    handheld: 0.012,
    missionCard: 6,
    steps: [
      at(0, letterbox(true)),
      at(0, cam.cut(o(1.6, 1.6, -2.2), o(0, 1.5, 1.6))),
      at(0, fade.in(1.4)),
      at(0.2, cam.moveTo(o(0.8, 1.65, -1.2), o(0, 1.6, 1.6), 5, 'sine.inOut')),
      at(0.4, call(() => victor.update(0))),
      at(1.2, subtitle('victor', 'Yes. All of it.', 1.8)),
      at(3.0, voice('m6_victor_01')),
      at(6.6, call(() => {
        scene.remove(office);
        lamp.position.copy(lampHome);
        lamp.color.setHex(0x9fd8ff);
      })),
      // the street goes up
      at(6.6, cam.cut([-10, 3, -28], [6, 2, -10])),
      at(6.8, call(() => {
        explode(new THREE.Vector3(-14, 0.8, -18), { radius: 4, damage: 0, fx: world.fx, scene, rig: world.rig });
        setTimeout(() => explode(new THREE.Vector3(14, 0.8, -20), { radius: 4, damage: 0, fx: world.fx, scene, rig: world.rig }), 700);
        setTimeout(() => explode(new THREE.Vector3(-6, 0.8, 16), { radius: 4, damage: 0, fx: world.fx, scene, rig: world.rig }), 1400);
      })),
      at(6.8, flash('#ffb070', 0.5)),
      at(7.0, cam.shake(0.6, 1.4)),
      at(8.8, sfx('siren', { volume: 0.6, stopAfter: 6 })),
      // Kael and Mara
      at(9.8, cam.cut([1.5, 1.7, -36.5], [-1.2, 1.5, -33])),
      at(10, subtitle('mara', 'You. The guy from the water tower.', 2.4)),
      at(12.6, subtitle('kael', 'Kael. And this is Hale\'s work — he\'s burning the evidence.', 3)),
      at(15.8, subtitle('mara', 'Then help me get these people out. I\'ll cover you.', 2.8)),
      at(18.8, letterbox(false)),
    ],
    duration: 19,
  };
}

function outroScript(world) {
  const { mara } = world.level;
  const files = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.24), new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.9 }));
  return {
    id: 'm6_outro',
    mood: 'FIRE',
    handheld: 0.01,
    steps: [
      at(0, letterbox(true)),
      at(0, call(() => {
        world.player.respawn(new THREE.Vector3(-0.6, 0, -33.2), -Math.PI / 2);
        mara.place([-2.4, 0, -33.2], Math.PI / 2);
        mara.play('idle', 0.2);
        files.position.set(-1.5, 1.15, -33.2);
        world.scene.add(files);
      })),
      at(0, cam.cut([-1.5, 1.7, -35.6], [-1.5, 1.3, -33.2])),
      at(0.4, subtitle('mara', 'Your father\'s factory files. Pulled from records before Hale could.', 3.2)),
      at(3.8, cam.cut([-1.3, 1.6, -33.6], [-1.5, 1.15, -33.2])),
      at(4.0, subtitle('kael', 'Victor Hale. Victor Hale. His name\'s on every page.', 3)),
      at(7.2, subtitle('kael', 'And the last one… the magnetic engine. Dad\'s design. Hale wanted it.', 3.4)),
      at(10.8, subtitle('mara', 'Then we take it to him.', 2.2)),
      at(13.2, fade.out(1.2)),
      at(14.4, call(() => files.removeFromParent())),
    ],
    duration: 14.5,
  };
}

void setMood;

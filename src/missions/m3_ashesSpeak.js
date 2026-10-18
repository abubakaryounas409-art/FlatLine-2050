// =============================================================================
// FLATLINE: 2050 — missions/m3_ashesSpeak.js
// MISSION 3 · ASHES SPEAK (2020 · 🔥 FIRE · investigation) — Phase 9.2
//
//   intro: the burnt factory gates. A desaturated flashback: young Kael
//          watching the flames from a car window.
//   play:  explore the factory (stealth, a few enforcers). Hold G to SCAN —
//          the world turns orange and clues glow. Find 5; the last one is a
//          burnt watch stopped at 20:20. Leaving triggers an ambush and the
//          factory starts to burn (🔥 spreading fire) — get out.
//   outro: a wall collapses behind Kael. Victor's car glides past, seen in a
//          puddle's reflection.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { input } from '../core/input.js';
import { createModelInstance } from '../assets/loader.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { at, cam, sfx, subtitle, fade, call, setMood, letterbox, flash } from '../cutscenes/steps.js';
import { objectives } from '../ui/objectiveHUD.js';
import { createOnFootWorld, ON_FOOT_ASSETS, repeatMaterial } from '../scenes/onFootWorld.js';
import { explode } from '../systems/explosions.js';
import { runMission } from './missionManager.js';

const ASSETS = [
  ...ON_FOOT_ASSETS, 'textures.charred', 'textures.burnt_wood', 'props.burnt_watch', 'vehicles.car_2020_sedan', 'music.combat',
];

const CLUES = [
  { id: 'fuel', pos: [10, 0.5, 9], text: 'Fuel cans, lined up along the wall. This was no accident.', label: 'Fuel cans' },
  { id: 'blueprint', pos: [0, 2.05, 20], text: 'The magnetic engine. Dad\'s design… half of it burnt away.', label: 'Blueprint' },
  { id: 'card', pos: [-16, 0.95, 36], text: '"HALE INDUSTRIES — Victor Hale, Partner." What was he doing here that night?', label: 'Business card' },
  { id: 'chain', pos: [14, 1.2, 39.4], text: 'The fire exit was chained. From the outside.', label: 'Chained exit' },
  { id: 'watch', pos: [-14.5, 0.08, 34], text: 'Dad\'s watch… stopped at 20:20.', label: 'Burnt watch', last: true },
];

export function playMission3() {
  return runMission({
    number: 3,
    assets: ASSETS,
    parTime: 480,
    create: (assets, ctx) => createOnFootWorld(game.renderer, assets, {
      spawn: [0, 0, -14],
      yaw: 0,
      fog: 0.025,
      rain: false,
      echo: (p) => (p.z > 0 && p.z < 40 && Math.abs(p.x) < 20 ? CONFIG.weapons.echo : null),
      loadout: ['pistol', 'rifle'],
      onExit: ctx.onExit,
      build: (kit) => buildLevel(kit, ctx),
    }),
    intro: introScript,
    outro: outroScript,
  });
}

/** Text on a small canvas plane (blueprint, card). */
function notePlane(kit, w, h, draw) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round((256 * h) / w);
  draw(c.getContext('2d'), c.width, c.height);
  const t = kit.track(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(kit.track(new THREE.PlaneGeometry(w, h)), kit.track(new THREE.MeshStandardMaterial({ map: t, roughness: 1 })));
  m.rotation.x = -Math.PI / 2;
  return m;
}

function buildLevel(kit, ctx) {
  const { scene, mats, addBox, addProp, addLamp, addCover, ai, player, fire, assets } = kit;
  const charred = kit.track(repeatMaterial(assets.get('textures.charred'), 3, 2, 0x141110));
  const wood = kit.track(repeatMaterial(assets.get('textures.burnt_wood'), 2, 1, 0x2a211c));

  // ---- the factory hall: 40 × 40, blackened walls, gate at the front, side exit right ----
  addBox([17, 10, 1], [-11.5, 5, 0], charred);
  addBox([17, 10, 1], [11.5, 5, 0], charred);
  addBox([41, 10, 1], [0, 5, 40], charred);
  addBox([1, 10, 41], [-20.5, 5, 20], charred);
  addBox([1, 10, 12], [20.5, 5, 6], charred);
  addBox([1, 10, 23], [20.5, 5, 28.5], charred);      // side exit gap at z 12…17
  addBox([1, 4, 6], [-3.5, 2, -6], charred);           // the gateposts outside
  addBox([1, 4, 6], [3.5, 2, -6], charred);
  for (const x of [-12, -4, 4, 12]) for (const z of [8, 18, 28]) addBox([0.8, 10, 0.8], [x, 5, z], charred, { surface: 'concrete' });
  for (let z = 4; z < 40; z += 6) addBox([40, 0.4, 0.5], [0, 9.6, z], charred, { cast: false, collide: false }); // roof beams, sky between
  const machines = [[-8, 12], [8, 22], [-8, 30], [0, 20], [12, 32]];
  machines.forEach(([x, z]) => addBox([3, 2, 2], [x, 1, z], mats.metal, { surface: 'metal' }));
  // office (back left), door gap at x −15 … −13 on its front wall
  addBox([3, 3, 0.3], [-18.5, 1.5, 32], wood);
  addBox([4, 3, 0.3], [-10, 1.5, 32], wood);
  addBox([0.3, 3, 8], [-12, 1.5, 36], wood);
  addBox([2.4, 0.9, 1], [-16, 0.45, 36], wood, { surface: 'wood' }); // desk
  // crates (cover, fuel for the fire)
  [[14, 6], [15, 7.2], [-15, 14], [-14, 22], [6, 36], [16, 24]].forEach(([x, z], i) => addProp('props.crate', [x, 0, z], i * 0.4, { surface: 'wood' }));
  // cover points around machines + crates
  machines.forEach(([x, z]) => { addCover([x, 0, z - 1.6], false); addCover([x, 0, z + 1.6], false); addCover([x - 2.1, 0, z], false); addCover([x + 2.1, 0, z], false); });
  // flammables: crates, machines' oil, the office
  [[14, 0.4, 6], [15, 0.4, 7.2], [-15, 0.4, 14], [-14, 0.4, 22], [6, 0.4, 36], [16, 0.4, 24], [-16, 0.6, 36], [-10, 1, 32], [0, 1, 20], [8, 1, 22], [-8, 1, 12], [-8, 1, 30]].forEach((p) => kit.addFlammable(p, 1.1));
  // light: moonlight through the roof, a few work lamps
  addLamp([-19.6, 0, 10], { rotY: Math.PI / 2, intensity: 16, reach: 9 });
  addLamp([19.6, 0, 30], { rotY: -Math.PI / 2, intensity: 16, reach: 9 });
  addLamp([0, 0, 39.4], { rotY: Math.PI, intensity: 16, reach: 9 });
  addLamp([-2.5, 0, -8], { rotY: 0, intensity: 24, reach: 10 });
  kit.addFragment([-18.5, 0, 4], 'Dad lifting me onto the workbench: "Hold this. Gently."');

  // ---- clues --------------------------------------------------------------------------------------------
  const clueGeo = kit.track(new THREE.OctahedronGeometry(0.12, 0));
  const objs = {};
  objs.fuel = addProp('props.barrel', [10, 0, 9], 0, { surface: 'metal' });
  objs.blueprint = notePlane(kit, 0.9, 0.6, (x, w, h) => {
    x.fillStyle = '#20334a'; x.fillRect(0, 0, w, h);
    x.strokeStyle = '#9ec3e8'; x.lineWidth = 2;
    x.beginPath(); x.arc(w * 0.45, h * 0.5, h * 0.3, 0, Math.PI * 2); x.stroke();
    x.beginPath(); x.arc(w * 0.45, h * 0.5, h * 0.12, 0, Math.PI * 2); x.stroke();
    x.font = '700 14px monospace'; x.fillStyle = '#9ec3e8'; x.fillText('MAG-DRIVE v3 · E. RAYNE', 10, 20);
    const g = x.createRadialGradient(w, h, 0, w, h, w * 0.8); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
  objs.blueprint.position.set(0, 2.02, 20);
  scene.add(objs.blueprint);
  objs.card = notePlane(kit, 0.12, 0.07, (x, w, h) => {
    x.fillStyle = '#eee9dc'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#111'; x.font = '700 26px Georgia'; x.fillText('HALE INDUSTRIES', 12, 50);
    x.font = '20px Georgia'; x.fillText('Victor Hale · Partner', 12, 90);
  });
  objs.card.position.set(-16, 0.91, 36);
  scene.add(objs.card);
  objs.chain = addBox([1.6, 2.4, 0.15], [14, 1.2, 39.4], mats.metal, { surface: 'metal' });
  objs.watch = addProp('props.burnt_watch', [-14.5, 0.02, 34], 0.4, { collide: false });

  const found = new Set();
  let scanning = false;
  const clues = CLUES.map((c) => {
    const marker = new THREE.Mesh(clueGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.6, 0.3), depthTest: false, transparent: true, opacity: 0 }));
    marker.renderOrder = 20;
    marker.position.set(c.pos[0], c.pos[1] + 0.9, c.pos[2]);
    scene.add(marker);
    const item = { ...c, marker, revealed: false };
    item.off = kit.addInteractable({
      position: new THREE.Vector3(...c.pos),
      prompt: `Examine · ${c.label}`,
      height: 0.6,
      enabled: false,
      onInteract: async () => {
        if (found.has(c.id)) return;
        found.add(c.id);
        audio.sfx('scifi_beep', { volume: 0.6 });
        subtitles.show('kael', c.text, 4.5);
        objectives.progress('Clues', found.size, CLUES.length);
        marker.visible = false;
        player.interactables.find((it) => it.prompt === `Examine · ${c.label}`).enabled = false;
        if (found.size === CLUES.length - 1) setTimeout(() => objectives.hint('Something glints in the office. [G] scan', 6), 4800);
        if (found.size === CLUES.length) setTimeout(ambush, 4800);
      },
    });
    return item;
  });

  dressAmbient(kit);

  // ---- enemies: a light patrol (stealth) ------------------------------------------------------------------
  ai.spawn({ position: [-6, 0, 16], yaw: 0, patrol: [[-6, 0, 16], [-6, 0, 26], [6, 0, 26], [6, 0, 16]] });
  ai.spawn({ position: [10, 0, 30], yaw: Math.PI, patrol: [[10, 0, 30], [16, 0, 16]] });
  ai.spawn({ position: [-16, 0, 26], yaw: Math.PI / 2, patrol: [] });

  // ---- the ambush + the fire --------------------------------------------------------------------------------
  let burning = false;
  function ambush() {
    burning = true;
    objectives.set('Get out — the factory is burning');
    objectives.hint('Side exit → right wall. [Hold R] to ⏳ rewind a bad move', 6);
    subtitles.show('kael', 'Footsteps. They followed me in.', 2.5);
    audio.playMusic('combat', 1.5);
    kit.setCheckpoint([-14, 0, 30], Math.PI);
    const victims = () => [{ position: player.position, hurt: (n) => player.hurt(n) }];
    // a firebomb through the gate, then the place goes up
    explode(new THREE.Vector3(0, 0.5, 6), { radius: 4, damage: 40, fx: kit.fx, rig: kit.rig, scene, victims: victims(), echo: CONFIG.weapons.echo });
    [[-8, 0.4, 12], [8, 0.4, 22], [0, 0.4, 20], [14, 0.4, 6]].forEach((p, i) => setTimeout(() => fire.ignite(new THREE.Vector3(...p)), 600 + i * 900));
    [[0, 0, 2], [-3, 0, 3], [3, 0, 3], [16, 0, 15]].forEach((p, i) => setTimeout(() => {
      const e = ai.spawn({ position: p, yaw: Math.PI, patrol: [] });
      e.alert(player.position);
    }, 1200 + i * 700));
  }

  // exit trigger
  const exit = new THREE.Vector3(23.5, 0, 14.5);
  let left = false;
  let scanSound = null;
  let scanUntil = 0;
  return {
    found,
    start() {
      objectives.set('Search the burnt factory');
      objectives.progress('Clues', 0, CLUES.length);
      objectives.hint('[G] scan — clues glow orange. [F] examine', 7);
    },
    update(dt) {
      // 🔥 scan mode: a tap sends a few-second scan pulse, holding keeps it on
      if (input.wasPressed('KeyG')) scanUntil = performance.now() + CONFIG.mission3.scanSeconds * 1000;
      const want = (input.isDown('KeyG') || performance.now() < scanUntil) && !player.locked;
      if (want !== scanning) {
        scanning = want;
        game.postfx.setMood(scanning ? 'SCAN' : 'NEUTRAL', 0.25);
        if (scanning) scanSound = audio.sfx('ui_glitch', { volume: 0.25, rate: 0.6 });
        else if (scanSound != null) scanSound = null;
      }
      const t = performance.now() / 1000;
      for (const c of clues) {
        if (found.has(c.id)) continue;
        const locked = c.last && found.size < CLUES.length - 1;
        const d = c.marker.position.distanceTo(player.position);
        const show = scanning && !locked && d < CONFIG.mission3.scanRange;
        c.marker.material.opacity += ((show ? 0.9 : 0) - c.marker.material.opacity) * Math.min(1, dt * 8);
        c.marker.rotation.y += dt * 2;
        c.marker.position.y = c.pos[1] + 0.9 + Math.sin(t * 2 + c.pos[0]) * 0.08;
        if (show && !c.revealed) {
          c.revealed = true;
          player.interactables.find((it) => it.prompt === `Examine · ${c.label}`).enabled = true;
        }
      }
      if (burning && !left && player.position.distanceTo(exit) < 3) {
        left = true;
        ctx.complete();
      }
    },
    dispose() {
      clues.forEach((c) => c.marker.removeFromParent());
    },
  };
}

// -----------------------------------------------------------------------------
// Ambient life (vfx/ambientLife.js): the burnt-out factory: moonlight shafts, dust, drips, pigeons in the rafters
// -----------------------------------------------------------------------------
function dressAmbient(kit) {
  const life = kit.ambient;
  // moonlight falling through the gaps between the roof beams
  life.lightShafts({
    items: [[-10, 13], [6, 7], [14, 25], [-4, 31], [-14, 19], [2, 19]].map(([x, z]) => ({ from: [x + 2.5, 14, z - 1.5], to: [x - 1.5, 0, z + 1.2], radius: 1.5 })),
    opacity: 0.045,
  });
  life.dust({ center: [0, 4.5, 20], size: [38, 9, 38], count: 700, color: 0xb8c8ff, brightness: 0.45, pointSize: 0.03, speed: 0.5 });
  life.ash({ center: [0, 5, 20], size: [38, 10, 38], count: 500, fall: 0.35, glow: 0.05 });
  // water from the fire crews still dripping off the beams
  life.drips({ edges: [4, 10, 16, 22, 28, 34].map((z, i) => [-18 + (i % 2) * 6, 9.38, z, 12 + (i % 3) * 2, 9.38, z, 9.35]), count: 180 });
  // smouldering spots: thin grey wisps + a few embers
  life.steam({ points: [[-16, 0.2, 35.5], [12, 0.15, 33], [-12, 0.15, 7], [9, 0.15, 21]], perPoint: 22, color: 0x4a4644, opacity: 0.14, height: 4, spread: 0.7, puff: 0.7, life: 5 });
  life.embers({ center: [0, 1.2, 20], size: [34, 2.4, 34], count: 160, rise: 0.6, wind: [0.15, 0, 0.05], brightness: 0.7, pointSize: 0.035 });
  // hanging chains, a broken cable still sparking
  life.chains({ points: [[-8, 9.4, 10.2, 3.6], [2, 9.4, 16, 5.2], [10, 9.4, 28, 4.2], [-14, 9.4, 22, 2.8], [14.5, 9.4, 4, 3.2]] });
  life.cables({ spans: [[4, 9.4, 4.1, 6.8, 3.4, 4.6, 0.4], [-18, 8.5, 26, -9, 9.4, 28, 1.6], [12, 9.4, 34, 18, 7.5, 39.3, 1.1]], sway: 0.05, wind: 0.6 });
  life.sparks({ points: [[6.8, 3.4, 4.6]], perPoint: 34, interval: 2.2 });
  // pigeons roosting in the rafters: the first shot sends them out through the roof
  life.birds({ perches: [[-4, 9.85, 10], [8, 9.85, 22], [-12, 9.85, 28], [4, 9.85, 34]], count: 12 });
  // the city outside (seen through the roof and the gate)
  life.skyline({ center: [0, 0, 20], radius: [85, 210], count: 90, height: [14, 70] });
}

// -----------------------------------------------------------------------------
// Cutscenes
// -----------------------------------------------------------------------------
function introScript(world) {
  const fireTmp = [];
  return {
    id: 'm3_intro',
    mood: 'NEUTRAL',
    handheld: 0.012,
    missionCard: 3,
    steps: [
      at(0, letterbox(true)),
      at(0, cam.cut([-6, 2.2, -20], [0, 3, 0])),
      at(0, fade.in(2)),
      at(0.2, cam.moveTo([4, 1.8, -16], [0, 3.5, 4], 6, 'sine.inOut')),
      at(1.5, subtitle('kael', 'Rayne Motor Works.', 2.2)),
      at(4.0, subtitle('kael', 'In my time, this place has been a ruin for thirty years. Tonight it\'s already…', 3.4)),
      // flashback: young Kael watches the flames from a car window
      at(7.6, flash('#ffffff', 0.4)),
      at(7.6, setMood('MEMORY', 0.3)),
      at(7.6, call((ctx) => {
        [[0, 2, 2], [-6, 3, 1], [6, 2.5, 1.5], [-12, 2, 2], [12, 2, 2]].forEach((p) => fireTmp.push(world.fire.ignite(new THREE.Vector3(...p), { size: 1.6, fuel: 12 })));
        ctx.camera.cut([-1.5, 1.15, -24], [0, 2.5, 0]);
        ctx.camera.fov(28, 0.01);
      })),
      at(7.7, sfx('fire_loop', { volume: 0.5, stopAfter: 6 })),
      at(8.2, subtitle('kael', '(Eight years old. In the back seat. Mum wouldn\'t let me out of the car.)', 3.6)),
      at(11.8, subtitle('kael', '(Dad was still inside.)', 2.4)),
      at(14.4, flash('#ffffff', 0.4)),
      at(14.4, setMood('NEUTRAL', 0.3)),
      at(14.4, call((ctx) => {
        fireTmp.forEach((f) => f && world.fire._remove(f));
        ctx.camera.fov(40, 0.01);
        ctx.camera.cut([2.5, 1.7, -11], [0, 1.4, 6]);
      })),
      at(14.6, subtitle('kael', 'Not this time. Somebody started that fire. Let\'s find out who.', 3.2)),
      at(17.6, letterbox(false)),
    ],
    duration: 17.8,
  };
}

function outroScript(world) {
  // the side exit: a wall section collapses behind Kael; Victor's car passes in a puddle
  const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 7), world.kit.mats.brick);
  wall.position.set(20.5, 3, 14.5);
  const carTpl = world.kit.assets.get('vehicles.car_2020_sedan');
  const car = createModelInstance(carTpl);
  car.position.set(-30, 0, 30);
  car.visible = false;
  // headlights: glowing discs (a new light mid-cutscene would recompile every shader)
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d0).multiplyScalar(4) });
  const head = { set intensity(v) { headMat.color.setScalar(v > 0 ? 4 : 0); } };
  [-0.6, 0.6].forEach((x) => {
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.14, 16), headMat);
    d.position.set(x, 0.75, 2.32);
    car.add(d);
  });
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(1.4, 32), new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.02, metalness: 1, envMapIntensity: 1.6 }));
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(27, 0.02, 15);
  return {
    id: 'm3_outro',
    mood: 'FIRE',
    handheld: 0.02,
    steps: [
      at(0, letterbox(true)),
      at(0, call(() => {
        world.scene.add(wall, car, puddle);
        world.player.respawn(new THREE.Vector3(25.5, 0, 14.5), Math.PI / 2);
      })),
      at(0, cam.cut([29, 1.3, 11], [21, 2.5, 14.5])),
      at(0.3, sfx('explosion', { volume: 0.8, rate: 0.7 })),
      at(0.4, call(() => {
        const s = { a: 0 };
        const id = setInterval(() => {
          s.a = Math.min(Math.PI / 2, s.a + 0.06);
          wall.rotation.z = -s.a;
          wall.position.x = 20.5 + Math.sin(s.a) * 3;
          wall.position.y = 3 * Math.cos(s.a) + 0.5;
          if (s.a >= Math.PI / 2) {
            clearInterval(id);
            for (let i = 0; i < 30; i++) world.fx.puffs.emit(new THREE.Vector3(23 + Math.random() * 2, 0.3, 12 + Math.random() * 5), new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3), [0.25, 0.22, 0.2], 0.6, 2, 0.3, 3);
          }
        }, 30);
      })),
      at(0.4, cam.shake(0.5, 1.2)),
      at(1.8, subtitle('kael', 'Too close.', 1.8)),
      // the puddle: Victor's car glides past, reflected
      at(3.6, cam.cut([27.4, 0.45, 13.4], [27, 0, 15.6])),
      at(3.6, setMood('NEUTRAL', 0.6)),
      at(3.8, call(() => {
        car.visible = true;
        head.intensity = 60;
        const t0 = performance.now();
        const id = setInterval(() => {
          const k = (performance.now() - t0) / 1000;
          car.position.set(-30 + k * 14, 0, 19);
          car.rotation.y = Math.PI / 2;
          if (k > 6) clearInterval(id);
        }, 30);
      })),
      at(5.6, cam.moveTo([27.2, 1.6, 12.6], [33, 1, 19], 2.2, 'sine.inOut')),
      at(6.4, subtitle('kael', 'That car. Hale\'s… He came back to watch it burn.', 3.4)),
      at(9.8, fade.out(1.2)),
      at(11.1, call(() => {
        wall.removeFromParent();
        car.removeFromParent();
        puddle.removeFromParent();
      })),
    ],
    duration: 11.2,
  };
}

// =============================================================================
// FLATLINE: 2050 — missions/ending.js
// THE ENDING (CLAUDE.md Phase 10), played after Mission 8:
//
//   1. 2050, a hospital room: Kael's eyes open. The monitor races. A nurse
//      runs in.
//   2. The Neon Velodrome, a press event: Kael limps in, plugs a drive into
//      the giant screen — the factory files and the sabotage logs, in front of
//      200,000 fans. Security takes Victor down; he sinks to his knees.
//   3. Close-up of Kael's racing glove: the clock reads 20:20… then 20:21.
//      Black. A heartbeat.
//   4. Credits roll over a slow drive through the neon city (CREDITS.md).
//   5. Post-credits: radio static. The Clockmaker: "You're not the only one
//      I've sent back."
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { preload, createModelInstance } from '../assets/loader.js';
import { LoadingScreen } from '../assets/loadingScreen.js';
import { styleKael2050 } from '../assets/modelStyles.js';
import { Actor } from '../cutscenes/actor.js';
import { cutscenes } from '../cutscenes/cutscenePlayer.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { at, cam, sfx, voice, subtitle, fade, call, setMood, letterbox, music, flash } from '../cutscenes/steps.js';
import { screenFade } from '../ui/screenFade.js';
import { parseCredits } from '../ui/credits.js';
import { RaceTrack } from '../vehicles/raceTrack.js';
import { saveGame } from '../systems/saveGame.js';
import { award } from '../ui/achievementToast.js';
import { AmbientLife } from '../vfx/ambientLife.js';
import { addVelodromeLife } from '../vfx/ambientStadium.js';

const ASSETS = [
  'env.hospital', 'characters.kael_2050', 'characters.nurse', 'characters.victor', 'characters.enemy', 'props.heart_monitor',
  'textures.asphalt', 'textures.concrete', 'hdri.stadium_2050', 'hdri.night_city_2020',
  'sfx.monitor_beep', 'sfx.heartbeat', 'sfx.crowd_cheer', 'sfx.radio_static', 'sfx.ui_glitch', 'sfx.flatline',
  'voice.end_clockmaker_01', 'music.ending', 'music.main_theme',
];

export async function playEnding() {
  const loading = new LoadingScreen();
  loading.show();
  const assets = await preload(ASSETS, (p) => loading.setProgress(p));
  const world = createEndingWorld(assets);
  game.setWorld(world);
  game.renderOnce();
  await loading.hide();
  await cutscenes.play(hospitalScript(world), { world });
  await cutscenes.play(stadiumScript(world), { world });
  await cutscenes.play(gloveScript(world), { world });
  await rollCredits(world);
  await postCredits();
  saveGame.data.gameCompleted = true;
  award('flatline');
  saveGame._write?.();
}

/** One world holds all three sets, far apart: the hospital, the stadium, the glove. */
function createEndingWorld(assets) {
  physics.clear();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060c);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.02, 2000);
  scene.add(camera);
  const env = assets.get('hdri.stadium_2050');
  if (env?.texture) {
    const pmrem = new THREE.PMREMGenerator(game.renderer);
    scene.environment = pmrem.fromEquirectangular(env.texture).texture;
    pmrem.dispose();
  }
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight(0x8090c0, 0x101018, 0.6));
  const track = [];
  const keep = (x) => (track.push(x), x);

  // ---- 1 · the hospital room (at the origin) -----------------------------------------------------------
  const room = createModelInstance(assets.get('env.hospital'));
  scene.add(room);
  const roomLight = new THREE.PointLight(0xdfe8ff, 12, 9, 2);
  roomLight.position.set(0, 2.6, 0);
  scene.add(roomLight);
  const kTpl = assets.get('characters.kael_2050');
  const kaelBed = new Actor('kael', createModelInstance(kTpl), kTpl.animations);
  styleKael2050(kaelBed.object);
  scene.add(kaelBed.object);
  // lying on the bed: tipped back
  kaelBed.object.position.set(0, 0.75, 0);
  kaelBed.object.rotation.set(-Math.PI / 2, 0, 0);
  kaelBed.play('idle', 0.01);
  const monitor = createModelInstance(assets.get('props.heart_monitor'));
  monitor.position.set(0.9, 1.05, -0.9);
  scene.add(monitor);
  const nTpl = assets.get('characters.nurse');
  const nurse = new Actor('nurse', createModelInstance(nTpl), nTpl.animations);
  scene.add(nurse.object);
  nurse.place([2.6, 0, 2.4], -Math.PI * 0.75);
  nurse.play('idle', 0.01);
  nurse.object.visible = false;

  // ---- 2 · the Neon Velodrome (offset 0, 0, 0 — the track is huge, the hospital sits inside its infield far below) ----
  const S = new THREE.Vector3(0, -200, 0); // the stadium lives 200 m below the hospital set
  const stadium = new THREE.Group();
  stadium.position.copy(S);
  scene.add(stadium);
  const trackScene = new THREE.Group();
  stadium.add(trackScene);
  const raceTrack = new RaceTrack(trackScene, { asphalt: assets.get('textures.asphalt'), concrete: assets.get('textures.concrete') });
  const start = raceTrack.sampleAt(0);
  // the stadium is alive: crowd, drone show, searchlights, fireworks, holo screens
  const ambient = new AmbientLife(scene, { parent: trackScene });
  const stadiumLife = addVelodromeLife(ambient, raceTrack, { parent: trackScene });
  stadiumLife.hype = 0.85;
  const stagePos = start.position.clone().addScaledVector(start.normal, -12);
  const stageW = S.clone().add(stagePos);
  // the giant screen
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 1024;
  screenCanvas.height = 512;
  const sctx = screenCanvas.getContext('2d');
  const screenTex = keep(new THREE.CanvasTexture(screenCanvas));
  screenTex.colorSpace = THREE.SRGBColorSpace;
  const drawScreen = (mode) => {
    sctx.fillStyle = mode === 'files' ? '#0b0606' : '#04060c';
    sctx.fillRect(0, 0, 1024, 512);
    if (mode === 'files') {
      sctx.fillStyle = '#ff3a4a';
      sctx.font = '700 46px Rajdhani, sans-serif';
      sctx.fillText('RAYNE MOTOR WORKS · 20.10.2020', 40, 70);
      sctx.fillStyle = '#e8e2d0';
      sctx.font = '30px monospace';
      ['FIRE EXIT: CHAINED FROM OUTSIDE', 'ACCELERANT: GASOLINE (4 CANS)', 'BUYER OF RECORD: V. HALE', 'MAG-DRIVE PATENT → HALE INDUSTRIES', '— 2050 —', 'CAR #20 TELEMETRY: OVERRIDE "20.20.20"', 'BRAKE LINES: REMOTE KILL · AUTH: HALE'].forEach((l, i) => sctx.fillText(l, 60, 140 + i * 50));
    } else {
      sctx.fillStyle = '#3fa9ff';
      sctx.font = '700 120px Rajdhani, sans-serif';
      sctx.fillText('HALE INDUSTRIES', 60, 220);
      sctx.font = '48px Rajdhani, sans-serif';
      sctx.fillText('PRESS CONFERENCE · NEON VELODROME', 70, 320);
    }
    screenTex.needsUpdate = true;
  };
  drawScreen('press');
  const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(24, 12)), keep(new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false })));
  screen.position.copy(stagePos).addScaledVector(start.normal, -10).setY(9);
  screen.lookAt(stagePos.clone().setY(9));
  stadium.add(screen);
  const stage = new THREE.Mesh(keep(new THREE.BoxGeometry(12, 1, 6)), keep(new THREE.MeshStandardMaterial({ color: 0x15161c, metalness: 0.6, roughness: 0.4 })));
  stage.position.copy(stagePos).setY(0.5);
  stadium.add(stage);
  const spot = new THREE.SpotLight(0xffffff, 120, 40, 0.5, 0.4, 1);
  spot.position.copy(stagePos).add(new THREE.Vector3(0, 14, 0)).addScaledVector(start.normal, 8);
  spot.target.position.copy(stagePos).setY(1);
  stadium.add(spot, spot.target);
  const vTpl = assets.get('characters.victor');
  const victor = new Actor('victor', createModelInstance(vTpl), vTpl.animations);
  victor.object.traverse((o) => {
    if (o.isMesh) {
      o.material = o.material.clone();
      o.material.color?.lerp(new THREE.Color(0xf2f2f2), 0.7); // the white suit, 2050
    }
  });
  stadium.add(victor.object);
  victor.place(stagePos.clone().setY(1), Math.atan2(start.normal.x, start.normal.z));
  victor.play('idle', 0.01);
  const kaelStadium = new Actor('kaelS', createModelInstance(kTpl), kTpl.animations);
  styleKael2050(kaelStadium.object);
  stadium.add(kaelStadium.object);
  kaelStadium.object.visible = false;
  const eTpl = assets.get('characters.enemy');
  const guards = [0, 1].map((i) => {
    const g = new Actor('guard', createModelInstance(eTpl), eTpl.animations);
    g.object.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.color?.lerp(new THREE.Color(0xe8eef8), 0.6); // 2050 security in white
      }
    });
    stadium.add(g.object);
    g.place(stagePos.clone().addScaledVector(start.tangent, (i ? 1 : -1) * 9).setY(0), 0);
    g.play('idle_gun', 0.01);
    return g;
  });

  // ---- 3 · the glove (a tiny set far away) ---------------------------------------------------------------------
  const G = new THREE.Vector3(0, 300, 0);
  const glove = new THREE.Mesh(keep(new THREE.BoxGeometry(0.11, 0.05, 0.2)), keep(new THREE.MeshStandardMaterial({ color: 0xe9eaee, roughness: 0.5 })));
  glove.position.copy(G);
  scene.add(glove);
  const clockCanvas = document.createElement('canvas');
  clockCanvas.width = 256;
  clockCanvas.height = 96;
  const cctx = clockCanvas.getContext('2d');
  const clockTex = keep(new THREE.CanvasTexture(clockCanvas));
  const drawClock = (t) => {
    cctx.fillStyle = '#05070c';
    cctx.fillRect(0, 0, 256, 96);
    cctx.fillStyle = '#3fa9ff';
    cctx.font = '700 72px Rajdhani, monospace';
    cctx.textAlign = 'center';
    cctx.fillText(t, 128, 74);
    clockTex.needsUpdate = true;
  };
  drawClock('20:20');
  const clock = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.09, 0.034)), keep(new THREE.MeshBasicMaterial({ map: clockTex, toneMapped: false })));
  clock.position.copy(G).add(new THREE.Vector3(0, 0.026, 0.02));
  clock.rotation.x = -Math.PI / 2;
  scene.add(clock);
  const gloveLight = new THREE.PointLight(0x9fd8ff, 2, 1.2, 2);
  gloveLight.position.copy(G).add(new THREE.Vector3(0.2, 0.3, -0.2));
  scene.add(gloveLight);

  const actors = [kaelBed, nurse, victor, kaelStadium, ...guards];
  return {
    scene, camera,
    assets,
    sets: { S, stagePos: stageW, start, G },
    kaelBed, nurse, victor, kaelStadium, guards, drawScreen, drawClock,
    update(dt) {
      actors.forEach((a) => a.update(dt));
      raceTrack.update?.(performance.now() / 1000);
      ambient.update(dt, { camera: game.activeCamera ?? camera });
    },
    applyGraphics() {
      ambient.setQuality(game.quality);
    },
    dispose() {
      ambient.dispose();
      raceTrack.dispose?.();
      track.forEach((d) => d.dispose?.());
    },
  };
}

function hospitalScript(world) {
  const { kaelBed, nurse } = world;
  return {
    id: 'end_hospital',
    mood: 'NEUTRAL',
    handheld: 0.008,
    steps: [
      at(0, letterbox(true)),
      at(0, music('ending', 4)),
      // his eyes open: blurred ceiling, then focus
      at(0, cam.cut([0, 1.55, 0.05], [0, 3, 0.3])),
      at(0, cam.fov(70, 0.01)),
      at(0.4, sfx('monitor_beep', { volume: 0.7, rate: 0.9 })),
      at(1.6, sfx('monitor_beep', { volume: 0.7 })),
      at(2.0, fade.in(3)),
      at(2.6, sfx('monitor_beep', { volume: 0.75, rate: 1.05 })),
      at(3.2, sfx('monitor_beep', { volume: 0.8, rate: 1.15 })),
      at(3.6, sfx('monitor_beep', { volume: 0.85, rate: 1.25 })),
      at(3.9, sfx('monitor_beep', { volume: 0.9, rate: 1.4 })),
      at(4.1, sfx('monitor_beep', { volume: 0.95, rate: 1.5 })),
      at(4.3, sfx('monitor_beep', { volume: 1, rate: 1.6 })),
      at(4.0, subtitle('kael', '…', 1.2)),
      at(5.2, cam.fov(40, 1.5)),
      at(5.2, cam.cut([1.8, 1.6, 2.2], [0, 0.9, 0])),
      at(5.6, call(() => {
        nurse.object.visible = true;
        nurse.moveTo([0.9, 0, 0.9], 3.2, { arriveAnim: 'idle', anim: 'run' });
      })),
      at(6.0, subtitle('nurse', 'Doctor! DOCTOR! He\'s awake — Rayne\'s awake!', 2.8)),
      at(8.8, subtitle('kael', 'What… what day is it?', 2.2)),
      at(11.0, subtitle('nurse', 'You\'ve been in a coma for six weeks.', 2.6)),
      at(13.6, subtitle('kael', 'Six weeks. And a lifetime.', 2.6)),
      at(16.2, fade.out(1.2)),
    ],
    duration: 17.4,
  };
}

function stadiumScript(world) {
  const { victor, kaelStadium, guards, drawScreen, sets } = world;
  const sp = sets.stagePos;
  const n = sets.start.normal;
  const t = sets.start.tangent;
  const kStart = sp.clone().addScaledVector(t, -14).addScaledVector(n, 6);
  return {
    id: 'end_stadium',
    mood: 'NEUTRAL',
    handheld: 0.012,
    steps: [
      at(0, call(() => {
        kaelStadium.object.visible = true;
        kaelStadium.place(kStart.clone().sub(sets.S).setY(0), Math.atan2(t.x, t.z));
      })),
      at(0, cam.cut(sp.clone().addScaledVector(n, 26).add(new THREE.Vector3(0, 8, 0)).toArray(), sp.clone().add(new THREE.Vector3(0, 6, 0)).toArray())),
      at(0, fade.in(1.6)),
      at(0.2, sfx('crowd_cheer', { volume: 0.6 })),
      at(1.0, subtitle('commentator', '…and Hale Industries\' chairman takes the stage—', 2.6)),
      // Kael limps in
      at(3.4, cam.cut(kStart.clone().addScaledVector(n, 4).add(new THREE.Vector3(0, 1.4, 0)).toArray(), kStart.clone().add(new THREE.Vector3(0, 1.2, 0)).toArray())),
      at(3.4, call(() => kaelStadium.moveTo(sp.clone().addScaledVector(t, -4).sub(sets.S).setY(0), 0.8, { arriveAnim: 'idle' }))),
      at(4.0, subtitle('commentator', 'Wait — is that… Kael Rayne?!', 2.2)),
      at(6.8, subtitle('victor', 'Kael. You should be in a hospital bed.', 2.6)),
      at(9.6, subtitle('kael', 'I was. I had a lot of time to think. Twenty years of it.', 3)),
      // the drive goes in
      at(12.8, sfx('ui_glitch', { volume: 0.8 })),
      at(12.8, call(() => drawScreen('files'))),
      at(12.8, flash('#ff3a4a', 0.4)),
      at(13.0, cam.cut(sp.clone().addScaledVector(n, 18).add(new THREE.Vector3(0, 4, 0)).toArray(), sp.clone().addScaledVector(n, -10).add(new THREE.Vector3(0, 9, 0)).toArray())),
      at(13.4, subtitle('commentator', 'The screen — those are fire reports. Sabotage logs. Car twenty\'s brakes…', 3.4)),
      at(16.4, sfx('crowd_cheer', { volume: 0.5, rate: 0.7 })),
      at(17.0, cam.cut(sp.clone().addScaledVector(n, 5).add(new THREE.Vector3(0, 1.7, 0)).toArray(), sp.clone().add(new THREE.Vector3(0, 1.6, 0)).toArray())),
      at(17.2, subtitle('victor', 'Turn it off. TURN IT OFF!', 2.2)),
      at(17.6, call(() => guards.forEach((g) => g.moveTo(sp.clone().addScaledVector(t, guards.indexOf(g) ? 1 : -1).sub(sets.S).setY(1), 3, { arriveAnim: 'idle_gun_pointing' })))),
      // Victor sinks to his knees
      at(19.8, call(() => {
        gsap.to(victor.object.position, { y: 0.55, duration: 1.2, ease: 'power2.in' });
        gsap.to(victor.object.rotation, { x: 0.25, duration: 1.2 });
      })),
      at(20.2, subtitle('kael', 'For my father. For Elias Rayne.', 2.8)),
      at(23.4, fade.out(1)),
    ],
    duration: 24.5,
  };
}

function gloveScript(world) {
  const G = world.sets.G;
  return {
    id: 'end_glove',
    mood: 'NEUTRAL',
    handheld: 0.003,
    letterbox: true,
    steps: [
      at(0, cam.cut([G.x + 0.06, G.y + 0.16, G.z - 0.14], [G.x, G.y + 0.02, G.z + 0.02])),
      at(0, fade.in(1.4)),
      at(1.8, subtitle('kael', '20:20.', 1.6)),
      at(3.6, call(() => world.drawClock('20:21'))),
      at(3.6, sfx('ui_glitch', { volume: 0.4 })),
      at(4.4, subtitle('kael', '…and it keeps going.', 2.4)),
      at(7.2, fade.out(0.8)),
      at(8.2, sfx('heartbeat', { volume: 1 })),
    ],
    duration: 9.6,
  };
}

/** Credits roll over a slow drive through the night city. */
async function rollCredits(world) {
  const { camera } = world;
  game.setCameraOverride(null);
  const roll = document.createElement('div');
  roll.className = 'end-credits';
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  roll.innerHTML = `<div class="end-credits-inner">
      <h1>FLATLINE <span>2050</span></h1>
      <div class="ec-block"><div class="ec-k">A game by</div><div class="ec-v">${esc(CONFIG.game.author)}</div></div>
      ${parseCredits().map((s) => `<div class="ec-block"><div class="ec-k">${esc(s.section)}</div>${s.items.map((i) => `<div class="ec-v">${esc(i.title)}<small>${esc([i.author, i.license].filter(Boolean).join(' · '))}</small></div>`).join('')}</div>`).join('')}
      <div class="ec-block ec-end">He crashed in the future.<br>He woke up in the past.<br>He found his way back.</div>
    </div>`;
  document.getElementById('ui-root').appendChild(roll);
  // the camera drifts along the stadium's neon in the dark
  const S = world.sets.S;
  const start = world.sets.start;
  const p0 = S.clone().add(start.position).add(new THREE.Vector3(0, 6, 0));
  camera.position.copy(p0);
  audio.playMusic('main_theme', 3);
  await screenFade.fromBlack(1.5);
  const inner = roll.querySelector('.end-credits-inner');
  const h = inner.scrollHeight + window.innerHeight;
  const duration = Math.max(40, h / 60);
  const st = { y: window.innerHeight, k: 0 };
  await new Promise((resolve) => {
    let skip = false;
    const onKey = (e) => {
      if (e.code === 'Escape' || e.code === 'Enter') skip = true;
    };
    window.addEventListener('keydown', onKey);
    const tw = gsap.to(st, {
      y: -inner.scrollHeight, k: 1, duration, ease: 'none',
      onUpdate: () => {
        inner.style.transform = `translateY(${st.y}px)`;
        const s = world.sets.start;
        camera.position.copy(p0).addScaledVector(s.tangent, st.k * 220).addScaledVector(s.normal, Math.sin(st.k * 6) * 4);
        camera.lookAt(camera.position.clone().addScaledVector(s.tangent, 30).add(new THREE.Vector3(0, -2, 0)));
        if (skip) tw.progress(1);
      },
      onComplete: () => {
        window.removeEventListener('keydown', onKey);
        resolve();
      },
    });
  });
  audio.stopMusic(2);
  await screenFade.toBlack(1.5);
  roll.remove();
}

async function postCredits() {
  await new Promise((r) => setTimeout(r, 1200));
  audio.sfx('radio_static', { volume: 0.8 });
  await new Promise((r) => setTimeout(r, 900));
  audio.play('voice', 'end_clockmaker_01');
  subtitles.show('clockmaker', 'You\'re not the only one I\'ve sent back.', 4.5);
  await new Promise((r) => setTimeout(r, 5200));
  audio.sfx('ui_glitch', { volume: 0.5 });
  await new Promise((r) => setTimeout(r, 800));
}

void voice;
void setMood;

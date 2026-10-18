// =============================================================================
// FLATLINE: 2050 — missions/m1_lastLap.js
// MISSION 1 · LAST LAP (2050 · ⏳ TIME) — CLAUDE.md Phase 4.
//
//   intro A (drone, cockpit, Victor) → mission card → intro B (start lights)
//   → the final lap (real gameplay, all three theme abilities)
//   → the scripted crash at the last corner (always)
//   → black: heart monitor slows · "KAEL RAYNE — STATUS: COMA." · rain begins
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { BatchedRenderer } from 'three.quarks';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { preload } from '../assets/loader.js';
import { PRELOAD } from '../assets/manifest.js';
import { LoadingScreen } from '../assets/loadingScreen.js';
import { createRaceScene } from '../scenes/raceScene.js';
import { cutscenes } from '../cutscenes/cutscenePlayer.js';
import { m1IntroA, m1IntroB } from '../cutscenes/scripts/m1_intro.js';
import { ScriptedCrash } from '../vehicles/crash.js';
import { HelmetHUD } from '../ui/helmetHUD.js';
import { screenFade } from '../ui/screenFade.js';
import { saveGame } from '../systems/saveGame.js';
import { createFirework } from '../vfx/crashFX.js';
import { award } from '../ui/achievementToast.js';

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const FIREWORK_COLORS = [0x3fa9ff, 0xff6a1a, 0x8a4dff, 0xffffff, 0xff2340, 0xffd400];

/**
 * Play Mission 1. Expects the screen to be black. Resolves with
 * { completed: true, led } when the epilogue has finished (screen black).
 */
export async function playMission1() {
  saveGame.startMission(1); // Continue resumes the story from here
  const loading = new LoadingScreen();
  loading.show();
  const assets = await preload([...PRELOAD.race, ...PRELOAD.mission1], (p) => loading.setProgress(p));

  let exitChoice = null;
  const world = createRaceScene(game.renderer, assets, {
    laps: 1,
    playerSlot: 3,
    mission: true,
    onExit: (choice) => (exitChoice = choice),
  });
  game.setWorld(world);
  world.hud.setVisible(false);
  const dressing = dressScene(world);
  if (world.stadium) world.stadium.hype = 0.95; // the final lap: 200,000 fans on their feet
  game.renderOnce();
  await loading.hide();

  // --- Intro --------------------------------------------------------------------------
  world.engage();
  const a = await cutscenes.play(m1IntroA(world, dressing), { world });
  void a;
  await cutscenes.play(m1IntroB(world), { world });
  world.hud.setVisible(true); // after the letterboxed start-lights shot
  audio.playMusic('race_2050', 0.8);
  world.hud.message('Final lap', 1.6, 'final');

  // --- The final lap, then the crash at the last corner --------------------------------
  const lap = world.track.length;
  const crash = new ScriptedCrash({ world, helmet: dressing.helmet, triggerProgress: lap - (lap - world.track.lastCornerS) });
  const off = game.onFrame(() => crash.update());
  await new Promise((resolve) => {
    const tick = () => (crash.done || exitChoice ? resolve() : setTimeout(tick, 100));
    tick();
  });
  off();
  if (exitChoice) {
    // Player left from the pause dialog
    audio.stopMusic(0.6);
    await screenFade.toBlack(0.6);
    crash.dispose();
    dressing.dispose();
    return { completed: false };
  }
  const { led } = await crash.done;
  audio.stopMusic(0.2);

  // --- Epilogue on black -----------------------------------------------------------------
  await screenFade.toBlack(0.01);
  world.hud.setVisible(false);
  dressing.helmet.destroy();
  for (const [delay, rate, vol] of [[0.2, 1, 1], [0.95, 0.95, 0.9], [1.25, 0.9, 0.8], [1.6, 0.85, 0.7], [2.2, 0.8, 0.6]]) {
    await wait(delay);
    audio.sfx('monitor_beep', { volume: vol, rate });
  }
  screenFade.setText('', 'KAEL RAYNE', 'Status: coma');
  await wait(2.6);
  const rain = audio.sfx('rain_heavy', { volume: 0 });
  audio.set('sfx', 'rain_heavy', rain, { volume: 0 });
  gsap.to({ v: 0 }, { v: 0.8, duration: 3, onUpdate() { audio.set('sfx', 'rain_heavy', rain, { volume: this.targets()[0].v }); } });
  await wait(3.2);
  screenFade.setText('Mission 01 complete', 'LAST LAP', led ? 'Achievement · Undefeated — you led before the crash' : 'Lead the race before the last corner for “Undefeated”');
  saveGame.completeMission(1);
  if (led) award('undefeated');
  await wait(3.4);
  audio.stop('sfx', 'rain_heavy', rain, 1.5);
  crash.dispose();
  dressing.dispose();
  return { completed: true, led };
}

// -----------------------------------------------------------------------------
// Scene dressing for the intro: VIP box, fireworks, helmet HUD, name tag
// -----------------------------------------------------------------------------
function dressScene(world) {
  const { scene, track } = world;
  const disposables = [];
  const helmet = new HelmetHUD();

  // VIP box: a glass pod above the main grandstand (left of the start straight)
  const f = track.sampleAt(40);
  const off = track.width / 2 + 46;
  const boxPos = f.position.clone().addScaledVector(f.normal, off).setY(19);
  const facing = Math.atan2(-f.normal.x, -f.normal.z); // looks back at the track
  const box = new THREE.Group();
  box.position.copy(boxPos);
  box.rotation.y = facing;
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1020, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.35 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x15161c, metalness: 0.8, roughness: 0.3 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.3, 5), frame);
  const back = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 0.2), frame);
  back.position.set(0, 1.7, -2.4);
  const front = new THREE.Mesh(new THREE.BoxGeometry(8, 3.2, 0.06), glass);
  front.position.set(0, 1.75, 2.45);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.25, 5.2), frame);
  roof.position.y = 3.45;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xd4af37).multiplyScalar(2) }));
  strip.position.set(0, 3.3, 2.5);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 19, 10), frame);
  pillar.position.y = -9.5;
  box.add(floor, back, front, roof, strip, pillar);
  const warm = new THREE.PointLight(0xffc890, 14, 9, 2);
  warm.position.set(0, 2.8, 0.5);
  box.add(warm);
  scene.add(box);
  [floor, back, front, roof, strip, pillar].forEach((m) => disposables.push(m.geometry));
  disposables.push(glass, frame, strip.material);

  // Victor stands at the glass with a tablet
  const local = (x, y, z) => box.localToWorld(new THREE.Vector3(x, y, z));
  box.updateMatrixWorld(true);
  const victorPosition = local(0.4, 0.15, 1.2);
  const tabletCanvas = document.createElement('canvas');
  tabletCanvas.width = 256;
  tabletCanvas.height = 160;
  const tctx = tabletCanvas.getContext('2d');
  const drawTablet = (alarm) => {
    tctx.fillStyle = '#06080e';
    tctx.fillRect(0, 0, 256, 160);
    tctx.font = '600 18px Rajdhani, sans-serif';
    tctx.fillStyle = '#7fa8d9';
    tctx.fillText('CAR #20 · TELEMETRY', 14, 28);
    tctx.fillText('BRAKE SYS ....... OK', 14, 58);
    tctx.fillStyle = alarm ? '#ff2a3a' : '#7fa8d9';
    tctx.fillText(alarm ? 'OVERRIDE ARMED' : 'STEERING ....... OK', 14, 86);
    tctx.font = '700 34px Rajdhani, sans-serif';
    tctx.fillStyle = alarm ? '#ff2a3a' : '#3fa9ff';
    tctx.fillText(alarm ? '20.20.20' : 'LAP 50', 14, 136);
    tabletTex.needsUpdate = true;
  };
  const tabletTex = new THREE.CanvasTexture(tabletCanvas);
  tabletTex.colorSpace = THREE.SRGBColorSpace;
  const tablet = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshBasicMaterial({ map: tabletTex, toneMapped: false }));
  tablet.position.copy(local(0.4, 1.2, 1.55));
  tablet.rotation.set(-0.6, facing + Math.PI, 0);
  scene.add(tablet);
  disposables.push(tablet.geometry, tablet.material, tabletTex);
  drawTablet(false);

  const vip = {
    victorPosition,
    victorYaw: facing + Math.PI,
    tabletLook: tablet.position.clone(),
    faceLook: victorPosition.clone().setY(victorPosition.y + 1.62),
    trackLook: f.position.clone(),
    shotA: local(-0.6, 1.35, 2.15),   // over the shoulder, onto the tablet
    shotB: local(1.6, 1.7, 2.3),      // turning toward his face
  };

  // Fireworks: a small pool of shells over the stands
  const batch = new BatchedRenderer();
  scene.add(batch);
  const shells = FIREWORK_COLORS.map((c) => {
    const fw = createFirework(new THREE.Color(c));
    fw.systems.forEach((s) => {
      scene.add(s.emitter);
      batch.addSystem(s);
    });
    return fw;
  });
  let next = 0;
  const offFrame = game.onFrame((dt) => batch.update(dt));
  const fireworks = {
    launch() {
      const fw = shells[next++ % shells.length];
      const s = Math.random() * track.length;
      const g = track.sampleAt(s);
      const side = Math.random() < 0.5 ? 1 : -1;
      const p = g.position.clone().addScaledVector(g.normal, side * (track.width / 2 + 30 + Math.random() * 40));
      p.y = 55 + Math.random() * 35;
      fw.systems.forEach((sys) => sys.emitter.position.copy(p));
      fw.burst();
    },
  };

  // Lower-third name tag
  const nameTag = (name, role) => {
    const el = document.createElement('div');
    el.className = 'name-tag';
    el.innerHTML = `<div class="name-tag-name">${name}</div><div class="name-tag-role">${role}</div>`;
    document.getElementById('ui-root').appendChild(el);
    gsap.fromTo(el, { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' });
    gsap.to(el, { opacity: 0, duration: 0.6, delay: 3.6, onComplete: () => el.remove() });
  };

  return {
    helmet,
    vip,
    fireworks,
    nameTag,
    tabletGlitch: () => {
      drawTablet(true);
      audio.sfx('ui_glitch', { volume: 0.5 });
    },
    dispose() {
      offFrame();
      batch.removeFromParent();
      box.removeFromParent();
      tablet.removeFromParent();
      disposables.forEach((d) => d.dispose?.());
      helmet.destroy?.();
    },
  };
}

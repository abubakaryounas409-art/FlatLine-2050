// =============================================================================
// FLATLINE: 2050 — runner/runnerWorld.js
// THE RUN: the world that plays the three acts. It owns the scene, the chase
// camera, Kael, the track, the powers, the heart and the ⏳ crash rewind.
// The story flow (cards, dialogue, results) lives in playRun.js.
//
//   const world = createRunnerWorld(renderer, assets)
//   await world.loadAct(0); world.setupIntro(); world.setCine([2,1,3],[0,0.5,0], 2)
//   world.startRunning()        world.on = { story, actEnd, flatline, fragment }
//   await world.playFinale({ onStep })
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { settings } from '../systems/settings.js';
import { Rain } from '../vfx/rainFX.js';
import { SpeedLines } from '../vfx/speedLines.js';
import { screenFade } from '../ui/screenFade.js';
import { RunnerHero } from './runnerHero.js';
import { RunnerEnvironment, ACT_LOOKS } from './environment.js';
import { TrackObjects, BEATS, GATE_NEEDS } from './obstacles.js';
import { buildCourse } from './course.js';
import { Abilities } from './abilities.js';
import { RunnerHUD } from './runnerHUD.js';
import { RunnerParticles, createFlames, flameMaterial, flameClock } from './runnerFX.js';

export const RUN_ASSETS = [
  'characters.kael_runner', 'characters.enemy', 'characters.elias', 'characters.victor',
  'vehicles.car_2050_rival_lite',
  'sfx.heartbeat', 'sfx.monitor_beep', 'sfx.flatline', 'sfx.clock_tick', 'sfx.reverse_whoosh', 'sfx.rain_heavy', 'sfx.thunder',
  'sfx.wind', 'sfx.crowd_cheer', 'sfx.radio_static', 'sfx.ui_click', 'sfx.ui_hover', 'sfx.ui_glitch', 'sfx.explosion', 'sfx.fire_loop',
  'sfx.boost', 'sfx.car_crash', 'sfx.glass_shatter', 'sfx.whoosh', 'sfx.shadow_step', 'sfx.siren', 'sfx.bullet_impact', 'sfx.fireworks',
];

const R = () => CONFIG.runner;
const MOOD_OF = { time: 'TIME', shadow: 'SHADOWS', fire: 'FIRE' };
const ACT_POWER = ['time', 'shadow', 'fire'];
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function overlap(a, b) {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0 && a.z0 < b.z1 && a.z1 > b.z0;
}

/** Gradient sky dome that follows the camera. */
function createSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6 + 0.25, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

export function createRunnerWorld(renderer, assets) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(R().camera.fov, window.innerWidth / window.innerHeight, 0.1, 600);
  scene.add(camera);
  scene.fog = new THREE.Fog(0x000000, 30, 170);

  // --- lights: created once, recoloured per act (never added mid-game) --------------------------------
  const hemi = new THREE.HemisphereLight(0xffffff, 0x101010, 1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(1024);
  Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 14, bottom: -6, near: 1, far: 60 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
  const heroLight = new THREE.PointLight(0xffffff, 0, 10, 2); // power glow around Kael
  scene.add(heroLight);
  const sky = createSky();
  scene.add(sky);

  // --- characters + effects ----------------------------------------------------------------------------
  const heroTpl = assets.get('characters.kael_runner');
  const hero = new RunnerHero(heroTpl, scene);
  const particles = new RunnerParticles(scene);
  const speedLines = new SpeedLines(camera);
  const rain = new Rain(scene, { count: 3000, area: 30, height: 20, speed: 24 });
  rain.lines.visible = false;
  rain.storm = false;
  const hud = new RunnerHUD();
  const abilities = new Abilities();

  // Kael's burn: flames on his back while he blazes
  const burnFlames = createFlames([{ x: 0, y: 0.6, z: -0.3, w: 1.2, h: 2.2 }, { x: -0.35, y: 0.9, z: -0.5, w: 0.8, h: 1.5 }, { x: 0.35, y: 0.9, z: -0.5, w: 0.8, h: 1.5 }], flameMaterial({ intensity: 2.8 }));
  burnFlames.visible = false;
  hero.root.add(burnFlames);
  const normalSuit = hero.suit;
  normalSuit.transparent = true; // fixed up front so the shadow form never recompiles the shader

  // Umbra: Kael's guilt, running beside him in ACT II (and blocking the fire in the finale)
  const umbra = new RunnerHero(heroTpl, scene);
  const umbraMat = new THREE.MeshStandardMaterial({ color: 0x020104, emissive: 0x1a0835, emissiveIntensity: 0.8, roughness: 1, transparent: true, opacity: 0.9 });
  umbra.model.traverse((o) => {
    if (o.isMesh) o.material = o.material === umbra.seams ? new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3.4), toneMapped: false }) : umbraMat;
  });
  umbra.setTheme('shadow', 0.6);
  umbra.root.visible = false;
  umbra.trails.forEach((t) => (t.mesh.visible = false));
  const umbraState = { active: false, offset: 4, x: -7.2 };

  // Victor on a catwalk (ACT III) and Elias at the end of the fire (finale)
  const makeNpc = (id, name) => {
    const tpl = assets.get(id);
    if (!tpl) return null;
    const obj = createModelInstance(tpl);
    const actor = new Actor(name, obj, obj.userData.animations ?? []);
    actor.play(actor.hasClip('idle') ? 'idle' : (obj.userData.animations?.[0]?.name ?? 'idle'), 0.01);
    obj.visible = false;
    scene.add(obj);
    return actor;
  };
  const victor = makeNpc('characters.victor', 'victor');
  const elias = makeNpc('characters.elias', 'elias');
  const catwalk = new THREE.Group();
  {
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a2b2f, metalness: 0.8, roughness: 0.4 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 10), steel);
    deck.position.y = -0.1;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 10), steel);
    rail.position.set(-1.4, 1.0, 0);
    catwalk.add(deck, rail);
    for (const z of [-4.5, 4.5]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4, 0.2), steel);
      leg.position.set(0, -2.1, z);
      catwalk.add(leg);
    }
    catwalk.visible = false;
    scene.add(catwalk);
  }

  // The wreck of Kael's car (intro) and the finale's corridor of fire
  const wreck = new THREE.Group();
  {
    const tpl = assets.get('vehicles.car_2050_rival_lite');
    if (tpl) {
      const car = createModelInstance(tpl);
      const box = new THREE.Box3().setFromObject(car);
      const k = 4.6 / Math.max(box.getSize(tmpV).z, 0.01);
      car.scale.multiplyScalar(k);
      car.rotation.set(0.25, 2.3, Math.PI * 0.92); // on its roof, twisted
      car.position.y = 1.0;
      // burnt: darken a copy of every material
      car.traverse((o) => {
        if (!o.isMesh || Array.isArray(o.material)) return;
        o.material = o.material.clone();
        o.material.color?.multiplyScalar(0.3);
      });
      wreck.add(car);
    }
    const spots = [];
    for (let i = 0; i < 9; i++) spots.push({ x: (Math.random() - 0.5) * 4, y: 0, z: (Math.random() - 0.5) * 3.5, w: 1.5 + Math.random() * 1.5, h: 2.5 + Math.random() * 3 });
    wreck.add(createFlames(spots, flameMaterial({ intensity: 2.4 })));
    wreck.visible = false;
    scene.add(wreck);
  }
  const finale = new THREE.Group();
  {
    const spots = [];
    const L = R().finaleLength;
    for (let z = -10; z < L + 14; z += 1.6) {
      for (const s of [-1, 1]) spots.push({ x: s * (2.2 + Math.random() * 3.5), y: 0, z, w: 2 + Math.random() * 2, h: 3 + Math.random() * 5 });
    }
    for (let i = 0; i < 26; i++) spots.push({ x: (Math.random() - 0.5) * 12, y: 0, z: L + 6 + Math.random() * 12, w: 3, h: 6 + Math.random() * 4 });
    finale.add(createFlames(spots, flameMaterial({ intensity: 2.6 })));
    finale.visible = false;
    scene.add(finale);
  }

  // the act-end portal: a ring of the next theme's light
  const portal = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.22, 12, 72), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3.5), toneMapped: false }));
  portal.position.y = 3;
  scene.add(portal);
  // ⏳ time-stop shockwave
  const shock = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 2.6, 6), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  shock.visible = false;
  scene.add(shock);

  // --- burn overlay for the finale (DOM) ----------------------------------------------------------------
  const burnEl = document.createElement('div');
  burnEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, rgba(255,250,235,0.95) 0%, rgba(255,190,110,0.85) 45%, rgba(255,90,20,0.6) 100%);opacity:0;z-index:30;mix-blend-mode:screen;';
  document.getElementById('ui-root')?.appendChild(burnEl);

  // ---------------------------------------------------------------------------------------------------------
  const world = {
    scene,
    camera,
    hero,
    umbra,
    abilities,
    hud,
    particles,
    actIndex: 0,
    mode: 'cine',
    paused: false,
    beats: R().heartbeats,
    maxBeats: R().heartbeats,
    stats: null,
    on: { story() {}, actEnd() {}, flatline() {}, fragment() {} },
    env: null,
    track: null,
    course: null,
  };
  const resetStats = () => {
    world.stats = { score: 0, shards: 0, closeCalls: 0, crashes: 0, rewinds: 0, fragments: 0, time: 0, distance: 0, powersUsed: abilities.uses };
  };
  resetStats();

  // runtime state
  const S = {
    actTime: 0,          // seconds running in this act
    beatT: 0,
    invuln: 0,
    streak: 0,
    lastLaneChange: 9,
    fromLane: 1,
    history: [],         // ⏳ rewind buffer
    runClock: 0,
    crash: null,         // { t, killer }
    rewind: null,        // { t, from, to }
    trauma: 0,
    camPos: new THREE.Vector3(0, 3, -6),
    camLook: new THREE.Vector3(0, 1.4, 8),
    fov: R().camera.fov,
    storyI: 0,
    promptI: 0,
    promptT: 0,
    promptAbility: null,
    shardI: 0,
    stepT: 0,
    padX: 0,
    padY: 0,
    cine: null,          // { pos: Vector3, look: Vector3 } relative to Kael
    cam: R().camera,
    walk: null,
  };
  const diff = () => R().difficulty[settings.get('difficulty')] ?? R().difficulty.normal;

  // ---------------------------------------------------------------------------------------------------------
  // Acts
  // ---------------------------------------------------------------------------------------------------------
  world.loadAct = async (i) => {
    world.actIndex = i;
    const act = R().acts[i];
    world.env?.dispose();
    world.track?.dispose();
    const course = buildCourse(i);
    world.course = course;
    world.env = new RunnerEnvironment(scene, act.id, 3 + i);
    world.track = new TrackObjects(scene, assets, act.id, course, particles);
    // look
    const L = ACT_LOOKS[act.id];
    scene.fog.color.setHex(L.fog);
    scene.fog.near = L.fogNear;
    scene.fog.far = L.fogFar;
    sky.material.uniforms.top.value.setHex(L.skyTop);
    sky.material.uniforms.bottom.value.setHex(L.skyBottom);
    hemi.color.setHex(L.hemiSky);
    hemi.groundColor.setHex(L.hemiGround);
    hemi.intensity = L.hemi;
    sun.color.setHex(L.sun);
    sun.intensity = L.sunI;
    game.postfx?.setMood('NEUTRAL', 0.2);
    rain.lines.visible = act.id === 'shadows';
    rain.storm = act.id === 'shadows';
    const nextColor = [[0.6, 0.36, 1.0], [1.0, 0.42, 0.1], [3, 3, 3]][i];
    portal.material.color.setRGB(nextColor[0] * 4, nextColor[1] * 4, nextColor[2] * 4);
    portal.position.z = act.length;
    portal.visible = true;
    // Kael + powers
    hero.reset(0, 1);
    hero.speed = 0;
    for (let k = 0; k <= i; k++) if (!abilities.unlocked[ACT_POWER[k]]) abilities.unlock(ACT_POWER[k]);
    abilities.endAll();
    abilities.disabled = false;
    // story state
    Object.assign(S, { actTime: 0, beatT: 0, invuln: 0, history: [], runClock: 0, crash: null, rewind: null, storyI: 0, promptI: 0, promptT: 0, shardI: 0, walk: null });
    Object.assign(umbraState, { active: false, leaving: false, offset: 4 });
    umbra.root.visible = false;
    hero.root.visible = true;
    hero.mode = 'cine';
    hero._anim('idle_loop', 0.2);
    victor && (victor.object.visible = false);
    catwalk.visible = false;
    elias && (elias.object.visible = false);
    finale.visible = false;
    wreck.visible = false;
    hud.setAct(i, act);
    hud.prompt(null);
    hud.warn(null);
    world.mode = 'cine';
    world.env.update(0);
    world.track.update(0, 0, 0, 0);
    updateCamera(0, true);
    // compile everything that appears later (Umbra, Victor, Elias, wreck, flames) now, under black
    const later = [umbra.root, victor?.object, elias?.object, catwalk, wreck, finale, burnFlames].filter(Boolean);
    const was = later.map((o) => o.visible);
    later.forEach((o) => (o.visible = true));
    world.track.setWarm(true);
    // the post passes that toggle later (glitch, speed blur) compile now too
    game.postfx?.glitch(0.02, 0.01);
    game.postfx?.setSpeedBlur?.(0.5);
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera).catch(() => {});
    else renderer.compile(scene, camera);
    game.renderOnce();
    game.postfx?.setSpeedBlur?.(0);
    later.forEach((o, k) => (o.visible = was[k]));
    world.track.setWarm(false);
  };

  world.restartAct = async () => {
    const charges = { ...abilities.charges };
    await world.loadAct(world.actIndex);
    Object.assign(abilities.charges, charges);
    const p = ACT_POWER[world.actIndex];
    abilities.charges[p] = Math.max(1, abilities.charges[p]);
    world.beats = Math.max(world.beats, R().retryBeats);
    S.streak = 0;
  };

  // ---------------------------------------------------------------------------------------------------------
  // Cinematics
  // ---------------------------------------------------------------------------------------------------------
  world.setupIntro = () => {
    world.mode = 'cine';
    hero.mode = 'cine';
    hero.speed = 0;
    wreck.visible = true;
    wreck.position.set(0.6, 0, -8);
    const a = hero._anim('death01', 0.01, { loop: false, clamp: true });
    if (a) a.time = a.getClip().duration;
    hero.body.rotation.set(0, 0, 0);
    hud.setVisible(false);
    S.cine = { pos: new THREE.Vector3(2.5, 1.2, 3.5), look: new THREE.Vector3(0, 0.4, 0) };
  };

  world.setCine = (pos, look, seconds = 0) => {
    S.cine ??= { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look) };
    if (seconds <= 0) {
      S.cine.pos.set(...pos);
      S.cine.look.set(...look);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      gsap.to(S.cine.pos, { x: pos[0], y: pos[1], z: pos[2], duration: seconds, ease: 'sine.inOut' });
      gsap.to(S.cine.look, { x: look[0], y: look[1], z: look[2], duration: seconds, ease: 'sine.inOut', onComplete: resolve });
    });
  };

  world.clearCine = (seconds = 0.8) => {
    if (!S.cine) return;
    S.blendCine = { t: 0, dur: seconds, pos: camera.position.clone(), look: S.camLook.clone() };
    S.cine = null;
  };

  world.heroGetUp = () => {
    // the death fall played backwards — time rewinds him onto his feet
    const a = hero.actor.action('death01');
    if (a) {
      a.paused = false;
      a.timeScale = -1.5;
      a.time = a.getClip().duration;
      a.play();
    }
    audio.sfx('reverse_whoosh', { volume: 0.7 });
    return new Promise((r) => setTimeout(() => {
      hero._anim('idle_loop', 0.4);
      r();
    }, 1500));
  };

  world.startRunning = () => {
    world.paused = false;
    if (world.mode === 'run') return;
    world.mode = 'run';
    hero.run();
    hero.speed = R().speed[world.actIndex];
    hud.setVisible(true);
    input.reset?.();
    touch.swipe = null;
  };

  world.resume = () => {
    world.paused = false;
  };

  world.pauseRunning = () => {
    world.paused = true;
  };

  // ---------------------------------------------------------------------------------------------------------
  // Powers
  // ---------------------------------------------------------------------------------------------------------
  let disposed = false;
  const refreshLook = () => {
    if (disposed) return;
    const dom = abilities.dominant;
    game.postfx?.setMood(dom ? MOOD_OF[dom] : 'NEUTRAL', 0.25);
    hero.setTheme(dom ?? ({ 0: 'time', 1: 'shadow', 2: 'fire' }[world.actIndex]), dom ? 1 : 0.2);
    // shadow form: the same suit material turns to smoke (no material swap → no shader recompile)
    const shadowOn = abilities.isActive('shadow');
    normalSuit.color.setHex(shadowOn ? 0x050308 : 0x15171d);
    normalSuit.emissive.setHex(shadowOn ? 0x2a0d55 : 0x000000);
    normalSuit.opacity = shadowOn ? 0.78 : 1;
    burnFlames.visible = abilities.isActive('fire');
    const c = dom === 'fire' ? 0xff7a2a : dom === 'shadow' ? 0x9a5cff : dom === 'time' ? 0x5ab4ff : 0x000000;
    heroLight.color.setHex(c);
    heroLight.intensity = dom ? 30 : 0;
  };

  abilities.onActivate = (type) => {
    hud.flashPower(type);
    if (S.promptAbility === type) {
      hud.prompt(null);
      S.promptAbility = null;
    }
    const p = hero.root.position.clone().setY(1);
    if (type === 'time') {
      world.track.jamMoving(hero.z);
      audio.sfx('reverse_whoosh', { volume: 0.8 });
      audio.sfx('clock_tick', { volume: 1 });
      shock.visible = true;
      shock.position.copy(p);
      shock.scale.setScalar(1);
      shock.material.opacity = 1;
      gsap.to(shock.scale, { x: 40, y: 40, z: 40, duration: 0.9, ease: 'power2.out' });
      gsap.to(shock.material, { opacity: 0, duration: 0.9, onComplete: () => (shock.visible = false) });
      game.postfx?.setChromaticAberration(0.6, 0.15);
      setTimeout(() => game.postfx?.setChromaticAberration(0, 0.6), 300);
      timeScale.hitStop?.(0.06);
    } else if (type === 'shadow') {
      audio.sfx('shadow_step', { volume: 0.9 });
      particles.puff(p, 18, [0.08, 0.03, 0.14], { speed: 3, size: 1.1, life: 0.9 });
      game.postfx?.glitch(0.25, 0.5);
    } else if (type === 'fire') {
      audio.sfx('boost', { volume: 1 });
      audio.sfx('explosion', { volume: 0.4, rate: 1.3 });
      particles.burst(p, 50, [4, 1.5, 0.3], { speed: 9, size: 0.18, life: 0.6 });
      S.trauma = Math.min(1, S.trauma + 0.35);
    }
    refreshLook();
  };
  abilities.onEnd = () => refreshLook();
  abilities.onDenied = (type) => {
    hud.flashPower(type, true);
    audio.sfx('ui_glitch', { volume: 0.4, minInterval: 200 });
  };

  // ---------------------------------------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------------------------------------
  const touch = { x: 0, y: 0, t: 0, swipe: null };
  const onDown = (e) => Object.assign(touch, { x: e.clientX, y: e.clientY, t: performance.now() });
  const onUp = (e) => {
    const dx = e.clientX - touch.x;
    const dy = e.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
    touch.swipe = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'jump' : 'roll';
  };
  window.addEventListener('pointerdown', onDown);
  window.addEventListener('pointerup', onUp);

  const any = (...codes) => codes.some((c) => input.wasPressed(c));
  function readIntent() {
    const pad = input.pad;
    const lx = pad.connected ? pad.lx : 0;
    const ly = pad.connected ? pad.ly : 0;
    const padLeft = lx < -0.6 && S.padX > -0.6;
    const padRight = lx > 0.6 && S.padX < 0.6;
    const padUp = ly < -0.6 && S.padY > -0.6;
    const padDown = ly > 0.6 && S.padY < 0.6;
    S.padX = lx;
    S.padY = ly;
    const sw = touch.swipe;
    touch.swipe = null;
    return {
      left: any('ArrowLeft', 'KeyA') || padLeft || sw === 'left',
      right: any('ArrowRight', 'KeyD') || padRight || sw === 'right',
      jump: any('ArrowUp', 'KeyW', 'Space') || padUp || sw === 'jump',
      roll: any('ArrowDown', 'KeyS', 'KeyC') || padDown || sw === 'roll',
      time: any('KeyR'),
      shadow: any('KeyQ', 'KeyT'),
      fire: any('KeyE', 'ShiftLeft', 'ShiftRight'),
    };
  }

  /** Dev autopilot (tests): dodges, jumps, rolls and uses powers at gates. */
  function autopilot(intent) {
    const tr = world.track;
    const look = hero.speed * 0.42 + 4;
    const laneBlocked = [0, 0, 0];
    let act = null;
    for (const o of tr.near(hero.z, 0, 60)) {
      const dz = o.state.z - hero.z;
      if (dz < -0.5 || dz > 55) continue;
      const need = GATE_NEEDS[o.kind];
      if (need && !(o.kind === 'shutter' && o.state.jammed) && dz < 22) {
        const p = o.kind === 'squad' ? (abilities.charges.shadow >= 1 ? 'shadow' : 'fire') : need;
        if (!abilities.isActive(p)) intent[p] = true;
      }
      if (o.kind === 'gap' && dz < 3.5 && dz > 0) intent.jump = true;
      if (o.kind === 'beam') {
        if (!o.state.landed && !o.state.jammed && dz < 30 && abilities.charges.time >= 1) intent.time = true;
        if ((o.state.landed || o.state.p > 0.8) && dz < hero.speed * 0.2 + 1.5) intent.jump = true;
      }
      if (['low', 'high', 'block', 'oncoming'].includes(o.kind)) {
        const range = o.kind === 'oncoming' ? look + 25 : look;
        if (dz < range) laneBlocked[o.lane] = Math.max(laneBlocked[o.lane], o.kind === 'block' || o.kind === 'oncoming' ? 2 : 1);
        if (o.lane === hero.lane && o.kind === 'low' && dz < hero.speed * 0.22 + 1) act = 'jump';
        if (o.lane === hero.lane && o.kind === 'high' && dz < hero.speed * 0.12 + 1) act = 'roll';
      }
    }
    if (laneBlocked[hero.lane] === 2) {
      const options = [hero.lane - 1, hero.lane + 1].filter((l) => l >= 0 && l <= 2).sort((a, b) => laneBlocked[a] - laneBlocked[b]);
      if (options.length && laneBlocked[options[0]] < 2) intent[options[0] < hero.lane ? 'left' : 'right'] = true;
      else if (hero.lane !== 1 && laneBlocked[1] < 2) intent[1 < hero.lane ? 'left' : 'right'] = true;
    }
    if (act) intent[act] = true;
  }

  // ---------------------------------------------------------------------------------------------------------
  // Heart, crash, rewind
  // ---------------------------------------------------------------------------------------------------------
  function loseBeats(n, label) {
    world.beats = Math.max(0, world.beats - n);
    hud.pop(`-${n} ❤ ${label ?? ''}`.trim(), 'heart');
    if (world.beats <= 0) flatline();
  }

  function flatline() {
    if (world.mode === 'dead') return;
    world.mode = 'dead';
    abilities.endAll();
    hero.die();
    hud.prompt(null);
    timeScale.set(1, 0.05);
    audio.sfx('flatline', { volume: 0.4 });
    setTimeout(() => world.on.flatline(), 1400);
  }

  function crash(killer, kind = 'hit') {
    world.mode = 'crash';
    world.stats.crashes += 1;
    S.streak = 0;
    S.crash = { t: 0, killer };
    hero.hit();
    if (kind === 'fall') {
      hero.vy = -6;
      hero.grounded = false;
    }
    S.trauma = 1;
    audio.sfx(killer?.kind === 'oncoming' ? 'car_crash' : 'bullet_impact', { volume: 0.9 });
    audio.sfx('glass_shatter', { volume: 0.35, rate: 1.3 });
    screenFade.flash?.('#ff2a2a', 0.35);
    game.postfx?.glitch(0.3, 0.45);
    particles.burst(hero.root.position.clone().setY(1), 40, [4, 0.6, 0.4], { speed: 8, size: 0.14, life: 0.5 });
    timeScale.set(0.2, 0.05);
    abilities.endAll();
    loseBeats(diff().crash, '');
  }

  function startRewind() {
    world.mode = 'rewind';
    world.stats.rewinds += 1;
    timeScale.set(1, 0.1);
    const h = S.history;
    if (h.length < 2) {
      // nothing to rewind to: just forgive the hit
      S.history.length = 0;
      if (S.crash?.killer) world.track.dissolve(S.crash.killer);
      S.crash = null;
      S.invuln = R().invulnAfterRewind;
      world.mode = 'run';
      hero.run();
      timeScale.set(1, 0.1);
      return;
    }
    const target = S.runClock - R().rewindSeconds;
    let to = h.length - 1;
    while (to > 0 && h[to].t > target) to -= 1;
    S.rewind = { t: 0, from: h.length - 1, to: Math.max(0, to) };
    game.postfx?.setMood('TIME', 0.15);
    game.postfx?.setChromaticAberration(0.9, 0.1);
    audio.sfx('reverse_whoosh', { volume: 1 });
    hud.pop('⏳ REWIND', 'orb-time');
    if (hero.actor.current) hero.actor.current.timeScale = -1.4;
  }

  function stepRewind(realDt) {
    const rw = S.rewind;
    rw.t += realDt;
    const k = Math.min(1, rw.t / R().rewindPlay);
    const e = k * k * (3 - 2 * k);
    const f = rw.from + (rw.to - rw.from) * e;
    const i0 = Math.floor(f);
    const h = S.history;
    if (h.length) {
      const snap = h[Math.max(0, Math.min(h.length - 1, i0))];
      hero.restore(snap.hero);
      world.track.restore(snap.track);
    }
    S.stepT += realDt;
    if (S.stepT > 0.18) {
      S.stepT = 0;
      audio.sfx('clock_tick', { volume: 0.6, rate: 1.4 });
    }
    if (k >= 1) {
      S.history.length = Math.min(h.length, rw.to + 1);
      hero.trails.forEach((tr) => tr.reset());
      S.runClock = h[rw.to]?.t ?? S.runClock;
      if (S.crash?.killer) world.track.dissolve(S.crash.killer);
      S.crash = null;
      S.rewind = null;
      S.invuln = R().invulnAfterRewind;
      world.mode = 'run';
      hero.run();
      hero.y = 0;
      hero.vy = 0;
      hero.grounded = true;
      game.postfx?.setChromaticAberration(0, 0.4);
      refreshLook();
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Collisions + pickups
  // ---------------------------------------------------------------------------------------------------------
  const hb = {};
  const prevHb = {};
  const boxes = [];
  function collide() {
    const tr = world.track;
    hero.hitbox(hb);
    const w = R().hitbox.halfWidth;
    Object.assign(prevHb, hb, { x0: hero.prevX - w, x1: hero.prevX + w });
    const burn = abilities.isActive('fire');
    const shadow = abilities.isActive('shadow');
    for (const o of tr.near(hero.z, 3, 4)) {
      tr.boxes(o, boxes);
      for (const b of boxes) {
        if (!overlap(hb, b)) continue;
        if (burn && BEATS.burn.has(o.kind) && !(o.kind === 'beam' && !o.state.landed && o.state.p < 0.9)) {
          tr.smash(o, hero.speed);
          world.stats.score += 250 * mult();
          hud.pop('SMASH!', 'smash');
          audio.sfx('explosion', { volume: 0.6, rate: 1.1 + Math.random() * 0.2 });
          S.trauma = Math.min(1, S.trauma + 0.45);
          timeScale.hitStop?.(0.04);
          break;
        }
        if (shadow && BEATS.shadow.has(o.kind)) {
          if (!o.phased) {
            o.phased = true;
            hud.pop('PHASED', 'phase');
            world.stats.score += 150 * mult();
            particles.puff(hero.root.position.clone().setY(1), 8, [0.1, 0.04, 0.18], { speed: 2, size: 0.9, life: 0.6 });
          }
          break;
        }
        if (o.kind === 'firewall' && shadow) {
          hud.pop('FIRE BURNS SHADOWS', 'smash');
        }
        if (S.invuln > 0) break;
        // entered from the side? → stumble back to the old lane
        const lateral = !FULL_KINDS.has(o.kind) && !overlap(prevHb, b);
        if (lateral) {
          hero.lane = S.fromLane;
          S.trauma = Math.min(1, S.trauma + 0.5);
          S.invuln = 0.5;
          S.streak = 0;
          audio.sfx('bullet_impact', { volume: 0.6 });
          hud.pop('STUMBLE', 'heart');
          loseBeats(R().stumbleCost);
          return;
        }
        crash(o);
        return;
      }
    }
    // rooftop gaps: no floor
    if (hero.grounded && hero.y <= 0.01 && S.invuln <= 0) {
      const gap = tr.overGap(hero.z);
      if (gap) crash(gap, 'fall');
    }
  }
  const FULL_KINDS = new Set(['shutter', 'laser', 'squad', 'firewall', 'gap', 'beam']);

  const mult = () => 1 + Math.min(4, Math.floor(S.streak / 20));

  function pickups() {
    const tr = world.track;
    const burn = abilities.isActive('fire');
    const lanes = R().lanes;
    const midY = hero.y + hero.height * 0.5;
    // shards
    while (S.shardI < tr.shards.length && tr.shards[S.shardI].z < hero.z - 3) S.shardI += 1;
    for (let i = S.shardI; i < tr.shards.length; i++) {
      const s = tr.shards[i];
      if (s.z > hero.z + 2.5) break;
      if (s.taken) continue;
      const near = Math.abs(s.z - hero.z) < 1.1 && Math.abs(lanes[s.lane] - hero.x) < 1.1 && Math.abs(s.y - midY) < 1.3;
      const magnet = burn && Math.abs(s.z - hero.z) < 2.5;
      if (near || magnet) {
        s.taken = true;
        world.stats.shards += 1;
        S.streak += 1;
        world.stats.score += 10 * mult();
        audio.sfx('ui_hover', { volume: 0.25, rate: 1.2 + (S.streak % 8) * 0.06, minInterval: 35 });
        tmpV.set(lanes[s.lane], s.y, s.z);
        particles.burst(tmpV, 5, world.track.accent.toArray().map((v) => v * 3), { speed: 3, size: 0.08, life: 0.3, gravity: 0 });
      }
    }
    for (const o of tr.orbs) {
      if (o.taken || Math.abs(o.z - hero.z) > 1.3 || Math.abs(lanes[o.lane] - hero.x) > 1.3 || hero.y > 2.2) continue;
      o.taken = true;
      if (!abilities.unlocked[o.type]) abilities.unlock(o.type, 0);
      abilities.add(o.type, 1);
      hud.pop(`+1 ${{ time: '⏳ TIME', shadow: '🌑 SHADOW', fire: '🔥 BURN' }[o.type]}`, `orb-${o.type}`);
      hud.flashPower(o.type);
      audio.sfx('ui_glitch', { volume: 0.5 });
      audio.sfx('boost', { volume: 0.3, rate: 1.5 });
      const c = { time: [0.6, 1.6, 4], shadow: [1.8, 0.7, 4], fire: [4, 1.5, 0.3] }[o.type];
      particles.burst(tmpV.set(lanes[o.lane], 1.2, o.z), 30, c, { speed: 6, size: 0.14, life: 0.6, gravity: 0 });
    }
    for (const f of tr.fragments) {
      if (f.taken || Math.abs(f.z - hero.z) > 1.3 || Math.abs(lanes[f.lane] - hero.x) > 1.3) continue;
      f.taken = true;
      const n = R().fragmentRestore;
      world.beats = Math.min(world.maxBeats, world.beats + n);
      world.stats.fragments += 1;
      hud.pop(`+${n} ❤ MEMORY`, 'heart');
      audio.sfx('monitor_beep', { volume: 0.8 });
      game.postfx?.setMood('MEMORY', 0.15);
      setTimeout(() => refreshLook(), 900);
      particles.burst(tmpV.set(lanes[f.lane], 1.2, f.z), 40, [4, 3.4, 2.2], { speed: 5, size: 0.14, life: 0.8, gravity: 1 });
      world.on.fragment(f.text);
    }
  }

  /** Dodged something by a hair → CLOSE! */
  function nearMisses() {
    for (const o of world.track.near(hero.z, 2, 0)) {
      if (o.passed || o.broken) continue;
      const end = o.state.z + (o.len ?? 1) + (o.kind === 'oncoming' ? 2.3 : 0);
      if (end > hero.z - 0.3) continue;
      o.passed = true;
      if (FULL_KINDS.has(o.kind)) {
        if (o.kind === 'gap') world.stats.score += 50 * mult();
        continue;
      }
      const adjacent = Math.abs(R().lanes[o.lane] - hero.x) < 2.9 && o.lane !== hero.lane;
      if ((adjacent && S.lastLaneChange < 0.55) || (o.kind === 'oncoming' && adjacent)) {
        world.stats.closeCalls += 1;
        S.streak += 3;
        world.stats.score += 100 * mult();
        hud.pop('CLOSE!', 'close');
        audio.sfx('whoosh', { volume: 0.45, rate: 1.2, minInterval: 150 });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------------------------------------
  function updateCamera(dt, snap = false) {
    const c = S.cam;
    const hp = hero.root.position;
    if (S.cine) {
      camera.position.copy(hp).add(S.cine.pos);
      S.camLook.copy(hp).add(S.cine.look);
      camera.lookAt(S.camLook);
      return;
    }
    const burn = abilities.isActive('fire');
    const walking = world.mode === 'walk';
    const back = walking ? 3.4 : c.back + (hero.speed - 19) * 0.05 + (burn ? 0.8 : 0);
    const up = walking ? 1.9 : c.up;
    tmpV.set(hero.x * c.laneFollow, up + hero.y * 0.45, hero.z - back);
    tmpV2.set(hero.x * 0.85, (walking ? 1.5 : c.lookY) + hero.y * 0.35, hero.z + (walking ? 6 : c.lookAhead));
    const k = snap ? 1 : 1 - Math.exp(-dt * c.follow);
    S.camPos.x += (tmpV.x - S.camPos.x) * k;
    S.camPos.y += (tmpV.y - S.camPos.y) * k;
    S.camPos.z = tmpV.z; // locked to the run (no lag at 25 m/s)
    S.camLook.x += (tmpV2.x - S.camLook.x) * Math.min(1, k * 1.4);
    S.camLook.y += (tmpV2.y - S.camLook.y) * k;
    S.camLook.z = tmpV2.z;
    camera.position.copy(S.camPos);
    // blend out of a cinematic
    if (S.blendCine) {
      const b = S.blendCine;
      b.t += dt;
      const e = Math.min(1, b.t / b.dur);
      const s = e * e * (3 - 2 * e);
      camera.position.lerpVectors(b.pos.clone().setZ(b.pos.z), S.camPos, s);
      tmpV2.lerpVectors(b.look, S.camLook, s);
      camera.lookAt(tmpV2);
      if (e >= 1) S.blendCine = null;
    } else camera.lookAt(S.camLook);
    // shake (trauma²)
    S.trauma = Math.max(0, S.trauma - dt * 1.8);
    const sh = S.trauma * S.trauma;
    if (sh > 0.001 && dt > 0) {
      camera.position.x += (Math.random() - 0.5) * sh * 0.6;
      camera.position.y += (Math.random() - 0.5) * sh * 0.5;
      camera.rotation.z += (Math.random() - 0.5) * sh * 0.06;
    }
    camera.rotation.z += -hero.lean * 0.12;
    // FOV kicks with speed + burn
    const sp = THREE.MathUtils.clamp((hero.speed - 18) / 14, 0, 1);
    const fov = walking ? 55 : THREE.MathUtils.lerp(c.fov, c.fovFast, sp) + (burn ? 9 : 0);
    S.fov += (fov - S.fov) * Math.min(1, dt * 4);
    if (Math.abs(camera.fov - S.fov) > 0.01) {
      camera.fov = S.fov;
      camera.updateProjectionMatrix();
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Story triggers + prompts
  // ---------------------------------------------------------------------------------------------------------
  function triggers(realDt) {
    const c = world.course;
    while (S.storyI < c.story.length && c.story[S.storyI].z <= hero.z) {
      const id = c.story[S.storyI++].id;
      if (id === 'shadow_umbra') {
        Object.assign(umbraState, { active: true, leaving: false, offset: 4 });
        umbra.root.visible = true;
        umbra.reset(hero.z + 30, 0);
        umbra.run();
        audio.sfx('shadow_step', { volume: 0.8 });
      }
      if (id === 'shadow_end') umbraState.leaving = true;
      if (id === 'fire_victor' && victor) {
        victor.object.visible = true;
        victor.object.position.set(4.6, 4.2, hero.z + 75);
        victor.object.rotation.y = Math.PI * 1.15;
        catwalk.visible = true;
        catwalk.position.set(4.8, 4.2, hero.z + 75);
        if (victor.hasClip('pointing')) victor.play('pointing', 0.3);
      }
      world.on.story(id);
    }
    while (S.promptI < c.prompts.length && c.prompts[S.promptI].z <= hero.z) {
      const p = c.prompts[S.promptI++];
      hud.prompt(p.keys, p.text, p.ability);
      S.promptT = 2.8;
      S.promptAbility = p.ability;
    }
    if (S.promptT > 0) {
      S.promptT -= realDt;
      if (S.promptT <= 0) {
        hud.prompt(null);
        S.promptAbility = null;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // Finale: the walk into the fire
  // ---------------------------------------------------------------------------------------------------------
  world.playFinale = (hooks = {}) => new Promise((resolve) => {
    const z0 = hero.z;
    const L = R().finaleLength;
    world.mode = 'walk';
    abilities.endAll();
    abilities.disabled = true;
    hud.breakPowers();
    hud.prompt(['W', '↑'], 'HOLD TO WALK INTO THE FIRE', 'fire');
    hero.walk();
    hero.speed = 0;
    hero.lane = 1;
    finale.visible = true;
    finale.position.set(0, 0, z0);
    game.postfx?.setMood('FIRE', 1.5);
    // Umbra blocks the way; Elias waits at the heart of the fire
    umbraState.active = false;
    umbra.root.visible = true;
    umbra.reset(z0 + 9, 1);
    umbra.mode = 'cine';
    umbra.idle();
    umbra.root.rotation.y = Math.PI;
    if (elias) {
      elias.object.visible = true;
      elias.object.position.set(0, 0, z0 + L + 2);
      elias.object.rotation.y = Math.PI;
    }
    S.fireId = audio.sfx('fire_loop', { volume: 0.6 });
    S.walk = { z0, L, resolve, hooks, beatT: 0 };
  });

  function stepFinale(dt, realDt) {
    const w = S.walk;
    const hold = input.isDown('KeyW') || input.isDown('ArrowUp') || input.isDown('Space') || input.pad.ly < -0.5 || input.mouse.buttons.has(0) || window.__runnerAutopilot;
    const target = hold ? 1.5 : 0;
    hero.speed += (target - hero.speed) * Math.min(1, dt * 3);
    if (hero.actor.current) hero.actor.current.timeScale = THREE.MathUtils.clamp(hero.speed / 1.3, 0, 1.2);
    const k = THREE.MathUtils.clamp((hero.z - w.z0) / w.L, 0, 1);
    burnEl.style.opacity = (k * k * 0.9).toFixed(3);
    // Umbra steps back, fading with every step Kael takes
    const uz = Math.max(w.z0 + 9, hero.z + 3.2);
    umbra.root.position.set(0, 0, uz);
    umbra.z = uz;
    umbraMat.opacity = Math.max(0, 0.9 * (1 - k * 1.25));
    umbra.root.visible = umbraMat.opacity > 0.02;
    if (umbra.root.visible && Math.random() < 0.3) particles.puff(tmpV.set((Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 1.4, uz), 1, [0.05, 0.02, 0.1], { speed: 1, size: 0.7, life: 0.8 });
    umbra.actor.update(dt);
    elias?.update(dt);
    // the heart slows as he walks
    w.beatT += realDt;
    const interval = 0.9 + k * 1.2;
    if (w.beatT > interval) {
      w.beatT = 0;
      hud.beat();
      audio.sfx('heartbeat', { volume: 0.9 });
    }
    if (Math.random() < 0.5) particles.mote(tmpV.set((Math.random() - 0.5) * 8, 0.3, hero.z + Math.random() * 12), tmpV2.set(0, 2 + Math.random() * 2, 0), [4, 1.6, 0.4], 0.08, 1.5, 1.5);
    w.hooks.onStep?.(k);
    if (k >= 1 && !w.done) {
      w.done = true;
      hero.speed = 0;
      hero.idle();
      hud.prompt(null);
      world.mode = 'end';
      audio.stop('sfx', 'fire_loop', S.fireId, 2);
      w.resolve();
    }
  }

  // ---------------------------------------------------------------------------------------------------------
  // The frame
  // ---------------------------------------------------------------------------------------------------------
  world.update = (dt, elapsed, realDt) => {
    const t = elapsed;
    if (world.paused) {
      hero.actor.update(0);
      updateCamera(0);
      return;
    }
    const timeStopped = abilities.isActive('time');
    if (!timeStopped) flameClock.value += dt;

    if (world.mode === 'run') {
      const intent = readIntent();
      if (import.meta.env.DEV && window.__runnerAutopilot) autopilot(intent);
      if (intent.time) abilities.trigger('time');
      if (intent.shadow) abilities.trigger('shadow');
      if (intent.fire) abilities.trigger('fire');
      abilities.update(realDt);
      if (timeStopped) world.track.jamMoving(hero.z, 60);

      // speed: per act, ramping, burn boost
      S.actTime += dt;
      world.stats.time += dt;
      const base = R().speed[world.actIndex] + R().speedRamp * S.actTime;
      hero.speed += (base * (abilities.isActive('fire') ? R().burn.speedMul : 1) - hero.speed) * Math.min(1, dt * 3);
      const lane0 = hero.lane;
      const z0 = hero.z;
      hero.update(dt, intent);
      if (hero.lane !== lane0) {
        S.fromLane = lane0;
        S.lastLaneChange = 0;
        audio.sfx('whoosh', { volume: 0.18, rate: 1.6, minInterval: 90 });
      }
      S.lastLaneChange += dt;
      world.stats.distance += hero.z - z0;
      world.stats.score += (hero.z - z0) * mult();
      S.invuln = Math.max(0, S.invuln - dt);
      hero.root.visible = S.invuln <= 0 || Math.floor(S.invuln * 14) % 2 === 0 || abilities.isActive('shadow');

      // juice from hero events
      for (const e of hero.events) {
        if (e === 'land') {
          particles.puff(tmpV.set(hero.x, 0.1, hero.z), 6, [0.25, 0.25, 0.28], { speed: 2.2, size: 0.5, life: 0.5, gravity: 0 });
          S.trauma = Math.min(1, S.trauma + 0.12);
          audio.sfx('footstep_concrete', { volume: 0.4 });
        }
        if (e === 'jump') audio.sfx('whoosh', { volume: 0.3, rate: 0.9, minInterval: 80 });
        if (e === 'roll') audio.sfx('whoosh', { volume: 0.35, rate: 0.7, minInterval: 80 });
      }

      world.track.update(hero.z, dt, timeStopped ? 0 : dt, t);
      collide();
      if (world.mode === 'run') {
        pickups();
        nearMisses();
        triggers(realDt);
        // the heart
        S.beatT += dt;
        if (S.beatT >= diff().beatInterval) {
          S.beatT = 0;
          world.beats = Math.max(0, world.beats - 1);
          hud.beat();
          audio.sfx('heartbeat', { volume: world.beats <= 20 ? 0.9 : 0.35 });
          if (world.beats <= 0) {
            flatline();
            return;
          }
        }
        // ⏳ record for the rewind
        S.runClock += dt;
        S.history.push({ t: S.runClock, hero: hero.snapshot(), track: world.track.snapshot() });
        const keep = R().rewindSeconds + 0.5;
        while (S.history.length && S.history[0].t < S.runClock - keep) S.history.shift();
        // HUD: which power the next gate needs
        const gate = world.track.nextGate(hero.z, 85);
        let needs = gate ? GATE_NEEDS[gate.kind] : null;
        if (gate?.kind === 'squad' && abilities.charges.shadow < 1 && abilities.unlocked.fire) needs = 'fire';
        S.needs = needs;
        hud.warn(needs && !abilities.isActive(needs) && gate.state.z - hero.z < 60
          ? (abilities.charges[needs] >= 1 ? `${{ time: '⏳ PRESS R', shadow: '🌑 PRESS Q', fire: '🔥 PRESS E' }[needs]}` : `NO ${needs.toUpperCase()} CHARGE — DODGE OR TAKE THE HIT`)
          : null);
        // act end
        if (world.mode === 'run' && hero.z >= world.course.length) {
          world.mode = 'cine-end';
          hud.prompt(null);
          hud.warn(null);
          abilities.endAll();
          audio.sfx('whoosh', { volume: 0.9, rate: 0.6 });
          screenFade.flash?.('#ffffff', 0.6);
          world.on.actEnd();
        }
      }
    } else if (world.mode === 'crash') {
      hero.update(dt, {});
      world.track.update(hero.z, dt, 0, t);
      S.crash.t += realDt;
      if (S.crash.t > 0.55 && world.beats > 0) startRewind();
    } else if (world.mode === 'rewind') {
      stepRewind(realDt);
      hero.actor.update(dt);
      world.track.update(hero.z, dt, 0, t);
    } else if (world.mode === 'walk') {
      hero.update(dt, {});
      stepFinale(dt, realDt);
      world.track.update(hero.z, dt, 0, t);
    } else {
      // cine / dead / end / cine-end: keep Kael animating in place
      hero.update(dt, {});
      world.track?.update(hero.z, dt, 0, t);
      elias?.update(dt);
    }

    // Umbra running beside Kael in ACT II, on a ribbon of smoke beyond the parapet
    if (umbraState.active) {
      umbraState.offset += ((umbraState.leaving ? 40 : 2.5 + Math.sin(t * 0.6) * 3) - umbraState.offset) * Math.min(1, dt * 0.8);
      umbra.speed = 0;
      umbra.z = hero.z + umbraState.offset;
      umbra.x = umbraState.x;
      umbra.lane = 0;
      umbra.update(dt, {});
      umbra.root.position.set(umbraState.x, 0.2, umbra.z);
      if (umbra.actor.current) umbra.actor.current.timeScale = hero.actor.current?.timeScale ?? 1;
      if (Math.random() < 0.6) particles.puff(tmpV.set(umbraState.x + (Math.random() - 0.5), 0.1, umbra.z - 0.5), 1, [0.05, 0.02, 0.1], { speed: 0.6, size: 0.9, life: 0.9, gravity: 0 });
      if (umbraState.leaving && umbraState.offset > 35) {
        umbraState.active = false;
        umbra.root.visible = false;
      }
    }
    if (victor?.object.visible) victor.update(dt);

    // ambient: rain / embers / holo dust
    const act = R().acts[world.actIndex].id;
    if (act === 'fire' && Math.random() < 0.7) particles.mote(tmpV.set((Math.random() - 0.5) * 12, Math.random() * 2, hero.z + 8 + Math.random() * 30), tmpV2.set((Math.random() - 0.5) * 1, 2 + Math.random() * 3, 0), [4, 1.4, 0.3], 0.07, 2.2, 1.2);
    if (act === 'time' && Math.random() < 0.4) particles.mote(tmpV.set((Math.random() - 0.5) * 14, 1 + Math.random() * 6, hero.z + 10 + Math.random() * 40), tmpV2.set(0, 0.3, -2), [0.6, 1.6, 4], 0.05, 2, 0);
    if (abilities.isActive('fire')) particles.mote(tmpV.set(hero.x + (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 1.2, hero.z - 0.5), tmpV2.set((Math.random() - 0.5) * 2, 1 + Math.random() * 2, -hero.speed * 0.3), [4, 1.6, 0.3], 0.12, 0.5, 2);
    if (abilities.isActive('shadow') && Math.random() < 0.7) particles.puff(tmpV.set(hero.x, 0.6 + Math.random(), hero.z - 0.3), 1, [0.06, 0.02, 0.12], { speed: 0.8, size: 0.8, life: 0.7, gravity: 0.2 });

    particles.update(timeStopped ? dt * 0.15 : dt);
    world.env?.update(hero.z);
    rain.speed = timeStopped ? 1.5 : 24;
    if (rain.lines.visible) rain.update(dt, camera);
    updateCamera(realDt);
    hero.updateTrails(camera, world.mode === 'run' ? THREE.MathUtils.clamp((hero.speed - 12) / 10, 0.2, 1) : 0.2);
    sky.position.copy(camera.position);
    sun.position.set(hero.x + 6, 14, hero.z - 6);
    sun.target.position.set(hero.x, 0, hero.z + 4);
    heroLight.position.set(hero.x, 1.4, hero.z - 0.4);
    portal.rotation.z += dt * 0.8;
    speedLines.update(realDt, hero.speed, world.mode === 'run' ? THREE.MathUtils.clamp((hero.speed - 20) / 10, 0, 1) + (abilities.isActive('fire') ? 0.8 : 0) : 0);
    game.postfx?.setSpeedBlur?.(world.mode === 'run' && abilities.isActive('fire') ? 0.5 : 0);
    if (game.postfx) game.postfx.lowHeart = world.mode === 'run' ? THREE.MathUtils.clamp((20 - world.beats) / 20, 0, 1) : 0;
    if (game.postfx) game.postfx.lowHeartPulse = S.beatT < 0.3 ? 1 - S.beatT / 0.3 : 0;
    audio.setListener(camera);
    hud.update({
      beats: world.beats,
      maxBeats: world.maxBeats,
      progress: world.course ? hero.z / world.course.length : 0,
      score: world.stats.score,
      shards: world.stats.shards,
      mult: mult(),
      abilities,
      dt: realDt,
      needs: S.needs,
    });
  };

  world.applyGraphics = (preset) => {
    sun.castShadow = !!preset.shadows;
    sun.shadow.mapSize.setScalar(Math.min(preset.shadowMapSize ?? 1024, 2048));
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    rain.lines.geometry.setDrawRange(0, (preset.shadows ? 3000 : 1500) * 2);
  };

  world.dispose = () => {
    disposed = true;
    audio.stop('sfx', 'fire_loop', S.fireId, 0.5);
    game.postfx?.setMood('NEUTRAL', 0);
    game.postfx?.setChromaticAberration(0, 0);
    scene.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    window.removeEventListener('pointerdown', onDown);
    window.removeEventListener('pointerup', onUp);
    world.env?.dispose();
    world.track?.dispose();
    hero.dispose();
    umbra.dispose();
    particles.dispose();
    speedLines.dispose();
    rain.dispose();
    hud.destroy();
    burnEl.remove();
    abilities.disabled = true;
    if (game.postfx) {
      game.postfx.lowHeart = 0;
      game.postfx.setSpeedBlur?.(0);
    }
    timeScale.set(1, 0.01);
  };

  return world;
}

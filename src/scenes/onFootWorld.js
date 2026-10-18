// =============================================================================
// FLATLINE: 2050 — scenes/onFootWorld.js
// The shared 2020 on-foot world every level is built on (sandbox, combat
// arena, Missions 2–8): Kael + camera rig + guns + 🔥 fire + 🌑 lights and
// Shadow Step + ⏳ rewind + heartbeat (fragments, low-heart FX, death,
// FLATLINE) + enemies (AIDirector) + HUD + Esc dialog.
//
//   const world = createOnFootWorld(renderer, assets, {
//     spawn: [x, y, z], yaw, hdri, fog, rain,
//     build(kit) { kit.addBox(...); kit.addLamp(...); kit.addCover(...);
//                  kit.ai.spawn({...}); return { update(dt), dispose() } },
//   })
//
// The level's build() gets a "kit" of helpers (boxes with colliders, ramps,
// props, shootable lamps, cover points, flammables, memory fragments,
// interactables) and may return its own update / dispose.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { physics } from '../core/physics.js';
import { input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { createModelInstance } from '../assets/loader.js';
import { CameraRig } from '../core/cameraRig.js';
import { PlayerController } from '../player/playerController.js';
import { WeaponSystem } from '../player/weapons.js';
import { ShadowStep } from '../player/shadowStep.js';
import { CombatFX } from '../vfx/muzzleFX.js';
import { CombatHUD } from '../ui/combatHUD.js';
import { InteractPrompt } from '../ui/interactPrompt.js';
import { gameOver } from '../ui/gameOver.js';
import { modal } from '../ui/modal.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { timeRewind } from '../systems/timeRewind.js';
import { lights } from '../systems/lights.js';
import { heartbeat } from '../systems/heartbeat.js';
import { heartbeatFX } from '../systems/heartbeatFX.js';
import { fire } from '../systems/fire.js';
import { MemoryFragments } from '../systems/fragments.js';
import { AIDirector } from '../ai/enemyAI.js';
import { initExplosions } from '../systems/explosions.js';
import { Rain } from '../vfx/rainFX.js';
import { AmbientLife } from '../vfx/ambientLife.js';
import { saveGame } from '../systems/saveGame.js';
import { award } from '../ui/achievementToast.js';

/** Everything an on-foot level needs loaded (levels add their own extras). */
export const ON_FOOT_ASSETS = [
  'characters.kael_2020', 'characters.enemy', 'weapons.pistol', 'weapons.rifle', 'weapons.sniper',
  'textures.wet_asphalt', 'textures.brick', 'textures.concrete', 'textures.rusty_metal',
  'props.street_lamp', 'props.crate', 'props.barrel', 'props.barrel_explosive',
  'hdri.night_street_2020',
  'sfx.footstep_concrete', 'sfx.rain_heavy', 'sfx.reverse_whoosh', 'sfx.clock_tick', 'sfx.thunder', 'sfx.radio_static',
  'sfx.pistol_shot', 'sfx.rifle_shot', 'sfx.sniper_shot', 'sfx.reload', 'sfx.shell_casing', 'sfx.bullet_impact',
  'sfx.glass_shatter', 'sfx.ui_click', 'sfx.heartbeat', 'sfx.explosion', 'sfx.fire_loop', 'sfx.whoosh',
  'sfx.shadow_step', 'sfx.flatline', 'sfx.scifi_beep',
];

export const ON_FOOT_HELP = [
  ['WASD', 'move'], ['Shift', 'sprint'], ['C / Ctrl', 'crouch'], ['Space', 'jump · vault'], ['Alt', 'roll'],
  ['E', 'cover'], ['RMB', 'aim · peek'], ['LMB', 'shoot'], ['1 2 3', 'pistol · rifle · sniper'], ['R', 'reload'],
  ['V', '🔥 incendiary'], ['Shift', 'steady (scope)'], ['hold T', '🌑 shadow step'], ['hold R', '⏳ rewind'],
  ['Q', 'shoulder'], ['F', 'interact'],
];

/** Clone a loaded PBR material with its own texture repeat. */
export function repeatMaterial(loaded, rx, ry, fallback) {
  if (!loaded?.isMaterial) return new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.85 });
  const m = loaded.clone();
  for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
    if (!m[key]) continue;
    m[key] = m[key].clone();
    m[key].repeat.set(rx, ry);
    m[key].needsUpdate = true;
  }
  return m;
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {Map} assets
 * @param {object} o
 * @param {number[]} o.spawn               Kael's feet
 * @param {number} [o.yaw]
 * @param {string} [o.hdri]
 * @param {number} [o.fog]                 FogExp2 density
 * @param {number} [o.background]
 * @param {boolean} [o.rain]               rain ambience
 * @param {number} [o.groundSize]          0 = no default ground
 * @param {string[]} [o.loadout]
 * @param {Array} [o.help]                 control list for the help panel (null = none)
 * @param {(p: THREE.Vector3) => object|null} [o.echo]  gunshot echo zones
 * @param {(kit) => ({update?, dispose?}|void)} o.build
 * @param {(choice: string) => void} [o.onExit]
 * @param {string} [o.exitTitle]
 */
export function createOnFootWorld(renderer, assets, o) {
  const {
    spawn = [0, 0, 0], yaw = 0, hdri = 'hdri.night_street_2020', fog = 0.03, background = 0x05060a, rain = true, rainFX = false,
    groundSize = 200, loadout = ['pistol', 'rifle', 'sniper'], help = null, echo = () => null, build = () => {},
    onExit = () => {}, exitTitle = 'Leave the mission?', exitText = 'Progress since the last checkpoint will be lost.',
  } = o;
  const physicsGen = physics.clear();
  timeRewind.clear();
  lights.clear();
  heartbeat.reset();
  const disposables = [];
  const track = (x) => (disposables.push(x), x);
  const R = physics.RAPIER;
  const world = { inputOverride: null, lookOverride: null, paused: false };

  // --- Scene, camera, light ------------------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);
  scene.fog = new THREE.FogExp2(0x070910, fog);
  const camera = new THREE.PerspectiveCamera(CONFIG.cameraRig.fov, innerWidth / innerHeight, 0.05, 600);
  scene.add(camera);
  const env = assets.get(hdri);
  if (env?.texture) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(env.texture).texture;
    pmrem.dispose();
  }
  scene.environmentIntensity = 0.35;
  scene.add(new THREE.HemisphereLight(0x3a4a6a, 0x0a0806, 0.35));
  const moon = new THREE.DirectionalLight(0x8aa4d8, 0.7);
  moon.position.set(-12, 30, -8);
  moon.castShadow = true;
  Object.assign(moon.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 90 });
  moon.shadow.bias = -0.0005;
  scene.add(moon, moon.target);

  const mats = {
    ground: track(repeatMaterial(assets.get('textures.wet_asphalt'), groundSize / 9, groundSize / 9, 0x1a1a1f)),
    brick: track(repeatMaterial(assets.get('textures.brick'), 4, 2, 0x5a2a22)),
    concrete: track(repeatMaterial(assets.get('textures.concrete'), 2, 1, 0x5a5a5a)),
    metal: track(repeatMaterial(assets.get('textures.rusty_metal'), 2, 1, 0x5a3a2a)),
  };
  if (groundSize > 0) {
    const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(groundSize, groundSize)), mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    physics.world.createCollider(R.ColliderDesc.cuboid(groundSize / 2, 0.5, groundSize / 2).setTranslation(0, -0.5, 0).setFriction(1));
  }

  // --- Kael, guns, abilities -----------------------------------------------------------------------
  const rig = new CameraRig(camera, { excludeCollider: () => player?.collider });
  const player = new PlayerController({ scene, template: assets.get('characters.kael_2020'), position: new THREE.Vector3(...spawn), yaw, rig, track });
  player.armed = loadout.length > 0;
  rig.setYaw(yaw, -0.15);
  rig.pivot.set(spawn[0], spawn[1] + 1.6, spawn[2]);
  const offPlayerRewind = timeRewind.register(player);
  const fx = new CombatFX(scene);
  const hud = new CombatHUD();
  const weapons = new WeaponSystem({ scene, player, rig, assets, fx, hud, loadout });
  weapons.echo = echo;
  lights.onShotOut = (it) => fx.impact(it.position, new THREE.Vector3(0, -1, 0), 'glass', { decal: false });
  fire.init(scene, fx);
  initExplosions(scene);
  weapons.onIncendiary = (point, normal, collider, target) => {
    if (!target) fire.ignite(point.clone().addScaledVector(normal, 0.05), { size: 0.8, fuel: CONFIG.weapons.incendiary.burnSeconds });
    // 🔥 "Pyromaniac": ten fires started with incendiary rounds (across the story)
    saveGame.data.firesStarted = (saveGame.data.firesStarted ?? 0) + 1;
    if (saveGame.data.firesStarted >= 10) award('pyromaniac');
  };
  const shadowStep = new ShadowStep({ scene, player, rig, fx });
  const fragments = new MemoryFragments(scene);
  const ai = new AIDirector({ scene, assets, fx, player, weapons, rig, echo });
  ai.onKill = () => weapons.addAmmo(weapons.gun.id === 'sniper' ? 'sniper' : weapons.gun.id, weapons.gun.id === 'sniper' ? 1 : 8);

  // --- Checkpoints, death, FLATLINE ------------------------------------------------------------------
  const checkpoint = { position: new THREE.Vector3(...spawn), yaw };
  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
  let flatlined = false;
  player.onDeath = async () => {
    heartbeat.spend(CONFIG.heartbeat.cost.death, 'death', { force: true });
    if (heartbeat.beats <= 0) return; // the flatline handler takes over
    subtitles.show('clockmaker', 'Not yet. Get up.', 2.2);
    await wait(2.4);
    respawnAtCheckpoint();
  };
  function respawnAtCheckpoint() {
    player.respawn(checkpoint.position, checkpoint.yaw);
    rig.setYaw(checkpoint.yaw, -0.15);
    world.onRespawn?.();
  }
  const offHeart = heartbeat.on(async (ev) => {
    if (ev !== 'flatline' || flatlined) return;
    flatlined = true;
    player.locked = true;
    player.die();
    await wait(1);
    await gameOver.show();
    heartbeat.reset();
    respawnAtCheckpoint();
    player.locked = false;
    flatlined = false;
  });

  // --- Level kit ------------------------------------------------------------------------------------------
  function addBox(size, pos, mat = mats.concrete, { rotY = 0, cast = true, collide = true, surface = null } = {}) {
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(...size)), mat);
    mesh.position.set(...pos);
    mesh.rotation.y = rotY;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (!collide) return mesh;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const c = physics.world.createCollider(R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2).setTranslation(...pos).setRotation(q).setFriction(0.8));
    if (surface) weapons.setSurface(c, surface);
    else if (mat === mats.brick) weapons.setSurface(c, 'brick');
    else if (mat === mats.metal) weapons.setSurface(c, 'metal');
    mesh.userData.collider = c;
    return mesh;
  }

  /** Invisible walkable ramp from a (bottom) to b (top) along Z. */
  function addRamp(a, b, width) {
    const [ax, ay, az] = a;
    const [, by, bz] = b;
    const len = Math.hypot(bz - az, by - ay);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.atan2(by - ay, bz - az));
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const c = new THREE.Vector3(ax, (ay + by) / 2, (az + bz) / 2).addScaledVector(up, -0.05);
    physics.world.createCollider(R.ColliderDesc.cuboid(width / 2, 0.05, len / 2).setTranslation(c.x, c.y, c.z).setRotation(q));
  }

  /** Stairs: visual steps on an invisible ramp, climbing along +Z from `base`. */
  function addStairs(base, { width = 3, steps = 6, rise = 0.18, depth = 0.4, mat = mats.concrete } = {}) {
    const [x, y, z] = base;
    for (let i = 0; i < steps; i++) addBox([width, rise * (i + 1), depth], [x, y + (rise * (i + 1)) / 2, z + depth / 2 + i * depth], mat, { collide: false });
    addRamp([x, y, z], [x, y + rise * steps, z + depth * steps], width);
  }

  /** A model prop with a box collider of its fitted size. */
  function addProp(key, pos, rotY = 0, { collide = true, surface = null } = {}) {
    const obj = createModelInstance(assets.get(key));
    obj.position.set(...pos);
    obj.rotation.y = rotY;
    scene.add(obj);
    if (collide) {
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const s = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const col = physics.world.createCollider(R.ColliderDesc.cuboid(s.x / 2, s.y / 2, s.z / 2).setTranslation(c.x, c.y, c.z));
      if (surface) weapons.setSurface(col, surface);
      obj.userData.collider = col;
    }
    return obj;
  }

  /** A street lamp (sodium) with a shootable bulb (🌑). */
  const lamps = [];
  function addLamp(pos, { rotY = 0, color = 0xffa54a, intensity = 20, reach = 9, shadow = false, model = true } = {}) {
    if (model) addProp('props.street_lamp', pos, rotY);
    const light = new THREE.PointLight(color, intensity, reach * 1.55, 2);
    // the lamp head hangs out over the street, toward the lamp's facing
    const out = model ? new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).multiplyScalar(1.3) : new THREE.Vector3();
    light.position.set(pos[0] + out.x, pos[1] + 5.2, pos[2] + out.z);
    light.castShadow = shadow;
    scene.add(light);
    const glow = new THREE.Mesh(track(new THREE.SphereGeometry(0.16, 12, 8)), track(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4) })));
    glow.position.copy(light.position);
    scene.add(glow);
    const item = lights.add({ light, bulb: glow, position: light.position, radius: 0.25, reach });
    lamps.push(item);
    return item;
  }

  function addCover(pos, low = false) {
    ai.cover.push({ position: new THREE.Vector3(...pos), low, owner: null });
  }

  const rainVis = rainFX ? new Rain(scene, { count: game.quality === 'low' ? 1800 : 4000 }) : null;
  const prompt = new InteractPrompt();
  // 🌧 ambient life (birds, steam, splashes, embers…): levels dress it via kit.ambient
  const ambient = new AmbientLife(scene, { rain: rainVis });
  ambient.exclude = () => player.collider;
  const kit = {
    rain: rainVis,
    ambient,
    THREE, physics, timeRewind, scene, camera, assets, mats, R, track, player, rig, weapons, fx, hud, ai, shadowStep, fragments, fire, lights,
    addBox, addRamp, addStairs, addProp, addLamp, addCover,
    addFragment: (pos, line) => fragments.add(pos, { line }),
    addFlammable: (pos, size = 0.9, object = null) => fire.addFlammable({ position: new THREE.Vector3(...pos), size, object }),
    addInteractable: (it) => player.addInteractable(it),
    setCheckpoint(pos, yawAt = player.yaw) {
      checkpoint.position.set(...pos);
      checkpoint.yaw = yawAt;
    },
  };
  const level = build(kit) || {};
  // gunshots scare the birds (chained: the AI / the level may hook onShot too)
  const prevOnShot = weapons.onShot;
  weapons.onShot = (muzzle) => {
    ambient.noise(muzzle);
    prevOnShot?.(muzzle);
  };

  // --- UI: help panel, rewind meter -----------------------------------------------------------------------
  let helpEl = null;
  if (help) {
    helpEl = document.createElement('div');
    helpEl.className = 'foot-help';
    helpEl.innerHTML = `<b>${help.title}</b>${help.keys.map(([k, v]) => `<div><span>${k}</span>${v}</div>`).join('')}<div class="foot-help-click">Click to capture the mouse</div>`;
    document.getElementById('ui-root').appendChild(helpEl);
  }
  const meter = document.createElement('div');
  meter.className = 'foot-meter';
  meter.innerHTML = '<div class="foot-meter-label">⏳ REWIND <span>hold R · 3 beats</span></div><div class="foot-meter-bar"><i></i></div>';
  document.getElementById('ui-root').appendChild(meter);
  const meterFill = meter.querySelector('i');

  // --- Esc → leave dialog ----------------------------------------------------------------------------------
  let leaving = false;
  let paused = false;
  const onKey = async (e) => {
    if (e.code !== 'Escape' || leaving || paused || flatlined) return;
    paused = true;
    world.paused = true;
    player.locked = true;
    timeScale.paused = true; // hard freeze behind the dialog
    const ok = await modal.confirm(exitTitle, exitText, [
      { label: 'Keep playing', value: false },
      { label: 'Leave', value: true, primary: true },
    ]);
    timeScale.paused = false;
    player.locked = false;
    world.paused = false;
    setTimeout(() => (paused = false), 0); // the Esc that closed the dialog must not reopen it
    if (ok) {
      leaving = true;
      onExit('menu');
    }
  };
  window.addEventListener('keydown', onKey);
  const canvas = renderer.domElement;
  const onClick = () => !paused && input.requestPointerLock(canvas);
  canvas.addEventListener('click', onClick);

  const rainId = rain ? audio.sfx('rain_heavy', { volume: 0.4 }) : null;

  // --- ⏳ hold R: rewind (3 beats), meter drains -------------------------------------------------------------
  const T = CONFIG.footThemes.time;
  let timeMeter = 1;
  let rewindSound = null;
  const offRecord = physics.onFixedUpdate((dt) => {
    if (!timeRewind.rewinding) timeRewind.record(dt);
  });
  function updateRewind(realDt) {
    const wants = input.isDown('KeyR') && input.heldTime('KeyR') > CONFIG.time.holdToRewind && !player.locked && player.state !== 'dead';
    if (wants && !timeRewind.rewinding && timeMeter > T.minToStart && timeRewind.history.length > 1 && heartbeat.spend(CONFIG.heartbeat.cost.rewind, 'rewind') && timeRewind.start()) {
      game.postfx.setMood('TIME', 0.25);
      game.postfx.setChromaticAberration(0.6, 0.2);
      rewindSound = audio.sfx('reverse_whoosh', { volume: 0.7 });
      audio.sfx('clock_tick', { volume: 0.5, rate: 1.6 });
    }
    if (timeRewind.rewinding) {
      timeMeter = Math.max(0, timeMeter - realDt * T.drainPerSecond);
      const more = timeRewind.step(realDt, T.rewindSpeed);
      if (!wants || !more || timeMeter <= 0) stopRewind();
    } else timeMeter = Math.min(1, timeMeter + realDt * T.refill);
    meterFill.style.transform = `scaleX(${timeMeter.toFixed(3)})`;
    meter.classList.toggle('is-active', timeRewind.rewinding);
  }
  function stopRewind() {
    timeRewind.stop();
    game.postfx.setMood(world.mood ?? 'NEUTRAL', 0.4);
    game.postfx.setChromaticAberration(0, 0.3);
    if (rewindSound != null) audio.stop('sfx', 'reverse_whoosh', rewindSound, 0.2);
    rewindSound = null;
  }

  // --- Loop --------------------------------------------------------------------------------------------------
  function update(dt, elapsed, realDt) {
    if (physics.generation !== physicsGen) return;
    player.inputOverride = world.inputOverride;
    if (!paused) updateRewind(realDt);
    const playerDt = timeRewind.rewinding ? realDt : dt;
    player.update(playerDt);
    const swap = !player.locked && input.wasPressed('KeyQ');
    const look = world.lookOverride ?? (input.lookActive && !paused ? input.mouse : { dx: 0, dy: 0 });
    rig.update(realDt, { target: player.position, height: player.eyeHeight, look, aiming: player.aiming, swap });
    if (!paused) {
      weapons.update(playerDt, realDt);
      shadowStep.update(realDt);
    }
    ai.update(dt);
    fire.update(dt);
    fx.update(dt);
    lights.update(dt);
    fragments.update(dt, player.position);
    heartbeatFX.update(realDt);
    const heat = fire.heatAt(player.position);
    if (heat > 0) player.hurt(CONFIG.fire.damagePerSecond * heat * dt);
    game.postfx.setHeatSources(fire.hazeSources(camera));
    fire.updateLights(camera);
    level.update?.(dt, realDt);
    rainVis?.update(timeRewind.rewinding ? 0 : dt, camera);
    ambient.update(dt, { camera: game.activeCamera ?? camera, realDt, rewinding: timeRewind.rewinding, player: player.position });
    prompt.update(player.focus, camera);
    if (helpEl) helpEl.querySelector('.foot-help-click').style.display = input.mouse.locked ? 'none' : '';
    audio.setListener(camera);
  }

  function applyGraphics(preset) {
    moon.castShadow = preset.shadows;
    moon.shadow.mapSize.setScalar(Math.min(preset.shadowMapSize, 2048));
    moon.shadow.map?.dispose();
    moon.shadow.map = null;
    level.applyGraphics?.(preset);
    ambient.setQuality(game.quality);
  }

  function dispose() {
    if (timeRewind.rewinding) stopRewind();
    level.dispose?.();
    offRecord();
    offPlayerRewind();
    offHeart();
    window.removeEventListener('keydown', onKey);
    canvas.removeEventListener('click', onClick);
    document.exitPointerLock?.();
    if (rainId != null) audio.stop('sfx', 'rain_heavy', rainId, 0.5);
    rainVis?.dispose();
    ambient.dispose();
    prompt.destroy();
    helpEl?.remove();
    meter.remove();
    ai.dispose();
    shadowStep.dispose();
    fragments.dispose();
    fire.clear();
    heartbeatFX.stop();
    game.postfx.setHeatSources([]);
    weapons.dispose();
    fx.dispose();
    hud.destroy();
    lights.clear();
    player.dispose();
    disposables.forEach((d) => d.dispose?.());
    if (physics.generation === physicsGen) physics.clear();
    timeScale.paused = false;
    timeScale.set(1, 0.01);
  }

  /** Gameplay HUD on/off (cutscenes). */
  function setHudVisible(v) {
    hud.setVisible(v);
    meter.style.visibility = v ? '' : 'hidden';
  }

  return Object.assign(world, {
    setHudVisible,
    scene, camera, update, applyGraphics, dispose, player, rig, weapons, fx, hud, ai, shadowStep, fragments,
    fire, lights, heartbeat, kit, level, checkpoint, respawnAtCheckpoint, lamps, rain: rainVis, ambient,
  });
}

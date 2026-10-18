// =============================================================================
// FLATLINE: 2050 — main.js
// Boot order:
//   renderer → loading screen (physics WASM, fonts, assets) → garage world
//   → "click to begin" → boot intro → main menu
//
// URL flags: ?test (Phase 0 test scene) · ?unlock (all missions)
//            ?cutscene=test (play the Phase 2 test cutscene right after the gate)
//            ?gallery (every downloaded model at real-world size)
//            ?race (straight into the Phase 3 race after the gate)
//            ?m1 … ?m8 (straight into that mission after the gate) · ?ending · ?trailer (or F9 on the menu)
//            ?foot (on-foot sandbox: controller, guns, abilities)
//            ?combat (Phase 8 combat test: six enforcers)
//            ?run (straight into THE RUN, the bonus story runner in Mission Select)
//            ?teaser · ?reel (the Settings → Media videos; dev: &from=<section> jumps in)
// =============================================================================

import gsap from 'gsap';
import { CONFIG } from './config.js';
import { game } from './core/game.js';
import { physics } from './core/physics.js';
import { input } from './core/input.js';
import { audio } from './core/audio.js';
import { timeScale } from './core/timeScale.js';
import { initLoader, preload, getMissingAssets } from './assets/loader.js';
import { PRELOAD } from './assets/manifest.js';
import { LoadingScreen } from './assets/loadingScreen.js';
import { settings } from './systems/settings.js';
import { getMission } from './missions/missionData.js';
import { DebugOverlay } from './ui/debugOverlay.js';
import { BootIntro } from './ui/bootIntro.js';
import { MainMenu } from './ui/mainMenu.js';
import { screenFade } from './ui/screenFade.js';
import { createGarageScene } from './scenes/garageScene.js';
import { createTestScene } from './dev/testScene.js';
import { createAssetGallery } from './dev/assetGallery.js';
import { createRaceScene } from './scenes/raceScene.js';
import { playMission1 } from './missions/m1_lastLap.js';
import { playMission2 } from './missions/m2_wakeInTheRain.js';
import { playMission3 } from './missions/m3_ashesSpeak.js';
import { playMission4 } from './missions/m4_snipersClock.js';
import { playMission5 } from './missions/m5_manWithMyFace.js';
import { playMission6 } from './missions/m6_cityOnFire.js';
import { playMission7 } from './missions/m7_reverseChase.js';
import { playMission8 } from './missions/m8_flatline.js';
import { playEnding } from './missions/ending.js';
import { playTrailer } from './missions/trailer.js';
import { playRun } from './runner/playRun.js';
import { playShowcase, startRecorder } from './showcase/index.js';
import { createFootSandbox, FOOT_SANDBOX_ASSETS } from './dev/footSandbox.js';
import { createCombatArena, COMBAT_ARENA_ASSETS } from './dev/combatArena.js';
import { cutscenes } from './cutscenes/cutscenePlayer.js';
import { missionCard } from './ui/missionCard.js';
import testCutscene from './cutscenes/scripts/testCutscene.js';

// Intro cutscene per mission. Phase 4+ replaces these with the real ones.
const INTRO_CUTSCENES = { 1: testCutscene };
// Playable missions (each resolves when it ends on a black screen)
const MISSION_PLAYERS = { 1: playMission1, 2: playMission2, 3: playMission3, 4: playMission4, 5: playMission5, 6: playMission6, 7: playMission7, 8: async () => {
  // the finale flows straight into the ending + credits
  const r = await playMission8();
  if (r?.completed) await playEnding();
  return r;
} };

// Shared app state: menu assets are kept so the garage can be rebuilt after a race.
const app = { menuAssets: null, garage: null, menu: null };

// UI and cutscene animations follow the real clock, even on slow frames, so
// they stay in sync with audio (GSAP's default "lag smoothing" would slow them).
gsap.ticker.lagSmoothing(0);

// Dev only: handles for the browser console / automated tests (stripped from builds).
if (import.meta.env.DEV) window.__flatline = { game, cutscenes, gsap, CONFIG, input };

const params = new URLSearchParams(location.search);
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

function fatal(message) {
  const el = document.createElement('div');
  el.className = 'fatal';
  el.textContent = message;
  document.body.appendChild(el);
}

/** Wait for the UI font so canvas text (garage sign) and layout measure correctly. */
function loadFonts() {
  const fonts = Promise.all(['400', '600', '700'].map((w) => document.fonts.load(`${w} 32px Rajdhani`)));
  return Promise.race([fonts, wait(3)]).catch(() => {});
}

/** Keep audio, graphics and the FPS counter in sync with the saved settings. */
function bindSettings(debug) {
  const apply = (key, value) => {
    switch (key) {
      case 'graphics': game.applyGraphics(value); break;
      case 'masterVolume': audio.setVolume('master', value); break;
      case 'musicVolume': audio.setVolume('music', value); break;
      case 'sfxVolume': audio.setVolume('sfx', value); break;
      case 'voiceVolume': audio.setVolume('voice', value); break;
      case 'showFps': debug.setVisible(value); break;
    }
  };
  Object.entries(settings.values).forEach(([k, v]) => apply(k, v));
  settings.onChange(apply);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') settings.set('showFps', !settings.get('showFps'));
  });
}

async function boot() {
  try {
    game.init();
  } catch (err) {
    console.error(err);
    fatal('FLATLINE: 2050 needs WebGL 2. Please update your browser or graphics drivers.');
    return;
  }
  initLoader(game.renderer);

  const loading = new LoadingScreen();
  loading.show();

  // Physics WASM + fonts = first 20% of the bar.
  await Promise.all([physics.init(), loadFonts()]);
  loading.setProgress(0.2);

  if (params.has('gallery')) {
    const gallery = await createAssetGallery(game.renderer);
    game.setWorld(gallery);
    bindSettings(new DebugOverlay());
    game.start();
    await loading.hide();
    return;
  }

  const testMode = params.has('test');
  const assets = await preload(testMode ? PRELOAD.testScene : PRELOAD.menu, (p) => loading.setProgress(0.2 + p * 0.8));

  const debug = new DebugOverlay();
  game.onFrame((realDt) => debug.update(realDt));
  if (testMode) return runTestScene(assets, loading, debug);

  // ---------------------------------------------------------------------------
  // Garage + intro + menu
  // ---------------------------------------------------------------------------
  const garage = createGarageScene(game.renderer, assets);
  app.menuAssets = assets;
  app.garage = garage;
  game.setWorld(garage);
  bindSettings(debug);
  game.renderOnce(); // compile shaders under the loading screen
  game.start();
  await loading.hide();

  const intro = new BootIntro({ garage });
  await intro.waitForGesture();
  const menu = new MainMenu({ garage, onStartMission: (n) => startMission(n, menu), onPlayRun: () => startRun(menu), onWatch: (video, opts) => watchVideo(video, opts) });
  app.menu = menu;

  // Trailer Mode (Phase 12): F9 on the main menu
  window.addEventListener('keydown', async (e) => {
    if (e.code !== 'F9' || !menu.active || app.trailer || app.showcase) return;
    app.trailer = true;
    await menu.hide();
    audio.stopMusic(0.8);
    await playTrailer();
    await backToGarageMenu();
    app.trailer = false;
  });

  const devMission = [1, 2, 3, 4, 5, 6, 7, 8].find((n) => params.has(`m${n}`) && MISSION_PLAYERS[n]);
  if (params.has('trailer')) {
    intro.destroy();
    await screenFade.toBlack(0.01);
    await playTrailer();
    await backToGarageMenu();
  } else if (params.has('teaser') || params.has('reel')) {
    intro.destroy();
    await screenFade.toBlack(0.01);
    app.showcase = true;
    await playShowcase(params.has('teaser') ? 'teaser' : 'reel', { from: params.get('from') });
    if (import.meta.env.DEV) document.body.dataset.clipDone = '1'; // .dev/missionclips.mjs
    await backToGarageMenu();
    app.showcase = false;
  } else if (params.has('ending')) {
    intro.destroy();
    await screenFade.toBlack(0.01);
    await playEnding();
    if (import.meta.env.DEV) document.body.dataset.clipDone = '1'; // .dev/missionclips.mjs
    await backToGarageMenu();
  } else if (params.has('run')) {
    intro.destroy();
    await screenFade.toBlack(0.01);
    await runTheRun();
    await backToGarageMenu();
  } else if (devMission) {
    intro.destroy();
    await screenFade.toBlack(0.01);
    await MISSION_PLAYERS[devMission]();
    if (import.meta.env.DEV) document.body.dataset.clipDone = '1'; // .dev/missionclips.mjs
    await backToGarageMenu();
  } else if (params.has('foot') || params.has('combat')) {
    // Dev shortcuts: the on-foot sandbox / the Phase 8 combat arena.
    intro.destroy();
    await screenFade.toBlack(0.01);
    await runDevWorld(params.has('combat') ? createCombatArena : createFootSandbox, params.has('combat') ? COMBAT_ARENA_ASSETS : FOOT_SANDBOX_ASSETS);
  } else if (params.has('race')) {
    // Dev shortcut: straight into the race.
    intro.destroy();
    await screenFade.toBlack(0.01);
    await runRace();
  } else if (params.get('cutscene') === 'test') {
    // Dev shortcut: straight into the test cutscene, then the menu.
    intro.destroy();
    garage.setPowered();
    garage.setAtmosphere({ embers: 1, smoke: 1 });
    await screenFade.toBlack(0.01);
    await playMissionIntro(1);
    await returnToMenu(menu);
  } else {
    await intro.play();
    garage.powerOn(2.6);
    await menu.show({ introTitle: intro.titleEl });
    intro.destroy();
  }

  const missing = getMissingAssets();
  if (missing.length) console.info(`[FLATLINE] ${missing.length} asset(s) using placeholders:`, missing);
}

/**
 * Start a mission: intro cutscene → mission card → gameplay.
 * Mission 1 "Last Lap" is fully playable (Phase 4). Later missions show a
 * placeholder note until their phase is built.
 */
async function startMission(number, menu) {
  await menu.hide();
  audio.stopMusic(1.5);
  audio.sfx('heartbeat');
  await screenFade.toBlack(0.9);
  if (MISSION_PLAYERS[number]) {
    // The story campaign: a completed mission flows straight into the next one
    // (8 ends in the ending + credits). Quitting or failing returns to the menu.
    for (let n = number; n <= 8 && MISSION_PLAYERS[n]; n++) {
      const r = await MISSION_PLAYERS[n](); // ends on black (or the player left via Esc)
      audio.stopMusic(0.5);
      if (!r?.completed) break;
    }
    return backToGarageMenu();
  }
  await playMissionIntro(number);

  const mission = getMission(number);
  screenFade.setText(
    `Mission ${String(number).padStart(2, '0')} · ${mission.year}`,
    mission.name.toUpperCase(),
    `Gameplay arrives in ${mission.buildPhase} — returning to the menu`,
  );
  await wait(2.6);
  await returnToMenu(menu);
}

// -----------------------------------------------------------------------------
// THE RUN (bonus mode in Mission Select): the 3-act story runner (runner/playRun.js)
// -----------------------------------------------------------------------------
async function startRun(menu) {
  if (app.running) return;
  await menu.hide();
  audio.stopMusic(1.5);
  audio.sfx('heartbeat');
  await screenFade.toBlack(0.9);
  await runTheRun();
  return backToGarageMenu();
}

/** Play THE RUN on a black screen; always ends on black (finished, quit or failed). */
async function runTheRun() {
  app.running = true;
  try {
    await playRun();
  } catch (err) {
    console.error('[FLATLINE] THE RUN failed:', err);
    await screenFade.toBlack(0.3);
  }
  audio.stopMusic(0.5);
  app.running = false;
}

// -----------------------------------------------------------------------------
// Settings → Media: the in-engine Story Teaser / Gameplay Overview (showcase/)
// -----------------------------------------------------------------------------
async function watchVideo(video, { record = false } = {}) {
  if (app.showcase || app.trailer || app.running) return;
  app.showcase = true;
  // the tab-recording permission must be asked inside the click itself
  const recorder = record ? startRecorder() : null;
  await app.menu.hide();
  audio.stopMusic(0.8);
  await screenFade.toBlack(0.6);
  await playShowcase(video, { recorder });
  await backToGarageMenu();
  app.showcase = false;
}

/** Intro cutscene + mission card (the cutscene shows the card itself). */
async function playMissionIntro(number) {
  const script = INTRO_CUTSCENES[number];
  if (script) await cutscenes.play(script);
  else await missionCard.show(getMission(number), { postfx: game.postfx });
}

// -----------------------------------------------------------------------------
// The 2050 race (Phase 3)
// -----------------------------------------------------------------------------
/** Load and start the race. Expects the screen to be black. */
async function runRace() {
  const loading = new LoadingScreen();
  loading.show();
  const assets = await preload(PRELOAD.race, (p) => loading.setProgress(p));
  const world = createRaceScene(game.renderer, assets, { onExit: (choice) => exitRace(choice) });
  game.setWorld(world);
  game.renderOnce();
  await loading.hide();
  await screenFade.fromBlack(0.8);
  await world.start();
}

// -----------------------------------------------------------------------------
// Dev worlds: the on-foot sandbox (Phases 5–7) and the combat arena (Phase 8)
// -----------------------------------------------------------------------------
async function runDevWorld(create, ids) {
  const loading = new LoadingScreen();
  loading.show();
  const assets = await preload(ids, (p) => loading.setProgress(p));
  const world = create(game.renderer, assets, {
    onExit: async () => {
      await screenFade.toBlack(0.6);
      backToGarageMenu();
    },
  });
  game.setWorld(world);
  game.renderOnce();
  await loading.hide();
  await screenFade.fromBlack(0.8);
}

/** Leave the race: race again, or rebuild the garage and show the menu. */
async function exitRace(choice) {
  audio.stopMusic(1);
  await screenFade.toBlack(0.6);
  if (choice === 'retry') return runRace();
  return backToGarageMenu();
}

/** Rebuild the menu garage (the screen is black) and bring the menu back. */
async function backToGarageMenu() {
  const garage = createGarageScene(game.renderer, app.menuAssets);
  game.setWorld(garage);
  garage.setPowered();
  garage.setAtmosphere({ embers: 1, smoke: 1 });
  app.garage = garage;
  app.menu.garage = garage;
  await returnToMenu(app.menu);
}

async function returnToMenu(menu) {
  audio.playMusic('main_theme', 3);
  await screenFade.fromBlack(1);
  await menu.show();
}

// -----------------------------------------------------------------------------
// Phase 0 test scene (?test): physics, bloom, moods, slow-mo, graphics
// -----------------------------------------------------------------------------
const MOOD_KEYS = { Digit1: 'FIRE', Digit2: 'SHADOWS', Digit3: 'TIME', Digit0: 'NEUTRAL' };
const QUALITY_ORDER = ['low', 'medium', 'high'];

async function runTestScene(assets, loading, debug) {
  const world = createTestScene(game.renderer, assets);
  world.applyGraphics = (preset) => {
    world.key.castShadow = preset.shadows;
    world.key.shadow.mapSize.setScalar(preset.shadowMapSize);
    world.key.shadow.map?.dispose();
    world.key.shadow.map = null;
  };
  game.setWorld(world);
  bindSettings(debug);
  debug.setVisible(true);

  const missingCount = getMissingAssets().length;
  debug.setHelp(
    `<b>FLATLINE: 2050 — Phase 0 test scene</b><br>` +
      `Drag: orbit · Wheel: zoom<br>` +
      `<b>1</b> FIRE · <b>2</b> SHADOWS · <b>3</b> TIME · <b>0</b> NEUTRAL (color grade)<br>` +
      `<b>T</b> slow-mo (timeScale 0.15) · <b>Space</b> drop Kael again · <b>G</b> graphics · <b>F3</b> FPS` +
      (missingCount ? `<br><span class="warn">${missingCount} asset(s) missing → placeholders (see console)</span>` : ''),
  );

  game.onFrame(() => {
    for (const [code, mood] of Object.entries(MOOD_KEYS)) {
      if (input.wasPressed(code)) game.postfx.setMood(mood);
    }
    if (input.wasPressed('KeyT')) {
      const slow = timeScale.scale > 0.5;
      timeScale.set(slow ? CONFIG.time.crashSlowMo : 1, 0.4);
      game.postfx.setChromaticAberration(slow ? 0.6 : 0);
    }
    if (input.wasPressed('Space')) world.respawnKael();
    if (input.wasPressed('KeyG')) {
      const next = QUALITY_ORDER[(QUALITY_ORDER.indexOf(game.quality) + 1) % QUALITY_ORDER.length];
      settings.set('graphics', next);
    }
    debug.setInfo(`${game.quality.toUpperCase()} · ${game.postfx.mood} · x${timeScale.scale.toFixed(2)}`);
  });

  game.renderOnce();
  game.start();
  await loading.hide();
}

boot().catch((err) => {
  console.error('[FLATLINE] boot failed:', err);
  fatal(`Boot failed: ${err.message}`);
});

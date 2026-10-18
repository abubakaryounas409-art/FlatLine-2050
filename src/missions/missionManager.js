// =============================================================================
// FLATLINE: 2050 — missions/missionManager.js
// Runs a 2020 mission the same way every time (CLAUDE.md Phase 9):
//
//   intro cutscene → mission card → gameplay with checkpoints → outro cutscene
//   → mission complete screen (time, accuracy, heartbeats, rank) → save
//
//   await runMission({
//     number: 2,
//     assets: [...ids],
//     create: (assets, ctx) => world,       // usually createOnFootWorld(...)
//     intro: (world) => cutsceneScript,     // optional
//     outro: (world) => cutsceneScript,     // optional
//     parTime: 360,
//   })
//
// The level calls ctx.complete() when its last objective is done. Esc → Leave
// resolves the mission as abandoned. Resolves to { completed, rank }.
// =============================================================================

import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { preload } from '../assets/loader.js';
import { LoadingScreen } from '../assets/loadingScreen.js';
import { cutscenes } from '../cutscenes/cutscenePlayer.js';
import { missionCard } from '../ui/missionCard.js';
import { missionComplete } from '../ui/missionComplete.js';
import { objectives } from '../ui/objectiveHUD.js';
import { screenFade } from '../ui/screenFade.js';
import { saveGame } from '../systems/saveGame.js';
import { heartbeat } from '../systems/heartbeat.js';
import { getMission } from './missionData.js';
import { award } from '../ui/achievementToast.js';

export async function runMission({ number, assets: ids, create, intro = null, outro = null, parTime = 300, music = null }) {
  const mission = getMission(number);
  saveGame.startMission(number);
  const loading = new LoadingScreen();
  loading.show();
  const assets = await preload(ids, (p) => loading.setProgress(p));

  let finish;
  const outcome = new Promise((r) => (finish = r));
  const ctx = {
    mission,
    complete: () => finish({ completed: true }),
    fail: () => finish({ completed: false, failed: true }),
  };
  const world = create(assets, { ...ctx, onExit: () => finish({ completed: false }) });
  game.setWorld(world);
  world.player.locked = true;
  world.setHudVisible?.(false);
  // build the intro first, then compile every shader under the loading screen (no hitch when it starts)
  const script = intro ? intro(world) : null;
  await game.renderer.compileAsync?.(world.scene, world.camera).catch(() => {});
  game.renderOnce();
  await loading.hide();

  // --- intro + card -------------------------------------------------------------------------
  if (script) {
    await cutscenes.play(script, { world });
    if (!script.missionCard) await missionCard.show(mission, { postfx: game.postfx });
  } else {
    await missionCard.show(mission, { postfx: game.postfx });
  }
  await screenFade.fromBlack(0.6);
  world.setHudVisible?.(true);
  world.player.locked = false;
  if (music) audio.playMusic(music, 2);
  const startTime = performance.now();
  world.level?.start?.();
  if (import.meta.env.DEV) window.__flatlineMission = { ...ctx, world }; // dev: tests can skip to the outro

  // --- play --------------------------------------------------------------------------------------
  const result = await outcome;
  const time = (performance.now() - startTime) / 1000;
  objectives.destroy(); // no objective / hint over the outro
  if (!result.completed) {
    audio.stopMusic(0.6);
    await screenFade.toBlack(0.6);
    objectives.destroy();
    return result;
  }

  // --- outro + stats ------------------------------------------------------------------------------
  world.player.locked = true;
  world.setHudVisible?.(false);
  if (outro) await cutscenes.play(outro(world), { world });
  audio.stopMusic(1.2);
  await screenFade.toBlack(0.6);
  objectives.destroy();
  const st = world.weapons?.stats ?? { shots: 0, hits: 0 };
  const accuracy = st.shots ? st.hits / st.shots : 1;
  const { rank } = await missionComplete.show(mission, { time, parTime, accuracy, beats: heartbeat.beats, maxBeats: heartbeat.max });
  saveGame.completeMission(number);
  saveGame.recordRank?.(number, rank);
  if (heartbeat.beats >= 50) award('heart_of_steel');
  if (number === 2 && !world.ai?.enemies.some((e) => e.everAlerted)) award('ghost');
  return { completed: true, rank };
}

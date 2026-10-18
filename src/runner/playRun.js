// =============================================================================
// FLATLINE: 2050 — runner/playRun.js
// THE RUN: the ~3-minute story run that NEW GAME starts. Kael lies in a coma
// after the 2050 crash and runs through his dying memory, one power per act:
//
//   cold open    black cards: FINAL LAP → 20.20.20 → crash → the monitor slows
//   intro        the burning wreck, Kael on the track, the Clockmaker's radio
//   ACT I   ⏳   2050 · the Neon Velodrome   (Time Stop)
//   ACT II  🌑   2020 · rain rooftops        (Shadow Phase, Umbra runs beside him)
//   ACT III 🔥   20:20 · the burning factory (Burn, Victor and the gas can)
//   finale       the powers fail; hold W to walk into the fire, past Umbra, to Elias
//   epilogue     flatline… beep… he wakes in 2050, Victor arrested, 20:20 → 20:21
//   results      rank S/A/B/C + achievements, then the post-credit radio line
//
//   await playRun();   // call on a black screen; resolves on black (finished or quit)
//
// The world (runnerWorld.js) owns every visual and the gameplay; this file is
// the director: cards, dialogue, music, pause, results.
// =============================================================================

import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { game } from '../core/game.js';
import { audio } from '../core/audio.js';
import { timeScale } from '../core/timeScale.js';
import { input } from '../core/input.js';
import { preload } from '../assets/loader.js';
import { LoadingScreen } from '../assets/loadingScreen.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { screenFade } from '../ui/screenFade.js';
import { gameOver } from '../ui/gameOver.js';
import { modal } from '../ui/modal.js';
import { award, ACHIEVEMENTS } from '../ui/achievementToast.js';
import { glitchText } from '../vfx/glitchFX.js';
import { createRunnerWorld, RUN_ASSETS } from './runnerWorld.js';

// Sounds the director itself plays (loaded alongside RUN_ASSETS).
const DIRECTOR_SFX = [
  'heartbeat', 'monitor_beep', 'flatline', 'clock_tick', 'reverse_whoosh', 'crowd_cheer', 'fireworks', 'radio_static',
  'ui_click', 'ui_glitch', 'explosion', 'fire_loop', 'car_crash', 'glass_shatter', 'whoosh', 'scifi_beep',
];
const DIRECTOR_ASSETS = [
  ...DIRECTOR_SFX.map((k) => `sfx.${k}`),
  'voice.m1_commentator_01',
  'music.race_2050', 'music.city_rain_2020', 'music.combat', 'music.umbra', 'music.ending',
];

// Rank: beats left weigh most, then score, then a clean run.
const RANK = {
  weights: { beats: 55, score: 25, clean: 20 },
  scoreTarget: 25000,   // score that earns the full score share
  crashesForZero: 6,    // this many crashes = no "clean" share
  thresholds: [['S', 85], ['A', 68], ['B', 48]], // else C
};

// Act title cards (the act data itself lives in CONFIG.runner.acts).
const ACT_CARDS = [
  { act: 'time', icon: '⏳', k: 'ACT I · 2050', sub: 'POWER: ⏳ TIME STOP — press R to freeze what moves' },
  { act: 'shadows', icon: '🌑', k: 'ACT II · 2020', sub: 'NEW POWER: 🌑 SHADOW PHASE — press Q' },
  { act: 'fire', icon: '🔥', k: 'ACT III · 20:20', sub: 'NEW POWER: 🔥 BURN — press E' },
];

const FLATLINE_REASONS = [
  'His heart stopped on the track in 2050.',
  'His heart stopped in the rain of 2020.',
  'His heart stopped in the fire, at 20:20.',
];

// -----------------------------------------------------------------------------
// Dialogue. id (from course.js) → [speaker, text, seconds]. Speaker keys are
// CONFIG.cutscene.speakers keys, so names get their colours.
// -----------------------------------------------------------------------------
const STORY = {
  // ACT I ⏳ TIME — 2050, the Neon Velodrome
  time_start: [
    ['clockmaker', 'This is your last lap, Kael. Replayed by a dying brain.', 3.4],
    ['clockmaker', 'Every beat you lose here, your body loses in 2050.', 3.4],
  ],
  time_victor: [
    ['commentator', 'And up in the VIP box — league owner Victor Hale!', 3.2],
    ['kael', 'He was smiling. Before the brakes went.', 3],
  ],
  time_tutorial: [
    ['clockmaker', 'Time is the one thing you still own. Stop it. Press R.', 3.6],
  ],
  time_ghosts: [
    ['clockmaker', 'Ghosts of the crash. Same lap, same mistake. Freeze them.', 3.4],
  ],
  time_end: [
    ['clockmaker', 'The track ends where your memory breaks. Go through.', 3.2],
    ['kael', 'Where does it take me?', 2.4],
    ['clockmaker', '2020. The year your father burned.', 3],
  ],

  // ACT II 🌑 SHADOWS — 2020, rain rooftops
  shadow_start: [
    ['clockmaker', 'Rain. Rooftops. The city the year it all began.', 3.2],
  ],
  shadow_umbra: [
    ['umbra', 'Running again, Kael? You were always good at that.', 3.4],
    ['kael', 'Who — what are you?', 2.4],
    ['umbra', 'Your guilt. Your shadow. Your face.', 3],
  ],
  shadow_tutorial: [
    ['clockmaker', 'Light can\'t hold a shadow. Press Q and pass through.', 3.4],
  ],
  shadow_mara: [
    ['mara', 'All units, rooftop runner heading east. Hale\'s men are armed.', 3.6],
    ['mara', 'Whoever you are — they want you dead more than I do.', 3.4],
  ],
  shadow_umbra2: [
    ['umbra', 'You were seven. You watched from the car. You did nothing.', 3.6],
    ['kael', 'I was a kid.', 2],
    ['umbra', 'You still are.', 2.4],
  ],
  shadow_end: [
    ['clockmaker', 'The clock reads 20:19. One minute until the fire.', 3.4],
  ],

  // ACT III 🔥 FIRE — the burning factory at 20:20
  fire_start: [
    ['clockmaker', 'The factory. 20:20. This is the night that made you.', 3.4],
    ['kael', 'Dad\'s still in there.', 2.4],
  ],
  fire_tutorial: [
    ['clockmaker', 'Fire made your past. Now use it. Press E — burn through.', 3.6],
  ],
  fire_victor: [
    ['victor', 'No evidence, no partner. The engine is mine now.', 3.4],
    ['kael', 'Victor. With the gas can.', 2.6],
  ],
  fire_heart: [
    ['clockmaker', 'Your heart is failing, Kael. Faster.', 3],
    ['umbra', 'Turn around. Running away is what you do.', 3.2],
  ],
  fire_end: [
    ['elias', 'Kael? …Is that you?', 2.8],
  ],
};

// The intro on the track (seconds from the moment the picture fades in).
const INTRO_LINES = [
  [1.2, 'clockmaker', 'Kael. Can you hear me? Don\'t answer. Just listen.', 3.4],
  [4.8, 'clockmaker', 'That wreck is 2050. Your body is in it. Barely.', 3.4],
  [8.4, 'clockmaker', 'Seventy-two heartbeats. Then the monitor goes flat.', 3.2],
  [11.8, 'clockmaker', 'Time. Shadow. Fire. Each memory gives you one.', 3.2],
  [15.0, 'clockmaker', 'Get up, racer. Run.', 2.4],
];

// Finale beats: k = walk progress 0..1.
const FINALE_LINES = [
  [0.0, 'clockmaker', 'No powers here, Kael. Not time, not shadow, not fire.', 3.6],
  [0.1, 'clockmaker', 'Only you. Hold W. Walk into it. Don\'t run.', 3.4],
  [0.24, 'umbra', 'You ran from the fire. You\'ll always run.', 3.6],
  [0.42, 'kael', 'Not this time.', 2.6],
  [0.56, 'umbra', 'It will burn you like it burned him.', 3.2],
  [0.7, 'kael', 'Then let it. I\'m not leaving him again.', 3.2],
  [0.86, 'elias', 'Kael… my boy.', 2.6],
];

const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const uiRoot = () => document.getElementById('ui-root');

/** Any key / click skips, but only after `armAfter` seconds. */
function makeSkipper(armAfter = 2) {
  let done;
  const s = { skipped: false, promise: new Promise((r) => (done = r)) };
  const armedAt = performance.now() + armAfter * 1000;
  const onInput = (e) => {
    if (e.repeat || performance.now() < armedAt || s.skipped) return;
    s.skipped = true;
    done();
  };
  window.addEventListener('keydown', onInput);
  window.addEventListener('pointerdown', onInput);
  s.wait = (sec) => (s.skipped ? Promise.resolve() : Promise.race([wait(sec), s.promise]));
  s.dispose = () => {
    window.removeEventListener('keydown', onInput);
    window.removeEventListener('pointerdown', onInput);
  };
  return s;
}

/**
 * Non-blocking dialogue queue: lines play one after another, never on top of
 * each other. Radio speakers (Clockmaker, Mara) get a crackle.
 */
class LineQueue {
  constructor() {
    this.lines = [];
    this.call = null;
  }

  push(lines, { front = false } = {}) {
    if (front) this.lines.unshift(...lines);
    else this.lines.push(...lines);
    if (!this.call) this._next();
  }

  /** Show a line right now (drops nothing from the queue). */
  say(speaker, text, seconds) {
    if (speaker === 'clockmaker' || speaker === 'mara') audio.sfx('radio_static', { volume: 0.22 });
    subtitles.show(speaker, text, seconds);
  }

  _next() {
    const line = this.lines.shift();
    if (!line) {
      this.call = null;
      return;
    }
    const [speaker, text, seconds] = line;
    this.say(speaker, text, seconds);
    this.call = gsap.delayedCall(seconds + 0.25, () => this._next());
  }

  clear() {
    this.lines.length = 0;
    this.call?.kill();
    this.call = null;
    subtitles.clear(0.2);
  }
}

/** The act / RUN title card over the 3D view (styled by .run-card in style.css). */
function showCard({ act, icon, k, title, sub }, hold = 2.2) {
  const el = document.createElement('div');
  el.className = 'run-card';
  el.dataset.act = act;
  el.innerHTML = `<div class="run-card-icon"></div><div class="run-card-k"></div><h1 class="run-card-title"></h1><div class="run-card-sub"></div>`;
  el.querySelector('.run-card-icon').textContent = icon ?? '';
  el.querySelector('.run-card-k').textContent = k ?? '';
  const titleEl = el.querySelector('.run-card-title');
  titleEl.textContent = title;
  titleEl.dataset.text = title;
  el.querySelector('.run-card-sub').textContent = sub ?? '';
  uiRoot().appendChild(el);
  audio.sfx('ui_glitch', { volume: 0.7 });

  const tl = gsap.timeline();
  tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.3 });
  tl.fromTo(titleEl, { letterSpacing: '0.5em', scale: 1.15 }, { letterSpacing: '0.16em', scale: 1, duration: 0.7, ease: 'power3.out' }, 0);
  tl.fromTo(el.querySelectorAll('.run-card-icon, .run-card-k, .run-card-sub'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.1 }, 0.15);
  tl.call(() => glitchText(titleEl, 0.4), null, 0.35);
  tl.to(el, { opacity: 0, duration: 0.5, ease: 'power2.in' }, 0.7 + hold);
  return { el, done: tl.then(() => el.remove()) };
}

function rankFor(stats, beatsLeft, maxBeats) {
  const w = RANK.weights;
  const points =
    clamp01(beatsLeft / maxBeats) * w.beats +
    clamp01((stats.score ?? 0) / RANK.scoreTarget) * w.score +
    clamp01(1 - (stats.crashes ?? 0) / RANK.crashesForZero) * w.clean;
  return RANK.thresholds.find(([, min]) => points >= min)?.[0] ?? 'C';
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Results screen (.run-results). Resolves on CONTINUE / Enter / Space. */
function showResults(stats, beatsLeft, maxBeats, earned) {
  const rank = rankFor(stats, beatsLeft, maxBeats);
  const p = stats.powersUsed ?? {};
  const rows = [
    ['SCORE', Math.floor(stats.score ?? 0).toLocaleString('en-US')],
    ['SHARDS', stats.shards ?? 0],
    ['DISTANCE', `${Math.round(stats.distance ?? 0).toLocaleString('en-US')} m`],
    ['CLOSE CALLS', stats.closeCalls ?? 0],
    ['HEARTBEATS LEFT', `${Math.max(0, Math.round(beatsLeft))} / ${maxBeats}`],
    ['REWINDS', stats.rewinds ?? 0],
    ['POWERS USED', `⏳${p.time ?? 0} 🌑${p.shadow ?? 0} 🔥${p.fire ?? 0}`],
    ['TIME', fmtTime(stats.time ?? 0)],
  ];

  const el = document.createElement('div');
  el.className = 'run-results';
  el.innerHTML = `
    <div class="run-results-k">KAEL RAYNE · STATUS: AWAKE</div>
    <h1 class="run-results-title">THE RUN</h1>
    <div class="run-results-rank" data-rank="${rank}">${rank}</div>
    <div class="run-results-stats">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('')}</div>
    <ul class="run-results-ach">${earned.map((id) => `<li title="${ACHIEVEMENTS[id].text}">${ACHIEVEMENTS[id].name}</li>`).join('')}</ul>
    <div class="run-results-hint">PRESS ENTER TO CONTINUE</div>
    <button type="button" class="run-results-btn">CONTINUE</button>`;
  uiRoot().appendChild(el);

  const tl = gsap.timeline();
  tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.6 });
  tl.fromTo(el.querySelectorAll('.run-results-k, .run-results-title'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.12 }, 0.2);
  tl.fromTo(el.querySelectorAll('.run-results-stats > div'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.07 }, 0.5);
  tl.fromTo(el.querySelector('.run-results-rank'), { opacity: 0, scale: 2.4 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' }, 1.2);
  tl.call(() => audio.sfx('explosion', { volume: 0.35, rate: 1.4 }), null, 1.3);
  tl.fromTo(el.querySelectorAll('.run-results-ach > li, .run-results-hint, .run-results-btn'), { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.08 }, 1.6);

  const shownAt = performance.now();
  return new Promise((resolve) => {
    const btn = el.querySelector('.run-results-btn');
    let done = false;
    const finish = () => {
      if (done || performance.now() - shownAt < 800) return;
      if (tl.progress() < 1) return void tl.progress(1);
      done = true;
      window.removeEventListener('keydown', onKey);
      audio.sfx('ui_click', { volume: 0.6 });
      gsap.to(el, { opacity: 0, duration: 0.5, onComplete: () => el.remove() });
      resolve(rank);
    };
    const onKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') {
        e.preventDefault();
        finish();
      }
    };
    btn.addEventListener('click', finish);
    window.addEventListener('keydown', onKey);
    setTimeout(() => btn.focus({ preventScroll: true }), 900);
  });
}

// =============================================================================
// THE RUN
// =============================================================================
export async function playRun() {
  timeScale.reset();
  const cleanups = []; // run on exit, in reverse
  const queue = new LineQueue();
  cleanups.push(() => queue.clear());

  // Start loading at once: the cold-open cards play while assets stream in.
  let loadProgress = 0;
  const assetsPromise = preload([...RUN_ASSETS, ...DIRECTOR_ASSETS], (p) => (loadProgress = p));
  // The cold open only needs a handful of small sounds.
  await Promise.race([
    Promise.all(['heartbeat', 'monitor_beep', 'crowd_cheer', 'car_crash', 'glass_shatter', 'ui_glitch'].map((k) => audio.load('sfx', k))),
    wait(2.5),
  ]);
  audio.load('voice', 'm1_commentator_01');

  // ---------------------------------------------------------------------------
  // 1. Cold open on black: the final lap, the crash, the monitor slowing.
  // ---------------------------------------------------------------------------
  await screenFade.toBlack(0.01);
  {
    const skip = makeSkipper(2);
    audio.sfx('crowd_cheer', { volume: 0.55 });
    screenFade.setText('2050 · NEON VELODROME', 'FINAL LAP', 'World Grand Prix · 200,000 watching');
    await skip.wait(0.9);
    if (!skip.skipped) {
      audio.play('voice', 'm1_commentator_01');
      subtitles.show('commentator', 'Kael Rayne, undefeated… one lap from history.', 3.2);
    }
    await skip.wait(3.4);
    if (!skip.skipped) {
      audio.sfx('ui_glitch', { volume: 0.9 });
      screenFade.setText('', '20.20.20', 'BRAKE FAILURE');
      glitchText(screenFade.el?.querySelector('.screen-fade-title'), 0.8);
    }
    await skip.wait(1.4);
    if (!skip.skipped) {
      screenFade.setText();
      audio.sfx('car_crash', { volume: 1 });
      audio.sfx('glass_shatter', { volume: 0.7 });
      screenFade.flash('#ffffff', 1.4);
    }
    await skip.wait(1.8);
    // The heart monitor, slowing down.
    for (const gap of [0.55, 0.7, 0.9, 1.2]) {
      if (skip.skipped) break;
      audio.sfx('monitor_beep', { volume: 0.7 });
      await skip.wait(gap);
    }
    if (!skip.skipped) screenFade.setText('KAEL RAYNE', 'STATUS: CRITICAL', '72 heartbeats left');
    await skip.wait(2.4);
    skip.dispose();
    subtitles.clear(0.2);
    screenFade.setText();
  }

  // ---------------------------------------------------------------------------
  // 2. Load (a loading screen only if it is still going).
  // ---------------------------------------------------------------------------
  let loading = null;
  let progressTimer = null;
  if (loadProgress < 1) {
    loading = new LoadingScreen();
    loading.show();
    progressTimer = setInterval(() => loading.setProgress(loadProgress * 0.9), 100);
  }
  let assets;
  try {
    assets = await assetsPromise;
  } finally {
    clearInterval(progressTimer); // stop polling as soon as the load settles
  }
  const world = createRunnerWorld(game.renderer, assets);
  game.setWorld(world);
  await world.loadAct(0);
  world.setupIntro();
  game.renderOnce();
  if (loading) await loading.hide();

  // From here on the run is event-driven; `finish` ends it.
  let finish;
  const finished = new Promise((r) => (finish = r));
  let state = 'intro'; // intro | running | transition | dead | finale | ending | done
  let act = 0;
  let paused = false;

  /** End the run on black, whatever state it is in (quit, error, finished). */
  const endRun = () => {
    state = 'done';
    finish();
  };
  /**
   * Wrap an async run event so a thrown error can never softlock the run:
   * it is logged and the run ends gracefully (playRun always returns).
   */
  const safe = (name, fn) => async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(`[playRun] ${name} failed — ending the run.`, err);
      endRun();
    }
  };

  // ---------------------------------------------------------------------------
  // 3. Run events (wired before the run starts: time_start fires at once)
  // ---------------------------------------------------------------------------
  world.on ??= {};

  world.on.story = (id) => {
    const lines = STORY[id];
    if (lines && state === 'running') queue.push(lines);
  };

  world.on.fragment = (text) => {
    if (state !== 'running') return;
    queue.push([['MEMORY', text, 3.4]], { front: true });
  };

  world.on.flatline = safe('flatline', async () => {
    if (state !== 'running') return;
    state = 'dead';
    queue.clear();
    audio.stopMusic(0.4);
    await gameOver.show({ reason: FLATLINE_REASONS[act] });
    if (state !== 'dead') return; // quit meanwhile
    await screenFade.toBlack(0.4);
    await world.restartAct();
    audio.playMusic(CONFIG.runner.acts[act].music, 1.2);
    if (state !== 'dead') return;
    await screenFade.fromBlack(0.6);
    if (state !== 'dead') return;
    state = 'running';
    world.startRunning();
  });

  world.on.actEnd = safe('actEnd', async () => {
    if (state !== 'running') return;
    state = 'transition';
    queue.clear();
    if (act >= 2) return runFinaleSafe();

    // Through the portal: white flash → black → next act built under black.
    audio.sfx('reverse_whoosh', { volume: 0.8 });
    audio.stopMusic(1);
    await screenFade.flash('#ffffff', 0.35);
    await screenFade.toBlack(0.5);
    act += 1;
    const data = CONFIG.runner.acts[act];
    screenFade.setText(ACT_CARDS[act].k, data.title, '');
    await Promise.all([world.loadAct(act), wait(1.2)]);
    if (state !== 'transition') return;
    audio.playMusic(data.music, 1.5);
    screenFade.setText();
    await screenFade.fromBlack(0.7);
    const card = showCard({ ...ACT_CARDS[act], title: data.title }, 2.0);
    await wait(1.4);
    if (state !== 'transition') return;
    state = 'running';
    world.startRunning();
    await card.done;
  });

  // ---------------------------------------------------------------------------
  // 4. Finale → epilogue → results → post-credit (declared before the try
  //    below so the run events can reach it)
  // ---------------------------------------------------------------------------
  function runFinaleSafe() {
    return safe('finale', runFinale)();
  }

  async function runFinale() {
    state = 'finale';
    const beatsLeft = world.beats; // before the fire walk drains the heart
    const maxBeats = world.maxBeats ?? CONFIG.runner.heartbeats;
    audio.stopMusic(2);
    audio.playMusic('umbra', 2.5);
    const fireId = audio.sfx('fire_loop', { volume: 0.55 });
    cleanups.push(() => audio.stop('sfx', 'fire_loop', fireId, 0.5));

    const lines = FINALE_LINES.slice();
    let lastBeat = 0;
    await world.playFinale({
      onStep(k) {
        while (lines.length && lines[0][0] <= k) {
          const [, sp, text, sec] = lines.shift();
          queue.say(sp, text, sec);
        }
        // The heart crashes with each step.
        const now = performance.now();
        if (now - lastBeat > 900 - k * 500) {
          lastBeat = now;
          audio.sfx('heartbeat', { volume: 0.4 + k * 0.5, rate: 1 + k * 0.4 });
        }
      },
    });
    if (state !== 'finale') return;

    // Elias.
    queue.say('elias', 'You stopped running.', 3.6);
    await wait(3.4);

    // Whiteout → flatline → silence → one beep… then another.
    state = 'ending';
    audio.stopMusic(1.5);
    audio.stop('sfx', 'fire_loop', fireId, 1.5);
    await screenFade.toBlack(1.6, '#ffffff');
    world.hud?.setVisible?.(false);
    audio.sfx('flatline', { volume: 0.8 });
    await wait(2.6);
    await gsap.to(screenFade.el, { backgroundColor: '#000000', duration: 1.6 }).then();
    await wait(1.6);
    audio.sfx('monitor_beep', { volume: 0.8 });
    await wait(1.6);
    audio.sfx('monitor_beep', { volume: 0.8 });
    await wait(1.1);
    for (let i = 0; i < 3; i++) {
      audio.sfx('monitor_beep', { volume: 0.7 });
      audio.sfx('heartbeat', { volume: 0.6 });
      await wait(0.8);
    }

    // Epilogue cards.
    audio.playMusic('ending', 3);
    screenFade.setText('2050 · ST. ANNE\'S MEDICAL', 'KAEL RAYNE — STATUS: AWAKE', 'Heart rate 72 and climbing');
    await wait(4.2);
    screenFade.setText();
    await wait(0.5);
    audio.sfx('crowd_cheer', { volume: 0.5 });
    screenFade.setText('The Neon Velodrome, three weeks later', 'VICTOR HALE ARRESTED', 'for the murder of Elias Rayne, 2020');
    await wait(4.6);
    screenFade.setText();
    await wait(0.5);
    screenFade.setText('Kael\'s racing glove', '20:20', '');
    await wait(2.4);
    audio.sfx('clock_tick', { volume: 0.9 });
    audio.sfx('heartbeat', { volume: 0.7 });
    screenFade.setText('Kael\'s racing glove', '20:21', 'Time moves forward again.');
    glitchText(screenFade.el?.querySelector('.screen-fade-title'), 0.4);
    await wait(3.4);
    screenFade.setText();

    // Achievements + results.
    const stats = world.stats ?? {};
    const p = stats.powersUsed ?? {};
    const earned = [];
    const give = (id, cond) => {
      if (!cond || !ACHIEVEMENTS[id]) return;
      award(id);
      earned.push(id);
    };
    give('run_complete', true);
    give('flatline', true);
    give('heart_of_steel', beatsLeft >= 50);
    give('untouchable', (stats.crashes ?? 0) === 0);
    give('trinity', (p.time ?? 0) > 0 && (p.shadow ?? 0) > 0 && (p.fire ?? 0) > 0);
    await showResults(stats, beatsLeft, maxBeats, earned);

    // Post-credit: radio static on black.
    audio.stopMusic(2);
    await wait(2);
    audio.sfx('radio_static', { volume: 0.6 });
    await wait(0.9);
    subtitles.show('clockmaker', 'You\'re not the only one I\'ve sent back.', 4.2);
    await wait(4.6);
    audio.sfx('radio_static', { volume: 0.35 });
    await wait(1);
    state = 'done';
    finish();
  }

  // ---------------------------------------------------------------------------
  // 5. Pause (Esc while running): RESUME / QUIT TO MENU.
  //    Registered before the intro so Esc works the moment running starts.
  // ---------------------------------------------------------------------------
  const onKey = async (e) => {
    if (modal.open) {
      // No menu is listening while we play, so route keys to the dialog here.
      if (modal.handleKey(e)) e.preventDefault();
      return;
    }
    if (e.code !== 'Escape' || paused || state !== 'running' || world.mode !== 'run') return;
    paused = true;
    world.pauseRunning();
    timeScale.paused = true;
    const quit = await modal.confirm('PAUSED', 'Kael\'s heart keeps beating. Leave the run?', [
      { label: 'Quit to menu', value: true },
      { label: 'Resume', value: false, primary: true },
    ]);
    timeScale.paused = false;
    input.reset();
    setTimeout(() => (paused = false), 0); // the Esc that closed the dialog must not reopen it
    if (quit) endRun();
    else if (state === 'running') world.resume(); // keep the current mode, just unpause
  };
  window.addEventListener('keydown', onKey);
  cleanups.push(() => window.removeEventListener('keydown', onKey));

  try {
  // ---------------------------------------------------------------------------
  // 6. Intro on the track: the wreck burning, Kael on the ground.
  // ---------------------------------------------------------------------------
  {
    const skip = makeSkipper(2);
    const fireId = audio.sfx('fire_loop', { volume: 0.35 });
    const beat = setInterval(() => audio.sfx('heartbeat', { volume: 0.55, rate: 0.85 }), 1300);
    world.setCine([1.4, 0.45, 2.6], [0, 0.25, 0], 0); // low, close on Kael lying on the track
    world.setCine([2.6, 1.5, 3.4], [0, 0.4, -1], 4.5);
    const fadeIn = screenFade.fromBlack(1.6);

    let t = 0;
    const lines = INTRO_LINES.slice();
    const moves = [
      [4.6, [-2.2, 1.6, 2.2], [0, 0.8, -9], 4.2],  // over Kael to the burning wreck behind him
      [9.0, [0.4, 6.5, -5], [0, 0.4, 3], 4],       // high, wreck + Kael + the track ahead
      [13.2, [1.2, 0.9, 3.2], [0, 0.5, 0], 2],     // back down to his face
    ];
    let gotUp = false;
    const step = async (until) => {
      while (!skip.skipped && t < until) {
        if (lines.length && lines[0][0] <= t) {
          const [, sp, text, sec] = lines.shift();
          queue.say(sp, text, sec);
        }
        if (moves.length && moves[0][0] <= t) {
          const [, pos, look, sec] = moves.shift();
          world.setCine(pos, look, sec);
        }
        await skip.wait(0.1);
        t += 0.1;
      }
    };
    await step(15.6);
    if (!skip.skipped) {
      world.heroGetUp();
      gotUp = true;
      world.setCine([0.9, 1.3, -3.6], [0, 1.4, 6], 1.6); // behind him as he rises
      await skip.wait(1.8);
    }
    skip.dispose();
    await fadeIn;
    clearInterval(beat);
    audio.stop('sfx', 'fire_loop', fireId, 1.5);
    if (skip.skipped) {
      subtitles.clear(0.2);
      if (!gotUp) {
        world.heroGetUp();
        world.setCine([0.9, 1.3, -3.6], [0, 1.4, 6], 1.2);
        await wait(1.6);
      }
    }

    // RUN.
    audio.sfx('heartbeat', { volume: 0.9 });
    audio.playMusic(CONFIG.runner.acts[0].music ?? 'race_2050', 0.6);
    const card = showCard({ ...ACT_CARDS[0], title: 'RUN', k: `${ACT_CARDS[0].k} · ${CONFIG.runner.acts[0].title}` }, 1.6);
    world.clearCine(0.9);
    await wait(0.9);
    state = 'running';
    world.startRunning();
    await card.done;
  }

  await finished;
  } catch (err) {
    console.error('[playRun] the run failed — returning to the menu.', err);
    state = 'done';
  } finally {
    // -------------------------------------------------------------------------
    // 7. Clean up on black. Every step is guarded so one failure can't skip
    //    the rest (key listener, subtitles, music, DOM, world handlers).
    // -------------------------------------------------------------------------
    const attempt = (fn) => {
      try {
        return fn();
      } catch (err) {
        console.error('[playRun] cleanup step failed', err);
      }
    };
    state = 'done';
    world.on = { story() {}, actEnd() {}, flatline() {}, fragment() {} };
    try {
      await screenFade.toBlack(0.6);
    } catch (err) {
      console.error('[playRun] fade failed', err);
    }
    attempt(() => screenFade.setText());
    attempt(() => world.pauseRunning?.());
    attempt(() => world.hud?.setVisible?.(false));
    cleanups.reverse().forEach((fn) => attempt(fn));
    attempt(() => subtitles.clear(0));
    attempt(() => document.querySelectorAll('#ui-root > .run-card, #ui-root > .run-results').forEach((el) => el.remove()));
    attempt(() => modal.open && modal.handleKey({ code: 'Escape' }));
    attempt(() => audio.stopMusic(0.5));
    attempt(() => timeScale.reset());
    attempt(() => input.reset());
  }
}

// =============================================================================
// FLATLINE: 2050 — cutscenes/scripts/testCutscene.js
// Phase 2 test cutscene, played in the menu garage (New Game, or ?cutscene=test).
// Exercises every kind of step: camera cuts/dollies/dolly zoom/shake, actor
// gestures + walking, subtitles, sfx, music, mood, glitch, slow-mo, flash,
// fades — then the Mission 01 card. Phase 4 replaces it with the real
// "Last Lap" intro in the stadium.
//
// Garage layout: car at the origin, Kael's spot (2.25, 0, -1.25).
// =============================================================================

import { at, cam, actor, subtitle, sfx, music, fade, slowMo, flash, glitch, setMood } from '../steps.js';

const kael = actor('kael');

export default {
  id: 'test_garage',
  handheld: 0.015,
  missionCard: 1,

  steps: [
    // --- Shot 1: low dolly along the car, a distant stadium crowd ------------
    at(0, music(null, 1.5)),
    at(0, cam.cut([-2.6, 0.45, 3.4], [0, 0.5, 0])),
    at(0, fade.in(1.4)),
    at(0, cam.moveTo([-3.5, 0.75, 0.2], [0.3, 0.55, -0.5], 5.8, 'sine.inOut')),
    at(0.2, sfx('crowd_cheer', { volume: 0.25 })),
    at(0.9, subtitle('commentator', 'Kael Rayne. Undefeated.', 2.6)),
    at(3.7, subtitle('commentator', 'One lap from history.', 2.2)),

    // --- Shot 2: Kael, medium close-up, slow push in --------------------------
    at(5.8, cam.cut([1.45, 1.55, 1.3], [2.25, 1.55, -1.25])),
    at(5.8, cam.moveTo([1.75, 1.6, 0.5], [2.25, 1.58, -1.25], 4.2, 'power1.inOut')),
    at(6.2, kael.gesture('agree', 'idle')),
    at(6.6, subtitle('kael', 'One more lap. Then we celebrate.', 2.8)),

    // --- Shot 3: he walks to the car; tracking shot ---------------------------
    at(9.8, cam.cut([4.4, 1.25, 1.2], [2.0, 1.0, -0.6])),
    at(9.8, cam.moveTo([3.5, 1.2, 2.6], [1.5, 1.0, 0.3], 3.2, 'sine.inOut')),
    at(10.0, kael.moveTo([1.55, 0.08, 0.3], 1.3)),
    at(10.4, sfx('whoosh', { volume: 0.35 })),

    // --- Shot 4: the radio crackles. Time bends. -------------------------------
    at(12.6, glitch(0.7, 0.9)),
    at(12.6, setMood('TIME', 0.6)),
    at(12.6, sfx('radio_static', { volume: 0.7, stopAfter: 3.2 })),
    at(12.6, cam.cut([0.95, 1.62, 1.75], 'kael')),
    at(12.8, kael.lookAt([0.9, 0.08, 1.8], 2)),
    at(12.9, subtitle('clockmaker', 'Twenty. Twenty. Twenty…', 2.8)),
    at(13.0, sfx('clock_tick', { volume: 0.5, stopAfter: 4.5 })),
    at(13.0, sfx('heartbeat')),
    at(13.2, cam.dollyZoom('kael', 72, 2.6)),
    at(13.2, slowMo(0.35, 2.0, 0.3)),
    at(13.4, kael.gesture('headShake', 'idle')),
    at(14.1, sfx('heartbeat', { rate: 0.85 })),
    at(15.2, sfx('heartbeat', { rate: 0.7 })),
    at(15.4, cam.shake(0.05, 1.2)),
    at(15.8, subtitle('kael', '…Who’s there?', 2)),

    // --- Out ---------------------------------------------------------------------
    at(17.0, flash('#ffffff', 0.35)),
    at(17.0, glitch(0.5, 1)),
    at(17.0, sfx('monitor_beep')),
    at(17.2, fade.out(1.3)),
  ],
};

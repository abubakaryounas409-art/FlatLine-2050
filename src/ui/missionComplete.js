// =============================================================================
// FLATLINE: 2050 — ui/missionComplete.js
// The mission complete screen (CLAUDE.md Phase 9): time, accuracy, heartbeats
// left and a rank S / A / B / C.  await missionComplete.show(mission, stats)
// =============================================================================

import gsap from 'gsap';
import { audio } from '../core/audio.js';
import { input } from '../core/input.js';

const pad = (n) => String(n).padStart(2, '0');
export const formatClock = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;

/** Rank from a 0..1 score. */
export function rankOf(score) {
  if (score >= 0.85) return 'S';
  if (score >= 0.7) return 'A';
  if (score >= 0.5) return 'B';
  return 'C';
}

class MissionComplete {
  /**
   * @param {{number:number, name:string}} mission
   * @param {{time:number, parTime:number, accuracy:number, beats:number, maxBeats:number}} s
   */
  show(mission, s) {
    document.exitPointerLock?.();
    // score: beats left matter most (the theme), then accuracy, then pace
    const pace = Math.max(0, Math.min(1, s.parTime / Math.max(1, s.time)));
    const score = (s.beats / s.maxBeats) * 0.45 + s.accuracy * 0.3 + pace * 0.25;
    const rank = rankOf(score);
    const el = document.createElement('div');
    el.className = 'mcomplete';
    el.innerHTML = `
      <div class="mcomplete-k">MISSION ${pad(mission.number)} COMPLETE</div>
      <h1 class="mcomplete-title">${mission.name.toUpperCase()}</h1>
      <div class="mcomplete-stats">
        <div><span>TIME</span><b>${formatClock(s.time)}</b></div>
        <div><span>ACCURACY</span><b>${Math.round(s.accuracy * 100)}%</b></div>
        <div><span>HEARTBEATS</span><b class="mcomplete-beats">${s.beats}</b></div>
      </div>
      <div class="mcomplete-rank rank-${rank}">${rank}</div>
      <div class="mcomplete-continue">PRESS <span class="hint-key">ENTER</span> TO CONTINUE</div>`;
    document.getElementById('ui-root').appendChild(el);
    const tl = gsap.timeline();
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.5 });
    tl.fromTo(el.querySelectorAll('.mcomplete-k, .mcomplete-title'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.12 }, 0.2);
    tl.fromTo(el.querySelectorAll('.mcomplete-stats > div'), { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.35, stagger: 0.25, onStart: () => audio.sfx('ui_click', { volume: 0.5 }) }, 0.8);
    tl.fromTo(el.querySelector('.mcomplete-rank'), { opacity: 0, scale: 2.2 }, { opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)', onStart: () => audio.sfx('heartbeat', { volume: 0.9 }) }, 1.9);
    tl.fromTo(el.querySelector('.mcomplete-continue'), { opacity: 0 }, { opacity: 1, duration: 0.5 }, 2.6);
    const shownAt = performance.now();
    return new Promise((resolve) => {
      const done = (e) => {
        if (e && e.type === 'keydown' && !['Enter', 'Space', 'Escape'].includes(e.code)) return;
        if (performance.now() - shownAt < 600) return; // ignore keys still held from gameplay
        if (tl.progress() < 1) {
          tl.progress(1); // first press: show everything
          return;
        }
        window.removeEventListener('keydown', done);
        el.removeEventListener('click', done);
        input.reset();
        gsap.to(el, { opacity: 0, duration: 0.5, onComplete: () => el.remove() });
        resolve({ rank, score });
      };
      window.addEventListener('keydown', done);
      el.addEventListener('click', done);
    });
  }
}

export const missionComplete = new MissionComplete();

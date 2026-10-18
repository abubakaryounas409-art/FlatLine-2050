// =============================================================================
// FLATLINE: 2050 — ui/achievementToast.js
// In-game achievements (CLAUDE.md Phase 11.10): a small toast slides in when
// one unlocks, and award() is the single place that unlocks + shows them.
//
//   award('ghost')   → saved (saveGame) + toast, once per save
// =============================================================================

import gsap from 'gsap';
import { audio } from '../core/audio.js';
import { saveGame } from '../systems/saveGame.js';

export const ACHIEVEMENTS = {
  undefeated: { name: 'Undefeated', text: 'Lead the final lap before the crash.' },
  ghost: { name: 'Ghost', text: 'Finish Mission 2 without being spotted.' },
  pyromaniac: { name: 'Pyromaniac', text: 'Start 10 fires with incendiary rounds.' },
  heart_of_steel: { name: 'Heart of Steel', text: 'Finish a mission or THE RUN with 50+ heartbeats left.' },
  flatline: { name: 'Flatline', text: 'See the story through to the end.' },
  // THE RUN (runner/playRun.js)
  run_complete: { name: 'Stopped Running', text: 'Walk into the fire and finish THE RUN.' },
  untouchable: { name: 'Untouchable', text: 'Finish THE RUN without a single crash.' },
  trinity: { name: 'Fire, Shadow, Time', text: 'Use all three powers in one run.' },
};

const queue = [];
let showing = false;

/** Unlock (if new) and show the toast. */
export function award(id) {
  if (!ACHIEVEMENTS[id]) return false;
  const isNew = saveGame.unlockAchievement(id);
  if (isNew) {
    queue.push(id);
    if (!showing) next();
  }
  return isNew;
}

function next() {
  const id = queue.shift();
  if (!id) {
    showing = false;
    return;
  }
  showing = true;
  const a = ACHIEVEMENTS[id];
  const el = document.createElement('div');
  el.className = 'achievement';
  el.innerHTML = `<div class="achievement-k">ACHIEVEMENT UNLOCKED</div><div class="achievement-name">${a.name}</div><div class="achievement-text">${a.text}</div>`;
  document.getElementById('ui-root').appendChild(el);
  audio.sfx('scifi_beep', { volume: 0.5, rate: 1.3 });
  gsap.timeline({ onComplete: () => { el.remove(); next(); } })
    .fromTo(el, { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.45, ease: 'power3.out' })
    .to(el, { opacity: 0, x: 40, duration: 0.4, ease: 'power2.in' }, 4);
}

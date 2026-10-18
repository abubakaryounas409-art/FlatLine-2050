// =============================================================================
// FLATLINE: 2050 — ui/missionCard.js
// Shown after each intro cutscene (CLAUDE.md Phase 2.5): big mission number,
// mission name, theme icon, one objective line. Glitches in, holds, fades out.
//
//   await missionCard.show(getMission(1), { postfx: game.postfx });
// =============================================================================

import gsap from 'gsap';
import { CONFIG } from '../config.js';
import { audio } from '../core/audio.js';
import { THEME_ICONS } from '../missions/missionData.js';
import { glitchText, scrambleText } from '../vfx/glitchFX.js';

const THEME_LABEL = { FIRE: 'Fire', SHADOWS: 'Shadows', TIME: 'Time', ALL: 'Fire · Shadows · Time' };

class MissionCard {
  /**
   * @param {object} mission entry from missions/missionData.js
   * @param {object} o
   * @param {object} [o.postfx]  to add a screen glitch on the way in/out
   * @param {number} [o.hold]    seconds fully visible
   */
  async show(mission, { postfx = null, hold = CONFIG.missionCard.holdSeconds } = {}) {
    const num = String(mission.number).padStart(2, '0');
    const name = mission.name.toUpperCase();
    const theme = mission.theme.toLowerCase();

    const el = document.createElement('div');
    el.className = `mission-card theme-${theme}`;
    el.innerHTML = `
      <div class="mc-number" data-text="${num}">${num}</div>
      <div class="mc-body">
        <div class="mc-kicker">Mission ${num} · ${mission.year}</div>
        <div class="mc-name" data-text="${name}">${name}</div>
        <div class="mc-theme"><span class="mc-icon">${THEME_ICONS[mission.theme]}</span>${THEME_LABEL[mission.theme]}</div>
        <div class="mc-rule"></div>
        <div class="mc-objective"><span class="mc-objective-label">Objective</span><span class="mc-objective-text"></span></div>
      </div>`;
    document.getElementById('ui-root').appendChild(el);

    const q = (s) => el.querySelector(s);
    const numberEl = q('.mc-number');
    const nameEl = q('.mc-name');
    const objectiveEl = q('.mc-objective-text');

    // --- In -------------------------------------------------------------------
    audio.sfx('whoosh', { volume: 0.8 });
    postfx?.glitch(0.35, 0.6);
    const tl = gsap.timeline();
    tl.set(el, { opacity: 1 });
    tl.fromTo(numberEl, { opacity: 0, x: -40, scale: 1.15 }, { opacity: 1, x: 0, scale: 1, duration: 0.6, ease: 'power4.out' }, 0);
    tl.call(() => glitchText(numberEl, 0.45), null, 0.05);
    tl.fromTo(q('.mc-kicker'), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4 }, 0.15);
    tl.call(() => {
      audio.sfx('ui_glitch', { volume: 0.7 });
      gsap.set(nameEl, { opacity: 1 });
      scrambleText(nameEl, name, 0.5);
      glitchText(nameEl, 0.5);
    }, null, 0.25);
    tl.fromTo(q('.mc-theme'), { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.45 }, 0.6);
    tl.fromTo(q('.mc-rule'), { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power3.inOut' }, 0.6);
    tl.fromTo(q('.mc-objective'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.95);
    tl.call(() => typeText(objectiveEl, mission.objective, 0.9), null, 1.0);
    await tl.then();

    // --- Hold, then out ------------------------------------------------------------
    await new Promise((r) => setTimeout(r, hold * 1000));
    postfx?.glitch(0.3, 0.5);
    glitchText(nameEl, 0.35);
    await gsap.to(el, { opacity: 0, x: 24, duration: 0.6, ease: 'power2.in' }).then();
    el.remove();
  }
}

/** Typewriter reveal. */
function typeText(el, text, seconds) {
  const chars = [...text];
  const state = { n: 0 };
  return gsap
    .to(state, {
      n: chars.length,
      duration: seconds,
      ease: 'none',
      onUpdate: () => (el.textContent = chars.slice(0, Math.round(state.n)).join('')),
    })
    .then();
}

export const missionCard = new MissionCard();

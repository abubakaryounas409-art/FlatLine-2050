// =============================================================================
// FLATLINE: 2050 — ui/gameOver.js
// The FLATLINE game-over screen (CLAUDE.md Phase 7.1): the heart stops in
// 2050. Black, a flat red monitor line, the long tone, then TRY AGAIN.
//
//   await gameOver.show()   resolves when the player chooses TRY AGAIN
// =============================================================================

import gsap from 'gsap';
import { audio } from '../core/audio.js';
import { input } from '../core/input.js';
import { glitchText } from '../vfx/glitchFX.js';

class GameOver {
  show({ reason = 'His heart stopped in 2050.' } = {}) {
    document.exitPointerLock?.();
    const el = document.createElement('div');
    el.className = 'gameover';
    el.innerHTML = `
      <svg class="gameover-line" viewBox="0 0 1000 120" preserveAspectRatio="none">
        <polyline points="0,60 300,60 330,60 345,15 362,105 378,60 1000,60"/>
      </svg>
      <h1 class="gameover-title" data-text="FLATLINE">FLATLINE</h1>
      <p class="gameover-reason">${reason}</p>
      <button class="gameover-retry">TRY AGAIN</button>`;
    document.getElementById('ui-root').appendChild(el);
    const line = el.querySelector('polyline');
    const len = 1100;
    line.style.strokeDasharray = `${len}`;
    gsap.set(el, { opacity: 0 });
    const tl = gsap.timeline();
    tl.to(el, { opacity: 1, duration: 0.5 });
    tl.fromTo(line, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.6, ease: 'none' }, 0.2);
    tl.call(() => audio.sfx('flatline', { volume: 0.8 }), null, 0.9);
    tl.fromTo(el.querySelector('.gameover-title'), { opacity: 0, letterSpacing: '0.6em' }, { opacity: 1, letterSpacing: '0.3em', duration: 1.2, ease: 'power3.out' }, 1.2);
    tl.call(() => glitchText(el.querySelector('.gameover-title'), 0.5), null, 1.6);
    tl.fromTo(el.querySelectorAll('.gameover-reason, .gameover-retry'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.2 }, 2.0);

    const shownAt = performance.now();
    return new Promise((resolve) => {
      const btn = el.querySelector('.gameover-retry');
      let done = false;
      const finish = () => {
        if (done || performance.now() - shownAt < 600) return;
        if (tl.progress() < 1) {
          tl.progress(1);
          return;
        }
        done = true;
        window.removeEventListener('keydown', onKey);
        audio.sfx('ui_click', { volume: 0.6 });
        gsap.to(el, { opacity: 0, duration: 0.5, onComplete: () => el.remove() });
        input.reset();
        resolve();
      };
      const onKey = (e) => {
        if (e.code === 'Enter' || e.code === 'Space') finish();
      };
      btn.addEventListener('click', finish);
      window.addEventListener('keydown', onKey);
    });
  }
}

export const gameOver = new GameOver();

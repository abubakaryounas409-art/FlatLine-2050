// =============================================================================
// FLATLINE: 2050 — vfx/glitchFX.js
// UI glitch effects (DOM). Phase 2 adds a full-screen shader glitch for
// cutscenes and the "20.20.20" HUD.
//
//   glitchText(el, seconds)      RGB split + slice jitter (CSS class .is-glitching)
//   scrambleText(el, text, s)    characters scramble, then resolve left to right
//   idleGlitch(el, opts)         random glitches every few seconds; returns stop()
//
// Elements that glitch need data-text="<same text>" (the CSS pseudo-elements
// draw the coloured copies from it). glitchText() sets it automatically.
// =============================================================================

const SCRAMBLE_CHARS = '0123456789ABCDEF#%&$@!?/\\<>[]=+*';

/** Play the slice/RGB-split glitch once. */
export function glitchText(el, seconds = 0.3) {
  if (!el) return;
  if (!el.dataset.text) el.dataset.text = el.textContent.trim();
  el.classList.remove('is-glitching');
  // Force a reflow so the CSS animation restarts even if it was already running.
  void el.offsetWidth;
  el.style.setProperty('--glitch-duration', `${seconds}s`);
  el.classList.add('is-glitching');
  clearTimeout(el._glitchTimer);
  el._glitchTimer = setTimeout(() => el.classList.remove('is-glitching'), seconds * 1000);
}

/**
 * Scramble into `text`: every character cycles random symbols, then locks in
 * from left to right. Resolves when finished.
 */
export function scrambleText(el, text, seconds = 0.8) {
  return new Promise((resolve) => {
    const start = performance.now();
    const chars = [...text];
    cancelAnimationFrame(el._scrambleRaf);
    const step = (now) => {
      const t = Math.min(1, (now - start) / (seconds * 1000));
      const locked = Math.floor(t * chars.length);
      el.textContent = chars
        .map((c, i) => (i < locked || c === ' ' ? c : SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0]))
        .join('');
      if (t < 1) el._scrambleRaf = requestAnimationFrame(step);
      else {
        el.textContent = text;
        el.dataset.text = text;
        resolve();
      }
    };
    el._scrambleRaf = requestAnimationFrame(step);
  });
}

/** Glitch at random intervals (e.g. the blue "2050" under the title). */
export function idleGlitch(el, { minDelay = 1.5, maxDelay = 4.5, seconds = 0.25, onGlitch } = {}) {
  let timer = 0;
  let stopped = false;
  const schedule = () => {
    const delay = (minDelay + Math.random() * (maxDelay - minDelay)) * 1000;
    timer = setTimeout(() => {
      if (stopped) return;
      glitchText(el, seconds);
      onGlitch?.();
      schedule();
    }, delay);
  };
  schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

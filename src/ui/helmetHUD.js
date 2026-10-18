// =============================================================================
// FLATLINE: 2050 — ui/helmetHUD.js
// Kael's helmet display (Mission 1): boots up in the intro, then betrays him:
//   bootUp()        reticle, vitals, "SYSTEMS ONLINE" (intro close-up)
//   timeGlitch()    "20.20.20" in red with static (the sabotage begins)
//   brakeFailure()  flashing BRAKE FAILURE / STEERING warning
//   crackVisor()    a cracked visor drawn over the screen (the crash)
//   clear()
// =============================================================================

import gsap from 'gsap';
import { audio } from '../core/audio.js';
import { glitchText, scrambleText } from '../vfx/glitchFX.js';

export class HelmetHUD {
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'helmet';
    this.root.innerHTML = `
      <svg class="helmet-frame" viewBox="0 0 1600 900" preserveAspectRatio="none" aria-hidden="true">
        <path d="M60 140 Q60 60 140 60 H520 M1080 60 H1460 Q1540 60 1540 140 M60 760 Q60 840 140 840 H520 M1080 840 H1460 Q1540 840 1540 760" />
        <circle cx="800" cy="450" r="34" /><path d="M800 396 V420 M800 480 V504 M746 450 H770 M830 450 H854" />
      </svg>
      <div class="helmet-tl"><div class="helmet-k">Driver</div><div class="helmet-v">K. RAYNE · #20</div></div>
      <div class="helmet-tr"><div class="helmet-k">Vitals</div><div class="helmet-v helmet-bpm">72 BPM</div><svg class="helmet-ecg" viewBox="0 0 120 24"><polyline points="0,12 30,12 36,4 42,20 48,2 54,12 120,12"/></svg></div>
      <div class="helmet-bl"><div class="helmet-k">Race</div><div class="helmet-v">WORLD GRAND PRIX · LAP 50/50</div></div>
      <div class="helmet-br"><div class="helmet-k">Systems</div><div class="helmet-v helmet-sys">BOOTING…</div></div>
      <div class="helmet-time" data-text="20.20.20">20.20.20</div>
      <div class="helmet-warn" data-text="BRAKE FAILURE">BRAKE FAILURE</div>
      <canvas class="helmet-crack"></canvas>
    `;
    document.getElementById('ui-root').appendChild(this.root);
    gsap.set(this.root, { opacity: 0 });
  }

  bootUp() {
    const r = this.root;
    r.classList.add('is-on');
    gsap.to(r, { opacity: 1, duration: 0.15 });
    gsap.fromTo(r.querySelector('.helmet-frame'), { opacity: 0, scale: 1.08 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'power3.out' });
    const blocks = r.querySelectorAll('.helmet-tl, .helmet-tr, .helmet-bl, .helmet-br');
    gsap.fromTo(blocks, { opacity: 0, x: (i) => (i % 2 ? 20 : -20) }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.12, delay: 0.2 });
    audio.sfx('ui_glitch', { volume: 0.5 });
    setTimeout(() => scrambleText(r.querySelector('.helmet-sys'), 'SYSTEMS ONLINE', 0.6), 700);
  }

  /** The clock glitch that nobody else sees: 20.20.20. */
  timeGlitch(seconds = 1.6) {
    const el = this.root.querySelector('.helmet-time');
    gsap.set(this.root, { opacity: 1 });
    el.style.display = 'block';
    audio.sfx('radio_static', { volume: 0.9 });
    const tl = gsap.timeline();
    for (let i = 0; i < 6; i++) tl.call(() => glitchText(el, 0.2), null, i * 0.2);
    tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.05, repeat: 7, yoyo: true }, 0);
    tl.to(el, { opacity: 0, duration: 0.2 }, seconds);
    tl.call(() => (el.style.display = 'none'));
    return tl.then();
  }

  brakeFailure() {
    const el = this.root.querySelector('.helmet-warn');
    el.style.display = 'block';
    audio.sfx('monitor_beep', { volume: 1, rate: 2.4 });
    gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.12, repeat: -1, yoyo: true, ease: 'steps(1)' });
    glitchText(el, 0.5);
    setTimeout(() => (el.textContent = el.dataset.text = 'STEERING NOT RESPONDING'), 900);
  }

  /** Procedural crack from an impact point (fraction of the screen). */
  crackVisor(x = 0.62, y = 0.38) {
    const c = this.root.querySelector('.helmet-crack');
    const dpr = Math.min(window.devicePixelRatio, 2);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    const cx = innerWidth * x;
    const cy = innerHeight * y;
    ctx.strokeStyle = 'rgba(230,240,255,0.85)';
    ctx.shadowColor = 'rgba(160,200,255,0.9)';
    ctx.shadowBlur = 6;
    const branch = (x0, y0, ang, len, depth) => {
      let x1 = x0;
      let y1 = y0;
      const steps = 6;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let i = 0; i < steps; i++) {
        ang += (Math.random() - 0.5) * 0.5;
        x1 += Math.cos(ang) * (len / steps);
        y1 += Math.sin(ang) * (len / steps);
        ctx.lineTo(x1, y1);
      }
      ctx.lineWidth = Math.max(0.6, 2.4 - depth * 0.6);
      ctx.stroke();
      if (depth < 3) for (let k = 0; k < 2; k++) if (Math.random() < 0.7) branch(x1, y1, ang + (Math.random() - 0.5) * 1.4, len * 0.55, depth + 1);
    };
    for (let i = 0; i < 11; i++) branch(cx, cy, (i / 11) * Math.PI * 2 + Math.random() * 0.3, innerWidth * (0.18 + Math.random() * 0.22), 0);
    // concentric impact rings
    for (let r = 14; r < 90; r += 18 + Math.random() * 12) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.random() * 6, Math.random() * 6 + 3.5);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    gsap.fromTo(c, { opacity: 0 }, { opacity: 1, duration: 0.05 });
  }

  clear(seconds = 0.4) {
    const r = this.root;
    gsap.killTweensOf(r.querySelector('.helmet-warn'));
    return gsap.to(r, { opacity: 0, duration: seconds }).then(() => {
      r.querySelector('.helmet-warn').style.display = 'none';
      r.classList.remove('is-on');
    });
  }

  destroy() {
    gsap.killTweensOf(this.root.querySelector('.helmet-warn'));
    this.root.remove();
  }
}

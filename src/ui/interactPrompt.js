// =============================================================================
// FLATLINE: 2050 — ui/interactPrompt.js
// The floating "[F] Listen to the radio" prompt over usable objects
// (CLAUDE.md Phase 5.6). Projected from a world point every frame; fades in
// and out instead of popping.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';

const tmp = new THREE.Vector3();

export class InteractPrompt {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'interact-prompt';
    this.el.innerHTML = '<span class="interact-key">F</span><span class="interact-label"></span>';
    this.label = this.el.querySelector('.interact-label');
    document.getElementById('ui-root').appendChild(this.el);
    this.current = null;
    gsap.set(this.el, { opacity: 0 });
  }

  /**
   * @param {object|null} target  { position: Vector3, prompt: string, height?: number }
   * @param {THREE.Camera} camera
   */
  update(target, camera) {
    if (target !== this.current) {
      this.current = target;
      gsap.killTweensOf(this.el);
      if (target) {
        this.label.textContent = target.prompt;
        // opacity only: the transform is set every frame for the screen position
        gsap.fromTo(this.el, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power2.out' });
      } else {
        gsap.to(this.el, { opacity: 0, duration: 0.15 });
      }
    }
    if (!target) return;
    tmp.copy(target.position);
    tmp.y += target.height ?? 0.6;
    tmp.project(camera);
    const behind = tmp.z > 1;
    this.el.style.visibility = behind ? 'hidden' : 'visible';
    const x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
    this.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  destroy() {
    gsap.killTweensOf(this.el);
    this.el.remove();
  }
}

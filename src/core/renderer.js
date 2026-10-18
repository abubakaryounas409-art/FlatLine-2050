// =============================================================================
// FLATLINE: 2050 — core/renderer.js
// Creates the WebGLRenderer and applies the Graphics quality preset.
//
// Notes for three r186:
// - PCFSoftShadowMap was removed; PCFShadowMap is now the soft-filtered mode
//   (use light.shadow.radius to soften further).
// - Tone mapping is set to ACES Filmic here. When the post-processing
//   pipeline is active it takes over tone mapping (see postfx.js), because
//   the effects must work on linear HDR colors.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';

export function createRenderer(container = document.body) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = CONFIG.renderer.toneMappingExposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(CONFIG.renderer.clearColor, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);

  renderer.domElement.id = 'game-canvas';
  container.appendChild(renderer.domElement);
  return renderer;
}

/** Apply a Low / Medium / High preset to the renderer. */
export function applyGraphicsToRenderer(renderer, preset) {
  const ratio = Math.min(window.devicePixelRatio, preset.pixelRatio, CONFIG.renderer.maxPixelRatio);
  renderer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = preset.shadows;
  renderer.shadowMap.needsUpdate = true;
}

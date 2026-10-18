// =============================================================================
// FLATLINE: 2050 — core/postfx.js
// Post-processing pipeline (pmndrs/postprocessing):
//
//   RenderPass (HDR, half-float)
//   → EffectPass:  Bloom → ToneMapping (ACES) → ColorGrade (mood) → Vignette
//   → EffectPass:  ChromaticAberration   (own pass: it is a convolution effect)
//   → EffectPass:  Glitch                (own pass; only enabled while glitching)
//   → EffectPass:  SpeedBlur             (own pass; radial blur at high speed)
//
// setMood('FIRE' | 'SHADOWS' | 'TIME' | 'NEUTRAL') blends the color grade.
// The renderer's own tone mapping is turned off while this pipeline is used,
// because tone mapping must happen AFTER bloom on linear HDR colors.
// =============================================================================

import * as THREE from 'three';
import gsap from 'gsap';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  Effect,
  EffectAttribute,
  BloomEffect,
  VignetteEffect,
  ChromaticAberrationEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { CONFIG } from '../config.js';

// -----------------------------------------------------------------------------
// ColorGradeEffect — tint, lift, saturation, contrast, brightness in one shader
// -----------------------------------------------------------------------------
const colorGradeShader = /* glsl */ `
  uniform vec3 tint;
  uniform vec3 lift;
  uniform float saturation;
  uniform float contrast;
  uniform float brightness;
  uniform float drain;   // low heartbeat: colour drains away (0..1)
  uniform float pulse;   // low heartbeat: the edges close in on each beat (0..1)

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb * tint;
    c += lift * (1.0 - c);                                  // raise the shadows
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, saturation * (1.0 - drain));
    float edge = smoothstep(0.25, 0.85, length((uv - 0.5) * vec2(1.25, 1.0)));
    c *= 1.0 - pulse * edge;
    c = mix(c, c * vec3(1.15, 0.55, 0.55), pulse * edge * 0.6); // a red throb at the rim
    // Colors here are LINEAR (sRGB encoding happens at the very end), so
    // contrast pivots around linear mid-grey 0.18 with a power curve:
    // blacks stay black and darks deepen without clipping to zero.
    c = 0.18 * pow(max(c, vec3(0.0)) / 0.18, vec3(contrast));
    c *= 1.0 + brightness;                                  // exposure-style
    outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
  }
`;

class ColorGradeEffect extends Effect {
  constructor() {
    super('ColorGradeEffect', colorGradeShader, {
      uniforms: new Map([
        ['tint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['lift', new THREE.Uniform(new THREE.Vector3(0, 0, 0))],
        ['saturation', new THREE.Uniform(1)],
        ['contrast', new THREE.Uniform(1)],
        ['brightness', new THREE.Uniform(0)],
        ['drain', new THREE.Uniform(0)],
        ['pulse', new THREE.Uniform(0)],
      ]),
    });
  }
}

// -----------------------------------------------------------------------------
// GlitchEffect — horizontal band tearing, RGB split, scanlines and noise.
// strength 0..1 (0 = off). Used by cutscenes, the 20.20.20 HUD glitch, Umbra.
// -----------------------------------------------------------------------------
const glitchShader = /* glsl */ `
  uniform float strength;
  uniform float time;
  uniform float seed;

  float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // Tear: shift random horizontal bands sideways, re-rolled ~20 times a second.
    float tick = floor(time * 20.0);
    float band = floor(uv.y * mix(14.0, 40.0, rand(vec2(tick, seed))));
    float r = rand(vec2(band, tick + seed));
    float shift = r < strength * 0.55 ? (rand(vec2(band + 3.1, tick)) - 0.5) * 0.16 * strength : 0.0;
    vec2 st = vec2(fract(uv.x + shift), uv.y);

    // RGB split grows with strength
    vec2 off = vec2(0.012 * strength * (0.5 + r), 0.0);
    vec3 c = vec3(
      texture2D(inputBuffer, st + off).r,
      texture2D(inputBuffer, st).g,
      texture2D(inputBuffer, st - off).b
    );

    // Scanlines + grain
    float scan = 0.9 + 0.1 * sin(uv.y * 900.0 + time * 60.0);
    c *= mix(1.0, scan, strength);
    c += (rand(uv * (time + 1.7)) - 0.5) * 0.18 * strength;

    outputColor = vec4(c, inputColor.a);
  }
`;

class GlitchEffect extends Effect {
  constructor() {
    super('GlitchEffect', glitchShader, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['strength', new THREE.Uniform(0)],
        ['time', new THREE.Uniform(0)],
        ['seed', new THREE.Uniform(0)],
      ]),
    });
  }

  update(renderer, inputBuffer, deltaTime) {
    this.uniforms.get('time').value += deltaTime || 0.016;
  }
}

// -----------------------------------------------------------------------------
// SpeedBlurEffect — radial "zoom" blur toward the screen centre (driving).
// The centre stays sharp; the edges smear. strength 0..1.
// -----------------------------------------------------------------------------
const speedBlurShader = /* glsl */ `
  uniform float strength;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 toCenter = vec2(0.5, 0.55) - uv;
    float edge = smoothstep(0.12, 0.6, length(toCenter));
    float amount = strength * edge * 0.09;
    vec3 sum = inputColor.rgb;
    for (int i = 1; i < 8; i++) {
      sum += texture2D(inputBuffer, uv + toCenter * amount * float(i) / 7.0).rgb;
    }
    outputColor = vec4(sum / 8.0, inputColor.a);
  }
`;

class SpeedBlurEffect extends Effect {
  constructor() {
    super('SpeedBlurEffect', speedBlurShader, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['strength', new THREE.Uniform(0)]]),
    });
  }
}

// -----------------------------------------------------------------------------
// HeatHazeEffect — shimmering air above fires (CLAUDE.md 7.4). Up to 4 screen
// sources: xy = screen uv, z = radius (uv), w = strength.
// -----------------------------------------------------------------------------
const heatHazeShader = /* glsl */ `
  uniform vec4 sources[4];
  uniform float time;
  void mainUv(inout vec2 uv) {
    vec2 offset = vec2(0.0);
    for (int i = 0; i < 4; i++) {
      vec4 s = sources[i];
      if (s.w <= 0.0) continue;
      vec2 d = (uv - s.xy) * vec2(aspect, 1.0);
      float r = length(d) / max(0.001, s.z);
      float k = s.w * smoothstep(1.0, 0.0, r) * smoothstep(-0.4, 0.3, uv.y - s.y + s.z * 0.3); // mostly above the flames
      offset += k * vec2(sin(uv.y * 90.0 - time * 7.0 + float(i)), cos(uv.x * 70.0 - time * 5.0)) * 0.0035;
    }
    uv += offset;
  }
`;

class HeatHazeEffect extends Effect {
  constructor() {
    super('HeatHazeEffect', heatHazeShader, {
      uniforms: new Map([
        ['sources', new THREE.Uniform([0, 1, 2, 3].map(() => new THREE.Vector4()))],
        ['time', new THREE.Uniform(0)],
      ]),
    });
  }

  update(renderer, inputBuffer, deltaTime) {
    this.uniforms.get('time').value += deltaTime || 0.016;
  }
}

// -----------------------------------------------------------------------------
// PostFX
// -----------------------------------------------------------------------------
export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.mood = 'NEUTRAL';
    this._moodTween = null;
    this._caTween = null;

    // Tone mapping moves into the pipeline (see header comment).
    renderer.toneMapping = THREE.NoToneMapping;

    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 4,
    });

    this.renderPass = new RenderPass(scene, camera);

    const cfg = CONFIG.postfx;
    this.bloom = new BloomEffect({
      intensity: cfg.bloom.intensity,
      luminanceThreshold: cfg.bloom.threshold,
      luminanceSmoothing: cfg.bloom.smoothing,
      radius: cfg.bloom.radius,
      mipmapBlur: true,
    });
    this.toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.colorGrade = new ColorGradeEffect();
    this.vignette = new VignetteEffect({
      offset: cfg.vignette.offset,
      darkness: cfg.vignette.darkness,
    });
    this.chromatic = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(cfg.chromaticAberration.base, cfg.chromaticAberration.base),
      radialModulation: true,
      modulationOffset: 0.2,
    });

    this.glitchEffect = new GlitchEffect();
    this.speedBlur = new SpeedBlurEffect();
    this.heatHaze = new HeatHazeEffect();
    this.lowHeart = 0;       // 0..1, set by systems/heartbeatFX.js
    this.lowHeartPulse = 0;

    // NaN / Inf guard: one bad pixel from any shader would otherwise be spread by the
    // bloom blur until the whole screen turns black. Runs before bloom reads the frame.
    this.sanitizePass = new EffectPass(camera, new Effect('Sanitize', /* glsl */ `
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        bvec4 bad = bvec4(isnan(inputColor.r) || isinf(inputColor.r), isnan(inputColor.g) || isinf(inputColor.g),
                          isnan(inputColor.b) || isinf(inputColor.b), isnan(inputColor.a) || isinf(inputColor.a));
        outputColor = any(bad) ? vec4(0.0, 0.0, 0.0, 1.0) : min(inputColor, vec4(64.0));
      }`));
    this.mainPass = new EffectPass(camera, this.bloom, this.toneMapping, this.colorGrade, this.vignette);
    this.caPass = new EffectPass(camera, this.chromatic);
    this.glitchPass = new EffectPass(camera, this.glitchEffect);
    this.speedPass = new EffectPass(camera, this.speedBlur);
    this.hazePass = new EffectPass(camera, this.heatHaze);
    this.glitchState = { strength: 0 };

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.sanitizePass);
    this.composer.addPass(this.mainPass);
    this.composer.addPass(this.caPass);
    this.composer.addPass(this.speedPass);
    this.composer.addPass(this.hazePass);
    this.composer.addPass(this.glitchPass);
    this._setPassEnabled(this.speedPass, false);
    this._setPassEnabled(this.hazePass, false); // only while fires are on screen
    this._setPassEnabled(this.glitchPass, false); // costs nothing until a glitch plays

    this.setMood('NEUTRAL', 0);
  }

  /** Swap the camera (e.g. menu camera → gameplay camera → cutscene camera). */
  setCamera(camera) {
    this.renderPass.mainCamera = camera;
    this.mainPass.mainCamera = camera;
    this.caPass.mainCamera = camera;
    this.glitchPass.mainCamera = camera;
    this.speedPass.mainCamera = camera;
    this.hazePass.mainCamera = camera;
  }

  /** Swap the scene being rendered. */
  setScene(scene) {
    this.renderPass.mainScene = scene;
  }

  /**
   * Blend the color grade to a theme (CLAUDE.md A3).
   *   FIRE    — warm orange, punchy
   *   SHADOWS — dark, purple-black, high contrast
   *   TIME    — cold blue, desaturated
   *   NEUTRAL — untouched
   */
  setMood(theme, seconds = CONFIG.postfx.moodBlendTime) {
    const target = CONFIG.postfx.moods[theme];
    if (!target) {
      console.warn(`[postfx] Unknown mood "${theme}"`);
      return;
    }
    this.mood = theme;
    const u = this.colorGrade.uniforms;

    // Tween one plain object, then copy into the uniforms every update.
    const state = {
      tr: u.get('tint').value.x, tg: u.get('tint').value.y, tb: u.get('tint').value.z,
      lr: u.get('lift').value.x, lg: u.get('lift').value.y, lb: u.get('lift').value.z,
      saturation: u.get('saturation').value,
      contrast: u.get('contrast').value,
      brightness: u.get('brightness').value,
      vignette: this.vignette.darkness,
    };
    const apply = () => {
      u.get('tint').value.set(state.tr, state.tg, state.tb);
      u.get('lift').value.set(state.lr, state.lg, state.lb);
      u.get('saturation').value = state.saturation;
      u.get('contrast').value = state.contrast;
      u.get('brightness').value = state.brightness;
      this.vignette.darkness = state.vignette;
    };

    const to = {
      tr: target.tint[0], tg: target.tint[1], tb: target.tint[2],
      lr: target.lift[0], lg: target.lift[1], lb: target.lift[2],
      saturation: target.saturation,
      contrast: target.contrast,
      brightness: target.brightness,
      vignette: target.vignette,
    };

    this._moodTween?.kill();
    if (seconds <= 0) {
      Object.assign(state, to);
      apply();
      return;
    }
    this._moodTween = gsap.to(state, { ...to, duration: seconds, ease: 'sine.inOut', onUpdate: apply });
  }

  /** 0..1 strength of chromatic aberration (boost, damage, glitches). */
  setChromaticAberration(amount, seconds = 0.25) {
    const { base, max } = CONFIG.postfx.chromaticAberration;
    const value = base + (max - base) * THREE.MathUtils.clamp(amount, 0, 1);
    this._caTween?.kill();
    this._caTween = gsap.to(this.chromatic.offset, { x: value, y: value, duration: seconds, ease: 'power2.out' });
  }

  /**
   * Full-screen glitch burst: snaps to `strength`, flickers, then decays to 0.
   * Returns a promise that resolves when it has finished.
   */
  glitch(seconds = 0.5, strength = 0.8) {
    const u = this.glitchEffect.uniforms;
    u.get('seed').value = Math.random() * 100;
    this._glitchTween?.kill();
    this._setPassEnabled(this.glitchPass, true);
    const st = this.glitchState;
    st.strength = strength;
    const apply = () => {
      // jittery flicker on top of the decay so it never looks like a smooth fade
      u.get('strength').value = st.strength * (0.6 + Math.random() * 0.4);
    };
    this._glitchTween = gsap.to(st, {
      strength: 0,
      duration: seconds,
      ease: 'power2.in',
      onUpdate: apply,
      onComplete: () => {
        u.get('strength').value = 0;
        this._setPassEnabled(this.glitchPass, false);
      },
    });
    apply();
    return this._glitchTween.then();
  }

  /** Radial speed blur 0..1 (the pass is skipped entirely at 0). */
  setSpeedBlur(strength) {
    const on = strength > 0.01 && this.speedBlurAllowed !== false;
    if (on !== this.speedPass.enabled) this._setPassEnabled(this.speedPass, on);
    this.speedBlur.uniforms.get('strength').value = strength;
  }

  /** Apply a Low / Medium / High preset. */
  applyGraphics(preset) {
    this.composer.multisampling = preset.msaa;
    this.bloom.resolution.scale = preset.bloomScale;
    this.bloom.blendMode.opacity.value = preset.bloom ? 1 : 0;
    this._setPassEnabled(this.caPass, preset.chromaticAberration);
    this.speedBlurAllowed = preset.chromaticAberration; // off on Low as well
    if (!this.speedBlurAllowed) this.setSpeedBlur(0);
    this.hazeAllowed = preset.chromaticAberration; // distortion passes are off on Low
    if (!this.hazeAllowed) this.setHeatSources([]);
  }

  /**
   * Enable/disable an optional pass. The composer only draws to the screen
   * from the pass flagged renderToScreen, and skips disabled passes, so that
   * flag must always sit on the LAST ENABLED pass (otherwise: black screen).
   */
  _setPassEnabled(pass, enabled) {
    pass.enabled = enabled;
    const passes = this.composer.passes;
    const last = [...passes].reverse().find((p) => p.enabled);
    passes.forEach((p) => (p.renderToScreen = p === last));
  }

  setSize(width, height) {
    this.composer.setSize(width, height);
  }

  /**
   * Heat haze sources for this frame: [[u, v, radius, strength], …] (max 4),
   * e.g. from fire.hazeSources(camera). Empty → the pass switches off.
   */
  setHeatSources(list) {
    const arr = this.heatHaze.uniforms.get('sources').value;
    for (let i = 0; i < 4; i++) {
      const s = list[i];
      if (s) arr[i].set(s[0], s[1], s[2], s[3]);
      else arr[i].set(0, 0, 0, 0);
    }
    const on = list.length > 0 && this.hazeAllowed !== false;
    if (on !== this.hazePass.enabled) this._setPassEnabled(this.hazePass, on);
  }

  render(deltaSeconds) {
    const u = this.colorGrade.uniforms;
    u.get('drain').value = this.lowHeart * 0.75;
    u.get('pulse').value = this.lowHeart * this.lowHeartPulse * 0.55;
    this.composer.render(deltaSeconds);
  }
}

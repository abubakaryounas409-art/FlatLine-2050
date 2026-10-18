// =============================================================================
// FLATLINE: 2050 — cutscenes/steps.js
// Builders for cutscene scripts (CLAUDE.md Phase 2.1). A script is a list of
// steps, each placed on the timeline with at(seconds, step):
//
//   steps: [
//     at(0,   fade.in(1.2)),
//     at(0,   cam.cut([4, 1.5, 6], [0, 1, 0])),
//     at(0.2, cam.moveTo([2, 1.4, 4], [0, 1.2, 0], 5, 'sine.inOut')),
//     at(1,   subtitle('clockmaker', 'Your body is dying in 2050.', 3.5)),
//     at(2,   actor('kael').play('agree')),
//     at(6,   fade.out(1)),
//   ]
//
// Positions are [x, y, z] arrays. Actor / camera targets may also be an actor
// name ('kael') or 'camera'. Steps are plain objects run by cutscenePlayer.js.
// =============================================================================

/** Place a step at a time (seconds from the start of the cutscene). */
export const at = (time, step) => ({ ...step, at: time });

export const cam = {
  /** Instant cut. */
  cut: (position, lookAt) => ({ type: 'camera.cut', position, lookAt }),
  /** Glide to a position while turning to look at `lookAt`. */
  moveTo: (position, lookAt, duration = 2, ease = 'power2.inOut') => ({ type: 'camera.moveTo', position, lookAt, duration, ease }),
  /** Circle a point (angles in radians, 0 = +Z side). */
  orbit: (center, radius, from, to, height = 1.6, duration = 4, ease = 'none') => ({ type: 'camera.orbit', center, radius, from, to, height, duration, ease }),
  /** Vertigo effect on a target: FOV changes, the subject keeps its size. */
  dollyZoom: (target, toFov = 70, duration = 2, ease = 'sine.inOut') => ({ type: 'camera.dollyZoom', target, toFov, duration, ease }),
  shake: (strength = 0.2, duration = 0.6) => ({ type: 'camera.shake', strength, duration }),
  handheld: (amount = 0.02) => ({ type: 'camera.handheld', amount }),
  fov: (value, duration = 1, ease = 'power2.inOut') => ({ type: 'camera.fov', value, duration, ease }),
};

/** Direct an actor by name. */
export const actor = (name) => ({
  play: (anim, blend = 0.25, opts = {}) => ({ type: 'actor.play', actor: name, anim, blend, opts }),
  /** One-shot animation, then back to `then`. */
  gesture: (anim, then = 'idle', blend = 0.25) => ({ type: 'actor.gesture', actor: name, anim, then, blend }),
  moveTo: (point, speed = 1.35, opts = {}) => ({ type: 'actor.moveTo', actor: name, point, speed, opts }),
  lookAt: (target, rate = 3) => ({ type: 'actor.lookAt', actor: name, target, rate }),
  place: (position, yaw) => ({ type: 'actor.place', actor: name, position, yaw }),
  show: (visible = true) => ({ type: 'actor.show', actor: name, visible }),
});

/** Subtitle line. speaker = key in CONFIG.cutscene.speakers (or any name). */
export const subtitle = (speaker, text, duration = 3) => ({ type: 'subtitle', speaker, text, duration });

/** Voice line from manifest VOICE; shows its subtitle unless subtitle: false. */
export const voice = (key, { subtitle: showSubtitle = true, duration } = {}) => ({ type: 'voice', key, showSubtitle, duration });

export const sfx = (key, { volume = 1, rate = 1, stopAfter } = {}) => ({ type: 'sfx', key, volume, rate, stopAfter });

/** Crossfade music. key = null stops the music. */
export const music = (key, fade = 2) => ({ type: 'music', key, fade });

export const fade = {
  /** From black to the scene. */
  in: (duration = 1) => ({ type: 'fade', to: 'clear', duration }),
  /** From the scene to black (or another colour). */
  out: (duration = 1, color = '#000') => ({ type: 'fade', to: 'black', duration, color }),
};

/** Global slow motion: ease to `scale`, hold `duration` real seconds, return to 1. */
export const slowMo = (scale = 0.2, duration = 1.5, blend = 0.2) => ({ type: 'slowMo', scale, duration, blend });

/** Full-screen flash (white by default). */
export const flash = (color = '#ffffff', duration = 0.5) => ({ type: 'flash', color, duration });

/** Full-screen glitch burst. */
export const glitch = (duration = 0.5, strength = 0.8) => ({ type: 'glitch', duration, strength });

/** Colour grade: 'FIRE' | 'SHADOWS' | 'TIME' | 'NEUTRAL'. */
export const setMood = (theme, duration = 1.2) => ({ type: 'mood', theme, duration });

export const letterbox = (visible = true) => ({ type: 'letterbox', visible });

/** Run custom code: call((ctx) => { ... }). ctx = { world, actors, camera, player } */
export const call = (fn) => ({ type: 'call', fn });

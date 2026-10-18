// =============================================================================
// FLATLINE: 2050 — core/audio.js
// Music, UI sounds and voice through Howler. 3D (positional) sounds use
// Three.js PositionalAudio and are added by the systems that need them.
//
// Missing files are silent: play() on a missing sound just returns null.
//
// Browsers only allow sound after the player clicks or presses a key, which
// is why the game opens with a "click to begin" gate (ui/bootIntro.js).
// =============================================================================

import { Howl, Howler } from 'howler';
import { MUSIC, SFX, VOICE } from '../assets/manifest.js';
import { CONFIG } from '../config.js';

const BASE = import.meta.env.BASE_URL;
const TABLES = { music: MUSIC, sfx: SFX, voice: VOICE };
const CLIP = 'clip'; // Howler sprite name used for manifest `clip` slices

class AudioSystem {
  constructor() {
    this.howls = new Map();     // 'category.key' -> Howl (only successfully loaded)
    this.pending = new Map();   // 'category.key' -> Promise<boolean>
    this.lastPlayed = new Map(); // 'category.key' -> ms timestamp (throttling)
    this.currentMusic = null;   // { id, howl, soundId }
    this.volumes = {
      master: CONFIG.audio.master,
      music: CONFIG.audio.music,
      sfx: CONFIG.audio.sfx,
      voice: CONFIG.audio.voice,
    };
    // Set when a download manager (e.g. IDM) swallows audio requests.
    this.blockedByDownloadManager = false;
    Howler.volume(this.volumes.master);
  }

  /** Load a sound. Resolves true if it loaded, false if missing. Never rejects. */
  load(category, key) {
    const id = `${category}.${key}`;
    if (this.pending.has(id)) return this.pending.get(id);

    const entry = TABLES[category]?.[key];
    if (!entry) {
      console.warn(`[audio] manifest.js has no ${id}`);
      return Promise.resolve(false);
    }

    const promise = new Promise((resolve) => {
      const howl = new Howl({
        src: [BASE + entry.path],
        loop: !!entry.loop,
        // Stream long music tracks instead of decoding them fully into memory.
        html5: category === 'music',
        preload: true,
        sprite: entry.clip ? { [CLIP]: [entry.clip[0], entry.clip[1], !!entry.loop] } : undefined,
        onload: () => {
          this.howls.set(id, howl);
          resolve(true);
        },
        onloaderror: () => {
          this._diagnose(entry.path);
          resolve(false);
        },
      });
    });
    this.pending.set(id, promise);
    return promise;
  }

  /**
   * Download managers such as Internet Download Manager intercept .mp3
   * requests inside the browser and answer "204 No Content". Detect that once
   * so the player gets a useful message instead of silent menus.
   */
  async _diagnose(path) {
    if (this.blockedByDownloadManager) return;
    try {
      const res = await fetch(BASE + path, { cache: 'no-store' });
      if (res.status === 204) {
        this.blockedByDownloadManager = true;
        console.warn(
          '%c[AUDIO BLOCKED]%c A download manager (e.g. IDM) intercepted the game\'s .mp3 files. ' +
            'Add "localhost" and "127.0.0.1" to its exception list, or turn off its browser integration.',
          'color:#ff6a1a;font-weight:bold',
          'color:inherit',
        );
      }
    } catch { /* offline etc. — the loader already warned */ }
  }

  isLoaded(category, key) {
    return this.howls.has(`${category}.${key}`);
  }

  /** Length in seconds of a loaded sound (its clip if it has one), else null. */
  duration(category, key) {
    const howl = this.howls.get(`${category}.${key}`);
    if (!howl) return null;
    const clip = TABLES[category][key].clip;
    return clip ? clip[1] / 1000 : howl.duration();
  }

  categoryVolume(category) {
    return this.volumes[category] ?? 1;
  }

  /**
   * Play a one-shot or loop. Returns the Howler sound id, or null if missing.
   * minInterval (ms) skips the sound if it played very recently (hover ticks).
   */
  play(category, key, { volume = 1, rate = 1, minInterval = 0 } = {}) {
    const id = `${category}.${key}`;
    const howl = this.howls.get(id);
    if (!howl) return null;

    const now = performance.now();
    if (minInterval && now - (this.lastPlayed.get(id) ?? -Infinity) < minInterval) return null;
    this.lastPlayed.set(id, now);

    const entry = TABLES[category][key];
    const soundId = entry.clip ? howl.play(CLIP) : howl.play();
    howl.volume(volume * this.categoryVolume(category), soundId);
    howl.rate(rate, soundId);
    return soundId;
  }

  /** Shortcut for UI / non-positional effects. */
  sfx(key, opts) {
    return this.play('sfx', key, opts);
  }

  /**
   * A 3D sound at a world position (Howler spatial: panning + distance falloff;
   * the listener follows the camera via setListener). `echo` adds a slapback
   * repeat — gunshots in alleys and tunnels.
   * @param {{x:number,y:number,z:number}} position
   */
  sfxAt(key, position, { volume = 1, rate = 1, refDistance = 4, rolloff = 1.1, maxDistance = 150, minInterval = 0, echo = null } = {}) {
    const id = this.play('sfx', key, { volume, rate, minInterval });
    if (id == null) return null;
    const howl = this.howls.get(`sfx.${key}`);
    howl.pos(position.x, position.y, position.z, id);
    howl.pannerAttr({ panningModel: 'equalpower', distanceModel: 'inverse', refDistance, rolloffFactor: rolloff, maxDistance }, id);
    if (echo) {
      const p = { x: position.x, y: position.y, z: position.z };
      setTimeout(() => this.sfxAt(key, p, { volume: volume * echo.volume, rate: rate * 0.96, refDistance: refDistance * 2, rolloff }), echo.delay * 1000);
    }
    return id;
  }

  /** Put the 3D-sound listener at the camera (call once per frame in 3D worlds). */
  setListener(camera) {
    const m = camera.matrixWorld.elements;
    Howler.pos(m[12], m[13], m[14]);
    Howler.orientation(-m[8], -m[9], -m[10], m[4], m[5], m[6]);
  }

  /** Change a playing sound's volume (0..1, before category volume) and/or rate (pitch). */
  set(category, key, soundId, { volume, rate } = {}) {
    const howl = this.howls.get(`${category}.${key}`);
    if (!howl || soundId == null) return;
    if (volume !== undefined) howl.volume(Math.max(0, Math.min(1, volume)) * this.categoryVolume(category), soundId);
    if (rate !== undefined) howl.rate(Math.max(0.5, Math.min(4, rate)), soundId);
  }

  /** Fade out and stop one playing sound. */
  stop(category, key, soundId, fadeSeconds = 0) {
    const howl = this.howls.get(`${category}.${key}`);
    if (!howl || soundId == null) return;
    if (fadeSeconds <= 0) {
      howl.stop(soundId);
      return;
    }
    howl.fade(howl.volume(soundId), 0, fadeSeconds * 1000, soundId);
    howl.once('fade', () => howl.stop(soundId), soundId);
  }

  /** Cross-fade to a new music track (fades the old one out). */
  async playMusic(key, fadeSeconds = CONFIG.audio.musicFadeSeconds) {
    const id = `music.${key}`;
    if (this.currentMusic?.id === id) return;
    this.stopMusic(fadeSeconds);

    if (!(await this.load('music', key))) return;
    const howl = this.howls.get(id);
    const soundId = howl.play();
    howl.fade(0, this.categoryVolume('music'), fadeSeconds * 1000, soundId);
    this.currentMusic = { id, howl, soundId };
  }

  stopMusic(fadeSeconds = CONFIG.audio.musicFadeSeconds) {
    if (!this.currentMusic) return;
    const { howl, soundId } = this.currentMusic;
    howl.fade(howl.volume(soundId), 0, fadeSeconds * 1000, soundId);
    howl.once('fade', () => howl.stop(soundId), soundId);
    this.currentMusic = null;
  }

  /** Slow or speed music (used by the heartbeat system and slow-motion). */
  setMusicRate(rate) {
    if (this.currentMusic) this.currentMusic.howl.rate(rate, this.currentMusic.soundId);
  }

  setVolume(category, value) {
    this.volumes[category] = value;
    if (category === 'master') Howler.volume(value);
    if (category === 'music' && this.currentMusic) {
      this.currentMusic.howl.volume(value, this.currentMusic.soundId);
    }
  }
}

export const audio = new AudioSystem();

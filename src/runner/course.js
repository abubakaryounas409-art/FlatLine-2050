// =============================================================================
// FLATLINE: 2050 — runner/course.js
// The hand-paced course for each act (seeded, so every run is the same and
// can be learnt). Each act teaches its power, then tests it:
//
//   ACT I   ⏳ TIME     lanes/jump/roll tutorial → Time Stop vs chrono shutters
//                       and ghost racers from the crash
//   ACT II  🌑 SHADOWS  Shadow Phase vs laser grids and enforcer squads,
//                       rooftop gaps, Umbra running beside you
//   ACT III 🔥 FIRE     Burn vs burning barricades, falling beams, everything
//                       at once
//
// Obstacle kinds (see obstacles.js):
//   low (jump) · high (roll) · block (switch lane) · oncoming (dodge / ⏳)
//   shutter (⏳ gate) · laser (🌑 gate) · squad (🌑 or 🔥) · firewall (🔥 gate)
//   gap (jump) · beam (falls → jump, or ⏳ freeze it high)
// =============================================================================

import { CONFIG } from '../config.js';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Memory fragments: each restores heartbeats and tells a piece of the story. */
const MEMORIES = {
  time: [
    'Dad\'s workshop, 2020. Solder smoke and burnt coffee.',
    '"An engine is just a heart, Kael. Keep it beating." — Elias Rayne',
    'The brake line was cut clean. Not worn. Cut.',
  ],
  shadows: [
    'The night of the fire you were seven, watching from the car.',
    'You never went back inside. You never forgave yourself.',
    'Victor Hale signed the insurance papers the next morning.',
  ],
  fire: [
    'The gas can was red. Victor\'s watch was gold.',
    'The magnetic engine. Dad\'s design. Hale\'s name on the patent.',
    'The clock on the wall stopped at 20:20.',
  ],
};

class Builder {
  constructor(act, seed) {
    this.act = act;
    this.r = rng(seed);
    this.obstacles = [];
    this.shards = [];
    this.orbs = [];
    this.fragments = [];
    this.prompts = [];
    this.story = [];
    this._mem = 0;
  }

  pick(list) {
    return list[Math.floor(this.r() * list.length)];
  }

  ob(kind, z, lane = 1, extra = {}) {
    this.obstacles.push({ kind, z, lane, ...extra });
  }

  /** A line of shards along a lane (y follows a jump arc when `arc`). */
  line(z, lane, count = 6, { spacing = 2.4, arc = false } = {}) {
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      const y = arc ? 0.9 + Math.sin(t * Math.PI) * 1.6 : 0.9;
      this.shards.push({ z: z + i * spacing, lane, y });
    }
  }

  orb(z, lane, type) {
    this.orbs.push({ z, lane, type });
  }

  fragment(z, lane) {
    const list = MEMORIES[this.act];
    this.fragments.push({ z, lane, text: list[this._mem % list.length] });
    this._mem += 1;
  }

  prompt(z, keys, text, ability = null) {
    this.prompts.push({ z, keys, text, ability });
  }

  say(z, id) {
    this.story.push({ z, id });
  }

  // --- patterns (return the z after the pattern) ---------------------------------------------
  /** One row; at least one lane stays open (by running), shards in it. */
  row(z, diff) {
    const free = Math.floor(this.r() * 3);
    const kinds = this.act === 'shadows' ? ['block', 'low', 'high', 'block'] : ['block', 'low', 'high'];
    for (let lane = 0; lane < 3; lane++) {
      if (lane === free) continue;
      if (this.r() < 0.25 + diff * 0.5) this.ob(this.pick(kinds), z, lane, { len: 3 + this.r() * 6 });
    }
    // sometimes the open lane has a jump/roll in it too (harder)
    if (diff > 0.4 && this.r() < diff * 0.5) this.ob(this.r() < 0.5 ? 'low' : 'high', z + 0.5, free);
    else this.line(z - 6, free, 5);
    return z;
  }

  /** A full-width jump or roll. */
  wall(z, kind) {
    for (let lane = 0; lane < 3; lane++) this.ob(kind, z, lane);
    this.line(z - 7, Math.floor(this.r() * 3), 6, { spacing: 2.4, arc: kind === 'low' });
    return z;
  }

  /** A "train": a long block with lows/highs in the other lanes. */
  train(z, diff) {
    const lane = Math.floor(this.r() * 3);
    const len = 16 + this.r() * 14;
    this.ob('block', z, lane, { len });
    const others = [0, 1, 2].filter((l) => l !== lane);
    const a = others[Math.floor(this.r() * 2)];
    this.ob(this.r() < 0.5 ? 'low' : 'high', z + len * (0.3 + this.r() * 0.4), a);
    if (diff > 0.5) {
      const b = others.find((l) => l !== a);
      this.ob(this.r() < 0.5 ? 'low' : 'high', z + len * 0.8, b);
    }
    this.line(z, others[0], 7, { spacing: 2.6 });
    return z + len;
  }

  /** A zig-zag of single blocks the player weaves through. */
  slalom(z, steps = 3) {
    let lane = Math.floor(this.r() * 3);
    for (let i = 0; i < steps; i++) {
      this.ob('block', z + i * 16, lane, { len: 3 });
      lane = (lane + 1 + Math.floor(this.r() * 2)) % 3;
    }
    return z + (steps - 1) * 16;
  }

  /** A theme gate with its orb waiting ahead of it. */
  gate(z, kind, orbType, orbLane = 1) {
    this.orb(z - 75, orbLane, orbType);
    if (kind === 'firewall' || kind === 'laser' || kind === 'squad' || kind === 'shutter') this.ob(kind, z, 1);
    return z;
  }
}

// -----------------------------------------------------------------------------
// The three acts
// -----------------------------------------------------------------------------
function actTime(b, length) {
  // tutorial
  b.line(20, 1, 8);
  b.say(8, 'time_start');
  b.prompt(55, ['A', 'D'], 'CHANGE LANE', null);
  b.ob('block', 95, 1, { len: 5 });
  b.line(80, 0, 6);
  b.ob('block', 140, 0, { len: 5 });
  b.ob('block', 140, 1, { len: 5 });
  b.line(126, 2, 6);
  b.prompt(170, ['W', 'SPACE'], 'JUMP', null);
  b.wall(212, 'low');
  b.prompt(250, ['S'], 'ROLL', null);
  b.wall(292, 'high');
  b.say(300, 'time_victor');
  // first mixed section
  let z = 330;
  for (let i = 0; i < 6; i++) z = b.row(z, 0.15 + i * 0.05) + 20;
  b.fragment(z - 8, 1);
  // ⏳ time stop lesson
  b.orb(z + 10, 1, 'time');
  b.prompt(z + 4, ['TIME ORB'], 'COLLECT IT', 'time');
  b.say(z + 30, 'time_tutorial');
  b.prompt(z + 52, ['R'], 'STOP TIME — FREEZE THE SHUTTER', 'time');
  b.ob('shutter', z + 95, 1);
  z += 125;
  // ghost racers from the crash
  b.say(z, 'time_ghosts');
  b.prompt(z + 4, ['A', 'D', 'R'], 'GHOST CARS — DODGE OR FREEZE THEM', null);
  b.ob('oncoming', z + 70, 1);
  b.line(z + 30, 0, 6);
  b.ob('oncoming', z + 120, 2);
  b.ob('oncoming', z + 150, 0);
  z += 175;
  b.orb(z, 0, 'time');
  for (let i = 0; i < 3; i++) z = b.row(z + 22, 0.35 + i * 0.08) ;
  z = b.slalom(z + 24, 3) + 22;
  b.fragment(z - 8, 2);
  b.gate(z + 80, 'shutter', 'time', 2);
  b.ob('oncoming', z + 40, 0);
  z += 110;
  z = b.train(z, 0.4) + 22;
  b.ob('oncoming', z + 10, 1);
  b.ob('oncoming', z + 28, 0);
  z += 50;
  for (let i = 0; i < 3; i++) z = b.row(z + 20, 0.45 + i * 0.05);
  b.fragment(Math.min(z + 12, length - 60), 1);
  b.say(length - 70, 'time_end');
}

function actShadows(b, length) {
  b.line(25, 1, 8);
  b.say(6, 'shadow_start');
  b.say(40, 'shadow_umbra');
  b.orb(70, 1, 'shadow');
  b.prompt(64, ['SHADOW ORB'], 'COLLECT IT', 'shadow');
  b.prompt(110, ['Q'], 'SHADOW PHASE — PASS THROUGH THE LASERS', 'shadow');
  b.ob('laser', 160, 1);
  b.say(175, 'shadow_tutorial');
  b.prompt(195, ['W'], 'JUMP THE GAP', null);
  b.ob('gap', 235, 1, { len: 6 });
  let z = 270;
  for (let i = 0; i < 4; i++) z = b.row(z, 0.3 + i * 0.06) + 20;
  b.ob('gap', z + 4, 1, { len: 6 });
  b.fragment(z + 30, 0);
  z += 40;
  b.say(z, 'shadow_mara');
  b.gate(z + 90, 'squad', 'shadow', 1);
  b.prompt(z + 40, ['Q'], 'THEY CAN\'T SEE YOU IN THE SHADOWS', 'shadow');
  z += 115;
  z = b.train(z, 0.5) + 22;
  z = b.slalom(z, 3) + 22;
  b.ob('gap', z, 1, { len: 7 });
  z += 26;
  b.orb(z - 6, 2, 'time');
  b.ob('shutter', z + 60, 1);
  b.prompt(z + 18, ['R'], 'POLICE SHUTTER — STOP TIME', 'time');
  z += 85;
  for (let i = 0; i < 3; i++) z = b.row(z + 20, 0.5 + i * 0.06);
  b.fragment(z + 10, 2);
  b.gate(z + 95, 'laser', 'shadow', 0);
  z += 120;
  b.say(z - 10, 'shadow_umbra2');
  z = b.train(z, 0.6) + 22;
  b.ob('gap', z, 1, { len: 7 });
  z += 26;
  for (let i = 0; i < 3; i++) z = b.row(z + 18, 0.6);
  b.gate(Math.min(z + 90, length - 50), 'squad', 'shadow', 2);
  b.say(length - 60, 'shadow_end');
}

function actFire(b, length) {
  b.line(25, 1, 8);
  b.say(6, 'fire_start');
  b.orb(70, 1, 'fire');
  b.prompt(64, ['FIRE ORB'], 'COLLECT IT', 'fire');
  b.prompt(110, ['E'], 'BURN — SMASH THROUGH THE FIRE', 'fire');
  b.ob('firewall', 165, 1);
  b.say(180, 'fire_tutorial');
  let z = 200;
  b.prompt(z + 10, ['W', 'R'], 'BEAMS FALLING — JUMP THEM, OR FREEZE THEM', null);
  b.ob('beam', z + 50, 1);
  b.orb(z + 30, 2, 'time');
  b.ob('beam', z + 95, 1);
  z += 120;
  for (let i = 0; i < 3; i++) z = b.row(z + 20, 0.45 + i * 0.06);
  b.fragment(z + 12, 1);
  b.gate(z + 95, 'firewall', 'fire', 0);
  z += 120;
  b.say(z, 'fire_victor');
  z = b.train(z + 10, 0.6) + 22;
  b.orb(z, 1, 'shadow');
  b.ob('laser', z + 70, 1);
  z += 95;
  b.ob('beam', z, 1);
  z = b.slalom(z + 26, 3) + 22;
  b.gate(z + 90, 'squad', 'fire', 2);
  z += 115;
  b.fragment(z, 0);
  for (let i = 0; i < 3; i++) z = b.row(z + 18, 0.6 + i * 0.05);
  b.orb(z + 10, 1, 'time');
  b.ob('shutter', z + 75, 1);
  z += 100;
  b.ob('beam', z, 1);
  z = b.train(z + 26, 0.7) + 22;
  b.say(z, 'fire_heart');
  b.gate(Math.min(z + 90, length - 70), 'firewall', 'fire', 1);
  b.fragment(length - 30, 1);
  b.say(length - 40, 'fire_end');
}

const ACT_BUILDERS = { time: actTime, shadows: actShadows, fire: actFire };

/** Build an act's course. */
export function buildCourse(actIndex, seed = 2020) {
  const act = CONFIG.runner.acts[actIndex];
  const b = new Builder(act.id, seed + actIndex * 101);
  ACT_BUILDERS[act.id](b, act.length);
  const inside = (o) => o.z < act.length - 20;
  const sort = (a, c) => a.z - c.z;
  return {
    act,
    length: act.length,
    obstacles: b.obstacles.filter(inside).sort(sort),
    shards: b.shards.filter(inside).sort(sort),
    orbs: b.orbs.filter(inside).sort(sort),
    fragments: b.fragments.filter((o) => o.z < act.length).sort(sort),
    prompts: b.prompts.sort(sort),
    story: b.story.sort(sort),
  };
}

// =============================================================================
// FLATLINE: 2050 — dev/combatArena.js
// Phase 8 test (?combat): a walled courtyard at night with six of Hale's
// enforcers on patrol. Low barriers, tall pillars and crate stacks give both
// sides cover; four shootable lamps decide where the dark is (🌑 enemies
// can't see Kael in shadow); barrels burn and explode (🔥).
// =============================================================================

import { CONFIG } from '../config.js';
import { createOnFootWorld, ON_FOOT_ASSETS, ON_FOOT_HELP } from '../scenes/onFootWorld.js';

export const COMBAT_ARENA_ASSETS = [...ON_FOOT_ASSETS];

/** Obstacles: [size, position, low?] — each also becomes cover on all four sides. */
const OBSTACLES = [
  [[4, 1.0, 0.6], [-8, 0.5, -6], true],
  [[4, 1.0, 0.6], [8, 0.5, -6], true],
  [[1.2, 2.8, 1.2], [0, 1.4, -2], false],
  [[0.6, 1.0, 4], [-12, 0.5, 4], true],
  [[0.6, 1.0, 4], [12, 0.5, 4], true],
  [[1.2, 2.8, 1.2], [-5, 1.4, 6], false],
  [[1.2, 2.8, 1.2], [5, 1.4, 6], false],
  [[5, 1.0, 0.6], [0, 0.5, 11], true],
  [[1.6, 1.6, 1.6], [-9, 0.8, 13], false],
  [[1.6, 1.6, 1.6], [9, 0.8, 13], false],
  [[3, 2.6, 0.6], [0, 1.3, 17], false],
  [[4, 1.0, 0.6], [-6, 0.5, -13], true],
  [[4, 1.0, 0.6], [6, 0.5, -13], true],
];

export function createCombatArena(renderer, assets, { onExit = () => {} } = {}) {
  return createOnFootWorld(renderer, assets, {
    spawn: [0, 0, -19],
    yaw: 0,
    fog: 0.022,
    help: { title: 'Combat test · 6 enforcers', keys: ON_FOOT_HELP },
    echo: () => CONFIG.weapons.echo,
    onExit,
    exitTitle: 'Leave the combat test?',
    exitText: 'Back to the main menu.',
    build(kit) {
      const { mats, addBox, addCover, addLamp, addProp, ai } = kit;
      // courtyard walls 44 × 48
      addBox([46, 9, 1], [0, 4.5, -23.5], mats.brick);
      addBox([46, 9, 1], [0, 4.5, 23.5], mats.brick);
      addBox([1, 9, 48], [-22.5, 4.5, 0], mats.brick);
      addBox([1, 9, 48], [22.5, 4.5, 0], mats.brick);
      for (const [size, pos, low] of OBSTACLES) {
        addBox(size, pos, low ? mats.concrete : mats.brick);
        const [sx, , sz] = size;
        const [x, , z] = pos;
        const off = 0.55;
        addCover([x, 0, z - sz / 2 - off], low);
        addCover([x, 0, z + sz / 2 + off], low);
        addCover([x - sx / 2 - off, 0, z], low);
        addCover([x + sx / 2 + off, 0, z], low);
      }
      // crates + barrels (burn / explode)
      addProp('props.crate', [-15, 0, -2], 0.3, { surface: 'wood' });
      addProp('props.crate', [15, 0, -2], -0.2, { surface: 'wood' });
      addProp('props.barrel', [-16, 0, 16], 0, { surface: 'metal' });
      addProp('props.barrel', [16, 0, 16], 0, { surface: 'metal' });
      [[-15, 0.4, -2], [15, 0.4, -2], [-16, 0.45, 16], [16, 0.45, 16]].forEach((p) => kit.addFlammable(p));
      addCover([-15, 0, -3.1], true);
      addCover([15, 0, -3.1], true);
      // lamps: pools of light, dark gaps between them
      addLamp([-21.5, 0, -10], { rotY: Math.PI / 2 });
      addLamp([21.5, 0, -10], { rotY: -Math.PI / 2 });
      addLamp([-21.5, 0, 10], { rotY: Math.PI / 2, shadow: true });
      addLamp([21.5, 0, 10], { rotY: -Math.PI / 2 });
      addLamp([0, 0, 22.5], { rotY: Math.PI });
      // floodlights over the middle — shoot them out to fight in the dark
      addLamp([-2.5, 0, -9], { rotY: 0, intensity: 45, reach: 15 });
      addLamp([2.5, 0, 3], { rotY: Math.PI, intensity: 45, reach: 15, shadow: true });
      addLamp([-3, 0, 14], { rotY: Math.PI, intensity: 45, reach: 15 });

      // six enforcers on patrol in the far half
      ai.spawn({ position: [-6, 0, 8], yaw: Math.PI, patrol: [[-6, 0, 8], [-14, 0, 8], [-14, 0, 18]] });
      ai.spawn({ position: [6, 0, 8], yaw: Math.PI, patrol: [[6, 0, 8], [14, 0, 8], [14, 0, 18]] });
      ai.spawn({ position: [0, 0, 14], yaw: Math.PI, patrol: [[0, 0, 14], [-4, 0, 20], [4, 0, 20]] });
      ai.spawn({ position: [-12, 0, 0], yaw: Math.PI / 2, patrol: [[-12, 0, 0], [-18, 0, 0]] });
      ai.spawn({ position: [12, 0, 0], yaw: -Math.PI / 2, patrol: [[12, 0, 0], [18, 0, 0]] });
      ai.spawn({ position: [0, 0, 20], yaw: Math.PI, patrol: [] });

      kit.addFragment([-19, 0, -19], '"Engines are just hearts, Kael. Keep them beating."');
      kit.addFragment([19, 0, -19], 'The smell of rain on hot asphalt. Race day.');
      return {};
    },
  });
}

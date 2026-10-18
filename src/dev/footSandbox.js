// =============================================================================
// FLATLINE: 2050 — dev/footSandbox.js
// Phases 5–7 test world (?foot): a rainy 2020 back alley to try every on-foot
// move — run / sprint / crouch, jump, roll under the pipe, vault the low
// walls, cover behind the tall wall and crates, interact with the radio —
// the guns (Hale's enforcers as dummies, shootable lamps 🌑, incendiary
// rounds and an explosive barrel 🔥), Shadow Step, spreading fire, memory
// fragments and ⏳ rewind. Built on scenes/onFootWorld.js.
// =============================================================================

import { audio } from '../core/audio.js';
import { subtitles } from '../cutscenes/subtitles.js';
import { createOnFootWorld, ON_FOOT_ASSETS, ON_FOOT_HELP } from '../scenes/onFootWorld.js';
import { addShootingRange } from './shootingRange.js';
import { CONFIG } from '../config.js';

export const FOOT_SANDBOX_ASSETS = [
  ...ON_FOOT_ASSETS,
  'props.radio', 'props.dumpster', 'props.ac_unit', 'voice.m2_clockmaker_01',
];

/** The back alley — also reused by the combat arena. */
export function buildAlley(kit) {
  const { mats, addBox, addProp, addStairs, addLamp } = kit;
  // two brick walls of buildings, 9 m apart, 46 m long (runs along +Z), dead end
  addBox([1, 14, 46], [-5, 7, 8], mats.brick);
  addBox([1, 14, 46], [5, 7, 8], mats.brick);
  addBox([11, 14, 1], [0, 7, 31.5], mats.brick);
  // warm windows
  const THREE = kit.THREE;
  const winMat = kit.track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb36a).multiplyScalar(1.6) }));
  const winGeo = kit.track(new THREE.PlaneGeometry(1.2, 1.5));
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let z = -10; z < 30; z += 4.5) {
    for (const [x, y] of [[-4.45, 4.5], [4.45, 7.5], [-4.45, 10.5]]) {
      if (rnd() < 0.45) continue;
      const w = new THREE.Mesh(winGeo, winMat);
      w.position.set(x, y, z + rnd());
      w.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      kit.scene.add(w);
    }
  }
  // the course
  addBox([6, 0.95, 0.4], [0, 0.475, -2], mats.concrete);          // low wall → vault / low cover
  addBox([3.2, 2.3, 0.5], [-1.6, 1.15, 6], mats.concrete);        // tall wall → high cover + peek
  addProp('props.crate', [2.6, 0, 6.2], 0.2, { surface: 'wood' }); // crates → low cover
  addProp('props.crate', [3.3, 0, 7.1], -0.3, { surface: 'wood' });
  addProp('props.dumpster', [-3.6, 0, 11], Math.PI / 2, { surface: 'metal' });
  addBox([9, 0.25, 0.35], [0, 1.32, 14], mats.metal, { cast: false }); // pipe at 1.2 m: roll / crouch under
  addBox([9, 0.2, 0.2], [0, 1.6, 14.1], mats.metal, { cast: false });
  addBox([6, 0.75, 0.4], [1.5, 0.375, 18], mats.concrete);         // a lower wall → vault
  addStairs([-2.5, 0, 20.8], { width: 3, steps: 6 });                // up to the loading dock
  addBox([3, 1.08, 4], [-2.5, 0.54, 25.4], mats.concrete);
  addProp('props.ac_unit', [3.7, 0, 24], -Math.PI / 2, { surface: 'metal' });
  addProp('props.barrel', [3.6, 0, 27.5], 0, { surface: 'metal' });
  addProp('props.barrel', [2.9, 0, 28.3], 0, { surface: 'metal' });
  // sodium lamps (shootable)
  addLamp([-3.8, 0, -6], { rotY: Math.PI / 2 });
  addLamp([3.8, 0, 9], { rotY: -Math.PI / 2, shadow: true });
  addLamp([-3.8, 0, 22], { rotY: Math.PI / 2 });
  // 🔥 things that burn
  [[2.6, 0.4, 6.2], [3.3, 0.4, 7.1], [3.6, 0.45, 27.5], [2.9, 0.45, 28.3], [-3.6, 0.6, 11]].forEach((p) => kit.addFlammable(p));
}

/** Gunshots slap back off the alley walls. */
export const alleyEcho = (p) => (Math.abs(p.x) < 4.5 && p.z > -3 && p.z < 31 ? CONFIG.weapons.echo : null);

export function createFootSandbox(renderer, assets, { onExit = () => {} } = {}) {
  return createOnFootWorld(renderer, assets, {
    spawn: [0, 0, -11],
    yaw: 0,
    help: { title: 'On foot · guns · abilities', keys: ON_FOOT_HELP },
    echo: alleyEcho,
    onExit,
    exitTitle: 'Leave the sandbox?',
    exitText: 'Back to the main menu.',
    build(kit) {
      buildAlley(kit);
      const { THREE, scene, player, weapons, fx, addProp } = kit;

      // pushable metal boxes (dynamic) — rewind with Kael
      const R = kit.R;
      const crateGeo = kit.track(new THREE.BoxGeometry(0.6, 0.6, 0.6));
      const crates = [];
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(crateGeo, kit.mats.metal);
        m.castShadow = true;
        scene.add(m);
        const body = kit.physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(-2.6 + i * 0.7, 0.3 + (i === 3 ? 0.6 : 0), -6).setLinearDamping(0.4));
        const c = kit.physics.world.createCollider(R.ColliderDesc.cuboid(0.3, 0.3, 0.3).setDensity(25).setFriction(0.7), body);
        weapons.setSurface(c, 'metal');
        kit.physics.link(body, m);
        crates.push(body);
      }
      const offCrates = kit.timeRewind.register({
        snapshot: () => crates.map((b) => [b.translation(), b.rotation(), b.linvel(), b.angvel()]),
        restore: (s) => s.forEach(([t, r, v, w], i) => {
          crates[i].setTranslation(t, true);
          crates[i].setRotation(r, true);
          crates[i].setLinvel(v, true);
          crates[i].setAngvel(w, true);
        }),
      });

      // the Clockmaker's radio — the first interactable
      const radio = addProp('props.radio', [2.6, 0.8, 6.2], -0.6, { collide: false });
      kit.addInteractable({
        position: radio.position,
        prompt: 'Listen to the radio',
        height: 0.5,
        onInteract: async () => {
          audio.sfx('radio_static', { volume: 0.8 });
          await new Promise((r) => setTimeout(r, 600));
          audio.play('voice', 'm2_clockmaker_01');
          subtitles.show('clockmaker', 'Your body is dying in 2050. Find the truth in this year, or you never wake up.', 5);
        },
      });

      // targets: dummies + explosive barrel
      const range = addShootingRange({
        scene, assets: kit.assets, weapons, fx,
        dummies: [{ position: [1.6, 0, 11.5], yaw: Math.PI }, { position: [-2.4, 1.08, 26], yaw: Math.PI }, { position: [2.8, 0, 21.5], yaw: Math.PI * 1.1 }],
        barrel: [3.4, 0, 16.2],
      });

      // memory fragments
      kit.addFragment([-3.4, 0, -9], 'Dad used to hum while he soldered. Always the same song.');
      kit.addFragment([3.9, 0, 12.6], 'The workshop smelled of oil and burnt coffee.');
      kit.addFragment([-2.6, 1.08, 27.2], '"Engines are just hearts, Kael. Keep them beating."');
      void player;
      return {
        range,
        update: (dt) => range.update(dt),
        dispose() {
          offCrates();
          range.dispose();
        },
      };
    },
  });
}

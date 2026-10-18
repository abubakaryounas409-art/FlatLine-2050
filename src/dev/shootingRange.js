// =============================================================================
// FLATLINE: 2050 — dev/shootingRange.js
// Phase 6 targets for the ?foot sandbox: Hale's enforcers as training dummies
// (hit reactions, head shots, death, respawn, 🔥 burning), an explosive
// barrel, and small incendiary fires. Real enemy AI arrives in Phase 8.
// =============================================================================

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { audio } from '../core/audio.js';
import { createModelInstance } from '../assets/loader.js';
import { Actor } from '../cutscenes/actor.js';
import { fire } from '../systems/fire.js';

const HEAD_HEIGHT = 1.45;

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {Map} o.assets
 * @param {WeaponSystem} o.weapons
 * @param {CombatFX} o.fx
 * @param {{position:number[], yaw:number}[]} o.dummies
 * @param {number[]} o.barrel  explosive barrel position
 */
export function addShootingRange({ scene, assets, weapons, fx, dummies, barrel }) {
  const R = physics.RAPIER;
  const offs = [];

  // --- Dummies ---------------------------------------------------------------------------
  const tpl = assets.get('characters.enemy');
  const targets = dummies.map(({ position, yaw }) => {
    const obj = createModelInstance(tpl);
    scene.add(obj);
    const actor = new Actor('dummy', obj, tpl.animations);
    actor.place(position, yaw);
    actor.play('idle_gun', 0.01);
    const base = new THREE.Vector3(...position);
    const body = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(base.x, base.y, base.z));
    const collider = physics.world.createCollider(R.ColliderDesc.capsule(0.55, 0.3).setTranslation(0, 0.88, 0), body);
    const t = { actor, base, collider, health: 100, dead: false, burn: 0, respawn: 0 };
    offs.push(weapons.register(collider, {
      surface: 'flesh',
      onHit: (hit) => damage(t, hit.damage * (hit.point.y - base.y > HEAD_HEIGHT ? 2.5 : 1), hit),
    }));
    return t;
  });

  function damage(t, amount, hit = null) {
    if (t.dead) return { killed: false, counted: false };
    t.health -= amount;
    if (hit?.incendiary) t.burn = CONFIG.weapons.incendiary.burnSeconds;
    if (t.health <= 0) {
      t.dead = true;
      t.burn = 0;
      t.actor.play('death', 0.1, { loop: false, clamp: true });
      t.collider.setEnabled(false);
      t.respawn = 5;
      return { killed: true };
    }
    if (amount >= 5) t.actor.gesture('hit', 'idle_gun', 0.1); // not on every burn tick
    return { killed: false };
  }

  // --- Explosive barrel ----------------------------------------------------------------------
  let barrelState = null;
  if (barrel) {
    const bTpl = assets.get('props.barrel_explosive');
    const obj = createModelInstance(bTpl);
    obj.position.set(...barrel);
    scene.add(obj);
    const collider = physics.world.createCollider(R.ColliderDesc.cylinder(0.45, 0.3).setTranslation(barrel[0], barrel[1] + 0.45, barrel[2]));
    barrelState = { obj, collider, hp: 3, gone: false };
    offs.push(weapons.register(collider, {
      surface: 'metal',
      onHit: (hit) => {
        barrelState.hp -= hit.incendiary ? 3 : 1;
        if (barrelState.hp <= 0 && !barrelState.gone) explode(new THREE.Vector3(barrel[0], barrel[1] + 0.5, barrel[2]));
        return { killed: barrelState.gone };
      },
    }));
  }

  const boomLight = new THREE.PointLight(0xff8a3a, 0, 22, 2);
  scene.add(boomLight);
  function explode(at) {
    barrelState.gone = true;
    barrelState.obj.visible = false;
    barrelState.collider.setEnabled(false);
    audio.sfxAt('explosion', at, { volume: 1, refDistance: 10, echo: weapons.echo(at) });
    boomLight.position.copy(at);
    boomLight.intensity = 400;
    for (let i = 0; i < 4; i++) fx.impact(at, new THREE.Vector3(0, 1, 0), 'metal', { decal: false, incendiary: true });
    for (let i = 0; i < 26; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random() * 3);
      v.y = Math.abs(v.y) + 1;
      fx.puffs.emit(at, v, [0.12, 0.1, 0.09], 0.5 + Math.random() * 0.5, 1.5 + Math.random(), 0.6, 3);
    }
    weapons.rig.shake = Math.max(weapons.rig.shake, 1);
    // blast: hurt Kael and the dummies, shove loose bodies
    const pd = weapons.player.position.distanceTo(at);
    if (pd < 5) weapons.player.hurt(70 * (1 - pd / 5));
    for (const t of targets) {
      const d = t.base.distanceTo(at);
      if (d < 5) damage(t, 140 * (1 - d / 5), { incendiary: true });
    }
    physics.world.bodies.forEach((b) => {
      if (!b.isDynamic()) return;
      const p = b.translation();
      const dir = new THREE.Vector3(p.x - at.x, p.y - at.y + 0.5, p.z - at.z);
      const d = dir.length();
      if (d < 6) b.applyImpulse(dir.normalize().multiplyScalar((6 - d) * 6 * b.mass()), true);
    });
    ignite(at.clone().setY(at.y - 0.4), 7);
    setTimeout(() => {
      // a new barrel after a while, so the range keeps working
      barrelState.gone = false;
      barrelState.hp = 3;
      barrelState.obj.visible = true;
      barrelState.collider.setEnabled(true);
    }, 9000);
  }

  // --- Incendiary rounds and blasts start real fires (systems/fire.js) --------------------------
  function ignite(point, seconds = CONFIG.weapons.incendiary.burnSeconds) {
    fire.ignite(point, { size: 0.8, fuel: seconds });
  }
  weapons.onIncendiary = (point, normal, collider, target) => {
    if (!target) ignite(point.clone().addScaledVector(normal, 0.05));
  };

  const up = new THREE.Vector3(0, 1, 0);
  function update(dt) {
    for (const t of targets) {
      t.actor.update(dt);
      if (t.burn > 0) {
        t.burn -= dt;
        if (Math.random() < dt * 30) fx.impact(t.base.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.4 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4)), up, 'metal', { decal: false, incendiary: true });
        damage(t, CONFIG.weapons.incendiary.burnDamagePerSecond * dt);
      }
      if (t.dead) {
        t.respawn -= dt;
        if (t.respawn <= 0) {
          t.dead = false;
          t.health = 100;
          t.collider.setEnabled(true);
          t.actor.play('idle_gun', 0.3);
        }
      }
    }
    boomLight.intensity *= Math.exp(-dt * 5);
    // dummies standing in flames catch fire
    for (const t of targets) if (!t.dead && fire.heatAt(t.base) > 0.3) t.burn = Math.max(t.burn, 1.5);
  }

  function dispose() {
    offs.forEach((off) => off());
    boomLight.removeFromParent();
    targets.forEach((t) => t.actor.object.removeFromParent());
    barrelState?.obj.removeFromParent();
  }

  return { update, dispose, targets, ignite };
}

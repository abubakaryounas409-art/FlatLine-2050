// =============================================================================
// FLATLINE: 2050 — dev/testScene.js
// Phase 0 test scene: proves the loader/placeholders, physics, bloom, mood
// grading and time scale all work. Replaced by the main menu in Phase 1.
// =============================================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { CONFIG } from '../config.js';
import { physics } from '../core/physics.js';
import { createModelInstance } from '../assets/loader.js';

/**
 * Build the scene from preloaded assets.
 * @param {Map} assets results from loader.preload(PRELOAD.testScene)
 */
export function createTestScene(renderer, assets) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);
  camera.position.set(7, 4, 9);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 3;
  controls.maxDistance = 40;

  // --- Sky / environment -----------------------------------------------------
  const hdri = assets.get('hdri.stadium_2050');
  const pmrem = new THREE.PMREMGenerator(renderer);
  if (hdri?.texture) {
    scene.environment = pmrem.fromEquirectangular(hdri.texture).texture;
    scene.background = hdri.texture;
    scene.backgroundIntensity = 0.4;
  } else {
    // No HDRI yet: a neutral studio environment so metals still reflect.
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.background = new THREE.Color(hdri?.color ?? 0x05050a);
  }
  scene.environmentIntensity = 0.25;
  scene.fog = new THREE.FogExp2(0x05050a, 0.025);
  pmrem.dispose();

  // --- Lights ---------------------------------------------------------------
  scene.add(new THREE.HemisphereLight(0x3a3a5a, 0x050505, 0.4));

  const key = new THREE.DirectionalLight(0xdfe8ff, 1.2);
  key.position.set(6, 12, 4);
  key.castShadow = true;
  key.shadow.mapSize.setScalar(2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -15;
  key.shadow.camera.right = key.shadow.camera.top = 15;
  key.shadow.bias = -0.0005;
  key.shadow.radius = 4;
  scene.add(key);

  const themeLights = [
    [CONFIG.colors.fire, -5, 2, -3],
    [CONFIG.colors.time, 5, 2, -3],
    [0x8a4dff, 0, 2, 5],
  ].map(([color, x, y, z]) => {
    const l = new THREE.PointLight(color, 25, 14, 2);
    l.position.set(x, y, z);
    scene.add(l);
    return l;
  });

  // --- Ground (render + physics) ---------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.35, metalness: 0.4 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(80, 80, 0x3fa9ff, 0x1a1a2a);
  grid.material.transparent = true;
  grid.material.opacity = 0.18;
  grid.position.y = 0.002;
  scene.add(grid);

  const { RAPIER, world } = physics;
  world.createCollider(RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setTranslation(0, -0.1, 0));

  // --- Neon pillars in the three theme colors (bloom test) --------------------
  const neon = (color, intensity) =>
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity });
  [
    [CONFIG.colors.fire, -6, -4],
    [CONFIG.colors.time, 6, -4],
    [0x8a4dff, 0, -7],
  ].forEach(([color, x, z]) => {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 4, 0.25), neon(color, 6));
    pillar.position.set(x, 2, z);
    scene.add(pillar);
  });

  // Floating "heartbeat ring" around the hero
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.03, 8, 96), neon(CONFIG.colors.time, 8));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  scene.add(ring);

  // --- Kael (placeholder capsule until kael_2020.glb exists) -----------------
  // Drops from the sky onto a Rapier capsule body to prove physics runs.
  const kaelTemplate = assets.get('characters.kael_2020');
  const kael = createModelInstance(kaelTemplate);
  const kaelPivot = new THREE.Group(); // pivot at the body's centre
  kael.position.y = -0.9;              // model origin is at the feet
  kaelPivot.add(kael);
  scene.add(kaelPivot);

  const kaelBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 6, 0).lockRotations(),
  );
  world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.35).setRestitution(0.3), kaelBody);
  physics.link(kaelBody, kaelPivot);

  // Real model with animations? Play its idle (Phase 5 adds the full state machine).
  let mixer = null;
  if (!kaelTemplate.isPlaceholder && kaelTemplate.animations.length) {
    mixer = new THREE.AnimationMixer(kael);
    const idle = THREE.AnimationClip.findByName(kaelTemplate.animations, 'idle') ?? kaelTemplate.animations[0];
    mixer.clipAction(idle).play();
  }

  // --- Kael's 2050 car (placeholder box until car_2050_kael.glb exists) ------
  const car = createModelInstance(assets.get('vehicles.car_2050_kael'));
  car.position.set(-3.5, 0, 1.5);
  car.rotation.y = Math.PI * 0.2;
  scene.add(car);

  // --- A few physics crates you can knock with the falling capsule -----------
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6a5030, roughness: 0.8 });
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), crateMat);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(2.5 + (i % 2) * 0.05, 0.3 + i * 0.65, 1 + (i % 3) * 0.02),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 0.3, 0.3), body);
    physics.link(body, mesh);
  }

  /** Drop Kael again (debug key). */
  function respawnKael() {
    kaelBody.setTranslation({ x: (Math.random() - 0.5) * 2, y: 6, z: (Math.random() - 0.5) * 2 }, true);
    kaelBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Per-frame visual update. dt is already time-scaled. */
  function update(dt, elapsed) {
    controls.update();
    mixer?.update(dt);

    // Ring pulses like a heartbeat at 72 bpm (follows game time → slows in slow-mo).
    const beat = (elapsed * 72) / 60;
    const pulse = Math.pow(Math.max(0, Math.sin(beat * Math.PI * 2)), 12);
    ring.scale.setScalar(1 + pulse * 0.15);
    ring.material.emissiveIntensity = 4 + pulse * 10;
    ring.position.x = kaelPivot.position.x;
    ring.position.z = kaelPivot.position.z;

    themeLights.forEach((l, i) => (l.intensity = 22 + Math.sin(elapsed * 2 + i * 2) * 6));
  }

  return { scene, camera, key, update, respawnKael };
}

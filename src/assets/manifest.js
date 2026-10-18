// =============================================================================
// FLATLINE: 2050 — assets/manifest.js
// The ONLY place asset paths are written (CLAUDE.md rule A7.3).
//
// Every entry has:
//   path        — URL relative to /public (Vite serves /public at the site root)
//   placeholder — what to show / do while the real file is missing (rule A7.2)
//
// Paths are root-relative ("models/...") and resolved against
// import.meta.env.BASE_URL by the loader, so the build works in a sub-folder.
// =============================================================================

const C = { fire: 0xff6a1a, shadows: 0x1a0f2e, time: 0x3fa9ff };

// --- Placeholder helpers -----------------------------------------------------
// shape: 'capsule' | 'box' | 'cylinder' | 'sphere'   size: [x, y, z] in metres
const capsule = (color, height = 1.8, radius = 0.35) => ({ shape: 'capsule', color, size: [radius, height, radius] });
const box = (color, x, y, z) => ({ shape: 'box', color, size: [x, y, z] });

// -----------------------------------------------------------------------------
// MODELS  (.glb, Draco-compressed — see CLAUDE.md B1 for the Blender workflow)
// -----------------------------------------------------------------------------
export const MODELS = {
  // fit: real-world size the loader scales the model to (see loader.js fitModel).
  //      axis 'y' = height, 'z' = length (cars), 'x' = length (weapons).
  characters: {
    // Kael = Quaternius Universal Base Characters "Superhero Male" + Universal Animation Library 1/2 (CC0),
    // clips retargeted and outfits baked by .dev/mergehero.mjs (old X Bot / Adventurer files are in asset_backups/)
    kael_2050: { path: 'models/characters/kael_business.glb', placeholder: capsule(0xf2f2f2), fit: { axis: 'y', size: 1.8 }, note: 'Quaternius Business Man (CC0, CharacterArmature rig). Racing-suit version: kael_hero_2050.glb' },
    kael_2020: { path: 'models/characters/kael_hero.glb', placeholder: capsule(0x2a2a30), fit: { axis: 'y', size: 1.8 }, note: 'Black tactical jacket over a hoodie, cargo pants, boots, fingerless gloves, burn scar left hand (baked); 53 clips' },
    kael_runner: { path: 'models/characters/kael_runner.glb', placeholder: capsule(0x1a1c22), fit: { axis: 'y', size: 1.8 }, note: 'The run (Quaternius Universal Animation Library, CC0): sprint, jump, roll, hit, death…' },
    umbra:     { path: 'models/characters/kael_hero.glb', placeholder: capsule(C.shadows), fit: { axis: 'y', size: 1.8 }, note: 'Reuses Kael 2020 with the void shader' },
    victor:    { path: 'models/characters/victor.glb',    placeholder: capsule(0x8a6a3a), fit: { axis: 'y', size: 1.8 }, note: 'Brown suit (2020) / white suit (2050)' },
    elias:     { path: 'models/characters/elias.glb',     placeholder: capsule(0x3a5a7a), fit: { axis: 'y', size: 1.78 }, note: 'Overalls, tool belt (Quaternius Worker)' },
    mara:      { path: 'models/characters/mara.glb',      placeholder: capsule(0x5a4a3a, 1.7), fit: { axis: 'y', size: 1.7 }, note: 'Long coat, badge, ponytail (Quaternius woman, full gun set)' },
    enemy:     { path: 'models/characters/enemy.glb',     placeholder: capsule(0x111111), fit: { axis: 'y', size: 1.85 }, note: "Hale's enforcer (Quaternius SWAT)" },
    civilian:  { path: 'models/characters/civilian.glb',  placeholder: capsule(0x777788), fit: { axis: 'y', size: 1.78 }, note: 'Civilian man' },
    civilian_f:{ path: 'models/characters/civilian_f.glb',placeholder: capsule(0x887777, 1.68), fit: { axis: 'y', size: 1.68 }, note: 'Civilian woman' },
    nurse:     { path: 'models/characters/nurse.glb',     placeholder: capsule(0xbfe3e8, 1.7), fit: { axis: 'y', size: 1.68 }, note: 'Hospital nurse (ending)' },
    clockmaker:{ path: 'models/characters/clockmaker.glb',placeholder: capsule(0x4a3a2a), fit: { axis: 'y', size: 1.75 }, note: 'Long coat, cracked glasses (ending only)' },
  },

  vehicles: {
    car_2050_kael:  {
      path: 'models/vehicles/car_2050_kael.glb',
      placeholder: box(0xe8e8e8, 2.0, 0.9, 4.6),
      note: "Kael's racer (three.js 'ferrari' model, MIT). Front of the car points to -Z.",
      forward: -1,
      // Node names inside the .glb (used by the garage now and the car controller in Phase 3)
      nodes: { wheels: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'], steering: 'steering_wheel' },
    },
    car_2050_rival: { path: 'models/vehicles/car_2050_rival.glb', placeholder: box(0x7a2aff, 2.0, 0.9, 4.6), note: 'Rival racers (full detail)' },
    car_2050_rival_lite: { path: 'models/vehicles/car_2050_rival_lite.glb', placeholder: box(0x7a2aff, 2.0, 0.9, 4.6),
      note: 'Light 2050 racer (~58k tris), auto-simplified from car_2050_kael with all materials kept, so liveries work. Rivals + the player on Low graphics.',
      nodes: { wheels: ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'] } },
    // Quaternius cars: wheels are separate nodes (front L/R + one back axle).
    car_2020_sedan: { path: 'models/vehicles/car_2020_sedan.glb', placeholder: box(0x4a4a55, 1.9, 1.4, 4.5), fit: { axis: 'z', size: 4.6 },
      nodes: { wheels: ['NormalCar2_FrontLeftWheel_Cylinder.015', 'NormalCar2_FrontRightWheel_Cylinder.016', 'NormalCar2_BackWheels_Cylinder.003'] } },
    car_2020_sport: { path: 'models/vehicles/car_2020_sport.glb', placeholder: box(0xaa1a1a, 1.9, 1.2, 4.4), fit: { axis: 'z', size: 4.7 }, note: 'Mission 7 chase car (Nissan GT-R)',
      nodes: { wheels: ['Circle', 'Circle.001', 'Circle.002', 'Circle.003'] } },
    police_car:     { path: 'models/vehicles/police_car.glb',     placeholder: box(0x1a2a5a, 1.9, 1.5, 4.8), fit: { axis: 'z', size: 4.9 },
      nodes: { wheels: ['Cop_FrontLeftWheel_Cylinder.011', 'Cop_FrontRightWheel_Cylinder.012', 'Cop_BackWheels_Cylinder.001'] } },
    suv:            { path: 'models/vehicles/suv.glb',            placeholder: box(0x2a3a2a, 2.0, 1.8, 4.8), fit: { axis: 'z', size: 4.8 },
      nodes: { wheels: ['SUV_FrontLeftWheel_Cylinder.010', 'SUV_FrontRightWheel_Cylinder.005', 'SUV_BackWheels_Cylinder.009'] } },
    truck:          { path: 'models/vehicles/truck.glb',          placeholder: box(0x5a5a5a, 2.4, 3.0, 7.0), fit: { axis: 'z', size: 7.0 },
      nodes: { wheels: ['FrontWheel_L', 'FrontWheel_R', 'BackWheels'] } },
  },

  weapons: {
    // ground: false keeps the model's own origin (grip offsets are set in Phase 6)
    pistol: { path: 'models/weapons/pistol.glb', placeholder: box(0x333333, 0.05, 0.14, 0.22), fit: { axis: 'x', size: 0.2, ground: false } },
    rifle:  { path: 'models/weapons/rifle.glb',  placeholder: box(0x333333, 0.06, 0.2, 0.9),   fit: { axis: 'x', size: 0.9, ground: false } },
    sniper: { path: 'models/weapons/sniper.glb', placeholder: box(0x333333, 0.06, 0.2, 1.2),   fit: { axis: 'x', size: 1.15, ground: false } },
  },

  env: {
    stadium:    { path: 'models/env/stadium.glb',    placeholder: box(0x15151f, 200, 0.2, 200), note: 'Neon Velodrome' },
    garage:     { path: 'models/env/garage.glb',     placeholder: box(0x101014, 30, 0.2, 30),   note: 'Main menu background' },
    city_block: { path: 'models/env/city_block.glb', placeholder: box(0x1a1a1f, 120, 0.2, 120) },
    factory:    { path: 'models/env/factory.glb',    placeholder: box(0x201a16, 80, 0.2, 80) },
    hospital:   { path: 'models/env/hospital.glb',   placeholder: box(0xd8e0e0, 10, 0.2, 10), fit: { axis: 'y', size: 3.0 }, note: 'Full furnished room (GRADD CO)' },
    rooftop:    { path: 'models/env/rooftop.glb',    placeholder: box(0x2a2a2a, 30, 0.2, 30) },
    nightclub:  { path: 'models/env/nightclub.glb',  placeholder: box(0x120a1a, 40, 0.2, 40),   note: 'Mission 5 mirror maze' },
  },

  props: {
    barrel:           { path: 'models/props/barrel.glb',           placeholder: { shape: 'cylinder', color: 0x6a2a1a, size: [0.3, 0.9, 0.3] }, fit: { axis: 'y', size: 0.9 } },
    barrel_explosive: { path: 'models/props/barrel_explosive.glb', placeholder: { shape: 'cylinder', color: 0xaa2222, size: [0.3, 0.9, 0.3] }, fit: { axis: 'y', size: 0.9 }, note: 'FIRE: explodes / burns' },
    crate:            { path: 'models/props/crate.glb',            placeholder: box(0x6a5030, 1, 1, 1),         fit: { axis: 'y', size: 0.8 } },
    street_lamp:      { path: 'models/props/street_lamp.glb',      placeholder: box(0x333333, 0.2, 5, 0.2),     fit: { axis: 'y', size: 5.5 }, note: 'SHADOWS: shootable light' },
    traffic_light:    { path: 'models/props/traffic_light.glb',    placeholder: box(0x222222, 0.3, 4, 0.3),     fit: { axis: 'y', size: 5.0 } },
    dumpster:         { path: 'models/props/dumpster.glb',         placeholder: box(0x1f3a1f, 2, 1.3, 1.2),     fit: { axis: 'y', size: 1.3 } },
    fire_hydrant:     { path: 'models/props/fire_hydrant.glb',     placeholder: box(0xaa2222, 0.3, 0.7, 0.3),   fit: { axis: 'y', size: 0.75 } },
    water_tower:      { path: 'models/props/water_tower.glb',      placeholder: { shape: 'cylinder', color: 0x5a4a3a, size: [3, 6, 3] }, fit: { axis: 'y', size: 9 }, note: 'Mission 4 sniper perch' },
    ac_unit:          { path: 'models/props/ac_unit.glb',          placeholder: box(0x8a8a8a, 1.2, 1, 1.2),     fit: { axis: 'y', size: 1.0 } },
    hospital_bed:     { path: 'models/props/hospital_bed.glb',     placeholder: box(0xeeeeee, 1, 0.7, 2.1), note: 'Optional: env/hospital already includes a bed' },
    heart_monitor:    { path: 'models/props/heart_monitor.glb',    placeholder: box(0x1a1a1a, 0.4, 0.35, 0.25), fit: { axis: 'y', size: 0.35 } },
    burnt_watch:      { path: 'models/props/burnt_watch.glb',      placeholder: { shape: 'cylinder', color: 0x3a2a1a, size: [0.03, 0.01, 0.03] }, fit: { axis: 'y', size: 0.22 }, note: 'Clue: stopped at 20:20' },
    radio:            { path: 'models/props/radio.glb',            placeholder: box(0x3a3a3a, 0.3, 0.2, 0.1),   fit: { axis: 'y', size: 0.3 }, note: "The Clockmaker's radio" },
  },
};

// -----------------------------------------------------------------------------
// TEXTURES  (PBR sets from Poly Haven, CC0 — re-encoded 2K/1K JPG)
// Each set lives in its own folder with the three maps named as below.
// look: material tweaks (color tint, roughness multiplier, …). Placeholder = flat color.
// -----------------------------------------------------------------------------
const pbr = (name, color, look) => ({
  maps: {
    map:          `textures/${name}/${name}_diff.jpg`,
    normalMap:    `textures/${name}/${name}_nor.jpg`,
    roughnessMap: `textures/${name}/${name}_rough.jpg`,
  },
  placeholder: { color },
  look,
});

export const TEXTURES = {
  asphalt:     pbr('asphalt', 0x2a2a2e),                                                               // asphalt_02
  wet_asphalt: pbr('wet_asphalt', 0x1a1a1f, { color: 0x8a8a92, roughness: 0.35, envMapIntensity: 1.4 }), // asphalt_01, made wet
  concrete:    pbr('concrete', 0x6a6a6a),                                                              // concrete_floor_worn_001
  rusty_metal: pbr('rusty_metal', 0x6a3a1f, { metalness: 0.6 }),                                       // rusty_metal_02
  burnt_wood:  pbr('burnt_wood', 0x1f1612, { color: 0x3a2e28, normalScale: 1.4 }),                     // weathered_planks, charred tint
  brick:       pbr('brick', 0x6a3328),                                                                 // red_brick_03
  charred:     pbr('charred', 0x141110),                                                               // burned_ground_01
  tiles:       pbr('tiles', 0xc8ccd0),                                                                 // floor_tiles_06
};

// -----------------------------------------------------------------------------
// HDRI skies (Poly Haven, CC0, 2K .hdr). Placeholder = flat background color.
// -----------------------------------------------------------------------------
export const HDRI = {
  night_city_2020:   { path: 'hdri/night_city_2k.hdr',   placeholder: { color: 0x06070d } }, // Shanghai Bund (skyline)
  night_street_2020: { path: 'hdri/night_street_2k.hdr', placeholder: { color: 0x07070b } }, // Cobblestone Street Night (alleys)
  stadium_2050:      { path: 'hdri/stadium_dusk_2k.hdr', placeholder: { color: 0x0a0618 } },
  overcast_rain:     { path: 'hdri/overcast_2k.hdr',     placeholder: { color: 0x14161a } }, // Potsdamer Platz
};

// -----------------------------------------------------------------------------
// MUSIC (CLAUDE.md B8). Placeholder = silence + warning.
// -----------------------------------------------------------------------------
export const MUSIC = {
  main_theme:     { path: 'audio/music/main_theme.mp3',     loop: true },
  race_2050:      { path: 'audio/music/race_2050.mp3',      loop: true },
  city_rain_2020: { path: 'audio/music/city_rain_2020.mp3', loop: true },
  combat:         { path: 'audio/music/combat.mp3',         loop: true },
  umbra:          { path: 'audio/music/umbra.mp3',          loop: true },
  reverse_chase:  { path: 'audio/music/reverse_chase.mp3',  loop: true },
  ending:         { path: 'audio/music/ending.mp3',         loop: false },
};

// -----------------------------------------------------------------------------
// SOUND EFFECTS (CLAUDE.md B7). positional: true → used as 3D PositionalAudio.
// clip: [startMs, lengthMs] plays only that slice of the file (a Howler sprite),
// e.g. one beep out of a long monitor recording. Measured from the actual files.
// -----------------------------------------------------------------------------
const sfx = (name, opts = {}) => ({ path: `audio/sfx/${name}.mp3`, ...opts });

export const SFX = {
  // Heart / time
  heartbeat:        sfx('heartbeat', { clip: [0, 950] }),      // file has 2 beats; one "lub-dub"
  monitor_beep:     sfx('monitor_beep', { clip: [330, 450] }), // file is 28 s of beeps; first one
  flatline:         sfx('flatline'),
  clock_tick:       sfx('clock_tick'),
  reverse_whoosh:   sfx('reverse_whoosh'),
  // Weather / ambience
  rain_heavy:       sfx('rain_heavy', { loop: true }),
  thunder:          sfx('thunder'),
  wind:             sfx('wind', { loop: true }),
  crowd_cheer:      sfx('crowd_cheer'),
  fireworks:        sfx('fireworks'),
  siren:            sfx('siren', { loop: true, positional: true }),
  radio_static:     sfx('radio_static'),
  // UI
  ui_click:         sfx('ui_click'),
  ui_hover:         sfx('ui_hover', { clip: [100, 450] }),     // skip the silent lead-in + long tail
  ui_glitch:        sfx('ui_glitch', { clip: [0, 700] }),
  scifi_beep:       sfx('scifi_beep'),
  // Weapons
  pistol_shot:      sfx('pistol_shot', { positional: true }),
  rifle_shot:       sfx('rifle_shot', { positional: true }),
  sniper_shot:      sfx('sniper_shot', { positional: true }),
  reload:           sfx('reload', { positional: true }),
  shell_casing:     sfx('shell_casing', { positional: true }),
  bullet_impact:    sfx('bullet_impact', { positional: true }),
  glass_shatter:    sfx('glass_shatter', { positional: true }),
  // Fire / explosions
  explosion:        sfx('explosion', { positional: true }),
  fire_loop:        sfx('fire_loop', { loop: true, positional: true }),
  // Vehicles
  engine_electric:  sfx('engine_electric', { loop: true, positional: true }),
  engine_turbine:   sfx('engine_turbine', { loop: true, positional: true }),
  engine_2020:      sfx('engine_2020', { loop: true, positional: true }),
  boost:            sfx('boost'),
  tire_skid:        sfx('tire_skid', { loop: true, positional: true }),
  car_crash:        sfx('car_crash', { positional: true }),
  // Player
  footstep_concrete: sfx('footstep_concrete', { positional: true }),
  whoosh:           sfx('whoosh'),
  shadow_step:      sfx('shadow_step'),
};

// -----------------------------------------------------------------------------
// VOICE LINES (CLAUDE.md B9). `text` doubles as the subtitle.
// File naming: audio/voice/<scene>_<line>.mp3
// -----------------------------------------------------------------------------
const voice = (file, speaker, text) => ({ path: `audio/voice/${file}.mp3`, speaker, text });

export const VOICE = {
  m1_commentator_01: voice('m1_commentator_01', 'Commentator', 'Kael Rayne, undefeated… one lap from history.'),
  m2_clockmaker_01:  voice('m2_clockmaker_01', 'The Clockmaker', 'Your body is dying in 2050. Find the truth in this year, or you never wake up.'),
  m4_clockmaker_01:  voice('m4_clockmaker_01', 'The Clockmaker', 'Every shot is a heartbeat. Make them count.'),
  m5_umbra_01:       voice('m5_umbra_01', 'Umbra', "You ran from the fire. You'll always run."),
  m6_victor_01:      voice('m6_victor_01', 'Victor Hale', 'Burn the whole district. No evidence.'),
  m7_clockmaker_01:  voice('m7_clockmaker_01', 'The Clockmaker', 'Your hands remember. Drive.'),
  m8_elias_01:       voice('m8_elias_01', 'Elias Rayne', 'You stopped running.'),
  end_clockmaker_01: voice('end_clockmaker_01', 'The Clockmaker', "You're not the only one I've sent back."),
};

// -----------------------------------------------------------------------------
// Animation clip names expected inside each character .glb (CLAUDE.md B1).
// The Blender merge step must name the actions exactly like this.
// -----------------------------------------------------------------------------
export const ANIMATION_NAMES = {
  // Quaternius "CharacterArmature" rig (enemy, mara, elias, nurse) — names after loader normalisation
  quaternius: ['idle', 'idle_neutral', 'walk', 'run', 'run_back', 'run_left', 'run_right', 'roll', 'idle_gun', 'idle_gun_pointing',
    'idle_gun_shoot', 'gun_shoot', 'run_shoot', 'hit', 'hit_2', 'death', 'interact', 'wave', 'punch_left', 'punch_right', 'kick_left', 'kick_right'],
  // Quaternius "HumanArmature" rig (civilian, civilian_f, clockmaker)
  quaternius_human: ['idle', 'walk', 'run', 'jump', 'runningjump', 'sitting', 'standing', 'clapping', 'death', 'punch'],
  // Kael hero model 2050 (kael_hero_2050.glb)
  kael_2050: ['idle', 'walk', 'run', 'agree', 'headshake', 'talking', 'pointing', 'sitting', 'driving', 'kneel', 'idle_fold_arms', 'phone_call',
    'injured_walk', 'hit', 'death', 'get_up', 'interact'],
  // Kael hero model 2020 (kael_hero.glb) — what the file really has
  kael_hero: ['idle', 'walk', 'walk_formal', 'run', 'sprint', 'crouch_idle', 'crouch_walk', 'pistol_idle', 'pistol_aim', 'pistol_aim_up', 'pistol_aim_down',
    'pistol_shoot', 'pistol_reload', 'idle_gun', 'idle_gun_pointing', 'idle_gun_shoot', 'jump', 'jump_air', 'land', 'roll', 'vault_start', 'vault_air',
    'vault_land', 'slide_start', 'slide', 'slide_exit', 'hit', 'hit_2', 'hit_knockback', 'death', 'get_up', 'interact', 'pickup', 'pointing', 'talking',
    'phone_call', 'agree', 'headshake', 'idle_fold_arms', 'look_around', 'driving', 'sitting', 'sit_down', 'stand_up', 'kneel', 'carry', 'push',
    'injured_walk', 'shield_face', 'throw', 'consume', 'punch_left', 'punch_right'],
  // Mixamo wish-list for a future Kael (playerAnims picks these first when present)
  kael_2020: [
    'idle', 'walk', 'jog', 'run', 'sprint', 'crouch_walk', 'crouch_idle', 'strafe_left', 'strafe_right', 'walk_back', 'turn_90',
    'pistol_idle', 'pistol_walk', 'pistol_run', 'pistol_shoot', 'pistol_reload',
    'rifle_idle', 'rifle_aim_walk', 'rifle_run', 'rifle_fire', 'rifle_reload', 'rifle_crouch',
    'prone', 'prone_idle', 'crawl', 'sniper_aim',
    'jump', 'running_jump', 'roll', 'dodge', 'vault', 'climb', 'take_cover', 'cover_idle', 'hit', 'death', 'kneel', 'get_up', 'stand_up',
    'waking_up', 'look_around', 'talking', 'phone_call', 'pointing', 'carry', 'injured_walk', 'limp', 'shield_face', 'driving', 'sitting',
  ],
  enemy: ['rifle_idle', 'rifle_aim_walk', 'rifle_run', 'rifle_fire', 'rifle_reload', 'rifle_crouch', 'patrol_walk', 'alert_look', 'hit', 'death'],
  civilian: ['idle', 'walk', 'scared', 'run_scared', 'crouch_cover', 'sitting'],
  victor: ['idle', 'talking', 'pointing', 'kneeling', 'surprised', 'walk'],
};

// -----------------------------------------------------------------------------
// Preload groups — what each screen needs before it starts.
// Format: 'category.key' (e.g. 'characters.kael_2050', 'sfx.heartbeat').
// -----------------------------------------------------------------------------
export const PRELOAD = {
  // Boot intro + main menu (garage)
  menu: [
    'sfx.heartbeat', 'sfx.monitor_beep', 'sfx.flatline',
    'sfx.ui_hover', 'sfx.ui_click', 'sfx.ui_glitch',
    'sfx.whoosh', 'sfx.radio_static', 'sfx.clock_tick', 'sfx.crowd_cheer', // test cutscene + mission card
    // music.main_theme streams after the first click (browsers block it before that)
    'characters.kael_2050', 'vehicles.car_2050_kael', 'env.garage', 'hdri.stadium_2050',
  ],
  // 2050 race (Phase 3)
  race: [
    'vehicles.car_2050_kael', 'vehicles.car_2050_rival_lite', 'hdri.stadium_2050', 'textures.asphalt', 'textures.concrete',
    'sfx.engine_electric', 'sfx.engine_turbine', 'sfx.wind', 'sfx.tire_skid', 'sfx.boost', 'sfx.crowd_cheer', 'sfx.monitor_beep', 'sfx.bullet_impact',
    'sfx.shadow_step', 'sfx.reverse_whoosh', 'sfx.clock_tick', 'sfx.whoosh', 'sfx.ui_glitch',
  ],
  // Mission 1 extras (on top of PRELOAD.race)
  mission1: [
    'characters.victor', 'voice.m1_commentator_01', 'sfx.fireworks', 'sfx.heartbeat', 'sfx.radio_static', 'sfx.car_crash',
    'sfx.glass_shatter', 'sfx.explosion', 'sfx.rain_heavy', 'sfx.flatline',
  ],
  // Phase 0 dev scene (open with ?test in the URL)
  testScene: ['characters.kael_2020', 'vehicles.car_2050_kael', 'hdri.stadium_2050'],
};

// Fonts are self-hosted in public/fonts and declared in src/style.css (@font-face),
// because CSS has to reference them directly.

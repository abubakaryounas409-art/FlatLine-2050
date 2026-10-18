// =============================================================================
// FLATLINE: 2050 — config.js
// Every tunable number in the game lives here (CLAUDE.md rule A7.4).
// Systems import CONFIG and never hard-code gameplay values themselves.
// =============================================================================

export const CONFIG = {
  // ---------------------------------------------------------------------------
  // Game info (credits, menu footer)
  // ---------------------------------------------------------------------------
  game: {
    title: 'FLATLINE: 2050',
    author: 'Abubakar Younas', // shown as "A game by …" in Credits
    build: 'v1.0',
  },

  // ---------------------------------------------------------------------------
  // Theme colors (CLAUDE.md A3)
  // ---------------------------------------------------------------------------
  colors: {
    fire: 0xff6a1a,
    shadows: 0x1a0f2e,
    time: 0x3fa9ff,
    ui: '#ffffff',
  },

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  loop: {
    physicsHz: 60,          // fixed physics step rate
    maxSubSteps: 5,         // max physics steps per frame (prevents spiral of death)
    maxFrameDelta: 0.1,     // clamp huge frame gaps (tab switch) to 100 ms
  },

  // ---------------------------------------------------------------------------
  // Renderer
  // ---------------------------------------------------------------------------
  renderer: {
    maxPixelRatio: 2,
    toneMappingExposure: 1.0,
    clearColor: 0x05050a,
  },

  // ---------------------------------------------------------------------------
  // Graphics presets (Low / Medium / High). Chosen in Settings (Phase 1).
  // ---------------------------------------------------------------------------
  graphics: {
    default: 'high',
    presets: {
      low: {
        pixelRatio: 1,
        shadows: false,
        shadowMapSize: 512,
        bloom: true,
        bloomScale: 0.25,
        chromaticAberration: false,
        msaa: 0,
        particleScale: 0.4,
      },
      medium: {
        pixelRatio: 1.5,
        shadows: true,
        shadowMapSize: 1024,
        bloom: true,
        bloomScale: 0.4,
        chromaticAberration: true,
        msaa: 2,
        particleScale: 0.7,
      },
      high: {
        pixelRatio: 2,
        shadows: true,
        shadowMapSize: 2048,
        bloom: true,
        bloomScale: 0.5,
        chromaticAberration: true,
        msaa: 4,
        particleScale: 1.0,
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Post-processing
  // ---------------------------------------------------------------------------
  postfx: {
    bloom: { intensity: 1.2, threshold: 0.9, smoothing: 0.25, radius: 0.7 },
    vignette: { offset: 0.3, darkness: 0.65 },
    chromaticAberration: { base: 0.0006, max: 0.006 },
    moodBlendTime: 1.2,     // seconds to blend between color-grade moods

    // Color-grade moods used by postfx.setMood(theme).
    // tint: RGB multiplier, lift: raises blacks toward a color, saturation 1 = unchanged,
    // contrast: power curve around linear mid-grey, brightness: exposure (-0.15 = 15% darker).
    moods: {
      NEUTRAL: { tint: [1.0, 1.0, 1.0], lift: [0.0, 0.0, 0.0], saturation: 1.0, contrast: 1.0, brightness: 0.0, vignette: 0.65 },
      FIRE:    { tint: [1.15, 0.92, 0.72], lift: [0.015, 0.005, 0.0], saturation: 1.2, contrast: 1.1, brightness: 0.05, vignette: 0.7 },
      SHADOWS: { tint: [0.85, 0.8, 1.05], lift: [0.01, 0.0, 0.025], saturation: 0.75, contrast: 1.3, brightness: -0.15, vignette: 0.9 },
      TIME:    { tint: [0.8, 0.95, 1.2], lift: [0.0, 0.01, 0.04], saturation: 0.55, contrast: 1.05, brightness: 0.0, vignette: 0.7 },
      MEMORY:  { tint: [1.08, 1.0, 0.86], lift: [0.03, 0.025, 0.015], saturation: 0.08, contrast: 1.15, brightness: 0.02, vignette: 1.0 }, // flashbacks
      SCAN:    { tint: [1.35, 0.75, 0.4], lift: [0.03, 0.01, 0.0], saturation: 0.35, contrast: 1.2, brightness: 0.05, vignette: 0.85 },  // Mission 3 clue scan
    },
  },

  // ---------------------------------------------------------------------------
  // Cutscenes (Phase 2)
  // ---------------------------------------------------------------------------
  cutscene: {
    letterboxHeight: 0.11,  // fraction of screen height per bar (≈2.39:1 look)
    letterboxSeconds: 0.7,
    skipHoldSeconds: 1.0,   // hold SPACE this long to skip
    skipPromptDelay: 1.2,   // seconds before "Hold SPACE to skip" appears
    subtitleFade: 0.35,
    // Speaker name colours (subtitles)
    speakers: {
      kael:        { name: 'Kael',           color: '#cfe6ff' },
      umbra:       { name: 'Umbra',          color: '#a982ff' },
      victor:      { name: 'Victor Hale',    color: '#ff6b6b' },
      elias:       { name: 'Elias Rayne',    color: '#9be3a8' },
      clockmaker:  { name: 'The Clockmaker', color: '#e8c170' },
      mara:        { name: 'Mara Voss',      color: '#5fd4c8' },
      commentator: { name: 'Commentator',    color: '#ff9a3c' },
      nurse:       { name: 'Nurse',          color: '#d9dde3' },
      radio:       { name: 'Radio',          color: '#9aa3b5' },
    },
  },

  // ---------------------------------------------------------------------------
  // Mission card
  // ---------------------------------------------------------------------------
  missionCard: {
    holdSeconds: 2.6,       // time fully visible before it fades out
  },

  // ---------------------------------------------------------------------------
  // 2050 car physics (Phase 3). Tuned on a headless Rapier bench:
  // 0-100 km/h ≈ 2.2 s · top ≈ 275 km/h (≈ 330 with boost) · stops in 3.6 s.
  // Physics forward axis is +X (Rapier's raycast-vehicle default).
  // ---------------------------------------------------------------------------
  car: {
    mass: 1100,
    comHeight: 0.3,                 // centre of mass above the floor (low = stable)
    chassisHalf: [2.2, 0.35, 0.95], // collider half extents (x = length)
    colliderY: 0.65,
    connY: 0.645,                   // suspension mount height (rest height = 0)
    wheel: {
      radius: 0.36, rest: 0.3, stiffness: 140, compression: 5.5, relaxation: 6.5,
      maxForce: 100000, maxTravel: 0.25, frictionSlip: 2.2, sideFront: 1.0, sideRear: 1.25,
    },
    engineForce: 7600,              // per driven (rear) wheel, falls off toward top speed
    reverseForce: 2600,
    reverseTopSpeed: 14,            // m/s
    brakeForce: 90,
    engineFadeSpeed: 86,            // m/s where engine force fades to zero (drag caps real speed lower)
    topSpeed: 76,                   // m/s, real top speed ≈ 275 km/h (used for FOV / effects / HUD)
    drag: 0.27,                     // aero drag coefficient (× v²)
    rolling: 30,                    // rolling resistance (N)
    downforce: 2.2,                 // × v², keeps it planted at speed
    maxSteer: 0.5,                  // radians at low speed
    steerFalloff: 0.85,             // how much steering shrinks at top speed
    steerRate: 8.0,                 // steering input smoothing (1/s) — higher = more responsive
    maxYawG: 1.5,                   // stability assist: lateral g cap (× 1.6 while drifting)
    handbrake: { slip: 0.4, side: 0.5, brake: 0.05 },
    driftMaxSlip: 38,               // degrees: drift assist holds the slide below this
    driftPush: 2.5,                 // m/s² forward help while drifting with throttle
    boost: { force: 1.6, fadeSpeed: 104, drain: 0.3, refill: 0.04, driftRefill: 0.2 },
    resetAfterStuck: 2.0,           // seconds upside-down / stuck before auto reset
  },

  // Theme abilities while driving (FIRE / SHADOWS / TIME as mechanics)
  carThemes: {
    // 🔥 FIRE — Burn (the boost): drift heat fills it; a full burn leaves a fire wake
    fireWake: { spacing: 7, life: 4.5, radius: 2.8, slow: 0.82, minMeter: 0.6 },
    // 🌑 SHADOWS — draft behind a rival to fill; T = Shadow Dash through cars
    shadow: { draftRange: 26, draftLateral: 3.2, fill: 0.22, dashTime: 1.3, dashPush: 13 },
    // ⏳ TIME — hold R to rewind everything; drains the time meter
    time: { drainPerSecond: 0.32, refill: 0.035, rewindSpeed: 2.0, minToStart: 0.1 },
  },

  // Rival AI (kinematic cars on the racing line)
  rivals: {
    count: 5,
    topSpeed: [74, 82],             // m/s range per rival (skill spread)
    lateralG: [1.7, 2.1],           // cornering grip range
    accel: 9,                       // m/s²
    brake: 14,                      // m/s²
    mistakeEvery: [7, 16],          // seconds between small mistakes
    rubberBand: 0.06,               // ± speed share to keep the pack close to the player
    colors: [0x7a2aff, 0xff6a1a, 0x19e3c8, 0xffd400, 0x2a6dff],
    names: ['VOSS', 'KANE', 'ORTEGA', 'SATO', 'MERCER'],
  },

  race: {
    laps: 2,
    countdownStep: 1.0,             // seconds between start lights
    trackWidth: 18,
  },

  // Chase camera
  carCamera: {
    distance: 6.4,
    height: 2.1,
    lookAhead: 7,
    lookHeight: 0.9,
    sharpness: 9,                   // follow smoothing (higher = tighter)
    fovBase: 62,
    fovMax: 84,
    fovBoost: 6,
    shakeFrom: 0.88,                // fraction of top speed where shake starts
    shakeAmount: 0.06,
  },

  // ---------------------------------------------------------------------------
  // Global time scale (slow-mo and rewind)
  // ---------------------------------------------------------------------------
  time: {
    crashSlowMo: 0.15,      // Phase 4 crash slow motion
    defaultBlend: 0.3,      // seconds to tween between time scales
    rewindSeconds: 5,       // seconds of history kept for Time Rewind
    rewindHz: 30,           // snapshots per second
    holdToRewind: 0.22,     // on foot: R held longer than this rewinds; a tap reloads
    steadySlowMo: 0.45,     // the world slows while Kael holds his breath on the scope
  },

  // ---------------------------------------------------------------------------
  // Physics
  // ---------------------------------------------------------------------------
  physics: {
    gravity: -9.81,
  },

  // ---------------------------------------------------------------------------
  // Kael on foot, 2020 (Phase 5). Speeds in m/s, times in seconds.
  // ---------------------------------------------------------------------------
  player: {
    height: 1.8,
    crouchHeight: 1.15,
    radius: 0.32,
    walkSpeed: 1.7,
    runSpeed: 4.6,
    sprintSpeed: 7.0,
    crouchSpeed: 1.6,
    aimSpeed: 2.4,
    accel: 12,             // how fast velocity reaches the stick target (1/s)
    decel: 16,
    airControl: 0.25,
    turnRate: 12,
    jumpSpeed: 5.0,
    gravity: -19,
    coyoteTime: 0.12,      // jump still allowed just after leaving a ledge
    jumpBuffer: 0.15,      // a jump pressed just before landing still counts
    stepHeight: 0.38,
    maxSlope: 48,          // degrees
    snapToGround: 0.35,
    roll: { speed: 7.2, time: 0.62, cooldown: 0.3 },
    vault: { minHeight: 0.4, maxHeight: 1.2, reach: 1.0, maxDepth: 1.6, time: 0.5 },
    cover: { reach: 1.2, speed: 1.8, peek: 0.6 },
    interactRange: 2.0,
    health: 100,
    regenDelay: 4,         // seconds without damage before health comes back
    regenPerSecond: 14,
    clipSpeeds: { walk: 1.7, run: 4.6 }, // ground speed at which the walk / run clips match the feet
  },

  // On-foot theme mechanics (A3b). Phase 7 moves their cost onto the heartbeat.
  footThemes: {
    time: { drainPerSecond: 0.3, refill: 0.05, rewindSpeed: 2, minToStart: 0.1 },
  },

  // Guns (Phase 6). Spread in degrees; recoil in radians of camera kick.
  weapons: {
    switchTime: 0.4,
    headshotHitStop: 0.035,
    echo: { delay: 0.11, volume: 0.35 }, // slapback in alleys / tunnels
    incendiary: { rounds: 15, burnSeconds: 5, burnDamagePerSecond: 14 },
    pistol: {
      name: 'Pistol', mode: 'semi', rpm: 340, damage: 34, mag: 12, reserve: 60, reload: 1.3, range: 120,
      spread: { hip: 2.2, aim: 0.35, move: 1.2, perShot: 1.1, max: 6, recover: 7 },
      recoil: { pitch: 0.03, yaw: 0.01 }, shake: 0.15, impulse: 2.5,
      sound: 'pistol_shot', volume: 0.75, flashScale: 0.8, gripAt: 0.22, muzzleHeight: 0.8,
    },
    rifle: {
      name: 'Rifle', mode: 'auto', rpm: 640, damage: 24, mag: 30, reserve: 150, reload: 2.1, range: 180,
      spread: { hip: 3.0, aim: 0.55, move: 1.6, perShot: 0.5, max: 7, recover: 5 },
      recoil: { pitch: 0.016, yaw: 0.009 }, shake: 0.12, impulse: 3,
      sound: 'rifle_shot', volume: 0.8, flashScale: 1.0, gripAt: 0.42, muzzleHeight: 0.62,
    },
    sniper: {
      name: 'Sniper', mode: 'bolt', rpm: 46, damage: 160, mag: 5, reserve: 25, reload: 2.6, range: 400,
      spread: { hip: 6, aim: 0.06, move: 2.5, perShot: 3, max: 9, recover: 3 },
      recoil: { pitch: 0.07, yaw: 0.015 }, shake: 0.35, impulse: 9,
      sound: 'sniper_shot', volume: 1, flashScale: 1.3, gripAt: 0.38, muzzleHeight: 0.6,
      scopeFov: 11,
      sway: { amount: 0.009, rate: 0.35, steadySeconds: 4 },
      projectile: { speed: 300, gravity: -9.81 }, // travel time + drop you can see
    },
  },

  // 🌑 Shadow Step (Phase 7): hold T, release on a dark spot
  shadowStep: {
    range: 14,             // metres
    cell: 1.0,             // dark-zone highlight grid
    sightSlowMo: 0.35,     // the world slows while choosing
    dissolveTime: 0.35,
  },

  // 🔥 Fire (Phase 7)
  fire: {
    fuel: 14,              // seconds a flammable object burns
    groundFuel: 6,         // a fire on bare ground
    spreadRadius: 2.6,     // heat reaches flammables this close
    igniteHeat: 1.6,       // heat needed to catch
    catchRadius: 1.4,      // ignite() catches a flammable this close
    damageRadius: 1.1,     // × fire size
    damagePerSecond: 30,
    maxFires: 16,
    maxLights: 4,          // real lights kept on the fires nearest the camera
  },

  // Hale's enforcers (Phase 8). Fairness first: reaction delay, shooter cap, falloff.
  ai: {
    health: 100,
    walkSpeed: 1.5,
    runSpeed: 4.2,
    fov: 120,              // degrees (unalerted)
    sightRange: 30,
    darkSightRange: 3.5,   // 🌑 inside a shadow zone they only see you point-blank
    hearGunshot: 32,
    hearFootsteps: 7,      // sprinting
    shareAlertRadius: 16,
    reactionTime: 0.75,    // seconds between spotting Kael and the first shot
    loseTime: 7,           // no sight for this long → search
    searchTime: 12,
    maxShooters: 2,        // at most this many fire at once
    rpm: 420,
    burst: 4,
    mag: 24,
    accuracy: 0.55,        // hit chance up close, before modifiers
    damage: [6, 9],
    coverMinDist: 5,
    coverMaxDist: 26,
    grenade: { radius: 4.5, damage: 70, fuse: 2.6, cooldown: 14, afterHidden: 6 },
  },

  // Missions (Phase 9)
  mission2: { maraSpeed: 4.6 },
  mission3: { scanRange: 22, scanSeconds: 3 },
  mission5: { spotSeconds: 8, spotTrack: 1.6, beatsLost: 8 },
  mission6: { collapseAt: [150, 300], safeRadius: 4.5, maraRange: 34, maraAccuracy: 0.6, maraDamage: 40 },
  mission7: {
    victorSpeed: 36,        // m/s — he drives hard
    minGap: 25,
    maxGap: 150,            // further than this and he's getting away…
    loseSeconds: 6,         // …for this long, and you lose him
    clockRate: 1,           // ⏳ seconds taken OFF the clock per second: it runs backwards
    lampLights: 6,          // real lights pooled near the car (the rest are glowing heads)
    checkpoints: [400, 800, 1200],
  },
  mission8: { victorHealth: 900, victorArmor: 0.8, incendiaryGift: 20, beamWarn: 1.4, beamDamage: 80 },
  mission4: {
    thunderEvery: [9, 15],  // seconds between lightning strikes
    thunderDelay: 0.6,      // flash → thunder roll
    maskSeconds: 2.2,       // a shot inside the roll is not heard
    trainEvery: 50,
    trainSpeed: 16,
    runSpeed: 3.2,
    maraDps: 2.2,           // per enforcer firing at her
  },

  // ---------------------------------------------------------------------------
  // THE RUN — the 3-minute main game (src/runner). Distances in metres.
  // ---------------------------------------------------------------------------
  runner: {
    lanes: [-2.6, 0, 2.6],
    laneSwitchTime: 0.15,      // seconds to cross one lane
    speed: [19, 22.5, 25],     // m/s in acts 1, 2, 3
    speedRamp: 0.06,           // extra m/s per second inside an act
    gravity: -46,
    jumpVelocity: 15,          // ≈ 2.4 m apex, ≈ 0.65 s airtime
    fastFall: -70,             // pressing down in the air slams to the ground
    rollTime: 0.62,
    hitbox: { halfWidth: 0.36, height: 1.75, rollHeight: 0.85, halfDepth: 0.3 },
    stumbleCost: 2,            // heartbeats for scraping a side
    crashCost: 8,              // heartbeats for a head-on crash (⏳ auto-rewind)
    rewindSeconds: 2.4,        // how far a crash rewinds
    rewindPlay: 0.9,           // real seconds the rewind takes to play back
    invulnAfterRewind: 1.4,
    heartbeats: 72,
    beatInterval: 3.0,         // the heart ticks down one beat every N seconds of running
    difficulty: {              // Settings → difficulty
      story:  { beatInterval: 4.2, crash: 5 },
      normal: { beatInterval: 3.0, crash: 8 },
      hard:   { beatInterval: 2.5, crash: 11 },
    },
    retryBeats: 40,            // beats after a FLATLINE retry
    fragmentRestore: 4,
    camera: { back: 5.6, up: 2.9, lookAhead: 10, lookY: 0.7, fov: 62, fovFast: 74, follow: 9, laneFollow: 0.78 },
    viewDistance: 170,         // obstacles appear this far ahead
    // 🔥🌑⏳ abilities: each meter holds 3 charges; an orb adds orbCharge
    orbCharge: 0.5,
    startCharges: 1,
    burn:   { duration: 2.2, speedMul: 1.55 },   // 🔥 smash barricades, untouchable by fire
    shadow: { duration: 2.6 },                    // 🌑 phase through lasers, enforcers and walls
    time:   { duration: 2.8 },                    // ⏳ every moving hazard freezes; Kael keeps running
    acts: [
      { id: 'time',    length: 1150, title: 'THE LAST LAP',      year: '2050', music: 'race_2050' },
      { id: 'shadows', length: 1300, title: 'WAKE IN THE RAIN',  year: '2020', music: 'city_rain_2020' },
      { id: 'fire',    length: 1400, title: 'THE FACTORY',       year: '20:20', music: 'combat' },
    ],
    finaleLength: 70,          // the walk into the fire
  },

  // City life (Phase 8)
  civilians: { walkSpeed: 1.3, runSpeed: 4.6, hearGunshot: 35 },
  traffic: { speed: 9, followGap: 7, brakeDistance: 13, accel: 3.5, brake: 12 },

  // Umbra, the shadow double (Phase 8 / Mission 5)
  umbra: {
    health: 420,
    lightThreshold: 0.6,   // darkness below this = he's in light = hittable
    keepDistance: [6, 11],
    stepEvery: [6, 10],    // seconds between Shadow Steps
    fireEvery: [1.1, 1.9],
    accuracy: 0.45,
    damage: [7, 11],
    rewindHeal: 110,
  },

  // Over-the-shoulder camera (Phase 5)
  cameraRig: {
    height: 1.58,          // pivot above the feet (standing)
    crouchHeight: 1.08,
    distance: 3.1,
    shoulder: 0.58,
    aimDistance: 1.35,
    aimShoulder: 0.66,
    fov: 62,
    aimFov: 42,
    sensitivity: 0.0022,   // radians per mouse pixel
    aimSensitivityScale: 0.6,
    pitchMin: -1.15,
    pitchMax: 0.95,
    followSharpness: 16,
    returnSharpness: 4,    // ease back out after a wall stops blocking
    aimSharpness: 12,
    collisionRadius: 0.2,
    hideBodyBelow: 0.55,   // camera closer than this (m) → hide Kael's body
  },

  // ---------------------------------------------------------------------------
  // Heartbeat meter (Phase 7). Difficulty multipliers apply in Phase 11.
  // ---------------------------------------------------------------------------
  heartbeat: {
    start: 72,
    max: 72,
    lowThreshold: 20,
    cost: { rewind: 3, steadyAim: 1, shadowStep: 2, death: 10 },
    difficulty: { story: 0.5, normal: 1, hard: 1.5 }, // cost multipliers (Settings → Difficulty)
    memoryFragmentRestore: 6,
  },

  // ---------------------------------------------------------------------------
  // Animation (rule A7.5)
  // ---------------------------------------------------------------------------
  animation: {
    blendFast: 0.15,
    blendDefault: 0.2,
    blendSlow: 0.3,
  },

  // ---------------------------------------------------------------------------
  // Loading screen
  // ---------------------------------------------------------------------------
  loading: {
    minDisplaySeconds: 2.2, // keep the ECG visible long enough to read
    fadeOutSeconds: 0.8,
  },

  // ---------------------------------------------------------------------------
  // Audio (volumes 0–1)
  // ---------------------------------------------------------------------------
  audio: {
    master: 0.9,
    music: 0.6,
    sfx: 0.8,
    voice: 1.0,
    musicFadeSeconds: 2.0,
  },

  // ---------------------------------------------------------------------------
  // Ambient world life (vfx/ambientLife.js, vfx/ambientStadium.js, vfx/ambientClub.js)
  // Pure decoration: crowds, drones, rain splashes, steam, birds, embers, lasers…
  // Counts are the High values; Medium / Low scale them by `density`.
  // ---------------------------------------------------------------------------
  ambient: {
    density: { low: 0.3, medium: 0.6, high: 1 },
    rewindSpeed: 1.6,          // ambient motion runs backwards this fast while ⏳ rewinding
    stadium: {
      crowd: 7000,             // instanced fans (High)
      phones: 2600,            // phone lights + camera flashes
      waveSpeed: 0.045,        // Mexican wave: laps of the stands per second
      hype: 0.65,              // 0 calm … 1 everyone on their feet
      droneShow: 520,          // drone-show lights over the infield
      droneFormationSeconds: 9,
      searchlights: 8,
      fireworkSlots: 8,
      fireworkEvery: [1.2, 3.5],
      skyTraffic: 140,         // flying cars in the 2050 skyline
    },
    city: {
      splashes: 160,           // rain splash rings around the camera
      splashRadius: 10,
      papers: 26,
      birds: 14,
      birdScareRadius: 4.5,
      birdHearShot: 30,
    },
    factory: { embers: 900, ash: 1400 },
    club: { lasers: 24, sparkles: 360, dust: 900 },
  },

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------
  debug: {
    showFps: false, // default for new players; toggle with F3 or Settings → Show FPS
  },
};

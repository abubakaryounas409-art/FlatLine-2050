# FLATLINE: 2050 — Master Build Prompt for Claude Code

> **How to use this file**
> 1. Create an empty folder `flatline-2050/` and save this file inside it as `CLAUDE.md`.
> 2. Open Claude Code in that folder.
> 3. Paste **one phase at a time** (Phase 0, then Phase 1, …). Say: *"Read CLAUDE.md and do Phase X. Stop when its checklist is done and tell me what assets I need to download."*
> 4. Test the game in the browser after every phase before moving on.
> 5. Never skip a phase. Each phase builds on the last one.

> **Project note:** the project root is this folder (`game1/`), which plays the role of `flatline-2050/` below.
>
> **Build notes (kept up to date by Claude):**
> - URL flags: `?test` Phase 0 scene · `?unlock` all missions · `?cutscene=test` · `?gallery` all models · `?race` free race · `?m1` Mission 1 · `?foot` on-foot + guns sandbox · `?combat` · `?m2`…`?m8` · `?ending` · `?trailer`.
> - Dev console handle: `window.__flatline = { game, cutscenes, gsap }` (dev builds only).
> - Worlds run through `src/core/game.js` (`game.setWorld(world)`); the menu world is `src/scenes/garageScene.js`.
> - `gsap.ticker.lagSmoothing(0)` is set in `main.js` so UI/cutscene timing stays in sync with audio. Keep it.
> - Don't use canvas `shadowBlur` for glows (ghosting + slow); stroke the path several times instead.
> - Audio clips: `clip: [startMs, lengthMs]` in the manifest plays a slice of a longer file.
> - The dev PC has Internet Download Manager, which intercepts `.mp3` in browsers (HTTP 204). The game detects it and warns.
> - `car_2050_kael.glb` (three.js "ferrari", ~350k tris): front = -Z, wheels `wheel_fl/fr/rl/rr`, steering `steering_wheel`.
> - Cutscenes: scripts in `src/cutscenes/scripts/` built with `src/cutscenes/steps.js` (`at(t, cam.moveTo(...))`); play with `cutscenes.play(script)`. Worlds expose directable characters as `world.actors = { kael: Actor }` (`src/cutscenes/actor.js`); scripts can also spawn actors. Set `missionCard: n` on a script to show the card after it.
> - Re-skins for downloaded models live in `src/assets/modelStyles.js` (`styleCar2050`, `styleKael2050`).
> - Manifest `fit: { axis, size, ground }` scales a model to real-world metres; the loader wraps every model in a group. Animation clip names are normalised to lowercase (`CharacterArmature|Idle` → `idle`, `Man_Walk` → `walk`, typo `HitRecieve` → `hit`). `?gallery` shows every model.
> - Most NPCs are Quaternius (CC0) on two rigs: CharacterArmature (24 clips incl. gun set) and HumanArmature (11 clips). See `ANIMATION_NAMES`.
> - Post-processing: optional passes must be toggled with `postfx._setPassEnabled()` (the composer only outputs from the last *enabled* pass).
> - Driving (Phase 3): `src/scenes/raceScene.js` builds the race world (`createRaceScene(renderer, assets, { laps, playerSlot, mission, onExit })`) from `vehicles/` (carController = Rapier raycast vehicle, physics forward +X; raceTrack = spline circuit; rivalCar = kinematic AI; race = laps/positions; carCamera; carAudio; carAbilities = theme abilities). Car handling was tuned on a headless Rapier bench — keep `CONFIG.car` values unless re-tested.
> - Mission 1 (Phase 4): `src/missions/m1_lastLap.js` (intro scripts `cutscenes/scripts/m1_intro.js`, crash `vehicles/crash.js`, helmet HUD `ui/helmetHUD.js`). Dev flags `?race`, `?m1`. Tests can drive via `window.__flatlineAutopilot` (dev only).
> - On foot (Phase 5): `player/playerController.js` (Rapier kinematic capsule + character controller, body origin at the feet; states move/roll/vault/cover/dead), `core/cameraRig.js` (over-the-shoulder, sphere-cast collision, `fovOverride`), `player/playerAnims.js` (logical states → candidate clips, best first, so the Quaternius stand-in and a Mixamo Kael both work; walk/run clips speed-matched). Sandbox world: `?foot` (`dev/footSandbox.js`). Stairs = visual steps on an invisible ramp collider (autostep snags on stacked steps).
> - Guns (Phase 6): `player/weapons.js` (hitscan from the crosshair + muzzle check; sniper = real projectile with drop; the gun is posed each frame at the right-hand bone and aimed at the crosshair, not parented), `vfx/muzzleFX.js` (`CombatFX` pooled flash/tracers/impacts/decals/casings), `systems/lights.js` (shootable bulbs + `darkness(point)`/`isDark`), `systems/heartbeat.js`, `ui/combatHUD.js`. Register damageable colliders with `weapons.register(collider, { surface, onHit })`. 3D sound: `audio.sfxAt(key, pos, { echo })` + `audio.setListener(camera)` per frame. Tap R = reload, hold R (> `CONFIG.time.holdToRewind`) = rewind.
> - Phases 7–8: `systems/heartbeat.js` (+ `heartbeatFX.js` low-beat effects, `ui/gameOver.js` FLATLINE), `player/shadowStep.js` (+ `vfx/dissolveShader.js`), `systems/fire.js` (spread, a fixed pool of 4 fire lights, heat haze via `postfx.setHeatSources`), `systems/explosions.js`, `systems/fragments.js`, `ai/enemyAI.js` (AIDirector: patrol→suspicious→combat→search, cover points from levels, shooter cap, grenades, armour, clip fallbacks), `ai/umbraAI.js`, `ai/civilianAI.js`, `ai/traffic.js`. Combat test: `?combat`.
> - Missions 2–8 (Phase 9) are built on `scenes/onFootWorld.js` (`createOnFootWorld(renderer, assets, { spawn, build(kit) })` — kit = addBox/addRamp/addStairs/addProp/addLamp/addCover/addFlammable/addFragment/addInteractable/setCheckpoint + ai/fire/weapons) and run by `missions/missionManager.js` (`runMission`: intro → card → play → outro → `ui/missionComplete.js` rank). Mission 7 has its own driving world (`createChaseWorld`). Ending: `missions/ending.js`; trailer: `missions/trailer.js` (F9 / `?trailer`). Flags `?m1`…`?m8`, `?ending`.
> - Performance rule: never ADD a light mid-game (three.js recompiles every material — a multi-second hitch). Create lights with the level (intensity 0) and reuse/pool them.
> - Phase 11: gamepad (`input.pollGamepad`, buttons act as keys, `input.pad` sticks/triggers), Settings invert Y + difficulty (scales heartbeat costs), headshot hit-stop, achievements (`ui/achievementToast.js` `award(id)`).
> - Media videos (Settings → Media, `?teaser` / `?reel`, dev `&from=<section>`): `src/showcase/` — `director.js` (`Showcase`: abortable shots with the steps.js DSL, own cinematic camera, `track()`/`ride()`, virtual input `hold/tap/release` that drives real systems, input shield + Space/Esc skip, full cleanup), `teaser.js`, `gameplayReel.js`, `set2020.js` (one on-foot world with every 2020 location side by side + stage lights), `driving.js` (race/chase autopilots, VIP box), `overlays.js` (cards, chapters + key caps), `recorder.js` (tab capture → .webm). Beat marker for tests: `<body data-showcase="teaser:race">`.
> - Ambient world life: `src/vfx/ambientLife.js` (`new AmbientLife(scene, { parent, reverse, rain })` → layers dust/embers/ash/drips/steam/smokeColumns/sparks/skyline/beacons/traffic/lightningBolts/helicopter/neonSigns/cables/chains/lightBar/spotBeams/lightShafts/splashes/papers/birds/debris; `update(dt, { camera, realDt, rewinding, player })`, `setQuality()`, `noise(pos)` scares birds). Stadium: `vfx/ambientStadium.js` (`addVelodromeLife(life, track)` crowd/phones/drone show/searchlights/fireworks/holo screens/sky traffic; uses `track.seats`/`track.towers`), club: `vfx/ambientClub.js`. On-foot levels dress it via `kit.ambient` (each mission's `dressAmbient(kit)`); race/ending/garage/M7 own one (M7 runs `reverse: true`). Shader-animated, no lights, counts in `CONFIG.ambient` (High values, scaled by `density` per quality); ambient time follows timeScale and runs backwards during rewind.
> - THE RUN (bonus mode — a row in Mission Select, or `?run`; the 8-mission story campaign is the main mode and NEW GAME starts Mission 1): `src/runner/` — `playRun.js` (director: cards, dialogue, music, pause, results; `await playRun()`), `runnerWorld.js` (`createRunnerWorld(renderer, assets)` → `loadAct(i)`/`setupIntro()`/`setCine(pos, look, t)`/`startRunning()`/`playFinale({ onStep })`, callbacks `world.on = { story, actEnd, flatline, fragment }`), `course.js` (seeded per-act courses), `obstacles.js` (pooled obstacles + `BEATS` power-vs-kind rules), `abilities.js` (time/shadow/fire, 3 charges each), `environment.js`, `runnerHero.js`, `runnerHUD.js`, `runnerFX.js`; tunables in `CONFIG.runner`. Dev: `window.__runnerAutopilot = true`. Tests: `node .dev/runtest.mjs <out> auto --fast` (full flow) and `node .dev/worldtest.mjs <out> [act] [seconds]` (world only).
> - Kael models: `kael_hero.glb` (2020, 53 clips, outfit baked) + `kael_hero_2050.glb` (racing suit) are built by `node .dev/mergehero.mjs public/models/characters/kael_hero.glb` (world-space retarget of Quaternius UAL1/2 onto the UBC Superhero, meshopt compressed; the loader calls `setMeshoptDecoder`). `playerAnims.js` adds an upper-body pistol-aim layer that follows camera pitch, plus leg twist for strafing, and measures each clip's ground speed from foot motion. Old models are in `asset_backups/`.

---

## PART A — GAME BIBLE (Claude Code: read this before every phase)

### A1. One-line pitch
A 2050 champion racer crashes in a stadium, falls into a coma, and wakes up in 2020 as an elite marksman. He must solve his father's murder before his heart stops in the future.

### A2. Tagline
*"He crashed in the future. He woke up in the past. He has 72 heartbeats to find his way back."*

### A3. Themes (every system must serve one of these)
| Theme | Color code | Meaning | Mechanic |
|---|---|---|---|
| 🔥 FIRE | Orange `#ff6a1a` | Trauma, the crime | Fire spreads, burning buildings, incendiary rounds |
| 🌑 SHADOWS | Black / deep purple `#1a0f2e` | Guilt, fear (Umbra) | Shadow Step teleport, shoot out lights to create shadows |
| ⏳ TIME | Cold blue `#3fa9ff` | The dying heart | 72-beat Heartbeat Meter, 5-second Rewind, reverse chase |

### A3b. Themes are MECHANICS, not decoration (binding rule for every phase)
Every playable mode must let the player *use* FIRE, SHADOWS and TIME, each with a meter, a key, a cost and a visible/audible signature (colour grade + sound + VFX). Story and environment colour alone are not enough.

| Mode | 🔥 FIRE | 🌑 SHADOWS | ⏳ TIME |
|---|---|---|---|
| Driving (Phases 3, 4, 9.6) | **Burn** boost (Shift) — drift heat refills it; jet flames; a burn from a ≥60 % meter leaves a **fire wake** that scorches rivals | **Draft** in a rival's slipstream to fill the meter; **Shadow Dash** (T) — void car phases through cars | **Rewind** (hold R) — everyone + the race clock rewinds up to 5 s; drains the time meter |
| On foot (Phases 5–9) | Incendiary rounds, fire spread, explosive barrels | Shoot out lights → darkness zones; Shadow Step (T) only in darkness; enemies blind in shadow | Time Rewind (hold R); steady aim / slow-mo while sniping |
| Shared cost (from Phase 7) | — | — | The **Heartbeat Meter** pays for abilities in 2020 (rewind 3, shadow step 2, steady aim 1) |

Implementation: `src/systems/timeRewind.js` (shared rewind engine: register `{ snapshot, restore }`), `src/vehicles/carAbilities.js` (driving abilities), tunables in `CONFIG.carThemes`.

### A4. Characters
| Name | Role | 2050 look | 2020 look |
|---|---|---|---|
| **Kael Rayne** | Hero, age 27 | White/red racing suit with glowing seams, carbon helmet | Black tactical jacket, dark hoodie, cargo pants, boots, fingerless gloves. Burn scar on left hand |
| **Umbra** | Kael's shadow double (his guilt) | — | Kael's model with a black/void shader and smoke trailing from the edges, glowing white eyes |
| **Victor Hale** | Villain, the father's business partner | Age 57, silver hair, white suit, owns the racing league | Age 33, brown suit, gold watch |
| **Elias Rayne** | Kael's father, engineer, inventor of the magnetic engine | — | Overalls, tool belt, kind face |
| **The Clockmaker** | Voice on a broken radio, guides Kael | Seen only in the ending: long coat, cracked glasses | Voice only |
| **Mara Voss** | 2020 police detective, ally/rival | — | Long coat, badge, ponytail |
| **Hale's Enforcers** | Enemies | Futuristic security in 2050 | Black suits and masks, rifles |

### A5. Full story (short)
1. **Prologue (2050):** The final lap of the World Grand Prix in the Neon Velodrome. The car HUD glitches "20.20.20". The brakes fail, the car crashes and explodes. A heart monitor beeps. Coma.
2. **Act 1 (2020):** Kael wakes up in a rainy city as "Shade", a marksman. The Clockmaker's radio voice says: *"Your body is dying in 2050. Find the truth in this year, or you never wake up."* He learns this is the year his father died in a factory fire.
3. **Act 2:** He investigates and finds a burnt watch stopped at 20:20. A sniper mission exposes Hale's men. Umbra, a shadow with Kael's face, starts hunting him. Victor burns the city to destroy evidence.
4. **Act 3:** In a reverse-time car chase, Kael's racing skills return. The final fight happens in the burning factory at 20:20. Kael cannot shoot Umbra. He must walk into the fire to save his father's memory, and Umbra fades away.
5. **Ending (2050):** Kael wakes up. He exposes Victor live on the stadium's giant screen. The glove clock reads 20:20 and starts ticking forward. Post-credits: the Clockmaker says, *"You're not the only one I've sent back."*

### A6. Tech stack (do not change)
- `three` (latest), `vite`
- `@dimforge/rapier3d-compat` (physics)
- `postprocessing` (pmndrs) for bloom, vignette, chromatic aberration, motion blur, color grading
- `three.quarks` (particles: fire, smoke, sparks, rain, shadow smoke)
- `howler` (music/UI sound) + Three.js `PositionalAudio` (3D sound)
- `gsap` (cutscene camera moves, UI animations)
- `three/examples/jsm` loaders: `GLTFLoader`, `DRACOLoader`, `KTX2Loader`, `RGBELoader`
- `@gltf-transform/cli` (dev dependency, for compressing models)

### A7. Coding rules for Claude Code
1. Plain JavaScript ES modules with clean, commented code. One system per file.
2. **Placeholder first:** if an asset file is missing, show a colored capsule/box placeholder and log a clear warning. The game must never crash because of a missing asset.
3. All asset paths live in one file: `src/assets/manifest.js`.
4. All tunable numbers (speeds, damage, heartbeat cost) live in `src/config.js`.
5. Use `AnimationMixer` + `crossFadeTo()` for every animation change (0.15–0.3 s blends). Never snap between animations.
6. Use a fixed-step physics loop (60 Hz) and a separate render loop.
7. Target 60 FPS on a mid-range laptop. Add a Graphics setting (Low/Medium/High).
8. After every phase, update `ASSETS_TODO.md` with exactly which files the user must download, where from, the search words to use, and where to put each file.
9. Keep a `CREDITS.md` list for every downloaded asset and its license.

### A8. Folder structure
```
flatline-2050/
├── CLAUDE.md
├── ASSETS_TODO.md
├── CREDITS.md
├── index.html
├── public/
│   ├── models/characters/   kael_2050.glb, kael_2020.glb, victor.glb, elias.glb, mara.glb, enemy.glb
│   ├── models/vehicles/     car_2050_kael.glb, car_2050_rival.glb, car_2020_sedan.glb, police_car.glb
│   ├── models/weapons/      pistol.glb, rifle.glb, sniper.glb
│   ├── models/env/          stadium.glb, city_block.glb, factory.glb, hospital.glb, rooftop.glb
│   ├── models/props/
│   ├── textures/
│   ├── hdri/
│   ├── audio/sfx/  audio/music/  audio/voice/
│   └── video/ (optional)
└── src/
    ├── main.js
    ├── config.js
    ├── assets/       manifest.js, loader.js, loadingScreen.js
    ├── core/         renderer.js, postfx.js, physics.js, input.js, cameraRig.js, audio.js, timeScale.js
    ├── player/       playerController.js, playerAnims.js, weapons.js, shadowStep.js
    ├── vehicles/     carController.js, carCamera.js, crash.js
    ├── ai/           enemyAI.js, umbraAI.js, civilianAI.js
    ├── systems/      heartbeat.js, timeRewind.js, fire.js, lights.js, saveGame.js
    ├── vfx/          fireFX.js, smokeFX.js, rainFX.js, muzzleFX.js, dissolveShader.js, glitchFX.js
    ├── cutscenes/    cutscenePlayer.js, subtitles.js, scripts/*.js
    ├── missions/     missionManager.js, m1_lastLap.js … m8_flatline.js
    └── ui/           mainMenu.js, hud.js, pauseMenu.js, missionCard.js, gameOver.js, credits.js
```

---

## PART B — ASSET SHOPPING LIST (where to download everything)

> **Rule for the user:** always check each asset's license. CC0 needs no credit. CC-BY needs credit in `CREDITS.md`. Never use assets marked "Editorial" or "Non-commercial" if the competition has prizes; ask the organizers.

### B1. Characters + animations → **Mixamo** (mixamo.com, free with Adobe account)
- **Characters:** pick realistic humans (soldier, businessman, casual man, police woman). Download as **FBX Binary, T-pose, with skin**.
- **Kael (2020) animation list** (download each **"Without Skin"**, 30 fps). Search words:
  - Locomotion: `idle`, `walking`, `jogging`, `running`, `sprint`, `crouch walk`, `crouch idle`, `strafe left/right`, `walking backwards`, `turn 90`
  - Pistol: `pistol idle`, `pistol walk`, `pistol run`, `pistol shoot`, `pistol reload`
  - Rifle: `rifle idle`, `rifle aim walk`, `rifle run`, `firing rifle`, `rifle reload`, `rifle crouch`
  - Sniper: `prone`, `prone idle`, `crawl`, `sniper aim`
  - Action: `jump`, `running jump`, `roll`, `dodge`, `vault`, `climbing`, `take cover`, `cover idle`, `hit reaction`, `death`, `kneel`, `get up`, `stand up from lying`
  - Story: `waking up`, `looking around`, `talking`, `phone call`, `pointing`, `carrying` (civilian carry), `injured walk`, `limp`, `shielding face` (for the fire walk), `driving`, `sitting`
- **Enemies:** the rifle set + `death`, `hit reaction`, `patrol walk`, `alert look around`
- **Civilians:** `scared`, `running scared`, `crouch cover`, `sitting`, `walking`
- **Victor:** `idle confident`, `talking`, `pointing`, `kneeling` (arrest), `surprised`

**Merge in Blender** (free, blender.org): import the character, import each animation FBX, rename each action (`idle`, `run`, `shoot` …), push to NLA, export **one `.glb` per character** with all animations. Then run:
`npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp`

### B2. Clothing / custom looks → **Blender** + **Sketchfab**
- Sketchfab (sketchfab.com, filter **Downloadable** + **glTF**): search `tactical jacket`, `hoodie`, `racing suit`, `helmet`, `police badge`, `business suit`.
- Add the burn scar on Kael's hand with a texture paint in Blender.
- Racing suit glow: an emissive texture map on the suit seams.

### B3. Vehicles → **Sketchfab**
- 2050 cars: `futuristic race car`, `concept car`, `cyberpunk car` (low-poly or mid-poly, under 50k triangles)
- 2020 cars: `sedan`, `police car`, `suv`, `truck`
- Each car must have **separate wheels** (or Claude Code will fake the wheels).

### B4. Weapons → **Sketchfab** / **Quaternius** (quaternius.com, CC0)
- `pistol`, `assault rifle`, `sniper rifle` (low-poly game-ready)

### B5. Environments → **Sketchfab** + build with Three.js
- Stadium: `race track`, `sci-fi stadium`, `futuristic arena`
- City: `city block`, `modular city`, `street`, `building`, `alley`
- Factory: `abandoned factory`, `warehouse`, `industrial`
- Hospital: `hospital room`, `hospital bed`, `heart monitor`
- Rooftop: `rooftop`, `water tower`, `AC unit`
- Props: `barrel`, `crate`, `street lamp`, `traffic light`, `dumpster`, `fire hydrant`

### B6. Textures + skies → **Poly Haven** (polyhaven.com, CC0) + **ambientCG** (ambientcg.com, CC0)
- HDRIs: a night city HDRI (2020), a dusk or stadium-lights HDRI (2050), an overcast HDRI (rain)
- Textures: `asphalt`, `wet asphalt`, `concrete`, `rusty metal`, `burnt wood`, `brick`, `charred`, `tiles`

### B7. Sound effects
- **Sonniss GDC Game Audio Bundle** (sonniss.com/gameaudiogdc, free, royalty-free): guns, explosions, cars, fire, impacts
- **Freesound.org** (check license): `heart monitor`, `flatline`, `rain heavy`, `thunder`, `clock tick`, `radio static`, `crowd cheer stadium`, `glass shatter`, `whoosh`, `reverse whoosh`
- **Pixabay Sound Effects** (pixabay.com/sound-effects): UI clicks, sci-fi beeps

### B8. Music → **Pixabay Music** or compose in **BandLab** (free)
- `main_theme.mp3` — clock tick + heartbeat rhythm, piano, rising strings
- `race_2050.mp3` — fast synthwave
- `city_rain_2020.mp3` — dark ambient, low cello
- `combat.mp3` — heavy drums, distorted bass (FIRE)
- `umbra.mp3` — whispers, low drone (SHADOWS)
- `reverse_chase.mp3` — reversed synths, ticking (TIME)
- `ending.mp3` — emotional piano with strings

### B9. Voice lines
- Record with a phone (quiet room) or use a text-to-speech tool that allows game use. Save as `audio/voice/<scene>_<line>.mp3`. Subtitles are always on.

---

## PART C — BUILD PHASES (do one at a time)

### PHASE 0 — Project setup
1. Create the Vite project with all packages from A6.
2. Create the full folder structure from A8 with empty files and comments.
3. Write `config.js`, `assets/manifest.js` (every path from Part B), and the placeholder system (A7 rule 2).
4. Renderer: `WebGLRenderer` with antialias, `ACESFilmicToneMapping`, sRGB output, soft shadows (PCFSoft), pixel ratio capped at 2.
5. Post-processing pipeline (`postfx.js`): Bloom, Vignette, ChromaticAberration, ToneMapping, plus a `setMood(theme)` function that changes color grading to FIRE (warm), SHADOWS (dark, high contrast), TIME (blue, desaturated).
6. `timeScale.js`: a global time multiplier used by every system (for slow-motion and rewind).
7. Loading screen: black, a heart-monitor line drawing across the screen, and a percentage counter.
8. Create `ASSETS_TODO.md` and `CREDITS.md`.

✅ **Checklist:** `npm run dev` shows the loading screen, then a test scene with a placeholder capsule, bloom, and a working FPS counter.

---

### PHASE 1 — Main menu + game opening (first impression for judges)
1. **Boot sequence** (skippable with any key after the first view):
   - Black screen → a heartbeat sound → a thin heart-monitor line appears.
   - The line spikes 3 times with the beat, then flattens into the title **FLATLINE** in glowing white, with **2050** glitching in blue underneath.
   - Fire embers float up from the bottom, and shadow smoke drifts at the sides (three.quarks).
2. **Main menu background:** a slow orbiting camera around Kael's 2050 car in a dark garage, with neon lights flickering. Kael (placeholder until the model exists) stands by the car in an idle animation.
3. Menu items: **New Game, Continue, Mission Select (unlocked missions), Settings (graphics, volume, sensitivity, subtitles), Credits, Quit**.
4. Menu animations: items slide in with GSAP. On hover, a glitch effect plays with a tick sound.
5. Main theme music fades in.

✅ **Checklist:** The intro plays, the menu works, settings are saved to `localStorage` (wrapped in try/catch).

---

### PHASE 2 — Cutscene engine (used before every mission)
1. `cutscenePlayer.js` plays scripts made of timed steps:
   - `camera.moveTo(position, lookAt, duration, ease)`, `camera.shake(strength, time)`, `camera.dollyZoom()`
   - `actor.play(animationName, blend)`, `actor.moveTo(point, speed)`, `actor.lookAt(target)`
   - `subtitle(speaker, text, duration)`, `voice(file)`, `sfx(file)`, `music(file, fade)`
   - `fade(toBlack/fromBlack, time)`, `slowMo(scale, time)`, `flash(color)`, `glitch(time)`, `setMood(theme)`
2. Cinematic **letterbox bars** slide in at the top and bottom.
3. "Hold SPACE to skip" with a circular progress ring.
4. Subtitles: speaker name colored by character, with a smooth fade.
5. **Mission card** after each cutscene: a big mission number, the mission name, the theme icon (🔥/🌑/⏳), and one objective line. It animates in with a glitch and fades out.

✅ **Checklist:** A test cutscene with camera moves, a subtitle, a fade, and a mission card works.

---

### PHASE 3 — Driving system (2050)
1. `carController.js`: Rapier raycast-vehicle physics with acceleration, braking, drift/handbrake, boost, and suspension.
2. `carCamera.js`: a chase camera with smooth follow. **FOV widens with speed**, the camera shakes slightly at top speed, and it looks back with the C key.
3. Speed effects: motion blur, speed lines (particles), and chromatic aberration at boost.
4. Neon trail lights behind the cars.
5. Rival AI cars that follow a spline path around the track with small random mistakes.
6. HUD: speed, position (1st/2nd…), lap counter, boost bar, minimap.
7. Sounds: engine pitch tied to speed (electric whine + turbine), wind, and boost.

✅ **Checklist:** A full lap is drivable on a placeholder oval track against 5 AI cars.

---

### PHASE 4 — MISSION 1: "LAST LAP" (2050, theme: TIME)
**Opening cutscene (realistic, about 45 s):**
1. A drone shot flies over the Neon Velodrome at night: 200,000 fans, holographic screens, and fireworks.
2. A close-up of Kael in the cockpit. The camera pushes in on his eyes. The helmet HUD turns on.
3. Commentator voice: *"Kael Rayne, undefeated… one lap from history."*
4. A cut to Victor Hale in a VIP box. He looks at a tablet and smiles. (Plant the clue.)
5. The start lights go red, red, red, then green. A camera whip pans as the cars launch.

**Gameplay:** The final lap. The player must reach 1st place.
**Scripted crash (at the last corner, no matter what):**
1. The HUD glitches "20.20.20" in red with a static sound.
2. "BRAKE FAILURE" flashes, and the steering stops responding.
3. **Slow motion** (timeScale 0.15): the car flips, glass shatters (particles), sparks fly, and Kael's helmet visor cracks. The camera orbits slowly.
4. An explosion (fire + smoke + bloom flash) plays, then real speed returns with a screen shake.
5. A white flash fades to black. A heart monitor beeps... and slows.
6. Text appears: **"KAEL RAYNE — STATUS: COMA."**

**Transition:** Rain sounds start in the black. Fade into Mission 2.

✅ **Checklist:** The intro cutscene → race → scripted crash → fade to black all work without the player stopping.

---

### PHASE 5 — Third-person character controller (2020)
1. `playerController.js`: Rapier capsule character with walk, run, sprint, crouch, jump, roll, and vault over low objects.
2. `cameraRig.js`: GTA-style over-the-shoulder camera with collision (no clipping through walls), smooth follow, aim zoom on right mouse, and shoulder swap with Q.
3. `playerAnims.js`: an animation state machine with **crossfades** for idle ↔ walk ↔ run ↔ sprint, strafe while aiming, crouch, jump (start/air/land), roll, hit reaction, and death.
4. **Foot placement feel:** small speed-matched blending so feet don't slide (match the animation speed to the movement speed).
5. **Cover system:** press E near a wall to snap into cover. Peek and shoot from cover.
6. Interaction prompt: "Press F" floating over usable objects.

✅ **Checklist:** The character moves smoothly with no snapping animations, and the camera never goes inside walls.

---

### PHASE 6 — Shooting system
1. `weapons.js`: pistol, rifle, and sniper. Includes hitscan raycasts, ammo, reloading, recoil (camera kick + crosshair spread), and weapon switching (1/2/3 keys, mouse wheel).
2. Weapon models attach to the character's right-hand bone.
3. Effects: muzzle flash (light + sprite), shell casings (small physics objects), bullet tracers, impact sparks/dust/blood decals based on the surface, and hit markers in the HUD.
4. **Sniper mode:** a scope overlay, breath sway, and hold Shift to steady (this costs 1 heartbeat). Bullet drop and travel time.
5. **Incendiary rounds (FIRE):** special ammo that sets targets and objects on fire.
6. **Shoot out lights (SHADOWS):** street lamps and bulbs can be shot, which creates darkness zones.
7. Sounds: 3D gun sounds with echo in tunnels and alleys.

✅ **Checklist:** All 3 weapons work with full effects, and lights can be shot out.

---

### PHASE 7 — Signature systems (FIRE, SHADOWS, TIME)
1. **Heartbeat Meter (`heartbeat.js`)**
   - Starts at 72 beats. Shown as an animated heart + ECG line in the bottom-left of the HUD.
   - Rewind costs 3 beats. Steady aim costs 1. Shadow Step costs 2. Dying costs 10 (you respawn at a checkpoint).
   - Beats are restored by collecting **memory fragments** (glowing objects tied to the story).
   - Below 20 beats: the vignette pulses, colors drain, the heartbeat sound gets louder, and the music speeds up.
   - At 0: a **FLATLINE** game over screen with a monitor tone and "TRY AGAIN".
2. **Time Rewind (`timeRewind.js`)**
   - Records the position, rotation, animation time, health, and velocity of every rewindable object every frame for 5 seconds.
   - Hold R to play it backwards. During rewind: blue tint, reversed sounds, a clock-tick sound, and ghost trails.
3. **Shadow Step (`shadowStep.js`)**
   - Hold T to see the shadow zones highlighted in purple. Aim at one and release to teleport.
   - Animation: Kael's body dissolves into black smoke (noise dissolve shader + particles), and he re-forms at the target.
   - Only works inside dark areas, which is why shooting out lights matters.
4. **Fire system (`fire.js`)**
   - Fire spreads to nearby flammable objects over time. Fire damages the player and enemies.
   - Heat-haze distortion near flames, glowing embers, and black smoke columns.

✅ **Checklist:** All 4 systems work together in a test arena.

---

### PHASE 8 — AI
1. **Enemies:** states for patrol → suspicious (a "?" icon) → alert → combat (take cover, flank, shoot, reload, throw grenades) → search. Enemies cannot see the player inside shadow zones.
2. **Umbra (boss AI):** mirrors Kael's moves, uses Shadow Step and Rewind too, whispers lines, and is only vulnerable in light.
3. **Civilians:** walk, panic when shots are fired, run away, and crouch. Used to make the city feel alive.
4. **Traffic:** simple 2020 cars following road splines.

✅ **Checklist:** A combat test with 6 enemies feels fair, and enemies use cover.

---

### PHASE 9 — MISSIONS 2 to 8 (one mission per sub-step; finish and test each before the next)

Every mission follows this pattern: **intro cutscene → mission card → gameplay with checkpoints → outro cutscene → mission complete screen** (time, accuracy, heartbeats left, and a rank of S/A/B/C).

#### 9.1 — MISSION 2: "WAKE IN THE RAIN" (2020, theme: SHADOWS, tutorial)
- **Cutscene:** Rain on Kael's face in a dark alley. He wakes up gasping (`waking up` animation). He looks at his hands: no burn scar... then the scar slowly appears. A radio crackles, and the **Clockmaker** says his line. Police sirens start.
- **Gameplay:** Escape a police raid across rooftops and alleys. Teaches movement, cover, the pistol, shooting out lights, and Shadow Step. Officer Mara Voss chases him.
- **Outro:** Kael hides in a dark room. Mara passes by without seeing him. He finds a 2020 newspaper: *"Engineer Elias Rayne — Factory Fire Tonight?"* The date is today.

#### 9.2 — MISSION 3: "ASHES SPEAK" (theme: FIRE, investigation)
- **Cutscene:** Kael stands at the burnt factory gates. Flashback (desaturated): young Kael watches flames from a car window.
- **Gameplay:** Explore the factory (stealth, with a few enemies). Find 5 clues using a scan mode (the screen turns orange, clues glow). The final clue is **a burnt watch stopped at 20:20**. Leaving triggers an ambush, and the factory starts burning.
- **Outro:** Kael escapes as a wall collapses. Victor's car drives past in the background (seen in a reflection).

#### 9.3 — MISSION 4: "SNIPER'S CLOCK" (theme: TIME)
- **Cutscene:** Kael climbs a water tower at night. Thunder. The Clockmaker: *"Every shot is a heartbeat. Make them count."*
- **Gameplay:** Protect Mara from Hale's enforcers during a meeting below. Time shots to thunder (it hides the gun sound) and a moving train (it blocks the view). Using steady aim costs heartbeats.
- **Outro:** Mara looks up at the tower. Their eyes meet through the scope. She lowers her gun, so she is now a possible ally.

#### 9.4 — MISSION 5: "THE MAN WITH MY FACE" (theme: SHADOWS, first boss)
- **Cutscene:** In a mirror maze nightclub, the lights flicker. Kael sees his reflection smile while he doesn't. **Umbra** steps out of the mirror (dissolve shader reversed).
- **Gameplay:** The boss fight. Umbra is only vulnerable in light, but Kael needs shadows to survive. Shoot out lights carefully and use spotlights as weapons. Umbra can also rewind.
- **Outro:** Umbra melts into the floor, whispering *"You ran from the fire. You'll always run."* Kael's heartbeat drops sharply.

#### 9.5 — MISSION 6: "CITY ON FIRE" (theme: FIRE)
- **Cutscene:** Victor on a phone in his office: *"Burn the whole district. No evidence."* Explosions rip through streets. Kael and Mara meet properly.
- **Gameplay:** Open district with fires spreading. Rescue 8 civilians (carry animation) while fighting enemies. Buildings collapse on timers. Mara gives covering fire.
- **Outro:** Mara hands Kael the factory files. Victor's name is on every page. The final page shows the magnetic engine design.

#### 9.6 — MISSION 7: "REVERSE CHASE" (theme: TIME + racing)
- **Cutscene:** Victor escapes in a car. Kael jumps into a 2020 sports car. The Clockmaker: *"Your hands remember. Drive."* The world freezes, then starts running **backwards**.
- **Gameplay:** Drive while time flows backwards: crashed cars un-crash, explosions shrink, bullets fly back into guns. The player must weave through these events. Use the driving system from Phase 3 with the rewind system from Phase 7 applied to the world.
- **Outro:** The chase ends at the factory gates at 20:19. Victor runs inside. The clock ticks.

#### 9.7 — MISSION 8: "FLATLINE" (themes: ALL THREE, finale)
- **Cutscene:** The factory as it looked **before** the fire. Elias Rayne works on the engine. Young Victor walks in with a gas can. Kael watches through a window. The clock reads 20:20. Fire starts.
- **Gameplay part 1:** Fight through enforcers in the burning factory. Rewind to dodge collapsing beams.
- **Gameplay part 2:** Boss: Victor with heavy armor. Defeat him with incendiary rounds and shadows.
- **Gameplay part 3 (the twist):** Umbra blocks the path to Elias inside the fire. **Shooting Umbra does nothing.** The guns slowly lower by themselves. The only way forward is to **walk into the fire** (the player holds W while the screen burns white). The `shielding face` animation plays, the heartbeat crashes, the music swells, and Umbra fades away behind Kael with each step.
- **Final cutscene:** Kael reaches his father. Elias smiles: *"You stopped running."* Everything turns white. The flatline tone sounds... then one beep. Then another.

✅ **Checklist for each mission:** It can be finished start to end, checkpoints work, and the cutscenes play correctly.

---

### PHASE 10 — ENDING + CREDITS
1. **Hospital wake-up cutscene (2050):** Kael's eyes open. The heart monitor races. A nurse runs in.
2. **Stadium finale:** Kael limps into the Neon Velodrome during a press event. He plugs a data drive into the giant screen. The factory files and the sabotage logs appear for 200,000 fans. Victor is arrested by security (kneeling animation).
3. **Final shot:** a close-up of Kael's racing glove. The clock reads 20:20, then ticks forward to 20:21. Cut to black with a heartbeat.
4. **Credits:** scrolling over a slow drive through the neon city, using `CREDITS.md`.
5. **Post-credits:** radio static. The Clockmaker: *"You're not the only one I've sent back."*

✅ **Checklist:** The full game can be played from New Game to the post-credits scene.

---

### PHASE 11 — Polish (this makes judges say "wow")
1. **Camera:** subtle handheld shake in cutscenes and depth of field in close-ups.
2. **Weather:** rain with splashes on the ground, puddle reflections (screen-space reflections or a cubemap), and lightning that lights the whole scene.
3. **Hit feel:** a short hit-stop (2 frames of freeze) on headshots, controller rumble (Gamepad API), and impact camera kicks.
4. **Audio mix:** music ducks under dialogue, reverb in interiors, muffled sound underwater/in shock.
5. **UI:** every menu has smooth transitions, and a pause menu blurs the background.
6. **Gamepad support** (Xbox/PlayStation layouts).
7. **Save system:** checkpoint saves to localStorage (with try/catch).
8. **Accessibility:** subtitle size, colorblind-friendly HUD, invert Y, and difficulty (Story/Normal/Hard, which changes heartbeat costs).
9. **Performance pass:** LODs, frustum culling, instancing for props, compressed textures, and the Low/Medium/High setting.
10. **Achievements** (shown in-game): "Undefeated" (win the race before the crash), "Ghost" (finish Mission 2 without being seen), "Pyromaniac", "Heart of Steel" (finish with 50+ beats).

---

### PHASE 12 — Trailer mode + final check
1. A hidden **Trailer Mode** (press F9): plays a 60-second cinematic montage — crash → rain wake-up → sniper shot → Shadow Step → city fire → reverse chase → fire walk → "20:20" → title. Record it with OBS for the competition.
2. Full playtest from New Game to the end, with a bug list fixed.
3. A final `ASSETS_TODO.md` check: every placeholder is replaced.
4. `npm run build`, test the build folder, and write a `README.md` with controls and how to run the game.

---

## PART D — CONTROLS

| Action | Keyboard/Mouse | Gamepad |
|---|---|---|
| Move | WASD | Left stick |
| Camera | Mouse | Right stick |
| Sprint | Shift | L3 |
| Jump / Vault | Space | A |
| Crouch | Ctrl / C | B |
| Roll | Alt | B (tap while running) |
| Aim / Shoot | Right / Left mouse | LT / RT |
| Reload | R (tap) | X |
| **Time Rewind** | R (hold) | LB (hold) |
| **Shadow Step** | T (hold, release) | RB (hold, release) |
| Cover | E | Y |
| Interact | F | X (hold) |
| Weapons | 1 / 2 / 3, wheel | D-pad |
| Shoulder swap | Q | R3 |
| Pause | Esc | Start |
| Driving | W/S gas/brake, A/D steer, Space handbrake (drift), Shift Burn, T Shadow Dash, hold R Rewind, C look back, Backspace reset | RT/LT, left stick, A, X |

---

## PART E — FIRST MESSAGE TO PASTE INTO CLAUDE CODE

> Read CLAUDE.md completely. This is my game for a competition, so quality and polish are the priority. Do **Phase 0** only. Follow every coding rule in A7. When done, run the project, confirm the checklist, update ASSETS_TODO.md, and tell me exactly which assets I should download next and from where. Then wait for me to say "next phase".

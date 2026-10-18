# ASSETS_TODO — FLATLINE: 2050

Every file the game expects, where to get it, what to search, and where to put it.
The game runs with placeholders until each file exists. Missing files are listed in the
browser console as `[ASSET MISSING]`. Open **http://localhost:5174/?gallery** to see every installed
model at real-world size.

- **Exact file names matter.** They must match `src/assets/manifest.js`.
- **Sizes don't matter any more:** the manifest's `fit` option scales a model to real-world size and puts it on the ground.
- **License:** CC0 needs no credit. CC-BY needs a line in `CREDITS.md`. Avoid "Editorial" or "Non-commercial" assets.
- **Models:** compress every `.glb`, but **keep the parts separate** (wheels, glass, body…).
  The default `optimize` merges the whole model into one mesh and one material, which breaks
  spinning wheels, glass and paint. Use:
  `npx gltf-transform optimize in.glb public/models/<folder>/<name>.glb --compress draco --texture-compress webp --join false --flatten false --palette false --simplify false`
  Characters with animations: the same command (`--flatten false` keeps the skeleton intact).
- **Audio on this PC:** Internet Download Manager (IDM) intercepts `.mp3` files in the browser, so the
  game would be silent. In IDM: *Options → File types → "Don't start downloading automatically from
  the following sites"* → add `localhost` and `127.0.0.1`. (Players without IDM are not affected.)
- Last updated: **Phase 12 — the whole story (Missions 1–8, ending, credits, trailer) is playable with the assets below; everything still on this list is an upgrade, not a blocker**

Status: ⬜ missing · ✅ in place · 🔧 in place, but needs a fix

---

## ✅ THE RUN (main mode, `src/runner/`)

Everything it needs is present (`kael_runner.glb`, `enemy.glb`, `elias.glb`, `victor.glb`, `car_2050_rival_lite.glb` + existing sounds and music). Optional improvements:

| ✓ | File | Notes |
|---|---|---|
| ⬜ | `public/audio/voice/run_*.mp3` *(optional)* | Voice recordings for the Clockmaker, Umbra and Elias lines (see the voice licence note below). Subtitles always show, so nothing breaks without them |
| ⬜ | One dedicated music track per act *(optional)* | Today the acts reuse `race_2050`, `city_rain_2020` and `combat` (`CONFIG.runner.acts[i].music`) |

---

## ✅ Phase 1 assets (boot intro + main menu)

| ✓ | File | Notes |
|---|---|---|
| ✅ | `public/audio/music/main_theme.mp3` | 2:04, good. CC-BY: credited |
| ✅ | `public/audio/sfx/heartbeat.mp3` | Has 2 beats; the game plays only the first (0–0.95 s) |
| ✅ | `public/audio/sfx/monitor_beep.mp3` | 28 s of beeps; the game plays only the first beep |
| ✅ | `public/audio/sfx/flatline.mp3` | Good |
| ✅ | `public/audio/sfx/ui_click.mp3` | Normalized to -1.3 dB peak |
| ✅ | `public/audio/sfx/ui_glitch.mp3` | Normalized to -1.4 dB peak |
| ✅ | `public/audio/sfx/ui_hover.mp3` | Normalized to -3.8 dB peak |
| ✅ | `public/models/vehicles/car_2050_kael.glb` | Original three.js file (MIT, wheels `wheel_fl/fr/rl/rr`). Backup in `asset_backups/` |
| ✅ | `public/hdri/stadium_dusk_2k.hdr` | Poly Haven "Stadium 01", CC0 |
| ✅ | `public/models/env/garage.glb` | Garage + Workshop (Richard A, CC-BY 3.0 via Poly Pizza) |

## ✅ Phase 2 & 3 assets (cutscene engine + driving)

| ✓ | File (put it here) | Source | Search words / notes |
|---|---|---|---|
| ✅ | `public/models/characters/kael_2050.glb` | three.js (MIT) | Rigged & animated character (with `idle`, `walk`, `run`). Draco compressed (606 KB). It's the X Bot (1.80 m; also `agree`, `headShake`, `sad_pose`, `sneak_pose`); the game re-skins it as a white/red racing suit |
| ✅ | `public/audio/sfx/radio_static.mp3` | Mixkit | Radio noise static and crackles |
| ✅ | `public/audio/sfx/whoosh.mp3` | Mixkit | Cinematic whoosh fast transition |
| 🔧 | `public/models/vehicles/car_2050_rival.glb` | three.js / Flatline Team | Separate wheels ✓, but it is the same Ferrari at **~300k triangles**, not under 50k. ×5 rivals ≈ 1.5M triangles per frame. **No action needed:** Phase 3 will auto-generate a light (~40k) version with gltf-transform and recolour each rival |
| ⬜ | `public/models/env/stadium.glb` *(optional)* | sketchfab.com | `race track`, `sci-fi stadium`. Otherwise Phase 3 builds a neon oval in code |
| ✅ | `public/audio/music/race_2050.mp3` | freesound.org (CC-BY-4.0) | Retro Chase Loop 120BPM, fast synthwave |
| ✅ | `public/audio/sfx/engine_electric.mp3` | Mixkit (Free License) | Seamless 20s large drone / EV motor hum loop |
| ✅ | `public/audio/sfx/engine_turbine.mp3` | Mixkit | Space rocket full power turbine |
| ✅ | `public/audio/sfx/boost.mp3` | Mixkit | Player Boost Recharging |
| ✅ | `public/audio/sfx/wind.mp3` | Mixkit | Wind blowing ambience |
| ✅ | `public/audio/sfx/tire_skid.mp3` | freesound.org (CC0) | Chrysler LHS tire squeal |
| ✅ | `public/audio/sfx/crowd_cheer.mp3` | freesound.org (CC0) | Stadium crowd cheer |
| ✅ | `public/audio/sfx/clock_tick.mp3` | Pixabay | Ticking |
| ✅ | `public/audio/music/umbra.mp3` | freesound.org (CC0) | Thumping spooky drone |

## ✅ Phase 4 assets (Mission 1 "Last Lap" crash & cutscene)

| ✓ | File (put it here) | Source | Search words / notes |
|---|---|---|---|
| ✅ | `public/audio/sfx/explosion.mp3` | Mixkit | Car explosion debris |
| ✅ | `public/audio/sfx/car_crash.mp3` | freesound.org (CC0) | Car crash collision |
| ✅ | `public/audio/sfx/glass_shatter.mp3` | freesound.org (CC0) | Glass break / shatter |
| 🔧 | `public/audio/voice/m1_commentator_01.mp3` | Edge TTS (GuyNeural) — ⚠️ see the voice licence note below | *"Kael Rayne, undefeated… one lap from history."* (excited stadium announcer) |
| 🔧 | `public/models/characters/victor.glb` | three.js (MIT) | This is the three.js **"Vanguard" soldier** (armour + visor; clips idle/run/walk/tpose) — not a businessman. A CC0 Quaternius **Business Man** (24 clips) is ready in `asset_backups/candidates/victor_business_quaternius.glb` — say the word and I'll swap it in |
| ✅ | `public/hdri/night_city_2k.hdr` | Poly Haven | Shanghai Bund 2K HDRI (CC0) |

## ⬜ Still needed — only you can get these

| ✓ | File | Why I couldn't download it | How to get it |
|---|---|---|---|
| 🔧 | `public/models/characters/kael_2020.glb` | **A stand-in is installed** (Quaternius Adventurer, CC0, recoloured to a black jacket / hoodie, backpack hidden) so Phases 5–6 are fully playable. It has idle / walk / run / roll / strafe / gun idle / shoot / hit / death, but **no crouch, cover, vault, prone or sniper clips** (the game falls back to the closest clip). A real Kael needs a **Mixamo** login | Mixamo → tactical/hoodie character + the animation list in CLAUDE.md B1 (`crouch_idle`, `crouch_walk`, `vault`, `cover_idle`, `rifle_idle`, `rifle_aim_walk`, `sniper_aim`…) → merge in Blender → one .glb, same file name. Clip names are matched automatically; nothing in the code changes |
| ✅ | `public/audio/voice/` — 7 more lines | Generated with Microsoft Edge Neural TTS (ChristopherNeural, EricNeural, BrianNeural, GuyNeural) | All 8 voice lines from manifest.js installed (`m1` through `m8` + `end_clockmaker_01`) |
| ⬜ | `public/models/env/stadium.glb`, `city_block.glb`, `factory.glb`, `rooftop.glb`, `nightclub.glb` *(optional)* | Good ones are on **Sketchfab** (login needed) | Otherwise each level is built in code from the props + textures below (Phase 3 builds the stadium this way) |

### ⚠️ Voice licence note
`m1_commentator_01.mp3` was made with **Microsoft Edge "Read aloud" (GuyNeural)**. Microsoft's terms for that feature don't clearly grant the right to ship the audio inside a product. If the competition has prizes, the safe options are recording the lines yourself / with friends, or a TTS service whose plan explicitly includes commercial / game use.

---

## ✅ Downloaded by Claude (licence-checked, all credited in CREDITS.md)

### Characters — Quaternius (CC0), animated; clip names normalised (`idle`, `walk`, `run`, `gun_shoot`, `hit`, `death`…)
| ✓ | File | Model | Notes |
|---|---|---|---|
| ✅ | `characters/enemy.glb` | SWAT | Black tactical gear + mask. 24 clips: gun idle/aim/shoot, strafe runs, roll, hit, death |
| ✅ | `characters/elias.glb` | Worker | Overalls + hard hat |
| ✅ | `characters/mara.glb` | Animated Woman | Full gun set (24 clips); gets a long-coat recolour when her missions are built |
| ✅ | `characters/nurse.glb` | Animated Woman | Recoloured to scrubs in Phase 10 |
| ✅ | `characters/civilian.glb`, `civilian_f.glb` | Man, Woman Casual | 11 clips (idle, walk, run, sitting, clapping, death…) |
| ✅ | `characters/clockmaker.glb` | Man in Suit | Ending scene |

### Vehicles
| ✓ | File | Model | Licence |
|---|---|---|---|
| ✅ | `vehicles/car_2020_sedan.glb`, `suv.glb`, `truck.glb`, `police_car.glb` | Quaternius cars — separate wheels, recolourable for traffic | CC0 |
| ✅ | `vehicles/car_2020_sport.glb` | Nissan GT-R — Mission 7 chase car | CC-BY 3.0 (David Sirera) |

### Weapons — Quaternius (CC0)
✅ `pistol.glb` · ✅ `rifle.glb` (M4-style) · ✅ `sniper.glb`

#### Props — Quaternius (CC0) unless noted
✅ `barrel` · ✅ `barrel_explosive` (new: red hazard drum for FIRE) · ✅ `crate` · ✅ `street_lamp` · ✅ `traffic_light` · ✅ `dumpster` · ✅ `fire_hydrant` · ✅ `water_tower` · ✅ `ac_unit` · ✅ `radio` · ✅ `heart_monitor` (CreativeTrio, CC0) · ✅ `hospital_bed` (CreativeTrio, CC0) · ✅ `burnt_watch` (Poly by Google, CC-BY 3.0) · ✅ `env/hospital.glb` (furnished room incl. bed, GRADD CO, CC-BY 3.0) · ✅ `env/garage.glb` (Richard A, CC-BY 3.0)

### Textures — Poly Haven (CC0), re-encoded: 2K roads, 1K rest (50 MB → 7 MB)
✅ `asphalt` · ✅ `wet_asphalt` (made glossy in code) · ✅ `concrete` · ✅ `rusty_metal` · ✅ `burnt_wood` (weathered planks, charred tint in code) · ✅ `brick` · ✅ `charred` · ✅ `tiles`

### HDRIs — Poly Haven (CC0)
✅ `night_street_2k.hdr` (new: Cobblestone Street Night, for alleys) · ✅ `overcast_2k.hdr` (Potsdamer Platz). Your `night_city_2k.hdr` (Shanghai Bund) is unchanged.

### Music — Kevin MacLeod / incompetech.com (CC-BY 4.0), re-encoded 128 kbps
✅ `city_rain_2020.mp3` — "SCP-x6x (Hopes)" · ✅ `combat.mp3` — "Club Diver" · ✅ `reverse_chase.mp3` — "Industrial Cinematic" · ✅ `ending.mp3` — "Reawakening"

### Sound effects — BigSoundBank (CC0) + OpenGameArt (CC0); trimmed, normalised, loops made seamless
✅ `thunder` · ✅ `rain_heavy` (loop) · ✅ `siren` (loop) · ✅ `fire_loop` (loop) · ✅ `engine_2020` (loop) · ✅ `pistol_shot` · ✅ `rifle_shot` · ✅ `sniper_shot` · ✅ `reload` · ✅ `shell_casing` · ✅ `bullet_impact` · ✅ `reverse_whoosh` (Time Rewind) · ✅ `shadow_step` (dark swoosh) · ✅ `scifi_beep` (BigSoundBank CC0)

Spares in `asset_backups/candidates/` (not used): my layered `explosion` / `car_crash` / `glass_shatter`. **Yours are installed and were not touched.**

## Handled later in code (nothing to download)
- ✅ Footsteps: one step cut from BigSoundBank #1318 → `sfx/footstep_concrete.mp3` (Phase 5).
- ✅ `car_2050_rival_lite.glb` (58k triangles) generated in Phase 3 from your Ferrari, materials kept for the rival liveries.

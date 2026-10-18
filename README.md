# FLATLINE: 2050

*He crashed in the future. He woke up in the past. He has 72 heartbeats to find his way back.*

A cinematic 3D action/racing game that runs in the browser. Kael Rayne, the undefeated 2050 racing champion, crashes on the final lap and falls into a coma. He wakes up in 2020, the year his father died in a factory fire, and has to find the truth before his heart stops in the future.

## THE RUN — the 3-minute story run

**NEW GAME** starts THE RUN: Kael lies in a coma after the 2050 crash and runs through his dying memory, one act and one power at a time.

| Act | Where | Power you learn |
|---|---|---|
| I · ⏳ TIME | 2050 — the Neon Velodrome, the final lap and the ghosts of the crash | Time Stop |
| II · 🌑 SHADOWS | 2020 — rain-soaked rooftops, with Umbra running beside you | Shadow Phase |
| III · 🔥 FIRE | 20:20 — the burning factory, Victor and the gas can | Burn |

**The finale:** the powers fail. The only way forward is to walk into the fire (hold W), past Umbra, to Elias. Then flatline… beep… Kael wakes in 2050.

**The heart:** you start with **72 beats**, and the heart ticks one beat away every few seconds. Scraping an obstacle costs a little; a head-on crash costs more and **automatically rewinds time** a couple of seconds so you can try again. **Memory fragments** on the track restore beats and tell a piece of the story. At 0 beats: FLATLINE.

**The three powers** (each meter holds 3 charges, refilled by its coloured orbs):

| Power | Beats | Does not beat |
|---|---|---|
| ⏳ **Time Stop** | Anything that moves — chrono shutters, ghost cars, falling beams. Once frozen, it stays jammed | — |
| 🌑 **Shadow** | Lasers, enforcer squads, walls, blocks, cars — you pass through as smoke | Fire (the light burns shadows away) |
| 🔥 **Burn** | Anything physical — barricades, beams, squads, blocks | Lasers and chrono shutters |

### Runner controls

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Change lane | A / D or ← / → | Left stick left / right | Swipe left / right |
| Jump | W / ↑ / Space | Left stick up | Swipe up |
| Roll (in the air: slam down) | S / ↓ | Left stick down | Swipe down |
| ⏳ Time Stop | R | X | — |
| 🌑 Shadow | Q (or T) | RB | — |
| 🔥 Burn | E (or Shift) | Y | — |
| Pause | Esc | Start | — |
| Finale: walk into the fire | hold W | — | — |

Three themes are things you **play**, not just things you see:

| | 🔥 FIRE | 🌑 SHADOWS | ⏳ TIME |
|---|---|---|---|
| Driving | Burn boost, fire wake | Draft + Shadow Dash | Rewind the race (hold R) |
| On foot | Incendiary rounds, spreading fire, explosive barrels | Shoot out lights; Shadow Step through darkness; enemies can't see you in the dark | Rewind (hold R), steady aim, the 72-beat Heartbeat Meter |

## Run it

Requires [Node.js](https://nodejs.org) 18+.

```bash
npm install
npm run dev        # http://localhost:5290
```

Build a release and test it locally:

```bash
npm run build      # → dist/
npm run preview    # serves dist/ at http://localhost:5291
```

The `dist/` folder is a static site and can be uploaded to any web host.

> **Internet Download Manager users:** IDM intercepts `.mp3` files in the browser, so the game would be silent.
> In IDM: *Options → File types → "Don't start downloading automatically from the following sites"* → add `localhost`.

Best in Chrome or Edge. Graphics quality (Low / Medium / High), volumes, mouse sensitivity, invert Y, subtitles and difficulty are under **Settings**. Press **F3** to show FPS.

**Settings → Media** has two videos rendered live in the engine: **Watch Story Teaser** (≈ 90 s cinematic) and **Watch Gameplay (2 min)** (every mechanic, played by an autopilot, with key captions). Hold **Space** or press **Esc** to skip. Turn on **Record to video** first to save the video as a `.webm` file (the browser asks to share the tab — pick this tab and keep "Share tab audio" on).

## Controls

| Action | Keyboard / Mouse | Gamepad |
|---|---|---|
| Move | WASD | Left stick |
| Camera | Mouse (click to capture) | Right stick |
| Sprint | Shift | L3 |
| Jump / Vault | Space | A |
| Crouch | Ctrl / C | B |
| Roll | Alt | — |
| Aim / Shoot | Right / Left mouse | LT / RT |
| Reload | R (tap) | X |
| ⏳ Time Rewind | R (hold) — 3 beats | LB (hold) |
| 🌑 Shadow Step | T (hold, aim, release) — 2 beats | RB |
| 🔥 Incendiary rounds | V | Back |
| Steady aim (scope) | Shift — 1 beat | L3 |
| Cover | E | Y |
| Interact | F | D-pad down |
| Weapons | 1 / 2 / 3, mouse wheel | D-pad |
| Shoulder swap | Q | R3 |
| Scan (Mission 3) | G | — |
| Pause / leave | Esc | Start |
| **Driving** | W/S gas/brake · A/D steer · Space handbrake · Shift 🔥 Burn · T 🌑 Shadow Dash · hold R ⏳ Rewind · C look back · Backspace reset | RT / LT · left stick |
| Skip a cutscene | hold Space | — |
| Trailer mode | F9 on the main menu | — |

## Story missions (Mission Select) — 8 missions + ending

The full story campaign is still in the game under **Mission Select**.

1. **Last Lap** (2050, ⏳): the final lap, then the crash.
2. **Wake in the Rain** (🌑, tutorial): escape the police raid; Mara Voss gives chase.
3. **Ashes Speak** (🔥): scan the burnt factory for clues; it burns again.
4. **Sniper's Clock** (⏳): protect Mara from a water tower; fire in the thunder.
5. **The Man with My Face** (🌑, boss): Umbra, who can only be hurt in light.
6. **City on Fire** (🔥): carry eight civilians out of a burning district.
7. **Reverse Chase** (⏳ + driving): chase Victor while time runs backwards.
8. **Flatline** (all three): the factory at 20:20 — and a walk into the fire.

Then the ending, the credits and a post-credits scene. Each mission ends with a rank (S/A/B/C) from time, accuracy and heartbeats left. Achievements: *Undefeated, Ghost, Pyromaniac, Heart of Steel, Flatline*.

## Developer shortcuts (dev server only)

Add to the URL: `?run` (THE RUN) · `?m1` … `?m8` (jump into a mission) · `?ending` · `?trailer` · `?teaser` / `?reel` (the Media videos) · `?race` (free race) · `?foot` (on-foot sandbox: guns + abilities) · `?combat` (6-enemy combat test) · `?gallery` (every model) · `?unlock` (unlock all missions) · `?test` (renderer test scene).

## Project layout

`src/core` renderer, post-FX, physics, input, audio, time · `src/player` on-foot controller, animations, guns, Shadow Step · `src/vehicles` car physics, race, crash · `src/ai` enemies, Umbra, civilians, traffic · `src/systems` heartbeat, rewind, fire, lights, saves · `src/scenes` shared worlds · `src/missions` one file per mission · `src/cutscenes` cutscene engine + scripts · `src/ui` menus and HUD. Tunable numbers live in `src/config.js`; asset paths in `src/assets/manifest.js`.

Built with three.js, Rapier, postprocessing, three.quarks, Howler and GSAP. All third-party assets and their licences are listed in [CREDITS.md](CREDITS.md); assets still to be replaced are in [ASSETS_TODO.md](ASSETS_TODO.md).

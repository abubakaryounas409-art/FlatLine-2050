// =============================================================================
// FLATLINE: 2050 — missions/missionData.js
// The list of missions shown in Mission Select and on mission cards.
// Theme icons follow CLAUDE.md A3: 🔥 FIRE · 🌑 SHADOWS · ⏳ TIME.
// =============================================================================

export const THEME_ICONS = { FIRE: '🔥', SHADOWS: '🌑', TIME: '⏳', ALL: '🔥🌑⏳' };

// buildPhase: which CLAUDE.md phase builds the gameplay (shown on placeholders).
export const MISSIONS = [
  { number: 1, id: 'm1_lastLap',        name: 'Last Lap',             year: 2050, theme: 'TIME',    objective: 'Win the final lap of the World Grand Prix.', buildPhase: 'Phase 4' },
  { number: 2, id: 'm2_wakeInTheRain',  name: 'Wake in the Rain',     year: 2020, theme: 'SHADOWS', objective: 'Escape the police raid.', buildPhase: 'Phase 9.1' },
  { number: 3, id: 'm3_ashesSpeak',     name: 'Ashes Speak',          year: 2020, theme: 'FIRE',    objective: 'Search the burnt factory for the truth.', buildPhase: 'Phase 9.2' },
  { number: 4, id: 'm4_snipersClock',   name: "Sniper's Clock",       year: 2020, theme: 'TIME',    objective: "Protect Mara from Hale's enforcers.", buildPhase: 'Phase 9.3' },
  { number: 5, id: 'm5_manWithMyFace',  name: 'The Man with My Face', year: 2020, theme: 'SHADOWS', objective: 'Survive Umbra.', buildPhase: 'Phase 9.4' },
  { number: 6, id: 'm6_cityOnFire',     name: 'City on Fire',         year: 2020, theme: 'FIRE',    objective: 'Rescue the civilians before the district burns.', buildPhase: 'Phase 9.5' },
  { number: 7, id: 'm7_reverseChase',   name: 'Reverse Chase',        year: 2020, theme: 'TIME',    objective: 'Catch Victor while time runs backwards.', buildPhase: 'Phase 9.6' },
  { number: 8, id: 'm8_flatline',       name: 'Flatline',             year: 2020, theme: 'ALL',     objective: 'Stop running.', buildPhase: 'Phase 9.7' },
];

export function getMission(number) {
  return MISSIONS.find((m) => m.number === number);
}

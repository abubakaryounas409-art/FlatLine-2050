// =============================================================================
// FLATLINE: 2050 — systems/saveGame.js
// Story progress saved to localStorage (all access wrapped in try/catch).
// Phase 1: unlocked missions, current mission, "intro seen" flag.
// Phase 11 adds mid-mission checkpoints on top of this.
// =============================================================================

const STORAGE_KEY = 'flatline2050.save.v1';

const EMPTY_SAVE = {
  started: false,       // a New Game has been started → "Continue" is enabled
  currentMission: 1,
  unlockedMission: 1,   // highest mission number the player can select
  introSeen: false,     // after the first full boot intro, it becomes skippable
  checkpoint: null,     // Phase 11
  achievements: {},     // id → ISO date (Phase 11 shows them)
};

class SaveGame {
  constructor() {
    this.data = { ...EMPTY_SAVE, ...this._read() };

    // Dev helper: add ?unlock to the URL to unlock every mission.
    if (new URLSearchParams(location.search).has('unlock')) this.data.unlockedMission = 8;
  }

  _read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  _write() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch { /* storage blocked — progress lasts for this session only */ }
  }

  get hasProgress() {
    return this.data.started;
  }

  isUnlocked(missionNumber) {
    return missionNumber >= 1; // every mission is open in Mission Select (story order still saved in unlockedMission)
  }

  markIntroSeen() {
    if (this.data.introSeen) return;
    this.data.introSeen = true;
    this._write();
  }

  /** Reset story progress (keeps the intro flag). */
  newGame() {
    this.data = { ...EMPTY_SAVE, started: true, introSeen: this.data.introSeen };
    this._write();
  }

  unlockAchievement(id) {
    if (this.data.achievements?.[id]) return false;
    this.data.achievements = { ...(this.data.achievements ?? {}), [id]: new Date().toISOString() };
    this._write();
    return true;
  }

  startMission(number) {
    this.data.started = true;
    this.data.currentMission = number;
    this._write();
  }

  completeMission(number) {
    this.data.unlockedMission = Math.max(this.data.unlockedMission, Math.min(8, number + 1));
    this.data.currentMission = Math.min(8, number + 1);
    this.data.checkpoint = null;
    this._write();
  }
}

export const saveGame = new SaveGame();

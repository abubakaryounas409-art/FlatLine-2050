// =============================================================================
// FLATLINE: 2050 — ui/missionSelect.js
// Mission Select sub-screen: all 8 missions; locked ones show a lock.
// Unlocking is tracked by systems/saveGame.js (add ?unlock to the URL to test).
// =============================================================================

import { audio } from '../core/audio.js';
import { saveGame } from '../systems/saveGame.js';
import { MISSIONS, THEME_ICONS } from '../missions/missionData.js';
import { FocusList } from './menuNav.js';
import { buildPanel, buildBackRow } from './panel.js';

export class MissionSelectPanel {
  constructor({ onBack, onStart, onRun = null }) {
    this.onBack = onBack;
    this.onRun = onRun; // bonus mode THE RUN (always unlocked)
    this.onStart = onStart;
    const { el, body } = buildPanel('Memory archive', 'Mission Select', 'panel-missions');
    this.el = el;

    this.list = document.createElement('div');
    this.list.className = 'mission-list';
    body.append(this.list);
  }

  /** Rebuild every time it opens (unlocks may have changed). */
  open() {
    this.list.innerHTML = '';
    const rows = MISSIONS.map((m) => {
      const unlocked = saveGame.isUnlocked(m.number);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `panel-row mission-row theme-${m.theme.toLowerCase()}${unlocked ? '' : ' is-disabled'}`;
      row.setAttribute('aria-disabled', String(!unlocked));
      row.innerHTML = `
        <span class="mission-num">${String(m.number).padStart(2, '0')}</span>
        <span class="panel-row-label" data-text="${unlocked ? m.name : 'Locked'}">${unlocked ? m.name : 'Locked'}</span>
        <span class="mission-meta">${unlocked ? `${m.year} ${THEME_ICONS[m.theme]}` : '🔒'}</span>
        <span class="mission-obj">${unlocked ? m.objective : 'Finish the previous mission to remember this one.'}</span>`;
      row._mission = m;
      this.list.appendChild(row);
      return row;
    });
    if (this.onRun) {
      const run = document.createElement('button');
      run.type = 'button';
      run.className = 'panel-row mission-row theme-time';
      run.dataset.action = 'run';
      run.innerHTML = `
        <span class="mission-num">★</span>
        <span class="panel-row-label" data-text="Bonus · The Run">Bonus · The Run</span>
        <span class="mission-meta">⏳🌑🔥</span>
        <span class="mission-obj">A 3-act story runner through 2050 and 2020. Dodge, jump, roll — and use all three powers.</span>`;
      this.list.appendChild(run);
      rows.push(run);
    }
    const back = buildBackRow();
    this.list.appendChild(back);

    // The selected row expands to show its objective (CSS: .mission-row.is-selected .mission-obj).
    this.nav = new FocusList([...rows, back], {
      glitchSelector: '.panel-row-label',
      onActivate: (rowEl) => {
        audio.sfx('ui_click');
        if (rowEl.dataset.action === 'back') this.onBack();
        else if (rowEl.dataset.action === 'run') this.onRun();
        else this.onStart(rowEl._mission.number);
      },
    });

    const current = MISSIONS.findIndex((m) => m.number === saveGame.data.currentMission);
    this.nav.reset(Math.max(0, current));
  }

  handleKey(e) {
    if (e.code === 'Escape' || e.code === 'Backspace') {
      audio.sfx('ui_click', { volume: 0.7 });
      this.onBack();
      return true;
    }
    return this.nav.handleKey(e);
  }
}

// =============================================================================
// FLATLINE: 2050 — ui/panel.js
// Shared markup for menu sub-screens (Settings, Mission Select, Credits).
// A panel replaces the main list in the left column, so the car stays visible.
// =============================================================================

/**
 * @returns {{ el: HTMLElement, body: HTMLElement }}
 */
export function buildPanel(kicker, title, className = '') {
  const el = document.createElement('section');
  el.className = `menu-panel ${className}`;
  el.setAttribute('aria-label', title);
  el.innerHTML = `
    <header class="panel-head">
      <div class="panel-kicker">${kicker}</div>
      <h2 class="panel-title" data-text="${title}">${title}</h2>
    </header>
    <div class="panel-body"></div>
  `;
  return { el, body: el.querySelector('.panel-body') };
}

/** A "Back" row that participates in the panel's FocusList. */
export function buildBackRow(label = 'Back') {
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'panel-row panel-back';
  back.innerHTML = `<span class="panel-row-label" data-text="${label}">◂ ${label}</span>`;
  back.dataset.action = 'back';
  return back;
}

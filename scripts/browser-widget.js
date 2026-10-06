/*
 * browser-widget.js – La pastille du pont navigateur, posée sur la page.
 *
 * Quand le pont lit un onglet qui reste ouvert, il y dépose une petite
 * pastille : elle dit qu'une lecture a eu lieu ici, et un clic déroule ce qui
 * a été relevé sur ce site. Elle se déplace à la souris et se souvient de sa
 * place.
 *
 * Comme les relevés, ces fonctions sont sérialisées puis injectées : elles ne
 * peuvent rien utiliser qui vive hors de leur propre corps. Elles tournent
 * dans le monde isolé de l'extension, d'où l'accès à `chrome.storage`.
 *
 * La pastille vit dans un Shadow DOM : les styles de la page ne l'atteignent
 * pas, et les siens ne débordent pas. Les relevés et les captures l'ignorent
 * (voir `WIDGET_ID`).
 */

/** Identifiant de l'hôte. Répété en dur dans les fonctions injectées. */
export const WIDGET_ID = 'sorryidhmoney-bridge-widget';

/**
 * Pose ou met à jour la pastille.
 *
 * `state` : { host, busy, entries, onlyIfPresent }. `busy` est le nom de
 * l'action en cours, ou rien. `onlyIfPresent` met à jour sans créer.
 */
export async function renderWidget(state) {
  const ID = 'sorryidhmoney-bridge-widget';
  const POSITION_KEY = 'browserBridgeWidgetPosition';
  const SIZE = 40;
  const MARGIN = 6;
  const PANEL_WIDTH = 320;

  const LABELS = {
    read: 'Lecture',
    query: 'Éléments',
    screenshot: 'Capture',
    network: 'Réseau',
    inspect: 'Inspection',
    storage: 'Stockage',
    open: 'Ouverture',
  };

  let host = document.getElementById(ID);
  if (!host) {
    if (state.onlyIfPresent) return;

    let position = null;
    try {
      position = (await chrome.storage.local.get({ [POSITION_KEY]: null }))[POSITION_KEY];
    } catch {
      // Extension rechargée entre-temps : on se passe de la place mémorisée.
    }

    // Deux ordres peuvent arriver ensemble : le premier a pu créer l'hôte
    // pendant qu'on lisait la position.
    host = document.getElementById(ID);
    if (!host) {
      host = document.createElement('div');
      host.id = ID;
      host.attachShadow({ mode: 'open' });
      host.dataset.x = position ? position.x : window.innerWidth - SIZE - 20;
      host.dataset.y = position ? position.y : window.innerHeight - SIZE - 20;
      document.documentElement.appendChild(host);
    }
  }

  const root = host.shadowRoot;
  const entries = state.entries || [];

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const icon = (path, size) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shape.setAttribute('d', path);
    svg.appendChild(shape);
    return svg;
  };

  /** Place l'hôte, sans le laisser sortir de l'écran. */
  const place = (x, y) => {
    const clampedX = Math.min(Math.max(MARGIN, x), window.innerWidth - SIZE - MARGIN);
    const clampedY = Math.min(Math.max(MARGIN, y), window.innerHeight - SIZE - MARGIN);
    host.dataset.x = clampedX;
    host.dataset.y = clampedY;
    host.style.cssText =
      'all:initial;position:fixed;z-index:2147483647;width:0;height:0;'
      + `left:${clampedX}px;top:${clampedY}px;`
      + (host.dataset.hidden === '1' ? 'visibility:hidden;' : '');
  };

  const STYLE = `
    :host { color-scheme: light; }
    * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
    .pill {
      position: absolute; left: 0; top: 0; width: ${SIZE}px; height: ${SIZE}px;
      display: flex; align-items: center; justify-content: center;
      border: 0; border-radius: 50%; padding: 0; margin: 0;
      background: #805ad5; color: #fff; cursor: grab; touch-action: none;
      box-shadow: 0 3px 10px rgba(0, 0, 0, .28);
    }
    .pill:active { cursor: grabbing; }
    .pill:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .pill.failed { background: #c53030; }
    .pill.busy::after {
      content: ''; position: absolute; inset: 0; border-radius: 50%;
      box-shadow: 0 0 0 0 rgba(128, 90, 213, .6); animation: pulse 1.2s ease-out infinite;
    }
    @keyframes pulse { to { box-shadow: 0 0 0 14px rgba(128, 90, 213, 0); } }
    @media (prefers-reduced-motion: reduce) { .pill.busy::after { animation: none; } }
    .count {
      position: absolute; top: -4px; right: -4px; min-width: 17px; height: 17px; padding: 0 4px;
      border-radius: 999px; background: #fff; color: #553c9a;
      font-size: 10px; font-weight: 700; line-height: 17px; text-align: center;
      box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
    }
    .panel {
      position: absolute; width: ${PANEL_WIDTH}px; max-width: calc(100vw - 16px);
      background: #fff; color: #2d3748; border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, .28); overflow: hidden; font-size: 12px; line-height: 1.35;
    }
    .head { display: flex; align-items: center; gap: 6px; padding: 9px 8px 9px 12px; background: #f7f5fc; }
    .title { flex: 1; min-width: 0; }
    .title strong { display: block; font-size: 12.5px; }
    .title span { display: block; color: #718096; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tool {
      display: flex; align-items: center; justify-content: center; width: 26px; height: 26px;
      border: 0; border-radius: 6px; background: none; color: #4a5568; cursor: pointer; padding: 0;
    }
    .tool:hover { background: rgba(128, 90, 213, .14); color: #553c9a; }
    .busy-line { padding: 7px 12px; color: #553c9a; font-weight: 600; }
    .list { max-height: 300px; overflow-y: auto; margin: 0; padding: 4px 0; list-style: none; }
    .row { display: flex; gap: 8px; padding: 5px 12px; align-items: baseline; }
    .time { color: #a0aec0; font-size: 10.5px; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
    .what { flex: 1; min-width: 0; }
    .label { font-weight: 600; }
    .detail { color: #718096; overflow-wrap: anywhere; }
    .error { color: #c53030; overflow-wrap: anywhere; }
    .empty { padding: 14px 12px; color: #718096; }
  `;

  function draw() {
    const x = Number(host.dataset.x);
    const y = Number(host.dataset.y);
    place(x, y);

    const style = el('style');
    style.textContent = STYLE;

    const failed = entries[0] && !entries[0].ok;
    const pill = el('button', 'pill' + (state.busy ? ' busy' : '') + (failed ? ' failed' : ''));
    pill.type = 'button';
    pill.title = 'Pont navigateur – cliquer pour l\'historique, glisser pour déplacer';
    pill.setAttribute('aria-label', 'Pont navigateur : historique des lectures sur ce site');
    pill.setAttribute('aria-expanded', host.dataset.open === '1' ? 'true' : 'false');
    pill.appendChild(icon('M3 17h18M6 17v-7M18 17v-7M3 8c4 6 14 6 18 0', 20));
    if (entries.length) pill.appendChild(el('span', 'count', String(entries.length)));

    pill.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      const originX = Number(host.dataset.x);
      const originY = Number(host.dataset.y);
      let moved = false;
      pill.setPointerCapture(down.pointerId);

      const onMove = (move) => {
        const dx = move.clientX - down.clientX;
        const dy = move.clientY - down.clientY;
        // En deçà de quelques pixels c'est un clic qui tremble, pas un glissé.
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (moved) place(originX + dx, originY + dy);
      };

      const onUp = () => {
        pill.removeEventListener('pointermove', onMove);
        pill.removeEventListener('pointerup', onUp);
        pill.removeEventListener('pointercancel', onUp);
        if (moved) {
          try {
            chrome.storage.local.set({
              [POSITION_KEY]: { x: Number(host.dataset.x), y: Number(host.dataset.y) },
            });
          } catch {
            // Extension rechargée : la place ne sera pas retenue, rien de grave.
          }
        } else {
          host.dataset.open = host.dataset.open === '1' ? '' : '1';
        }
        draw();
      };

      pill.addEventListener('pointermove', onMove);
      pill.addEventListener('pointerup', onUp);
      pill.addEventListener('pointercancel', onUp);
    });

    // Au clavier : le glissé n'existe pas, mais l'historique doit s'ouvrir.
    pill.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      host.dataset.open = host.dataset.open === '1' ? '' : '1';
      draw();
    });

    const nodes = [style, pill];

    if (host.dataset.open === '1') {
      const panel = el('div', 'panel');
      // Le panneau s'ouvre vers le centre de l'écran, d'où que soit la pastille.
      panel.style.cssText =
        (x > window.innerWidth / 2 ? `right:${-SIZE}px;` : 'left:0;')
        + (y > window.innerHeight / 2 ? 'bottom:8px;' : `top:${SIZE + 8}px;`);

      const head = el('div', 'head');
      const title = el('div', 'title');
      title.appendChild(el('strong', '', 'Pont navigateur'));
      title.appendChild(el('span', '', state.host || location.hostname));
      head.appendChild(title);

      const full = el('button', 'tool');
      full.type = 'button';
      full.title = 'Ouvrir l\'historique complet';
      full.setAttribute('aria-label', 'Ouvrir l\'historique complet');
      full.appendChild(icon('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', 15));
      full.addEventListener('click', () => {
        try { chrome.runtime.sendMessage({ action: 'openBrowserBridge' }); } catch { /* extension rechargée */ }
      });
      head.appendChild(full);

      const dismiss = el('button', 'tool');
      dismiss.type = 'button';
      dismiss.title = 'Retirer la pastille de cette page';
      dismiss.setAttribute('aria-label', 'Retirer la pastille de cette page');
      dismiss.appendChild(icon('M6 6l12 12M18 6L6 18', 15));
      dismiss.addEventListener('click', () => host.remove());
      head.appendChild(dismiss);

      panel.appendChild(head);

      if (state.busy) {
        panel.appendChild(el('div', 'busy-line', `${LABELS[state.busy] || state.busy} en cours…`));
      }

      if (!entries.length) {
        panel.appendChild(el('div', 'empty', state.busy ? 'Première lecture sur ce site.' : 'Rien n\'a encore été lu sur ce site.'));
      } else {
        const list = el('ul', 'list');
        for (const entry of entries) {
          const row = el('li', 'row');
          row.appendChild(el('span', 'time', new Date(entry.at).toLocaleTimeString('fr-FR')));
          const what = el('div', 'what');
          what.appendChild(el('span', 'label', LABELS[entry.action] || entry.action));
          if (entry.summary) what.appendChild(el('span', '', ` · ${entry.summary}`));
          if (entry.detail) what.appendChild(el('div', 'detail', entry.detail));
          if (!entry.ok) what.appendChild(el('div', 'error', entry.error || 'échec'));
          row.appendChild(what);
          list.appendChild(row);
        }
        panel.appendChild(list);
      }

      nodes.push(panel);
    }

    root.replaceChildren(...nodes);
  }

  draw();
}

/** Cache ou remontre la pastille, le temps d'une capture. */
export function setWidgetHidden(hidden) {
  const host = document.getElementById('sorryidhmoney-bridge-widget');
  if (!host) return;
  host.dataset.hidden = hidden ? '1' : '';
  host.style.visibility = hidden ? 'hidden' : 'visible';
}

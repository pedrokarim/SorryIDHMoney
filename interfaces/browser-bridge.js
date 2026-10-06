/*
 * browser-bridge.js – Écran dédié au pont navigateur.
 *
 * Montre l'état du pont et le journal de ce qu'il a lu : quoi, sur quelle
 * page, avec quel résultat. Lecture seule lui aussi, à un bouton près : vider
 * le journal.
 */

const HISTORY_KEY = 'browserBridgeHistory';
const PAGE_SIZE = 15;
/** Une sonde dure au plus vingt secondes : au-delà, le pont n'est plus là. */
const LOST_AFTER_MS = 45000;

const LABELS = {
  read: 'Lecture',
  query: 'Éléments',
  screenshot: 'Capture',
  network: 'Réseau',
  inspect: 'Inspection',
  storage: 'Stockage',
  fetch: 'Requête',
  open: 'Ouverture',
  close: 'Fermeture',
  tabs: 'Onglets',
};

const view = { history: [], filter: '', search: '', page: 0, expanded: null };

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(ms) {
  const date = new Date(ms);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString('fr-FR');
  }
  return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

function renderStatus(enabled, lastContact) {
  const dot = $('bb-dot');
  const title = $('bb-status-title');
  const detail = $('bb-status-detail');

  if (!enabled) {
    dot.className = 'bb-dot';
    title.textContent = 'Module coupé';
    detail.textContent = 'Active-le dans les réglages pour que le pont réponde.';
    return;
  }

  const alive = Date.now() - lastContact < LOST_AFTER_MS;
  dot.className = 'bb-dot ' + (alive ? 'alive' : 'dead');
  title.textContent = alive ? 'Pont connecté' : 'Pont absent';
  detail.textContent = alive
    ? 'Le serveur local répond : un ordre part dans la seconde.'
    : lastContact
      ? `Dernier échange ${formatTime(lastContact)}. Le serveur local tourne-t-il ?`
      : 'Serveur local jamais vu. Lance-le avec la commande affichée dans les réglages.';
}

function renderStats() {
  const history = view.history;
  $('bb-n-total').textContent = history.length;
  $('bb-n-sites').textContent = new Set(history.map((entry) => entry.host).filter(Boolean)).size;
  $('bb-n-shots').textContent = history.filter((entry) => entry.action === 'screenshot' && entry.ok).length;
  $('bb-n-failed').textContent = history.filter((entry) => !entry.ok).length;
}

function matches(entry) {
  if (view.filter === 'failed' && entry.ok) return false;
  if (view.filter && view.filter !== 'failed' && entry.action !== view.filter) return false;
  if (!view.search) return true;
  const haystack = `${entry.url} ${entry.title} ${entry.detail} ${entry.error}`.toLowerCase();
  return haystack.includes(view.search.toLowerCase());
}

function shortPath(entry) {
  try {
    const url = new URL(entry.url);
    return url.pathname + url.search;
  } catch {
    return '';
  }
}

function renderDetail(entry) {
  const detail = el('div', 'bb-detail');
  const list = el('dl');

  const add = (term, value, className) => {
    if (!value) return;
    list.appendChild(el('dt', '', term));
    list.appendChild(el('dd', className, value));
  };

  if (entry.url) {
    list.appendChild(el('dt', '', 'Adresse'));
    const cell = el('dd');
    const link = el('a', '', entry.url);
    link.href = entry.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    cell.appendChild(link);
    list.appendChild(cell);
  }
  add('Page', entry.title);
  add('Cible', entry.detail);
  add('Résultat', entry.summary);
  add('Erreur', entry.error, 'error');
  add('Durée', `${(entry.durationMs / 1000).toFixed(1).replace('.', ',')} s`);
  detail.appendChild(list);

  if (entry.thumbnail) {
    const image = el('img');
    image.src = entry.thumbnail;
    image.alt = `Vignette de la capture de ${entry.host}`;
    detail.appendChild(image);
  }
  return detail;
}

function renderList() {
  const list = $('bb-list');
  const pager = $('bb-pager');
  list.replaceChildren();

  const visible = view.history.filter(matches);
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // Le journal a pu rétrécir (vidé, filtré) : on ne reste pas sur une page vide.
  view.page = Math.min(view.page, pages - 1);

  if (!visible.length) {
    list.appendChild(el('div', 'bb-empty', view.history.length
      ? 'Aucune ligne ne correspond à ce filtre.'
      : 'Rien n\'a encore été lu. Le journal se remplira au premier ordre reçu.'));
    pager.hidden = true;
    return;
  }

  for (const entry of visible.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE)) {
    const open = view.expanded === entry.id;

    const row = el('button', 'bb-row');
    row.type = 'button';
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
    row.appendChild(el('span', 'bb-time', formatTime(entry.at)));
    row.appendChild(el('span', 'bb-badge' + (entry.ok ? '' : ' failed'), LABELS[entry.action] || entry.action));

    const where = el('span', 'bb-where');
    where.appendChild(document.createTextNode(entry.host || '–'));
    const path = shortPath(entry);
    if (path && path !== '/') where.appendChild(el('em', '', path));
    row.appendChild(where);

    row.appendChild(el('span', 'bb-summary', entry.ok ? entry.summary : 'échec'));
    row.addEventListener('click', () => {
      view.expanded = open ? null : entry.id;
      renderList();
    });
    list.appendChild(row);

    if (open) list.appendChild(renderDetail(entry));
  }

  pager.hidden = pages <= 1;
  $('bb-page').textContent = `${view.page + 1} / ${pages}`;
  $('bb-prev').disabled = view.page === 0;
  $('bb-next').disabled = view.page >= pages - 1;
}

function refresh() {
  chrome.storage.sync.get({ enableBrowserBridge: false }, (cfg) => {
    chrome.storage.local.get({ [HISTORY_KEY]: [], browserBridgeLastContact: 0 }, (local) => {
      view.history = local[HISTORY_KEY];
      renderStatus(cfg.enableBrowserBridge, local.browserBridgeLastContact);
      renderStats();
      renderList();
    });
  });
}

$('bb-filter').addEventListener('change', (event) => {
  view.filter = event.target.value;
  view.page = 0;
  renderList();
});

$('bb-search').addEventListener('input', (event) => {
  view.search = event.target.value.trim();
  view.page = 0;
  renderList();
});

$('bb-prev').addEventListener('click', () => { view.page -= 1; renderList(); });
$('bb-next').addEventListener('click', () => { view.page += 1; renderList(); });

/*
 * Vider demande deux clics : le premier transforme le bouton en question, le
 * second efface. Sans réponse en trois secondes, le bouton redevient lui-même.
 */
(function setupClear() {
  const button = $('bb-clear');
  const icon = button.innerHTML;
  let armed = null;

  const disarm = () => {
    clearTimeout(armed);
    armed = null;
    button.classList.remove('confirm');
    button.innerHTML = icon;
  };

  button.addEventListener('click', () => {
    if (!armed) {
      if (!view.history.length) return;
      button.classList.add('confirm');
      button.textContent = 'Tout effacer ?';
      armed = setTimeout(disarm, 3000);
      return;
    }
    disarm();
    view.expanded = null;
    chrome.storage.local.set({ [HISTORY_KEY]: [] });
  });
})();

chrome.storage.onChanged.addListener((changes, zone) => {
  if (zone === 'local' && (HISTORY_KEY in changes || 'browserBridgeLastContact' in changes)) refresh();
  if (zone === 'sync' && 'enableBrowserBridge' in changes) refresh();
});

// L'état « connecté » se périme tout seul : on le réévalue même sans événement.
setInterval(refresh, 10000);
refresh();

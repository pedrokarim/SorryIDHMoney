/* ── Pas de saut à l'ouverture ─────────────────────────────────────────────
 *
 * Les panneaux « Publication X » et « Pont navigateur » dépendent de
 * `chrome.storage`, qui ne répond qu'après le premier affichage : la popup
 * s'ouvrait courte, puis s'allongeait d'un coup et tout descendait.
 *
 * On garde donc dans `localStorage` – synchrone, lui – le dernier rendu de
 * chaque bloc, et on le repose ici, avant que le navigateur ne dessine quoi
 * que ce soit. Les vraies valeurs arrivent ensuite et remplacent l'instantané,
 * presque toujours à l'identique.
 */
const SNAPSHOT_IDS = ['xposter-panel', 'nav-xposter', 'browser-bridge-panel', 'nav-browser-bridge', 'dev-link', 'twitch-summary'];
const SNAPSHOT_PREFIX = 'popupSnapshot:';

function saveSnapshot(id) {
  const node = document.getElementById(id);
  if (!node) return;
  try {
    localStorage.setItem(SNAPSHOT_PREFIX + id, JSON.stringify({
      hidden: node.hidden,
      html: node.innerHTML,
    }));
  } catch {
    // Stockage plein ou refusé : on retombe sur l'ancien comportement.
  }
}

(function restoreSnapshots() {
  for (const id of SNAPSHOT_IDS) {
    const node = document.getElementById(id);
    if (!node) continue;
    try {
      const snapshot = JSON.parse(localStorage.getItem(SNAPSHOT_PREFIX + id));
      if (!snapshot || typeof snapshot.hidden !== 'boolean') continue;
      node.hidden = snapshot.hidden;
      // Ce HTML vient de cette même page, à sa précédente ouverture.
      node.innerHTML = snapshot.html;
    } catch {
      // Instantané illisible : on l'ignore.
    }
  }
})();

const { el, icon, formatNumber } = window.UI;

function setBadge(node, kind, text) {
  node.className = 'badge' + (kind ? ' ' + kind : '');
  node.textContent = text;
}

/** Rafraîchit en continu tant que la popup reste ouverte. */
function live(refresh, everyMs = 3000) {
  refresh();
  const timer = setInterval(refresh, everyMs);
  window.addEventListener('pagehide', () => clearInterval(timer));
  chrome.storage.onChanged.addListener(refresh);
}

/* ── En-tête et pied ─────────────────────────────────────────────────────── */

const manifest = chrome.runtime.getManifest();
document.getElementById('version-tag').textContent = 'v' + manifest.version;

chrome.storage.sync.get({ developerMode: false }, ({ developerMode }) => {
  document.getElementById('dev-link').hidden = !developerMode;
  saveSnapshot('dev-link');
});

chrome.storage.local.get({ twitchRewardStats: null }, ({ twitchRewardStats }) => {
  const points = twitchRewardStats?.pointsCollected || 0;
  document.getElementById('twitch-summary').textContent = points
    ? `${formatNumber(points)} points récupérés`
    : 'Points de chaîne récupérés';
  saveSnapshot('twitch-summary');
});

/* ── Sur cet onglet ──────────────────────────────────────────────────────── */

/*
 * Les plateformes d'anime se reconnaissent aux motifs du manifeste : la
 * popup ne propose la correction de fiche que là où le script tourne.
 */
const PLATFORMS = {
  'scripts/mavanimes-content.js': { name: 'Mavanimes', key: null, icon: null },
  'scripts/voiranime-content.js': { name: 'Voiranime', key: 'enableVoiranime', icon: 'voiranime.png' },
  'scripts/crunchyroll-content.js': { name: 'Crunchyroll', key: 'enableCrunchyroll', icon: 'crunchyroll.png' },
  'scripts/adkami-content.js': { name: 'ADKami', key: 'enableAdkami', icon: 'adkami.png' },
  'scripts/adn-content.js': { name: 'ADN', key: 'enableAdn', icon: 'adn.webp' },
  'scripts/gumgum-content.js': { name: 'Gum Gum Streaming', key: 'enableGumgum', icon: 'gumgum.png' },
};

/** Motif de correspondance Chrome (`https://www.site.com/*`) → RegExp. */
function matchPatternToRegExp(pattern) {
  const [, scheme, host, path] = pattern.match(/^(\*|https?):\/\/([^/]+)(\/.*)$/) || [];
  if (!scheme) return null;
  const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const schemeRe = scheme === '*' ? 'https?' : scheme;
  const hostRe = host === '*' ? '[^/]+' : host.startsWith('*.') ? '(?:[^/]+\\.)?' + esc(host.slice(2)) : esc(host);
  const pathRe = esc(path).replace(/\*/g, '.*');
  return new RegExp(`^${schemeRe}://${hostRe}${pathRe}$`);
}

function findPlatform(url) {
  for (const script of manifest.content_scripts || []) {
    const js = (script.js || []).find((file) => PLATFORMS[file]);
    if (!js) continue;
    if ((script.matches || []).some((p) => matchPatternToRegExp(p)?.test(url))) return PLATFORMS[js];
  }
  return null;
}

function isXHost(host) {
  return host === 'x.com' || host === 'twitter.com'
    || host.endsWith('.x.com') || host.endsWith('.twitter.com');
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  if (!tab || !tab.url) return;
  let url;
  try { url = new URL(tab.url); } catch { return; }

  const section = document.getElementById('tab-section');
  document.getElementById('tab-host').textContent = url.hostname.replace(/^www\./, '');

  const platform = findPlatform(tab.url);
  if (platform) {
    section.hidden = false;
    document.getElementById('platform-card').hidden = false;
    document.getElementById('platform-name').textContent = platform.name;
    const img = document.getElementById('platform-icon');
    if (platform.icon) img.src = '../icons/platforms/' + platform.icon;
    else img.replaceWith(icon('tv'));

    const badge = document.getElementById('platform-state');
    if (platform.key) {
      chrome.storage.sync.get({ [platform.key]: true }, (cfg) => {
        setBadge(badge, cfg[platform.key] ? 'ok' : '', cfg[platform.key] ? 'Actif' : 'Coupé');
      });
    } else {
      setBadge(badge, 'ok', 'Actif');
    }

    document.getElementById('toggle-edit-mode').addEventListener('click', () => {
      chrome.tabs.sendMessage(tab.id, { action: 'toggleEditMode', enabled: true }, () => void chrome.runtime.lastError);
      window.close();
    });
  }

  if (isXHost(url.hostname)) {
    section.hidden = false;
    showXcomStatus(tab);
  }
});

/* Statut du contournement « contenu sensible » sur X. */
function showXcomStatus(tab) {
  const card = document.getElementById('xcom-status');
  const badge = document.getElementById('xcom-badge');
  const detail = document.getElementById('xcom-detail');
  const hooks = document.getElementById('xcom-hooks');
  card.hidden = false;

  chrome.tabs.sendMessage(tab.id, { action: 'getXcomStatus' }, (res) => {
    hooks.replaceChildren();
    if (chrome.runtime.lastError || !res) {
      setBadge(badge, '', 'Indisponible');
      detail.textContent = 'Recharge la page X pour activer le suivi.';
      return;
    }
    if (!res.moduleEnabled) {
      setBadge(badge, '', 'Coupé');
      detail.textContent = 'Module désactivé dans les paramètres.';
      return;
    }
    if (!res.active) {
      setBadge(badge, 'warn', 'En attente');
      detail.textContent = 'Chargement de la page…';
      return;
    }
    const ok = res.status === 'ok';
    setBadge(badge, ok ? 'ok' : 'err', ok ? 'Actif' : 'Erreur');
    detail.textContent = ok ? 'Les publications masquées sont dévoilées.' : 'Un point d’accroche a échoué.';
    const list = res.hooks && res.hooks.length ? res.hooks : ['__INITIAL_STATE__', 'Object.assign', 'JSON.parse'];
    hooks.replaceChildren(...list.map((name) => {
      const li = el('li');
      li.append(el('span', 'dot ok'), el('span', 'mono truncate', name));
      return li;
    }));
  });
}

/* ── Publication X : état du pont et dernières publications ────────────────
 *
 * Le panneau reste caché si le module est décoché : une extension qui affiche
 * en permanence des rubriques inactives finit par ne plus rien dire.
 *
 * « Connecté » se déduit de la date du dernier échange réussi, pas d'un
 * booléen : si le serveur local s'arrête sans prévenir, un booléen resterait
 * à vrai. Au-delà de deux tours de sonde sans nouvelles, le pont est tombé.
 */
(function xposterPanel() {
  const LOST_AFTER_MS = 150000; // 2 tours de sonde + marge
  // Les valeurs d'`etat` sont celles du stockage (module XPoster).
  const STATES = {
    'en attente': ['warn', 'programmé'],
    prepare: ['ok', 'préparé'],
    publie: ['ok', 'publié'],
    echec: ['err', 'échec'],
    manquee: ['err', 'manquée'],
    'confie a X': ['ok', 'chez X'],
  };

  const formatWhen = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  function render(cfg, local) {
    const panel = document.getElementById('xposter-panel');
    document.getElementById('nav-xposter').hidden = !cfg.enableXPoster;
    panel.hidden = !cfg.enableXPoster;
    if (cfg.enableXPoster) {
      // Relus à chaque rendu : l'instantané reposé à l'ouverture a remplacé
      // le contenu du panneau, les nœuds d'avant n'existent plus.
      const badge = document.getElementById('xposter-badge');
      const summary = document.getElementById('xposter-summary');
      const recent = document.getElementById('xposter-recent');

      const contact = local.xposterDernierContact || 0;
      const alive = Date.now() - contact < LOST_AFTER_MS;
      setBadge(badge, alive ? 'ok' : 'err', alive ? 'Pont connecté' : 'Pont absent');

      const queue = local.xposterFile || [];
      const waiting = queue.filter((p) => p.etat === 'en attente');
      summary.textContent = alive
        ? `${waiting.length} en attente · dernier échange ${formatWhen(contact)}`
        : contact
          ? `Hors ligne · dernier échange ${formatWhen(contact)}`
          : 'Jamais connecté – le serveur local tourne-t-il ?';

      const latest = [...queue]
        .sort((a, b) => (b.execute || b.quand || 0) - (a.execute || a.quand || 0))
        .slice(0, 4);
      recent.replaceChildren(...latest.map((p) => {
        const [kind, label] = STATES[p.etat] || ['', p.etat];
        const li = el('li');
        li.title = `${formatWhen(p.execute || p.quand)}${p.rapport?.erreur ? ' – ' + p.rapport.erreur : ''}`;
        li.append(el('span', 'badge ' + kind, label), el('span', 'truncate', (p.texte || '').replace(/\s+/g, ' ') || '(sans texte)'));
        return li;
      }));
      if (!latest.length) recent.replaceChildren(el('li', 'muted', 'Aucune publication.'));
    }
    saveSnapshot('xposter-panel');
    saveSnapshot('nav-xposter');
  }

  live(() => {
    chrome.storage.sync.get({ enableXPoster: false }, (cfg) => {
      chrome.storage.local.get({ xposterDernierContact: 0, xposterFile: [] }, (local) => render(cfg, local));
    });
  });
})();

/* ── Pont navigateur : état du pont et dernières lectures ──────────────────
 *
 * Même logique que le panneau de publication : caché si le module est coupé,
 * « connecté » déduit de la date du dernier échange. Une sonde dure au plus
 * vingt secondes, d'où un seuil bien plus court que pour la publication X.
 */
(function browserBridgePanel() {
  const LOST_AFTER_MS = 45000;
  const LABELS = {
    read: 'lecture', query: 'éléments', screenshot: 'capture', network: 'réseau',
    inspect: 'inspection', storage: 'stockage', fetch: 'requête', open: 'ouverture',
    close: 'fermeture', tabs: 'onglets',
  };
  const formatTime = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  function render(cfg, local) {
    const panel = document.getElementById('browser-bridge-panel');
    document.getElementById('nav-browser-bridge').hidden = !cfg.enableBrowserBridge;
    panel.hidden = !cfg.enableBrowserBridge;
    if (cfg.enableBrowserBridge) {
      const badge = document.getElementById('browser-bridge-badge');
      const summary = document.getElementById('browser-bridge-summary');
      const recent = document.getElementById('browser-bridge-recent');

      const alive = Date.now() - local.browserBridgeLastContact < LOST_AFTER_MS;
      setBadge(badge, alive ? 'ok' : '', alive ? 'Pont connecté' : 'Pont absent');

      const history = local.browserBridgeHistory;
      summary.textContent = history.length
        ? `${history.length} ordre(s) au journal · dernier à ${formatTime(history[0].at)}`
        : "Aucune lecture pour l'instant.";

      recent.replaceChildren(...history.slice(0, 4).map((entry) => {
        const li = el('li');
        li.title = entry.ok ? entry.summary : entry.error;
        li.append(
          el('span', 'badge ' + (entry.ok ? 'ok' : 'err'), LABELS[entry.action] || entry.action),
          el('span', 'truncate', entry.host || '–'),
        );
        return li;
      }));
    }
    saveSnapshot('browser-bridge-panel');
    saveSnapshot('nav-browser-bridge');
  }

  live(() => {
    chrome.storage.sync.get({ enableBrowserBridge: false }, (cfg) => {
      chrome.storage.local.get({ browserBridgeLastContact: 0, browserBridgeHistory: [] }, (local) => render(cfg, local));
    });
  });
})();

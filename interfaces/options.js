/*
 * Paramètres de l'extension.
 *
 * Chaque contrôle écrit dans `chrome.storage.sync` dès qu'il change : pas de
 * bouton « Enregistrer ». Les clés de stockage sont celles d'origine – les
 * content scripts et le service worker les lisent telles quelles.
 */

const $ = (id) => document.getElementById(id);
const { el, icon, flash } = window.UI;

const DEFAULTS = {
  theme: 'auto',
  enableToasts: true,
  enableMal: true,
  enableAnilist: true,
  disableAnimeSwitcherAnimations: false,
  enableVoiranime: true,
  enableCrunchyroll: true,
  enableAdkami: true,
  enableAdn: true,
  enableGumgum: true,
  enableTwitchRewards: true,
  enableYoutubeShortsAutoscroll: false,
  youtubeShortsReplayCount: 0,
  youtubeShortsScrollDelay: 0,
  enableYoutubeSmoothPlayback: true,
  enableAgeVerifBypass: true,
  enableAvbReddit: true,
  enableAvbAliexpress: true,
  enableAvbBsky: true,
  enableAvbXcom: true,
  enableAvbXcomIndicator: false,
  enableAvbAgechecker: true,
  enableAvbAgego: true,
  enableAvbAgeverif: true,
  enableAvbVeriff: true,
  enableXPoster: false,
  xposterAutoriserPublication: false,
  xposterPort: 8787,
  xposterToken: '',
  xposterModeProgrammation: 'extension',
  xposterComptes: [],
  enableBrowserBridge: false,
  browserBridgePort: 8788,
  browserBridgeToken: '',
  browserBridgeBlockedSites: [],
  browserBridgeShowWidget: true,
  browserBridgeAllowDebugger: false,
  browserBridgeAllowStorage: false,
  developerMode: false,
};

/** Cases simples : identifiant de la case → clé de réglage. */
const SIMPLE_SWITCHES = {
  'enable-toasts': 'enableToasts',
  'enable-voiranime': 'enableVoiranime',
  'enable-crunchyroll': 'enableCrunchyroll',
  'enable-adkami': 'enableAdkami',
  'enable-adn': 'enableAdn',
  'enable-gumgum': 'enableGumgum',
  'enable-yt-smooth-playback': 'enableYoutubeSmoothPlayback',
  'enable-avb-reddit': 'enableAvbReddit',
  'enable-avb-aliexpress': 'enableAvbAliexpress',
  'enable-avb-bsky': 'enableAvbBsky',
  'enable-avb-xcom': 'enableAvbXcom',
  'enable-avb-xcom-indicator': 'enableAvbXcomIndicator',
  'enable-avb-agechecker': 'enableAvbAgechecker',
  'enable-avb-agego': 'enableAvbAgego',
  'enable-avb-ageverif': 'enableAvbAgeverif',
  'enable-avb-veriff': 'enableAvbVeriff',
  'enable-xposter': 'enableXPoster',
  'xposter-allow-publish': 'xposterAutoriserPublication',
  'browser-bridge-show-widget': 'browserBridgeShowWidget',
  'browser-bridge-allow-debugger': 'browserBridgeAllowDebugger',
  'browser-bridge-allow-storage': 'browserBridgeAllowStorage',
};

const AVB_SITES = ['reddit', 'aliexpress', 'bsky', 'xcom', 'agechecker', 'agego', 'ageverif', 'veriff'];

/** Prévient l'onglet actif ; sans content script pour répondre, on ignore. */
function notifyActiveTab(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, message, () => void chrome.runtime.lastError);
  });
}

/* ── Sections repliables : l'état ouvert/fermé est retenu par appareil ───── */

const GROUPS_KEY = 'sorryidhmoney:optionsOpenGroups';

(function rememberGroups() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(GROUPS_KEY)); } catch { saved = null; }
  const groups = document.querySelectorAll('details.group[data-group]');
  if (saved && typeof saved === 'object') {
    for (const group of groups) {
      if (group.dataset.group in saved) group.open = !!saved[group.dataset.group];
    }
  }
  for (const group of groups) {
    group.addEventListener('toggle', () => {
      const state = {};
      for (const g of groups) state[g.dataset.group] = g.open;
      try { localStorage.setItem(GROUPS_KEY, JSON.stringify(state)); } catch { /* sans mémoire */ }
    });
  }
})();

/* ── Chargement ──────────────────────────────────────────────────────────── */

chrome.storage.sync.get(DEFAULTS, (items) => {
  $('theme').value = ['auto', 'light', 'dark'].includes(items.theme) ? items.theme : 'auto';

  for (const [id, key] of Object.entries(SIMPLE_SWITCHES)) $(id).checked = items[key];

  $('enable-mal').checked = items.enableMal;
  $('enable-anilist').checked = items.enableAnilist;
  $('switcher-animations').checked = !items.disableAnimeSwitcherAnimations;
  $('enable-twitch-rewards').checked = items.enableTwitchRewards;

  $('enable-yt-shorts-autoscroll').checked = items.enableYoutubeShortsAutoscroll;
  $('yt-shorts-replay-count').value = items.youtubeShortsReplayCount;
  $('yt-shorts-scroll-delay').value = items.youtubeShortsScrollDelay;

  $('enable-age-verif-bypass').checked = items.enableAgeVerifBypass;
  reflectAvbMaster();

  $('xposter-schedule-mode').value = items.xposterModeProgrammation;
  $('xposter-port').value = items.xposterPort;
  $('xposter-token').value = items.xposterToken;
  accounts = items.xposterComptes || [];
  renderAccounts();
  showXposterCommand();

  $('enable-browser-bridge').checked = items.enableBrowserBridge;
  $('browser-bridge-port').value = items.browserBridgePort;
  $('browser-bridge-token').value = items.browserBridgeToken;
  blockedSites = items.browserBridgeBlockedSites || [];
  renderBlockedSites();
  showBridgeCommand();
  refreshBridgeStatus();

  $('developer-mode').checked = items.developerMode;
  reflectDeveloperMode();
});

// Réglages abandonnés (couleur de fond, censure) : ils n'étaient lus nulle part.
chrome.storage.sync.remove(['backgroundColor', 'censure']);

/* ── Écouteurs simples ───────────────────────────────────────────────────── */

for (const [id, key] of Object.entries(SIMPLE_SWITCHES)) {
  $(id).addEventListener('change', (e) => chrome.storage.sync.set({ [key]: e.target.checked }));
}

$('theme').addEventListener('change', (e) => chrome.storage.sync.set({ theme: e.target.value }));

/* ── Animes ──────────────────────────────────────────────────────────────── */

$('enable-mal').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enableMal: e.target.checked });
  notifyActiveTab({ action: 'updateAnimeSwitcher', type: 'mal', enabled: e.target.checked });
});

$('enable-anilist').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enableAnilist: e.target.checked });
  notifyActiveTab({ action: 'updateAnimeSwitcher', type: 'anilist', enabled: e.target.checked });
});

$('switcher-animations').addEventListener('change', (e) => {
  chrome.storage.sync.set({ disableAnimeSwitcherAnimations: !e.target.checked });
  notifyActiveTab({ action: 'updateAnimeSwitcher', type: 'animations', enabled: e.target.checked });
});

/* ── Twitch ──────────────────────────────────────────────────────────────── */

$('enable-twitch-rewards').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enableTwitchRewards: e.target.checked });
  notifyActiveTab({ action: 'updateTwitchRewards', enabled: e.target.checked });
});

/* ── YouTube Shorts : prévient tous les onglets Shorts ouverts ───────────── */

function sendShortsUpdate(payload) {
  chrome.tabs.query({ url: ['https://www.youtube.com/shorts/*', 'https://m.youtube.com/shorts/*'] }, (tabs) => {
    for (const tab of tabs || []) {
      chrome.tabs.sendMessage(tab.id, { action: 'updateYoutubeShortsAutoscroll', ...payload }, () => void chrome.runtime.lastError);
    }
  });
}

$('enable-yt-shorts-autoscroll').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enableYoutubeShortsAutoscroll: e.target.checked });
  sendShortsUpdate({ enabled: e.target.checked });
});

function bindClampedNumber(id, key, min, max) {
  $(id).addEventListener('change', (e) => {
    const value = Math.max(min, Math.min(max, parseInt(e.target.value, 10) || 0));
    e.target.value = value;
    chrome.storage.sync.set({ [key]: value });
    sendShortsUpdate({ config: { [key]: value } });
  });
}

bindClampedNumber('yt-shorts-replay-count', 'youtubeShortsReplayCount', 0, 50);
bindClampedNumber('yt-shorts-scroll-delay', 'youtubeShortsScrollDelay', 0, 10000);

/* ── Vérification d'âge ──────────────────────────────────────────────────
 *
 * Persistance seulement : avb-manager (service worker) écoute
 * storage.onChanged et réapplique règles DNR et injections. Les scripts DOM
 * (Reddit, AliExpress) prennent effet au prochain chargement de page.
 */

function setRowDisabled(input, disabled) {
  input.disabled = disabled;
  input.closest('.row')?.classList.toggle('is-disabled', disabled);
}

function reflectAvbMaster() {
  const master = $('enable-age-verif-bypass').checked;
  for (const site of AVB_SITES) setRowDisabled($(`enable-avb-${site}`), !master);
  // La pastille X n'a de sens que si le module ET le contournement X sont actifs.
  setRowDisabled($('enable-avb-xcom-indicator'), !(master && $('enable-avb-xcom').checked));
}

$('enable-age-verif-bypass').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enableAgeVerifBypass: e.target.checked });
  reflectAvbMaster();
});
$('enable-avb-xcom').addEventListener('change', reflectAvbMaster);

/* ── Jetons des ponts locaux ─────────────────────────────────────────────
 *
 * `crypto.getRandomValues` et non `Math.random` : ce jeton est la seule chose
 * qui sépare un navigateur connecté d'un port ouvert sur la machine. 24
 * octets en base 36 suffisent pour un service qui n'écoute que sur 127.0.0.1.
 */
function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

async function copyField(field, button) {
  if (!field.value) { flash(button, 'Vide'); return; }
  try {
    await navigator.clipboard.writeText(field.value);
    flash(button, 'Copié');
  } catch {
    // Presse-papiers refusé : on sélectionne, l'utilisateur fait Ctrl+C.
    field.select();
    flash(button, 'Ctrl+C');
  }
}

/** Un port hors plage couperait le pont sans rien dire : on remet l'ancien. */
function bindPort(id, key, fallback, onValid) {
  $(id).addEventListener('change', (e) => {
    const port = parseInt(e.target.value, 10);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      chrome.storage.sync.get({ [key]: fallback }, (i) => { e.target.value = i[key]; });
      return;
    }
    chrome.storage.sync.set({ [key]: port });
    onValid();
  });
}

/* ── Publication X ───────────────────────────────────────────────────────── */

function showXposterCommand() {
  const token = $('xposter-token').value;
  $('xposter-command').textContent = token
    ? `node tools/xposter-server.js --token ${token} --port ${$('xposter-port').value}`
    : 'Génère un jeton pour obtenir la commande.';
}

$('xposter-generate').addEventListener('click', function () {
  const token = generateToken();
  $('xposter-token').value = token;
  chrome.storage.sync.set({ xposterToken: token });
  showXposterCommand();
  flash(this, 'Généré');
});

$('xposter-copy').addEventListener('click', function () { copyField($('xposter-token'), this); });
$('xposter-port').addEventListener('input', showXposterCommand);
bindPort('xposter-port', 'xposterPort', 8787, showXposterCommand);

$('xposter-schedule-mode').addEventListener('change', (e) => {
  chrome.storage.sync.set({ xposterModeProgrammation: e.target.value });
});

/*
 * Comptes autorisés. Le garde-fou manquait, et ça s'est vu : une publication
 * est partie du mauvais compte parce que le navigateur y était connecté.
 *
 * La liste stocke des identifiants numériques quand on peut les obtenir (ils
 * ne bougent pas quand un compte est renommé) et accepte les pseudos sinon.
 * Le pseudo reste à côté pour l'affichage. Liste vide = aucun filtre, mais on
 * le dit clairement sous le champ.
 */
let accounts = [];

function saveAccounts() {
  chrome.storage.sync.set({ xposterComptes: accounts });
  renderAccounts();
}

function renderAccounts() {
  const list = $('xposter-accounts');
  list.replaceChildren(...accounts.map((account, index) => {
    const item = el('div', 'tag-item');
    // textContent : ces valeurs viennent d'une saisie libre.
    const accountLabel = account.pseudo ? `@${account.pseudo} · ${account.id}` : account.id;
    const accountText = el('span', '', accountLabel);
    accountText.title = accountLabel;
    item.appendChild(accountText);
    const remove = el('button', 'icon-btn icon-btn-sm danger');
    remove.type = 'button';
    remove.title = 'Retirer';
    remove.setAttribute('aria-label', 'Retirer ' + (account.pseudo || account.id));
    remove.appendChild(icon('x', 'i-sm'));
    remove.addEventListener('click', () => { accounts.splice(index, 1); saveAccounts(); });
    item.appendChild(remove);
    return item;
  }));

  const note = $('xposter-accounts-note');
  note.classList.toggle('warn', !accounts.length);
  note.textContent = accounts.length
    ? `${accounts.length} compte(s) autorisé(s). Une publication depuis un autre compte est refusée avant d'écrire quoi que ce soit.`
    : 'Liste vide : aucune vérification. La publication partira du compte connecté, quel qu’il soit.';
}

function addAccount(entry) {
  const value = String(entry.id || '').replace(/^@/, '').trim();
  if (!value || accounts.some((a) => a.id === value)) return;
  accounts.push({ id: value, pseudo: entry.pseudo || null });
  saveAccounts();
}

const accountInput = $('xposter-account-input');
$('xposter-account-add').addEventListener('click', () => {
  addAccount({ id: accountInput.value });
  accountInput.value = '';
});
accountInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('xposter-account-add').click(); }
});

$('xposter-account-detect').addEventListener('click', async function () {
  const note = $('xposter-accounts-note');
  this.disabled = true;
  try {
    const tabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
    if (!tabs.length) { note.textContent = 'Aucun onglet X ouvert – ouvre x.com puis réessaie.'; return; }
    // Le premier onglet qui répond fait foi ; les autres n'ont peut-être pas
    // encore leur script en place.
    for (const tab of tabs) {
      try {
        const r = await chrome.tabs.sendMessage(tab.id, { action: 'xposterCompte' });
        if (r && r.id) { addAccount({ id: r.id, pseudo: r.pseudo }); return; }
      } catch { /* onglet muet : on passe au suivant */ }
    }
    note.textContent = 'Compte introuvable – la session X est-elle ouverte dans cet onglet ?';
  } finally {
    this.disabled = false;
  }
});

/* ── Pont navigateur ─────────────────────────────────────────────────────
 *
 * Même porte d'entrée que la publication X : une case, un port, un jeton.
 * S'y ajoute la liste des sites bannis, que le pont n'ouvre, ne lit et ne
 * liste jamais – c'est l'extension qui l'applique, pas l'outil qui demande.
 */
let blockedSites = [];

/** Ramène une saisie libre (« https://www.Exemple.fr/page ») à un nom d'hôte. */
function normalizeSite(entry) {
  const raw = String(entry || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : 'https://' + raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function showBridgeCommand() {
  const token = $('browser-bridge-token').value;
  $('browser-bridge-command').textContent = token
    ? `node tools/browser-server.js --token ${token} --port ${$('browser-bridge-port').value}`
    : 'Génère un jeton pour obtenir la commande.';
}

/**
 * « Connecté » se déduit de la date du dernier échange réussi : un booléen
 * resterait à vrai si le serveur s'arrêtait sans prévenir. Une sonde dure au
 * plus vingt secondes, d'où le seuil.
 */
function refreshBridgeStatus() {
  chrome.storage.local.get({ browserBridgeLastContact: 0 }, ({ browserBridgeLastContact: contact }) => {
    const status = $('browser-bridge-status');
    if (!$('enable-browser-bridge').checked) status.textContent = 'Coupé';
    else if (Date.now() - contact < 45000) status.textContent = 'Pont connecté';
    else if (contact) status.textContent = 'Pont absent · dernier échange ' + new Date(contact).toLocaleString('fr-FR');
    else status.textContent = 'Pont absent · serveur jamais vu';
  });
}

chrome.storage.onChanged.addListener((changes, zone) => {
  if (zone === 'local' && 'browserBridgeLastContact' in changes) refreshBridgeStatus();
});
setInterval(refreshBridgeStatus, 15000);

function renderBlockedSites() {
  $('browser-bridge-blocked').replaceChildren(...blockedSites.map((site, index) => {
    const item = el('div', 'tag-item');
    const siteText = el('span', '', site);
    siteText.title = site;
    item.appendChild(siteText);
    const remove = el('button', 'icon-btn icon-btn-sm danger');
    remove.type = 'button';
    remove.title = 'Retirer ' + site;
    remove.setAttribute('aria-label', 'Retirer ' + site);
    remove.appendChild(icon('x', 'i-sm'));
    remove.addEventListener('click', () => { blockedSites.splice(index, 1); saveBlockedSites(); });
    item.appendChild(remove);
    return item;
  }));
  $('browser-bridge-blocked-note').textContent = blockedSites.length
    ? `${blockedSites.length} site(s) banni(s), sous-domaines compris.`
    : 'Liste vide : le pont peut lire tous les sites.';
}

function saveBlockedSites() {
  chrome.storage.sync.set({ browserBridgeBlockedSites: blockedSites });
  renderBlockedSites();
}

const blockedInput = $('browser-bridge-blocked-input');
$('browser-bridge-blocked-add').addEventListener('click', function () {
  const site = normalizeSite(blockedInput.value);
  if (!site) { flash(this, 'Invalide'); return; }
  if (!blockedSites.includes(site)) {
    blockedSites.push(site);
    blockedSites.sort();
    saveBlockedSites();
  }
  blockedInput.value = '';
});
blockedInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('browser-bridge-blocked-add').click(); }
});

$('enable-browser-bridge').addEventListener('change', (e) => {
  chrome.storage.sync.set({ enableBrowserBridge: e.target.checked });
  refreshBridgeStatus();
});

$('browser-bridge-generate').addEventListener('click', function () {
  const token = generateToken();
  $('browser-bridge-token').value = token;
  chrome.storage.sync.set({ browserBridgeToken: token });
  showBridgeCommand();
  flash(this, 'Généré');
});

$('browser-bridge-copy').addEventListener('click', function () { copyField($('browser-bridge-token'), this); });
bindPort('browser-bridge-port', 'browserBridgePort', 8788, showBridgeCommand);

/* ── Mode développeur ────────────────────────────────────────────────────── */

function reflectDeveloperMode() {
  $('dev-tools-group').hidden = !$('developer-mode').checked;
}

$('developer-mode').addEventListener('change', (e) => {
  chrome.storage.sync.set({ developerMode: e.target.checked });
  reflectDeveloperMode();
});

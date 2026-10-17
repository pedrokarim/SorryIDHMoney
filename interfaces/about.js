const $ = (id) => document.getElementById(id);
const { el, icon, setStat, flash } = window.UI;

/* Libellés lisibles des permissions du manifeste. */
const PERMISSION_LABELS = {
  storage: ['database', 'Enregistrer les réglages et le cache'],
  unlimitedStorage: ['database', 'Stockage local sans limite de taille'],
  activeTab: ['link', "Agir sur l'onglet ouvert à la demande"],
  scripting: ['code', 'Ajouter les boutons sur les sites'],
  declarativeNetRequest: ['shield', 'Contourner les vérifications d’âge'],
  alarms: ['clock', 'Programmer les publications'],
  tabs: ['list', 'Lire l’adresse des onglets'],
  debugger: ['wrench', 'Débogueur du pont navigateur (si autorisé)'],
};

const manifest = chrome.runtime.getManifest();
$('extension-version').textContent = 'v' + manifest.version;
if (manifest.author) $('extension-author').textContent = manifest.author;
$('current-year').textContent = new Date().getFullYear();

const permissions = [...(manifest.permissions || []), ...(manifest.host_permissions || []).map(() => 'hosts')];
$('permissions-list').replaceChildren(...[...new Set(permissions)].map((permission) => {
  const [iconName, label] = permission === 'hosts'
    ? ['external', 'Accès aux sites visités']
    : PERMISSION_LABELS[permission] || ['info', permission];
  const row = el('div', 'row');
  const badge = el('span', 'row-icon');
  badge.appendChild(icon(iconName));
  const text = el('span', 'row-text');
  text.append(el('span', 'row-label wrap', label), el('span', 'row-desc mono', permission === 'hosts' ? '<all_urls>' : permission));
  row.append(badge, text);
  return row;
}));

// Avatar indisponible (hors ligne) : on retombe sur la marque.
$('github-avatar').addEventListener('error', function () {
  this.src = '../icons/brand/icon.svg';
}, { once: true });

/* Chiffres */
chrome.storage.local.get({ animeCache_v2: null, twitchRewardStats: null }, ({ animeCache_v2: cache, twitchRewardStats }) => {
  setStat($('total-animes'), Object.keys(cache?.customUrls || {}).length);
  setStat($('twitch-points'), twitchRewardStats?.pointsCollected);
  setStat($('twitch-clicks'), twitchRewardStats?.clickCount);
});

/* Dates d'installation et de mise à jour */
chrome.storage.local.get(['installDate', 'lastUpdateDate'], (result) => {
  const now = Date.now();
  const formatDate = (ms) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const installDate = result.installDate || now;
  if (!result.installDate) chrome.storage.local.set({ installDate: now });
  $('install-date').textContent = formatDate(installDate);
  $('update-date').textContent = formatDate(result.lastUpdateDate || installDate);
  chrome.storage.local.set({ lastUpdateDate: now });
});

/* Réinitialiser demande deux clics : le premier transforme le bouton en question. */
(function setupReset() {
  const button = $('reset-all-data');
  let armed = null;
  button.addEventListener('click', () => {
    if (!armed) {
      flash(button, 'Vraiment tout effacer ?', 4000);
      armed = setTimeout(() => { armed = null; }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    chrome.storage.local.clear(() => {
      chrome.storage.sync.clear(() => window.location.reload());
    });
  });
})();

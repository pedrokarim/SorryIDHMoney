/*
 * Récompenses Twitch : lit directement les statistiques que le content script
 * tient dans `chrome.storage.local`. Plus besoin d'être sur un onglet Twitch
 * pour les consulter.
 */

const { el, pager, formatNumber, setStat, flash } = window.UI;
const PAGE_SIZE = 15;
const EMPTY_STATS = { clickCount: 0, pointsCollected: 0, lastUpdate: 0, channelStats: {} };

const $ = (id) => document.getElementById(id);
const state = { channels: [], search: '', page: 1 };

function formatDate(ms) {
  return new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function render(stats) {
  setStat($('points-collected'), stats.pointsCollected);
  setStat($('click-count'), stats.clickCount);
  $('last-update').textContent = stats.lastUpdate && stats.clickCount
    ? `Dernier coffre le ${formatDate(stats.lastUpdate)}`
    : 'Aucun coffre ouvert pour l’instant';

  // Classement par points, du plus généreux au moins généreux.
  state.channels = Object.entries(stats.channelStats || {})
    .sort((a, b) => (b[1].pointsCollected || 0) - (a[1].pointsCollected || 0));
  setStat($('channel-total'), state.channels.length);
  renderChannels();
}

function renderChannels() {
  const list = $('channel-list');
  const term = state.search.toLowerCase();
  const ranked = state.channels.map((entry, index) => [index + 1, ...entry]);
  const visible = term ? ranked.filter(([, name]) => name.toLowerCase().includes(term)) : ranked;
  $('channel-count').textContent = visible.length ? formatNumber(visible.length) : '';

  if (!visible.length) {
    const box = el('div', 'empty');
    const img = el('img');
    img.src = '../icons/brand/symbol.svg';
    img.alt = '';
    box.append(img,
      el('strong', '', term ? 'Aucune chaîne trouvée' : 'Aucune chaîne pour l’instant'),
      el('span', '', term ? 'Rien ne correspond à cette recherche.' : 'Les points apparaîtront ici dès le premier coffre ouvert sur Twitch.'));
    list.replaceChildren(box);
    pager($('pager'), 1, 1, () => {});
    return;
  }

  const pages = Math.ceil(visible.length / PAGE_SIZE);
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * PAGE_SIZE;

  list.replaceChildren(...visible.slice(start, start + PAGE_SIZE).map(([rank, name, data]) => {
    const row = el('a', 'row');
    row.href = `https://www.twitch.tv/${encodeURIComponent(name)}`;
    row.target = '_blank';
    row.rel = 'noopener noreferrer';
    const text = el('span', 'row-text');
    const label = el('span', 'row-label', name);
    label.title = name;
    text.append(
      label,
      el('span', 'row-desc', `${formatNumber(data.clickCount)} coffre(s) · ${formatDate(data.lastUpdate)}`),
    );
    row.append(el('span', 'rank', String(rank)), text, el('span', 'points', `${formatNumber(data.pointsCollected)} pts`));
    return row;
  }));

  pager($('pager'), state.page, pages, (p) => { state.page = p; renderChannels(); });
}

function refresh() {
  chrome.storage.local.get({ twitchRewardStats: EMPTY_STATS }, ({ twitchRewardStats }) => {
    render({ ...EMPTY_STATS, ...twitchRewardStats });
  });
  chrome.storage.sync.get({ enableTwitchRewards: true }, ({ enableTwitchRewards }) => {
    $('rewards-state').textContent = enableTwitchRewards
      ? 'Récupération automatique active.'
      : 'Récupération automatique coupée dans les paramètres.';
  });
}

$('search-input').addEventListener('input', (e) => {
  state.search = e.target.value.trim();
  state.page = 1;
  renderChannels();
});

/* Réinitialiser demande deux clics : le premier transforme le bouton en question. */
(function setupReset() {
  const button = $('reset-stats');
  let armed = null;
  button.addEventListener('click', () => {
    if (!armed) {
      flash(button, 'Tout effacer ?', 3000);
      armed = setTimeout(() => { armed = null; }, 3000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    flash(button, 'Effacé');
    chrome.storage.local.set({ twitchRewardStats: { ...EMPTY_STATS, lastUpdate: Date.now() } });
  });
})();

chrome.storage.onChanged.addListener((changes, zone) => {
  if ((zone === 'local' && changes.twitchRewardStats) || (zone === 'sync' && changes.enableTwitchRewards)) refresh();
});
refresh();

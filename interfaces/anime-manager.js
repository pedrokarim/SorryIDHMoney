import { animeCache } from '../scripts/anime-cache-manager.js';

const { el, icon, pager } = window.UI;
const PAGE_SIZE = 15;

const state = {
  tab: 'custom',
  search: '',
  custom: [],
  ignored: [],
  page: { custom: 1, ignored: 1 },
  editing: null,
};

const $ = (id) => document.getElementById(id);

/* ── Onglets et recherche ────────────────────────────────────────────────── */

for (const button of document.querySelectorAll('.segmented [data-tab]')) {
  button.addEventListener('click', () => selectTab(button.dataset.tab));
}

function selectTab(tab) {
  state.tab = tab;
  for (const button of document.querySelectorAll('.segmented [data-tab]')) {
    button.setAttribute('aria-selected', button.dataset.tab === tab ? 'true' : 'false');
  }
  $('custom-tab').hidden = tab !== 'custom';
  $('ignored-tab').hidden = tab !== 'ignored';
}

$('search-input').addEventListener('input', (e) => {
  state.search = e.target.value.trim().toLowerCase();
  state.page.custom = 1;
  state.page.ignored = 1;
  render();
});

/* ── Données ─────────────────────────────────────────────────────────────── */

async function load() {
  const data = await animeCache.getAllData();
  state.custom = Object.entries(data.customUrls)
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => (a.title || a.key).localeCompare(b.title || b.key, 'fr', { numeric: true }));
  state.ignored = data.ignoredItems
    .map((key) => ({ key }))
    .sort((a, b) => a.key.localeCompare(b.key, 'fr', { numeric: true }));
  render();
}

function filtered(items) {
  if (!state.search) return items;
  return items.filter((item) => `${item.title || ''} ${item.key}`.toLowerCase().includes(state.search));
}

function render() {
  $('custom-count').textContent = state.custom.length || '';
  $('ignored-count').textContent = state.ignored.length || '';
  renderList('custom', createCustomRow, {
    title: 'Aucune fiche corrigée',
    text: 'Quand tu corriges la fiche d’un anime mal reconnu, elle est gardée ici.',
  });
  renderList('ignored', createIgnoredRow, {
    title: 'Aucun anime ignoré',
    text: 'Les animes que tu choisis d’ignorer n’auront plus de boutons.',
  });
}

function renderList(kind, createRow, emptyCopy) {
  const list = $(`${kind}-list`);
  const items = filtered(state[kind]);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  state.page[kind] = Math.min(state.page[kind], pages);

  if (!items.length) {
    list.replaceChildren(emptyState(state.search ? { title: 'Aucun résultat', text: 'Rien ne correspond à cette recherche.' } : emptyCopy));
    pager($(`${kind}-pager`), 1, 1, () => {});
    return;
  }

  const start = (state.page[kind] - 1) * PAGE_SIZE;
  const rows = [];
  for (const item of items.slice(start, start + PAGE_SIZE)) rows.push(...createRow(item));
  list.replaceChildren(...rows);

  pager($(`${kind}-pager`), state.page[kind], pages, (p) => {
    state.page[kind] = p;
    render();
  });
}

function emptyState({ title, text }) {
  const box = el('div', 'empty');
  const img = el('img');
  img.src = '../icons/brand/symbol.svg';
  img.alt = '';
  box.append(img, el('strong', '', title), el('span', '', text));
  return box;
}

function iconButton(name, title, extraClass = '') {
  const button = el('button', 'icon-btn icon-btn-sm ' + extraClass);
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.appendChild(icon(name, 'i-sm'));
  return button;
}

function linkChip(href, label, iconFile) {
  const a = el('a', 'link-chip');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  const img = el('img');
  img.src = '../icons/platforms/' + iconFile;
  img.alt = '';
  a.append(img, document.createTextNode(label));
  return a;
}

/* ── Fiches corrigées ────────────────────────────────────────────────────── */

function createCustomRow(item) {
  const row = el('div', 'row anime-row');
  const text = el('div', 'row-text');
  const title = el('span', 'row-label', item.title || item.key);
  title.title = item.key;
  text.appendChild(title);

  const links = el('div', 'links');
  if (item.anilistUrl) links.appendChild(linkChip(item.anilistUrl, 'AniList', 'anilist.svg'));
  if (item.malUrl) links.appendChild(linkChip(item.malUrl, 'MAL', 'myanimelist.png'));
  if (links.children.length) text.appendChild(links);

  const actions = el('div', 'row-actions');
  const edit = iconButton('pencil', 'Modifier l’adresse AniList');
  const remove = iconButton('trash', 'Supprimer', 'danger');
  actions.append(edit, remove);
  row.append(text, actions);

  edit.addEventListener('click', () => {
    state.editing = state.editing === item.key ? null : item.key;
    render();
  });
  remove.addEventListener('click', async () => {
    row.style.opacity = '0.5';
    await animeCache.removeAnime(item.key);
    state.custom = state.custom.filter((i) => i.key !== item.key);
    render();
  });

  if (state.editing !== item.key) return [row];

  const zone = el('div', 'edit-zone');
  const input = el('input', 'input');
  input.type = 'url';
  input.value = item.anilistUrl || '';
  input.placeholder = 'https://anilist.co/anime/…';
  input.setAttribute('aria-label', 'Adresse AniList');
  const save = iconButton('check', 'Enregistrer');
  const cancel = iconButton('x', 'Annuler');
  zone.append(input, save, cancel);

  const close = () => { state.editing = null; render(); };
  cancel.addEventListener('click', close);
  save.addEventListener('click', async () => {
    const url = input.value.trim();
    if (!isValidAnilistUrl(url)) {
      input.classList.add('invalid');
      setTimeout(() => input.classList.remove('invalid'), 1500);
      return;
    }
    await animeCache.setCustomUrl(item.key, url);
    state.editing = null;
    await load();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save.click();
    if (e.key === 'Escape') close();
  });
  setTimeout(() => { input.focus(); input.select(); });

  return [row, zone];
}

/* ── Ignorés ─────────────────────────────────────────────────────────────── */

function createIgnoredRow(item) {
  const row = el('div', 'row anime-row');
  const text = el('div', 'row-text');
  const title = el('span', 'row-label', item.key);
  title.title = item.key;
  text.appendChild(title);

  const actions = el('div', 'row-actions');
  // « Ne plus ignorer » et la suppression font la même chose côté cache :
  // l'anime retrouve ses boutons au prochain passage.
  const restore = iconButton('restore', 'Ne plus ignorer');
  actions.appendChild(restore);
  row.append(text, actions);

  restore.addEventListener('click', async () => {
    row.style.opacity = '0.5';
    await animeCache.removeAnime(item.key);
    state.ignored = state.ignored.filter((i) => i.key !== item.key);
    render();
  });
  return [row];
}

function isValidAnilistUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'anilist.co' && u.pathname.includes('/anime/');
  } catch {
    return false;
  }
}

/* ── Démarrage ───────────────────────────────────────────────────────────── */

await load();

// Ouvert depuis un bouton de page : on arrive sur l'anime concerné.
const highlight = new URLSearchParams(window.location.search).get('highlight');
if (highlight) {
  $('search-input').value = highlight;
  state.search = highlight.toLowerCase();
  if (!filtered(state.custom).length && filtered(state.ignored).length) selectTab('ignored');
  render();
}

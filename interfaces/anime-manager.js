import { animeCache } from '../scripts/anime-cache-manager.js';

const ITEMS_PER_PAGE = 15;
const SVG = {
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  delete: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`,
  restore: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>`,
  check: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  x: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  anilist: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M6.4 2H1v20h5.4V2zm5.2 4.7L8 22h5l.7-2.9h4.6L19 22h5L20.4 6.7h-8.8zm1.8 10.1l1.5-6.4h.2l1.5 6.4h-3.2z"/></svg>`,
  mal: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>`,
};

let allCustomUrls = [];
let allIgnored = [];
let customUrlsPage = 1;
let ignoredPage = 1;
let searchFilter = '';

document.addEventListener('DOMContentLoaded', async () => {
  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
    });
  });

  // Search
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchFilter = e.target.value.toLowerCase();
    customUrlsPage = 1;
    ignoredPage = 1;
    renderAll();
  });

  await loadData();

  // Highlight
  const highlight = new URLSearchParams(window.location.search).get('highlight');
  if (highlight) {
    document.getElementById('search-input').value = highlight;
    searchFilter = highlight.toLowerCase();
    renderAll();
  }
});

async function loadData() {
  const data = await animeCache.getAllData();

  allCustomUrls = Object.entries(data.customUrls)
    .map(([key, val]) => ({ key, ...val }))
    .sort((a, b) => (a.title || a.key).localeCompare(b.title || b.key));

  allIgnored = data.ignoredItems
    .map(key => ({ key }))
    .sort((a, b) => a.key.localeCompare(b.key));

  renderAll();
}

function renderAll() {
  renderCustomUrls();
  renderIgnored();
}

function getFiltered(items, keyField = 'key') {
  if (!searchFilter) return items;
  return items.filter(item => {
    const title = (item.title || item[keyField] || '').toLowerCase();
    const key = (item[keyField] || '').toLowerCase();
    return title.includes(searchFilter) || key.includes(searchFilter);
  });
}

// ─── Custom URLs ─────────────────────────────────────────

function renderCustomUrls() {
  const filtered = getFiltered(allCustomUrls);
  const container = document.getElementById('custom-urls-list');
  const empty = document.getElementById('custom-urls-empty');
  const pagContainer = document.getElementById('custom-urls-pagination');

  container.innerHTML = '';
  pagContainer.innerHTML = '';

  if (filtered.length === 0) {
    container.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  container.style.display = 'flex';
  empty.style.display = 'none';

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  customUrlsPage = Math.min(customUrlsPage, totalPages);
  const start = (customUrlsPage - 1) * ITEMS_PER_PAGE;
  const pageItems = filtered.slice(start, start + ITEMS_PER_PAGE);

  for (const item of pageItems) {
    container.appendChild(createCustomUrlItem(item));
  }

  if (totalPages > 1) {
    renderPagination(pagContainer, customUrlsPage, totalPages, (p) => {
      customUrlsPage = p;
      renderCustomUrls();
    });
  }
}

function createCustomUrlItem(item) {
  const el = document.createElement('div');
  el.className = 'anime-item';
  el.dataset.key = item.key;

  const info = document.createElement('div');
  info.className = 'anime-item-info';

  const title = document.createElement('div');
  title.className = 'anime-item-title';
  title.textContent = item.title || item.key;
  title.title = item.key;

  const urls = document.createElement('div');
  urls.className = 'anime-item-urls';

  if (item.anilistUrl) {
    const a = document.createElement('a');
    a.href = item.anilistUrl;
    a.target = '_blank';
    a.innerHTML = `${SVG.anilist} AniList`;
    urls.appendChild(a);
  }
  if (item.malUrl) {
    const a = document.createElement('a');
    a.href = item.malUrl;
    a.target = '_blank';
    a.innerHTML = `${SVG.mal} MAL`;
    urls.appendChild(a);
  }

  info.appendChild(title);
  info.appendChild(urls);

  // Edit zone (hidden by default)
  const editZone = document.createElement('div');
  editZone.className = 'anime-item-edit';

  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.value = item.anilistUrl || '';
  editInput.placeholder = 'https://anilist.co/anime/...';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.innerHTML = SVG.check;
  saveBtn.title = 'Sauvegarder';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cancel-btn';
  cancelBtn.innerHTML = SVG.x;
  cancelBtn.title = 'Annuler';

  editZone.appendChild(editInput);
  editZone.appendChild(saveBtn);
  editZone.appendChild(cancelBtn);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'anime-item-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn edit';
  editBtn.innerHTML = SVG.edit;
  editBtn.title = 'Modifier';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn delete';
  deleteBtn.innerHTML = SVG.delete;
  deleteBtn.title = 'Supprimer';

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  el.appendChild(info);
  el.appendChild(actions);
  el.appendChild(editZone);

  // Events
  editBtn.addEventListener('click', () => {
    el.classList.toggle('editing');
    editZone.classList.toggle('active');
    if (editZone.classList.contains('active')) {
      editInput.focus();
      editInput.select();
    }
  });

  cancelBtn.addEventListener('click', () => {
    el.classList.remove('editing');
    editZone.classList.remove('active');
    editInput.value = item.anilistUrl || '';
  });

  saveBtn.addEventListener('click', async () => {
    const url = editInput.value.trim();
    if (!url || !isValidAnilistUrl(url)) {
      editInput.style.borderColor = '#F44336';
      setTimeout(() => editInput.style.borderColor = '', 1500);
      return;
    }
    await animeCache.setCustomUrl(item.key, url);
    await loadData();
  });

  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') cancelBtn.click();
  });

  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
    await animeCache.removeAnime(item.key);
    allCustomUrls = allCustomUrls.filter(i => i.key !== item.key);
    renderAll();
  });

  return el;
}

// ─── Ignored ─────────────────────────────────────────────

function renderIgnored() {
  const filtered = getFiltered(allIgnored);
  const container = document.getElementById('ignored-list');
  const empty = document.getElementById('ignored-empty');
  const pagContainer = document.getElementById('ignored-pagination');

  container.innerHTML = '';
  pagContainer.innerHTML = '';

  if (filtered.length === 0) {
    container.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  container.style.display = 'flex';
  empty.style.display = 'none';

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
  ignoredPage = Math.min(ignoredPage, totalPages);
  const start = (ignoredPage - 1) * ITEMS_PER_PAGE;
  const pageItems = filtered.slice(start, start + ITEMS_PER_PAGE);

  for (const item of pageItems) {
    container.appendChild(createIgnoredItem(item));
  }

  if (totalPages > 1) {
    renderPagination(pagContainer, ignoredPage, totalPages, (p) => {
      ignoredPage = p;
      renderIgnored();
    });
  }
}

function createIgnoredItem(item) {
  const el = document.createElement('div');
  el.className = 'anime-item';

  const info = document.createElement('div');
  info.className = 'anime-item-info';

  const title = document.createElement('div');
  title.className = 'anime-item-title';
  title.textContent = item.key;

  info.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'anime-item-actions';

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'icon-btn restore';
  restoreBtn.innerHTML = SVG.restore;
  restoreBtn.title = 'Restaurer';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn delete';
  deleteBtn.innerHTML = SVG.delete;
  deleteBtn.title = 'Supprimer définitivement';

  actions.appendChild(restoreBtn);
  actions.appendChild(deleteBtn);

  el.appendChild(info);
  el.appendChild(actions);

  restoreBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
    await animeCache.removeAnime(item.key);
    allIgnored = allIgnored.filter(i => i.key !== item.key);
    renderAll();
  });

  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    el.style.opacity = '0.5';
    el.style.pointerEvents = 'none';
    await animeCache.removeAnime(item.key);
    allIgnored = allIgnored.filter(i => i.key !== item.key);
    renderAll();
  });

  return el;
}

// ─── Pagination ──────────────────────────────────────────

function renderPagination(container, currentPage, totalPages, onPageChange) {
  // Prev
  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.innerHTML = '&lsaquo;';
  prevBtn.disabled = currentPage <= 1;
  prevBtn.addEventListener('click', () => onPageChange(currentPage - 1));
  container.appendChild(prevBtn);

  // Page numbers
  const maxVisible = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  let endPage = Math.min(totalPages, startPage + maxVisible - 1);
  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  if (startPage > 1) {
    container.appendChild(createPageBtn(1, currentPage, onPageChange));
    if (startPage > 2) {
      const dots = document.createElement('span');
      dots.className = 'page-info';
      dots.textContent = '...';
      container.appendChild(dots);
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    container.appendChild(createPageBtn(i, currentPage, onPageChange));
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      const dots = document.createElement('span');
      dots.className = 'page-info';
      dots.textContent = '...';
      container.appendChild(dots);
    }
    container.appendChild(createPageBtn(totalPages, currentPage, onPageChange));
  }

  // Next
  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.innerHTML = '&rsaquo;';
  nextBtn.disabled = currentPage >= totalPages;
  nextBtn.addEventListener('click', () => onPageChange(currentPage + 1));
  container.appendChild(nextBtn);
}

function createPageBtn(page, currentPage, onPageChange) {
  const btn = document.createElement('button');
  btn.className = `page-btn${page === currentPage ? ' active' : ''}`;
  btn.textContent = page;
  btn.addEventListener('click', () => onPageChange(page));
  return btn;
}

// ─── Utils ───────────────────────────────────────────────

function isValidAnilistUrl(url) {
  try {
    const u = new URL(url);
    return u.hostname === 'anilist.co' && u.pathname.includes('/anime/');
  } catch {
    return false;
  }
}

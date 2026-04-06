const ITEMS_PER_PAGE = 15;
let currentPage = 1;
let allChannels = [];
let searchTerm = '';

function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(num);
}

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString('fr-FR', {
        dateStyle: 'short',
        timeStyle: 'short'
    });
}

function getFilteredChannels() {
    if (!searchTerm) return allChannels;
    const term = searchTerm.toLowerCase();
    return allChannels.filter(([name]) => name.toLowerCase().includes(term));
}

function renderChannels() {
    const container = document.getElementById('channel-stats');
    const emptyMsg = document.getElementById('empty-message');
    const filtered = getFilteredChannels();

    container.innerHTML = '';

    if (filtered.length === 0) {
        emptyMsg.style.display = '';
        emptyMsg.textContent = searchTerm ? 'Aucune chaîne trouvée.' : 'Aucune chaîne visitée.';
        renderPagination(0);
        return;
    }

    emptyMsg.style.display = 'none';

    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const pageItems = filtered.slice(start, start + ITEMS_PER_PAGE);

    pageItems.forEach(([channelName, channelData]) => {
        const el = document.createElement('div');
        el.className = 'channel-item';
        el.innerHTML = `
            <div class="channel-item-info">
                <div class="channel-item-name">${channelName}</div>
                <div class="channel-item-details">
                    ${formatNumber(channelData.clickCount)} clics · ${formatNumber(channelData.pointsCollected)} pts · ${formatDate(channelData.lastUpdate)}
                </div>
            </div>
        `;
        container.appendChild(el);
    });

    renderPagination(filtered.length);

    // Compteur
    const countEl = document.getElementById('channel-count');
    if (countEl) {
        countEl.textContent = `(${filtered.length})`;
    }
}

function renderPagination(totalItems) {
    const container = document.getElementById('pagination');
    container.innerHTML = '';

    const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
    if (totalPages <= 1) return;

    // Prev
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.innerHTML = '‹';
    prevBtn.disabled = currentPage === 1;
    prevBtn.addEventListener('click', () => { currentPage--; renderChannels(); });
    container.appendChild(prevBtn);

    // Pages
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
        btn.textContent = i;
        btn.addEventListener('click', () => { currentPage = i; renderChannels(); });
        container.appendChild(btn);
    }

    // Next
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.innerHTML = '›';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.addEventListener('click', () => { currentPage++; renderChannels(); });
    container.appendChild(nextBtn);
}

function updateStats() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0].url.includes('twitch.tv')) {
            chrome.tabs.sendMessage(tabs[0].id, { action: "getTwitchStats" }, function (response) {
                if (response) {
                    document.getElementById('click-count').textContent = formatNumber(response.clickCount);
                    document.getElementById('points-collected').textContent = formatNumber(response.pointsCollected);
                    document.getElementById('last-update').textContent =
                        `Dernière mise à jour : ${formatDate(response.lastUpdate)}`;

                    allChannels = Object.entries(response.channelStats || {})
                        .sort((a, b) => b[1].lastUpdate - a[1].lastUpdate);

                    renderChannels();
                }
            });
        } else {
            document.body.innerHTML = '<div style="padding: 20px; text-align: center; color: #666; font-size: 13px;">Veuillez vous rendre sur Twitch pour voir les statistiques.</div>';
        }
    });
}

// Search
document.getElementById('search-input').addEventListener('input', function (e) {
    searchTerm = e.target.value.trim();
    currentPage = 1;
    renderChannels();
});

// Reset
document.getElementById('reset-stats').addEventListener('click', function () {
    const stats = {
        clickCount: 0,
        pointsCollected: 0,
        lastUpdate: Date.now(),
        channelStats: {}
    };

    chrome.storage.local.set({ twitchRewardStats: stats }, function () {
        updateStats();
    });
});

// Init + refresh
updateStats();
setInterval(updateStats, 5000);

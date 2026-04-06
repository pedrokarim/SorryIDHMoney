document.addEventListener('DOMContentLoaded', function () {
    try {
        const manifest = chrome.runtime.getManifest();

        document.getElementById('extension-name').textContent = manifest.name;
        document.title = `À propos de ${manifest.name}`;
        document.getElementById('extension-version').textContent = manifest.version;

        const descriptionElement = document.getElementById('extension-description');
        if (descriptionElement && manifest.description) {
            descriptionElement.textContent = manifest.description;
        }

        // Permissions
        const permissionsList = document.getElementById('permissions-list');
        if (permissionsList && manifest.permissions && manifest.permissions.length > 0) {
            manifest.permissions.forEach(permission => {
                let formatted = permission;
                if (permission === "storage") formatted = "Stockage local de données";
                else if (permission === "tabs") formatted = "Gestion des onglets";
                else if (permission.includes("://")) formatted = `Accès au site ${permission.replace(/\*:\/\/|\*\//g, '')}`;

                const el = document.createElement('div');
                el.className = 'perm-item';
                el.innerHTML = `<svg class="perm-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg><span>${formatted}</span>`;
                permissionsList.appendChild(el);
            });
        } else if (permissionsList) {
            permissionsList.innerHTML = '<div class="empty-message">Aucune permission requise</div>';
        }

        const authorElement = document.getElementById('extension-author');
        if (authorElement && manifest.author) {
            authorElement.textContent = manifest.author;
        }

    } catch (error) {
        console.error('Erreur lors de la récupération du manifest:', error);
        document.getElementById('manifest-error').style.display = 'block';
    }

    // Avatar fallback
    const avatarImg = document.getElementById('github-avatar');
    if (avatarImg) {
        avatarImg.onerror = function () {
            this.src = '../icons/icon48.png';
        };
    }

    // Copyright year
    const yearElement = document.getElementById('current-year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }

    loadStats();
    loadHistory();
});

function loadHistory() {
    chrome.storage.local.get(['installDate', 'lastUpdateDate'], function (result) {
        if (result.installDate) {
            document.getElementById('install-date').textContent = new Date(result.installDate).toLocaleDateString('fr-FR');
        }
        if (result.lastUpdateDate) {
            document.getElementById('update-date').textContent = new Date(result.lastUpdateDate).toLocaleDateString('fr-FR');
        } else if (result.installDate) {
            document.getElementById('update-date').textContent = new Date(result.installDate).toLocaleDateString('fr-FR');
        }
    });

    const now = Date.now();
    chrome.storage.local.get(['installDate'], function (result) {
        if (!result.installDate) {
            chrome.storage.local.set({ installDate: now });
            document.getElementById('install-date').textContent = new Date(now).toLocaleDateString('fr-FR');
        }
        chrome.storage.local.set({ lastUpdateDate: now });
    });
}

function loadStats() {
    chrome.storage.local.get(['animeCache'], function (result) {
        const animeCache = result.animeCache || { notFound: {} };
        const totalAnimes = Object.keys(animeCache.notFound || {}).length;
        document.getElementById('total-animes').textContent = totalAnimes;

        const topAnimesElement = document.getElementById('top-animes');
        if (topAnimesElement && animeCache.notFound) {
            const animeEntries = Object.entries(animeCache.notFound);

            if (animeEntries.length > 0) {
                animeEntries.sort((a, b) => (b[1].lastSearch || 0) - (a[1].lastSearch || 0));
                animeEntries.slice(0, 3).forEach(([name, data]) => {
                    const formatted = name.charAt(0).toUpperCase() + name.slice(1);
                    const short = formatted.length > 30 ? formatted.substring(0, 27) + '...' : formatted;

                    const el = document.createElement('div');
                    el.className = 'list-item';
                    el.innerHTML = `
                        <span class="list-item-name">${short}</span>
                        <span class="list-item-value">${data.lastSearch ? new Date(data.lastSearch).toLocaleDateString('fr-FR') : '-'}</span>
                    `;
                    topAnimesElement.appendChild(el);
                });
            } else {
                topAnimesElement.innerHTML = '<div class="empty-message">Aucun anime en cache</div>';
            }
        }
    });

    chrome.storage.local.get(['twitchRewardStats'], function (result) {
        const stats = result.twitchRewardStats || { pointsCollected: 0, clickCount: 0, channelStats: {} };

        document.getElementById('twitch-points').textContent = formatNumber(stats.pointsCollected);
        document.getElementById('twitch-clicks').textContent = formatNumber(stats.clickCount || 0);

        const topChannelsElement = document.getElementById('top-channels');
        if (topChannelsElement && stats.channelStats) {
            const channelEntries = Object.entries(stats.channelStats);

            if (channelEntries.length > 0) {
                channelEntries.sort((a, b) => b[1].pointsCollected - a[1].pointsCollected);
                channelEntries.slice(0, 3).forEach(([channel, data]) => {
                    const el = document.createElement('div');
                    el.className = 'list-item';
                    el.innerHTML = `
                        <span class="list-item-name">${channel}</span>
                        <span class="list-item-value">${formatNumber(data.pointsCollected)} pts</span>
                    `;
                    topChannelsElement.appendChild(el);
                });
            } else {
                topChannelsElement.innerHTML = '<div class="empty-message">Aucune chaîne visitée</div>';
            }
        }
    });
}

function formatNumber(num) {
    return new Intl.NumberFormat('fr-FR').format(num);
}

function resetAllData() {
    if (confirm('Êtes-vous sûr de vouloir réinitialiser toutes les données ? Cette action est irréversible.')) {
        chrome.storage.local.clear(function () {
            chrome.storage.sync.clear(function () {
                alert('Toutes les données ont été effacées.');
                window.location.reload();
            });
        });
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const resetButton = document.getElementById('reset-all-data');
    if (resetButton) {
        resetButton.addEventListener('click', resetAllData);
    }
});

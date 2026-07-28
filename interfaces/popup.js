document.addEventListener('DOMContentLoaded', function() {
    const manifest = chrome.runtime.getManifest();
    document.getElementById('extension-name').textContent = manifest.name;
    document.getElementById('extension-version').textContent = 'v' + manifest.version;

    // Mode édition
    document.getElementById('toggle-edit-mode').addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, {
                    action: "toggleEditMode",
                    enabled: true
                });
            }
        });
        window.close();
    });

    // Statut du bypass X — affiché uniquement si l'onglet actif est X/Twitter.
    initXcomStatus();
});

function isXHost(host) {
    return host === 'x.com' || host === 'twitter.com'
        || host.endsWith('.x.com') || host.endsWith('.twitter.com');
}

function initXcomStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const tab = tabs && tabs[0];
        if (!tab || !tab.url) return;

        let host;
        try { host = new URL(tab.url).hostname; } catch { return; }
        if (!isXHost(host)) return;

        const card = document.getElementById('xcom-status');
        const badge = document.getElementById('xcom-status-badge');
        const hooksEl = document.getElementById('xcom-hooks');
        card.style.display = '';

        chrome.tabs.sendMessage(tab.id, { action: 'getXcomStatus' }, function (res) {
            if (chrome.runtime.lastError || !res) {
                setBadge(badge, 'gray', 'Indisponible');
                hooksEl.innerHTML = '<li class="muted">Recharge la page X pour activer le suivi.</li>';
                return;
            }
            renderXcomStatus(res, badge, hooksEl);
        });
    });
}

function renderXcomStatus(res, badge, hooksEl) {
    if (!res.moduleEnabled) {
        setBadge(badge, 'gray', 'Désactivé');
        hooksEl.innerHTML = '<li class="muted">Module X désactivé dans les paramètres.</li>';
        return;
    }
    if (!res.active) {
        setBadge(badge, 'warn', 'En attente');
        hooksEl.innerHTML = '<li class="muted">En attente du chargement de la page…</li>';
        return;
    }

    setBadge(badge, res.status === 'ok' ? 'ok' : 'err', res.status === 'ok' ? 'Actif' : 'Erreur');

    const hooks = (res.hooks && res.hooks.length)
        ? res.hooks
        : ['__INITIAL_STATE__', 'Object.assign', 'JSON.parse'];
    hooksEl.innerHTML = hooks
        .map((h) => `<li><span class="hook-dot"></span>${escapeHtml(h)}</li>`)
        .join('');
}

function setBadge(el, cls, text) {
    el.className = 'status-badge ' + cls;
    el.textContent = text;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

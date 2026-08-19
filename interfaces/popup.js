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

/* ── Publication X : etat du pont et historique ────────────────────────────
 *
 * Le panneau reste cache si le module est decoche : une extension qui affiche
 * en permanence des rubriques inactives finit par ne plus rien dire.
 *
 * « Connecte » se deduit de la date du dernier echange reussi, pas d'un
 * booleen : si le serveur local s'arrete sans prevenir, un booleen resterait
 * a vrai. Au-dela de deux tours de sonde sans nouvelles, on considere que le
 * pont est tombe.
 */
(function panneauXPoster() {
  const DELAI_PERTE = 150000; // 2 tours de sonde + marge

  const panneau = document.getElementById('xposter-panneau');
  const badge = document.getElementById('xposter-badge');
  const resume = document.getElementById('xposter-resume');
  const historique = document.getElementById('xposter-historique');
  if (!panneau) return;

  const ETATS = {
    'en attente': ['warn', 'programmé'],
    prepare: ['ok', 'préparé'],
    publie: ['ok', 'publié'],
    echec: ['err', 'échec'],
  };

  const quand = (ms) => {
    const d = new Date(ms);
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) +
           ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  };

  function rendre(cfg, local) {
    if (!cfg.enableXPoster) { panneau.style.display = 'none'; return; }
    panneau.style.display = '';

    const contact = local.xposterDernierContact || 0;
    const vivant = Date.now() - contact < DELAI_PERTE;

    badge.className = 'status-badge ' + (vivant ? 'ok' : 'err');
    badge.textContent = vivant ? 'pont connecté' : 'pont absent';

    const file = local.xposterFile || [];
    const attente = file.filter((p) => p.etat === 'en attente');

    resume.textContent = vivant
      ? `${attente.length} en attente · dernier échange ${quand(contact)}`
      : contact
        ? `hors ligne · dernier échange ${quand(contact)}`
        : 'jamais connecté — le serveur local tourne-t-il ?';

    historique.innerHTML = '';
    const recentes = [...file]
      .sort((a, b) => (b.execute || b.quand || 0) - (a.execute || a.quand || 0))
      .slice(0, 6);

    if (!recentes.length) {
      const li = document.createElement('li');
      li.textContent = 'aucune publication';
      li.style.opacity = '.6';
      historique.appendChild(li);
      return;
    }

    for (const p of recentes) {
      const [classe, libelle] = ETATS[p.etat] || ['gray', p.etat];
      const li = document.createElement('li');
      const extrait = (p.texte || '').replace(/\s+/g, ' ').slice(0, 42);
      li.innerHTML =
        `<span class="status-badge ${classe}" style="margin-right:6px">${libelle}</span>` +
        `<span style="opacity:.8">${extrait}${extrait.length >= 42 ? '…' : ''}</span>`;
      li.title = `${quand(p.execute || p.quand)}${p.rapport?.erreur ? ' — ' + p.rapport.erreur : ''}`;
      historique.appendChild(li);
    }
  }

  function rafraichir() {
    chrome.storage.sync.get({ enableXPoster: false }, (cfg) => {
      chrome.storage.local.get({ xposterDernierContact: 0, xposterFile: [] }, (local) => {
        rendre(cfg, local);
      });
    });
  }

  rafraichir();
  // La popup reste ouverte pendant qu'on la regarde : on suit l'etat en direct.
  const minuterie = setInterval(rafraichir, 3000);
  window.addEventListener('unload', () => clearInterval(minuterie));
  chrome.storage.onChanged.addListener(rafraichir);
})();

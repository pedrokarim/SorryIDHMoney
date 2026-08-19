// Thèmes built-in
const THEMES = {
    light: {
        name: 'Clair',
        bar: '#805ad5',
        bg: '#ffffff',
        text: '#dddddd',
        textShort: '#eeeeee'
    },
    dark: {
        name: 'Sombre',
        bar: '#805ad5',
        bg: '#1a1a2e',
        text: '#3a3a5e',
        textShort: '#2a2a4e'
    },
    purple: {
        name: 'Violet',
        bar: '#6b46c1',
        bg: '#f3e8ff',
        text: '#d6bcfa',
        textShort: '#e9d5ff'
    },
    ocean: {
        name: 'Océan',
        bar: '#2b6cb0',
        bg: '#ebf8ff',
        text: '#bee3f8',
        textShort: '#cfe8fc'
    },
    forest: {
        name: 'Forêt',
        bar: '#2f855a',
        bg: '#f0fff4',
        text: '#c6f6d5',
        textShort: '#d4f7e0'
    },
    sunset: {
        name: 'Coucher de soleil',
        bar: '#dd6b20',
        bg: '#fffaf0',
        text: '#feebc8',
        textShort: '#fef3d8'
    },
    cherry: {
        name: 'Cerisier',
        bar: '#d53f8c',
        bg: '#fff5f7',
        text: '#fed7e2',
        textShort: '#fde8ee'
    },
    midnight: {
        name: 'Minuit',
        bar: '#4a5568',
        bg: '#1a202c',
        text: '#2d3748',
        textShort: '#252d3d'
    }
};

// Sections collapsibles
document.querySelectorAll('.settings-group-header').forEach(header => {
    header.addEventListener('click', () => {
        const group = header.closest('.settings-group');
        const content = group.querySelector('.settings-group-content');
        const isCollapsed = group.dataset.collapsed === 'true';

        if (isCollapsed) {
            group.dataset.collapsed = 'false';
            content.style.display = '';
        } else {
            group.dataset.collapsed = 'true';
            content.style.display = 'none';
        }
    });
});

// Preview du thème
function updateThemePreview(themeKey) {
    const theme = THEMES[themeKey];
    if (!theme) return;

    const preview = document.getElementById('theme-preview');
    if (!preview) return;

    preview.querySelector('.theme-preview-bar').style.background = theme.bar;
    preview.querySelector('.theme-preview-content').style.background = theme.bg;
    const texts = preview.querySelectorAll('.theme-preview-text');
    texts[0].style.background = theme.text;
    if (texts[1]) texts[1].style.background = theme.textShort;
}

// Charger les paramètres sauvegardés
document.addEventListener('DOMContentLoaded', function () {
    chrome.storage.sync.get({
        backgroundColor: '#ffffff',
        theme: 'light',
        censure: false,
        enableMal: true,
        enableAnilist: true,
        disableAnimeSwitcherAnimations: false,
        enableVoiranime: true,
        enableCrunchyroll: true,
        enableAdkami: true,
        enableAdn: true,
        enableGumgum: true,
        enableTwitchRewards: true,
        enableToasts: true,
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
        xposterToken: ''
    }, function (items) {
        document.getElementById('enable-xposter').checked = items.enableXPoster;
        document.getElementById('xposter-autoriser-publication').checked = items.xposterAutoriserPublication;
        document.getElementById('xposter-port').value = items.xposterPort;
        document.getElementById('xposter-token').value = items.xposterToken;
        rappelerCommande(items.xposterToken, items.xposterPort);
        document.getElementById('background-color').value = items.backgroundColor;
        document.getElementById('theme').value = items.theme;
        document.getElementById('censure').checked = items.censure;
        document.getElementById('enable-mal').checked = items.enableMal;
        document.getElementById('enable-anilist').checked = items.enableAnilist;
        document.getElementById('disable-switcher-animations').checked = items.disableAnimeSwitcherAnimations;
        document.getElementById('enable-voiranime').checked = items.enableVoiranime;

        document.getElementById('enable-crunchyroll').checked = items.enableCrunchyroll;
        document.getElementById('enable-adkami').checked = items.enableAdkami;
        document.getElementById('enable-adn').checked = items.enableAdn;
        document.getElementById('enable-gumgum').checked = items.enableGumgum;
        document.getElementById('enable-twitch-rewards').checked = items.enableTwitchRewards;
        document.getElementById('enable-toasts').checked = items.enableToasts;

        document.getElementById('enable-yt-shorts-autoscroll').checked = items.enableYoutubeShortsAutoscroll;
        document.getElementById('yt-shorts-replay-count').value = items.youtubeShortsReplayCount;
        document.getElementById('yt-shorts-scroll-delay').value = items.youtubeShortsScrollDelay;
        document.getElementById('enable-yt-smooth-playback').checked = items.enableYoutubeSmoothPlayback;

        document.getElementById('enable-age-verif-bypass').checked = items.enableAgeVerifBypass;
        document.getElementById('enable-avb-reddit').checked = items.enableAvbReddit;
        document.getElementById('enable-avb-aliexpress').checked = items.enableAvbAliexpress;
        document.getElementById('enable-avb-bsky').checked = items.enableAvbBsky;
        document.getElementById('enable-avb-xcom').checked = items.enableAvbXcom;
        document.getElementById('enable-avb-xcom-indicator').checked = items.enableAvbXcomIndicator;
        document.getElementById('enable-avb-agechecker').checked = items.enableAvbAgechecker;
        document.getElementById('enable-avb-agego').checked = items.enableAvbAgego;
        document.getElementById('enable-avb-ageverif').checked = items.enableAvbAgeverif;
        document.getElementById('enable-avb-veriff').checked = items.enableAvbVeriff;
        reflectAvbMaster(items.enableAgeVerifBypass);
        reflectXcomIndicator();

        updateThemePreview(items.theme);
    });
});

// ── Publication X ────────────────────────────────────────────────────────

/**
 * Jeton aleatoire.
 *
 * `crypto.getRandomValues` et non `Math.random` : ce jeton est la seule chose
 * qui separe un navigateur connecte d'un port ouvert sur la machine, et
 * `Math.random` n'est pas fait pour ca. 24 octets en base36, ca suffit
 * largement pour un service qui n'ecoute que sur 127.0.0.1.
 */
function genererJeton() {
    const octets = new Uint8Array(24);
    crypto.getRandomValues(octets);
    return Array.from(octets, (o) => o.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

/** Affiche la commande a lancer, jeton compris, pour qu'elle soit copiable. */
function rappelerCommande(jeton, port) {
    const el = document.getElementById('xposter-commande');
    if (!el) return;
    el.textContent = jeton
        ? `node tools/xposter-server.js --token ${jeton} --port ${port}`
        : '— génère un jeton pour obtenir la commande';
}

/** Retour visuel bref sur un bouton, sans bibliotheque ni toast. */
function confirmer(bouton, texte) {
    const avant = bouton.textContent;
    bouton.textContent = texte;
    setTimeout(() => { bouton.textContent = avant; }, 1400);
}

document.getElementById('xposter-generer').addEventListener('click', function () {
    const jeton = genererJeton();
    const champ = document.getElementById('xposter-token');
    champ.value = jeton;
    chrome.storage.sync.set({ xposterToken: jeton });
    rappelerCommande(jeton, document.getElementById('xposter-port').value);
    confirmer(this, 'Généré');
});

document.getElementById('xposter-copier').addEventListener('click', async function () {
    const jeton = document.getElementById('xposter-token').value;
    if (!jeton) { confirmer(this, 'Vide'); return; }
    try {
        await navigator.clipboard.writeText(jeton);
        confirmer(this, 'Copié');
    } catch {
        // Presse-papiers refuse : on selectionne, l'utilisateur fait Ctrl+C.
        document.getElementById('xposter-token').select();
        confirmer(this, 'Ctrl+C');
    }
});

document.getElementById('xposter-port').addEventListener('input', function (e) {
    rappelerCommande(document.getElementById('xposter-token').value, e.target.value);
});

// Le service worker ecoute chrome.storage : il ouvre ou ferme le pont tout
// seul quand ces valeurs changent, sans qu on ait a le prevenir.
document.getElementById('enable-xposter').addEventListener('change', function (e) {
    chrome.storage.sync.set({ enableXPoster: e.target.checked });
});

document.getElementById('xposter-autoriser-publication').addEventListener('change', function (e) {
    chrome.storage.sync.set({ xposterAutoriserPublication: e.target.checked });
});

document.getElementById('xposter-port').addEventListener('change', function (e) {
    const port = parseInt(e.target.value, 10);
    // Un port hors plage couperait le pont sans rien dire : on refuse et on
    // remet la valeur precedente sous les yeux.
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        chrome.storage.sync.get({ xposterPort: 8787 }, (i) => { e.target.value = i.xposterPort; });
        return;
    }
    chrome.storage.sync.set({ xposterPort: port });
});

// Écouteurs d'événements
document.getElementById('background-color').addEventListener('input', function (e) {
    chrome.storage.sync.set({ backgroundColor: e.target.value });
});

document.getElementById('theme').addEventListener('change', function (e) {
    chrome.storage.sync.set({ theme: e.target.value });
    updateThemePreview(e.target.value);
});

document.getElementById('censure').addEventListener('change', function (e) {
    chrome.storage.sync.set({ censure: e.target.checked });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: "updateCensure",
            censure: e.target.checked
        });
    });
});

document.getElementById('enable-mal').addEventListener('change', function (e) {
    chrome.storage.sync.set({ enableMal: e.target.checked });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: "updateAnimeSwitcher",
            type: "mal",
            enabled: e.target.checked
        });
    });
});

document.getElementById('enable-anilist').addEventListener('change', function (e) {
    chrome.storage.sync.set({ enableAnilist: e.target.checked });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: "updateAnimeSwitcher",
            type: "anilist",
            enabled: e.target.checked
        });
    });
});

document.getElementById('disable-switcher-animations').addEventListener('change', function (e) {
    chrome.storage.sync.set({ disableAnimeSwitcherAnimations: e.target.checked });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: "updateAnimeSwitcher",
            type: "animations",
            enabled: !e.target.checked
        });
    });
});

// Plateformes de streaming — sauvegarde uniquement (pris en compte au prochain chargement de page)
for (const platform of ['voiranime', 'crunchyroll', 'adkami', 'adn', 'gumgum']) {
    const key = `enable${platform.charAt(0).toUpperCase() + platform.slice(1)}`;
    document.getElementById(`enable-${platform}`).addEventListener('change', function (e) {
        chrome.storage.sync.set({ [key]: e.target.checked });
    });
}

document.getElementById('enable-twitch-rewards').addEventListener('change', function (e) {
    chrome.storage.sync.set({ enableTwitchRewards: e.target.checked });
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {
            action: "updateTwitchRewards",
            enabled: e.target.checked
        });
    });
});

document.getElementById('enable-toasts').addEventListener('change', function (e) {
    chrome.storage.sync.set({ enableToasts: e.target.checked });
});

// YouTube Shorts — auto-scroll
function sendShortsUpdate(payload) {
    chrome.tabs.query({ url: ['https://www.youtube.com/shorts/*', 'https://m.youtube.com/shorts/*'] }, function (tabs) {
        if (!tabs) return;
        for (const tab of tabs) {
            chrome.tabs.sendMessage(tab.id, { action: 'updateYoutubeShortsAutoscroll', ...payload }, () => void chrome.runtime.lastError);
        }
    });
}

document.getElementById('enable-yt-shorts-autoscroll').addEventListener('change', function (e) {
    chrome.storage.sync.set({ enableYoutubeShortsAutoscroll: e.target.checked });
    sendShortsUpdate({ enabled: e.target.checked });
});

document.getElementById('yt-shorts-replay-count').addEventListener('change', function (e) {
    const value = Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0));
    e.target.value = value;
    chrome.storage.sync.set({ youtubeShortsReplayCount: value });
    sendShortsUpdate({ config: { youtubeShortsReplayCount: value } });
});

document.getElementById('yt-shorts-scroll-delay').addEventListener('change', function (e) {
    const value = Math.max(0, Math.min(10000, parseInt(e.target.value, 10) || 0));
    e.target.value = value;
    chrome.storage.sync.set({ youtubeShortsScrollDelay: value });
    sendShortsUpdate({ config: { youtubeShortsScrollDelay: value } });
});

document.getElementById('enable-yt-smooth-playback').addEventListener('change', function (e) {
    chrome.storage.sync.set({ enableYoutubeSmoothPlayback: e.target.checked });
});

// Bypass vérification d'âge — persistance uniquement. background.js (avb-manager)
// écoute storage.onChanged et réapplique règles DNR + injection. Les content
// scripts DOM (reddit/aliexpress) prennent effet au prochain chargement de page.
const AVB_SUB_TOGGLES = ['reddit', 'aliexpress', 'bsky', 'xcom', 'agechecker', 'agego', 'ageverif', 'veriff'];

// Grise les sous-toggles quand le module maître est désactivé.
function reflectAvbMaster(masterEnabled) {
    for (const site of AVB_SUB_TOGGLES) {
        const input = document.getElementById(`enable-avb-${site}`);
        if (!input) continue;
        input.disabled = !masterEnabled;
        input.closest('.setting-item')?.classList.toggle('is-disabled', !masterEnabled);
    }
    reflectXcomIndicator();
}

// La pastille X ne fait sens que si le module maître ET le bypass X sont actifs.
function reflectXcomIndicator() {
    const master = document.getElementById('enable-age-verif-bypass').checked;
    const xcom = document.getElementById('enable-avb-xcom').checked;
    const input = document.getElementById('enable-avb-xcom-indicator');
    const available = master && xcom;
    input.disabled = !available;
    input.closest('.setting-item')?.classList.toggle('is-disabled', !available);
}

document.getElementById('enable-age-verif-bypass').addEventListener('change', function (e) {
    chrome.storage.sync.set({ enableAgeVerifBypass: e.target.checked });
    reflectAvbMaster(e.target.checked);
});

for (const site of AVB_SUB_TOGGLES) {
    // enableAvbReddit, enableAvbAliexpress, ...
    const key = `enableAvb${site.charAt(0).toUpperCase() + site.slice(1)}`;
    document.getElementById(`enable-avb-${site}`).addEventListener('change', function (e) {
        chrome.storage.sync.set({ [key]: e.target.checked });
    });
}

// Toggle dépendant : afficher la pastille de statut sur la page X (défaut off).
document.getElementById('enable-avb-xcom').addEventListener('change', reflectXcomIndicator);
document.getElementById('enable-avb-xcom-indicator').addEventListener('change', function (e) {
    chrome.storage.sync.set({ enableAvbXcomIndicator: e.target.checked });
});

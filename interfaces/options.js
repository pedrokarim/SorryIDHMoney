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
        enableVoiranime: true,
        enableCrunchyroll: true,
        enableAdkami: true,
        enableAdn: true,
        enableGumgum: true,
        enableTwitchRewards: true,
        enableToasts: true
    }, function (items) {
        document.getElementById('background-color').value = items.backgroundColor;
        document.getElementById('theme').value = items.theme;
        document.getElementById('censure').checked = items.censure;
        document.getElementById('enable-mal').checked = items.enableMal;
        document.getElementById('enable-anilist').checked = items.enableAnilist;
        document.getElementById('enable-voiranime').checked = items.enableVoiranime;

        document.getElementById('enable-crunchyroll').checked = items.enableCrunchyroll;
        document.getElementById('enable-adkami').checked = items.enableAdkami;
        document.getElementById('enable-adn').checked = items.enableAdn;
        document.getElementById('enable-gumgum').checked = items.enableGumgum;
        document.getElementById('enable-twitch-rewards').checked = items.enableTwitchRewards;
        document.getElementById('enable-toasts').checked = items.enableToasts;

        updateThemePreview(items.theme);
    });
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

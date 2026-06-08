// Détecte la pop-up anti-adblock YouTube ("La lecture de votre vidéo se bloque ?" / "Discover why")
// et recharge la page après un compte à rebours de 3 secondes affiché à côté du bouton.
(() => {
const DEFAULTS = {
    enableYoutubeAdblockReload: true
};
const config = { ...DEFAULTS };

const TIMER_ATTR = 'data-sidhm-adblock-timer';
const COUNTDOWN_SECONDS = 3;
const STYLE_ID = 'sidhm-adblock-timer-style';
const LABELS = ['découvrez pourquoi', 'découvrir pourquoi', 'discover why', 'descubrir por qué', 'descobrir o motivo', 'warum'];
// Textes du message lui-même (le toast change parfois et n'expose plus de bouton avec un label connu)
const MESSAGES = [
    'la lecture de votre vidéo se bloque',
    'la lecture de la vidéo se bloque',
    'video playback is blocked',
    'video playback blocked',
    'playback is blocked',
    'reproducción de tu vídeo se bloquea',
    'reprodução do seu vídeo está bloqueada',
    'wiedergabe deines videos wird blockiert',
];

let timerActive = false;
let timerEl = null;
let intervalId = null;
let observer = null;

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
tp-yt-paper-toast.sidhm-adblock-host {
    max-width: 640px !important;
}
.sidhm-adblock-timer {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 10px;
    padding: 6px 12px;
    background: rgba(107, 70, 193, 0.92);
    color: #fff;
    border-radius: 999px;
    font: 600 13px/1 "YouTube Sans", Roboto, Arial, sans-serif;
    white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    animation: sidhmAdblockPulse 1s ease-in-out infinite;
    vertical-align: middle;
    pointer-events: none;
    flex-shrink: 0;
}
.sidhm-adblock-timer-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    background: #fff;
    color: #6b46c1;
    border-radius: 999px;
    font-weight: 700;
    font-size: 12px;
}
@keyframes sidhmAdblockPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.04); }
}`;
    document.head.appendChild(s);
}

function isToastVisible(toast) {
    if (!toast) return false;
    if (toast.getAttribute('aria-hidden') === 'true') return false;
    const style = toast.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(style)) return false;
    return toast.offsetParent !== null || getComputedStyle(toast).display !== 'none';
}

function matchesAdblockLabel(el) {
    const text = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (!text) return false;
    return LABELS.some(label => text === label || text.startsWith(label) || text.endsWith(label));
}

function containerHasAdblockMessage(scope) {
    if (!scope) return false;
    // Limite à 1000 chars pour éviter de scanner toute la page
    const text = (scope.textContent || '').trim().toLowerCase().slice(0, 1000);
    if (!text) return false;
    return MESSAGES.some(msg => text.includes(msg));
}

function findActionButton(scope) {
    if (!scope) return null;
    const candidates = scope.querySelectorAll('#action-button a, #action-button button, yt-button-renderer a, yt-button-renderer button, yt-button-shape a, yt-button-shape button, button, a');
    for (const el of candidates) {
        if (matchesAdblockLabel(el)) return el;
    }
    // Fallback : premier bouton/lien visible du toast (souvent le CTA principal)
    for (const el of candidates) {
        if (el.offsetParent !== null) return el;
    }
    return null;
}

function findDiscoverButton() {
    // Cas 1 : toast en bas de page (yt-notification-action-renderer)
    const toasts = document.querySelectorAll('yt-notification-action-renderer tp-yt-paper-toast');
    for (const toast of toasts) {
        if (!isToastVisible(toast)) continue;
        // 1a : label de bouton connu
        const link = toast.querySelector('#action-button a, yt-button-renderer a, yt-button-shape a, button, a');
        if (link && matchesAdblockLabel(link)) return { button: link, host: toast };
        // 1b : nouveau format — détection par le texte du message
        if (containerHasAdblockMessage(toast)) {
            const fallbackBtn = findActionButton(toast);
            return { button: fallbackBtn || toast, host: toast };
        }
    }
    // Cas 2 : mealbar / banner / enforcement / dialog
    // Note : on évite ytd-popup-container direct (sous-arbre énorme) — on scanne ses dialogs ouverts.
    const scopes = [
        ...document.querySelectorAll('ytd-enforcement-message-view-model'),
        ...document.querySelectorAll('yt-mealbar-promo-renderer'),
        ...document.querySelectorAll('ytd-banner-promo-renderer'),
        ...document.querySelectorAll('ytd-popup-container tp-yt-paper-dialog'),
        ...document.querySelectorAll('tp-yt-paper-dialog[opened]'),
    ];
    for (const scope of scopes) {
        const candidates = scope.querySelectorAll('button, a, yt-button-shape, tp-yt-paper-button');
        for (const el of candidates) {
            if (matchesAdblockLabel(el)) {
                return { button: el.querySelector('button, a') || el, host: null };
            }
        }
        // Fallback : message connu dans la modale
        if (containerHasAdblockMessage(scope)) {
            const fallbackBtn = findActionButton(scope);
            return { button: fallbackBtn || scope, host: null };
        }
    }
    return null;
}

let hostToast = null;

function injectTimer({ button, host }) {
    if (timerActive) return;
    // Si on n'a pas trouvé de vrai bouton, "button" est le container (toast/scope) lui-même
    const buttonIsContainer = button === host || button.matches?.('tp-yt-paper-toast, ytd-enforcement-message-view-model, ytd-popup-container, tp-yt-paper-dialog, yt-mealbar-promo-renderer, ytd-banner-promo-renderer');
    const anchor = buttonIsContainer
        ? button
        : (button.closest('yt-button-renderer, button-view-model, yt-button-shape') || button);
    const dupScope = buttonIsContainer ? anchor : anchor.parentElement;
    if (dupScope?.querySelector(`[${TIMER_ATTR}]`)) return;

    ensureStyle();
    timerActive = true;
    if (host) {
        host.classList.add('sidhm-adblock-host');
        hostToast = host;
    }

    const timer = document.createElement('span');
    timer.className = 'sidhm-adblock-timer';
    timer.setAttribute(TIMER_ATTR, '1');

    const num = document.createElement('span');
    num.className = 'sidhm-adblock-timer-num';
    num.textContent = String(COUNTDOWN_SECONDS);

    const label = document.createElement('span');
    label.textContent = 'Rechargement dans';

    timer.append(label, num);
    if (buttonIsContainer) {
        // Append à l'intérieur du toast/modale, comme une nouvelle ligne en bas
        timer.style.display = 'inline-flex';
        timer.style.margin = '8px 12px';
        anchor.appendChild(timer);
    } else {
        anchor.insertAdjacentElement('afterend', timer);
    }
    timerEl = timer;

    let remaining = COUNTDOWN_SECONDS;
    intervalId = setInterval(() => {
        if (!config.enableYoutubeAdblockReload) {
            cleanupTimer();
            return;
        }
        remaining--;
        if (remaining <= 0) {
            clearInterval(intervalId);
            intervalId = null;
            label.textContent = 'Rechargement…';
            num.textContent = '0';
            location.reload();
            return;
        }
        num.textContent = String(remaining);
    }, 1000);
}

function cleanupTimer() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
    if (timerEl?.isConnected) timerEl.remove();
    if (hostToast?.isConnected) hostToast.classList.remove('sidhm-adblock-host');
    hostToast = null;
    timerEl = null;
    timerActive = false;
}

function check() {
    if (!config.enableYoutubeAdblockReload || timerActive) return;
    const found = findDiscoverButton();
    if (found) injectTimer(found);
}

let checkScheduled = false;
function scheduleCheck() {
    if (checkScheduled) return;
    checkScheduled = true;
    requestAnimationFrame(() => {
        checkScheduled = false;
        check();
    });
}

function startObserver() {
    if (observer) return;
    // Debounce via rAF : YouTube génère beaucoup de mutations, inutile de scanner à chacune
    observer = new MutationObserver(() => scheduleCheck());
    // childList + attributes : le toast existe avant d'apparaître, il bascule via aria-hidden/style
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-hidden', 'style']
    });
}

function stopObserver() {
    observer?.disconnect();
    observer = null;
}

chrome.storage.sync.get(DEFAULTS, items => {
    Object.assign(config, items);
    if (config.enableYoutubeAdblockReload) {
        startObserver();
        check();
    }
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.enableYoutubeAdblockReload) {
        config.enableYoutubeAdblockReload = changes.enableYoutubeAdblockReload.newValue;
        if (config.enableYoutubeAdblockReload) {
            startObserver();
            check();
        } else {
            cleanupTimer();
            stopObserver();
        }
    }
});

document.addEventListener('yt-navigate-finish', () => {
    cleanupTimer();
    if (config.enableYoutubeAdblockReload) setTimeout(check, 500);
});
})();

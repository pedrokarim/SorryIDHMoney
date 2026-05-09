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

function findDiscoverButton() {
    // Cas 1 : toast en bas de page (yt-notification-action-renderer)
    const toasts = document.querySelectorAll('yt-notification-action-renderer tp-yt-paper-toast');
    for (const toast of toasts) {
        if (!isToastVisible(toast)) continue;
        const link = toast.querySelector('#action-button a, yt-button-renderer a, yt-button-shape a, button, a');
        if (link && matchesAdblockLabel(link)) return { button: link, host: toast };
    }
    // Cas 2 : modale plein écran (ytd-enforcement-message-view-model / popup container)
    const scopes = [
        ...document.querySelectorAll('ytd-enforcement-message-view-model'),
        ...document.querySelectorAll('ytd-popup-container'),
        ...document.querySelectorAll('tp-yt-paper-dialog'),
    ];
    for (const scope of scopes) {
        const candidates = scope.querySelectorAll('button, a, yt-button-shape, tp-yt-paper-button');
        for (const el of candidates) {
            if (matchesAdblockLabel(el)) {
                return { button: el.querySelector('button, a') || el, host: null };
            }
        }
    }
    return null;
}

let hostToast = null;

function injectTimer({ button, host }) {
    if (timerActive) return;
    const anchor = button.closest('yt-button-renderer, button-view-model, yt-button-shape') || button;
    if (anchor.parentElement?.querySelector(`[${TIMER_ATTR}]`)) return;

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
    anchor.insertAdjacentElement('afterend', timer);
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

function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => check());
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

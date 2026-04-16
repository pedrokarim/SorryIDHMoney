// Auto-scroll des YouTube Shorts.
// Détection fin de vidéo via timeupdate (YouTube force video.loop=true).
// Bouton injecté dans la barre d'actions native de chaque short.
const toastScript = chrome.runtime.getURL('libs/toast-manager.js');
let showToast = () => {};
import(toastScript).then(m => { showToast = m.showToast; }).catch(() => {});

const DEFAULTS = {
    enableYoutubeShortsAutoscroll: false,
    youtubeShortsReplayCount: 0,
    youtubeShortsScrollDelay: 0
};
const config = { ...DEFAULTS };

let lastTime = 0;
let reachedEnd = false;
let playCount = 0;
let scrollTimer = null;
let activeOverlay = null;

function isShortsPage() {
    return location.pathname.startsWith('/shorts/');
}

function goToNext() {
    const btn = document.querySelector('button[aria-label="Vidéo suivante"]')
             || document.querySelector('button[aria-label="Next video"]')
             || document.querySelector('#navigation-button-down button');
    if (btn && !btn.disabled) { btn.click(); return; }
    document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true, cancelable: true
    }));
}

function handleEnd(video) {
    if (!config.enableYoutubeShortsAutoscroll || !isShortsPage()) return;
    if (playCount < Number(config.youtubeShortsReplayCount)) {
        playCount++;
        try { video.currentTime = 0; video.play().catch(() => {}); } catch {}
        return;
    }
    playCount = 0;
    const delay = Math.max(0, Number(config.youtubeShortsScrollDelay) || 0);
    clearTimeout(scrollTimer);
    clearOverlay();
    if (delay >= 250) {
        showCountdownOverlay(video, delay);
    }
    scrollTimer = setTimeout(() => { clearOverlay(); goToNext(); }, delay);
}

// --- Overlay de countdown avec blur ---

function ensureOverlayStyle() {
    if (document.getElementById('sidhm-shorts-overlay-style')) return;
    const s = document.createElement('style');
    s.id = 'sidhm-shorts-overlay-style';
    s.textContent = `
.sidhm-shorts-overlay {
    position: absolute; inset: 0; z-index: 10;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
    background: rgba(0,0,0,0.35);
    animation: sidhmFadeIn 0.25s ease-out;
    pointer-events: none;
}
.sidhm-shorts-overlay.closing { animation: sidhmFadeOut 0.2s ease-in forwards; }
@keyframes sidhmFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes sidhmFadeOut { from { opacity: 1; } to { opacity: 0; } }
.sidhm-shorts-ring { position: relative; width: 96px; height: 96px; }
.sidhm-shorts-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.sidhm-shorts-ring circle { fill: none; stroke-width: 6; stroke-linecap: round; }
.sidhm-shorts-ring .track { stroke: rgba(255,255,255,0.2); }
.sidhm-shorts-ring .progress {
    stroke: #6b46c1;
    stroke-dasharray: var(--circ);
    stroke-dashoffset: 0;
    animation: sidhmProgress var(--dur) linear forwards;
}
@keyframes sidhmProgress { to { stroke-dashoffset: var(--circ); } }
.sidhm-shorts-ring .count {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    font: 600 32px/1 Roboto, Arial, sans-serif;
    color: #fff;
    text-shadow: 0 2px 6px rgba(0,0,0,0.5);
}`;
    document.head.appendChild(s);
}

function showCountdownOverlay(video, delayMs) {
    ensureOverlayStyle();
    const container = video.closest('ytd-reel-video-renderer')?.querySelector('#short-video-container')
                   || video.closest('ytd-reel-video-renderer')
                   || video.parentElement;
    if (!container) return;
    if (getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }

    const overlay = document.createElement('div');
    overlay.className = 'sidhm-shorts-overlay';

    const ring = document.createElement('div');
    ring.className = 'sidhm-shorts-ring';

    const R = 44;
    const CIRC = 2 * Math.PI * R;
    const SVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 96 96');
    for (const cls of ['track', 'progress']) {
        const c = document.createElementNS(SVG, 'circle');
        c.setAttribute('cx', '48'); c.setAttribute('cy', '48'); c.setAttribute('r', String(R));
        c.setAttribute('class', cls);
        svg.appendChild(c);
    }
    ring.appendChild(svg);
    ring.style.setProperty('--circ', String(CIRC));
    ring.style.setProperty('--dur', `${delayMs}ms`);

    const count = document.createElement('div');
    count.className = 'count';
    count.textContent = String(Math.ceil(delayMs / 1000));
    ring.appendChild(count);

    overlay.appendChild(ring);
    container.appendChild(overlay);

    const start = performance.now();
    const tick = () => {
        if (!overlay.isConnected) return;
        const left = delayMs - (performance.now() - start);
        if (left <= 0) return;
        count.textContent = String(Math.ceil(left / 1000));
        activeOverlay.rafId = requestAnimationFrame(tick);
    };
    activeOverlay = { overlay, rafId: requestAnimationFrame(tick) };
}

function clearOverlay() {
    if (!activeOverlay) return;
    cancelAnimationFrame(activeOverlay.rafId);
    const { overlay } = activeOverlay;
    activeOverlay = null;
    if (!overlay || !overlay.isConnected) return;
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 200);
}

document.addEventListener('ended', e => {
    if (e.target instanceof HTMLVideoElement) handleEnd(e.target);
}, true);

document.addEventListener('timeupdate', e => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || !isShortsPage()) return;
    if (v.loop) v.loop = false;
    if (!v.duration || !isFinite(v.duration)) return;
    if (v.duration - v.currentTime < 0.3) {
        reachedEnd = true;
    } else if (reachedEnd && v.currentTime < lastTime - 0.5) {
        reachedEnd = false;
        handleEnd(v);
    }
    lastTime = v.currentTime;
}, true);

document.addEventListener('play', e => {
    if (e.target instanceof HTMLVideoElement) { reachedEnd = false; playCount = 0; }
}, true);

// --- Bouton injecté dans la barre d'actions ---
const BUTTON_ATTR = 'data-sidhm-shorts-btn';

function buildSvgArrow() {
    const SVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const d of ['M12 5v14', 'M19 12l-7 7-7-7']) {
        const p = document.createElementNS(SVG, 'path');
        p.setAttribute('d', d);
        svg.appendChild(p);
    }
    return svg;
}

function ensureButton() {
    if (!isShortsPage()) return;
    const bar = document.querySelector('reel-action-bar-view-model');
    if (!bar) return;
    // Si déjà présent dans cette barre, juste mettre à jour l'état
    const existing = bar.querySelector(`[${BUTTON_ATTR}]`);
    if (existing) { updateButton(); return; }
    // Retirer d'éventuels boutons orphelins dans d'autres barres
    document.querySelectorAll(`[${BUTTON_ATTR}]`).forEach(el => el.remove());

    const wrapper = document.createElement('div');
    wrapper.setAttribute(BUTTON_ATTR, '1');
    wrapper.className = 'ytwReelActionBarViewModelHostDesktopActionButton';
    wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-l yt-spec-button-shape-next--icon-button';
    btn.appendChild(buildSvgArrow());
    btn.addEventListener('click', () => {
        const next = !config.enableYoutubeShortsAutoscroll;
        config.enableYoutubeShortsAutoscroll = next;
        chrome.storage.sync.set({ enableYoutubeShortsAutoscroll: next });
        showToast(next ? 'Auto-scroll activé' : 'Auto-scroll désactivé', {
            type: next ? 'info' : 'warning', duration: 1800
        });
        updateButton();
    });

    const label = document.createElement('div');
    label.className = 'sidhm-shorts-label';
    label.textContent = 'Auto';
    label.style.cssText = 'font-size:12px;color:#fff;font-family:Roboto,Arial,sans-serif;';

    wrapper.appendChild(btn);
    wrapper.appendChild(label);
    bar.prepend(wrapper);
    updateButton();
}

function updateButton() {
    const wrapper = document.querySelector(`[${BUTTON_ATTR}]`);
    if (!wrapper) return;
    const btn = wrapper.querySelector('button');
    const on = !!config.enableYoutubeShortsAutoscroll;
    btn.style.background = on ? 'rgba(107,70,193,.9)' : '';
    btn.style.color = on ? '#fff' : '';
    btn.title = on ? 'Auto-scroll : ON' : 'Auto-scroll : OFF';
}

function removeButton() {
    document.querySelectorAll(`[${BUTTON_ATTR}]`).forEach(el => el.remove());
}

// Init
chrome.storage.sync.get(DEFAULTS, items => {
    Object.assign(config, items);
    if (isShortsPage()) tryInsertButton();
});

// Tentative robuste : la barre d'actions peut ne pas être là au moment du premier appel.
function tryInsertButton(retries = 10) {
    if (!isShortsPage()) return;
    if (document.querySelector('reel-action-bar-view-model')) { ensureButton(); return; }
    if (retries <= 0) return;
    setTimeout(() => tryInsertButton(retries - 1), 300);
}

document.addEventListener('yt-navigate-finish', () => {
    if (isShortsPage()) tryInsertButton(); else removeButton();
});

chrome.runtime.onMessage.addListener(req => {
    if (req.action !== 'updateYoutubeShortsAutoscroll') return;
    if (req.config) for (const k of Object.keys(DEFAULTS)) if (k in req.config) config[k] = req.config[k];
    if (typeof req.enabled === 'boolean') config.enableYoutubeShortsAutoscroll = req.enabled;
    updateButton();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(DEFAULTS)) if (changes[k]) config[k] = changes[k].newValue;
    updateButton();
});

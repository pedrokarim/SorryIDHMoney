// Lecture fluide — recharge une fois une page vidéo YouTube quand elle démarre dans un
// état instable.
//
// Contexte : certaines vidéos démarrent parfois mal (la lecture se fige au démarrage —
// play/pause immédiat, timer bloqué à 0). Recharger une fois la page repart sur un état
// propre et la lecture démarre normalement.
//
// Détail : YouTube est une SPA (Polymer). Cliquer une vidéo fait une navigation côté client
// (pushState) — PAS un vrai rechargement. On force donc un location.reload() à chaque
// arrivée sur une nouvelle vidéo.
//
// Anti-boucle : chaque ID de vidéo n'est rechargé qu'UNE fois, mémorisé dans sessionStorage
// (qui survit au reload dans le même onglet). Fail-safe : si le flag ne peut pas être posé
// ou lu, on ne recharge PAS — jamais de boucle infinie.
(() => {
const LOG = '[SmoothPlayback]';
const STATE_KEY = 'sidhmYtSmoothPlayback';
const MAX_TRACKED = 100; // borne la liste des IDs mémorisés

let enabled = true;      // valeur du toggle config (défaut : activé)
let configLoaded = false;

function currentVideoId() {
    try {
        const u = new URL(location.href);
        if (u.pathname !== '/watch') return null; // uniquement les pages vidéo
        return u.searchParams.get('v');
    } catch { return null; }
}

// Renvoie null si sessionStorage est inaccessible (pour déclencher le fail-safe)
function getHandledSet() {
    try { return new Set(JSON.parse(sessionStorage.getItem(STATE_KEY) || '[]')); }
    catch { return null; }
}

function alreadyHandled(id) {
    const set = getHandledSet();
    return set ? set.has(id) : true; // storage HS → on considère "déjà fait" pour ne pas boucler
}

function markHandled(id) {
    try {
        const set = getHandledSet() || new Set();
        set.add(id);
        sessionStorage.setItem(STATE_KEY, JSON.stringify([...set].slice(-MAX_TRACKED)));
        return true;
    } catch { return false; }
}

function handleArrival() {
    if (!configLoaded || !enabled) return; // toggle off (ou config pas encore chargée) → rien
    const id = currentVideoId();
    if (!id) return;               // pas une page vidéo
    if (alreadyHandled(id)) return; // déjà traitée une fois (ou storage HS → on s'abstient)
    if (!markHandled(id)) return;  // impossible de poser le flag → pas de reload (anti-boucle)
    console.info(`${LOG} nouvelle vidéo ${id}, rafraîchissement du player…`);
    location.reload();
}

// Navigation SPA (clic sur une vidéo, vidéo suivante, playlist) : pas de vrai reload → on force
document.addEventListener('yt-navigate-finish', handleArrival);

// Lecture du toggle config, puis évaluation du chargement initial (URL tapée, onglet, refresh)
chrome.storage.sync.get({ enableYoutubeSmoothPlayback: true }, items => {
    enabled = items.enableYoutubeSmoothPlayback;
    configLoaded = true;
    handleArrival();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enableYoutubeSmoothPlayback) {
        enabled = changes.enableYoutubeSmoothPlayback.newValue;
    }
});
})();

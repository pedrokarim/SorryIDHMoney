// Recharge une fois chaque page vidéo YouTube à l'arrivée dessus.
//
// Contexte : avec uBlock, l'enforcement anti-adblock fait glitcher le player au premier
// affichage (play/pause instantané, timer qui retombe à 0). Un simple rechargement de la
// page corrige le souci de façon fiable.
//
// Problème : YouTube est une SPA (Polymer). Cliquer une vidéo fait une navigation côté
// client (pushState) — PAS un vrai rechargement. On force donc un location.reload() à
// chaque arrivée sur une nouvelle vidéo.
//
// Anti-boucle : chaque ID de vidéo n'est rechargé qu'UNE fois, mémorisé dans sessionStorage
// (qui survit au reload dans le même onglet). Fail-safe : si le flag ne peut pas être posé
// ou lu, on ne recharge PAS — jamais de boucle infinie.
(() => {
const LOG = '[YoutubeAutoReload]';
const RELOAD_KEY = 'sidhmYtAutoReloaded';
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
function getReloadedSet() {
    try { return new Set(JSON.parse(sessionStorage.getItem(RELOAD_KEY) || '[]')); }
    catch { return null; }
}

function alreadyReloaded(id) {
    const set = getReloadedSet();
    return set ? set.has(id) : true; // storage HS → on considère "déjà fait" pour ne pas boucler
}

function markReloaded(id) {
    try {
        const set = getReloadedSet() || new Set();
        set.add(id);
        sessionStorage.setItem(RELOAD_KEY, JSON.stringify([...set].slice(-MAX_TRACKED)));
        return true;
    } catch { return false; }
}

function handleArrival() {
    if (!configLoaded || !enabled) return; // toggle off (ou config pas encore chargée) → rien
    const id = currentVideoId();
    if (!id) return;                 // pas une page vidéo
    if (alreadyReloaded(id)) return; // déjà rechargée une fois (ou storage HS → on s'abstient)
    if (!markReloaded(id)) return;   // impossible de poser le flag → pas de reload (anti-boucle)
    console.info(`${LOG} nouvelle vidéo ${id}, rechargement…`);
    location.reload();
}

// Navigation SPA (clic sur une vidéo, vidéo suivante, playlist) : pas de vrai reload → on force
document.addEventListener('yt-navigate-finish', handleArrival);

// Lecture du toggle config, puis évaluation du chargement initial (URL tapée, onglet, refresh)
chrome.storage.sync.get({ enableYoutubeAutoReload: true }, items => {
    enabled = items.enableYoutubeAutoReload;
    configLoaded = true;
    handleArrival();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.enableYoutubeAutoReload) {
        enabled = changes.enableYoutubeAutoReload.newValue;
    }
});
})();

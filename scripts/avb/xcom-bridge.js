/*
 * xcom-bridge.js — Pont ISOLATED entre le script MAIN world (xcom-bypass.js) et
 * le reste de l'extension, sur x.com / twitter.com.
 *
 * Deux roles :
 *  1. Visibilite de la pastille de statut : ajoute/retire la classe
 *     `avb-xcom-show-dot` sur <html> selon la config (defaut : cachee).
 *     Le CSS de la pastille (injecte par xcom-bypass.js en MAIN world) ne
 *     l'affiche que si cette classe est presente — DOM partage entre les mondes.
 *  2. Statut pour la popup : repond aux messages { action: 'getXcomStatus' } en
 *     lisant le statut mirroré dans document.documentElement.dataset par le
 *     script MAIN world.
 *
 * Content script declare au manifest (document_start). Leger : ne fait rien de
 * visible tant que le module X n'est pas actif.
 */

const AVB_XCOM_KEYS = {
  enableAgeVerifBypass: true,
  enableAvbXcom: true,
  enableAvbXcomIndicator: false,
};

function getCfg() {
  return new Promise((r) => chrome.storage.sync.get(AVB_XCOM_KEYS, r));
}

// Affiche la pastille seulement si module actif ET option pastille cochee.
function applyDotVisibility(cfg) {
  const show =
    cfg.enableAgeVerifBypass && cfg.enableAvbXcom && cfg.enableAvbXcomIndicator;
  document.documentElement.classList.toggle('avb-xcom-show-dot', show);
}

(async () => {
  try {
    applyDotVisibility(await getCfg());
  } catch (err) {
    console.error('[AVB/xcom-bridge] init:', err);
  }
})();

// Reagit en direct aux changements des toggles concernes.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (
    'enableAgeVerifBypass' in changes ||
    'enableAvbXcom' in changes ||
    'enableAvbXcomIndicator' in changes
  ) {
    getCfg().then(applyDotVisibility);
  }
});

// Repond aux requetes de statut de la popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== 'getXcomStatus') return; // pas pour nous

  const ds = document.documentElement.dataset;
  const rawStatus = ds.avbXcomStatus || null; // 'ok' | 'err' | null
  const hooks = ds.avbXcomHooks ? ds.avbXcomHooks.split(',').filter(Boolean) : [];

  getCfg().then((cfg) => {
    const moduleEnabled = cfg.enableAgeVerifBypass && cfg.enableAvbXcom;
    sendResponse({
      moduleEnabled,
      active: moduleEnabled && rawStatus !== null, // le script MAIN a bien tourne
      status: rawStatus, // 'ok' | 'err' | null
      hooks,
      indicator: cfg.enableAvbXcomIndicator,
    });
  });
  return true; // reponse asynchrone
});

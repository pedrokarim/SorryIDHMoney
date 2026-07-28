/*
 * avb-manager.js — Controleur du module "Bypass verification d'age".
 *
 * Importe (avec effet de bord) par background.js. Responsable de traduire les
 * toggles de config (chrome.storage.sync) en :
 *   1. regles declarativeNetRequest dynamiques qui redirigent les SDK des
 *      verificateurs (agechecker, agego, ageverif, veriff) vers les scripts
 *      "spoof" embarques dans scripts/avb/spoofs/.
 *   2. enregistrement (chrome.scripting) du proxy fetch MAIN world sur bsky.app.
 *
 * Les content scripts DOM (reddit, aliexpress) sont declares dans le manifest et
 * se protegent eux-memes via storage — ils ne passent pas par ici.
 *
 * Port Chromium/Brave de age-verification-bypass (helloyanis). Voir README.md
 * pour la correspondance avec les scripts Firefox d'origine et les limites.
 */

// Defauts de config. Doit rester aligne avec interfaces/options.js.
const AVB_DEFAULTS = {
  enableAgeVerifBypass: true, // toggle maitre
  enableAvbAgechecker: true,
  enableAvbAgego: true,
  enableAvbAgeverif: true,
  enableAvbVeriff: true,
  enableAvbBsky: true,
  enableAvbXcom: true,
  // enableAvbReddit / enableAvbAliexpress sont geres cote content script.
};

// Cle enable -> regle(s) DNR. Les ids sont fixes et reserves a ce module
// (plage 9000+) pour ne pas entrer en collision avec d'eventuelles autres
// regles dynamiques.
const DNR_RULES = [
  {
    key: "enableAvbAgechecker",
    id: 9001,
    urlFilter: "||cdn.agechecker.net/static/popup/v1/popup.js",
    extensionPath: "/scripts/avb/spoofs/agechecker-popup.js",
  },
  {
    key: "enableAvbAgego",
    id: 9002,
    urlFilter: "||verifycdn.agego.com/v1/verify.js",
    extensionPath: "/scripts/avb/spoofs/agego-verify.js",
  },
  {
    key: "enableAvbAgeverif",
    id: 9003,
    urlFilter: "||www.ageverif.com/checker.js",
    extensionPath: "/scripts/avb/spoofs/ageverif-checker.js",
  },
  {
    key: "enableAvbVeriff",
    id: 9004,
    urlFilter: "||cdn.veriff.me/sdk/js/1.5/veriff.min.js",
    extensionPath: "/scripts/avb/spoofs/veriff-sdk.js",
  },
  {
    key: "enableAvbVeriff",
    id: 9005,
    urlFilter: "||cdn.veriff.me/incontext/js/v2.5.0/veriff.js",
    extensionPath: "/scripts/avb/spoofs/veriff-incontext.js",
  },
];

const ALL_RULE_IDS = DNR_RULES.map((r) => r.id);

// Content scripts MAIN world (ne peuvent pas lire storage) enregistres/retires
// dynamiquement selon la config, plutot que declares au manifest.
const MAIN_WORLD_SCRIPTS = [
  {
    id: "avb-bsky-proxy",
    key: "enableAvbBsky",
    matches: ["https://bsky.app/*"],
    js: ["scripts/avb/bsky-proxy.js"],
  },
  {
    id: "avb-xcom",
    key: "enableAvbXcom",
    matches: ["https://x.com/*", "https://twitter.com/*"],
    js: ["scripts/avb/xcom-bypass.js"],
  },
];

function getConfig() {
  return new Promise((resolve) => chrome.storage.sync.get(AVB_DEFAULTS, resolve));
}

/**
 * Recalcule les regles DNR a partir de la config et les applique.
 * Master off => aucune regle.
 */
async function syncDnrRules(cfg) {
  const addRules = [];

  if (cfg.enableAgeVerifBypass) {
    for (const rule of DNR_RULES) {
      if (!cfg[rule.key]) continue;
      addRules.push({
        id: rule.id,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { extensionPath: rule.extensionPath },
        },
        condition: {
          urlFilter: rule.urlFilter,
          resourceTypes: ["script"],
        },
      });
    }
  }

  try {
    // On retire d'abord toutes nos regles (celles a re-ajouter comprises) puis
    // on ajoute l'ensemble desire — updateDynamicRules est atomique.
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ALL_RULE_IDS,
      addRules,
    });
  } catch (err) {
    console.error("[AVB] updateDynamicRules a echoue:", err);
  }
}

/**
 * Enregistre ou retire chaque content script MAIN world selon la config.
 * MAIN world ne peut pas lire chrome.storage, d'ou la gestion depuis le SW.
 */
async function syncMainWorldScripts(cfg) {
  for (const spec of MAIN_WORLD_SCRIPTS) {
    const shouldRun = cfg.enableAgeVerifBypass && cfg[spec.key];

    let isRegistered = false;
    try {
      const registered = await chrome.scripting.getRegisteredContentScripts({
        ids: [spec.id],
      });
      isRegistered = registered.length > 0;
    } catch {
      isRegistered = false;
    }

    const definition = {
      id: spec.id,
      matches: spec.matches,
      js: spec.js,
      runAt: "document_start",
      world: "MAIN",
      allFrames: false,
    };

    try {
      if (shouldRun) {
        if (isRegistered) {
          // Deja enregistre (les enregistrements persistent entre les reveils du
          // SW) -> on met a jour au lieu de re-enregistrer (evite "Duplicate id").
          await chrome.scripting.updateContentScripts([definition]);
        } else {
          try {
            await chrome.scripting.registerContentScripts([definition]);
          } catch (err) {
            // Course possible entre deux syncAll : si un autre passage vient de
            // l'enregistrer, on bascule sur update plutot que de logger une erreur.
            if (String(err?.message || err).includes("Duplicate script ID")) {
              await chrome.scripting.updateContentScripts([definition]);
            } else {
              throw err;
            }
          }
        }
      } else if (isRegistered) {
        await chrome.scripting.unregisterContentScripts({ ids: [spec.id] });
      }
    } catch (err) {
      console.error(`[AVB] (un)registerContentScripts ${spec.id} a echoue:`, err);
    }
  }
}

async function runSync() {
  const cfg = await getConfig();
  await Promise.all([syncDnrRules(cfg), syncMainWorldScripts(cfg)]);
}

// Mutex : plusieurs declencheurs (import du module, onInstalled, onStartup,
// storage.onChanged) peuvent appeler syncAll quasi simultanement. On les
// serialise pour eviter les courses (ex. double registerContentScripts).
let syncChain = Promise.resolve();
function syncAll() {
  syncChain = syncChain.then(runSync, runSync);
  return syncChain;
}

// --- Cablage cycle de vie du service worker ---------------------------------

chrome.runtime.onInstalled.addListener(() => {
  syncAll();
});

chrome.runtime.onStartup.addListener(() => {
  syncAll();
});

// Re-synchronise des qu'un toggle AVB change.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const touched = Object.keys(changes).some(
    (k) => k === "enableAgeVerifBypass" || k in AVB_DEFAULTS
  );
  if (touched) syncAll();
});

// Sync initial au demarrage du module (couvre le reveil du SW MV3).
syncAll();

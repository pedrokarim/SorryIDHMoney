// by @AliasPedroKarim
// Injecte les boutons AniList / MAL / Info sur les pages ADN (Animation Digital Network)
// Supporte les pages série (/video/{id}-{slug}) et épisode (/video/{id}-{slug}/{epId}-episode-{n})
// ADN est une SPA React — retry polling comme Crunchyroll

const srcUtils = chrome.runtime.getURL("scripts/utils.js");
const animeCacheScript = chrome.runtime.getURL("scripts/anime-cache-manager.js");

let animeCache;
let utils;

/**
 * Extrait le titre de l'anime depuis le JSON-LD (priorité) puis fallback DOM.
 * - Page série : TVSeries.name
 * - Page épisode : TVEpisode.partOfSeries.name
 */
function extractAnimeTitle() {
  const path = window.location.pathname;

  // /video/{id}-{slug} (série) ou /video/{id}-{slug}/{epId}-episode-{n} (épisode)
  const isVideoPage = /^\/video\/\d+-.+/.test(path);
  if (!isVideoPage) return null;

  const segments = path.replace(/^\/video\//, "").split("/").filter(Boolean);
  const isEpisodePage = segments.length >= 2;

  // 1. JSON-LD
  const ldTitle = extractTitleFromJsonLd(isEpisodePage);
  if (ldTitle) return ldTitle;

  // 2. Fallback DOM — h1 (sur la page série c'est propre, sur épisode c'est concaténé)
  if (!isEpisodePage) {
    const h1 = document.querySelector("h1");
    if (h1) return h1.textContent.trim();
  }

  // 3. og:title — "Titre - Anime en streaming..." (série) ou "Titre - 1 Épisode..." (épisode)
  const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
  if (ogTitle) return ogTitle.split(" - ")[0].trim();

  return null;
}

function extractTitleFromJsonLd(isEpisodePage) {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent);

      // Page épisode → TVEpisode.partOfSeries.name
      if (isEpisodePage && data["@type"] === "TVEpisode" && data.partOfSeries?.name) {
        return data.partOfSeries.name;
      }

      // Page série → TVSeries.name
      if (!isEpisodePage && data["@type"] === "TVSeries" && data.name) {
        return data.name;
      }
    }
  } catch {
    // JSON invalide
  }
  return null;
}

function extractAnilistIdFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "anilist.co") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] === "anime" && /^\d+$/.test(parts[1])) {
      return parts[1];
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  try {
    // Vérifier si la plateforme est activée
    const { enableAdn } = await new Promise(r =>
      chrome.storage.sync.get({ enableAdn: true }, r)
    );
    if (!enableAdn) return;

    const [cacheModule, utilsModule] = await Promise.all([
      import(animeCacheScript),
      import(srcUtils),
    ]);

    animeCache = cacheModule.animeCache;
    utils = utilsModule;

    await animeCache.ensureCacheReady();
    await waitForTitleAndInit();
  } catch (error) {
    console.error("[ADN] Erreur lors du chargement des modules:", error);
  }
}

/**
 * Attend que le titre soit détectable (React SPA).
 * Polling toutes les 500ms, max 15 tentatives (7.5s).
 */
async function waitForTitleAndInit() {
  const MAX_ATTEMPTS = 15;
  const INTERVAL = 500;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const title = extractAnimeTitle();
    if (title) {
      console.log(`[ADN] Titre trouvé (tentative ${attempt}): "${title}"`);
      initializeAnimeDetection(title);
      return;
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, INTERVAL));
    }
  }

  console.log("[ADN] Aucun titre trouvé après polling");
}

function initializeAnimeDetection(animeTitleRaw) {
  const {
    addCustomButton,
    addEditButtons,
    enableEditModeOnButtons,
    addInfoButton,
    animationCSS,
    injectCSSAnimation,
  } = utils;

  injectCSSAnimation(animationCSS());

  const animeTitle = animeTitleRaw.toLowerCase();

  async function onAnimeSelected(selection) {
    await animeCache.setCustomUrl(selection.animeName, selection.anilistUrl);
  }

  function addButtons(data) {
    if (data?.siteMalUrl || data?.malUrl) {
      addCustomButton("myanimelist", data.siteMalUrl || data.malUrl, { openInNewTab: true });
    }

    if (data?.siteUrl || data?.anilistUrl) {
      addCustomButton("anilist", data.siteUrl || data.anilistUrl, {
        styles: {
          left: `${20 * 2 + 50}px`,
        },
        openInNewTab: true,
      });
    }

    const hasFullData = !!(data?.description || data?.genres?.length || data?.coverImage);
    if (hasFullData) {
      addInfoButton(data);
    } else {
      const anilistUrl = data?.siteUrl || data?.anilistUrl;
      const id = anilistUrl ? extractAnilistIdFromUrl(anilistUrl) : null;
      if (id) {
        chrome.runtime.sendMessage({ action: "getAnilistMediaById", id }, (full) => {
          if (full) addInfoButton(full);
        });
      }
    }
  }

  // Mode édition
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "toggleEditMode" && message.enabled) {
      enableEditModeOnButtons(animeTitleRaw, onAnimeSelected);
    }
  });

  (async () => {
    try {
      const cachedResult = await animeCache.isInCache(animeTitle);

      if (cachedResult === true) {
        console.log(`[ADN] Anime ignoré: ${animeTitle}`);
        return;
      } else if (cachedResult) {
        console.log(`[ADN] URL personnalisée trouvée pour: ${animeTitle}`);
        addButtons({
          siteUrl: cachedResult.anilistUrl || cachedResult,
          malUrl: cachedResult.malUrl || null,
        });
        return;
      }

      chrome.runtime.sendMessage(
        { action: "getAnilistMedia", search: animeTitle },
        function (response) {
          if (!response) {
            addEditButtons(animeTitleRaw, onAnimeSelected);
            return;
          }
          addButtons(response);
        }
      );
    } catch (error) {
      console.error("[ADN] Erreur:", error);
    }
  })();
}

// ADN est une SPA React — surveiller les changements de navigation
let lastUrl = window.location.href;

function onNavigationChange() {
  const currentUrl = window.location.href;
  if (currentUrl === lastUrl) return;
  lastUrl = currentUrl;

  utils?.resetButton();
  waitForTitleAndInit();
}

const originalPushState = history.pushState;
history.pushState = function (...args) {
  originalPushState.apply(this, args);
  onNavigationChange();
};

const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
  originalReplaceState.apply(this, args);
  onNavigationChange();
};

window.addEventListener("popstate", onNavigationChange);

main().catch((error) => {
  console.error("[ADN] Erreur dans le script principal:", error);
});

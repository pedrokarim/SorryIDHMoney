// by @AliasPedroKarim
// Injecte les boutons AniList / MAL / Info sur les pages Crunchyroll
// Supporte les pages série (/series/) et épisode (/watch/)

const srcUtils = chrome.runtime.getURL("scripts/utils.js");
const animeCacheScript = chrome.runtime.getURL("scripts/anime-cache-manager.js");

let animeCache;
let utils;

/**
 * Extrait le titre de l'anime depuis la page Crunchyroll.
 * Priorité au JSON-LD (données structurées, stables) puis fallback DOM.
 */
function extractAnimeTitle() {
  const path = window.location.pathname;

  const isSeriesPage = /^\/[a-z]{2}\/series\//.test(path);
  const isWatchPage = /^\/[a-z]{2}\/watch\//.test(path);

  if (!isSeriesPage && !isWatchPage) return null;

  // 1. JSON-LD (source de vérité la plus fiable)
  const ldTitle = extractTitleFromJsonLd(isWatchPage);
  if (ldTitle) return ldTitle;

  // 2. Fallback DOM
  if (isWatchPage) {
    const showLink = document.querySelector('a[data-t="show-title-link"]');
    if (showLink) return showLink.textContent.trim();

    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (ogTitle && ogTitle.includes(" | ")) return ogTitle.split(" | ")[0].trim();
  }

  if (isSeriesPage) {
    const h1 = document.querySelector("h1");
    if (h1) return h1.textContent.trim();

    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (ogTitle) return ogTitle.replace(/^Watch\s+/i, "").trim();
  }

  return null;
}

/**
 * Extrait le titre de la série depuis les blocs JSON-LD.
 * - Page épisode : TVEpisode.partOfSeries.name (clean)
 * - Page série  : TVSeries.name (strip "Watch " prefix) ou BreadcrumbList
 */
function extractTitleFromJsonLd(isWatchPage) {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent);

      // Page épisode → TVEpisode.partOfSeries.name (le plus propre)
      if (isWatchPage && data["@type"] === "TVEpisode" && data.partOfSeries?.name) {
        return data.partOfSeries.name;
      }

      // Page série → TVSeries.name (a un prefix "Watch ")
      if (!isWatchPage && data["@type"] === "TVSeries" && data.name) {
        return data.name.replace(/^Watch\s+/i, "").trim();
      }
    }
  } catch {
    // JSON invalide, on ignore
  }
  return null;
}

/**
 * Extrait l'ID AniList depuis une URL anilist.co/anime/<id>
 */
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
    const { enableCrunchyroll } = await new Promise(r =>
      chrome.storage.sync.get({ enableCrunchyroll: true }, r)
    );
    if (!enableCrunchyroll) return;

    const [cacheModule, utilsModule] = await Promise.all([
      import(animeCacheScript),
      import(srcUtils),
    ]);

    animeCache = cacheModule.animeCache;
    utils = utilsModule;

    await animeCache.ensureCacheReady();
    await waitForTitleAndInit();
  } catch (error) {
    console.error("[Crunchyroll] Erreur lors du chargement des modules:", error);
  }
}

/**
 * Attend que le titre soit détectable (React peut mettre du temps à render).
 * Polling toutes les 500ms, max 15 tentatives (7.5s).
 */
async function waitForTitleAndInit() {
  const MAX_ATTEMPTS = 15;
  const INTERVAL = 500;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const title = extractAnimeTitle();
    if (title) {
      console.log(`[Crunchyroll] Titre trouvé (tentative ${attempt}): "${title}"`);
      initializeAnimeDetection(title);
      return;
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, INTERVAL));
    }
  }

  console.log("[Crunchyroll] Aucun titre trouvé après polling — page non supportée ou DOM incomplet");
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

  // Vérification cache puis recherche API
  (async () => {
    try {
      const cachedResult = await animeCache.isInCache(animeTitle);

      if (cachedResult === true) {
        console.log(`[Crunchyroll] Anime ignoré: ${animeTitle}`);
        return;
      } else if (cachedResult) {
        console.log(`[Crunchyroll] URL personnalisée trouvée pour: ${animeTitle}`);
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
      console.error("[Crunchyroll] Erreur:", error);
    }
  })();
}

// Crunchyroll est une SPA React — on surveille les changements de navigation
let lastUrl = window.location.href;

function onNavigationChange() {
  const currentUrl = window.location.href;
  if (currentUrl === lastUrl) return;
  lastUrl = currentUrl;

  // Nettoyer les anciens boutons
  utils?.resetButton();

  // Attendre que React re-render puis retry
  waitForTitleAndInit();
}

// Observer les changements d'URL (pushState / popstate)
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

// Lancement
main().catch((error) => {
  console.error("[Crunchyroll] Erreur dans le script principal:", error);
});

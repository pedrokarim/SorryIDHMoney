// by @AliasPedroKarim
// Injecte les boutons AniList / MAL / Info sur les pages ADKami
// Supporte les pages épisode (/anime/{id}/...) et info (/anime/{id}/info)

const srcUtils = chrome.runtime.getURL("scripts/utils.js");
const animeCacheScript = chrome.runtime.getURL("scripts/anime-cache-manager.js");

let animeCache;
let utils;

/**
 * Extrait les infos de l'anime depuis le JSON-LD (page épisode)
 * Retourne { name, malId, anilistId, mainUrl } ou null
 */
function extractFromJsonLd() {
  try {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (const script of scripts) {
      const data = JSON.parse(script.textContent);
      if (data.name && data.main_url) {
        return {
          name: data.name,
          malId: data.mal_id || null,
          anilistId: data.anilist_id || null,
          mainUrl: data.main_url,
        };
      }
    }
  } catch {
    // JSON invalide
  }
  return null;
}

/**
 * Extrait le titre depuis le DOM (h1.title-header-video)
 */
function extractFromDom() {
  const h1 = document.querySelector("h1.title-header-video");
  if (!h1) return null;

  let title = h1.textContent.trim();

  // Sur la page épisode le h1 contient "Titre - Episode X vostfr", on nettoie
  title = title.replace(/\s*-\s*Episode\s+\d+.*$/i, "").trim();

  return title || null;
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
  const path = window.location.pathname;
  if (!path.startsWith("/anime/")) return;

  try {
    // Vérifier si la plateforme est activée
    const { enableAdkami } = await new Promise(r =>
      chrome.storage.sync.get({ enableAdkami: true }, r)
    );
    if (!enableAdkami) return;

    const [cacheModule, utilsModule] = await Promise.all([
      import(animeCacheScript),
      import(srcUtils),
    ]);

    animeCache = cacheModule.animeCache;
    utils = utilsModule;

    await animeCache.ensureCacheReady();
    initializeAnimeDetection();
  } catch (error) {
    console.error("[ADKami] Erreur lors du chargement des modules:", error);
  }
}

function initializeAnimeDetection() {
  const {
    addCustomButton,
    addEditButtons,
    enableEditModeOnButtons,
    addInfoButton,
    animationCSS,
    injectCSSAnimation,
  } = utils;

  injectCSSAnimation(animationCSS());

  // 1. JSON-LD (page épisode — contient mal_id directement)
  const ldData = extractFromJsonLd();

  // 2. Fallback DOM
  const animeTitleRaw = ldData?.name || extractFromDom();
  if (!animeTitleRaw) return;

  console.log(`[ADKami] Titre trouvé: "${animeTitleRaw}"${ldData?.malId ? ` (MAL: ${ldData.malId})` : ""}`);

  const animeTitle = animeTitleRaw.toLowerCase();

  async function onAnimeSelected(selection) {
    await animeCache.setCustomUrl(selection.animeName, selection.anilistUrl);
  }

  function addButtons(data) {
    // MAL : utiliser mal_id du JSON-LD si dispo, sinon data de l'API
    const malUrl = data?.siteMalUrl || data?.malUrl
      || (ldData?.malId ? `https://myanimelist.net/anime/${ldData.malId}` : null);

    if (malUrl) {
      addCustomButton("myanimelist", malUrl, { openInNewTab: true });
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
        console.log(`[ADKami] Anime ignoré: ${animeTitle}`);
        return;
      } else if (cachedResult) {
        console.log(`[ADKami] URL personnalisée trouvée pour: ${animeTitle}`);
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
      console.error("[ADKami] Erreur:", error);
    }
  })();
}

main().catch((error) => {
  console.error("[ADKami] Erreur dans le script principal:", error);
});

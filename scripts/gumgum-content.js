// by @AliasPedroKarim
// Injecte les boutons AniList / MAL / Info sur Gum Gum Streaming
// WordPress classique — pas de SPA, pas de retry nécessaire
// Page série : /{slug}-vostfr/ ou /{slug}-vf/
// Page épisode : /{slug}-{n}-vostfr/ (article class "post" vs "page" pour la série)

const srcUtils = chrome.runtime.getURL("scripts/utils.js");
const animeCacheScript = chrome.runtime.getURL("scripts/anime-cache-manager.js");

let animeCache;
let utils;

/**
 * Extrait le titre de l'anime.
 * - Page épisode : JSON-LD Article.articleSection[0] (ex: "Pokemon (2023)")
 * - Page série : h1.entry-title sans le suffixe VOSTFR/VF
 */
function extractAnimeTitle() {
  const article = document.querySelector("article");
  if (!article) return null;

  const isEpisodePage = article.classList.contains("post");

  // 1. JSON-LD articleSection (épisode uniquement, propre)
  if (isEpisodePage) {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        const data = JSON.parse(script.textContent);
        const graph = data["@graph"] || [data];
        for (const item of graph) {
          if (item["@type"] === "Article" && item.articleSection?.length) {
            return item.articleSection[0];
          }
        }
      }
    } catch {
      // fallback
    }
  }

  // 2. h1.entry-title — strip suffixe VOSTFR/VF et numéro d'épisode
  const h1 = document.querySelector("h1.entry-title");
  if (h1) {
    let title = h1.textContent.trim();
    // Strip tout après "VOSTFR:" ou "VF:" (titre d'épisode)
    title = title.replace(/\s+\d+\s+VOSTFR\s*:.*$/i, "")
                 .replace(/\s+\d+\s+VF\s*:.*$/i, "")
                 .replace(/\s+VOSTFR$/i, "")
                 .replace(/\s+VF$/i, "")
                 .trim();
    if (title) return title;
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
    const { enableGumgum } = await new Promise(r =>
      chrome.storage.sync.get({ enableGumgum: true }, r)
    );
    if (!enableGumgum) return;

    const [cacheModule, utilsModule] = await Promise.all([
      import(animeCacheScript),
      import(srcUtils),
    ]);

    animeCache = cacheModule.animeCache;
    utils = utilsModule;

    await animeCache.ensureCacheReady();
    initializeAnimeDetection();
  } catch (error) {
    console.error("[GumGum] Erreur lors du chargement des modules:", error);
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

  const animeTitleRaw = extractAnimeTitle();
  if (!animeTitleRaw) return;

  console.log(`[GumGum] Titre trouvé: "${animeTitleRaw}"`);

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
        console.log(`[GumGum] Anime ignoré: ${animeTitle}`);
        return;
      } else if (cachedResult) {
        console.log(`[GumGum] URL personnalisée trouvée pour: ${animeTitle}`);
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
      console.error("[GumGum] Erreur:", error);
    }
  })();
}

main().catch((error) => {
  console.error("[GumGum] Erreur dans le script principal:", error);
});

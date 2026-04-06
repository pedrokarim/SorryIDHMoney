// by @AliasPedroKarim
// The code adds a search bar to a webpage and filters a list of anime
// titles based on the user's input in real-time. It uses a function to find a
// case-insensitive substring in a string.

const srcUtils = chrome.runtime.getURL("scripts/utils.js");
const animeCacheScript = chrome.runtime.getURL("scripts/anime-cache-manager.js");

// Modules à charger
let animeCache;
let utils;

/**
 * Extrait le titre de l'anime depuis la page
 * Supporte les différentes structures de DOM (voiranime.com, voir-anime.to)
 */
function extractAnimeTitle() {
  const path = window.location.pathname;

  // Page épisode : contient "-vostfr" dans le chemin
  const isEpisodePage = path.includes("-vostfr") && path.startsWith("/anime/");

  // Page fiche anime : /anime/{slug}/ sans sous-chemin d'épisode
  // On vérifie que le chemin a exactement 2 segments après /anime/ (le slug)
  const pathParts = path.replace(/^\/|\/$/g, '').split('/');
  const isAnimePage = pathParts.length === 2 && pathParts[0] === 'anime';

  if (!isEpisodePage && !isAnimePage) return null;

  let titleRaw = null;

  if (isEpisodePage) {
    // Chercher dans le breadcrumb (le lien vers la fiche anime)
    const breadcrumbTitle =
      document.querySelector(".entry-header_wrap ol.breadcrumb li:nth-child(2) a") ||
      document.querySelector(".c-breadcrumb ol.breadcrumb li:nth-child(2) a") ||
      document.querySelector("ol.breadcrumb li:nth-child(2) a");

    if (breadcrumbTitle) {
      titleRaw = breadcrumbTitle.textContent.trim();
    }
  }

  if (isAnimePage) {
    // Sur la fiche anime, prendre le H1
    const h1 = document.querySelector(".post-title h1") ||
               document.querySelector("h1");

    if (h1) {
      titleRaw = h1.textContent.trim();
    }
  }

  return titleRaw;
}

// Fonction principale qui s'exécute une fois tous les modules chargés
async function main() {
  try {
    // Charger tous les modules nécessaires
    const [cacheModule, utilsModule] = await Promise.all([
      import(animeCacheScript),
      import(srcUtils)
    ]);

    // Assigner les fonctions/objets importés
    animeCache = cacheModule.animeCache;
    utils = utilsModule;

    // S'assurer que le cache est initialisé
    await animeCache.ensureCacheReady();

    // Exécuter la logique principale
    initializeAnimeDetection();
  } catch (error) {
    console.error("Erreur lors du chargement des modules:", error);
  }
}

// Fonction qui gère la détection des animes et l'ajout des boutons
async function initializeAnimeDetection() {
  const { addCustomButton, addEditButtons, removeEditButtons, addExitEditButton, enableEditModeOnButtons, animationCSS, injectCSSAnimation } = utils;
  injectCSSAnimation(animationCSS());

  const episodeTitleRaw = extractAnimeTitle();
  if (!episodeTitleRaw) return;

  const episodeTitle = episodeTitleRaw.toLowerCase();

  // Callback quand un anime est sélectionné via la popup de recherche
  // On sauvegarde dans le cache, on reste en mode édition
  // Le bouton X (quitter) rechargera la page et les vrais boutons apparaîtront
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
  }

  // Écouter le message de mode édition depuis la popup
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "toggleEditMode" && message.enabled) {
      enableEditModeOnButtons(episodeTitleRaw, onAnimeSelected);
    }
  });

  try {
    // Vérifier si l'anime est dans le cache avant de faire la recherche
    const cachedResult = await animeCache.isInCache(episodeTitle);

    if (cachedResult === true) {
      console.log(`Anime ignoré: ${episodeTitle}`);
      return;
    } else if (cachedResult) {
      console.log(`URL personnalisée trouvée pour: ${episodeTitle}`);
      addButtons({
        siteUrl: cachedResult.anilistUrl || cachedResult,
        malUrl: cachedResult.malUrl || null
      });
      return;
    }

    // Rechercher l'anime via l'API
    chrome.runtime.sendMessage(
      { action: "getAnilistMedia", search: episodeTitle },
      function (response) {
        if (!response) {
          addEditButtons(episodeTitleRaw, onAnimeSelected);
          return;
        }

        addButtons(response);
      }
    );
  } catch (error) {
    console.error("Erreur lors de la vérification du cache:", error);
  }
}

// Démarrer l'exécution
main().catch(error => {
  console.error("Erreur dans le script principal:", error);
});

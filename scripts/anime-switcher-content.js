// by @AliasPedroKarim
// This code adds a custom button to MyAnimeList and AniList websites that
// allows users to switch between the two platforms for a given anime or manga.
// It uses GraphQL queries to retrieve the necessary information and dynamically
// injects the button into the page.
// This code retrieves information about an anime or manga from MyAnimeList or
// AniList, and adds a custom button to switch between the two platforms.

const srcUtils = chrome.runtime.getURL("scripts/utils.js");

let enableMal = true;
let enableAnilist = true;

let buttonMal = null;
let buttonAnilist = null;

// Token incrémenté à chaque navigation — utilisé pour ignorer les réponses
// d'anciennes requêtes qui résolvent après qu'on a changé de page
let navToken = 0;

chrome.storage.sync.get({
  enableMal: true,
  enableAnilist: true
}, function (items) {
  enableMal = items.enableMal;
  enableAnilist = items.enableAnilist;


});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.action === "updateAnimeSwitcher") {
    if (request.type === "mal") {
      enableMal = request.enabled;
    } else if (request.type === "anilist") {
      enableAnilist = request.enabled;
    }

    resetButton();
    buttonMal?.remove();
    buttonAnilist?.remove();
    buttonMal = null;
    buttonAnilist = null;

    animeSwitcher(window.location.href);
  }
});

(async () => {
  const { addCustomButton, animationCSS, injectCSSAnimation, resetButton } = await import(
    srcUtils
  );

  async function getUrlAnilist(id, type) {
    if (isNaN(parseInt(id))) return null;
    if (!["ANIME", "MANGA"].includes(type)) return null;
    const query = `
          query ($id: Int, $type: MediaType) {
              Media(idMal: $id, type: $type) {
                  siteUrl
              }
          }
  `;
    const variables = {
      id: parseInt(id),
      type: type,
    };
    const url = "https://graphql.anilist.co";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
        variables: variables,
      }),
    })
      .then((response) => response.json())
      .catch((error) => console.error("An error occurred:", error));
    console.log("res", res);
    return res?.data?.Media?.siteUrl;
  }

  async function getUrlMal(id, type) {
    if (isNaN(parseInt(id))) return null;
    if (!["ANIME", "MANGA"].includes(type)) return null;

    const query = `
        query ($id: Int, $type: MediaType) {
            Media(id: $id, type: $type) {
                idMal
            }
        }
        `;
    const variables = {
      id: parseInt(id),
      type: type,
    };
    const url = "https://graphql.anilist.co";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
        variables: variables,
      }),
    })
      .then((response) => response.json())
      .catch((_) => null);
    const idMal = res?.data?.Media?.idMal;
    return idMal
      ? `https://myanimelist.net/${type.toLowerCase()}/${idMal}`
      : null;
  }

  function extractAnimeIdFromUrl(urlObj) {
    const pathParts = urlObj.pathname.split("/");

    if (pathParts.length >= 3) {
      const type = pathParts[1];
      const id = pathParts[2];

      return { type, id };
    }

    return { type: null, id: null };
  }

  // async function getMediaInfoByTitle(title, type) {
  //   return new Promise((resolve) => {
  //     chrome.runtime.sendMessage({
  //       action: "getAnilistMedia",
  //       search: title,
  //       typePreference: type.toUpperCase()
  //     }, (response) => {
  //       resolve(response);
  //     });
  //   });
  // }

  function extractNautiljonInfo() {
    const titleElement = document.querySelector(".h1titre > span");
    if (!titleElement) return null;

    const title = titleElement.innerText.trim();
    const path = window.location.pathname;
    const type = path.includes('/animes/') ? 'anime' : path.includes('/mangas/') ? 'manga' : null;

    return { title, type };
  }

  function animeSwitcher(url) {
    // Toujours nettoyer en premier, quelque soit la façon dont on est arrivé ici
    resetButton();
    buttonMal?.remove();
    buttonAnilist?.remove();
    buttonMal = null;
    buttonAnilist = null;

    // Nouveau token de navigation — les anciens callbacks async seront ignorés
    const thisNav = ++navToken;
    const isStale = () => thisNav !== navToken;

    const currentUrl = new URL(url || window.location.href);
    const currentHostname = currentUrl.hostname;
    const { type, id } = extractAnimeIdFromUrl(currentUrl);

    switch (currentHostname) {
      case "myanimelist.net":
        if (["anime", "manga"].includes(type) && id && enableAnilist) {
          getUrlAnilist(id, type.toUpperCase()).then((url) => {
            if (isStale() || !url) return;
            buttonAnilist = addCustomButton("anilist", url);
          });
        }

        break;
      case "anilist.co":
        if (["anime", "manga"].includes(type) && id && enableMal) {
          getUrlMal(id, type.toUpperCase()).then((url) => {
            if (isStale() || !url) return;
            buttonMal = addCustomButton("myanimelist", url);
          });
        }
        break;
      case "www.nautiljon.com":
      case "nautiljon.com":
        const mediaInfo = extractNautiljonInfo();
        if (!mediaInfo || !mediaInfo.title || !mediaInfo.type) return;

        if (enableAnilist) {
          chrome.runtime.sendMessage(
            { action: "getAnilistMedia", search: mediaInfo.title },
            function (response) {
              if (isStale() || !response) return;

              if (response?.siteUrl) {
                buttonAnilist = addCustomButton("anilist", response.siteUrl);
              }
              if (response?.siteMalUrl && enableMal) {
                buttonMal = addCustomButton("myanimelist", response.siteMalUrl, {
                  styles: {
                    left: `${20 * 2 + 50}px`,
                  },
                });
              }
            }
          );
        }
        break;
      default:
        console.log("Site not supported.");
        break;
    }
  }

  // Navigation SPA (anilist.co est une SPA Vue/Nuxt)
  if (window.location.hostname === "anilist.co") {
    let lastHandledUrl = window.location.href;

    const handleNavigation = (targetUrl) => {
      // Éviter les appels multiples pour la même URL (pushState + navigate API
      // peuvent fire les deux pour la même navigation)
      if (targetUrl === lastHandledUrl) return;
      lastHandledUrl = targetUrl;

      // animeSwitcher s'occupe lui-même de nettoyer les anciens boutons
      animeSwitcher(targetUrl);
    };

    // 1. Navigation API (moderne)
    if (typeof navigation !== "undefined" && navigation.addEventListener) {
      navigation.addEventListener("navigate", (e) => {
        try {
          const targetUrl = new URL(e.destination.url);
          if (targetUrl.hostname !== window.location.hostname) return;
          // Attendre un tick que l'URL soit effectivement mise à jour
          setTimeout(() => handleNavigation(targetUrl.href), 0);
        } catch { /* ignore */ }
      });
    }

    // 2. Patch pushState / replaceState + popstate (fallback fiable)
    const wrapHistoryMethod = (method) => {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        setTimeout(() => handleNavigation(window.location.href), 0);
        return result;
      };
    };
    wrapHistoryMethod("pushState");
    wrapHistoryMethod("replaceState");
    window.addEventListener("popstate", () => {
      setTimeout(() => handleNavigation(window.location.href), 0);
    });
  }

  injectCSSAnimation(animationCSS());
  animeSwitcher();
})();

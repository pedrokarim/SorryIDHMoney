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
    const currentUrl = new URL(url || window.location.href);
    const currentHostname = currentUrl.hostname;
    const { type, id } = extractAnimeIdFromUrl(currentUrl);

    switch (currentHostname) {
      case "myanimelist.net":
        if (["anime", "manga"].includes(type) && id && enableAnilist) {
          getUrlAnilist(id, type.toUpperCase()).then((url) => {
            if (!url) return;
            buttonAnilist = addCustomButton("anilist", url);
          });
        }

        break;
      case "anilist.co":
        if (["anime", "manga"].includes(type) && id && enableMal) {
          getUrlMal(id, type.toUpperCase()).then((url) => {
            if (!url) return;
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
              if (!response) return;

              if (response?.siteUrl) {
                buttonAnilist = addCustomButton("anilist", response.siteUrl, {
                  // styles: {
                  //   left: `${20 * 2 + 50}px`,
                  // },
                });
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

  // only for anilist
  if (window.location.hostname === "anilist.co") {
    navigation.addEventListener("navigate", (e) => {
      const targetUrl = new URL(e.destination.url);
      const currentUrl = new URL(window.location.href);

      if (currentUrl.hostname != targetUrl.hostname) return;

      resetButton();
      buttonMal?.remove();
      buttonMal = null;
      buttonAnilist?.remove();
      buttonAnilist = null;
      animeSwitcher(e.destination.url);
    });
  }

  injectCSSAnimation(animationCSS());
  animeSwitcher();
})();

import {
  addTermToCache,
  cacheData,
  getCachedDataByKey,
  getCachedDataByTerm,
} from "./scripts/cache.js";

// Cache mémoire pour éviter de spammer l'API AniList (durée de vie = durée du service worker)
const apiCache = new Map();
const API_CACHE_TTL = 10 * 60 * 1000; // 10 minutes en mémoire

function getApiCache(key) {
  const entry = apiCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > API_CACHE_TTL) {
    apiCache.delete(key);
    return null;
  }
  return entry.data;
}

function setApiCache(key, data) {
  apiCache.set(key, { data, timestamp: Date.now() });
}

// Fonction pour nettoyer les termes de recherche
function sanitizeSearchTerm(search) {
  if (!search) return '';

  return search
    // Supprime les crochets et leur contenu
    .replace(/\[.*?\]/g, '')
    // Supprime les deux-points
    .replace(/:/g, '')
    // Supprime les caractères spéciaux tout en gardant les espaces et les lettres/chiffres
    .replace(/[^\w\s-]/g, '')
    // Remplace les espaces multiples par un seul espace
    .replace(/\s+/g, ' ')
    // Supprime les espaces au début et à la fin
    .trim();
}

async function getAnilistMediaInfo(search) {
  // Applique la sanitization avant la recherche
  const sanitizedSearch = sanitizeSearchTerm(search);

  console.log(
    "Terms sanitized: ",
    sanitizedSearch
  )

  // Vérifier le cache mémoire
  const cacheKey = `anilist:${sanitizedSearch.toLowerCase()}`;
  const cached = getApiCache(cacheKey);
  if (cached !== null) {
    console.log("Cache hit for:", sanitizedSearch);
    return cached;
  }

  const query = `query ($search: String) {
            Media(search: $search, type: ANIME) {
                id
                idMal
                siteUrl
                type
            }
        }`;
  const variables = {
    search: sanitizedSearch,
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
  const result = res?.data?.Media
    ? {
      ...res?.data?.Media,
      siteMalUrl: idMal
        ? `https://myanimelist.net/${res?.data?.Media?.type?.toLowerCase()}/${idMal}`
        : null,
    }
    : null;

  // Mettre en cache le résultat (même null pour éviter de re-requêter)
  setApiCache(cacheKey, result);

  return result;
}

// Listen for messages from the content script

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case "disableConsoleClear":
      console.log("console.clear has been disabled.");
      return false;
    case "getAnilistMedia":
      console.log("Received demand media from anilist: ", message);
      if (message.search) {
        getAnilistMediaInfo(message.search).then((res) => {
          console.log("And the response is: ", res);
          sendResponse(res);
        });
      }
      // Le retour de true est important car il indique au runtime
      // que nous voulons qu'il reste actif tout au long de la transition
      return true;
    case "cacheData":
      if (message.cacheKey && message.data && message.expirationInSeconds) {
        cacheData(
          message.cacheKey,
          message.data,
          message.expirationInSeconds,
          message.terms || []
        );
        console.log("Data cached:", message.cacheKey);
      }
      return false;
    case "getCachedDataByKey":
      if (message.cacheKey) {
        getCachedDataByKey(message.cacheKey).then((data) => {
          sendResponse(data);
        });
      }
      return true;
    case "getCachedDataByTerm":
      if (message.term) {
        getCachedDataByTerm(message.term).then((data) => {
          sendResponse(data);
        });
      }
      return true;
    case "addTermToCache":
      if (message.cacheKey && message.term) {
        addTermToCache(message.cacheKey, message.term);
        console.log("Term added to cache:", message.term);
      }
      return false;
    case "openStatsPopup":
      chrome.windows.create({
        url: chrome.runtime.getURL("interfaces/twitch-stats.html"),
        type: "popup",
        width: 350,
        height: 400
      });
      return false;
    case "openAnimeManager":
      const searchTerm = message.searchTerm || '';
      const url = chrome.runtime.getURL(`interfaces/anime-manager.html${searchTerm ? `?highlight=${encodeURIComponent(searchTerm)}` : ''}`);
      chrome.tabs.create({ url });
      return false;
    default:
      return false;
  }
});

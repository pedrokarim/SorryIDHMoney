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

// Cache persistant (chrome.storage.local via cache.js) — L2 qui SURVIT à la mort du
// service worker MV3, contrairement au Map en mémoire (L1) vidé à chaque arrêt du SW.
// C'est lui qui évite de re-spammer l'API AniList quand on enchaîne les épisodes.
// TTL adaptés au statut : une fiche terminée ne change plus, un anime en cours évolue
// (nextAiringEpisode, nombre d'épisodes) → on la garde moins longtemps.
const PERSIST_TTL_FINISHED = 7 * 24 * 60 * 60;   // 7 jours
const PERSIST_TTL_RELEASING = 12 * 60 * 60;      // 12 heures
const PERSIST_TTL_DEFAULT = 24 * 60 * 60;        // 24 heures
const ANILIST_CACHE_PREFIX = 'sorryidhmoney.anilist:'; // préfixe des clés (namespace cache.js)

function persistTtlFor(media) {
  switch (media?.status) {
    case 'FINISHED':
    case 'CANCELLED':
      return PERSIST_TTL_FINISHED;
    case 'RELEASING':
    case 'NOT_YET_RELEASED':
    case 'HIATUS':
      return PERSIST_TTL_RELEASING;
    default:
      return PERSIST_TTL_DEFAULT;
  }
}

// Lecture L2 tolérante aux erreurs (renvoie null si storage HS ou entrée expirée)
async function getPersistentCache(key) {
  try { return await getCachedDataByKey(key); } catch { return null; }
}

// Écrit en L2 uniquement les résultats trouvés (jamais les null : un not-found ou une
// erreur réseau transitoire ne doit pas être figé pendant des heures).
function setPersistentCache(key, result) {
  if (result) cacheData(key, result, persistTtlFor(result));
}

// Nettoyage des entrées AniList expirées (cache.js ne supprime jamais, il ignore juste
// les entrées périmées). Appelé aux moments peu fréquents (démarrage / install/màj).
async function pruneExpiredAnilistCache() {
  try {
    const all = await chrome.storage.local.get(null);
    const now = Date.now();
    const toRemove = [];
    for (const key in all) {
      if (key.startsWith(ANILIST_CACHE_PREFIX)) {
        const entry = all[key];
        if (!entry || typeof entry.expires !== 'number' || entry.expires <= now) {
          toRemove.push(key);
        }
      }
    }
    if (toRemove.length) {
      await chrome.storage.local.remove(toRemove);
      console.log(`[AnilistCache] ${toRemove.length} entrées expirées supprimées`);
    }
  } catch (e) {
    console.warn('[AnilistCache] Nettoyage échoué:', e);
  }
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

// Champs complets utilisés pour la fiche détaillée
const ANILIST_FULL_FIELDS = `
    id
    idMal
    siteUrl
    type
    title { romaji english native }
    description(asHtml: false)
    format
    status
    episodes
    duration
    season
    seasonYear
    startDate { year month day }
    endDate { year month day }
    averageScore
    meanScore
    popularity
    favourites
    genres
    isAdult
    coverImage { large extraLarge color }
    bannerImage
    nextAiringEpisode { airingAt timeUntilAiring episode }
    studios(isMain: true) { nodes { name siteUrl } }
    trailer { id site thumbnail }
`;

async function getAnilistMediaById(id) {
  if (!id || isNaN(parseInt(id))) return null;

  const cacheKey = `anilist:id:${id}`;
  const cached = getApiCache(cacheKey);            // L1 mémoire
  if (cached) return cached;
  const persisted = await getPersistentCache(cacheKey); // L2 storage (survit au SW)
  if (persisted) {
    setApiCache(cacheKey, persisted);
    return persisted;
  }

  const query = `query ($id: Int) {
    Media(id: $id, type: ANIME) {
      ${ANILIST_FULL_FIELDS}
    }
  }`;

  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables: { id: parseInt(id) } }),
  })
    .then((r) => r.json())
    .catch(() => null);

  const idMal = res?.data?.Media?.idMal;
  const result = res?.data?.Media
    ? {
        ...res.data.Media,
        siteMalUrl: idMal
          ? `https://myanimelist.net/${res.data.Media.type?.toLowerCase()}/${idMal}`
          : null,
      }
    : null;

  setApiCache(cacheKey, result);
  setPersistentCache(cacheKey, result);
  return result;
}

async function getAnilistMediaInfo(search) {
  // Applique la sanitization avant la recherche
  const sanitizedSearch = sanitizeSearchTerm(search);

  console.log(
    "Terms sanitized: ",
    sanitizedSearch
  )

  // L1 mémoire
  const cacheKey = `anilist:${sanitizedSearch.toLowerCase()}`;
  const cached = getApiCache(cacheKey);
  if (cached) {
    console.log("Cache hit (mémoire) for:", sanitizedSearch);
    return cached;
  }
  // L2 storage persistant (survit à la mort du service worker)
  const persisted = await getPersistentCache(cacheKey);
  if (persisted) {
    console.log("Cache hit (storage) for:", sanitizedSearch);
    setApiCache(cacheKey, persisted);
    return persisted;
  }

  const query = `query ($search: String) {
            Media(search: $search, type: ANIME) {
                ${ANILIST_FULL_FIELDS}
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

  // Mise en cache : L1 mémoire (court terme) + L2 storage (uniquement si trouvé)
  setApiCache(cacheKey, result);
  setPersistentCache(cacheKey, result);

  return result;
}

chrome.runtime.onStartup.addListener(() => {
  pruneExpiredAnilistCache();
});

chrome.runtime.onInstalled.addListener(() => {
  pruneExpiredAnilistCache();
});

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
    case "getAnilistMediaById":
      if (message.id) {
        getAnilistMediaById(message.id).then((res) => sendResponse(res));
      } else {
        sendResponse(null);
      }
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

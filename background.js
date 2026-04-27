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
  const cached = getApiCache(cacheKey);
  if (cached !== null) return cached;

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
  return result;
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

  // Mettre en cache le résultat (même null pour éviter de re-requêter)
  setApiCache(cacheKey, result);

  return result;
}

// === Voice Gateway Bridge (WebSocket) ===
const WS_URL = 'ws://127.0.0.1:59210';
const VOICE_GATEWAY_ALARM = 'voiceGatewayReconnect';
let ws = null;
let wsReconnectTimer = null;
let voiceGatewayCancelRequested = false;

function connectToGateway() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[VoiceGateway] WebSocket connected');
      voiceGatewayState = 'idle';
      notifyUI('voiceGateway_ui_status', { state: 'idle' });
      if (wsReconnectTimer) {
        clearInterval(wsReconnectTimer);
        wsReconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[VoiceGateway] From gateway:', msg);
        handleNativeMessage(msg);
      } catch (e) {
        console.error('[VoiceGateway] Invalid message:', e);
      }
    };

    ws.onclose = () => {
      console.log('[VoiceGateway] WebSocket disconnected');
      ws = null;
      voiceGatewayState = 'disconnected';
      notifyUI('voiceGateway_ui_status', { state: 'disconnected' });
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      console.log('[VoiceGateway] WebSocket error (app not running?)');
      ws = null;
      voiceGatewayState = 'disconnected';
      notifyUI('voiceGateway_ui_status', { state: 'disconnected' });
      scheduleReconnect();
    };
  } catch (e) {
    console.error('[VoiceGateway] Failed to connect:', e);
    ws = null;
    voiceGatewayState = 'disconnected';
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (wsReconnectTimer) return;
  wsReconnectTimer = setInterval(() => {
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      connectToGateway();
    } else {
      clearInterval(wsReconnectTimer);
      wsReconnectTimer = null;
    }
  }, 5000);
}

function ensureGatewayConnection() {
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    connectToGateway();
  }
}

function installGatewayAlarm() {
  chrome.alarms.create(VOICE_GATEWAY_ALARM, {
    periodInMinutes: 0.5,
  });
}

function sendToGateway(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function findOrOpenChatGptTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://chatgpt.com/*', 'https://chat.openai.com/*']
  });

  if (tabs.length > 0) {
    return tabs[0];
  }

  // Aucun onglet ChatGPT ouvert : en créer un
  console.log('[VoiceGateway] No ChatGPT tab found, opening one...');
  const newTab = await chrome.tabs.create({
    url: 'https://chatgpt.com/',
    active: false, // Ne pas voler le focus
    pinned: true,  // Épingler pour pas qu'il gêne
  });

  // Attendre que la page soit chargée
  return new Promise((resolve) => {
    function onUpdated(tabId, changeInfo) {
      if (tabId === newTab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        // Petit délai pour laisser le JS de ChatGPT s'initialiser
        setTimeout(() => resolve(newTab), 2000);
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);

    // Timeout de sécurité (15s)
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(newTab);
    }, 15000);
  });
}

async function handleNativeMessage(msg) {
  switch (msg.type) {
    case 'start_recording':
    case 'stop_recording':
    case 'cancel_recording': {
      const tab = await findOrOpenChatGptTab();

      const action = msg.type === 'start_recording'
        ? 'voiceGateway_startRecording'
        : msg.type === 'stop_recording'
          ? 'voiceGateway_stopRecording'
          : 'voiceGateway_cancelRecording';

      if (msg.type === 'start_recording') {
        voiceGatewayCancelRequested = false;
      } else if (msg.type === 'cancel_recording') {
        voiceGatewayCancelRequested = true;
      }

      if (msg.type !== 'cancel_recording') {
        voiceGatewayState = msg.type === 'start_recording' ? 'waiting' : 'processing';
        notifyUI('voiceGateway_ui_status', {
          state: voiceGatewayState
        });
      }

      try {
        let response = await chrome.tabs.sendMessage(tab.id, { action });

        if (
          msg.type === 'start_recording' &&
          response?.type === 'status' &&
          response.state === 'recording' &&
          voiceGatewayCancelRequested
        ) {
          response = await chrome.tabs.sendMessage(tab.id, {
            action: 'voiceGateway_cancelRecording'
          });
        }

        if (response) {
          sendToGateway(response);

          // Notifier l'UI
          if (response.type === 'status') {
            if (response.state === 'recording') {
              voiceGatewayCancelRequested = false;
            }
            voiceGatewayState = response.state;
            notifyUI('voiceGateway_ui_status', { state: response.state });
          } else if (response.type === 'cancelled') {
            voiceGatewayCancelRequested = false;
            voiceGatewayState = 'idle';
            notifyUI('voiceGateway_ui_status', { state: 'idle' });
          } else if (response.type === 'transcription') {
            voiceGatewayCancelRequested = false;
            notifyUI('voiceGateway_ui_transcription', { text: response.text });
            notifyUI('voiceGateway_ui_status', { state: 'idle' });
            voiceGatewayState = 'idle';
          } else if (response.type === 'error') {
            notifyUI('voiceGateway_ui_error', { message: response.message });
            voiceGatewayState = 'error';
          }
        }
      } catch (e) {
        console.error('[VoiceGateway] Content script error:', e);
        const errorMsg = e.message || 'Content script unreachable';
        sendToGateway({
          type: 'error',
          code: 'CONTENT_SCRIPT_ERROR',
          message: errorMsg
        });
        notifyUI('voiceGateway_ui_error', { message: errorMsg });
        voiceGatewayState = 'error';
      }
      break;
    }
    case 'ping':
      sendToGateway({ type: 'pong' });
      break;
    default:
      console.log('[VoiceGateway] Unknown native message type:', msg.type);
  }
}

// Notifier l'interface Voice Gateway (si ouverte)
function notifyUI(action, data = {}) {
  chrome.runtime.sendMessage({ action, ...data }).catch(() => {
    // L'UI n'est pas ouverte, on ignore
  });
}

// État courant pour que l'UI puisse le demander
let voiceGatewayState = 'disconnected';

// Connecter au native host au démarrage du service worker
installGatewayAlarm();
connectToGateway();

chrome.runtime.onStartup.addListener(() => {
  installGatewayAlarm();
  ensureGatewayConnection();
});

chrome.runtime.onInstalled.addListener(() => {
  installGatewayAlarm();
  ensureGatewayConnection();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === VOICE_GATEWAY_ALARM) {
    ensureGatewayConnection();
  }
});

// Listen for messages from the content script

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action?.startsWith('voiceGateway_')) {
    ensureGatewayConnection();
  }

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
    // voiceGateway_transcription supprimé : la transcription passe par sendResponse uniquement
    case "voiceGateway_error":
      console.log('[VoiceGateway] Error from content script:', message);
      sendToGateway({
        type: 'error',
        code: message.code || 'CONTENT_SCRIPT_ERROR',
        message: message.message || 'Unknown error'
      });
      notifyUI('voiceGateway_ui_error', { message: message.message });
      voiceGatewayState = 'error';
      return false;
    case "voiceGateway_getStatus":
      ensureGatewayConnection();
      sendResponse({ state: voiceGatewayState });
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

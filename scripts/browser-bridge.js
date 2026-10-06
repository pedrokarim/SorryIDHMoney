/*
 * browser-bridge.js – Pont navigateur : laisser un outil local lire le web à
 * travers ce navigateur.
 *
 * Un outil qui va chercher une page tout seul (WebFetch, curl) se fait
 * refouler : pas de session, pas de JavaScript, une empreinte de robot. Le
 * navigateur, lui, a tout ça. Ce module lui fait donc lire la page à la place
 * de l'outil, et rend ce qu'il voit.
 *
 * Même mécanisme que le pont de publication X : c'est l'extension qui appelle
 * un petit serveur local, jamais l'inverse. Rien n'écoute côté extension.
 *
 * Une différence, parce que l'usage n'est pas le même : programmer une
 * publication supporte une minute d'attente, lire une page non. Tant que le
 * serveur répond, le worker enchaîne donc des requêtes longues (le serveur
 * retient la réponse jusqu'à vingt secondes ou jusqu'au premier ordre), et un
 * ordre part dans la seconde. Serveur éteint, la boucle s'arrête et une alarme
 * retente toutes les trente secondes : le worker dort comme avant.
 *
 * Les gardes, dans cet ordre :
 *   1. le module est coupé par défaut ;
 *   2. sans jeton renseigné, on ne contacte même pas le serveur ;
 *   3. seules les actions de la liste blanche sont exécutées, et **toutes sont
 *      des lectures** : ni clic, ni saisie, ni code arbitraire ;
 *   4. les sites bannis ne sont jamais ouverts, lus, photographiés ni listés ;
 *   5. le débogueur et la lecture du stockage ont chacun leur case, décochée :
 *      ils exposent les jetons de session.
 *
 * Chaque ordre laisse une ligne au journal (browser-history.js) et, sur un
 * onglet qui reste ouvert, met à jour la pastille posée sur la page
 * (browser-widget.js).
 */

import {
  readPage, queryElements, listResources, locateElement, scrollThrough, readStorage, detectChallenge,
} from './browser-page.js';
import { renderWidget, setWidgetHidden } from './browser-widget.js';
import { captureFullPage, recordActivity } from './browser-debugger.js';
import { record, historyForHost, hostOf, summarize, thumbnail } from './browser-history.js';

const LOG = '[BrowserBridge]';
const IDLE_ALARM = 'browserBridge:idle';

/** Durée pendant laquelle le serveur retient une sonde sans travail. */
const LONG_POLL_SECONDS = 20;

const SETTINGS_DEFAULTS = {
  enableBrowserBridge: false,
  browserBridgePort: 8788,
  browserBridgeToken: '',
  browserBridgeBlockedSites: [],
  browserBridgeShowWidget: true,
  browserBridgeAllowDebugger: false,
  browserBridgeAllowStorage: false,
};

/** Onglets ouverts par le pont : les seuls qu'il a le droit de refermer. */
const OWNED_TABS_KEY = 'browserBridgeTabs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settings() {
  return new Promise((r) => chrome.storage.sync.get(SETTINGS_DEFAULTS, r));
}

// ── Sites bannis ─────────────────────────────────────────────────────────

/** Ramène une saisie libre (« https://www.Exemple.fr/page ») à un nom d'hôte. */
export function normalizeSite(entry) {
  const raw = String(entry || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Vrai si l'hôte est un site banni, ou l'un de ses sous-domaines. */
function isBlockedHost(hostname, blockedSites) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  return blockedSites
    .map(normalizeSite)
    .filter(Boolean)
    .some((site) => host === site || host.endsWith(`.${site}`));
}

/**
 * Refuse une adresse que le pont n'a pas à lire.
 *
 * Appelée avant d'ouvrir, et de nouveau une fois la page chargée : une
 * redirection peut mener sur un site banni depuis une adresse qui ne l'était
 * pas.
 */
async function assertReadable(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`adresse invalide : ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`page hors de portée du pont (${parsed.protocol}//)`);
  }
  const { browserBridgeBlockedSites } = await settings();
  if (isBlockedHost(parsed.hostname, browserBridgeBlockedSites)) {
    throw new Error(`site banni : ${parsed.hostname}`);
  }
}

// ── Onglets ──────────────────────────────────────────────────────────────

async function ownedTabs() {
  const stored = await chrome.storage.session.get({ [OWNED_TABS_KEY]: [] });
  return stored[OWNED_TABS_KEY];
}

async function setOwned(tabId, owned) {
  const ids = (await ownedTabs()).filter((id) => id !== tabId);
  if (owned) ids.push(tabId);
  await chrome.storage.session.set({ [OWNED_TABS_KEY]: ids });
}

/**
 * Attend la fin du chargement. Passé le délai, on rend l'onglet tel qu'il est
 * plutôt que d'échouer : une page qui traîne sur un traceur est déjà lisible.
 */
async function waitForLoad(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && tab.url && tab.url !== 'about:blank') return tab;
    await sleep(250);
  }
  return chrome.tabs.get(tabId);
}

async function inject(tabId, func, args) {
  // `injectImmediately` : sans lui, l'injection attend la fin du chargement,
  // et une page qui traîne sur une ressource bloquerait l'ordre indéfiniment.
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId }, func, args, injectImmediately: true,
  });
  const result = frame?.result;
  if (result?.error) throw new Error(result.error);
  return result;
}

/** Attend qu'un élément existe : les pages rendues en JavaScript arrivent après le squelette. */
async function waitForSelector(tabId, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await inject(tabId, (s) => Boolean(document.querySelector(s)), [selector]);
    if (found) return;
    await sleep(300);
  }
  throw new Error(`« ${selector} » n'est pas apparu en ${Math.round(timeoutMs / 1000)} s`);
}

/** Délai laissé à une vérification anti-robot pour se valider seule. */
const CHALLENGE_TIMEOUT_MS = 25000;

/**
 * Attend qu'une page de vérification anti-robot laisse place au site.
 *
 * On ne fait qu'attendre : c'est le navigateur de l'utilisateur qui passe la
 * vérification, comme il la passerait s'il ouvrait l'onglet lui-même. Si elle
 * réclame un geste (case à cocher, casse-tête), on le dit et on s'arrête.
 */
async function waitForChallenge(tabId) {
  const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
  for (;;) {
    let challenged;
    try {
      challenged = await inject(tabId, detectChallenge, []);
    } catch {
      // La page est en train de se recharger vers le site : on repasse.
      challenged = true;
    }
    if (!challenged) return;
    if (Date.now() > deadline) {
      throw new Error(
        'page de vérification anti-robot toujours affichée après '
        + `${CHALLENGE_TIMEOUT_MS / 1000} s : ouvre l'adresse dans le navigateur, valide-la, puis relance`,
      );
    }
    await sleep(700);
  }
}

/**
 * Ouvre une adresse dans un nouvel onglet et attend qu'elle soit lisible.
 *
 * En arrière-plan par défaut, pour ne pas voler l'écran. Chrome bride les
 * onglets cachés : une page qui ne charge sa suite qu'une fois visible
 * (listes virtualisées, images paresseuses) demande `active: true`.
 */
async function openTab(payload) {
  await assertReadable(payload.url);

  const tab = await chrome.tabs.create({ url: payload.url, active: payload.active === true });
  await setOwned(tab.id, true);

  try {
    const loaded = await waitForLoad(tab.id, (payload.timeout || 30) * 1000);
    await assertReadable(loaded.url);
    await waitForChallenge(tab.id);
    // La vérification passée, le site se charge à son tour.
    await assertReadable((await waitForLoad(tab.id, 15000)).url);
    if (payload.waitFor) await waitForSelector(tab.id, payload.waitFor, 15000);
    // Le squelette est là, le contenu pas forcément : on laisse le rendu finir.
    await sleep(payload.settle ?? 800);
    return chrome.tabs.get(tab.id);
  } catch (err) {
    await closeOwnedTab(tab.id);
    throw err;
  }
}

async function closeOwnedTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Onglet déjà fermé à la main : rien à réparer.
  }
  await setOwned(tabId, false);
}

/**
 * Pose ou met à jour la pastille d'un onglet. Jamais bloquant : une page qui
 * refuse l'injection ne doit pas faire échouer la lecture qu'on y fait.
 */
async function showWidget(tabId, url, busy, onlyIfPresent = false) {
  try {
    const { browserBridgeShowWidget } = await settings();
    if (!browserBridgeShowWidget) return;
    const host = hostOf(url);
    await chrome.scripting.executeScript({
      target: { tabId },
      func: renderWidget,
      args: [{ host, busy: busy || null, entries: await historyForHost(host), onlyIfPresent }],
    });
  } catch {
    // Onglet fermé, page protégée : pas de pastille, et c'est tout.
  }
}

/** L'onglet nommé par l'ordre, ou l'onglet actif de la dernière fenêtre utilisée. */
async function targetTab(payload) {
  const tab = payload.tabId
    ? await chrome.tabs.get(Number(payload.tabId))
    : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab) throw new Error('aucun onglet à lire');
  await assertReadable(tab.url);
  return tab;
}

/** Note au contexte de l'ordre l'onglet sur lequel il travaille. */
function noteTab(context, tab, temporary) {
  context.tabId = tab.id;
  context.url = tab.url;
  context.title = tab.title;
  context.temporary = temporary;
}

/**
 * Désigne l'onglet visé par un ordre et lui applique `work`.
 *
 * Trois façons de viser : `url` (on ouvre, on lit, on referme – sauf `keep`),
 * `tabId` (un onglet déjà ouvert, qu'on laisse en place), ou rien (l'onglet
 * actif de la dernière fenêtre utilisée).
 *
 * Un onglet qui reste ouvert reçoit la pastille ; un onglet ouvert pour une
 * seule lecture et refermé aussitôt, non – personne ne la verrait.
 */
async function withTab(payload, context, work) {
  if (payload.url) {
    const tab = await openTab(payload);
    noteTab(context, tab, !payload.keep);
    try {
      if (payload.keep) await showWidget(tab.id, tab.url, context.action);
      const result = await work(tab);
      return payload.keep ? { ...result, tabId: tab.id } : result;
    } finally {
      if (!payload.keep) await closeOwnedTab(tab.id);
    }
  }

  const tab = await targetTab(payload);
  noteTab(context, tab, false);
  await showWidget(tab.id, tab.url, context.action);
  if (payload.waitFor) await waitForSelector(tab.id, payload.waitFor, 15000);
  return work(tab);
}

// ── Captures ─────────────────────────────────────────────────────────────

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Par tranches : `String.fromCharCode(...bytes)` déborde la pile au-delà de
  // quelques centaines de kilo-octets.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

/** Découpe une capture au cadre d'un élément. */
async function crop(dataUrl, frame) {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // La capture est en pixels physiques, le cadre en pixels CSS : le rapport
  // des largeurs couvre d'un coup la densité de l'écran et le zoom de l'onglet.
  const scale = bitmap.width / frame.viewportWidth;

  const x = Math.max(0, Math.floor(frame.x * scale));
  const y = Math.max(0, Math.floor(frame.y * scale));
  const width = Math.min(bitmap.width - x, Math.ceil(frame.width * scale));
  const height = Math.min(bitmap.height - y, Math.ceil(frame.height * scale));
  if (width <= 0 || height <= 0) throw new Error('élément hors de l\'écran ou sans surface');

  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

/**
 * Photographie un onglet, ou un seul de ses éléments.
 *
 * `captureVisibleTab` ne voit que l'onglet actif d'une fenêtre : on y amène
 * donc l'onglet visé le temps du cliché, puis on rend l'écran à celui qui
 * l'avait. La capture couvre ce qui est affiché, pas la page entière.
 */
async function screenshot(payload, context) {
  if (payload.full) await assertAllowed('browserBridgeAllowDebugger', 'la capture de page entière');

  return withTab(payload, context, async (tab) => {
    const [previous] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    const borrowed = previous && previous.id !== tab.id;

    if (borrowed) {
      await chrome.tabs.update(tab.id, { active: true });
      // Le passage au premier plan n'est pas instantané : sans ce délai, le
      // cliché montre encore l'onglet précédent.
      await sleep(500);
    }

    try {
      // La pastille ne doit pas figurer sur la photo de la page.
      await inject(tab.id, setWidgetHidden, [true]);

      if (payload.full) {
        const { dataUrl, clipped } = await captureFullPage(tab.id);
        return { url: tab.url, title: tab.title, full: true, clipped, dataUrl };
      }

      let frame = null;
      if (payload.selector) {
        frame = await inject(tab.id, locateElement, [payload.selector]);
        if (!frame) throw new Error(`aucun élément ne correspond à « ${payload.selector} »`);
        await sleep(200);
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      return {
        url: tab.url,
        title: tab.title,
        cropped: Boolean(frame),
        dataUrl: frame ? await crop(dataUrl, frame) : dataUrl,
      };
    } finally {
      try {
        await inject(tab.id, setWidgetHidden, [false]);
      } catch {
        // Onglet fermé pendant la capture : plus rien à remontrer.
      }
      if (borrowed) {
        try {
          await chrome.tabs.update(previous.id, { active: true });
        } catch {
          // L'onglet de départ a disparu entre-temps : pas de quoi faire
          // échouer une capture qui a réussi.
        }
      }
    }
  });
}

// ── Lectures ─────────────────────────────────────────────────────────────

/** Refuse une action dont la case dédiée n'est pas cochée. */
async function assertAllowed(setting, what) {
  const cfg = await settings();
  if (!cfg[setting]) {
    throw new Error(`${what} demande une autorisation : coche la case correspondante dans les options (Pont navigateur)`);
  }
}

/**
 * Lit la page, après l'avoir fait défiler si on le demande, et avec ses
 * cadres (iframes) si on le demande.
 */
async function read(payload, context) {
  return withTab(payload, context, async (tab) => {
    const options = {
      selector: payload.selector,
      format: payload.format,
      maxChars: payload.maxChars,
      jsonLd: payload.jsonLd === true,
    };

    let scrolled = null;
    if (payload.scroll) {
      scrolled = await inject(tab.id, scrollThrough, [payload.scroll === true ? 25 : Number(payload.scroll)]);
    }

    if (!payload.frames) {
      const page = await inject(tab.id, readPage, [options]);
      return scrolled ? { ...page, scrolled } : page;
    }

    // Un cadre qui ne finit jamais de charger (publicité, vérification
    // anti-robot) retiendrait l'injection : on n'attend pas le chargement, et
    // on borne l'attente.
    const results = await Promise.race([
      chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: readPage,
        args: [options],
        injectImmediately: true,
      }),
      sleep(20000).then(() => { throw new Error('lecture des cadres trop longue (20 s) : relance sans --frames'); }),
    ]);

    const main = results.find((frame) => frame.frameId === 0)?.result;
    if (!main) throw new Error('cadre principal illisible');
    if (main.error) throw new Error(main.error);

    const { browserBridgeBlockedSites } = await settings();
    const frames = results
      .filter((frame) => frame.frameId !== 0 && frame.result && !frame.result.error && frame.result.length > 0)
      // Un cadre d'un site banni reste banni, où qu'il soit intégré.
      .filter((frame) => !isBlockedHost(hostOf(frame.result.url), browserBridgeBlockedSites))
      .map(({ result }) => ({
        url: result.url,
        title: result.title,
        length: result.length,
        truncated: result.truncated,
        content: result.content,
      }));

    return { ...main, ...(scrolled ? { scrolled } : {}), frames };
  });
}

/** `localStorage`, `sessionStorage` et cookies lisibles – derrière sa case. */
async function storage(payload, context) {
  await assertAllowed('browserBridgeAllowStorage', 'la lecture du stockage');
  return withTab(payload, context, (tab) =>
    inject(tab.id, readStorage, [{ filter: payload.filter, maxChars: payload.maxChars }]));
}

/**
 * Écoute un onglet avec le débogueur : requêtes complètes (méthode, corps
 * envoyé, en-têtes et corps reçus sur demande) et messages de console.
 *
 * Avec `url`, on s'attache à un onglet vide *avant* de charger l'adresse,
 * sinon les premières requêtes – les plus intéressantes – seraient déjà
 * passées. Avec un onglet existant, on écoute ce qui passe pendant `duration`
 * secondes, ou on le recharge avec `reload`.
 */
async function inspect(payload, context) {
  await assertAllowed('browserBridgeAllowDebugger', "l'inspection par le débogueur");

  let tab;
  const temporary = Boolean(payload.url && !payload.keep);

  if (payload.url) {
    await assertReadable(payload.url);
    tab = await chrome.tabs.create({ url: 'about:blank', active: payload.active === true });
    await setOwned(tab.id, true);
  } else {
    tab = await targetTab(payload);
    await showWidget(tab.id, tab.url, context.action);
  }
  noteTab(context, tab, temporary);

  try {
    const recorded = await recordActivity(
      tab.id,
      {
        console: payload.console === true,
        bodies: payload.bodies === true,
        bodyFilter: payload.filter,
        maxBodyChars: payload.maxChars,
      },
      async () => {
        if (payload.url) {
          await chrome.tabs.update(tab.id, { url: payload.url });
          await sleep(300);
          const loaded = await waitForLoad(tab.id, (payload.timeout || 30) * 1000);
          await assertReadable(loaded.url);
        } else if (payload.reload) {
          await chrome.tabs.reload(tab.id);
          await sleep(300);
          await waitForLoad(tab.id, (payload.timeout || 30) * 1000);
        }
        await sleep((payload.duration ?? 3) * 1000);
      },
    );

    const current = await chrome.tabs.get(tab.id);
    noteTab(context, current, temporary);

    const { browserBridgeBlockedSites } = await settings();
    const types = payload.types ? String(payload.types).toLowerCase().split(',') : [];

    const requests = recorded.requests
      .filter((request) => /^https?:/.test(request.url))
      .filter((request) => !isBlockedHost(hostOf(request.url), browserBridgeBlockedSites))
      .filter((request) => !payload.filter || request.url.includes(payload.filter))
      .filter((request) => !types.length || types.includes(String(request.type).toLowerCase()))
      .map((request) => {
        const { requestHeaders, responseHeaders, finished, ...rest } = request;
        // Les en-têtes pèsent lourd et portent les cookies : sur demande seulement.
        return payload.headers ? { ...rest, requestHeaders, responseHeaders } : rest;
      });

    const limit = payload.limit || 200;
    return {
      url: current.url,
      title: current.title,
      total: requests.length,
      requests: requests.slice(-limit),
      console: recorded.messages,
      ...(payload.keep ? { tabId: tab.id } : {}),
    };
  } finally {
    if (temporary) await closeOwnedTab(tab.id);
  }
}

// ── Requête directe ──────────────────────────────────────────────────────

const TEXT_TYPES = /^text\/|json|xml|javascript|x-www-form-urlencoded|svg/i;

/**
 * Va chercher une adresse avec la session du navigateur, sans ouvrir d'onglet.
 *
 * GET uniquement : c'est une lecture. Sert surtout à récupérer le corps d'une
 * requête repérée par `network` (une API JSON, un flux), que la page a reçu
 * mais que l'API Performance ne montre pas.
 */
async function fetchResource(payload) {
  await assertReadable(payload.url);
  const maxChars = payload.maxChars || 200000;

  const response = await fetch(payload.url, { credentials: 'include', redirect: 'follow' });
  // Même règle que pour un onglet : on ne rend rien d'un site banni atteint
  // par redirection.
  await assertReadable(response.url);

  const contentType = response.headers.get('content-type') || '';
  const result = { url: response.url, status: response.status, contentType };

  if (!TEXT_TYPES.test(contentType)) {
    const size = (await response.arrayBuffer()).byteLength;
    return { ...result, binary: true, size };
  }

  const body = await response.text();
  return { ...result, length: body.length, truncated: body.length > maxChars, body: body.slice(0, maxChars) };
}

// ── Actions ──────────────────────────────────────────────────────────────

/** Actions autorisées. Tout le reste est refusé et journalisé. */
const ACTIONS = {
  ping: async () => ({ pong: true, version: 1 }),

  /** Les onglets ouverts. Ceux d'un site banni n'apparaissent pas du tout. */
  tabs: async () => {
    const { browserBridgeBlockedSites } = await settings();
    const tabs = await chrome.tabs.query({});
    return tabs
      .filter((tab) => /^https?:/.test(tab.url || ''))
      .filter((tab) => !isBlockedHost(new URL(tab.url).hostname, browserBridgeBlockedSites))
      .map((tab) => ({ tabId: tab.id, windowId: tab.windowId, active: tab.active, title: tab.title, url: tab.url }));
  },

  /** Ouvre une page et la garde ouverte, pour plusieurs lectures de suite. */
  open: async (payload, context) => {
    const tab = await openTab(payload);
    noteTab(context, tab, false);
    return { tabId: tab.id, url: tab.url, title: tab.title };
  },

  /** Referme un onglet – seulement s'il a été ouvert par le pont. */
  close: async (payload) => {
    const tabId = Number(payload.tabId);
    if (!(await ownedTabs()).includes(tabId)) {
      throw new Error('cet onglet n\'a pas été ouvert par le pont : il ne lui appartient pas');
    }
    await closeOwnedTab(tabId);
    return { closed: tabId };
  },

  read,

  query: (payload, context) => {
    if (!payload.selector) throw new Error('sélecteur manquant');
    return withTab(payload, context, (tab) =>
      inject(tab.id, queryElements, [{
        selector: payload.selector,
        limit: payload.limit,
        html: payload.html === true,
        maxChars: payload.maxChars,
      }]));
  },

  network: (payload, context) =>
    withTab(payload, context, (tab) =>
      inject(tab.id, listResources, [{
        filter: payload.filter,
        types: payload.types ? String(payload.types).split(',') : [],
        limit: payload.limit,
      }])),

  screenshot,
  inspect,
  storage,

  fetch: fetchResource,
};

/** Écrit la ligne du journal, puis rafraîchit la pastille de l'onglet. */
async function log(command, context, outcome, durationMs) {
  // Un `ping` ne lit rien : il n'a pas sa place dans ce qui « s'est passé ».
  if (command.action === 'ping') return;

  const payload = command.payload || {};
  const result = outcome.result;
  const url = result?.url || context.url || payload.url || '';

  const entry = {
    id: command.id,
    at: Date.now(),
    action: command.action,
    url,
    host: hostOf(url),
    title: result?.title || context.title || '',
    detail: payload.selector || payload.filter || '',
    ok: outcome.ok,
    error: outcome.error || '',
    summary: outcome.ok ? summarize(command.action, result) : '',
    durationMs,
  };

  if (outcome.ok && command.action === 'screenshot' && result.dataUrl) {
    const preview = await thumbnail(result.dataUrl);
    if (preview) {
      entry.thumbnail = preview.dataUrl;
      entry.summary += ` · ${preview.width} × ${preview.height}`;
    }
  }

  await record(entry);
  if (context.tabId && !context.temporary) await showWidget(context.tabId, url, null);
}

async function handle(command) {
  const action = ACTIONS[command.action];
  if (!action) {
    console.warn(LOG, 'action refusée :', command.action);
    return { id: command.id, ok: false, error: `action inconnue : ${command.action}` };
  }
  const context = { action: command.action };
  const started = Date.now();
  let outcome;
  try {
    outcome = { ok: true, result: await action(command.payload || {}, context) };
  } catch (err) {
    outcome = { ok: false, error: String(err.message || err) };
  }

  try {
    await log(command, context, outcome, Date.now() - started);
  } catch (err) {
    // Le journal est un confort : il ne doit jamais faire perdre un résultat.
    console.error(LOG, 'journal', err);
  }
  return { id: command.id, ...outcome };
}

// ── Sonde ────────────────────────────────────────────────────────────────

async function report(base, token, result) {
  try {
    await fetch(`${base}/results`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-token': token },
      body: JSON.stringify([result]),
    });
  } catch (err) {
    console.error(LOG, 'résultat non remis', err);
  }
}

/** Un tour de sonde. Rend faux quand il faut arrêter la boucle. */
async function round() {
  const cfg = await settings();
  if (!cfg.enableBrowserBridge || !cfg.browserBridgeToken) return false;

  const base = `http://127.0.0.1:${cfg.browserBridgePort}`;
  let commands;

  try {
    const response = await fetch(`${base}/commands?wait=${LONG_POLL_SECONDS}`, {
      headers: { 'x-bridge-token': cfg.browserBridgeToken },
      signal: AbortSignal.timeout((LONG_POLL_SECONDS + 8) * 1000),
    });
    if (!response.ok) return false;
    commands = await response.json();
  } catch {
    // Serveur éteint : c'est le cas normal la plupart du temps, on se tait.
    return false;
  }

  // Trace du dernier échange réussi, pour l'écran des options. L'appel sert
  // aussi de battement : chaque appel d'API repousse l'arrêt du worker, qui
  // tomberait sinon après trente secondes sans événement.
  await chrome.storage.local.set({ browserBridgeLastContact: Date.now() });

  // Sans `await` : une lecture qui dure dix secondes ne doit pas empêcher de
  // prendre l'ordre suivant.
  for (const command of Array.isArray(commands) ? commands : []) {
    handle(command).then((result) => report(base, cfg.browserBridgeToken, result));
  }
  return true;
}

let pumping = false;

/** Enchaîne les tours tant que le serveur répond. Une seule boucle à la fois. */
export async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (await round()) { /* le serveur retient chaque tour : pas de boucle chaude */ }
  } finally {
    pumping = false;
  }
}

export function installIdlePoll() {
  // Trente secondes : le plus court que `chrome.alarms` accepte. C'est le
  // délai maximal entre le démarrage du serveur et le premier ordre servi.
  chrome.alarms.create(IDLE_ALARM, { periodInMinutes: 0.5 });
}

export function isIdleAlarm(alarm) {
  return alarm.name === IDLE_ALARM;
}

export function isSetting(changes) {
  return Object.keys(SETTINGS_DEFAULTS).some((key) => key in changes);
}

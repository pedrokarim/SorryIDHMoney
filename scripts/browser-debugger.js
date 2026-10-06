/*
 * browser-debugger.js – Ce que seul le débogueur de Chrome sait lire.
 *
 * Trois choses échappent aux relevés ordinaires : le détail des requêtes
 * (méthode, en-têtes, corps envoyé et reçu), la console de la page, et une
 * capture de la page entière. `chrome.debugger` les donne toutes.
 *
 * Il a un prix, d'où sa propre case, décochée par défaut :
 *   - Chrome affiche un bandeau « … a commencé à déboguer ce navigateur » tant
 *     qu'il est attaché ;
 *   - certains sites anti-robots détectent un débogueur attaché ;
 *   - les en-têtes relevés contiennent les cookies et jetons de la session.
 *
 * On s'attache le temps d'un ordre et on se détache aussitôt, y compris en
 * cas d'échec. **Toujours en lecture** : on écoute et on photographie, on
 * n'envoie aucune commande qui agisse sur la page.
 */

const PROTOCOL_VERSION = '1.3';

function assertAvailable() {
  if (!chrome.debugger) {
    throw new Error('permission « debugger » absente du manifeste : reporte-la depuis manifest.example.json et recharge l\'extension');
  }
}

async function attach(tabId) {
  assertAvailable();
  try {
    await chrome.debugger.attach({ tabId }, PROTOCOL_VERSION);
  } catch (err) {
    // Les outils de développement ouverts sur l'onglet tiennent déjà la place.
    throw new Error(`débogueur non attaché : ${err.message || err}`);
  }
}

async function detach(tabId) {
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Onglet fermé ou débogueur déjà détaché : rien à réparer.
  }
}

const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);

/** Photographie la page entière, pas seulement ce qui est à l'écran. */
export async function captureFullPage(tabId) {
  await attach(tabId);
  try {
    const { cssContentSize } = await send(tabId, 'Page.getLayoutMetrics');
    // Au-delà, Chrome rend une image vide ou refuse : on coupe et on le dit.
    const MAX_HEIGHT = 16000;
    const height = Math.min(Math.ceil(cssContentSize.height), MAX_HEIGHT);
    const width = Math.ceil(cssContentSize.width);

    /*
     * On agrandit la fenêtre d'affichage à la taille de la page le temps du
     * cliché, puis on la rend.
     *
     * Demander simplement une capture « au-delà de l'écran » ne suffit pas
     * dans une fenêtre visible : Chrome ne dessine que l'écran courant, et
     * l'image obtenue répétait le premier écran cinq fois de suite, à la bonne
     * hauteur – fausse sans en avoir l'air.
     */
    await send(tabId, 'Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 0, mobile: false,
    });
    try {
      // Le temps que la page se redispose et se redessine à cette taille.
      await new Promise((r) => setTimeout(r, 600));
      const { data } = await send(tabId, 'Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width, height, scale: 1 },
      });
      return { dataUrl: `data:image/png;base64,${data}`, clipped: cssContentSize.height > MAX_HEIGHT };
    } finally {
      await send(tabId, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
    }
  } finally {
    await detach(tabId);
  }
}

/** Réduit un argument de console à du texte lisible. */
function describeArgument(arg) {
  if (arg.value !== undefined) return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  return arg.description || arg.unserializableValue || arg.type;
}

/**
 * Écoute l'onglet pendant que `drive` le fait vivre (chargement, attente),
 * puis rend ce qui est passé.
 *
 * `options` : { console, bodies, bodyFilter, maxBodyChars, maxBodies }.
 */
export async function recordActivity(tabId, options, drive) {
  const requests = new Map();
  const messages = [];

  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId) return;

    switch (method) {
      case 'Network.requestWillBeSent':
        requests.set(params.requestId, {
          url: params.request.url,
          method: params.request.method,
          type: params.type || null,
          requestHeaders: params.request.headers,
          postData: params.request.postData,
          status: null,
        });
        break;
      case 'Network.responseReceived': {
        const request = requests.get(params.requestId);
        if (!request) break;
        request.status = params.response.status;
        request.mimeType = params.response.mimeType;
        request.responseHeaders = params.response.headers;
        request.type = params.type || request.type;
        break;
      }
      case 'Network.loadingFinished': {
        const request = requests.get(params.requestId);
        if (request) { request.finished = true; request.size = params.encodedDataLength; }
        break;
      }
      case 'Network.loadingFailed': {
        const request = requests.get(params.requestId);
        if (request) request.failure = params.errorText;
        break;
      }
      case 'Log.entryAdded':
        messages.push({ level: params.entry.level, text: params.entry.text, source: params.entry.url || params.entry.source });
        break;
      case 'Runtime.consoleAPICalled':
        messages.push({ level: params.type, text: params.args.map(describeArgument).join(' ') });
        break;
      case 'Runtime.exceptionThrown':
        messages.push({
          level: 'exception',
          text: params.exceptionDetails.exception?.description || params.exceptionDetails.text,
        });
        break;
      default:
    }
  };

  await attach(tabId);
  chrome.debugger.onEvent.addListener(onEvent);

  try {
    await send(tabId, 'Network.enable');
    await send(tabId, 'Log.enable');
    // `Runtime.enable` est le domaine que les anti-robots repèrent le mieux :
    // on ne l'active que si la console est demandée.
    if (options.console) await send(tabId, 'Runtime.enable');

    await drive();

    if (options.bodies) {
      const wanted = [...requests.entries()]
        .filter(([, request]) => request.finished && /^(XHR|Fetch|Document)$/.test(request.type || ''))
        .filter(([, request]) => !options.bodyFilter || request.url.includes(options.bodyFilter))
        .slice(-(options.maxBodies || 20));

      for (const [requestId, request] of wanted) {
        try {
          const { body, base64Encoded } = await send(tabId, 'Network.getResponseBody', { requestId });
          if (base64Encoded) continue;
          const maxChars = options.maxBodyChars || 20000;
          request.body = body.slice(0, maxChars);
          request.bodyTruncated = body.length > maxChars;
        } catch {
          // Chrome ne garde pas tous les corps (redirections, cache vidé).
        }
      }
    }
  } finally {
    chrome.debugger.onEvent.removeListener(onEvent);
    await detach(tabId);
  }

  return { requests: [...requests.values()], messages };
}

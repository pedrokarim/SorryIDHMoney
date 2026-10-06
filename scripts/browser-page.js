/*
 * browser-page.js – Les relevés du pont navigateur, exécutés dans la page.
 *
 * Chaque fonction exportée est sérialisée puis injectée par
 * `chrome.scripting.executeScript` : elle ne voit rien de ce fichier, ni
 * import, ni constante, ni fonction voisine. Tout ce dont elle a besoin passe
 * par ses arguments ou vit dans son propre corps, et ce qu'elle rend doit
 * survivre à un JSON.
 *
 * **Strictement en lecture.** Aucun clic, aucun champ rempli, aucune requête.
 * Le seul geste qui touche la page est un défilement, pour amener un élément
 * à l'écran avant de le photographier.
 */

/**
 * Rend le contenu de la page, ou d'un de ses éléments.
 *
 * Le Markdown est le format par défaut : c'est celui qu'un modèle lit le
 * mieux, et il pèse cinq à dix fois moins que le HTML dont il est tiré. C'est
 * aussi le seul des trois à rendre le texte posé par CSS (`::before`,
 * `::after`) : `text` s'en tient à `innerText`, qui l'ignore.
 */
export function readPage(options) {
  const { selector, format = 'markdown', maxChars = 100000, jsonLd = false } = options || {};

  const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IFRAME', 'CANVAS', 'HEAD']);
  const BLOCKS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'DETAILS', 'DIALOG', 'DIV', 'DL', 'DD', 'DT', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'HEADER', 'MAIN', 'NAV', 'P', 'SECTION', 'SUMMARY',
  ]);

  const isHidden = (el) => {
    // La pastille du pont est posée par l'extension : elle ne fait pas partie
    // de la page qu'on lit.
    if (el.id === 'sorryidhmoney-bridge-widget') return true;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility === 'hidden';
  };

  const absolute = (href) => {
    try { return new URL(href, document.baseURI).href; } catch { return ''; }
  };

  /*
   * Le texte qu'une page pose par CSS (`::before { content: attr(data-x) }`).
   *
   * Il n'existe dans aucun nœud : ni `innerText` ni un parcours du DOM ne le
   * voient. Des sites s'en servent justement pour afficher leurs chiffres
   * sans les livrer à qui lit le texte. On ne garde que les chaînes simples,
   * et on écarte les glyphes de polices d'icônes (zone à usage privé).
   */
  const pseudoText = (el, pseudo) => {
    const content = getComputedStyle(el, pseudo).content;
    const match = /^"((?:[^"\\]|\\.)*)"$/.exec(content);
    if (!match) return '';
    return match[1].replace(/\\(.)/g, '$1').replace(/[-]/g, '');
  };

  const children = (node) => {
    const inner = [...node.childNodes].map(toMarkdown).join('');
    if (node.nodeType !== Node.ELEMENT_NODE) return inner;
    return pseudoText(node, '::before') + inner + pseudoText(node, '::after');
  };

  // Le contenu d'un élément, sur une ligne. Part des enfants et non du nœud
  // lui-même : un titre qui se reconvertirait bouclerait sans fin.
  const inline = (node) => children(node).replace(/\s+/g, ' ').trim();

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll('tr')]
      .map((tr) => [...tr.children].map((cell) => inline(cell).replace(/\|/g, '\\|')))
      .filter((cells) => cells.length);
    if (!rows.length) return '';
    const lines = rows.map((cells) => `| ${cells.join(' | ')} |`);
    lines.splice(1, 0, `| ${rows[0].map(() => '---').join(' | ')} |`);
    return `\n\n${lines.join('\n')}\n\n`;
  }

  function toMarkdown(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const tag = node.tagName.toUpperCase();
    if (SKIPPED.has(tag) || isHidden(node)) return '';

    if (/^H[1-6]$/.test(tag)) {
      const title = inline(node);
      return title ? `\n\n${'#'.repeat(Number(tag[1]))} ${title}\n\n` : '';
    }

    switch (tag) {
      case 'BR':
        return '\n';
      case 'HR':
        return '\n\n---\n\n';
      case 'PRE':
        return `\n\n\`\`\`\n${node.textContent.replace(/\n+$/, '')}\n\`\`\`\n\n`;
      case 'CODE':
        return `\`${node.textContent}\``;
      case 'STRONG':
      case 'B': {
        const text = inline(node);
        return text ? `**${text}**` : '';
      }
      case 'EM':
      case 'I': {
        const text = inline(node);
        return text ? `*${text}*` : '';
      }
      case 'A': {
        const text = inline(node);
        const href = node.getAttribute('href') || '';
        if (!text) return '';
        if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return text;
        return `[${text}](${absolute(href)})`;
      }
      case 'IMG': {
        // Sans texte alternatif, une image n'apprend rien à qui lit du texte.
        const alt = (node.getAttribute('alt') || '').trim();
        const src = node.currentSrc || node.getAttribute('src') || '';
        return alt && src && !src.startsWith('data:') ? `![${alt}](${absolute(src)})` : '';
      }
      case 'UL':
      case 'OL': {
        const items = [...node.children]
          .filter((child) => child.tagName === 'LI')
          .map((li, index) => {
            const text = children(li).trim().replace(/\n{2,}/g, '\n').replace(/\n/g, '\n  ');
            return text ? `${tag === 'OL' ? `${index + 1}.` : '-'} ${text}` : '';
          })
          .filter(Boolean);
        return items.length ? `\n\n${items.join('\n')}\n\n` : '';
      }
      case 'BLOCKQUOTE': {
        const text = children(node).trim();
        return text ? `\n\n${text.split('\n').map((line) => `> ${line}`).join('\n')}\n\n` : '';
      }
      case 'TABLE':
        return tableToMarkdown(node);
      case 'INPUT':
      case 'TEXTAREA':
      case 'SELECT':
        return '';
      default: {
        const text = children(node);
        return BLOCKS.has(tag) ? `\n\n${text}\n\n` : text;
      }
    }
  }

  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) {
    return { error: `aucun élément ne correspond à « ${selector} »` };
  }

  let content;
  if (format === 'html' || format === 'text') {
    // La pastille du pont n'est pas du contenu : on la retire d'une copie,
    // ou on la masque le temps de lire, sans toucher à la page elle-même.
    const widget = document.getElementById('sorryidhmoney-bridge-widget');
    if (format === 'html') {
      const copy = root.cloneNode(true);
      copy.querySelector?.('#sorryidhmoney-bridge-widget')?.remove();
      content = copy.outerHTML;
    } else {
      const display = widget?.style.display;
      if (widget) widget.style.display = 'none';
      content = root.innerText || '';
      if (widget) widget.style.display = display;
    }
  }
  else {
    content = toMarkdown(root)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const meta = (name) =>
    document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute('content') || null;

  const page = {
    url: location.href,
    title: document.title,
    description: meta('description') || meta('og:description'),
    language: document.documentElement.lang || null,
    format,
    length: content.length,
    // Le dire vaut mieux que de laisser croire à une page complète.
    truncated: content.length > maxChars,
    content: content.slice(0, maxChars),
  };

  if (jsonLd) {
    page.jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((script) => { try { return JSON.parse(script.textContent); } catch { return null; } })
      .filter(Boolean);
  }

  return page;
}

/**
 * Rend les éléments qui correspondent à un sélecteur CSS : balise, texte,
 * attributs, position. C'est l'outil pour cibler une chose précise au lieu
 * de relire toute la page.
 */
export function queryElements(options) {
  const { selector, limit = 50, html = false, maxChars = 2000 } = options || {};

  let matches;
  try {
    matches = [...document.querySelectorAll(selector)].filter((el) => el.id !== 'sorryidhmoney-bridge-widget');
  } catch {
    return { error: `sélecteur invalide : ${selector}` };
  }

  const elements = matches.slice(0, limit).map((el, index) => {
    const rect = el.getBoundingClientRect();
    const text = (el.innerText ?? el.textContent ?? '').trim();
    const entry = {
      index,
      tag: el.tagName.toLowerCase(),
      text: text.slice(0, maxChars),
      attributes: Object.fromEntries([...el.attributes].map((a) => [a.name, a.value.slice(0, maxChars)])),
      visible: rect.width > 0 && rect.height > 0,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
    // Une valeur saisie ne figure pas dans les attributs : elle vit sur l'objet.
    if ('value' in el && typeof el.value === 'string' && el.type !== 'password') entry.value = el.value;
    if (html) entry.html = el.outerHTML.slice(0, maxChars * 5);
    return entry;
  });

  return { url: location.href, selector, total: matches.length, returned: elements.length, elements };
}

/**
 * Rend les requêtes que la page a faites, d'après l'API Performance.
 *
 * C'est un relevé a posteriori : il marche sur un onglet ouvert depuis une
 * heure, sans rien avoir écouté avant. En échange il ne connaît ni la méthode,
 * ni les en-têtes, ni le corps – seulement l'adresse, le type, le statut et le
 * poids. Pour le corps, on redemande l'adresse avec l'action `fetch`.
 */
export function listResources(options) {
  const { filter = '', types = [], limit = 300 } = options || {};

  const entries = [
    ...performance.getEntriesByType('navigation'),
    ...performance.getEntriesByType('resource'),
  ];

  const requests = entries
    .map((entry) => ({
      url: entry.name,
      type: entry.initiatorType || entry.entryType,
      // Zéro pour une ressource d'une autre origine qui ne s'expose pas
      // (pas de `Timing-Allow-Origin`) : inconnu, pas « échec ».
      status: entry.responseStatus || null,
      size: entry.transferSize || entry.encodedBodySize || null,
      startMs: Math.round(entry.startTime),
      durationMs: Math.round(entry.duration),
    }))
    .filter((request) => !filter || request.url.includes(filter))
    .filter((request) => !types.length || types.includes(request.type));

  return {
    url: location.href,
    total: requests.length,
    // On garde les plus récentes : ce sont elles qu'on vient chercher.
    requests: requests.slice(-limit),
  };
}

/**
 * Amène un élément à l'écran et rend son cadre, pour qu'on puisse le découper
 * dans une capture. Rend `null` s'il n'existe pas.
 */
export function locateElement(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const rect = el.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

/**
 * Fait défiler la page jusqu'en bas, puis revient d'où l'on vient.
 *
 * Beaucoup de pages ne chargent leur suite qu'à l'approche du bas (listes
 * sans fin, images paresseuses) : lues telles quelles, elles s'arrêtent au
 * premier écran. Par petits pas, pour laisser à chaque tranche le temps
 * d'arriver – un saut direct en bas enjamberait tout ce qui se charge au
 * passage.
 */
export function scrollThrough(maxRounds) {
  const rounds = Math.min(Math.max(1, maxRounds || 25), 200);
  const origin = { x: window.scrollX, y: window.scrollY };

  return (async () => {
    let stalled = 0;
    let done = 0;

    for (; done < rounds; done++) {
      const before = window.scrollY;
      const heightBefore = document.documentElement.scrollHeight;
      window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 350));

      // Ni la position ni la hauteur n'ont bougé : on est au bout. Deux tours
      // de suite, parce qu'un chargement lent ressemble un instant à une fin.
      const stuck = window.scrollY === before && document.documentElement.scrollHeight === heightBefore;
      stalled = stuck ? stalled + 1 : 0;
      if (stalled >= 2) break;
    }

    const height = document.documentElement.scrollHeight;
    window.scrollTo({ left: origin.x, top: origin.y, behavior: 'instant' });
    return { rounds: done, height };
  })();
}

/**
 * Rend ce que la page garde en mémoire dans le navigateur : `localStorage`,
 * `sessionStorage` et les cookies que le JavaScript peut lire (pas les
 * `HttpOnly`). Ces valeurs contiennent souvent des jetons de session, d'où la
 * case dédiée côté extension.
 */
export function readStorage(options) {
  const { filter = '', maxChars = 2000 } = options || {};

  const dump = (getStore) => {
    const entries = {};
    try {
      const store = getStore();
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (filter && !key.includes(filter)) continue;
        const value = store.getItem(key) || '';
        entries[key] = value.length > maxChars ? `${value.slice(0, maxChars)}… (${value.length} caractères)` : value;
      }
    } catch {
      // Stockage interdit à cette page (cadre isolé, réglage du navigateur).
    }
    return entries;
  };

  const cookies = {};
  for (const pair of document.cookie.split('; ').filter(Boolean)) {
    const cut = pair.indexOf('=');
    const key = cut < 0 ? pair : pair.slice(0, cut);
    if (filter && !key.includes(filter)) continue;
    cookies[key] = cut < 0 ? '' : pair.slice(cut + 1).slice(0, maxChars);
  }

  // Par fonction : l'accès lui-même lève une erreur dans un cadre isolé.
  const local = dump(() => window.localStorage);
  const session = dump(() => window.sessionStorage);

  return {
    url: location.href,
    total: Object.keys(local).length + Object.keys(session).length + Object.keys(cookies).length,
    localStorage: local,
    sessionStorage: session,
    cookies,
  };
}

/**
 * Vrai si la page affichée est une vérification anti-robot (Cloudflare et
 * consorts) et non le site lui-même.
 *
 * Dans un vrai navigateur, cette page se valide seule en quelques secondes
 * puis laisse place au site. La lire à ce moment-là rendrait « Un instant… »
 * à la place du contenu, sans que rien ne signale l'erreur.
 */
export function detectChallenge() {
  const TITLES = /^(just a moment|un instant|einen moment|un momento|attention required|checking your browser)/i;
  return TITLES.test(document.title.trim())
    || Boolean(document.querySelector('#challenge-form, #challenge-running, #cf-challenge-running, #challenge-error-text'));
}

/*
 * Outils d'interface communs aux pages de l'extension.
 *
 * - Un seul jeu d'icônes (trait 2 px, grille 24) : `<i data-icon="nom"></i>`
 *   dans le HTML est remplacé par le SVG au chargement de ce script, placé en
 *   fin de <body>. Pour du contenu créé en JS : `UI.icon('nom')`.
 * - `UI.el(tag, className, text)` : création d'élément sans innerHTML.
 * - `UI.flash(button, text)` : retour bref sur un bouton.
 * - `UI.pager(container, page, pages, onChange)` : pagination commune.
 */
(function () {
  const PATHS = {
    'arrow-left': '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
    'chevron-right': '<path d="M9 18l6-6-6-6"/>',
    'chevron-left': '<path d="M15 18l-6-6 6-6"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.54V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.54-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.54V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.54 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    film: '<rect x="2" y="3" width="20" height="18" rx="3"/><path d="M7 3v18M17 3v18M2 9h5M2 15h5M17 9h5M17 15h5"/>',
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-9"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/>',
    bridge: '<path d="M3 17h18M6 17v-7M18 17v-7M3 8c4 6 14 6 18 0"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>',
    restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    x: '<path d="M18 6L6 18M6 6l12 12"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
    github: '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3.1-.4 6.4-1.5 6.4-7A5.4 5.4 0 0 0 20 4.8 5 5 0 0 0 19.9 1S18.7.6 16 2.5a13.4 13.4 0 0 0-7 0C6.3.6 5.1 1 5.1 1A5 5 0 0 0 5 4.8a5.4 5.4 0 0 0-1.5 3.7c0 5.5 3.3 6.6 6.4 7a3.4 3.4 0 0 0-.9 2.6V22"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    'shield-off': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2M16 7l3 3M18 5l2 2"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    'eye-off': '<path d="M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="M1 1l22 22"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    palette: '<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2c0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3a2 2 0 0 1 2-2h2.3A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z"/>',
    play: '<rect x="2" y="4" width="20" height="16" rx="4"/><path d="M10 9l5 3-5 3z"/>',
    tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M17 2l-5 5-5-5"/>',
    sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.7-4 3-9 3s-9-1.3-9-3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0"/><path d="M12 2v10"/>',
  };

  function icon(name, extraClass) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'i' + (extraClass ? ' ' + extraClass : ''));
    svg.setAttribute('aria-hidden', 'true');
    // Chaînes constantes définies ci-dessus, jamais de donnée extérieure.
    svg.innerHTML = PATHS[name] || PATHS.info;
    return svg;
  }

  function hydrate(root) {
    for (const node of (root || document).querySelectorAll('i[data-icon]')) {
      node.replaceWith(icon(node.dataset.icon, node.className));
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function flash(button, text, ms = 1400) {
    const label = button.querySelector('.label') || button;
    // Le texte d'origine est retenu au premier appel : deux retours qui se
    // suivent ne doivent pas laisser le premier affiché pour de bon.
    if (button._flashOriginal === undefined) button._flashOriginal = label.textContent;
    label.textContent = text;
    clearTimeout(button._flashTimer);
    button._flashTimer = setTimeout(() => {
      label.textContent = button._flashOriginal;
      button._flashOriginal = undefined;
    }, ms);
  }

  /** Pagination : précédent, numéros (avec ellipses), suivant. */
  function pager(container, page, pages, onChange) {
    container.replaceChildren();
    if (pages <= 1) {
      container.hidden = true;
      return;
    }
    container.hidden = false;

    const make = (content, target, opts = {}) => {
      const b = document.createElement('button');
      b.type = 'button';
      if (typeof content === 'string') b.textContent = content;
      else b.appendChild(content);
      if (opts.label) b.setAttribute('aria-label', opts.label);
      if (opts.current) b.setAttribute('aria-current', 'page');
      b.disabled = !!opts.disabled;
      b.addEventListener('click', () => onChange(target));
      return b;
    };
    const gap = () => el('span', 'gap', '…');

    container.appendChild(make(icon('chevron-left', 'i-sm'), page - 1, { disabled: page <= 1, label: 'Page précédente' }));

    let start = Math.max(1, page - 2);
    const end = Math.min(pages, start + 4);
    start = Math.max(1, end - 4);
    if (start > 1) {
      container.appendChild(make('1', 1));
      if (start > 2) container.appendChild(gap());
    }
    for (let p = start; p <= end; p++) {
      container.appendChild(make(String(p), p, { current: p === page }));
    }
    if (end < pages) {
      if (end < pages - 1) container.appendChild(gap());
      container.appendChild(make(String(pages), pages));
    }

    container.appendChild(make(icon('chevron-right', 'i-sm'), page + 1, { disabled: page >= pages, label: 'Page suivante' }));
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('fr-FR').format(n || 0);
  }

  /**
   * Valeur d'un compteur : abrégée au-delà de 100 000 (« 1,3 M ») pour tenir
   * dans sa tuile, la valeur exacte restant en infobulle.
   */
  function setStat(node, n) {
    const value = n || 0;
    node.textContent = value >= 100000
      ? new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
      : formatNumber(value);
    node.title = formatNumber(value);
  }

  window.UI = { icon, hydrate, el, flash, pager, formatNumber, setStat };
  hydrate();
})();

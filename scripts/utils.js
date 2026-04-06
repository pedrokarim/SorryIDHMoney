let linkElement = null;
let secondLinkElement = null;
let style = null;
let popoverElement = null;
let popoverOpen = false;
let popoverAnchorSite = null;

export function addCustomButton(site, link, options = {}) {
  const { openInNewTab = false, styles = {} } = options;

  const element = document.createElement("a");
  element.classList.add("custom-button");
  element.href = link;
  element.target = openInNewTab ? "_blank" : "_self";

  const baseColor = site === "anilist" ? "#19212d" : "#2e51a2";
  const hoverColor = site === "anilist" ? "#2c3a4f" : "#4169cc";

  Object.assign(element.style, {
    backgroundColor: baseColor,
    color: "#ffffff",
    width: "50px",
    height: "50px",
    borderRadius: "8px",
    fontSize: "14px",
    border: "none",
    cursor: "pointer",
    position: "fixed",
    bottom: "20px",
    left: "20px",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)",
    overflow: "hidden",
    transition: 'background-color 0.2s',
    zIndex: '99999',
    ...styles,
  });

  element.addEventListener('mouseenter', () => {
    element.style.backgroundColor = hoverColor;
  });

  element.addEventListener('mouseleave', () => {
    element.style.backgroundColor = baseColor;
  });

  element.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    window.open(link, openInNewTab ? "_blank" : "_self");
  });

  document.body.appendChild(element);

  if (site === "myanimelist") {
    element.innerHTML = `<img src="https://myanimelist.net/img/common/pwa/launcher-icon-3x.png" style="width:100%;height:100%;" alt='MyAnimeList Logo' />`;
    linkElement = element;
  } else if (site === "anilist") {
    element.innerHTML = `<img src="https://anilist.co/img/icons/icon.svg" style="width:100%;height:100%;" alt="AniList Logo" />`;
    secondLinkElement = element;
  }

  return element;
}

/**
 * Crée les deux boutons en mode édition (non animés, avec badge)
 * Au clic, ouvre le popover de recherche AniList
 */
export function addEditButtons(animeName, onAnimeSelected) {
  const buttons = [];

  const sites = [
    { site: "myanimelist", baseColor: "#2e51a2", hoverColor: "#4169cc", left: "20px", imgSrc: "https://myanimelist.net/img/common/pwa/launcher-icon-3x.png", alt: "MyAnimeList Logo" },
    { site: "anilist", baseColor: "#19212d", hoverColor: "#2c3a4f", left: `${20 * 2 + 50}px`, imgSrc: "https://anilist.co/img/icons/icon.svg", alt: "AniList Logo" },
  ];

  for (const { site, baseColor, hoverColor, left, imgSrc, alt } of sites) {
    const element = document.createElement("div");
    element.classList.add("custom-button-edit");
    element.setAttribute("data-site", site);

    Object.assign(element.style, {
      backgroundColor: baseColor,
      color: "#ffffff",
      width: "50px",
      height: "50px",
      borderRadius: "8px",
      fontSize: "14px",
      border: "none",
      cursor: "pointer",
      position: "fixed",
      bottom: "20px",
      left: left,
      boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)",
      overflow: "visible",
      transition: 'background-color 0.2s',
      zIndex: '99999',
      opacity: '0.7',
    });
    element.style.setProperty('animation', 'none', 'important');

    element.innerHTML = `<img src="${imgSrc}" style="width:100%;height:100%;border-radius:8px;" alt="${alt}" />`;

    // Badge d'édition en haut à droite
    const badge = document.createElement("div");
    Object.assign(badge.style, {
      position: "absolute",
      top: "-5px",
      right: "-5px",
      width: "18px",
      height: "18px",
      borderRadius: "50%",
      backgroundColor: "#FF9800",
      border: "2px solid #fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "10px",
      color: "#fff",
      fontWeight: "bold",
      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
    });
    badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    element.appendChild(badge);

    element.addEventListener('mouseenter', () => {
      element.style.backgroundColor = hoverColor;
      element.style.opacity = '1';
    });

    element.addEventListener('mouseleave', () => {
      element.style.backgroundColor = baseColor;
      element.style.opacity = '0.7';
    });

    element.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      togglePopover(element, animeName, onAnimeSelected);
    });

    document.body.appendChild(element);
    buttons.push(element);
  }

  // Bouton quitter le mode édition
  addExitEditButton();

  return buttons;
}

/**
 * Supprime les boutons d'édition et le bouton quitter
 */
export function removeEditButtons() {
  document.querySelectorAll('.custom-button-edit').forEach(el => el.remove());
  document.querySelectorAll('.custom-button-exit-edit').forEach(el => el.remove());
  destroyPopover();
}

/**
 * Ajoute un bouton "quitter le mode édition" (3ème bouton à droite des deux autres)
 * Au clic, recharge la page pour restaurer l'état normal
 */
export function addExitEditButton() {
  // Supprimer un éventuel ancien bouton
  document.querySelectorAll('.custom-button-exit-edit').forEach(el => el.remove());

  const btn = document.createElement("div");
  btn.classList.add("custom-button-exit-edit");

  Object.assign(btn.style, {
    width: "50px",
    height: "50px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    position: "fixed",
    bottom: "20px",
    left: `${20 * 3 + 50 * 2}px`,
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.24)",
    overflow: "hidden",
    transition: 'background-color 0.2s',
    zIndex: '99999',
    backgroundColor: "#e53e3e",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    animation: "none",
  });

  btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  btn.addEventListener("mouseenter", () => {
    btn.style.backgroundColor = "#c53030";
  });

  btn.addEventListener("mouseleave", () => {
    btn.style.backgroundColor = "#e53e3e";
  });

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    window.location.reload();
  });

  document.body.appendChild(btn);
  return btn;
}

/**
 * Active le mode édition sur les boutons existants (quand anime trouvé mais on veut corriger)
 */
export function enableEditModeOnButtons(animeName, onAnimeSelected) {
  const buttons = document.querySelectorAll('.custom-button');
  buttons.forEach(btn => {
    // Cloner pour supprimer les anciens listeners
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);

    // Retirer la classe animée, passer en classe édition
    newBtn.classList.remove("custom-button");
    newBtn.classList.add("custom-button-edit");
    newBtn.style.setProperty('animation', 'none', 'important');
    newBtn.style.overflow = "visible";

    // Ajouter le badge d'édition
    const badge = document.createElement("div");
    badge.classList.add("edit-mode-badge");
    Object.assign(badge.style, {
      position: "absolute",
      top: "-5px",
      right: "-5px",
      width: "18px",
      height: "18px",
      borderRadius: "50%",
      backgroundColor: "#FF9800",
      border: "2px solid #fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "10px",
      color: "#fff",
      fontWeight: "bold",
      boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
      zIndex: "100000",
    });
    badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    newBtn.appendChild(badge);

    newBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      togglePopover(newBtn, animeName, onAnimeSelected);
    });
  });

  // Ajouter le bouton quitter édition
  addExitEditButton();
}

/**
 * Désactive le mode édition
 */
export function disableEditMode() {
  document.querySelectorAll('.edit-mode-badge').forEach(badge => badge.remove());
  destroyPopover();
}

// ─── Popover de recherche ───────────────────────────────────────────────

/**
 * Toggle le popover ancré au-dessus du bouton cliqué
 */
function togglePopover(anchorElement, animeName, onAnimeSelected) {
  if (popoverOpen) {
    destroyPopover();
    return;
  }
  createPopover(anchorElement, animeName, onAnimeSelected);
}

/**
 * Crée et affiche le popover ancré au-dessus des boutons
 */
function createPopover(anchorElement, animeName, onAnimeSelected) {
  destroyPopover();

  popoverOpen = true;

  // Container du popover
  popoverElement = document.createElement("div");
  popoverElement.classList.add("search-popover");
  Object.assign(popoverElement.style, {
    position: "fixed",
    bottom: "80px",
    left: "12px",
    width: "380px",
    maxHeight: "480px",
    backgroundColor: "#1a1a2e",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.05)",
    display: "flex",
    flexDirection: "column",
    zIndex: "999999",
    color: "#fff",
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
    overflow: "hidden",
  });

  // Flèche en bas du popover
  const arrow = document.createElement("div");
  Object.assign(arrow.style, {
    position: "absolute",
    bottom: "-8px",
    left: `${anchorElement.getBoundingClientRect().left - 12 + 25}px`,
    width: "16px",
    height: "16px",
    backgroundColor: "#1a1a2e",
    transform: "rotate(45deg)",
    boxShadow: "4px 4px 8px rgba(0,0,0,0.2)",
    zIndex: "-1",
  });
  popoverElement.appendChild(arrow);

  // Header
  const header = document.createElement("div");
  Object.assign(header.style, {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px 8px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  });

  const title = document.createElement("div");
  title.textContent = "Associer un anime";
  Object.assign(title.style, { fontSize: "14px", fontWeight: "600", color: "#e0e0e0" });

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "\u00d7";
  Object.assign(closeBtn.style, {
    background: "none", border: "none", color: "#666", fontSize: "18px",
    cursor: "pointer", padding: "0 0 0 8px", lineHeight: "1",
  });
  closeBtn.addEventListener("click", destroyPopover);
  closeBtn.addEventListener("mouseenter", () => closeBtn.style.color = "#fff");
  closeBtn.addEventListener("mouseleave", () => closeBtn.style.color = "#666");

  header.appendChild(title);
  header.appendChild(closeBtn);

  // Info
  const info = document.createElement("div");
  info.textContent = `"${animeName}"`;
  Object.assign(info.style, {
    padding: "0 16px 8px",
    fontSize: "12px",
    color: "#666",
    fontStyle: "italic",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });

  // Search input
  const inputWrap = document.createElement("div");
  Object.assign(inputWrap.style, { padding: "0 12px 8px" });

  const input = document.createElement("input");
  input.classList.add("search-popover-input");
  input.type = "text";
  input.placeholder = "Rechercher sur AniList...";
  input.value = animeName;
  Object.assign(input.style, {
    width: "100%",
    padding: "8px 12px",
    border: "1px solid #333",
    borderRadius: "6px",
    backgroundColor: "#16213e",
    color: "#fff",
    fontSize: "13px",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.2s",
  });
  input.addEventListener("focus", () => input.style.borderColor = "#805ad5");
  input.addEventListener("blur", () => input.style.borderColor = "#333");
  inputWrap.appendChild(input);

  // Results list
  const resultsList = document.createElement("div");
  resultsList.classList.add("search-popover-results");
  Object.assign(resultsList.style, {
    flex: "1",
    overflowY: "auto",
    padding: "4px 12px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    minHeight: "60px",
    maxHeight: "340px",
  });

  // Scrollbar styling
  const scrollStyle = document.createElement("style");
  scrollStyle.textContent = `
    .search-popover-results::-webkit-scrollbar { width: 5px; }
    .search-popover-results::-webkit-scrollbar-track { background: transparent; }
    .search-popover-results::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
    .search-popover-results::-webkit-scrollbar-thumb:hover { background: #555; }
    .custom-button-edit { animation: none !important; }
  `;

  const loading = document.createElement("div");
  loading.textContent = "Recherche en cours...";
  Object.assign(loading.style, { textAlign: "center", padding: "16px", color: "#555", fontSize: "12px" });
  resultsList.appendChild(loading);

  popoverElement.appendChild(header);
  popoverElement.appendChild(info);
  popoverElement.appendChild(inputWrap);
  popoverElement.appendChild(scrollStyle);
  popoverElement.appendChild(resultsList);
  document.body.appendChild(popoverElement);

  // Fermer au clic en dehors
  setTimeout(() => {
    document.addEventListener("click", handleOutsideClick);
  }, 0);

  // Fermer sur Escape
  document.addEventListener("keydown", handleEscapeKey);

  // Debounced search
  let searchTimeout = null;
  input.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const query = input.value.trim();
    if (query.length < 2) {
      resultsList.innerHTML = '';
      loading.textContent = "Tapez au moins 2 caractères...";
      resultsList.appendChild(loading);
      return;
    }
    loading.textContent = "Recherche en cours...";
    resultsList.innerHTML = '';
    resultsList.appendChild(loading);

    searchTimeout = setTimeout(() => {
      searchAnilist(query, resultsList, loading, animeName, onAnimeSelected);
    }, 400);
  });

  input.focus();
  input.select();

  // Recherche initiale
  if (animeName && animeName.length >= 2) {
    searchTimeout = setTimeout(() => {
      searchAnilist(animeName, resultsList, loading, animeName, onAnimeSelected);
    }, 200);
  }
}

function handleOutsideClick(e) {
  if (popoverElement && !popoverElement.contains(e.target) && !e.target.closest('.custom-button-edit') && !e.target.closest('.edit-mode-badge')) {
    destroyPopover();
  }
}

function handleEscapeKey(e) {
  if (e.key === "Escape") {
    destroyPopover();
  }
}

/**
 * Détruit complètement le popover
 */
function destroyPopover() {
  if (popoverElement) {
    popoverElement.remove();
    popoverElement = null;
  }
  popoverOpen = false;
  document.removeEventListener("click", handleOutsideClick);
  document.removeEventListener("keydown", handleEscapeKey);
}

// ─── Recherche AniList ──────────────────────────────────────────────────

/**
 * Recherche sur l'API AniList et affiche les résultats
 */
async function searchAnilist(query, resultsList, loading, animeName, onAnimeSelected) {
  const graphqlQuery = `
    query ($search: String) {
      Page(page: 1, perPage: 10) {
        media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
          id
          idMal
          title {
            romaji
            english
            native
          }
          coverImage {
            medium
          }
          format
          episodes
          status
          seasonYear
          siteUrl
        }
      }
    }
  `;

  try {
    const response = await fetch("https://graphql.anilist.co", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ query: graphqlQuery, variables: { search: query } }),
    });

    const data = await response.json();
    const results = data?.data?.Page?.media || [];

    resultsList.innerHTML = '';

    if (results.length === 0) {
      loading.textContent = "Aucun résultat trouvé";
      resultsList.appendChild(loading);
      return;
    }

    for (const anime of results) {
      const item = createResultItem(anime, animeName, onAnimeSelected);
      resultsList.appendChild(item);
    }
  } catch (error) {
    console.error("Erreur recherche AniList:", error);
    resultsList.innerHTML = '';
    loading.textContent = "Erreur lors de la recherche";
    resultsList.appendChild(loading);
  }
}

/**
 * Crée un élément de résultat de recherche
 */
function createResultItem(anime, animeName, onAnimeSelected) {
  const item = document.createElement("div");
  Object.assign(item.style, {
    display: "flex",
    gap: "10px",
    padding: "8px",
    borderRadius: "6px",
    backgroundColor: "transparent",
    cursor: "pointer",
    transition: "background-color 0.15s",
    alignItems: "center",
    border: "1px solid transparent",
  });

  item.addEventListener("mouseenter", () => {
    item.style.backgroundColor = "#16213e";
    item.style.borderColor = "#805ad5";
  });
  item.addEventListener("mouseleave", () => {
    item.style.backgroundColor = "transparent";
    item.style.borderColor = "transparent";
  });

  // Cover image
  const img = document.createElement("img");
  img.src = anime.coverImage?.medium || "";
  img.alt = anime.title?.romaji || "";
  Object.assign(img.style, {
    width: "36px", height: "52px", borderRadius: "4px",
    objectFit: "cover", flexShrink: "0",
  });

  // Info
  const infoDiv = document.createElement("div");
  Object.assign(infoDiv.style, { flex: "1", overflow: "hidden", minWidth: "0" });

  const titleEl = document.createElement("div");
  titleEl.textContent = anime.title?.romaji || anime.title?.english || "???";
  Object.assign(titleEl.style, {
    fontSize: "13px", fontWeight: "600", color: "#e0e0e0",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  });

  const subtitleEl = document.createElement("div");
  if (anime.title?.english && anime.title.english !== anime.title.romaji) {
    subtitleEl.textContent = anime.title.english;
  }
  Object.assign(subtitleEl.style, {
    fontSize: "11px", color: "#777", marginTop: "1px",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  });

  const metaEl = document.createElement("div");
  const metaParts = [];
  if (anime.format) metaParts.push(anime.format);
  if (anime.episodes) metaParts.push(`${anime.episodes} eps`);
  if (anime.seasonYear) metaParts.push(anime.seasonYear);
  metaEl.textContent = metaParts.join(" \u2022 ");
  Object.assign(metaEl.style, { fontSize: "10px", color: "#555", marginTop: "2px" });

  infoDiv.appendChild(titleEl);
  if (subtitleEl.textContent) infoDiv.appendChild(subtitleEl);
  infoDiv.appendChild(metaEl);

  item.appendChild(img);
  item.appendChild(infoDiv);

  // Click handler
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    const malUrl = anime.idMal ? `https://myanimelist.net/anime/${anime.idMal}` : null;
    onAnimeSelected({
      anilistId: anime.id,
      anilistUrl: anime.siteUrl,
      malUrl: malUrl,
      title: anime.title?.romaji || anime.title?.english || "",
      animeName: animeName,
    });
    destroyPopover();
  });

  return item;
}

// ─── Animation & Reset ──────────────────────────────────────────────────

export function injectCSSAnimation(animationCSS) {
  style = document.createElement("style");
  style.type = "text/css";
  style.appendChild(document.createTextNode(animationCSS));

  document.head.appendChild(style);
}

const listAnimations = [
  `@keyframes buttonLinkAnimation {
      0% {
        transform: scale(1);
      }

      50% {
        transform: scale(1.1);
      }

      100% {
        transform: scale(1);
      }
    }`,
  `@keyframes buttonLinkAnimation {
      0% {
        animation-timing-function: ease-in;
        opacity: 0;
        transform: translateY(-45px);
      }

      16% {
        opacity: .4;
      }

      24% {
        opacity: 1;
      }

      40% {
        animation-timing-function: ease-in;
        transform: translateY(-24px);
      }

      65% {
        animation-timing-function: ease-in;
        transform: translateY(-12px);
      }

      82% {
        animation-timing-function: ease-in;
        transform: translateY(-6px);
      }

      93% {
        animation-timing-function: ease-in;
        transform: translateY(-4px);
      }

      25%,
      55%,
      75%,
      87% {
        animation-timing-function: ease-out;
        transform: translateY(0px);
      }

      100% {
        animation-timing-function: ease-out;
        opacity: 1;
        transform: translateY(0px);
      }
    }`,
  `@keyframes buttonLinkAnimation {
      0%,
      100% {
        transform: rotate(0deg);
        transform-origin: 50% 50%;
      }

      10% {
        transform: rotate(8deg);
      }

      20%,
      40%,
      60% {
        transform: rotate(-10deg);
      }

      30%,
      50%,
      70% {
        transform: rotate(10deg);
      }

      80% {
        transform: rotate(-8deg);
      }

      90% {
        transform: rotate(8deg);
      }
    }`,
];

export const animationCSS = () =>
  listAnimations[Math.floor(Math.random() * listAnimations.length)] + `
    .custom-button {
      animation: buttonLinkAnimation 2s ease infinite;
    }
    .custom-button:hover {
      animation: none;
    }
    .custom-button-edit {
      animation: none !important;
    }
`;

export function resetButton() {
  if (linkElement) {
    linkElement.remove();
    linkElement = null;
  }

  if (secondLinkElement) {
    secondLinkElement.remove();
    secondLinkElement = null;
  }

  if (style) {
    style.remove();
  }

  removeEditButtons();

  injectCSSAnimation(animationCSS());
}

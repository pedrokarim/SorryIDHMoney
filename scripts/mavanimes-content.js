// by @AliasPedroKarim
// The code adds a search bar to a webpage and filters a list of anime
// titles based on the user's input in real-time. It uses a function to find a
// case-insensitive substring in a string.

const srcUtils = chrome.runtime.getURL("scripts/utils.js");
const animeCacheScript = chrome.runtime.getURL("scripts/anime-cache-manager.js");

let animeCache;

function findCaseInsensitiveSubstring(sourceString, searchString) {
  const regex = new RegExp(searchString, "i");
  const matchResult = sourceString.match(regex);

  return matchResult ? matchResult[0] : null;
}

function extractEpisodeTitle(inputString) {
  // Utilisez une expression régulière pour extraire le texte avant "Episode" ou "Film"
  const match = inputString.match(/^(.*?)(Episode|Film)/);

  let result = "";

  if (match && match[1]) {
    // Si une correspondance est trouvée, retournez le texte avant "Episode"
    result = match[1].trim();
  } else {
    // Si aucune correspondance n'est trouvée, retournez la chaîne d'origine
    result = inputString.trim();
  }

  // is Gekijouban ?
  const isGekijouban = inputString.includes("Gekijouban");

  if (isGekijouban) {
    result = result.replace("Gekijouban", "").trim();
  }

  return result;
}

function extractLinkList(inputString) {
  // Utilisez une expression régulière pour extraire le texte avant "-episode" ou "-film"
  const match = inputString.match(/^(.*?)(?:-episode|-film)/);

  let result = "";
  if (match && match[1]) {
    // Si une correspondance est trouvée, retournez le texte avant "Episode"
    result = match[1].trim();
  } else {
    // Si aucune correspondance n'est trouvée, retournez la chaîne d'origine
    result = inputString.trim();
  }

  // is Gekijouban ?
  const isGekijouban = result.includes("gekijouban-");

  if (isGekijouban) {
    result = result.replace("gekijouban-", "").trim();
  }

  // add /anime/ to the result in url
  const url = new URL(result);
  url.pathname = `/anime${url.pathname}`;

  return url.toString();
}

if ([
  "/tous-les-animes-en-vostfr",
  "/films",
  "/regarder-animes-oav-streaming"
].includes(window.location.pathname)) {
  const landing = document.querySelector(".az-tabs");

  if (landing) {
    const label = document.createElement("label");
    label.setAttribute("for", "custom-search-anime");
    label.style.display = "block";
    label.style.color = "#fff";
    label.style.fontSize = "14px";
    label.style.fontWeight = "bold";
    label.style.marginBottom = "8px";
    label.textContent = "Rechercher un anime";

    const input = document.createElement("input");
    input.id = "custom-search-anime";
    input.style.boxShadow = "0 1px 2px 0 rgba(0, 0, 0, 0.05)";
    input.style.border = "1px solid #e2e8f0";
    input.style.borderRadius = "4px";
    input.style.width = "100%";
    input.style.padding = "8px 12px";
    input.style.color = "#333";
    input.style.lineHeight = "1.25";
    input.style.outline = "none";
    input.style.transition = "box-shadow 0.15s, border-color 0.15s";
    input.setAttribute("type", "text");
    input.setAttribute(
      "placeholder",
      "Tensei Shitara Slime Datta Ken, One piece, ..."
    );

    landing.insertBefore(input, landing.firstChild);
    landing.insertBefore(label, landing.firstChild);

    input.addEventListener("keyup", (e) => {
      const value = e.target.value;

      const tabs = document.querySelectorAll("#az-slider #inner-slider ul li");

      if (tabs?.length) {
        for (const tab of Array.from(tabs)) {
          const elementModifiable = tab.querySelector("a");
          const title = elementModifiable?.innerText;

          if (!title) continue;

          if (title.toLowerCase().includes(value.toLowerCase())) {
            tab.style.display = "block";
            const term = findCaseInsensitiveSubstring(title, value);
            elementModifiable.innerHTML = title.replace(
              term,
              `<span style="color:red;font-weight:bold;">${term}</span>`
            );
          } else {
            tab.style.display = "none";
          }
        }
      }

      const letterSection = document.querySelectorAll(
        "#az-slider #inner-slider .letter-section"
      );

      if (letterSection?.length) {
        for (const section of Array.from(letterSection)) {
          const listElement = section.querySelectorAll("ul li");

          if (
            Array.from(listElement).every((v) => v.style.display === "none")
          ) {
            section.style.display = "none";
          } else {
            section.style.display = "block";
          }
        }
      }
    });
  }
}

(async () => {
  // Charger les modules de manière asynchrone
  const [cacheModule] = await Promise.all([
    import(animeCacheScript)
  ]);

  animeCache = cacheModule.animeCache;

  const { addCustomButton, addEditButtons, removeEditButtons, addExitEditButton, enableEditModeOnButtons, animationCSS, injectCSSAnimation } = await import(
    srcUtils
  );
  injectCSSAnimation(animationCSS());

  // replace de href par "/" du premier élément (#menu-items li a) sur toute les pages
  document?.querySelectorAll("#menu-items li a")[0]?.setAttribute("href", "/");

  // Callback quand un anime est sélectionné via la popup de recherche
  // On sauvegarde dans le cache, on reste en mode édition
  // Le bouton X (quitter) rechargera la page et les vrais boutons apparaîtront
  async function onAnimeSelected(selection) {
    await animeCache.setCustomUrl(selection.animeName, selection.anilistUrl);
  }

  function addButtons(data) {
    if (data?.siteMalUrl || data?.malUrl) {
      addCustomButton("myanimelist", data.siteMalUrl || data.malUrl, { openInNewTab: true });
    }

    if (data?.siteUrl || data?.anilistUrl) {
      addCustomButton("anilist", data.siteUrl || data.anilistUrl, {
        styles: {
          left: `${20 * 2 + 50}px`,
        },
        openInNewTab: true,
      });
    }
  }

  const isAnimePage = window.location.pathname?.startsWith("/anime/");
  const isEpisodePage = window.location.pathname?.endsWith("-vostfr");

  if (isAnimePage || isEpisodePage) {
    const title = isAnimePage ? document.querySelector(".header h1.title") : document.querySelector(".release .header h1.title");
    if (!title) return;
    const episodeTitleRaw = extractEpisodeTitle(title.textContent);
    const episodeTitle = episodeTitleRaw.toLowerCase();

    if (!episodeTitle) return;

    // Rewrite the episode title in title page, split by "|" and replace the first part with the episode title
    document.title = `${title.textContent} | ${document.title?.split("|")[1]}`;

    if (isEpisodePage) {
      checkPreviousAndNext();
      addBackToListButton();
    }

    // Écouter le message de mode édition depuis la popup
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === "toggleEditMode" && message.enabled) {
        enableEditModeOnButtons(episodeTitleRaw, onAnimeSelected);
      }
    });

    try {
      // Vérifier si l'anime est dans le cache avant de faire la recherche
      const cachedResult = await animeCache.isInCache(episodeTitle);
      if (cachedResult === true) {
        // Anime ignoré, ne rien faire
        return;
      } else if (cachedResult) {
        // URL personnalisée trouvée, utiliser directement
        addButtons({
          siteUrl: cachedResult.anilistUrl || cachedResult,
          malUrl: cachedResult.malUrl || null,
          siteMalUrl: null
        });
        return;
      }
    } catch (error) {
      console.error('Erreur lors de la vérification du cache:', error);
    }

    chrome.runtime.sendMessage(
      { action: "getAnilistMedia", search: episodeTitle },
      function (response) {
        if (!response) {
          // Anime non trouvé : afficher les boutons en mode édition
          addEditButtons(episodeTitleRaw, onAnimeSelected);
          return;
        }

        addButtons(response);
      }
    );
  }
})();

(async () => {
  if (window.location.pathname === "/") {
    const animesGrid = document.querySelector(".animes-grid>.w-full:nth-child(2)");
    if (!animesGrid) return;

    const animeCards = animesGrid.querySelectorAll("a>img");
    if (!animeCards?.length) return;

    for (const animeCard of Array.from(animeCards)) {
      const link = animeCard.parentElement.getAttribute("href");
      if (!link) continue;

      const button = document.createElement("button");

      Object.assign(button.style, {
        position: "absolute",
        top: "5px",
        left: "5px",
        padding: "4px",
        borderRadius: "50%",
        backgroundColor: "#805ad5",
        color: "#fff",
        fontSize: "14px",
        fontWeight: "bold",
        textDecoration: "none",
        zIndex: "1000",
        width: "32px",
        height: "32px",
        opacity: "0.51",
      });

      button.addEventListener("mouseenter", (e) => {
        e.stopPropagation();
        e.preventDefault();

        button.style.opacity = "1";
      });

      button.addEventListener("mouseleave", (e) => {
        e.stopPropagation();
        e.preventDefault();

        button.style.opacity = "0.51";
      });

      button.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();

        window.open(extractLinkList(link), "_self");
      });

      button.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" style="overflow: unset; position: unset; display: unset; width: unset; height: unset; top: unset; left: unset; fill: none; background: unset; border-radius: unset; margin: unset;" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-list"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
      `;

      animeCard.parentElement.style.position = "relative";
      animeCard.parentElement.appendChild(button);
    }
  }
})();

// Fonction pour extraire le numéro d'épisode (episode-01) ou de film (film-01) à partir de l'URL
function extractEpisodeNumber(url) {
  const matchEpisode = url.match(/episode-(\d+)/i);
  const matchFilm = url.match(/film-(\d+)/i);

  if (matchEpisode && matchEpisode[1]) {
    return parseInt(matchEpisode[1]);
  } else if (matchFilm && matchFilm[1]) {
    return parseInt(matchFilm[1]);
  } else {
    throw new Error('Impossible d\'extraire le numéro d\'épisode ou de film depuis l\'URL actuelle.');
  }
}

// Fonction pour vérifier si une page existe et si elle est une redirection permanente (code 301)
async function checkPageExists(url) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      return true;
    } else if (response.status === 301) {
      // Redirection permanente, donc la page n'existe pas
      return false;
    } else {
      return false;
    }
  } catch (error) {
    return false;
  }
}

function createGenericButton(iconHTML, styles) {
  const button = document.createElement('a');
  document.body.appendChild(button);

  // Appliquer les styles de base
  Object.assign(button.style, {
    width: '50px',
    height: '50px',
    borderRadius: '8px',
    textAlign: 'center',
    lineHeight: '50px',
    fontSize: '24px',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    ...styles,
  });

  // Ajouter l'effet de hover
  button.addEventListener('mouseenter', () => {
    button.style.backgroundColor = '#805ad5'; // Couleur plus claire au hover
  });

  button.addEventListener('mouseleave', () => {
    button.style.backgroundColor = '#6b46c1'; // Retour à la couleur normale
  });

  button.innerHTML = iconHTML;

  return button;
}


function createButtonWithPosition(position) {
  const iconHTML = position === 'left' ? '<span>◄</span>' : '<span>►</span>';
  const shortcutText = position === 'left' ? 'Ctrl + ←' : 'Ctrl + →';

  const baseStyles = {
    position: 'fixed',
    top: '50%',
    transform: 'translateY(-50%)',
    backgroundColor: '#6b46c1',
    // Ajout des styles pour le tooltip
    '::before': {
      content: `"${shortcutText}"`,
      position: 'absolute',
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      padding: '5px',
      borderRadius: '4px',
      fontSize: '12px',
      whiteSpace: 'nowrap',
      opacity: '0',
      transition: 'opacity 0.2s',
      pointerEvents: 'none',
    }
  };

  baseStyles[position === 'left' ? 'left' : 'right'] = '20px';

  const button = createGenericButton(iconHTML, baseStyles);

  // Ajout des styles pour le hover du tooltip
  button.addEventListener('mouseenter', () => {
    button.setAttribute('title', `Raccourci: ${shortcutText}`);
  });

  return button;
}

// Fonction pour gérer les raccourcis clavier
function handleKeyboardShortcuts(event, prevButton, nextButton) {
  if (event.ctrlKey) {
    if (event.key === 'ArrowLeft' && prevButton) {
      event.preventDefault();
      window.location.href = prevButton.href;
    } else if (event.key === 'ArrowRight' && nextButton) {
      event.preventDefault();
      window.location.href = nextButton.href;
    }
  }
}

// Modification de la fonction checkPreviousAndNext
async function checkPreviousAndNext() {
  const currentUrl = window.location.href;
  const episodeNumber = extractEpisodeNumber(currentUrl);

  let prevButton = null;
  let nextButton = null;

  // Vérifier si l'épisode précédent existe
  const prevEpisodeUrl = currentUrl.replace(`episode-${(String(episodeNumber)).padStart(2, '0')}`, `episode-${(String(episodeNumber - 1)).padStart(2, '0')}`);
  const prevEpisodeExists = await checkPageExists(prevEpisodeUrl);

  if (prevEpisodeExists) {
    prevButton = createButtonWithPosition('left');
    prevButton.href = prevEpisodeUrl;
  }

  // Vérifier si l'épisode suivant existe
  const nextEpisodeUrl = currentUrl.replace(`episode-${(String(episodeNumber)).padStart(2, '0')}`, `episode-${(String(episodeNumber + 1)).padStart(2, '0')}`);
  const nextEpisodeExists = await checkPageExists(nextEpisodeUrl);

  if (nextEpisodeExists) {
    nextButton = createButtonWithPosition('right');
    nextButton.href = nextEpisodeUrl;
  }

  // Ajout des écouteurs d'événements pour les raccourcis clavier
  document.addEventListener('keydown', (event) => handleKeyboardShortcuts(event, prevButton, nextButton));
}

// Ajouter un button qui permet de revenir la liste des épisodes d'un anime
function addBackToListButton() {
  const button = createGenericButton('<span>📋</span>', {
    position: 'fixed',
    top: '63px',
    left: '20px',
    backgroundColor: '#805ad5',
    color: '#fff',
  });

  // Ajout du tooltip pour le raccourci
  button.addEventListener('mouseenter', () => {
    button.setAttribute('title', 'Raccourci: Ctrl + L');
  });

  button.href = extractLinkList(window.location.href);

  // Ajout du raccourci clavier Ctrl + L pour la liste des épisodes
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      window.location.href = button.href;
    }
  });
}

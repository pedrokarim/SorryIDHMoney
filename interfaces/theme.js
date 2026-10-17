/*
 * Thème des pages de l'extension : « auto » (suit le système), « light » ou
 * « dark ». Chargé dans le <head> sans `defer` pour que le bon thème soit en
 * place avant le premier dessin.
 *
 * `chrome.storage` ne répond qu'après le premier affichage : on repose donc
 * d'abord le dernier choix connu, gardé dans `localStorage` (synchrone), puis
 * on corrige si le réglage a changé ailleurs.
 */
(function () {
  const CACHE_KEY = 'sorryidhmoney:theme';
  const VALID = ['auto', 'light', 'dark'];

  function apply(theme) {
    if (theme === 'light' || theme === 'dark') {
      document.documentElement.dataset.theme = theme;
    } else {
      delete document.documentElement.dataset.theme;
    }
  }

  function remember(theme) {
    try {
      localStorage.setItem(CACHE_KEY, theme);
    } catch {
      // Stockage refusé : le thème arrivera simplement un instant plus tard.
    }
  }

  let cached = null;
  try {
    cached = localStorage.getItem(CACHE_KEY);
  } catch {
    cached = null;
  }
  apply(cached);

  // Affichée dans la popup de la barre d'outils ? (voir `.in-popup` dans base.css)
  try {
    if (chrome.extension.getViews({ type: 'popup' }).includes(window)) {
      document.documentElement.classList.add('in-popup');
    }
  } catch {
    // Hors extension (aperçu local) : la requête média de base.css suffit.
  }

  if (typeof chrome === 'undefined' || !chrome.storage) return;

  chrome.storage.sync.get({ theme: 'auto' }, ({ theme }) => {
    // Les anciens thèmes (violet, océan…) ne s'appliquaient nulle part :
    // ils retombent sur « auto ».
    const value = VALID.includes(theme) ? theme : 'auto';
    apply(value);
    remember(value);
  });

  chrome.storage.onChanged.addListener((changes, zone) => {
    if (zone !== 'sync' || !changes.theme) return;
    const value = VALID.includes(changes.theme.newValue) ? changes.theme.newValue : 'auto';
    apply(value);
    remember(value);
  });
})();

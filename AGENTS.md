# SorryIDHMoney — Extension Chrome

## Architecture

Extension Chrome MV3 pour enrichir les sites d'anime avec des boutons MAL/AniList/Info.

### Fichiers clés

- `background.js` — Service worker. Cache mémoire AniList (10 min TTL), actions `getAnilistMedia` (recherche par titre) et `getAnilistMediaById` (fetch par ID). Query enrichie avec tous les champs (`ANILIST_FULL_FIELDS`).
- `scripts/utils.js` — Fonctions partagées : `addCustomButton`, `addInfoButton`, `addEditButtons`, `enableEditModeOnButtons`, `resetButton`, animations CSS. Le popover info affiche bannière/cover, titre, meta, genres, next episode, description, liens.
- `scripts/anime-cache-manager.js` — Cache local (`chrome.storage.local`) pour les URLs personnalisées et les animes ignorés.
- `interfaces/options.html` + `options.js` — Page de configuration avec toggles par plateforme.
- `manifest.json` — Gitignored (contient la config locale). `manifest.example.json` est la référence versionnée.

### Dossiers

- `icons/platforms/` — Logos des plateformes (PNG, SVG, WebP, ICO)
- `scripts/` — Content scripts par plateforme + utilitaires
- `interfaces/` — Pages HTML de l'extension (popup, options, etc.)
- `styles/` — CSS (base.css avec design tokens, options.css, etc.)

## Ajout d'une nouvelle plateforme de streaming

### Processus complet (étapes dans l'ordre)

#### 1. Inspecter le DOM de la plateforme

Naviguer sur la plateforme avec le navigateur DevTools MCP et inspecter :
- **Page série/fiche** et **page épisode** séparément
- Chercher dans cet ordre de priorité :
  1. **JSON-LD** (`script[type="application/ld+json"]`) — source la plus fiable et stable
  2. **Sélecteurs DOM** (`h1`, `[data-t="..."]`, breadcrumbs)
  3. **Meta tags** (`og:title`)
  4. **`document.title`** — dernier recours, nécessite du parsing

Script d'inspection standard à exécuter via `evaluate_script` :
```js
() => {
  return {
    documentTitle: document.title,
    pathname: window.location.pathname,
    h1: Array.from(document.querySelectorAll('h1')).map(el => ({ text: el.textContent.trim(), classes: el.className })),
    ogTitle: document.querySelector('meta[property="og:title"]')?.content,
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => { try { return JSON.parse(s.textContent); } catch { return null; } }),
    icons: Array.from(document.querySelectorAll('link[rel*="icon"]')).map(l => ({ rel: l.rel, href: l.href, sizes: l.sizes?.value })),
  };
}
```

#### 2. Télécharger le logo

Stocker dans `icons/platforms/{nom}.png` (ou .svg/.webp/.ico selon dispo).
Essayer dans l'ordre :
1. `curl` direct (avec `-A "Mozilla/5.0"` et `-e` referer si besoin)
2. Si 403/bloqué : via DevTools MCP `evaluate_script` pour fetch en base64 depuis la page elle-même
3. Si tout échoue : demander à l'utilisateur de le fournir

#### 3. Créer le content script

Fichier : `scripts/{nom}-content.js`

Structure standard (copier un existant comme template) :
```
1. Imports (srcUtils + animeCacheScript)
2. extractAnimeTitle() — JSON-LD prioritaire, fallback DOM
3. extractAnilistIdFromUrl() — helper pour le lazy fetch
4. main() — check toggle config → load modules → init
5. initializeAnimeDetection(title) — addButtons + cache + API
6. Navigation SPA si nécessaire (pushState/popstate + retry polling)
```

**Différences selon le type de site :**
- **WordPress / server-rendered** (ADKami, Gum Gum) : pas de retry, pas de navigation observer
- **SPA React** (Crunchyroll, ADN) : `run_at: "document_idle"` + retry polling (`waitForTitleAndInit`, 500ms × 15) + interception pushState/replaceState/popstate

**Toggle config** : toujours vérifier au début de `main()` :
```js
const { enableNomPlateforme } = await new Promise(r =>
  chrome.storage.sync.get({ enableNomPlateforme: true }, r)
);
if (!enableNomPlateforme) return;
```

#### 4. Mettre à jour le manifest

Ajouter dans `manifest.json` ET `manifest.example.json` :
```json
{
  "matches": ["https://www.example.com/*"],
  "js": ["scripts/example-content.js"],
  "type": "module"
}
```
Ajouter `"run_at": "document_idle"` pour les SPA React.

#### 5. Ajouter le toggle dans la config

**`interfaces/options.html`** — ajouter dans le groupe "Plateformes de streaming" :
```html
<div class="setting-item">
  <span class="setting-label"><img src="../icons/platforms/{nom}.png" class="platform-icon" alt="">{Nom}</span>
  <label class="toggle-switch">
    <input type="checkbox" id="enable-{nom}" name="enable-{nom}">
    <span class="slider"></span>
  </label>
</div>
```

**`interfaces/options.js`** — 3 modifications :
1. Ajouter `enable{Nom}: true` dans le `chrome.storage.sync.get` du `DOMContentLoaded`
2. Ajouter `document.getElementById('enable-{nom}').checked = items.enable{Nom};` dans le callback
3. Ajouter `'{nom}'` dans le tableau de la boucle `for (const platform of [...])`

## Conventions

- Les commits ne contiennent jamais de `Co-Authored-By`
- `manifest.json` est gitignored — toujours mettre à jour `manifest.example.json` en parallèle
- Les content scripts loguent avec le préfixe `[NomPlateforme]`
- AniList est la source de vérité pour les données anime
- Le bouton info (3ème, violet) occupe le même slot que le bouton "quitter édition" — il est caché en mode édition

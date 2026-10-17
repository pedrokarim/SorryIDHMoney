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
- `styles/` — CSS : `base.css` porte tout le système de design, chaque page n'a qu'une petite feuille à elle
- `icons/brand/` — le logo (symbole, icône, versions horizontales) ; `fonts/` — Bricolage Grotesque

## Skills (Claude Code et Codex)

Une seule copie de chaque skill, dans `.agents/skills/<nom>/SKILL.md` : Codex
les lit là directement. Claude Code lit `.claude/skills/`, où
`node tools/sync-skills.js` pose un lien vers chacun (à relancer après un
clone ou l'ajout d'un skill).

- **Nos skills sont versionnés** : `browser-bridge`, `fetch-logo`. Chacun est
  autorisé nommément dans `.gitignore` (`!/.agents/skills/<nom>/`) : un nouveau
  skill à nous doit y être ajouté, sinon il reste local.
- **Les skills tiers ne le sont pas** : ils sont listés dans `skills-lock.json`
  et s'installent en local avec `npx skills experimental_install`. Tout le
  reste de `.agents/skills/` est ignoré.
- Un skill utile hors de ce dépôt déclare `metadata: scope: global` dans son
  en-tête (c'est le cas de `browser-bridge`) ; `node tools/sync-skills.js
  --global` le lie alors aussi dans `~/.claude/skills` et `~/.agents/skills`.
  Il appelle les outils du dépôt par `SORRYIDHMONEY_HOME` (définie par ce même
  `--global`) : jamais de chemin de la machine dans un fichier versionné.

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

**`interfaces/options.html`** — ajouter dans la section « Animes », sous « Plateformes de streaming » :
```html
<label class="row">
  <span class="row-icon"><img src="../icons/platforms/{nom}.png" alt=""></span>
  <span class="row-text"><span class="row-label">{Nom}</span></span>
  <span class="switch"><input type="checkbox" id="enable-{nom}"><span class="track"></span></span>
</label>
```

**`interfaces/options.js`** — 2 modifications :
1. Ajouter `enable{Nom}: true` dans `DEFAULTS`
2. Ajouter `'enable-{nom}': 'enable{Nom}'` dans `SIMPLE_SWITCHES`

**`interfaces/popup.js`** — ajouter le script dans `PLATFORMS` (nom, clé, icône) : c'est ce
qui fait apparaître « Sur cet onglet » et la correction de fiche dans la popup.

## Conventions

- `manifest.json` est gitignored — toujours mettre à jour `manifest.example.json` en parallèle
- Les content scripts loguent avec le préfixe `[NomPlateforme]`
- AniList est la source de vérité pour les données anime
- Le bouton info (3ème, encre et or) occupe le même slot que le bouton "quitter édition" — il est caché en mode édition

## Direction artistique

Logo : le **« S sans barre »**, un $ dont on a arraché la barre (il n'en reste que deux
encoches). L'idée de « Sorry, I Don't Have Money » tient dans ce qui manque. Fichiers dans
`icons/brand/` ; `icon-small.svg` est la coupe 16–32 px (trait plus gras, encoches plus
larges), utilisée pour `icon16.png` et `icon32.png`.

| Rôle | Valeur |
|---|---|
| Encre (texte, surfaces sombres, tuile de l'icône) | `#17131F` |
| Or (marque, bouton principal, interrupteur actif) | `#FFC233` |
| Papier (fond clair) | `#F6F3EC` |
| Titres et mot-symbole | Bricolage Grotesque (`fonts/`, OFL) |
| Texte d'interface | Segoe UI Variable / police système |

### Règles

- **Tout passe par `styles/base.css`** : jetons de couleur, composants (`.app`, `.card`,
  `.rows` / `.row`, `.switch`, `.btn`, `.badge`, `.stat`, `details.group`, `.pager`,
  `.empty`). Une page n'ajoute que ce qui lui est propre.
- **L'or ne sert jamais de couleur de texte sur fond clair** (contraste insuffisant) : on
  prend `--accent-text`. Sur l'or, le texte est encre (`--on-gold`).
- **Thème** : automatique, clair ou sombre (clé `theme`). `interfaces/theme.js` se charge
  dans le `<head>` de chaque page, sans `defer`, pour éviter le flash ; il pose aussi
  `.in-popup` sur `<html>` quand la page est dans la popup. Là, c'est `.app` qui défile
  (`max-height: 600px`) : Chrome n'élargit pas la popup pour une barre de défilement.
- **Icônes** : un seul jeu, dans `interfaces/ui.js` (`<i data-icon="nom">` dans le HTML,
  `UI.icon('nom')` en JS). Pas de SVG recopié à la main dans les pages.
- **Ce qui est posé sur les sites** (toasts, fiche info, boutons, pastilles) garde
  toujours l'habillage encre et or, quel que soit le site : couleurs dans
  `scripts/brand.js`. Les toasts vivent dans un Shadow DOM. Seuls les boutons MyAnimeList
  et AniList gardent les couleurs de leur marque.
- **Pas de barre ni de bordure colorée décorative** autour d'une carte ou d'une section.
- Un compteur au-delà de 100 000 s'abrège (`UI.setStat`), la valeur exacte en infobulle.
- **Mode développeur** (clé `developerMode`, coupé par défaut) : les outils de test
  n'apparaissent que s'il est coché.

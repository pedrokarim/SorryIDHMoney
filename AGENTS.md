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

- Les commits ne contiennent jamais de `Co-Authored-By`
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

### Langue du code : identifiants en anglais, prose en français

Les fonctions, constantes, variables, champs et clés sont en **anglais**. Les
commentaires, les messages de log et les textes affichés restent en
**français**. C'est la règle du poste, elle n'a pas d'exception ici.

Le module XPoster a longtemps été le seul du dépôt à porter des identifiants
français. Ce n'était pas un choix : le module est né comme ça le 19/08, et
chaque session s'est alignée dessus au lieu de le signaler. Corrigé le 24/08.

**Le piège est mécanique, pas théorique** : on écrit un commentaire en
français, et le nom de la variable suit la langue de la phrase qu'on vient
d'écrire. « la boîte d'horaire » donne `const boite` trois mots plus loin. Ça
s'est produit trois commits de suite, y compris juste après le renommage.

Avant de commiter une modification de `scripts/xposter-*.js` :

```
python tools/check-identifiers.py
```

Il découpe chaque fichier en zones code / commentaire / chaîne, ne signale que
la première, et sort en erreur si un identifiant français subsiste.

**Ce qu'il laisse volontairement passer** — les noms qui franchissent une
frontière et ne se renomment donc pas d'un seul côté : les clés de
`chrome.storage` (`xposterToken`, `xposterFile`…), les champs de la charge et
du rapport (`texte`, `quand`, `publier`, `etat`, `rapport`…), et les noms
d'action du pont (`programmer`, `lister`, `capturer`…), qui sont les
sous-commandes tapées à la main. Leur passage à l'anglais demande une
migration du stockage et une mise à jour simultanée du CLI, du serveur, des
deux interfaces et de la documentation externe. C'est un chantier à part,
pas une ligne de plus.

## Module « Publication X »

Prépare, publie ou programme des publications sur x.com depuis un outil local.
**Coupé par défaut** — il faut cocher la case *et* renseigner un jeton.

### Pièces

- `scripts/xposter-content.js` — remplit le composeur de x.com : texte, images,
  textes alternatifs, et clic final si autorisé. Ne décide de rien.
- `scripts/xposter-queue.js` — file d'attente et horloge (`chrome.alarms`).
  La file vit dans l'extension pour qu'une publication programmée parte même
  si l'outil qui l'a déposée est éteint.
- `scripts/xposter-bridge.js` — sonde le serveur local une fois par minute et
  exécute les ordres reçus.
- `tools/xposter-server.js` — le serveur local. Écoute sur `127.0.0.1`
  uniquement, jeton obligatoire.
- `tools/xposter-cli.js` — dépose un ordre depuis un fichier JSON.

### Trois gardes

1. Module décoché par défaut.
2. Sans jeton renseigné, l'extension ne contacte même pas le serveur.
3. Liste blanche d'actions (`ping`, `programmer`, `annuler`, `lister`,
   `maintenant`) — jamais de code arbitraire.

Et un quatrième, indépendant de ce qu'on envoie : **la publication automatique
a sa propre case, décochée**. Un ordre peut réclamer `publier: true`, sans
cette case l'extension prépare et laisse la main.

### Pourquoi un sondage HTTP et pas un WebSocket

En MV3 le service worker est arrêté dès qu'il n'a rien à faire : une connexion
permanente ne tient pas. Une alarme le réveille chaque minute, il demande s'il
y a du travail. Une minute d'attente n'a aucune importance pour programmer une
publication, et ça évite d'implémenter le protocole WebSocket à la main dans un
projet sans dépendances.

### Ce que le module ne fait pas

Il ne parle pas à l'API de X et ne connaît aucun identifiant : il pilote
l'interface dans un onglet déjà connecté. C'est contraire aux règles
d'automatisation de X — le mode « préparer », qui laisse le clic final à
l'humain, est celui qui reste dans les clous.

## Module « Pont navigateur »

Laisse un outil local lire le web à travers le navigateur : contenu d'une page,
éléments ciblés, captures, requêtes. **Lecture seule, coupé par défaut.**

### S'en servir (pour un agent)

Quand une requête directe (WebFetch, curl) est refusée ou rend une page vide :

```
node tools/browser-cli.js read --url <adresse>
```

Le CLI lit le jeton dans `~/.sorryidhmoney/browser-bridge.json` et démarre le
serveur s'il ne tourne pas. Le contenu sort en Markdown sur la sortie standard,
le résumé (titre, longueur, `truncated`) sur la sortie d'erreur. L'en-tête de
`tools/browser-cli.js` liste toutes les actions et options. Un « site banni »
est un refus définitif : ne pas chercher à le contourner par un autre chemin.

### Pièces

- `scripts/browser-bridge.js` – la sonde, la liste blanche d'actions, les
  onglets, les captures et le contrôle des sites bannis.
- `scripts/browser-page.js` – les relevés injectés dans la page (`readPage`,
  `queryElements`, `listResources`, `locateElement`, `scrollThrough`,
  `readStorage`). Chaque fonction est sérialisée : elle ne peut rien utiliser
  qui vive hors de son propre corps.
- `scripts/browser-widget.js` – la pastille posée sur la page (Shadow DOM,
  déplaçable, historique du site au clic). Injectée elle aussi.
- `scripts/browser-history.js` – le journal (`chrome.storage.local`, clé
  `browserBridgeHistory`, 300 lignes au plus) et les vignettes de capture.
- `scripts/browser-debugger.js` – ce que seul `chrome.debugger` sait lire :
  requêtes complètes, console, capture de page entière.
- `interfaces/browser-bridge.html` + `.js` – l'écran du journal.
- `tools/browser-server.js` – le relais local, `127.0.0.1` uniquement, jeton
  obligatoire. `POST /run` dépose un ordre et retient la requête jusqu'au
  résultat.
- `tools/browser-cli.js` – la ligne de commande.

Une seule permission ajoutée au manifeste : `debugger`. Elle ne sert que si
la case « Autoriser le débogueur » est cochée ; le reste (`tabs`,
`scripting`, `alarms`, `storage`, `<all_urls>`) y était déjà.

### Sonde longue, et pas une sonde à la minute

Le pont de publication X sonde une fois par minute, ce qui ne gêne pas pour
programmer un post. Pour lire une page, c'est trop. Ici le serveur retient la
sonde jusqu'à vingt secondes, ou jusqu'au premier ordre : tant qu'il tourne,
un ordre part dans la seconde. Chaque tour appelle `chrome.storage`, ce qui
repousse l'arrêt du worker. Serveur éteint, la boucle s'arrête et une alarme
retente toutes les trente secondes. Le CLI lance donc le serveur avec
`--idle 15` : il s'éteint seul, et le worker se rendort.

### Ce qui ne doit pas bouger

- **Aucune action qui modifie** : pas de clic, pas de saisie, pas d'exécution
  de code reçu. `fetch` reste en GET. La modification, c'est le module
  Publication X, et il a ses propres gardes.
- **Les sites bannis se contrôlent dans l'extension**, avant d'ouvrir *et*
  après chargement (une redirection peut y mener), et `tabs` ne les liste pas.
- `close` ne referme que les onglets ouverts par le pont
  (`chrome.storage.session`, clé `browserBridgeTabs`).
- **Le débogueur et le stockage restent derrière leur case** (`inspect`,
  `screenshot --full`, `storage`) : ils exposent cookies et jetons. Le
  débogueur s'attache le temps d'un ordre, n'envoie aucune commande qui
  agisse sur la page, et se détache toujours, même en cas d'échec.
- **La pastille ne fait pas partie de la page** : tout nouveau relevé doit
  ignorer `#sorryidhmoney-bridge-widget`, et une capture la masque d'abord.
- Le journal ne garde pas le contenu relevé, seulement son poids – sauf une
  vignette pour les captures.

### Texte posé par CSS

Des sites affichent leurs chiffres par `::before { content: attr(data-x) }`
pour qu'ils n'existent dans aucun nœud de texte (vu sur streamscharts.com).
`readPage` en Markdown lit donc aussi `::before` et `::after`. Le format
`text` s'en tient à `innerText` et ne les voit pas.

### Popup : pas de saut à l'ouverture

Les panneaux qui dépendent de `chrome.storage` arrivaient après le premier
affichage et faisaient descendre toute la popup. Leur dernier rendu est gardé
dans `localStorage` (synchrone) et reposé avant le premier dessin
(`restoreSnapshots` dans `interfaces/popup.js`). Tout panneau ajouté à la
popup qui dépend d'une lecture asynchrone doit rejoindre `SNAPSHOT_IDS`.

### Protocole en anglais

Contrairement au pont XPoster, dont les noms français sont figés par
l'existant, tout est en anglais ici : routes (`/commands`, `/results`, `/run`,
`/status`), champs (`action`, `payload`, `result`, `error`) et clés de
stockage (`enableBrowserBridge`, `browserBridgePort`, `browserBridgeToken`,
`browserBridgeBlockedSites`, `browserBridgeShowWidget`,
`browserBridgeAllowDebugger`, `browserBridgeAllowStorage`,
`browserBridgeLastContact`, `browserBridgeHistory`,
`browserBridgeWidgetPosition`).

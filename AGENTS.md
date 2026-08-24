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

## Module « Téléchargement Facebook »

Repère les vidéos sur `facebook.com` et propose deux sorties selon ce que la
page expose réellement.

### Pièces

- `scripts/facebook-extract.js` — le cœur. Reconnaît une URL de vidéo
  (`/watch/live/?v=`, `/watch/?v=`, `/{page}/videos/{id}`, `/reel/{id}`,
  `/share/v/{token}`, `story_fbid`) et tire du HTML les sources, le titre, la
  date et la durée. Fonctions pures, testables hors navigateur.
- `scripts/facebook-content.js` — panneau flottant sur la page, analyse et
  actions. SPA : pushState/replaceState/popstate.
- `scripts/facebook-queue.js` — la file (`chrome.storage.local`, clé `fbFile`)
  et l'appel à `chrome.downloads`.
- `interfaces/fb-downloader.html` + `.js` — consulter la file, exporter
  `lives.txt`, copier la commande yt-dlp.

### Deux sorties, parce que Facebook sert deux choses

| Ce que la page expose | Sortie |
|---|---|
| `browser_native_hd_url` / `browser_native_sd_url` — un mp4 déjà muxé | téléchargement direct par le navigateur |
| `dash_manifest` seul — pistes audio et vidéo séparées | file d'attente, yt-dlp muxe |

Les lives longs n'ont souvent que du DASH : la file n'est pas un supplément,
c'est le chemin normal pour eux.

### Trois pièges déjà payés

1. **La balise `<video>` ne sert à rien** : elle porte un `blob:` (Media Source
   Extensions). Les URL vivent dans les blobs JSON du HTML servi.
2. **Ne pas lire le DOM courant après une navigation SPA** : il contient encore
   les blobs de la *première* vidéo vue, et on télécharge la mauvaise. On refait
   une requête sur l'URL canonique ; le DOM n'est qu'un repli, et seulement si
   l'identifiant y figure.
3. **Les URL du CDN sont signées et expirent** en quelques heures. La file ne
   stocke donc que l'URL de la page ; le média est ré-extrait au moment du clic.

### Motifs d'extraction

Écrits avec `String.raw`. Les blobs sont échappés une fois (`https:\/\/…`) ou
deux selon l'imbrication, et un backslash perdu à l'écriture rend la regex
silencieusement inerte – elle ne lève rien, elle ne trouve simplement plus rien.

### Vérifier après une refonte de Facebook

Le HTML utile n'est servi qu'à une session connectée – `curl` nu reçoit une
page de redirection de 1,5 Ko. Pour retrouver la vraie page hors navigateur :

```
yt-dlp --write-pages --skip-download -F "<url>"
```

puis passer le `.dump` obtenu à `extraireDepuisHtml`.

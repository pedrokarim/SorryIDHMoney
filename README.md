<div align="center">

<img src="icons/icon512.png" alt="SorryIDHMoney" width="140">

# SorryIDHMoney

**Extension Chromium (MV3) qui enrichit les sites d’anime, de streaming et quelques usages du quotidien.**

*« Euhh ! On a pas beaucoup d’argent ^^ »*

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square)
![Chromium](https://img.shields.io/badge/Chrome%20%7C%20Brave%20%7C%20Edge-supporté-34A853?style=flat-square)
![Sans dépendances](https://img.shields.io/badge/dépendances-aucune-8B5CF6?style=flat-square)

</div>

---

## Sommaire

- [Installation](#installation)
- [Fonctionnalités](#fonctionnalités)
  - [Boutons MAL / AniList / Info](#boutons-mal--anilist--info)
  - [Navigation entre bases de données](#navigation-entre-bases-de-données)
  - [Mavanimes](#mavanimes)
  - [YouTube](#youtube)
  - [Twitch](#twitch)
  - [Bypass vérification d’âge](#bypass-vérification-dâge)
  - [Publication X](#publication-x)
  - [Confort général](#confort-général)
- [Interfaces](#interfaces)
- [Configuration](#configuration)
- [Raccourcis clavier](#raccourcis-clavier)
- [Architecture](#architecture)
- [Développement](#développement)
- [Licence](#licence)

---

## Installation

L’extension n’est pas publiée sur le Chrome Web Store – elle se charge en mode développeur.

```bash
git clone https://github.com/pedrokarim/SorryIDHMoney.git
cd SorryIDHMoney
cp manifest.example.json manifest.json
```

Puis dans le navigateur :

1. Ouvrir `chrome://extensions` (ou `brave://extensions`, `edge://extensions`)
2. Activer **Mode développeur**
3. **Charger l’extension non empaquetée** → sélectionner le dossier du dépôt

> `manifest.json` est *gitignored* : c’est ta copie locale, libre de diverger.
> `manifest.example.json` est la référence versionnée – après un `git pull`,
> compare les deux et reporte les nouvelles entrées (permissions, content scripts).
> Recharge l’extension après tout changement de permissions, Chrome ne les prend pas à chaud.

---

## Fonctionnalités

### Boutons MAL / AniList / Info

Sur une page d’anime, trois boutons flottants apparaissent :

| Bouton | Action |
|---|---|
| 🔵 **MyAnimeList** | Ouvre la fiche correspondante sur MAL |
| 🟢 **AniList** | Ouvre la fiche correspondante sur AniList |
| 🟣 **Info** | Popover avec bannière, cover, titre, genres, prochain épisode, synopsis et liens |

Le titre est extrait en priorité depuis le **JSON-LD** de la page, avec repli sur le DOM.
**AniList est la source de vérité** pour toutes les données ; le service worker les met en
cache 10 minutes.

**Plateformes de streaming supportées :**

<table>
<tr>
<td align="center" width="16%"><img src="icons/platforms/voiranime.png" width="36"><br><b>Voiranime</b></td>
<td align="center" width="16%"><img src="icons/platforms/crunchyroll.png" width="36"><br><b>Crunchyroll</b></td>
<td align="center" width="16%"><img src="icons/platforms/adkami.png" width="36"><br><b>ADKami</b></td>
<td align="center" width="16%"><img src="icons/platforms/adn.webp" width="36"><br><b>ADN</b></td>
<td align="center" width="16%"><img src="icons/platforms/gumgum.png" width="36"><br><b>Gum Gum</b></td>
<td align="center" width="16%">🎬<br><b>Mavanimes</b></td>
</tr>
</table>

**Mode édition** – depuis la popup, il permet de corriger à la main l’URL associée à un
anime mal détecté, ou de l’ignorer complètement. Les corrections sont conservées en local
(`chrome.storage.local`) et réutilisées ensuite.

### Navigation entre bases de données

Sur **MyAnimeList**, **AniList** et **Nautiljon**, un bouton permet de sauter d’une base à
l’autre pour la même œuvre (animes comme mangas), avec recherche automatique de la
correspondance.

### Mavanimes

Le support le plus poussé, en plus des boutons :

- Barre de recherche intégrée
- Navigation entre épisodes (boutons flottants ← / →, l’existence de l’épisode est vérifiée avant affichage)
- Bouton 📋 de retour à la liste des épisodes

### YouTube

| Option | Ce qu’elle fait |
|---|---|
| **Lecture fluide des vidéos** | Recharge **une seule fois** une page vidéo qui démarre figée (play/pause immédiat, timer bloqué à 0). Chaque ID n’est rechargé qu’une fois, mémorisé en `sessionStorage` – anti-boucle garanti. |
| **Auto-scroll des Shorts** | Passe au Short suivant à la fin de la lecture. Paramétrable : nombre de replays avant de scroller (0–50) et délai avant scroll (0–10 000 ms). |

### Twitch

- Collecte automatique des **channel points** (la bulle est cliquée toute seule)
- Page **Statistiques** dédiée : total collecté, détail par chaîne, historique, suivi en temps réel

### Bypass vérification d’âge

Port sur Chromium de deux projets Firefox/Tampermonkey – l’API
`webRequest.filterResponseData()` dont ils dépendent n’existe pas sur Chromium, elle est
remplacée par des règles `declarativeNetRequest` et des content scripts en *MAIN world*.

<table>
<tr>
<td align="center" width="12%"><img src="icons/platforms/reddit.png" width="30"><br>Reddit<br><sub>posts NSFW</sub></td>
<td align="center" width="12%"><img src="icons/platforms/aliexpress.ico" width="30"><br>AliExpress<br><sub>flou produits</sub></td>
<td align="center" width="12%"><img src="icons/platforms/bluesky.png" width="30"><br>Bluesky<br><sub>sensible</sub></td>
<td align="center" width="12%"><img src="icons/platforms/x.png" width="30"><br>X / Twitter<br><sub>sensible</sub></td>
<td align="center" width="12%"><img src="icons/platforms/agechecker.ico" width="30"><br>AgeChecker</td>
<td align="center" width="12%"><img src="icons/platforms/agego.ico" width="30"><br>AgeGO</td>
<td align="center" width="12%"><img src="icons/platforms/ageverif.png" width="30"><br>AgeVerif</td>
<td align="center" width="12%"><img src="icons/platforms/veriff.ico" width="30"><br>Veriff</td>
</tr>
</table>

Un toggle maître plus un sous-toggle par site. Le statut du bypass X (hooks installés,
erreurs) est consultable dans la popup quand l’onglet actif est X ; une pastille sur la page
elle-même est disponible en option (désactivée par défaut).

> 📖 Détail des mécanismes, correspondance avec l’upstream et limites connues :
> **[`scripts/avb/README.md`](scripts/avb/README.md)**

### Publication X

Prépare, publie ou programme des publications sur x.com depuis un outil local.
**Coupé par défaut** – il faut cocher la case *et* renseigner un jeton.

```bash
# 1. Générer un jeton dans les options de l'extension, puis lancer le pont
node tools/xposter-server.js --token MONJETON --port 8787

# 2. Déposer un ordre depuis un autre terminal
node tools/xposter-cli.js programmer --fichier post.json --token MONJETON
node tools/xposter-cli.js maintenant --fichier post.json --token MONJETON
node tools/xposter-cli.js lister   --token MONJETON
node tools/xposter-cli.js annuler  --id p123 --token MONJETON
node tools/xposter-cli.js capturer --sortie ecran.png --token MONJETON
node tools/xposter-cli.js tweets   --compte moncompte --sortie fil.json --token MONJETON
```

<details>
<summary><b>Format du fichier de publication</b></summary>

```json
{
  "texte": "Your anime list, as one image.\n\n→ cma.ascencia.re",
  "images": ["./assets/hero.png"],
  "alts": ["Mur incliné de jaquettes d'anime…"],
  "quand": "2026-08-20T14:00:00+02:00",
  "publier": false
}
```

Le CLI encode les images en base64 (le navigateur ne peut pas lire le disque). X accepte
**4 images maximum** – au-delà, le CLI refuse plutôt que de tronquer en silence.

</details>

**Quatre gardes :**

1. Module décoché par défaut
2. Sans jeton renseigné, l’extension ne contacte même pas le serveur
3. Liste blanche d’actions (`ping`, `programmer`, `annuler`, `lister`, `maintenant`) – jamais de code arbitraire
4. La **publication automatique a sa propre case, décochée** : un ordre peut réclamer `publier: true`, sans cette case l’extension prépare le composeur et laisse le clic final à l’humain

Le serveur écoute sur `127.0.0.1` **exclusivement**, jeton exigé à chaque requête.

> ⚠️ Ce module ne parle pas à l’API de X et ne connaît aucun identifiant : il pilote
> l’interface dans un onglet déjà connecté. C’est contraire aux règles d’automatisation de
> X – le mode « préparer », qui laisse le clic final à l’humain, est celui qui reste dans
> les clous.

<details>
<summary><b>Pourquoi un sondage HTTP et pas un WebSocket ?</b></summary>

En MV3 le service worker est arrêté dès qu’il n’a rien à faire : une connexion permanente
ne tient pas. Une alarme le réveille chaque minute, il demande s’il y a du travail. Une
minute d’attente n’a aucune importance pour programmer une publication, et ça évite
d’implémenter le protocole WebSocket à la main dans un projet sans dépendances.

La file d’attente vit **dans l’extension**, pas dans le serveur : une publication programmée
part même si l’outil qui l’a déposée est éteint.

</details>

### Confort général

- Réautorise le défilement quand une page force `overflow: hidden` sur le `<body>`
- Retire les overlays de consentement cookies / 18+ bloquants
- Notifications *toast* discrètes pour les actions de l’extension

---

## Interfaces

| Page | Rôle |
|---|---|
| **Popup** | Point d’entrée : statut X, accès rapide aux pages, bascule du mode édition |
| **Paramètres** | Tous les réglages, groupés et repliables |
| **Gestionnaire d’animes** | Liste des URL corrigées à la main et des animes ignorés |
| **Statistiques Twitch** | Points collectés, détail par chaîne, historique |
| **Publication X** | File d’attente, historique, état du pont local |
| **À propos** | Version et informations |
| **Testeur de toasts** | Outil de dev pour prévisualiser les notifications |

---

## Configuration

Accessible via la popup → **Paramètres**, ou par la page d’options de l’extension.

**Général** – couleur de fond, censure, et **8 thèmes** : Clair, Sombre, Violet, Océan,
Forêt, Coucher de soleil, Cerisier, Minuit (avec aperçu en direct).

**Boutons de switch** – MyAnimeList, AniList, désactivation des animations.

**Plateformes de streaming** – un toggle par site.

**YouTube** – lecture fluide, auto-scroll des Shorts, replays et délai.

**Fonctionnalités** – rewards Twitch, notifications toast.

**Bypass vérification d’âge** – toggle maître + un par site.

**Publication X** – activation, autorisation de publier, port et jeton du pont local.

---

## Raccourcis clavier

| Raccourci | Action | Où |
|---|---|---|
| <kbd>Ctrl</kbd> + <kbd>←</kbd> / <kbd>→</kbd> | Épisode précédent / suivant | Mavanimes |
| <kbd>Ctrl</kbd> + <kbd>L</kbd> | Retour à la liste des épisodes | Mavanimes |
| <kbd>Échap</kbd> | Fermer le popover d’info / le mode édition | Partout |

---

## Architecture

```
SorryIDHMoney/
├── background.js              # Service worker : cache AniList (10 min), routage des actions
├── manifest.example.json      # Référence versionnée (manifest.json est gitignored)
├── icons/
│   └── platforms/             # Logos des plateformes (PNG, SVG, WebP, ICO)
├── interfaces/                # Pages HTML de l'extension + leurs scripts
├── libs/                      # Modules partagés (toast-manager…)
├── scripts/
│   ├── utils.js               # Boutons, popover info, mode édition, animations
│   ├── anime-cache-manager.js # URL personnalisées et animes ignorés (storage.local)
│   ├── *-content.js           # Un content script par plateforme
│   ├── avb/                   # Bypass vérification d'âge (+ son propre README)
│   │   └── spoofs/            # SDK des vérificateurs, remplacés via DNR
│   └── xposter-*.js           # Module Publication X (content, file, pont, relecture)
├── styles/                    # base.css (design tokens) + une feuille par interface
└── tools/                     # Pont local Publication X (serveur + CLI, Node, sans deps)
```

**Permissions demandées :** `storage`, `unlimitedStorage`, `activeTab`, `scripting`,
`declarativeNetRequest`, `alarms`, `tabs`, et `host_permissions: <all_urls>` – requis pour
que les règles DNR de redirection s’appliquent quel que soit le site qui intègre un
vérificateur d’âge.

---

## Développement

Aucune étape de build, aucune dépendance : le code est chargé tel quel par le navigateur.
Après modification, recharger l’extension depuis `chrome://extensions`.

**Conventions du projet :**

- Les content scripts loguent avec un préfixe explicite – `[NomPlateforme]`
- **AniList est la source de vérité** pour les données anime
- Toute nouvelle plateforme doit avoir son toggle dans les options, vérifié en début de `main()`
- `manifest.json` étant *gitignored*, toujours mettre à jour `manifest.example.json` en parallèle
- Les commits ne contiennent jamais de `Co-Authored-By`

> 📖 **[`AGENTS.md`](AGENTS.md)** documente le processus complet d’ajout d’une plateforme de
> streaming, étape par étape (inspection du DOM, logo, content script, manifest, toggle).

---

## Contribution

Les contributions sont les bienvenues – bugs, idées de fonctionnalités, pull requests.
Pour une nouvelle plateforme, suivre le processus décrit dans
[`AGENTS.md`](AGENTS.md).

---

## Licence

MIT.

---

<div align="center">
<sub>Fait avec trop de temps libre et pas beaucoup d’argent.</sub>
</div>

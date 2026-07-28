# Module AVB — Bypass vérification d'âge (port Chromium/Brave)

Intègre à SorryIDHMoney deux projets upstream (sources conservées dans
`.references/`, gitignoré, pour re-synchroniser facilement) :

- [helloyanis/age-verification-bypass](https://github.com/helloyanis/age-verification-bypass)
  — extension Firefox, la plupart des sites (agechecker, agego, ageverif, veriff,
  reddit, aliexpress, bsky). → `.references/age-verification-bypass/`
- [Saganaki22/AgebypassX](https://github.com/Saganaki22/AgebypassX) — userscript
  Tampermonkey (MIT), ciblant X / Twitter. → `.references/AgebypassX/`

## Pourquoi un port et pas une copie

L'extension d'origine est **Firefox-only** : tout son cœur repose sur
`browser.webRequest.filterResponseData()`, l'API qui permet de réécrire le corps
des réponses serveur à la volée. **Cette API n'existe pas sur Chromium** (Chrome,
Brave, Edge…). On la remplace par les mécanismes disponibles en MV3.

## Mécanismes utilisés

| Mécanisme | Fichiers | Ce qu'il couvre |
|---|---|---|
| **Redirection `declarativeNetRequest`** (dynamique, gérée par `avb-manager.js`) | `spoofs/*.js` | Remplace les SDK JS des vérificateurs par des versions « spoof » qui simulent une vérification réussie côté client. Fonctionne sur **n'importe quel site** qui intègre ces vérificateurs, sans injection par page. |
| **Content scripts MAIN world** (injectés/retirés dynamiquement par `avb-manager.js`) | `bsky-proxy.js`, `xcom-bypass.js` | `bsky-proxy` réécrit les réponses JSON de Bluesky (`getServices`, `ageassurance.getConfig`). `xcom-bypass` hooke `__INITIAL_STATE__` / `Object.assign` / `JSON.parse` de X pour désactiver les flags de contenu sensible. MAIN world car ils patchent des objets/fonctions de la page. |
| **Content scripts DOM** (ISOLATED, déclarés au manifest) | `reddit-avb.js`, `aliexpress-avb.js` | Suppriment popups NSFW / flou côté DOM, façon plateformes existantes. Self-guarded via storage. |

## Correspondance avec l'upstream

| Script Firefox | Ici | Statut |
|---|---|---|
| `agechecker.net.js` (popup.js) | DNR → `spoofs/agechecker-popup.js` | ✅ |
| `agechecker.net.js` (API `/v1/create`) | — | ⚠️ non porté (voir limites) |
| `agego.com.js` (verify.js) | DNR → `spoofs/agego-verify.js` | ✅ |
| `agego.com.js` (`s2s/start`) | — | ⚠️ non porté (redirection encodée, voir limites) |
| `ageverif.com.js` (checker.js) | DNR → `spoofs/ageverif-checker.js` | ✅ |
| `veriff.me.js` (JS SDK) | DNR → `spoofs/veriff-sdk.js` | ✅ |
| `veriff.me.js` (incontext SDK) | DNR → `spoofs/veriff-incontext.js` | ✅ |
| `veriff.me.js` (API `sessions` → redirect) | — | ⚠️ non porté (voir limites) |
| `bsky.app.js` | `bsky-proxy.js` (fetch MAIN world) | ✅ |
| `reddit.com.js` (DOM + HTML `<style>`) | `reddit-avb.js` | ✅ (partie DOM) |
| `aliexpress.com.js` | `aliexpress-avb.js` | ✅ |

Depuis **AgebypassX** (Saganaki22, MIT) :

| Userscript | Ici | Statut |
|---|---|---|
| `AgebypassX.user.js` (X / Twitter, webpack/GraphQL) | `xcom-bypass.js` (MAIN world, `x.com` + `twitter.com`) | ✅ |

## Limites connues (Chromium)

- **Bypasses purement server-side non portables** : réécrire une réponse **API**
  arbitraire (agechecker `/v1/create`, veriff `sessions`) exige d'intercepter le
  `fetch` sur *tous* les sites marchands (MAIN world `<all_urls>`), coûteux et
  fragile. On s'appuie donc sur le spoof du **SDK client**, qui suffit pour les
  sites ne revérifiant pas côté serveur — l'upstream a la même limite (« doesn't
  bypass server side checks »).
- **agego `s2s/start`** : la redirection dépend d'un paramètre `returnto`
  URL-encodé que DNR ne sait pas décoder. Non porté.
- **Bluesky** : seul `fetch` est intercepté (pas `XHR`). Suffisant pour l'app web
  actuelle.

## Config (chrome.storage.sync)

Toggle maître `enableAgeVerifBypass` + sous-toggles par site :
`enableAvbReddit`, `enableAvbAliexpress`, `enableAvbBsky`, `enableAvbXcom`,
`enableAvbAgechecker`, `enableAvbAgego`, `enableAvbAgeverif`, `enableAvbVeriff`
(tous `true` par défaut).

Option UI dédiée à X : `enableAvbXcomIndicator` (défaut **`false`**) — affiche ou non
la pastille de statut directement sur la page X. Le statut du bypass X (actif/erreur
+ hooks installés) est de toute façon consultable dans **la popup du plugin** (carte
« X / Twitter — Bypass », visible quand l'onglet actif est X).

Détail X : `xcom-bypass.js` (MAIN world) applique les hooks et mirrore son statut
dans `document.documentElement.dataset` ; `xcom-bridge.js` (content script ISOLATED
déclaré au manifest sur `x.com`/`twitter.com`) pilote la visibilité de la pastille
selon `enableAvbXcomIndicator` et répond aux requêtes de statut de la popup.

`avb-manager.js` (importé par `background.js`) écoute `storage.onChanged` et
réapplique règles DNR + injection bsky à chaque changement. Les content scripts
DOM se lisent la config au chargement de page.

## Permissions ajoutées au manifest

- `declarativeNetRequest` — règles de redirection dynamiques.
- `host_permissions: ["<all_urls>"]` — requis pour qu'une règle DNR de type
  `redirect` s'applique quel que soit le site initiateur (les vérificateurs
  peuvent être intégrés n'importe où). Aligne avec le `<all_urls>` de l'upstream.

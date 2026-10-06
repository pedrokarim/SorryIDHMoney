// by @AliasPedroKarim
// Fait passer nos requêtes d'analyse pour des navigations.
//
// Facebook sert deux versions de la même page selon l'allure de la requête :
//
//   Sec-Fetch-Dest: document  (navigation) -> ~1 Mo, URL du média présentes
//   Sec-Fetch-Dest: empty     (fetch/XHR)  -> ~450 Ko, URL du média absentes
//
// Or `fetch()` ne peut pas écrire ces en-têtes : les `Sec-Fetch-*` sont des
// « forbidden header names », le navigateur les impose lui-même. Le seul levier
// restant est la couche réseau, donc declarativeNetRequest.
//
// La règle ne doit surtout pas s'appliquer à la navigation ordinaire de
// l'utilisateur sur Facebook. On la restreint à nos propres requêtes, marquées
// par un paramètre `_sidhm=1` que Facebook ignore (vérifié : réponse identique
// avec et sans). Ce marqueur ne sert qu'à l'analyse — l'URL rangée dans la file
// reste propre.

const ID_REGLE = 9101; // 9001-9005 appartiennent au module AVB
const MARQUEUR = "_sidhm";

/** Ajoute le marqueur qui déclenche la règle d'en-têtes. */
export function marquerPourAnalyse(url) {
  const u = new URL(url);
  u.searchParams.set(MARQUEUR, "1");
  return u.href;
}

export async function installerRegleEntetes() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ID_REGLE],
      addRules: [
        {
          id: ID_REGLE,
          priority: 1,
          condition: {
            urlFilter: `*${MARQUEUR}=1*`,
            requestDomains: ["facebook.com"],
            resourceTypes: ["xmlhttprequest"],
          },
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "Sec-Fetch-Dest", operation: "set", value: "document" },
              { header: "Sec-Fetch-Mode", operation: "set", value: "navigate" },
              { header: "Sec-Fetch-Site", operation: "set", value: "none" },
              {
                header: "Accept",
                operation: "set",
                value:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
            ],
          },
        },
      ],
    });
  } catch (err) {
    // Si Chrome refuse de réécrire les Sec-Fetch, l'analyse retombera sur la
    // réponse allégée : le téléchargement direct sera indisponible, la file
    // yt-dlp continuera de fonctionner. Le content script journalise la taille
    // reçue, c'est le signe qui permet de trancher.
    console.error("[Facebook] règle d'en-têtes refusée :", err);
  }
}

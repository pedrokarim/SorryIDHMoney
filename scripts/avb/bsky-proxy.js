/*
 * bsky-proxy.js — Proxy fetch injecte en MAIN world sur bsky.app.
 *
 * Equivalent Chromium du webRequest.filterResponseData de la version Firefox :
 * on enveloppe window.fetch pour reecrire, cote client, les deux reponses JSON
 * qui declenchent le gate "contenu sensible" / verification d'age de Bluesky.
 *
 * Injecte/retire dynamiquement par scripts/avb/avb-manager.js selon les toggles
 * enableAgeVerifBypass + enableAvbBsky : si ce script tourne, c'est qu'il est
 * active (pas de garde interne possible, MAIN world n'a pas acces a storage).
 *
 * Port Chromium/Brave de age-verification-bypass (helloyanis).
 */
(function () {
  if (window.__avbBskyPatched) return; // idempotent (re-injection eventuelle)
  window.__avbBskyPatched = true;

  const origFetch = window.fetch;

  function urlOf(input) {
    try {
      if (typeof input === "string") return input;
      if (input instanceof Request) return input.url;
      if (input && typeof input.url === "string") return input.url;
      if (input instanceof URL) return input.href;
    } catch {}
    return "";
  }

  // getServices : neutralise les definitions de labels adultes -> plus de flou/gate.
  function rewriteGetServices(data) {
    if (!Array.isArray(data?.views)) return data;
    data.views.forEach((view) => {
      if (!view?.policies) return;
      view.policies.labelValueDefinitions = [];
      (view.policies.labelValues || []).forEach((label) => {
        view.policies.labelValueDefinitions.push({
          adultOnly: false,
          blurs: "media",
          defaultSetting: "warn",
          identifier: label,
          locales: [
            {
              description: `This content is labeled as ${label}.`,
              lang: "en",
              name: label,
            },
          ],
          severity: "inform",
        });
      });
    });
    return data;
  }

  // ageassurance.getConfig : vide les regions -> le site ne se croit plus soumis
  // a une obligation de verification d'age.
  function rewriteAgeAssurance(data) {
    if (data && typeof data === "object") data.regions = [];
    return data;
  }

  function jsonResponse(obj, source) {
    return new Response(JSON.stringify(obj), {
      status: source.status,
      statusText: source.statusText,
      headers: source.headers,
    });
  }

  window.fetch = async function (input, init) {
    const res = await origFetch.call(this, input, init);
    try {
      const url = urlOf(input) || res.url || "";

      if (url.includes("app.bsky.labeler.getServices")) {
        const data = await res.clone().json();
        return jsonResponse(rewriteGetServices(data), res);
      }

      if (url.includes("app.bsky.ageassurance.getConfig")) {
        const data = await res.clone().json();
        return jsonResponse(rewriteAgeAssurance(data), res);
      }
    } catch (err) {
      // JSON invalide ou reponse opaque -> on laisse passer l'original.
      console.debug("[AVB/bsky] passe l'original:", err);
    }
    return res;
  };

  console.debug("[AVB/bsky] proxy fetch actif");
})();

/*
 * Spoof du JS SDK de Veriff.
 * Cible de redirection DNR a la place de
 *   https://cdn.veriff.me/sdk/js/1.5/veriff.min.js
 * Port Chromium de age-verification-bypass (helloyanis) — voir scripts/avb/README.md
 *
 * NB: ne bypasse que les sites qui ne revalident pas cote serveur.
 */
(function (w) {
  function createResponse() {
    return {
      status: "success",
      verification: {
        id: crypto.randomUUID(),
        url: "",
        host: w.location.hostname,
        status: "approved",
        sessionToken: ""
      }
    };
  }

  w.Veriff = function (config) {
    config = config || {};

    return {
      setParams: function () {},

      mount: function () {
        if (typeof config.onSession === 'function') {
          config.onSession(null, createResponse());
        }
      }
    };
  };
})(window);

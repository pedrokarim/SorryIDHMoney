/*
 * Spoof du SDK popup d'agechecker.net.
 * Sert de cible de redirection declarativeNetRequest a la place de
 *   https://cdn.agechecker.net/static/popup/v1/popup.js
 * Port Chromium de age-verification-bypass (helloyanis) — voir scripts/avb/README.md
 */
(function (w) {
  const config = w.AgeCheckerConfig || {};

  function complete() {

    // fire status changed event
    if (typeof config.onstatuschanged === 'function') {
      config.onstatuschange({"uuid": crypto.randomUUID(), "status": "accepted"}); // Simulate user accepted
    }
    // Redirect takes priority
    if (config.redirect_url) {
      w.location.href = config.redirect_url;
      return;
    }

    // Otherwise trigger onClose then onclosed callback
    if (typeof config.onclose === 'function') {
      config.onclose(); // Simulate user accepted
    }
    if (typeof config.onclosed === 'function') {
      config.onclosed(); // Simulate popup finished closing animation
    }
  }

  // Expose API expected by the loader
  w.AgeCheckerAPI = {
    show: function () {
      complete();
    },

    close: function () {
      complete();
    }
  };

  // Notify loader that the script is ready
  if (typeof config.onready === 'function') {
    config.onready();
  }
})(window);

/*
 * Spoof du SDK "incontext" de Veriff.
 * Cible de redirection DNR a la place de
 *   https://cdn.veriff.me/incontext/js/v2.5.0/veriff.js
 * Port Chromium de age-verification-bypass (helloyanis) — voir scripts/avb/README.md
 */
const MESSAGES = {
  STARTED: "STARTED",
  FINISHED: "FINISHED",
  SUBMITTED: "SUBMITTED",
};

window.veriffSDK = {
  createVeriffFrame({ onEvent }) {
    if (typeof onEvent !== "function") {
      return;
    }

    // Fire the events one after another
    onEvent(MESSAGES.STARTED);
    onEvent(MESSAGES.FINISHED);
    onEvent(MESSAGES.SUBMITTED);
  },
};

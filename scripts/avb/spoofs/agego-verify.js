/*
 * Spoof du SDK de verification d'agego.com (methode "integration").
 * Cible de redirection DNR a la place de
 *   https://verifycdn.agego.com/v1/verify.js
 * Port Chromium de age-verification-bypass (helloyanis) — voir scripts/avb/README.md
 */
(function () {
  const queue = window.AGEGO?.e;

  if (!Array.isArray(queue) || queue.length === 0) {
    console.warn("[Error from bypass script]AGEGO queue is empty (or using simple integration mode?)");
    return;
  }

  // Find the most recent call with an options object containing events
  let events;

  for (let i = queue.length - 1; i >= 0; i--) {
    const args = queue[i];

    for (let j = 0; j < args.length; j++) {
      const candidate = args[j];

      if (
        candidate &&
        typeof candidate === "object" &&
        candidate.events &&
        typeof candidate.events === "object"
      ) {
        events = candidate.events;
        break;
      }
    }

    if (events) break;
  }

  if (!events) {
    console.warn("[Error from bypass script]No AGEGO events found.");
    return;
  }

  if (typeof events.onVerifiedBefore === "function") {
    console.debug("[agego.com bypass script] Calling onVerifiedBefore callback.");
    events.onVerifiedBefore();
  } else if (typeof events.onAPIVerify === "function") {
    console.debug("[agego.com bypass script] Calling onAPIVerify callback.");
    events.onAgeVerify();
  } else if (typeof events.onVerificationFlowEnd === "function") {
    console.debug("[agego.com bypass script] Calling onVerificationFlowEnd callback.");
    events.onVerificationFlowEnd({});
  }
})();

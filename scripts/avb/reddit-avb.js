/*
 * reddit-avb.js — Retire le gate "contenu NSFW" de Reddit (subreddits + posts).
 *
 * Content script ISOLATED declare dans le manifest, run_at document_start.
 * Se protege lui-meme via storage (toggle maitre + enableAvbReddit), a l'image
 * des autres content scripts plateforme du projet. Prise en compte au prochain
 * chargement de page (comme les toggles plateformes).
 *
 * Port Chromium/Brave de age-verification-bypass (helloyanis) — voir README.md.
 * La version Firefox reecrivait aussi le HTML du document (suppression de <style>
 * par data-testid) ; ici on supprime ces memes <style> et le scroll-lock cote DOM.
 */

const BLOCKED_ID = "configured-xpromo-blocking_xpromo_nsfw_blocking_desktop"; // popup subreddit
const PROMPT_CONTAINER_TAG = "xpromo-nsfw-blocking-container"; // popup post isole
const STYLE_TESTIDS_TO_REMOVE = ["nsfw-bypassable-modal-client-css", "experiences-client-css"];

function removeGate(root) {
  // Popup subreddit
  root.getElementById?.(BLOCKED_ID)?.remove();

  // Popup post isole (custom element avec shadow DOM)
  const container =
    root.tagName === PROMPT_CONTAINER_TAG.toUpperCase()
      ? root
      : root.querySelector?.(PROMPT_CONTAINER_TAG);
  if (container?.shadowRoot) {
    container.shadowRoot.querySelector?.(".prompt")?.remove();
  }
}

function cleanupStyles() {
  // <style data-testid="..."> injectes qui verrouillent la page
  for (const testId of STYLE_TESTIDS_TO_REMOVE) {
    document
      .querySelectorAll(`style[data-testid="${testId}"]`)
      .forEach((el) => el.remove());
  }
  // scroll-lock global
  Array.from(document.querySelectorAll("style"))
    .filter((el) => el.textContent?.includes(".rpl-scroll-lock"))
    .forEach((el) => el.remove());
}

function run() {
  cleanupStyles();
  removeGate(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        if (node.id === BLOCKED_ID) {
          node.remove();
          continue;
        }
        if (node.tagName === PROMPT_CONTAINER_TAG.toUpperCase()) {
          node.shadowRoot?.querySelector?.(".prompt")?.remove();
        }
        removeGate(node);

        if (node.tagName === "STYLE") {
          const testId = node.getAttribute("data-testid");
          if (STYLE_TESTIDS_TO_REMOVE.includes(testId)) node.remove();
          else if (node.textContent?.includes(".rpl-scroll-lock")) node.remove();
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
}

(async () => {
  try {
    const { enableAgeVerifBypass, enableAvbReddit } = await new Promise((r) =>
      chrome.storage.sync.get(
        { enableAgeVerifBypass: true, enableAvbReddit: true },
        r
      )
    );
    if (!enableAgeVerifBypass || !enableAvbReddit) return;
    run();
    console.debug("[AVB/reddit] actif");
  } catch (err) {
    console.error("[AVB/reddit] erreur:", err);
  }
})();

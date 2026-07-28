/*
 * aliexpress-avb.js — Retire le flou / gate "produit sensible" d'AliExpress.
 *
 * Content script ISOLATED declare dans le manifest, run_at document_idle.
 * Se protege via storage (toggle maitre + enableAvbAliexpress). Prise en compte
 * au prochain chargement de page.
 *
 * Les produits sont charges au fil du scroll avec les elements de restriction,
 * on repasse donc via un MutationObserver (comme la version Firefox qui re-runait
 * a chaque requete produit).
 *
 * Port Chromium/Brave de age-verification-bypass (helloyanis) — voir README.md.
 */

const BLUR_IMG_SRC =
  "https://ae-pic-a1.aliexpress-media.com/kf/S082ae95bce89462b9548a1d53f222ab4p/72x72.png";

function unblur() {
  document
    .querySelectorAll(
      `.ls_ke, .ho_g9, img[src='${BLUR_IMG_SRC}'], .J_SAFETY_FILER_MODAL, ._1FlkA`
    )
    .forEach((el) => {
      el.style.display = "none";
    });
  document.querySelectorAll("img.nf_bj").forEach((el) => el.classList.remove("nf_bj"));
  document
    .querySelectorAll(".card-dsa-wrapper")
    .forEach((el) => el.classList.remove("card-dsa-wrapper"));
  document
    .querySelectorAll(".dsa--visible--wrapper")
    .forEach((el) => el.classList.remove("dsa--visible--wrapper"));
}

function run() {
  unblur();

  // Re-applique quand de nouveaux produits arrivent (scroll infini).
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      unblur();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

(async () => {
  try {
    const { enableAgeVerifBypass, enableAvbAliexpress } = await new Promise((r) =>
      chrome.storage.sync.get(
        { enableAgeVerifBypass: true, enableAvbAliexpress: true },
        r
      )
    );
    if (!enableAgeVerifBypass || !enableAvbAliexpress) return;
    run();
    console.debug("[AVB/aliexpress] actif");
  } catch (err) {
    console.error("[AVB/aliexpress] erreur:", err);
  }
})();

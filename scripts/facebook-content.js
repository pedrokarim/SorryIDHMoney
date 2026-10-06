// by @AliasPedroKarim
// Repère les vidéos sur facebook.com et propose de les récupérer.
//
// Facebook est une SPA : la vidéo change sans rechargement, donc on écoute
// pushState/replaceState/popstate comme pour Crunchyroll et ADN.
//
// L'analyse ne lit pas le DOM courant par défaut : après une navigation SPA,
// le HTML initial contient encore les blobs JSON de la *première* vidéo vue, et
// on téléchargerait la mauvaise. On refait donc une requête sur l'URL
// canonique — même origine, cookies inclus, c'est fiable — et le DOM ne sert
// que de repli quand la requête échoue et que l'identifiant y figure bien.

const PREFIXE = "[Facebook]";
const srcExtract = chrome.runtime.getURL("scripts/facebook-extract.js");
const srcEntetes = chrome.runtime.getURL("scripts/facebook-entetes.js");
const srcToast = chrome.runtime.getURL("libs/toast-manager.js");

// En dessous de ce seuil, Facebook a servi sa réponse allégée : les URL du
// média n'y sont pas. Mesuré : ~450 Ko allégée contre ~1 Mo complète.
const SEUIL_PAGE_COMPLETE = 700 * 1024;

let extract;
let entetes;
let toast;
let panneau;
let idAffiche = null;
let minuteurListe = null;

async function notifier(message, type = "info") {
  try {
    toast ??= await import(srcToast);
    toast.showToast(message, { type });
  } catch {
    console.log(PREFIXE, message);
  }
}

/**
 * Récupère le HTML de la page vidéo et en tire les sources.
 * @returns {Promise<object|null>}
 */
async function analyser(video) {
  let html = null;

  try {
    // Le marqueur déclenche la règle d'en-têtes : sans elle, Facebook renvoie
    // une page allégée où les URL du média sont absentes.
    const reponse = await fetch(entetes.marquerPourAnalyse(video.url), {
      credentials: "include",
    });
    if (reponse.ok) html = await reponse.text();
  } catch (e) {
    console.warn(PREFIXE, "requête échouée", e);
  }

  if (html) {
    console.log(
      PREFIXE,
      `réponse de ${Math.round(html.length / 1024)} Ko —`,
      html.length >= SEUIL_PAGE_COMPLETE
        ? "page complète"
        : "page allégée, la règle d'en-têtes n'a pas pris"
    );
  }

  let sources = html ? extract.extraireDepuisHtml(html) : null;

  // Repli : le document courant, seulement s'il parle bien de cette vidéo.
  if (!sources?.hd && !sources?.sd) {
    const brut = document.documentElement.innerHTML;
    if (brut.includes(video.id)) {
      const duDom = extract.extraireDepuisHtml(brut);
      if (duDom.hd || duDom.sd) sources = duDom;
      else sources ??= duDom;
    }
  }

  if (!sources) return null;

  // Quand Facebook a servi sa coquille, le titre vaut « Facebook Live » : cinq
  // vidéos différentes deviennent cinq lignes identiques dans la file. La page
  // ouverte, elle, connaît son titre — on le prend là, sans requête.
  const titre = extract.estTitreGenerique(sources.titre)
    ? titreDuDom(video)
    : sources.titre;

  const progressif = sources.hd || sources.sd;
  return {
    ...video,
    ...sources,
    titre,
    progressif: Boolean(progressif),
    urlMedia: progressif,
    qualite: sources.hd ? "HD" : sources.sd ? "SD" : null,
  };
}

/**
 * Titre lu dans la page ouverte, en dernier recours.
 * Ne vaut que pour la vidéo affichée : après une navigation SPA, le document
 * peut encore parler de la précédente.
 */
function titreDuDom(video) {
  if (idAffiche !== video.id) return null;

  const og = document.querySelector('meta[property="og:title"]')?.content;
  if (og && !extract.estTitreGenerique(og)) return og.trim();

  const titre = document.title.replace(/\s*\|\s*Facebook\s*$/i, "").trim();
  return extract.estTitreGenerique(titre) ? null : titre;
}

function formaterDuree(ms) {
  if (!ms) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

// --- Panneau --------------------------------------------------------------

function construirePanneau() {
  const styles = document.createElement("style");
  styles.textContent = `
    #sidhm-fb {
      position: fixed; bottom: 20px; right: 20px; z-index: 2147483000;
      width: 280px; padding: 14px; border-radius: 12px;
      background: #1a1a2e; color: #f5f5f5; border: 1px solid #805ad5;
      box-shadow: 0 8px 24px rgba(0,0,0,.45);
      font: 13px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif;
    }
    #sidhm-fb[hidden] { display: none; }
    #sidhm-fb .sidhm-tete {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 8px; font-weight: 600; color: #9f7aea;
    }
    #sidhm-fb .sidhm-fermer {
      cursor: pointer; background: none; border: none; color: #999;
      font-size: 16px; line-height: 1; padding: 0 2px;
    }
    #sidhm-fb .sidhm-titre {
      font-weight: 600; margin-bottom: 4px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    #sidhm-fb .sidhm-meta { color: #a0aec0; font-size: 12px; margin-bottom: 10px; }
    #sidhm-fb button.sidhm-action {
      display: block; width: 100%; margin-top: 6px; padding: 8px 10px;
      border: none; border-radius: 8px; cursor: pointer; font-size: 13px;
      font-weight: 600; background: #805ad5; color: #fff;
    }
    #sidhm-fb button.sidhm-action:hover:not(:disabled) { background: #6b46c1; }
    #sidhm-fb button.sidhm-action:disabled { opacity: .45; cursor: not-allowed; }
    #sidhm-fb button.sidhm-secondaire { background: #4a5568; }
    #sidhm-fb button.sidhm-secondaire:hover:not(:disabled) { background: #2d3748; }
  `;
  document.documentElement.appendChild(styles);

  const boite = document.createElement("div");
  boite.id = "sidhm-fb";
  boite.innerHTML = `
    <div class="sidhm-tete">
      <span>Vidéo repérée</span>
      <button class="sidhm-fermer" title="Masquer">&times;</button>
    </div>
    <div class="sidhm-titre"></div>
    <div class="sidhm-meta"></div>
    <button class="sidhm-action" data-role="telecharger" disabled>Analyse…</button>
    <button class="sidhm-action sidhm-secondaire" data-role="file">Ajouter à la file yt-dlp</button>
    <button class="sidhm-action" data-role="recolter" hidden>Tout ajouter à la file</button>
    <button class="sidhm-action sidhm-secondaire" data-role="ouvrir">Ouvrir la file</button>
  `;
  document.documentElement.appendChild(boite);

  boite.querySelector(".sidhm-fermer").addEventListener("click", () => {
    boite.hidden = true;
  });

  boite
    .querySelector('[data-role="ouvrir"]')
    .addEventListener("click", () =>
      chrome.runtime.sendMessage({ action: "fbFileOuvrir" })
    );

  return boite;
}

function majPanneau(infos) {
  panneau.hidden = false;
  panneau.querySelector(".sidhm-titre").textContent =
    infos.titre || `Vidéo ${infos.id}`;

  const meta = [
    infos.dateIso,
    formaterDuree(infos.dureeMs),
    infos.qualite ? `mp4 ${infos.qualite}` : infos.dash ? "DASH seulement" : null,
  ].filter(Boolean);
  panneau.querySelector(".sidhm-meta").textContent = meta.join(" · ") || "—";

  const boutonDl = panneau.querySelector('[data-role="telecharger"]');
  const boutonFile = panneau.querySelector('[data-role="file"]');

  if (infos.progressif) {
    boutonDl.disabled = false;
    boutonDl.textContent = `Télécharger le mp4 ${infos.qualite}`;
    boutonDl.onclick = async () => {
      boutonDl.disabled = true;
      boutonDl.textContent = "Envoi…";
      // L'URL du CDN expire : on la ré-extrait juste avant de la donner au
      // gestionnaire de téléchargement plutôt que de réutiliser l'ancienne.
      const frais = (await analyser(infos)) || infos;
      const reponse = await chrome.runtime.sendMessage({
        action: "fbTelecharger",
        video: {
          url: frais.urlMedia || infos.urlMedia,
          nomFichier: extract.nomFichier(frais),
        },
      });
      if (reponse?.ok) {
        notifier("Téléchargement lancé", "success");
        boutonDl.textContent = "Téléchargement lancé";
      } else {
        notifier(`Échec : ${reponse?.erreur || "inconnu"}`, "error");
        boutonDl.textContent = "Réessayer";
        boutonDl.disabled = false;
      }
    };
  } else {
    boutonDl.disabled = true;
    boutonDl.textContent = infos.dash
      ? "Pas de mp4 direct — passer par la file"
      : "Aucune source trouvée";
  }

  boutonFile.onclick = async () => {
    const reponse = await chrome.runtime.sendMessage({
      action: "fbFileAjouter",
      video: infos,
    });
    if (!reponse?.ok) return notifier("Ajout impossible", "error");
    notifier(
      reponse.ajoute
        ? `Ajouté à la file (${reponse.total})`
        : "Déjà dans la file",
      reponse.ajoute ? "success" : "info"
    );
  };
}

// --- Boucle principale ----------------------------------------------------

/** Affiche/masque les boutons selon qu'on lit une vidéo ou qu'on parcourt une liste. */
function basculerMode(mode) {
  panneau.querySelector('[data-role="telecharger"]').hidden = mode !== "video";
  panneau.querySelector('[data-role="file"]').hidden = mode !== "video";
  panneau.querySelector('[data-role="recolter"]').hidden = mode !== "liste";
  panneau.querySelector(".sidhm-tete span").textContent =
    mode === "liste" ? "Page de vidéos" : "Vidéo repérée";
}

/**
 * Mode liste : on ramasse les liens de la page. Facebook charge sa liste au fil
 * du défilement, donc on recompte régulièrement plutôt qu'une seule fois.
 */
function traiterListe() {
  panneau ??= construirePanneau();
  panneau.hidden = false;
  basculerMode("liste");

  const bouton = panneau.querySelector('[data-role="recolter"]');
  let trouvees = [];

  const recompter = () => {
    trouvees = extract.recolterLiens(document);
    panneau.querySelector(".sidhm-titre").textContent = `${trouvees.length} vidéo${
      trouvees.length > 1 ? "s" : ""
    } sur cette page`;
    panneau.querySelector(".sidhm-meta").textContent =
      "Fais défiler la page pour en charger davantage, puis clique.";
    bouton.disabled = trouvees.length === 0;
    bouton.textContent = `Tout ajouter à la file (${trouvees.length})`;
  };

  recompter();
  clearInterval(minuteurListe);
  minuteurListe = setInterval(recompter, 2000);

  bouton.onclick = async () => {
    const reponse = await chrome.runtime.sendMessage({
      action: "fbFileAjouterLot",
      videos: trouvees,
    });
    if (!reponse?.ok) return notifier("Ajout impossible", "error");
    notifier(
      `${reponse.ajoutes} ajoutée${reponse.ajoutes > 1 ? "s" : ""}` +
        (reponse.ignores ? `, ${reponse.ignores} déjà en file` : "") +
        ` — ${reponse.total} au total`,
      "success"
    );
  };
}

async function traiterUrl(url) {
  clearInterval(minuteurListe);

  if (extract.estPageListe(url)) {
    idAffiche = null;
    return traiterListe();
  }

  const video = extract.detecterVideo(url);

  if (!video) {
    idAffiche = null;
    if (panneau) panneau.hidden = true;
    return;
  }
  if (video.id === idAffiche) return;
  idAffiche = video.id;

  panneau ??= construirePanneau();
  panneau.hidden = false;
  basculerMode("video");
  panneau.querySelector(".sidhm-titre").textContent = `Vidéo ${video.id}`;
  panneau.querySelector(".sidhm-meta").textContent = "Analyse en cours…";

  const boutonDl = panneau.querySelector('[data-role="telecharger"]');
  boutonDl.disabled = true;
  boutonDl.textContent = "Analyse…";

  console.log(PREFIXE, "vidéo détectée", video);
  const infos = await analyser(video);

  // Une autre navigation a eu lieu pendant la requête.
  if (idAffiche !== video.id) return;

  if (!infos) {
    panneau.querySelector(".sidhm-meta").textContent = "Analyse impossible";
    return;
  }
  majPanneau(infos);
}

function installerNavigationSpa() {
  const signaler = () => setTimeout(() => traiterUrl(location.href), 300);

  for (const methode of ["pushState", "replaceState"]) {
    const original = history[methode];
    history[methode] = function (...args) {
      const retour = original.apply(this, args);
      signaler();
      return retour;
    };
  }
  window.addEventListener("popstate", signaler);
}

async function main() {
  const { enableFacebookDl } = await new Promise((r) =>
    chrome.storage.sync.get({ enableFacebookDl: true }, r)
  );
  if (!enableFacebookDl) return;

  [extract, entetes] = await Promise.all([
    import(srcExtract),
    import(srcEntetes),
  ]);
  installerNavigationSpa();
  traiterUrl(location.href);
}

main();

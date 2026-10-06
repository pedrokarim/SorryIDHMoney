// by @AliasPedroKarim
// Extraction des sources vidéo d'une page Facebook.
//
// Facebook n'expose jamais l'URL du média dans le DOM : la balise <video> porte
// un `blob:` (Media Source Extensions), inutilisable. En revanche le HTML servi
// par le serveur embarque des blobs JSON qui contiennent les vraies URL du CDN.
// C'est là qu'on cherche.
//
// Deux familles de sources :
//   - progressive : un seul .mp4 déjà muxé, téléchargeable tel quel ;
//   - DASH : pistes audio et vidéo séparées, il faut un muxeur → yt-dlp.
// Les lives longs n'ont souvent que du DASH, d'où la file d'attente.
//
// Les URL du CDN sont signées et expirent (quelques heures) : on ne les stocke
// jamais, on les ré-extrait au moment voulu.
//
// Les motifs sont écrits avec String.raw : les blobs sont échappés une fois
// (`https:\/\/…`) ou deux selon la profondeur d'imbrication, et un backslash
// perdu à l'écriture rend la regex silencieusement inerte.

const CLES_HD = [
  "browser_native_hd_url",
  "playable_url_quality_hd",
  "hd_src_no_ratelimit",
  "hd_src",
];

const CLES_SD = [
  "browser_native_sd_url",
  "playable_url",
  "sd_src_no_ratelimit",
  "sd_src",
];

/** Guillemet ouvrant ou fermant, éventuellement échappé. */
const GUILLEMET = String.raw`\\?"`;

function motifChaine(cle) {
  return new RegExp(
    GUILLEMET + cle + GUILLEMET + String.raw`\s*:\s*` + GUILLEMET + `([^"]+)`,
    "g"
  );
}

function motifNombre(cle) {
  return new RegExp(
    GUILLEMET + cle + GUILLEMET + String.raw`\s*:\s*(\d{6,})`
  );
}

/**
 * Défait l'échappement JSON d'une chaîne trouvée à la regex.
 * Selon la profondeur d'imbrication, la même URL arrive en `https:\/\/` ou en
 * `https:\\\/\\\/`.
 */
function decoderChaineJson(brut) {
  return brut
    .replace(/\\+$/, "")
    .replace(/\\\\/g, "\\")
    .replace(/\\\//g, "/")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\&/g, "&")
    .replace(/&amp;/g, "&");
}

/** Entités HTML, y compris les formes numériques que Facebook met dans og:title. */
function decoderEntitesHtml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function estUrlMedia(url) {
  return (
    typeof url === "string" &&
    url.startsWith("https://") &&
    /fbcdn\.net|facebook\.com\/video/.test(url)
  );
}

/**
 * Cherche la première clé renseignée de la liste dans un texte brut.
 * Regex plutôt que JSON.parse : les blobs sont trop imbriqués et trop gros pour
 * être parsés proprement, et leur forme change souvent.
 */
function premiereCle(texte, cles) {
  for (const cle of cles) {
    const motif = motifChaine(cle);
    let m;
    while ((m = motif.exec(texte)) !== null) {
      const url = decoderChaineJson(m[1]);
      if (estUrlMedia(url)) return { url, cle };
    }
  }
  return null;
}

function premierNombre(texte, cles) {
  for (const cle of cles) {
    const m = motifNombre(cle).exec(texte);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Facebook préfixe og:title par des statistiques et suffixe par l'auteur :
 * « 10K views · 179 reactions | Vrai titre | Nom de la page ».
 * On ne retire le premier segment que s'il ressemble vraiment à des stats.
 */
function nettoyerTitre(brut) {
  const segments = brut.split("|").map((s) => s.trim());
  if (
    segments.length > 1 &&
    /\b(views?|reactions?|comments?|likes?|vues|réactions?|commentaires?)\b/i.test(
      segments[0]
    )
  ) {
    segments.shift();
  }
  return segments.join(" | ").trim();
}

function extraireTitre(texte) {
  const og = /<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i.exec(texte);
  if (og?.[1]) return nettoyerTitre(decoderEntitesHtml(og[1]));

  const balise = /<title[^>]*>([^<]+)<\/title>/i.exec(texte);
  if (balise?.[1]) {
    return nettoyerTitre(
      decoderEntitesHtml(balise[1]).replace(/\s*\|\s*Facebook\s*$/i, "")
    );
  }
  return null;
}

/**
 * Analyse un HTML de page Facebook et rend ce qu'on a pu en tirer.
 * @param {string} html
 * @returns {{hd: string|null, sd: string|null, titre: string|null,
 *            dateIso: string|null, dureeMs: number|null, dash: boolean,
 *            cleSource: string|null}}
 */
export function extraireDepuisHtml(html) {
  const hd = premiereCle(html, CLES_HD);
  const sd = premiereCle(html, CLES_SD);
  const horodatage = premierNombre(html, ["publish_time", "created_time"]);
  const duree = premierNombre(html, ["playable_duration_in_ms"]);

  return {
    hd: hd?.url ?? null,
    sd: sd?.url ?? null,
    cleSource: hd?.cle ?? sd?.cle ?? null,
    titre: extraireTitre(html),
    dateIso: horodatage
      ? new Date(horodatage * 1000).toISOString().slice(0, 10)
      : null,
    dureeMs: duree,
    dash: /dash_manifest|dash_prefetched_representations/.test(html),
  };
}

/**
 * Reconnaît une page vidéo Facebook et en tire un identifiant stable.
 * Rend `null` si l'URL n'est pas une page vidéo.
 * @param {string} urlBrute
 * @returns {{id: string, url: string, type: string}|null}
 */
export function detecterVideo(urlBrute) {
  let u;
  try {
    u = new URL(urlBrute);
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/.test(u.hostname)) return null;

  const chemin = u.pathname;

  // /watch/live/?v=ID · /watch/?v=ID · /video.php?v=ID
  const v = u.searchParams.get("v");
  if (v && /^\d+$/.test(v)) {
    return {
      id: v,
      url: `https://www.facebook.com/watch/?v=${v}`,
      type: chemin.startsWith("/watch/live") ? "live" : "video",
    };
  }

  // /{page}/videos/{slug?}/{ID}/
  const videos = /\/videos\/(?:[^/]+\/)?(\d+)/.exec(chemin);
  if (videos) {
    return {
      id: videos[1],
      url: `https://www.facebook.com/watch/?v=${videos[1]}`,
      type: "video",
    };
  }

  // /reel/ID
  const reel = /^\/reel\/(\d+)/.exec(chemin);
  if (reel) {
    return {
      id: reel[1],
      url: `https://www.facebook.com/reel/${reel[1]}`,
      type: "reel",
    };
  }

  // /share/v/TOKEN/ — pas d'identifiant numérique exposé, on garde l'URL telle
  // quelle : yt-dlp sait suivre la redirection.
  const partage = /^\/share\/[vr]\/([\w-]+)/.exec(chemin);
  if (partage) {
    return { id: partage[1], url: u.href, type: "partage" };
  }

  // /story.php?story_fbid=ID
  const story = u.searchParams.get("story_fbid");
  if (story && /^\d+$/.test(story)) {
    return {
      id: story,
      url: `https://www.facebook.com/watch/?v=${story}`,
      type: "video",
    };
  }

  return null;
}

/**
 * Facebook sert « Facebook Live », « Facebook » ou « Vidéo » comme titre de
 * repli sur ses coquilles de page. Un tel titre ne distingue rien : mieux vaut
 * ne rien retenir et laisser l'identifiant parler.
 */
export function estTitreGenerique(titre) {
  if (!titre) return true;
  return /^(facebook(\s+(live|watch|vidéos?|videos?))?|vidéos?|videos?|live)$/i.test(
    titre.trim()
  );
}

/**
 * Vrai sur une page qui liste des vidéos plutôt que d'en lire une.
 * C'est là qu'on moissonne : `/{page}/videos`, `/{page}/live_videos`,
 * `/watch/` sans identifiant.
 */
export function estPageListe(urlBrute) {
  let u;
  try {
    u = new URL(urlBrute);
  } catch {
    return false;
  }
  if (!/(^|\.)facebook\.com$/.test(u.hostname)) return false;
  if (detecterVideo(urlBrute)) return false;

  return /\/(?:live_)?videos\/?$/.test(u.pathname) || /^\/watch\/?$/.test(u.pathname);
}

/**
 * Ramasse toutes les vidéos référencées par les liens d'un document.
 * Facebook charge sa liste au fil du défilement : on rappelle cette fonction
 * après chaque scroll, le dédoublonnage se fait sur l'identifiant.
 * @returns {Array<{id: string, url: string, type: string}>}
 */
export function recolterLiens(doc = document) {
  const vues = new Map();

  for (const lien of doc.querySelectorAll("a[href]")) {
    const video = detecterVideo(lien.href);
    if (video && !vues.has(video.id)) vues.set(video.id, video);
  }
  return [...vues.values()];
}

/**
 * Nom de fichier lisible et sûr sur Windows.
 * Le sous-dossier « Facebook » est relatif au dossier de téléchargement.
 */
export function nomFichier({ titre, dateIso, id }) {
  const base = [dateIso, (titre || `facebook-${id}`).slice(0, 120)]
    .filter(Boolean)
    .join(" - ");
  const propre = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/, "")
    .trim();
  return `Facebook/${propre || id}.mp4`;
}

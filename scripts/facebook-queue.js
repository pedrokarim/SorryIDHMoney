// by @AliasPedroKarim
// File d'attente et téléchargements du module Facebook.
//
// Deux chemins de sortie pour une vidéo repérée :
//   1. téléchargement direct — quand Facebook expose un .mp4 progressif, le
//      navigateur suffit, `chrome.downloads` fait le travail ;
//   2. file d'attente — pour tout le reste (lives longs, flux DASH), on garde
//      l'URL de la page et on laisse yt-dlp faire le muxage.
//
// On ne stocke jamais l'URL du CDN : elle est signée et expire en quelques
// heures. La file ne contient que ce qui reste vrai dans le temps — l'URL de
// la page, le titre, la date.

const CLE_FILE = "fbFile";

async function lireBrut() {
  const { [CLE_FILE]: file } = await chrome.storage.local.get({ [CLE_FILE]: [] });
  return Array.isArray(file) ? file : [];
}

async function ecrire(file) {
  await chrome.storage.local.set({ [CLE_FILE]: file });
  return file;
}

/** @returns {Promise<Array<object>>} la file, la plus récente en tête */
export async function lireFile() {
  return lireBrut();
}

/**
 * Ajoute une vidéo si elle n'y est pas déjà (dédoublonnage par identifiant).
 * @returns {Promise<{ajoute: boolean, total: number}>}
 */
export async function ajouterAFile(video) {
  const file = await lireBrut();
  if (file.some((v) => v.id === video.id)) {
    return { ajoute: false, total: file.length };
  }
  file.unshift({
    id: video.id,
    url: video.url,
    titre: video.titre || null,
    dateIso: video.dateIso || null,
    dureeMs: video.dureeMs || null,
    type: video.type || "video",
    progressif: Boolean(video.progressif),
    ajouteLe: new Date().toISOString(),
  });
  await ecrire(file);
  return { ajoute: true, total: file.length };
}

/**
 * Ajoute un lot d'un coup — le moissonnage d'une page « Vidéos ».
 * Les vidéos déjà présentes sont ignorées, pas dupliquées : on peut donc
 * rappeler la fonction après chaque défilement sans rien salir.
 * @returns {Promise<{ajoutes: number, ignores: number, total: number}>}
 */
export async function ajouterLotAFile(videos) {
  const file = await lireBrut();
  const connus = new Set(file.map((v) => v.id));
  const horodatage = new Date().toISOString();
  let ajoutes = 0;

  // En tête et dans l'ordre de la page : les listes Facebook vont du plus
  // récent au plus ancien.
  for (const video of [...videos].reverse()) {
    if (connus.has(video.id)) continue;
    connus.add(video.id);
    ajoutes++;
    file.unshift({
      id: video.id,
      url: video.url,
      titre: video.titre || null,
      dateIso: video.dateIso || null,
      dureeMs: video.dureeMs || null,
      type: video.type || "video",
      progressif: Boolean(video.progressif),
      ajouteLe: horodatage,
    });
  }

  await ecrire(file);
  return { ajoutes, ignores: videos.length - ajoutes, total: file.length };
}

export async function retirerDeFile(ids) {
  const aRetirer = new Set(Array.isArray(ids) ? ids : [ids]);
  const file = (await lireBrut()).filter((v) => !aRetirer.has(v.id));
  return ecrire(file);
}

export async function viderFile() {
  return ecrire([]);
}

/**
 * Lance un téléchargement direct.
 * @param {{url: string, nomFichier: string}} demande
 * @returns {Promise<{id: number}>}
 */
export async function telechargerVideo({ url, nomFichier }) {
  const id = await chrome.downloads.download({
    url,
    filename: nomFichier,
    saveAs: false,
  });
  return { id };
}

#!/usr/bin/env node
/*
 * xposter-cli.js — Depose un ordre dans le pont local.
 *
 * Prend un fichier JSON decrivant la publication, encode les images en base64
 * — le navigateur ne peut pas lire le disque, c'est donc a nous de les lui
 * apporter — et attend le compte rendu de l'extension.
 *
 * Exemple de fichier :
 * {
 *   "texte": "Your anime list, as one image.\n\n→ cma.ascencia.re",
 *   "images": ["../gestion-marketing/brand/assets/cardmyanime/2026-08-19-01-hero.png"],
 *   "alts": ["Tilted wall of anime covers…"],
 *   "quand": "2026-08-20T14:00:00+02:00",
 *   "publier": false
 * }
 *
 * Usage :
 *   node tools/xposter-cli.js programmer --fichier post.json --token X [--port 8787]
 *   node tools/xposter-cli.js maintenant --fichier post.json --token X
 *   node tools/xposter-cli.js lister --token X
 *   node tools/xposter-cli.js capturer --sortie ecran.png --token X
 *   node tools/xposter-cli.js tweets --token X [--compte ascencia64] [--sortie fil.json]
 *   node tools/xposter-cli.js annuler --id p123 --token X
 *   node tools/xposter-cli.js relancer --id p123 --token X
 *   node tools/xposter-cli.js programmes --token X
 */

const fs = require('fs');
const path = require('path');

const [, , action, ...args] = process.argv;
const lire = (nom, defaut) => {
  const i = args.indexOf('--' + nom);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
};

const PORT = lire('port', '8787');
const TOKEN = lire('token', process.env.XPOSTER_TOKEN || '');
const BASE = `http://127.0.0.1:${PORT}`;

if (!action) { console.error('Action manquante : programmer | maintenant | lister | annuler | capturer | tweets'); process.exit(1); }
if (!TOKEN) { console.error('Jeton manquant : --token, ou XPOSTER_TOKEN.'); process.exit(1); }

/*
 * Formats acceptes, par famille. X ne les melange pas : un post porte jusqu'a
 * quatre images, OU une seule video. Le GIF reste range avec les images — X lui
 * accorde un texte alternatif, contrairement a la video.
 */
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};
const VIDEO_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

/*
 * Poids maximal d'un media sur le disque.
 *
 * Ce n'est pas la limite de X — 512 Mo pour une video — mais celle du chemin
 * qu'on emprunte : le fichier voyage en base64, qui l'alourdit d'un tiers, et
 * une publication programmee cote extension attend dans `chrome.storage.local`,
 * plafonne a 10 Mo. Six mega-octets en pesent huit une fois encodes : c'est le
 * plus gros qui laisse encore de la place a la file.
 */
const MAX_MEDIA_BYTES = 6 * 1024 * 1024;

/**
 * Lit les medias sur le disque et les encode.
 *
 * Les regles de X sont verifiees ici plutot qu'au moment du depot : une erreur
 * de la ligne de commande se lit, une piece jointe refusee par le composeur se
 * devine.
 */
function loadMedia(paths) {
  const media = paths.map((filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const type = IMAGE_TYPES[ext] || VIDEO_TYPES[ext];
    if (!type) {
      const known = [...Object.keys(IMAGE_TYPES), ...Object.keys(VIDEO_TYPES)].join(' ');
      throw new Error(`format non gere : ${filePath} (connus : ${known})`);
    }

    const bytes = fs.statSync(filePath).size;
    if (bytes > MAX_MEDIA_BYTES) {
      throw new Error(
        `${filePath} pese ${(bytes / 1048576).toFixed(1)} Mo, au-dela des `
        + `${MAX_MEDIA_BYTES / 1048576} Mo que le pont sait transporter`,
      );
    }

    return {
      nom: path.basename(filePath),
      dataUrl: `data:${type};base64,${fs.readFileSync(filePath).toString('base64')}`,
      // Le composeur s'en sert pour attendre plus longtemps : X transcode une
      // video avant de reactiver le bouton d'envoi.
      video: Boolean(VIDEO_TYPES[ext]),
    };
  });

  const videos = media.filter((m) => m.video);
  if (videos.length && videos.length !== media.length) {
    throw new Error('X ne melange pas video et images dans un meme post');
  }
  if (videos.length > 1) {
    throw new Error(`X accepte une seule video, ${videos.length} fournies`);
  }
  if (!videos.length && media.length > 4) {
    throw new Error(`X accepte 4 images au maximum, ${media.length} fournies`);
  }

  return media;
}

function construireCharge() {
  const fichier = lire('fichier');
  if (!fichier) throw new Error('--fichier manquant');
  const spec = JSON.parse(fs.readFileSync(fichier, 'utf8'));

  // `medias` est le nom juste depuis que la video passe ; `images` reste lu
  // pour que les fichiers deja ecrits continuent de marcher.
  const media = loadMedia(spec.medias || spec.images || []);

  /*
   * ==Ce systeme ne pose plus de texte alternatif.== Decision de Karim, prise
   * le 06/09/2026 : la chaine n'en depose sur aucun media, jamais.
   *
   * Le champ `alts` d'un fichier de charge est donc ignore, et on le dit
   * plutot que de le laisser croire qu'il a servi. La liste part toujours
   * vide, ce qui court-circuite `writeAlts()` cote composeur.
   */
  if (spec.alts?.length) {
    console.log('note : `alts` ignore — cette chaine ne pose plus de texte alternatif.');
  }
  const alts = [];

  // `programmation` : "extension" ou "x". Absent, le reglage global tranche.
  return {
    texte: spec.texte || '',
    // La cle du protocole reste `images` : l'extension la lit sous ce nom.
    images: media,
    alts,
    quand: spec.quand,
    programmation: spec.programmation,
    publier: spec.publier === true,
  };
}

const appeler = async (chemin, options = {}) =>
  fetch(BASE + chemin, {
    ...options,
    headers: { 'x-xposter-token': TOKEN, 'content-type': 'application/json', ...(options.headers || {}) },
  });

(async () => {
  let charge = {};
  if (action === 'programmer' || action === 'maintenant') charge = construireCharge();
  if (action === 'annuler' || action === 'relancer') charge = { id: lire('id') };
  if (action === 'tweets') charge = { compte: lire('compte'), maximum: parseInt(lire('maximum', '0'), 10) };

  const rep = await appeler('/ordre', { method: 'POST', body: JSON.stringify({ action, charge }) });
  const { id } = await rep.json();
  console.log('ordre depose :', id);
  console.log('en attente du passage de l extension (jusqu a ~1 min)…');

  // L extension sonde a la minute : on laisse largement le temps.
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await appeler(`/resultat?id=${id}`);
    if (r.status === 200) {
      const res = await r.json();

      // Une capture ne s affiche pas dans un terminal : on l ecrit sur disque
      // et on annonce le chemin plutot que de deverser 2 Mo de base64.
      if (res.ok && action === 'capturer' && res.resultat?.dataUrl) {
        const sortie = lire('sortie', 'capture.png');
        const base64 = res.resultat.dataUrl.split(',')[1];
        fs.writeFileSync(sortie, Buffer.from(base64, 'base64'));
        console.log('capture ecrite :', sortie);
        process.exit(0);
      }

      // Un fil complet fait plusieurs centaines de lignes : on l ecrit sur
      // disque quand on nous donne un chemin, et on resume a l ecran.
      if (res.ok && action === 'tweets') {
        const fil = res.resultat;
        const sortie = lire('sortie');
        if (sortie) {
          fs.writeFileSync(sortie, JSON.stringify(fil, null, 2));
          console.log('fil ecrit :', sortie);
        }
        const alerte = fil.tronque ? ' (TRONQUE : mur de connexion, session absente ?)' : '';
        console.log(`@${fil.compte} — ${fil.total} posts releves${alerte}`);
        if (!sortie) {
          for (const t of fil.tweets) {
            const jour = (t.date || t.dateAffichee || '?').slice(0, 10);
            const nature = t.reponse ? 'rep' : t.repost ? 'rt ' : '   ';
            const debut = t.texte.split('\n')[0].slice(0, 60);
            console.log(`  ${jour}  ${nature} ${String(t.medias).padStart(2)}img  ${JSON.stringify(debut)}`);
          }
        }
        process.exit(0);
      }

      console.log(res.ok ? 'OK' : 'ECHEC', JSON.stringify(res.ok ? res.resultat : res.erreur, null, 2));
      process.exit(res.ok ? 0 : 1);
    }
  }
  console.error('aucune reponse — l extension est-elle chargee et le module coche ?');
  process.exit(1);
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });

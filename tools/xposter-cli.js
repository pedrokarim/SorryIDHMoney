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

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** X n'accepte que quatre images ; on le dit ici plutot que de tronquer en silence. */
function chargerImages(chemins) {
  if (chemins.length > 4) throw new Error(`X accepte 4 images au maximum, ${chemins.length} fournies`);
  return chemins.map((p) => {
    const ext = path.extname(p).toLowerCase();
    const type = TYPES[ext];
    if (!type) throw new Error(`format non gere : ${p}`);
    return {
      nom: path.basename(p),
      dataUrl: `data:${type};base64,${fs.readFileSync(p).toString('base64')}`,
    };
  });
}

function construireCharge() {
  const fichier = lire('fichier');
  if (!fichier) throw new Error('--fichier manquant');
  const spec = JSON.parse(fs.readFileSync(fichier, 'utf8'));

  const images = chargerImages(spec.images || []);
  const alts = spec.alts || [];

  if (alts.length && alts.length !== images.length) {
    // Une image sans texte alternatif est invisible pour un lecteur d'ecran ;
    // mieux vaut refuser que de publier un decalage silencieux.
    throw new Error(`${images.length} image(s) mais ${alts.length} texte(s) alternatif(s)`);
  }

  return { texte: spec.texte || '', images, alts, quand: spec.quand, publier: spec.publier === true };
}

const appeler = async (chemin, options = {}) =>
  fetch(BASE + chemin, {
    ...options,
    headers: { 'x-xposter-token': TOKEN, 'content-type': 'application/json', ...(options.headers || {}) },
  });

(async () => {
  let charge = {};
  if (action === 'programmer' || action === 'maintenant') charge = construireCharge();
  if (action === 'annuler') charge = { id: lire('id') };
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

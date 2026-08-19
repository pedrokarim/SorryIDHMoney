#!/usr/bin/env node
/*
 * xposter-server.js — Serveur local qui alimente le module de publication.
 *
 * Il ne fait qu'une chose : garder une file d'ordres que l'extension vient
 * chercher, et collecter ce qu'elle en rapporte. Il ne parle jamais a X, il
 * n'ouvre aucun navigateur, il ne connait aucun identifiant.
 *
 * Il ecoute sur 127.0.0.1 exclusivement — jamais 0.0.0.0. Un jeton est exige
 * a chaque requete. Sans lui, ce serveur serait une telecommande ouverte sur
 * un navigateur connecte, ce qui est exactement ce qu'il ne faut pas laisser
 * trainer sur une machine.
 *
 * Usage :
 *   node tools/xposter-server.js --token MONJETON [--port 8787]
 *
 * Puis, depuis un autre terminal :
 *   node tools/xposter-cli.js programmer --fichier post.json
 */

const http = require('http');

const args = process.argv.slice(2);
const lire = (nom, defaut) => {
  const i = args.indexOf('--' + nom);
  return i >= 0 && args[i + 1] ? args[i + 1] : defaut;
};

const PORT = parseInt(lire('port', '8787'), 10);
const TOKEN = lire('token', process.env.XPOSTER_TOKEN || '');

if (!TOKEN) {
  console.error('Refus de demarrer sans jeton. Passe --token, ou XPOSTER_TOKEN.');
  process.exit(1);
}

/** Ordres en attente que l'extension viendra chercher. */
const enAttente = [];
/** Resultats rapportes, indexes par identifiant d'ordre. */
const resultats = new Map();

const corps = (req) =>
  new Promise((resoudre, rejeter) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      // Les images voyagent en base64 : on plafonne, mais large.
      if (data.length > 40e6) rejeter(new Error('charge trop lourde'));
    });
    req.on('end', () => {
      try { resoudre(data ? JSON.parse(data) : {}); }
      catch (e) { rejeter(e); }
    });
  });

const json = (res, code, charge) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(charge));
};

const serveur = http.createServer(async (req, res) => {
  if (req.headers['x-xposter-token'] !== TOKEN) return json(res, 401, { erreur: 'jeton invalide' });

  const url = new URL(req.url, 'http://127.0.0.1');

  // L'extension vient chercher du travail.
  if (req.method === 'GET' && url.pathname === '/ordres') {
    const lot = enAttente.splice(0, enAttente.length);
    return json(res, 200, lot);
  }

  // L'extension rend compte.
  if (req.method === 'POST' && url.pathname === '/resultats') {
    const lot = await corps(req).catch(() => []);
    for (const r of lot) {
      resultats.set(r.id, r);
      console.log(r.ok ? '  ✓' : '  ✗', r.id, r.ok ? JSON.stringify(r.resultat) : r.erreur);
    }
    return json(res, 200, { recu: lot.length });
  }

  // Un outil local depose un ordre.
  if (req.method === 'POST' && url.pathname === '/ordre') {
    const ordre = await corps(req).catch(() => null);
    if (!ordre?.action) return json(res, 400, { erreur: 'action manquante' });
    ordre.id = ordre.id || `o${Date.now()}`;
    enAttente.push(ordre);
    console.log('→ depose', ordre.id, ordre.action);
    return json(res, 202, { id: ordre.id });
  }

  // Un outil local vient chercher la reponse a son ordre.
  if (req.method === 'GET' && url.pathname === '/resultat') {
    const id = url.searchParams.get('id');
    const r = resultats.get(id);
    if (!r) return json(res, 204, {});
    resultats.delete(id);
    return json(res, 200, r);
  }

  json(res, 404, { erreur: 'route inconnue' });
});

serveur.listen(PORT, '127.0.0.1', () => {
  console.log(`Pont XPoster sur http://127.0.0.1:${PORT} (127.0.0.1 uniquement)`);
  console.log('En attente de l extension. Elle sonde environ toutes les minutes.');
});

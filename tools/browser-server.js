#!/usr/bin/env node
/*
 * browser-server.js – Serveur local du pont navigateur.
 *
 * Il relaie, rien de plus : un outil dépose un ordre de lecture, l'extension
 * vient le chercher, l'exécute dans le navigateur et rend le résultat, que le
 * serveur remet à l'outil. Il n'ouvre aucun navigateur et ne lit aucune page
 * lui-même.
 *
 * Il écoute sur 127.0.0.1 exclusivement – jamais 0.0.0.0 – et exige un jeton
 * à chaque requête. Sans lui, ce serveur laisserait n'importe quel programme
 * de la machine lire les pages d'un navigateur connecté.
 *
 * Usage :
 *   node tools/browser-server.js --token MONJETON [--port 8788] [--idle 15]
 *
 * `--idle N` : s'arrête après N minutes sans ordre (0, le défaut : jamais).
 * Tant qu'il tourne, l'extension garde son service worker éveillé pour
 * répondre vite ; l'arrêter le laisse se rendormir.
 *
 * Au démarrage, le port et le jeton sont notés dans
 * ~/.sorryidhmoney/browser-bridge.json, pour que `browser-cli.js` marche
 * ensuite sans argument.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PORT = parseInt(option('port', process.env.BROWSER_BRIDGE_PORT || '8788'), 10);
const TOKEN = option('token', process.env.BROWSER_BRIDGE_TOKEN || '');
const IDLE_MINUTES = parseFloat(option('idle', '0'));

if (!TOKEN) {
  console.error('Refus de démarrer sans jeton. Passe --token, ou BROWSER_BRIDGE_TOKEN.');
  process.exit(1);
}

const STATE_FILE = path.join(os.homedir(), '.sorryidhmoney', 'browser-bridge.json');

/** Durée maximale pendant laquelle une sonde de l'extension est retenue. */
const MAX_HOLD_SECONDS = 25;

/** Ordres en attente que l'extension viendra chercher. */
const pending = [];
/** La sonde de l'extension actuellement retenue, s'il y en a une. */
let held = null;
/** Outils en attente d'un résultat, par identifiant d'ordre. */
const waiting = new Map();

let lastPollAt = 0;
let lastCommandAt = Date.now();

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      // Les captures voyagent en base64 : on plafonne, mais large.
      if (data.length > 60e6) reject(new Error('charge trop lourde'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (err) { reject(err); }
    });
  });

const send = (res, code, payload) => {
  if (res.writableEnded) return;
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
};

/** Remet à la sonde retenue tout ce qui attend, et la libère. */
function flush() {
  if (!held || pending.length === 0) return;
  clearTimeout(held.timer);
  send(held.res, 200, pending.splice(0, pending.length));
  held = null;
}

const server = http.createServer(async (req, res) => {
  if (req.headers['x-bridge-token'] !== TOKEN) return send(res, 401, { error: 'jeton invalide' });

  const url = new URL(req.url, 'http://127.0.0.1');

  // L'extension vient chercher du travail. Sans travail, on retient sa
  // requête : le premier ordre déposé repart aussitôt, sans attendre un tour.
  if (req.method === 'GET' && url.pathname === '/commands') {
    lastPollAt = Date.now();
    if (pending.length) return send(res, 200, pending.splice(0, pending.length));

    const hold = Math.min(MAX_HOLD_SECONDS, Math.max(0, parseInt(url.searchParams.get('wait') || '0', 10)));
    if (!hold) return send(res, 200, []);

    // Une seule sonde à la fois : la nouvelle remplace l'ancienne.
    if (held) { clearTimeout(held.timer); send(held.res, 200, []); }
    const current = { res, timer: setTimeout(() => { held = null; send(res, 200, []); }, hold * 1000) };
    held = current;
    req.on('close', () => { if (held === current) { clearTimeout(current.timer); held = null; } });
    return;
  }

  // L'extension rend compte.
  if (req.method === 'POST' && url.pathname === '/results') {
    const batch = await readBody(req).catch(() => []);
    for (const result of Array.isArray(batch) ? batch : []) {
      console.log(result.ok ? '  ✓' : '  ✗', result.id, result.ok ? '' : result.error);
      waiting.get(result.id)?.(result);
    }
    return send(res, 200, { received: batch.length || 0 });
  }

  // Un outil dépose un ordre et attend sa réponse sur la même requête.
  if (req.method === 'POST' && url.pathname === '/run') {
    const command = await readBody(req).catch(() => null);
    if (!command?.action) return send(res, 400, { error: 'action manquante' });

    const id = crypto.randomUUID();
    const timeoutSeconds = Math.min(600, Math.max(5, Number(command.timeout) || 90));
    lastCommandAt = Date.now();

    const timer = setTimeout(() => {
      waiting.delete(id);
      // Retiré de la file s'il n'est jamais parti : sinon l'extension
      // l'exécuterait plus tard, pour personne.
      const index = pending.findIndex((c) => c.id === id);
      if (index >= 0) pending.splice(index, 1);
      const seen = lastPollAt ? `vue il y a ${Math.round((Date.now() - lastPollAt) / 1000)} s` : 'jamais vue';
      send(res, 504, {
        ok: false,
        error: `pas de réponse en ${timeoutSeconds} s (extension ${seen}). `
          + 'Module coché, même jeton et même port dans les options ?',
      });
    }, timeoutSeconds * 1000);

    waiting.set(id, (result) => {
      clearTimeout(timer);
      waiting.delete(id);
      send(res, 200, result);
    });

    pending.push({ id, action: command.action, payload: command.payload || {} });
    console.log('→', id, command.action, command.payload?.url || command.payload?.tabId || '');
    flush();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/status') {
    const age = lastPollAt ? Date.now() - lastPollAt : null;
    return send(res, 200, {
      // Une sonde est retenue au plus 25 s : au-delà de 40 s sans nouvelles,
      // l'extension n'est plus là.
      extensionConnected: age !== null && age < 40000,
      lastPollSecondsAgo: age === null ? null : Math.round(age / 1000),
      pending: pending.length,
    });
  }

  send(res, 404, { error: 'route inconnue' });
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} déjà pris : un pont tourne déjà ?` : String(err));
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ port: PORT, token: TOKEN }, null, 2), { mode: 0o600 });

  console.log(`Pont navigateur sur http://127.0.0.1:${PORT} (127.0.0.1 uniquement)`);
  console.log('En attente de l\'extension : elle se présente en moins de trente secondes.');
});

if (IDLE_MINUTES > 0) {
  setInterval(() => {
    if (Date.now() - lastCommandAt > IDLE_MINUTES * 60000) {
      console.log(`Aucun ordre depuis ${IDLE_MINUTES} min : arrêt.`);
      process.exit(0);
    }
  }, 30000).unref();
}

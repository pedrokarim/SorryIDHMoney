#!/usr/bin/env node
/*
 * browser-cli.js – Lire le web à travers le navigateur, depuis un terminal.
 *
 * Fait pour être appelé par un outil ou une IA quand une requête directe se
 * fait refouler : la page est lue dans le vrai navigateur, avec sa session et
 * son JavaScript, puis rendue ici. Lecture seule.
 *
 * Usage :
 *   node tools/browser-cli.js read --url https://exemple.fr/article
 *   node tools/browser-cli.js read --url … --selector "main" --format text
 *   node tools/browser-cli.js read --tab 123 --json-ld --json
 *   node tools/browser-cli.js read --url … --scroll --frames   (défile d'abord, lit aussi les iframes)
 *   node tools/browser-cli.js query --url … --selector "h2 a" [--limit 20] [--html]
 *   node tools/browser-cli.js screenshot --url … [--selector ".prix"] --out capture.png
 *   node tools/browser-cli.js screenshot --url … --full --out page.png        (*)
 *   node tools/browser-cli.js inspect --url … [--filter /api/] [--bodies] [--headers] [--console]   (*)
 *   node tools/browser-cli.js inspect --tab 123 [--reload] [--duration 5]     (*)
 *   node tools/browser-cli.js storage --tab 123 [--filter token]              (**)
 *   node tools/browser-cli.js network --tab 123 [--filter /api/] [--types fetch,xmlhttprequest]
 *   node tools/browser-cli.js fetch --url https://exemple.fr/api/items.json
 *   node tools/browser-cli.js tabs
 *   node tools/browser-cli.js open --url …        (garde l'onglet, rend son tabId)
 *   node tools/browser-cli.js close --tab 123     (seulement un onglet ouvert par le pont)
 *   node tools/browser-cli.js status
 *
 * (*)  demande la case « Autoriser le débogueur » dans les options.
 * (**) demande la case « Autoriser la lecture du stockage ».
 *
 * Cible d'une lecture : `--url` (ouvre, lit, referme ; `--keep` pour garder),
 * `--tab ID` (un onglet déjà ouvert), ou rien (l'onglet actif).
 *
 * Options de lecture : --format markdown|text|html, --max N (caractères),
 * --wait-for "sélecteur", --active (ouvre au premier plan), --settle MS,
 * --scroll [N] (fait défiler jusqu'à N écrans avant de lire, 25 par défaut),
 * --frames (lit aussi les iframes).
 * Options du CLI : --json (réponse brute), --out FICHIER, --timeout S,
 * --token X, --port N.
 *
 * Le jeton et le port sont lus dans ~/.sorryidhmoney/browser-bridge.json, que
 * le serveur écrit à son premier lancement. S'il ne tourne pas, le CLI le
 * démarre lui-même en arrière-plan ; il s'arrête seul après 15 min sans ordre.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const [, , action, ...args] = process.argv;

/** Options qui règlent le CLI lui-même et ne partent pas dans l'ordre. */
const LOCAL_FLAGS = new Set(['token', 'port', 'out', 'json', 'timeout']);
/** Noms courts de la ligne de commande → champs de l'ordre. */
const ALIASES = { tab: 'tabId', max: 'maxChars' };

function parseFlags(list) {
  const flags = {};
  for (let i = 0; i < list.length; i++) {
    if (!list[i].startsWith('--')) continue;
    const name = list[i].slice(2);
    const next = list[i + 1];
    const hasValue = next !== undefined && !next.startsWith('--');
    flags[name] = hasValue ? next : true;
    if (hasValue) i++;
  }
  return flags;
}

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

const flags = parseFlags(args);

const STATE_FILE = path.join(os.homedir(), '.sorryidhmoney', 'browser-bridge.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* premier lancement */ }

const PORT = flags.port || process.env.BROWSER_BRIDGE_PORT || state.port || 8788;
const TOKEN = flags.token || process.env.BROWSER_BRIDGE_TOKEN || state.token || '';
const BASE = `http://127.0.0.1:${PORT}`;

const fail = (message) => { console.error(message); process.exit(1); };

if (!action) fail('Action manquante : read | query | screenshot | network | inspect | storage | fetch | tabs | open | close | status');
if (!TOKEN) {
  fail('Jeton manquant. Génère-le dans les options de l\'extension (Pont navigateur), puis lance une fois :\n'
    + '  node tools/browser-server.js --token LEJETON');
}

const call = (route, options = {}) =>
  fetch(BASE + route, {
    ...options,
    headers: { 'x-bridge-token': TOKEN, 'content-type': 'application/json' },
  });

/** Démarre le serveur en arrière-plan s'il ne répond pas. */
async function ensureServer() {
  try {
    await call('/status');
    return;
  } catch {
    // Pas de serveur : on le lance.
  }

  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'browser-server.js'), '--port', String(PORT), '--idle', '15'],
    {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      // Par l'environnement et non par un argument : la ligne de commande
      // d'un processus se lit depuis n'importe quel autre.
      env: { ...process.env, BROWSER_BRIDGE_TOKEN: TOKEN },
    },
  );
  child.unref();

  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try { await call('/status'); break; } catch { /* pas encore prêt */ }
  }
  console.error('pont démarré – l\'extension se présente en moins de 30 s…');
}

function buildPayload() {
  const payload = {};
  for (const [name, value] of Object.entries(flags)) {
    if (LOCAL_FLAGS.has(name)) continue;
    const key = ALIASES[name] || camel(name);
    payload[key] = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  }
  return payload;
}

(async () => {
  await ensureServer();

  if (action === 'status') {
    console.log(JSON.stringify(await (await call('/status')).json(), null, 2));
    return;
  }

  const payload = buildPayload();

  const response = await call('/run', {
    method: 'POST',
    body: JSON.stringify({ action, payload, timeout: Number(flags.timeout) || 90 }),
  });
  const answer = await response.json();

  if (!answer.ok) {
    // `exitCode` et non `process.exit` : sous Windows, sortir de force juste
    // après un `fetch` fait planter Node sur une assertion de libuv.
    console.error(`ÉCHEC : ${answer.error}`);
    process.exitCode = 1;
    return;
  }
  const result = answer.result;

  // Une capture ne s'affiche pas dans un terminal : on l'écrit sur disque et
  // on annonce le chemin plutôt que de déverser 2 Mo de base64.
  if (action === 'screenshot') {
    const out = path.resolve(flags.out || 'capture.png');
    fs.writeFileSync(out, Buffer.from(result.dataUrl.split(',')[1], 'base64'));
    console.log(JSON.stringify({ url: result.url, title: result.title, file: out }, null, 2));
    return;
  }

  // Le texte seul sur la sortie standard, pour qu'il se lise et se redirige
  // tel quel ; ce qui l'entoure part sur la sortie d'erreur.
  let output = JSON.stringify(result, null, 2);
  if (!flags.json && (action === 'read' || action === 'fetch')) {
    const text = action === 'read' ? result.content : result.body;
    if (typeof text === 'string') {
      const { content, body, frames, ...summary } = result;
      if (frames) summary.frames = frames.length;
      console.error(JSON.stringify(summary));
      output = text;
      // Les cadres à la suite, chacun annoncé par son adresse.
      for (const frame of frames || []) output += `

--- cadre : ${frame.url} ---

${frame.content}`;
    }
  }

  if (flags.out) {
    fs.writeFileSync(flags.out, output);
    console.error('écrit :', path.resolve(flags.out));
  } else {
    console.log(output);
  }
})().catch((err) => { console.error(String(err.message || err)); process.exitCode = 1; });

/*
 * xposter-bridge.js — Porte d'entree locale du module de publication.
 *
 * L'extension **sonde** un petit serveur qui tourne sur la machine et execute
 * ce qu'il lui donne. Le sens compte : c'est l'extension qui appelle, jamais
 * l'inverse. Rien n'ecoute du cote de l'extension, aucun port n'est ouvert.
 *
 * Sondage HTTP et non WebSocket : en MV3 le service worker est arrete des
 * qu'il n'a rien a faire, donc une connexion permanente ne tient pas. Une
 * alarme le reveille chaque minute, il demande s'il y a du travail, il rend
 * la reponse. Une minute d'attente n'a aucune importance pour programmer une
 * publication, et ca evite d'implementer le protocole WebSocket a la main.
 *
 * Trois gardes, dans cet ordre :
 *   1. le module est coupe par defaut, il faut le cocher dans les options ;
 *   2. sans jeton renseigne, on ne contacte meme pas le serveur ;
 *   3. seules les actions de la liste blanche sont executees — jamais de code
 *      arbitraire.
 */

import { programmer, annuler, lister, executer } from './xposter-queue.js';

const LOG = '[XPoster]';
const ALARME_VEILLE = 'xposter:veille';

const REGLAGES = {
  enableXPoster: false,
  xposterPort: 8787,
  xposterToken: '',
};

async function reglages() {
  return new Promise((r) => chrome.storage.sync.get(REGLAGES, r));
}

/** Actions autorisees. Tout le reste est refuse et journalise. */
const ACTIONS = {
  ping: async () => ({ pong: true, version: 1 }),
  programmer: async (charge) => programmer(charge),
  annuler: async (charge) => annuler(charge.id),
  lister: async () => lister(),
  /** Compose tout de suite, sans passer par la file. */
  maintenant: async (charge) =>
    executer({
      texte: charge.texte || '',
      images: charge.images || [],
      alts: charge.alts || [],
      publier: charge.publier === true,
    }),
};

async function traiter(ordre) {
  const fn = ACTIONS[ordre.action];
  if (!fn) {
    console.warn(LOG, 'action refusee :', ordre.action);
    return { id: ordre.id, ok: false, erreur: `action inconnue : ${ordre.action}` };
  }
  try {
    return { id: ordre.id, ok: true, resultat: await fn(ordre.charge || {}) };
  } catch (err) {
    return { id: ordre.id, ok: false, erreur: String(err.message || err) };
  }
}

/** Un tour de sonde : demander, executer, rendre compte. */
export async function sonder() {
  const cfg = await reglages();
  if (!cfg.enableXPoster || !cfg.xposterToken) return;

  const base = `http://127.0.0.1:${cfg.xposterPort}`;
  let ordres;

  try {
    const rep = await fetch(`${base}/ordres`, {
      headers: { 'x-xposter-token': cfg.xposterToken },
    });
    if (!rep.ok) return;
    ordres = await rep.json();
  } catch {
    // Serveur eteint : c'est le cas normal la plupart du temps, on se tait.
    return;
  }

  if (!Array.isArray(ordres) || ordres.length === 0) return;

  const resultats = [];
  for (const ordre of ordres) resultats.push(await traiter(ordre));

  try {
    await fetch(`${base}/resultats`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-xposter-token': cfg.xposterToken,
      },
      body: JSON.stringify(resultats),
    });
  } catch (err) {
    console.error(LOG, 'resultats non remis', err);
  }
}

export function installerVeille() {
  chrome.alarms.create(ALARME_VEILLE, { periodInMinutes: 1 });
}

export function estVeille(alarme) {
  return alarme.name === ALARME_VEILLE;
}

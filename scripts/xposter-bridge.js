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

import { schedule, cancel, list, execute, captureComposer, replay } from './xposter-queue.js';
import { fetchTweets, scheduledAtX } from './xposter-tweets.js';

const LOG = '[XPoster]';
const IDLE_ALARM = 'xposter:veille';

const SETTINGS_DEFAULTS = {
  enableXPoster: false,
  xposterPort: 8787,
  xposterToken: '',
};

async function settings() {
  return new Promise((r) => chrome.storage.sync.get(SETTINGS_DEFAULTS, r));
}

/** Actions autorisees. Tout le reste est refuse et journalise. */
const ACTIONS = {
  ping: async () => ({ pong: true, version: 1 }),
  programmer: async (charge) => schedule(charge),
  annuler: async (charge) => cancel(charge.id),
  lister: async () => list(),
  /**
   * Rend une capture de l onglet visible.
   *
   * C est ce qui permet de constater l etat reel du composeur au lieu de le
   * deduire d un rapport : un remplissage peut se dire reussi et avoir
   * produit quelque chose de tordu.
   */
  capturer: () => captureComposer(),

  /** Rejoue une publication de l historique, sans la redeposer. */
  relancer: (charge) => replay(charge.id),

  /*
   * Relit le fil publie. Strictement en lecture : sans session ouverte, X ne
   * montre que cinq posts puis un mur, et il devient impossible de savoir ce
   * qui est deja parti.
   */
  tweets: (charge) => fetchTweets(charge),

  /** Ce que X garde en attente : invisible partout ailleurs. */
  programmes: () => scheduledAtX(),

  /** Compose tout de suite, sans passer par la file. */
  maintenant: async (charge) =>
    execute({
      texte: charge.texte || '',
      images: charge.images || [],
      alts: charge.alts || [],
      publier: charge.publier === true,
    }),
};

async function handle(ordre) {
  const fn = ACTIONS[ordre.action];
  if (!fn) {
    console.warn(LOG, 'action refusee :', ordre.action);
    return { id: ordre.id, ok: false, erreur: `action inconnue : ${ordre.action}` };
  }
  try {
    return { id: ordre.id, ok: true, result: await fn(ordre.charge || {}) };
  } catch (err) {
    return { id: ordre.id, ok: false, erreur: String(err.message || err) };
  }
}

/** Un tour de sonde : demander, executer, rendre compte. */
export async function poll() {
  const cfg = await settings();
  if (!cfg.enableXPoster || !cfg.xposterToken) return;

  const base = `http://127.0.0.1:${cfg.xposterPort}`;
  let ordres;

  try {
    const rep = await fetch(`${base}/ordres`, {
      headers: { 'x-xposter-token': cfg.xposterToken },
    });
    if (!rep.ok) return;
    ordres = await rep.json();
    // Trace du dernier echange reussi : c'est elle, et rien d'autre, qui
    // permet a la popup de dire « connecte ». Un booleen mentirait des que le
    // serveur s'arrete sans prevenir.
    await chrome.storage.local.set({ xposterDernierContact: Date.now() });
  } catch {
    // Serveur eteint : c'est le cas normal la plupart du temps, on se tait.
    return;
  }

  if (!Array.isArray(ordres) || ordres.length === 0) return;

  const results = [];
  for (const ordre of ordres) results.push(await handle(ordre));

  try {
    await fetch(`${base}/resultats`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-xposter-token': cfg.xposterToken,
      },
      body: JSON.stringify(results),
    });
  } catch (err) {
    console.error(LOG, 'resultats non remis', err);
  }
}

export function installIdlePoll() {
  chrome.alarms.create(IDLE_ALARM, { periodInMinutes: 1 });
}

export function isIdleAlarm(alarm) {
  return alarm.name === IDLE_ALARM;
}

/*
 * xposter-queue.js — File d'attente et horloge, cote service worker.
 *
 * La file vit dans l'extension, pas dans l'outil qui l'alimente. C'est
 * volontaire : une publication programmee pour demain 14 h doit partir meme
 * si l'outil qui l'a deposee n'a pas ete relance. Tant que le navigateur
 * tourne, l'extension suffit.
 *
 * `chrome.alarms` et non `setTimeout` : en MV3 le service worker est arrete
 * des qu'il n'a rien a faire, et un `setTimeout` meurt avec lui. Une alarme,
 * elle, reveille le worker a l'heure dite.
 */

const LOG = '[XPoster]';
const QUEUE_KEY = 'xposterFile';
const ALARM_PREFIX = 'xposter:';

/** Delai minimal d'une alarme MV3. En dessous, Chrome l'ignore. */
const MIN_ALARM_MINUTES = 0.5;

/**
 * Au-dela de ce retard, une echeance manquee n'est plus rattrapee.
 *
 * Une heure de publication est un choix, pas une approximation : la poster
 * six heures plus tard parce que la machine etait eteinte, c'est publier
 * ailleurs que la ou on visait — de nuit, ou devant personne.
 */
const MAX_LATENESS_MS = 30 * 60 * 1000;

/**
 * Au-dela, une echeance qui n'a jamais rendu de rapport est abandonnee.
 *
 * Voir `keepWorkerAwake` : une composition qui tue le worker ne peut pas ecrire
 * son propre echec, et `rearm` la relance au demarrage suivant. Sans ce
 * compteur, elle rouvre le composeur indefiniment.
 */
const MAX_ATTEMPTS = 2;

/**
 * Tient le service worker eveille le temps d'une composition.
 *
 * En MV3, Chrome arrete le worker apres trente secondes sans activite. Une
 * composition en demande bien davantage : X met parfois pres d'une minute a
 * monter une image, et « Add description » n'apparait qu'ensuite — d'ou les
 * attentes longues de `xposter-content.js`, qui cumulent jusqu'a soixante-
 * quinze secondes.
 *
 * Le worker mourait donc au milieu de `sendMessage`. Symptomes observes le
 * 24/08, tous le meme : « A listener indicated an asynchronous response by
 * returning true, but the message channel closed before a response was
 * received », puis l'entree restant « en attente » — le `catch` qui ecrit
 * l'echec n'ayant jamais eu lieu — et `rearm` la relancant au demarrage
 * suivant, qui tuait le worker a son tour. Le composeur se rouvrait en
 * boucle, visible dans la barre d'adresse.
 *
 * Un appel a une API chrome remet le compte a rebours a zero. On en passe un
 * toutes les vingt secondes, et on relache des que la composition rend la
 * main. `setInterval` suffit ici, contrairement a une echeance lointaine :
 * ce battement ne doit vivre que tant que le worker vit, et c'est lui qui
 * l'entretient.
 */
function keepWorkerAwake() {
  const heartbeat = setInterval(() => {
    chrome.runtime.getPlatformInfo().catch(() => {});
  }, 20000);
  return () => clearInterval(heartbeat);
}

async function readQueue() {
  const { [QUEUE_KEY]: queue } = await chrome.storage.local.get({ [QUEUE_KEY]: [] });
  return queue;
}

async function writeQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

/** Ajoute une publication et arme son reveil. */
export async function schedule(entry) {
  const queue = await readQueue();

  const id = entry.id || `p${Date.now()}${Math.floor(performance.now() % 1000)}`;
  const quand = entry.quand ? new Date(entry.quand).getTime() : Date.now();

  /*
   * Qui tient l'horloge : l'extension, ou X.
   *
   * L'extension programme avec une alarme locale. La publication ne part que
   * si la machine tourne, et c'est le navigateur qui compose a l'heure dite —
   * donc depuis le compte connecte a ce moment-la.
   *
   * X programme sur ses serveurs. On compose tout de suite, on renseigne son
   * formulaire d'horaire, et le post part meme machine eteinte. C'est plus
   * sur pour une heure fixe, au prix d'un composeur ouvert maintenant.
   */
  const { xposterModeProgrammation } = await new Promise((r) =>
    chrome.storage.sync.get({ xposterModeProgrammation: 'extension' }, r)
  );
  const programmation = entry.programmation || xposterModeProgrammation;

  const post = {
    id,
    quand,
    programmation,
    texte: entry.texte || '',
    images: entry.images || [],
    alts: entry.alts || [],
    publier: entry.publier === true,
    etat: 'en attente',
    depose: Date.now(),
  };

  queue.push(post);
  await writeQueue(queue);

  if (programmation === 'x') {
    // Aucune alarme : l'echeance part chez X, tout de suite. Garder un reveil
    // en plus reposterait le meme contenu a l'heure dite.
    const rapport = await execute(post);
    /*
     * Le compte rendu du composeur est imbrique : `{ ok, rapport }`. On lisait
     * `rapport.programme` au premier niveau, donc toujours `undefined` — la
     * file affichait « preparee » pour des publications que X gardait bel et
     * bien. Le seul degat etait un etat faux, mais c est precisement ce dont
     * on se sert pour savoir quoi refaire.
     */
    post.etat = rapport?.rapport?.programme
      ? 'confie a X'
      : rapport?.ok ? 'prepare' : 'echec';
    post.rapport = rapport;
    post.execute = Date.now();
    await writeQueue(queue);
    console.log(LOG, 'confie a X', id, new Date(quand).toISOString());
    return { id, quand, programmation, rapport };
  }

  const minutes = Math.max(MIN_ALARM_MINUTES, (quand - Date.now()) / 60000);
  await chrome.alarms.create(ALARM_PREFIX + id, { delayInMinutes: minutes });

  console.log(LOG, 'programme', id, new Date(quand).toISOString());
  return { id, quand, programmation };
}

export async function cancel(id) {
  const queue = await readQueue();
  await writeQueue(queue.filter((p) => p.id !== id));
  await chrome.alarms.clear(ALARM_PREFIX + id);
  return true;
}

/**
 * Une copie sans les octets.
 *
 * Une image de 3,5 Mo pese 4,7 Mo une fois en base64. Le stockage local de
 * l'extension plafonne a 10 Mo : vingt entrees d'historique en auraient
 * reclame quatre-vingt-quinze. L'ecriture aurait echoue — et elle emporte la
 * file entiere, publications en attente comprises.
 *
 * Les octets ne servaient qu'a la composition. Une fois celle-ci passee,
 * savoir combien d'images sont parties suffit a l'historique.
 */
const withoutBytes = (p) => ({
  ...p,
  images: [],
  nbImages: (p.images || []).length || p.nbImages || 0,
});

export async function list() {
  // Un inventaire repart par le pont : il n'a pas a transporter les images.
  return (await readQueue()).map(withoutBytes);
}

/**
 * Trouve un onglet de composition, ou en ouvre un.
 *
 * On vise `/compose/post` : la page de composition dediee est bien plus
 * stable que le composeur en surimpression du fil, qui n'existe qu'apres un
 * clic et disparait au moindre changement de route.
 */
async function composerTab() {
  const existing = await chrome.tabs.query({ url: ['https://x.com/compose/post*', 'https://twitter.com/compose/post*'] });

  /*
   * On ne reutilise qu'un composeur vide.
   *
   * Plusieurs publications rapprochees et laissees a valider a la main
   * cohabitent : la deuxieme trouvait l'onglet de la premiere, encore en
   * attente d'un clic, et la composition commence par vider la zone. Le
   * premier post disparaissait — texte, image et alternative — sans que rien
   * ne le signale.
   *
   * Un onglet qui ne repond pas est compte comme occupe : ne pas savoir n'est
   * pas une raison d'ecrire dedans.
   */
  for (const tab of existing) {
    let free = false;
    try {
      const etat = await chrome.tabs.sendMessage(tab.id, { action: 'xposterEtat' });
      free = etat?.vide === true;
    } catch {
      free = false;
    }
    if (free) {
      await chrome.tabs.update(tab.id, { active: true });
      return tab;
    }
  }

  const tab = await chrome.tabs.create({ url: 'https://x.com/compose/post', active: true });

  // On attend que le content script soit en place : il repond a un ping.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const etat = await chrome.tabs.get(tab.id);
      if (etat.status === 'complete') break;
    } catch {
      throw new Error('onglet ferme avant la composition');
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  return tab;
}

/**
 * Rejoue une publication deja executee.
 *
 * Une composition peut partir de travers sans que rien n'ait echoue : le
 * navigateur etait sur un autre compte, une image n'a pas suivi. Le rapport
 * dit « prepare », et pourtant c'est a refaire. Rejouer evite de redeposer
 * la charge depuis l'outil — ce qui suppose d'avoir garde le fichier.
 *
 * On ne duplique pas l'entree : on la reexecute et on note le nouveau
 * resultat. L'historique dit ou en est chaque publication, pas combien de
 * fois on s'y est repris.
 */
export async function replay(id) {
  const queue = await readQueue();
  const post = queue.find((p) => p.id === id);
  if (!post) throw new Error('publication introuvable');
  if (!post.images?.length && post.nbImages) {
    // Les octets ont ete purges : rejouer produirait un post ampute, ce qui
    // est pire que de refuser.
    throw new Error('images purgees de l historique — redeposer depuis l outil');
  }

  const rapport = await execute(post);
  /*
   * Meme lecture qu'au depot : `programme` vit dans `rapport.rapport`, pas au
   * premier niveau. La correction du 20/08 avait ete posee sur le chemin du
   * depot seulement — relancer une echeance confiee a X la reclassait donc en
   * « preparee », alors que X l'avait gardee. Un etat faux ici est couteux :
   * c'est exactement ce qu'on regarde pour decider quoi refaire.
   */
  post.etat = rapport?.rapport?.programme
    ? 'confie a X'
    : rapport?.ok ? (post.publier ? 'publie' : 'prepare') : 'echec';
  post.rapport = rapport;
  post.execute = Date.now();
  // Une relance a la main repart d'une ardoise propre : le compteur ne sert
  // qu'a arreter les reveils en boucle, pas a brider une decision humaine.
  post.attempts = 0;
  await writeQueue(queue);
  return rapport;
}

/**
 * Repose les reveils a partir de la file.
 *
 * Recharger l'extension efface ses alarmes, pas son stockage : la file
 * continuait d'afficher une publication « en attente » que plus rien ne
 * devait reveiller. Un redemarrage du navigateur les repose donc toutes.
 *
 * Une echeance largement depassee n'est pas rattrapee en silence, elle est
 * marquee manquee. Le contraire — publier a l'improviste des heures apres
 * l'heure choisie — serait une surprise, et une mauvaise.
 */
export async function rearm() {
  const queue = await readQueue();
  let changed = false;

  for (const post of queue) {
    if (post.etat !== 'en attente') continue;

    /*
     * Une echeance confiee a X n'a jamais de reveil : la remise se fait au
     * depot, et le depot seul. La trouver « en attente » ne veut donc pas
     * dire qu'elle attend son heure, mais que la composition n'a jamais rendu
     * son rapport — worker arrete en cours de route.
     *
     * On lui posait pourtant une alarme, faute de regarder `programmation`.
     * Au reveil elle recomposait tout, tuait le worker a son tour, et restait
     * « en attente » pour le demarrage suivant : c'est cette boucle qui
     * rouvrait le composeur sans fin le 24/08. Le commentaire du depot le
     * disait deja — « garder un reveil en plus reposterait le meme contenu ».
     *
     * On la marque donc en echec. Elle reste visible et relancable a la main,
     * ce qui est le bon niveau de decision : personne ne sait ici si X a
     * garde quelque chose avant la coupure.
     */
    if (post.programmation === 'x') {
      post.etat = 'echec';
      post.execute = Date.now();
      post.rapport = {
        ok: false,
        erreur: 'composition interrompue — verifier chez X avant de relancer',
      };
      changed = true;
      console.warn(LOG, 'interrompue', post.id);
      continue;
    }

    const lateness = Date.now() - post.quand;
    if (lateness > MAX_LATENESS_MS) {
      post.etat = 'manquee';
      post.execute = Date.now();
      post.rapport = {
        ok: false,
        erreur: `echeance depassee de ${Math.round(retard / 60000)} min — navigateur eteint ?`,
      };
      changed = true;
      console.warn(LOG, 'manquee', post.id);
      continue;
    }

    await chrome.alarms.create(ALARM_PREFIX + post.id, {
      delayInMinutes: Math.max(MIN_ALARM_MINUTES, (post.quand - Date.now()) / 60000),
    });
  }

  if (changed) await writeQueue(queue);
  return queue.filter((p) => p.etat === 'en attente').length;
}

/**
 * Photographie le composeur.
 *
 * `captureVisibleTab` ne sait photographier que l'onglet actif d'une fenetre.
 * Depuis le service worker c'est le plus souvent le bon ; depuis une page de
 * l'extension, c'est cette page elle-meme — le bouton se prenait en photo.
 * On designe donc l'onglet, et on le remet au premier plan de sa fenetre le
 * temps du cliche.
 *
 * On n'ouvre pas de composeur s'il n'y en a pas : demander a voir n'est pas
 * demander a ecrire.
 */
export async function captureComposer() {
  const tabs = await chrome.tabs.query({
    // Apres remplissage, X peut avoir change d URL sans fermer le composeur :
    // on regarde donc tout x.com, et on prefere une route de composition.
    url: ['https://x.com/*', 'https://twitter.com/*'],
  });
  if (!tabs.length) throw new Error('aucun onglet X ouvert');
  tabs.sort((a, b) => (b.url.includes('/compose/') ? 1 : 0) - (a.url.includes('/compose/') ? 1 : 0));

  const tab = tabs[0];
  if (!tab.active) {
    await chrome.tabs.update(tab.id, { active: true });
    // Le passage au premier plan n'est pas instantane : sans ce delai, le
    // cliche montre encore l'onglet precedent.
    await new Promise((r) => setTimeout(r, 250));
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  return { dataUrl, url: tab.url };
}

/**
 * Execute une publication : ouvre le composeur et lui passe la charge.
 *
 * Le clic final est soumis a une autorisation globale, decochee par defaut.
 * Une demande peut reclamer la publication tant qu'elle veut : sans cette
 * case, l'extension se contente de preparer et laisse la main. C'est le seul
 * garde-fou qui ne depende pas de ce qu'on lui envoie.
 */
export async function execute(post) {
  // L'ouverture de l'onglet compte deja pres de vingt secondes avant meme la
  // composition : le battement couvre toute la fonction, pas le seul envoi.
  const release = keepWorkerAwake();
  try {
    return await executeInternal(post);
  } finally {
    release();
  }
}

async function executeInternal(post) {
  const { xposterAutoriserPublication, xposterComptes } = await new Promise((r) =>
    chrome.storage.sync.get({ xposterAutoriserPublication: false, xposterComptes: [] }, r)
  );

  const publier = post.publier === true && xposterAutoriserPublication === true;
  if (post.publier && !publier) {
    console.warn(LOG, 'publication demandee mais non autorisee — preparation seule');
  }

  const tab = await composerTab();

  const rapport = await chrome.tabs.sendMessage(tab.id, {
    action: 'xposterComposer',
    charge: {
      texte: post.texte,
      images: post.images,
      alts: post.alts,
      publier,
      // La liste vit dans les reglages, jamais dans la charge : une demande ne
      // doit pas pouvoir s'autoriser elle-meme un compte.
      comptesAutorises: xposterComptes,
      // Heure voulue, transmise seulement quand c'est X qui doit programmer.
      programmerLe: post.programmation === 'x' ? post.quand : null,
    },
  });

  return rapport;
}

/** Reveil : retrouve la publication, l'execute, note le resultat. */
export async function onAlarm(alarm) {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const id = alarm.name.slice(ALARM_PREFIX.length);

  const queue = await readQueue();
  const post = queue.find((p) => p.id === id);
  if (!post) return;

  /*
   * On compte l'essai avant de le tenter, et on l'ecrit immediatement.
   *
   * L'ordre n'est pas un detail : c'est precisement parce que le resultat
   * s'ecrit apres coup qu'un worker tue en cours de route ne laisse aucune
   * trace. Un compteur pose apres l'appel aurait le meme sort, et la boucle
   * qu'il doit arreter le remettrait a zero a chaque tour.
   */
  post.attempts = (post.attempts || 0) + 1;
  if (post.attempts > MAX_ATTEMPTS) {
    post.etat = 'echec';
    post.execute = Date.now();
    post.rapport = {
      ok: false,
      erreur: `abandonnee apres ${MAX_ATTEMPTS} tentatives — le composeur n a jamais rendu son rapport`,
    };
    await writeQueue(queue);
    console.warn(LOG, 'abandon', id);
    return;
  }
  await writeQueue(queue);

  try {
    const rapport = await execute(post);
    post.etat = rapport?.ok
      ? (post.publier ? 'publie' : 'prepare')
      : 'echec';
    post.rapport = rapport;
  } catch (err) {
    // On garde l'entree en echec plutot que de la supprimer : sans trace,
    // une publication ratee disparait sans que personne ne le sache.
    post.etat = 'echec';
    post.rapport = { ok: false, erreur: String(err.message || err) };
    console.error(LOG, 'echec', id, err);
  }

  post.execute = Date.now();

  // On garde les vingt dernieres executions et tout ce qui attend encore :
  // sans purge, la file grossit indefiniment dans le stockage local.
  const pending = queue.filter((p) => p.etat === 'en attente');
  /*
   * Les trois dernieres executions gardent leurs octets, les suivantes non.
   *
   * Tout alleger rendait le bouton « relancer » inutile : une publication
   * partie de travers — mauvais compte, image manquante — ne pouvait plus
   * etre rejouee, faute d'images a rejouer. Trois entrees completes pesent
   * une quinzaine de mega-octets, ce qui tient largement, et couvrent le cas
   * reel : on relance ce qui vient d'echouer, pas ce qui date de trois
   * semaines.
   */
  const done = queue
    .filter((p) => p.etat !== 'en attente')
    .sort((a, b) => (b.execute || 0) - (a.execute || 0))
    .slice(0, 20)
    .map((p, rang) => (rang < 3 ? p : withoutBytes(p)));

  await writeQueue([...pending, ...done]);
}

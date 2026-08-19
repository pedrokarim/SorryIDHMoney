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
const CLE_FILE = 'xposterFile';
const PREFIXE_ALARME = 'xposter:';

/** Delai minimal d'une alarme MV3. En dessous, Chrome l'ignore. */
const MINUTE_MIN = 0.5;

async function lireFile() {
  const { [CLE_FILE]: file } = await chrome.storage.local.get({ [CLE_FILE]: [] });
  return file;
}

async function ecrireFile(file) {
  await chrome.storage.local.set({ [CLE_FILE]: file });
}

/** Ajoute une publication et arme son reveil. */
export async function programmer(entree) {
  const file = await lireFile();

  const id = entree.id || `p${Date.now()}${Math.floor(performance.now() % 1000)}`;
  const quand = entree.quand ? new Date(entree.quand).getTime() : Date.now();

  const publication = {
    id,
    quand,
    texte: entree.texte || '',
    images: entree.images || [],
    alts: entree.alts || [],
    publier: entree.publier === true,
    etat: 'en attente',
    depose: Date.now(),
  };

  file.push(publication);
  await ecrireFile(file);

  const minutes = Math.max(MINUTE_MIN, (quand - Date.now()) / 60000);
  await chrome.alarms.create(PREFIXE_ALARME + id, { delayInMinutes: minutes });

  console.log(LOG, 'programme', id, new Date(quand).toISOString());
  return { id, quand };
}

export async function annuler(id) {
  const file = await lireFile();
  await ecrireFile(file.filter((p) => p.id !== id));
  await chrome.alarms.clear(PREFIXE_ALARME + id);
  return true;
}

export async function lister() {
  return lireFile();
}

/**
 * Trouve un onglet de composition, ou en ouvre un.
 *
 * On vise `/compose/post` : la page de composition dediee est bien plus
 * stable que le composeur en surimpression du fil, qui n'existe qu'apres un
 * clic et disparait au moindre changement de route.
 */
async function ongletComposeur() {
  const existants = await chrome.tabs.query({ url: ['https://x.com/compose/post*', 'https://twitter.com/compose/post*'] });
  if (existants.length) {
    await chrome.tabs.update(existants[0].id, { active: true });
    return existants[0];
  }

  const onglet = await chrome.tabs.create({ url: 'https://x.com/compose/post', active: true });

  // On attend que le content script soit en place : il repond a un ping.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const etat = await chrome.tabs.get(onglet.id);
      if (etat.status === 'complete') break;
    } catch {
      throw new Error('onglet ferme avant la composition');
    }
  }
  await new Promise((r) => setTimeout(r, 1500));
  return onglet;
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
export async function capturerComposeur() {
  const onglets = await chrome.tabs.query({
    url: ['https://x.com/compose/post*', 'https://twitter.com/compose/post*'],
  });
  if (!onglets.length) throw new Error('aucun composeur ouvert');

  const onglet = onglets[0];
  if (!onglet.active) {
    await chrome.tabs.update(onglet.id, { active: true });
    // Le passage au premier plan n'est pas instantane : sans ce delai, le
    // cliche montre encore l'onglet precedent.
    await new Promise((r) => setTimeout(r, 250));
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(onglet.windowId, { format: 'png' });
  return { dataUrl, url: onglet.url };
}

/**
 * Execute une publication : ouvre le composeur et lui passe la charge.
 *
 * Le clic final est soumis a une autorisation globale, decochee par defaut.
 * Une demande peut reclamer la publication tant qu'elle veut : sans cette
 * case, l'extension se contente de preparer et laisse la main. C'est le seul
 * garde-fou qui ne depende pas de ce qu'on lui envoie.
 */
export async function executer(publication) {
  const { xposterAutoriserPublication } = await new Promise((r) =>
    chrome.storage.sync.get({ xposterAutoriserPublication: false }, r)
  );

  const publier = publication.publier === true && xposterAutoriserPublication === true;
  if (publication.publier && !publier) {
    console.warn(LOG, 'publication demandee mais non autorisee — preparation seule');
  }

  const onglet = await ongletComposeur();

  const rapport = await chrome.tabs.sendMessage(onglet.id, {
    action: 'xposterComposer',
    charge: {
      texte: publication.texte,
      images: publication.images,
      alts: publication.alts,
      publier,
    },
  });

  return rapport;
}

/** Reveil : retrouve la publication, l'execute, note le resultat. */
export async function surAlarme(alarme) {
  if (!alarme.name.startsWith(PREFIXE_ALARME)) return;
  const id = alarme.name.slice(PREFIXE_ALARME.length);

  const file = await lireFile();
  const publication = file.find((p) => p.id === id);
  if (!publication) return;

  try {
    const rapport = await executer(publication);
    publication.etat = rapport?.ok
      ? (publication.publier ? 'publie' : 'prepare')
      : 'echec';
    publication.rapport = rapport;
  } catch (err) {
    // On garde l'entree en echec plutot que de la supprimer : sans trace,
    // une publication ratee disparait sans que personne ne le sache.
    publication.etat = 'echec';
    publication.rapport = { ok: false, erreur: String(err.message || err) };
    console.error(LOG, 'echec', id, err);
  }

  publication.execute = Date.now();

  // On garde les vingt dernieres executions et tout ce qui attend encore :
  // sans purge, la file grossit indefiniment dans le stockage local.
  const attente = file.filter((p) => p.etat === 'en attente');
  const finies = file
    .filter((p) => p.etat !== 'en attente')
    .sort((a, b) => (b.execute || 0) - (a.execute || 0))
    .slice(0, 20);

  await ecrireFile([...attente, ...finies]);
}

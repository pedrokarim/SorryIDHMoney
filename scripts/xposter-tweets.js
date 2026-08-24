/*
 * xposter-tweets.js — Relire ce qui a deja ete publie.
 *
 * X ne montre que cinq posts a qui n'est pas connecte, puis un mur « Continuer
 * sur X ». Impossible, depuis l'exterieur, de savoir ce qui est parti et ce
 * qui attend encore.
 *
 * L'extension, elle, travaille dans le navigateur de Karim, ou la session est
 * ouverte. Elle voit le fil entier. C'est le seul interet de ce module : la
 * page est deja la, il suffit de la lire.
 *
 * **Strictement en lecture.** Aucun clic, aucun champ rempli, aucune requete
 * a l'API de X. On ouvre une page publique, on fait defiler, on note ce qui
 * s'affiche, on referme. Rien de ce qui est ici ne peut publier quoi que ce
 * soit.
 */

const LOG = '[XPoster]';

/** La page ou X garde ce qu il doit publier plus tard. */
const SCHEDULED_URL = 'https://x.com/compose/post/unsent/scheduled';

/** Au-dela, on rend ce qu'on a plutot que de faire defiler indefiniment. */
const MAX_ROUNDS = 150;

/**
 * Le releve, execute dans la page.
 *
 * Cette fonction ne voit rien de l'extension : elle est serialisee puis
 * injectee. Tout ce dont elle a besoin passe par ses arguments, et ce qu'elle
 * rend doit survivre a un JSON.
 *
 * Le fil de X est virtualise — les posts sortis de l'ecran sont retires du
 * DOM. On releve donc a chaque tour et on accumule dans une table, sinon on
 * ne garderait que le bas de la page.
 */
function readFromPage(maxRounds, cap) {
  const seen = new Map();

  const record = () => {
    for (const article of document.querySelectorAll('article')) {
      const link = [...article.querySelectorAll('a')]
        .map((a) => a.getAttribute('href') || '')
        .find((h) => /\/status\/\d+/.test(h));
      if (!link) continue;

      const id = link.match(/\/status\/(\d+)/)[1];
      if (seen.has(id)) continue;

      const balise = article.querySelector('time[datetime]');
      const texte = article.querySelector('[data-testid="tweetText"]');
      const brut = article.innerText || '';

      seen.set(id, {
        id,
        link: 'https://x.com' + link.split('/photo/')[0],
        date: balise ? balise.getAttribute('datetime') : null,
        dateAffichee: balise ? balise.textContent : null,
        texte: texte ? texte.innerText : '',
        // Le compte apparait dans le lien : un repost pointe ailleurs.
        auteur: (link.match(/^\/([^/]+)\//) || [])[1] || '',
        reponse: /En r[ée]ponse [àa]|Replying to/.test(brut),
        repost: /a reposté|reposted/i.test(brut),
        // Les testids de X bougent : on compte aussi les images servies par
        // leur CDN media, qui est la chose la plus stable de cette page.
        medias: new Set(
          [
            ...article.querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="tweetPhoto"] video'),
            ...article.querySelectorAll('img[src*="/media/"], video'),
          ].map((n) => n.getAttribute('src') || n.getAttribute('poster') || n)
        ).size,
      });
    }
  };

  return (async () => {
    let stagne = 0;

    for (let round = 0; round < maxRounds; round++) {
      const avant = seen.size;
      record();
      if (cap && seen.size >= cap) break;

      /*
       * Par petits pas, et surtout pas jusqu'en bas d'un coup.
       *
       * Un saut a `scrollHeight` traverse la liste virtualisee sans lui
       * laisser le temps de monter ce qu'elle enjambe : le releve gardait les
       * posts du haut et ceux du bas, et perdait tout un bloc au milieu sans
       * que rien ne le signale — la periode couverte avait l'air complete.
       */
      window.scrollBy(0, window.innerHeight * 0.7);
      await new Promise((r) => setTimeout(r, 900));

      /*
       * On compte les tours sans nouveau post, pas les tours sans que la page
       * grandisse. La hauteur d'une liste virtualisee ne bouge pas forcement
       * quand elle se remplit — s'y fier arretait le releve au bout de trois
       * tours, sur les quatre posts deja affiches.
       */
      stagne = seen.size === avant ? stagne + 1 : 0;
      if (stagne >= 4) break;
    }

    record();

    const mur = /Continuer sur X|Connectez.vous ou inscrivez|Sign in to X/i.test(
      document.body.innerText
    );

    return {
      tweets: [...seen.values()].sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true })),
      mur,
      annonce: (document.body.innerText.match(/([\d\s.,]+)\s*(posts|Post)/) || [])[1] || null,
    };
  })();
}

/**
 * Ce que X garde en attente pour nous.
 *
 * Les posts programmes chez X ne sont visibles nulle part publiquement : ni
 * sur le profil, ni dans le fil. Sans cette lecture, confier une heure a X
 * revient a lancer quelque chose qu'on ne peut plus ni verifier ni annuler
 * avant qu'il ne parte.
 *
 * Lecture seule, comme le releve du fil. La suppression reste un geste de la
 * main : elle se fait sur cette page, ou l'on voit ce qu'on supprime.
 */
export async function scheduledAtX() {
  const [precedent] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = await chrome.tabs.create({ url: SCHEDULED_URL, active: true });

  try {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 400));
      const etat = await chrome.tabs.get(tab.id);
      if (etat.status === 'complete') break;
    }
    await new Promise((r) => setTimeout(r, 2600));

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        /*
         * La liste s'affiche dans une fenetre posee sur le fil d'accueil.
         *
         * Interroger toute la page ramenait les posts du fil qui defile
         * derriere — le premier essai a rendu cinq tweets d'autres comptes en
         * les presentant comme des publications programmees. On se cantonne
         * donc a la fenetre, et sans elle on ne rend rien plutot que n'importe
         * quoi.
         */
        const modal =
          document.querySelector('[aria-modal="true"]') ||
          document.querySelector('[role="dialog"]');

        if (!modal) {
          return { entries: [], vide: false, erreur: 'fenetre des publications programmees absente' };
        }

        const modalText = modal.innerText || '';

        /*
         * On decoupe le texte de la fenetre, on n'enumere pas des elements.
         *
         * Une publication programmee n'est pas un `<article>` — chercher ce
         * balisage rendait zero entree alors que la fenetre en affichait une,
         * et seul l'apercu joint au rapport l'a montre. Le balisage de X
         * changera encore ; la ligne « Will send on… » qui ouvre chaque entree
         * est ce qu'il y a de plus stable ici, parce que c'est ce que
         * l'utilisateur lit.
         */
        const MARQUEUR = /^(Will send on|Sera envoy[ée].*)\b/;
        const lignes = modalText.split('\n').map((l) => l.trim());
        const entries = [];

        for (const ligne of lignes) {
          if (MARQUEUR.test(ligne)) entries.push({ annonce: ligne, texte: '' });
          else if (entries.length && ligne) {
            const courante = entries[entries.length - 1];
            courante.texte = courante.texte ? courante.texte + '\n' + ligne : ligne;
          }
        }

        return {
          entries,
          vide: /aren.t any|n.avez aucun|no scheduled|rien de programm/i.test(modalText),
          apercu: modalText.slice(0, 300),
        };
      },
    });

    const { entries, vide, erreur, apercu } = result.result;
    console.log(LOG, entries.length, 'post(s) programme(s) chez X');
    return { total: entries.length, vide, erreur, apercu, url: SCHEDULED_URL, entries };
  } catch (err) {
    // L'onglet reste ouvert meme en cas d'echec : c'est la page ou l'on
    // supprime, autant qu'elle soit deja sous la main pour regarder.
    throw err;
  }
}

/**
 * Ouvre le profil, releve le fil, referme.
 *
 * **L'onglet doit etre visible.** Premiere version, il s'ouvrait en arriere-
 * plan pour ne pas voler l'ecran : Chrome gele les onglets caches, la liste
 * virtualisee de X ne chargeait donc jamais la suite et le releve s'arretait
 * sur les quatre posts du premier ecran, sans rien signaler d'anormal.
 *
 * On rend donc la main a l'onglet d'ou l'on vient une fois le releve fini, et
 * on referme celui qu'on a ouvert. S'il etait deja ouvert, on le laisse : il
 * ne nous appartient pas.
 */
export async function fetchTweets(charge = {}) {
  const compte = (charge.compte || 'ascencia64').replace(/^@/, '');
  const cap = charge.cap || 0;
  const url = `https://x.com/${compte}`;

  const [precedent] = await chrome.tabs.query({ active: true, currentWindow: true });
  const opened = await chrome.tabs.query({ url: [`https://x.com/${compte}`, `https://x.com/${compte}?*`] });
  const already = opened.length > 0;
  const tab = already ? opened[0] : await chrome.tabs.create({ url, active: true });

  try {
    if (!already) {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const etat = await chrome.tabs.get(tab.id);
        if (etat.status === 'complete') break;
      }
      // Le fil arrive apres le squelette : sans cette pause, on releve une
      // page vide et on conclut que le compte n'a rien publie.
      await new Promise((r) => setTimeout(r, 2500));
    }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readFromPage,
      args: [MAX_ROUNDS, cap],
    });

    const { tweets, mur, annonce } = result.result;
    console.log(LOG, 'releve', tweets.length, 'posts de @' + compte);

    return {
      compte,
      total: tweets.length,
      // Vrai si X a coupe : le releve est alors partiel, et le dire vaut mieux
      // que de laisser croire a un inventaire complet.
      tronque: mur,
      annonceParX: annonce,
      tweets,
    };
  } finally {
    if (!already) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        // Onglet deja ferme a la main : rien a reparer.
      }
      // On repose l'ecran la ou on l'avait pris.
      if (precedent) {
        try {
          await chrome.tabs.update(precedent.id, { active: true });
        } catch {
          // L'onglet de depart a disparu entre-temps : tant pis, pas de quoi
          // faire echouer un releve qui a reussi.
        }
      }
    }
  }
}

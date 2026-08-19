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

/** Au-dela, on rend ce qu'on a plutot que de faire defiler indefiniment. */
const TOURS_MAX = 150;

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
function releverDansLaPage(toursMax, maximum) {
  const vus = new Map();

  const noter = () => {
    for (const article of document.querySelectorAll('article')) {
      const lien = [...article.querySelectorAll('a')]
        .map((a) => a.getAttribute('href') || '')
        .find((h) => /\/status\/\d+/.test(h));
      if (!lien) continue;

      const id = lien.match(/\/status\/(\d+)/)[1];
      if (vus.has(id)) continue;

      const balise = article.querySelector('time[datetime]');
      const texte = article.querySelector('[data-testid="tweetText"]');
      const brut = article.innerText || '';

      vus.set(id, {
        id,
        lien: 'https://x.com' + lien.split('/photo/')[0],
        date: balise ? balise.getAttribute('datetime') : null,
        dateAffichee: balise ? balise.textContent : null,
        texte: texte ? texte.innerText : '',
        // Le compte apparait dans le lien : un repost pointe ailleurs.
        auteur: (lien.match(/^\/([^/]+)\//) || [])[1] || '',
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

    for (let tour = 0; tour < toursMax; tour++) {
      const avant = vus.size;
      noter();
      if (maximum && vus.size >= maximum) break;

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
      stagne = vus.size === avant ? stagne + 1 : 0;
      if (stagne >= 4) break;
    }

    noter();

    const mur = /Continuer sur X|Connectez.vous ou inscrivez|Sign in to X/i.test(
      document.body.innerText
    );

    return {
      tweets: [...vus.values()].sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true })),
      mur,
      annonce: (document.body.innerText.match(/([\d\s.,]+)\s*(posts|Post)/) || [])[1] || null,
    };
  })();
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
export async function recupererTweets(charge = {}) {
  const compte = (charge.compte || 'ascencia64').replace(/^@/, '');
  const maximum = charge.maximum || 0;
  const url = `https://x.com/${compte}`;

  const [precedent] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ouverts = await chrome.tabs.query({ url: [`https://x.com/${compte}`, `https://x.com/${compte}?*`] });
  const deja = ouverts.length > 0;
  const onglet = deja ? ouverts[0] : await chrome.tabs.create({ url, active: true });

  try {
    if (!deja) {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const etat = await chrome.tabs.get(onglet.id);
        if (etat.status === 'complete') break;
      }
      // Le fil arrive apres le squelette : sans cette pause, on releve une
      // page vide et on conclut que le compte n'a rien publie.
      await new Promise((r) => setTimeout(r, 2500));
    }

    const [resultat] = await chrome.scripting.executeScript({
      target: { tabId: onglet.id },
      func: releverDansLaPage,
      args: [TOURS_MAX, maximum],
    });

    const { tweets, mur, annonce } = resultat.result;
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
    if (!deja) {
      try {
        await chrome.tabs.remove(onglet.id);
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

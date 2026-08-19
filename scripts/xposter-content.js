/*
 * xposter-content.js — Remplissage du composeur de x.com.
 *
 * Ce script ne decide de rien : il execute ce que le service worker lui
 * demande, et rend compte. La file d'attente, l'horloge et le pont vivent
 * ailleurs.
 *
 * Trois choses ne peuvent pas se faire naivement sur x.com :
 *
 *  1. **Le texte.** Le composeur est un editeur riche (Draft/Lexical) : ecrire
 *     dans `textContent` ne declenche aucun de ses evenements internes et le
 *     bouton Poster reste desactive. Il faut passer par `insertText`, qui
 *     simule une vraie frappe.
 *  2. **Les images.** On ne peut pas assigner `input.files` — la propriete est
 *     en lecture seule. On passe par un `DataTransfer`, seul objet dont le
 *     navigateur accepte la `FileList`.
 *  3. **Les textes alternatifs.** Ils ne sont accessibles qu'apres la fin du
 *     televersement, via une boite de dialogue par image.
 *
 * Les selecteurs de x.com bougent. Chacun est donc une LISTE d'hypotheses,
 * essayees dans l'ordre, et l'echec est explicite plutot que silencieux.
 */

const LOG = '[XPoster]';

/** Selecteurs, du plus stable au plus fragile. */
const SEL = {
  zoneTexte: [
    '[data-testid="tweetTextarea_0"]',
    '[role="textbox"][contenteditable="true"]',
    '.public-DraftEditor-content',
  ],
  champFichier: [
    '[data-testid="fileInput"]',
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
  ],
  boutonPoster: [
    '[data-testid="tweetButtonInline"]',
    '[data-testid="tweetButton"]',
  ],
  boutonAlt: ['[data-testid="altTextButton"]', 'button[aria-label*="escription"]'],
  champAlt: ['[data-testid="altTextInput"]', 'textarea[aria-label*="escription"]'],
  validerAlt: ['[data-testid="Sheet"] [role="button"][data-testid="applyButton"]',
               '[data-testid="applyButton"]'],
};

const dors = (ms) => new Promise((r) => setTimeout(r, ms));

/** Premier element trouve parmi une liste de selecteurs. */
function trouver(cles) {
  for (const sel of SEL[cles] || []) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/** Attend qu'un element apparaisse, ou rend null au bout du delai. */
async function attendre(cles, delai = 8000) {
  const fin = Date.now() + delai;
  while (Date.now() < fin) {
    const el = trouver(cles);
    if (el) return el;
    await dors(150);
  }
  return null;
}

/** Vide le composeur avant d ecrire, pour ne jamais ajouter a du residu. */
async function viderComposeur(zone) {
  zone.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  await dors(120);
}

/** Texte reellement present dans le composeur, sauts de ligne normalises. */
function texteActuel(zone) {
  return (zone.innerText || zone.textContent || '').trim();
}

/**
 * Ecrit le texte dans le composeur.
 *
 * **Pourquoi un collage et non `insertText`.** L editeur de X detecte les
 * liens a mesure qu on ecrit. Avec `insertText`, chaque caractere ajoute
 * relance cette detection sur un lien encore incomplet : le premier essai a
 * produit `cma.ascencia.re` repete sept fois et avait perdu les sauts de
 * ligne. Un evenement de collage porte le texte d un bloc, la detection ne
 * s execute qu une fois, sur un lien entier.
 *
 * Et on **verifie** : un composeur qui contient autre chose que ce qu on a
 * demande doit se voir dans le rapport, pas partir en publication.
 */
async function ecrireTexte(texte) {
  const zone = await attendre('zoneTexte');
  if (!zone) throw new Error('composeur introuvable');

  await viderComposeur(zone);

  const coller = () => {
    const dt = new DataTransfer();
    dt.setData('text/plain', texte);
    zone.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    );
  };

  coller();
  await dors(400);

  // Comparaison indulgente sur les espaces : l editeur normalise, et on ne
  // veut pas echouer sur une nuance d espacement.
  const attendu = texte.replace(new RegExp("\\s+", 'g'), ' ').trim();
  const obtenu = texteActuel(zone).replace(new RegExp("\\s+", 'g'), ' ').trim();

  if (obtenu === attendu) return { ok: true, methode: 'collage' };

  // Repli : certains navigateurs refusent le ClipboardEvent synthetique.
  console.warn(LOG, 'collage incomplet, repli sur insertText');
  await viderComposeur(zone);
  document.execCommand('insertText', false, texte);
  await dors(400);

  const obtenu2 = texteActuel(zone).replace(new RegExp("\\s+", 'g'), ' ').trim();
  if (obtenu2 === attendu) return { ok: true, methode: 'insertText' };

  // On ne laisse pas un composeur a moitie rempli sans le dire.
  return {
    ok: false,
    methode: 'aucune',
    attendu: attendu.slice(0, 120),
    obtenu: obtenu2.slice(0, 120),
  };
}

/** Transforme une image encodee en `File`, seul type accepte par le champ. */
function versFichier(dataUrl, nom) {
  const [entete, base64] = dataUrl.split(',');
  const type = (entete.match(/data:([^;]+)/) || [, 'image/png'])[1];
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  return new File([octets], nom || 'image.png', { type });
}

/** Joint les images. X en accepte quatre au maximum. */
async function joindreImages(images) {
  if (!images?.length) return 0;
  const champ = await attendre('champFichier');
  if (!champ) throw new Error('champ fichier introuvable');

  const dt = new DataTransfer();
  images.slice(0, 4).forEach((img, i) => dt.items.add(versFichier(img.dataUrl, img.nom || `image-${i + 1}.png`)));

  // `files` est en lecture seule : seul un DataTransfer peut la remplacer.
  champ.files = dt.files;
  champ.dispatchEvent(new Event('change', { bubbles: true }));

  // Le televersement doit finir avant qu'on puisse toucher aux textes alternatifs.
  await dors(1200 + dt.files.length * 900);
  return dt.files.length;
}

/**
 * Renseigne les textes alternatifs, une image a la fois.
 *
 * Sans eux la publication reste illisible pour qui utilise un lecteur
 * d'ecran, et c'est le genre d'oubli qu'un automate reproduit a l'infini.
 */
async function ecrireAlts(alts) {
  if (!alts?.length) return 0;
  let poses = 0;

  for (let i = 0; i < alts.length; i++) {
    const texte = alts[i];
    if (!texte) continue;

    const boutons = SEL.boutonAlt
      .flatMap((s) => Array.from(document.querySelectorAll(s)))
      .filter((b) => b.offsetParent !== null);

    if (!boutons[i]) break;

    boutons[i].click();
    const champ = await attendre('champAlt', 4000);
    if (!champ) break;

    champ.focus();
    document.execCommand('insertText', false, texte);
    await dors(200);

    const valider = trouver('validerAlt');
    if (valider) valider.click();
    await dors(500);
    poses++;
  }
  return poses;
}

/** Clique Poster. Uniquement si l'appelant l'a demande explicitement. */
async function publier() {
  const bouton = await attendre('boutonPoster', 5000);
  if (!bouton) throw new Error('bouton Poster introuvable');
  if (bouton.getAttribute('aria-disabled') === 'true') {
    throw new Error('bouton Poster desactive — texte vide ou televersement en cours');
  }
  bouton.click();
  await dors(1500);
  return true;
}

/** Enchainement complet. `publier` est toujours un choix conscient. */
async function composer({ texte, images, alts, publier: doitPublier }) {
  // Ce que le script a REELLEMENT recu : sans ca, un rapport a zero ne dit
  // pas si la charge etait vide ou si la jonction a echoue.
  const rapport = {
    texte: false, images: 0, alts: 0, publie: false,
    recu: { images: images?.length ?? 0, alts: alts?.length ?? 0, texte: (texte || "").length },
  };

  const ecriture = await ecrireTexte(texte);
  rapport.texte = ecriture.ok;
  rapport.ecriture = ecriture;

  // Sans texte conforme, on ne joint rien et on ne publie surtout pas : mieux
  // vaut un composeur vide qu une publication de travers.
  if (!ecriture.ok) return rapport;
  rapport.images = await joindreImages(images);
  rapport.alts = await ecrireAlts(alts);

  if (doitPublier) rapport.publie = await publier();

  return rapport;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== 'xposterComposer') return;

  composer(message.charge)
    .then((rapport) => {
      console.log(LOG, 'compose', rapport);
      sendResponse({ ok: true, rapport });
    })
    .catch((err) => {
      console.error(LOG, err);
      sendResponse({ ok: false, erreur: String(err.message || err) });
    });

  return true; // reponse asynchrone
});

console.log(LOG, 'pret');

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

/**
 * Ecrit le texte dans le composeur.
 *
 * `insertText` passe par le meme chemin qu'une frappe clavier : c'est la seule
 * facon d'obtenir que l'editeur mette a jour son etat interne et active le
 * bouton Poster.
 */
async function ecrireTexte(texte) {
  const zone = await attendre('zoneTexte');
  if (!zone) throw new Error('composeur introuvable');

  zone.focus();
  await dors(120);

  const ok = document.execCommand('insertText', false, texte);
  if (!ok) {
    // Repli : evenement de collage synthetique, accepte par la plupart des
    // editeurs riches quand `execCommand` est refuse.
    const dt = new DataTransfer();
    dt.setData('text/plain', texte);
    zone.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }

  await dors(250);
  const ecrit = (zone.textContent || '').trim().length > 0;
  if (!ecrit) throw new Error('le texte n a pas ete pris en compte');
  return true;
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
  const rapport = { texte: false, images: 0, alts: 0, publie: false };

  rapport.texte = await ecrireTexte(texte);
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

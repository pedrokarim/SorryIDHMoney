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
  boutonHoraire: ['[data-testid="scheduleOption"]', 'button[aria-label*="chedule"]'],
  confirmerHoraire: [
    '[data-testid="scheduledConfirmationPrimaryAction"]',
    '[data-testid="Confirmation_Dialog_Confirm"]',
  ],
  boutonAlt: ['[data-testid="altTextButton"]', 'button[aria-label*="escription"]'],
  champAlt: ['[data-testid="altTextInput"]', 'textarea[aria-label*="escription"]'],
  validerAlt: ['[data-testid="Sheet"] [role="button"][data-testid="applyButton"]',
               '[data-testid="applyButton"]'],
};

const dors = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Quel compte est aux commandes de cette page.
 *
 * L'identifiant fait foi, pas le pseudo. Le cookie `twid` porte le numero du
 * compte connecte : il ne bouge pas quand on renomme un compte, et aucune
 * refonte de l'interface de X ne le deplace. Le pseudo, lui, se lit dans le
 * DOM quand il est la — pratique pour l'affichage, mais il change et il peut
 * disparaitre d'une version a l'autre.
 *
 * C'est cette distinction qui compte : on autorise des identifiants, on
 * affiche des pseudos.
 */
function compteActif() {
  const cookie = (document.cookie.match(/(?:^|;\s*)twid=([^;]+)/) || [])[1] || '';
  const id = (decodeURIComponent(cookie).match(/u=(\d+)/) || [])[1] || null;

  let pseudo = null;
  const bouton = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  if (bouton) pseudo = (bouton.innerText.match(/@([A-Za-z0-9_]+)/) || [])[1] || null;
  if (!pseudo) {
    const lien = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const href = lien && lien.getAttribute('href');
    if (href) pseudo = href.replace(/^\//, '') || null;
  }

  return { id, pseudo };
}

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

/**
 * Confie l'heure a X plutot qu'a notre alarme.
 *
 * Le formulaire d'horaire de X est une poignee de `<select>` — mois, jour,
 * annee, heure, minute, et AM/PM selon la langue du compte. On les remplit
 * par le setter natif : un select monte par React ignore une affectation
 * directe, il attend l'evenement.
 *
 * On ne confirme pas si la publication n'est pas autorisee. Sans ce clic,
 * l'horaire est saisi et le composeur attend — meme regle que partout
 * ailleurs ici : on prepare, la derniere main revient a quelqu'un.
 */
async function programmerChezX(quand, confirmer) {
  const bouton = await attendre('boutonHoraire', 6000);
  if (!bouton) return { ok: false, erreur: 'bouton horaire introuvable' };
  bouton.click();

  const date = new Date(quand);
  await dors(900);

  const selects = Array.from(document.querySelectorAll('select'));
  if (selects.length < 5) return { ok: false, erreur: `formulaire d horaire absent (${selects.length} champs)` };

  const poser = (select, valeur) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, String(valeur));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  /*
   * Chaque champ est reconnu a son etiquette, pas a sa position : X les
   * reordonne selon la locale, et un jour ecrit dans le champ du mois passe
   * inapercu jusqu'a la publication.
   */
  const parNom = (motifs) =>
    selects.find((s) => {
      const nom = (s.getAttribute('aria-label') || s.getAttribute('name') || s.id || '').toLowerCase();
      return motifs.some((m) => nom.includes(m));
    });

  const champs = [
    ['mois', parNom(['month', 'mois']), date.getMonth() + 1],
    ['jour', parNom(['day', 'jour']), date.getDate()],
    ['annee', parNom(['year', 'ann']), date.getFullYear()],
    ['heure', parNom(['hour', 'heure']), date.getHours()],
    ['minute', parNom(['minute']), date.getMinutes()],
  ];

  const manquants = champs.filter(([, s]) => !s).map(([n]) => n);
  if (manquants.length) return { ok: false, erreur: `champs d horaire non identifies : ${manquants.join(', ')}` };

  for (const [, select, valeur] of champs) {
    poser(select, valeur);
    await dors(160);
  }

  const meridien = parNom(['am', 'pm', 'meridiem']);
  if (meridien) poser(meridien, date.getHours() < 12 ? 'AM' : 'PM');

  if (!confirmer) return { ok: true, confirme: false, note: 'horaire saisi, confirmation laissee a la main' };

  await dors(400);
  const valider = trouver('confirmerHoraire');
  if (!valider) return { ok: true, confirme: false, erreur: 'bouton de confirmation introuvable' };
  valider.click();
  await dors(1500);
  return { ok: true, confirme: true };
}

/**
 * Joint les images. X en accepte quatre au maximum.
 *
 * `trace` est rempli au fur et a mesure : un rapport qui dit seulement
 * « zero image » ne distingue pas un champ introuvable d'un fichier refuse
 * ou d'une affectation ignoree. Chaque etape laisse donc sa marque.
 */
async function joindreImages(images, trace = {}) {
  trace.recues = images?.length ?? 0;
  if (!images?.length) return 0;

  const champ = await attendre('champFichier');
  trace.champTrouve = !!champ;
  if (!champ) throw new Error('champ fichier introuvable');
  trace.champ = champ.getAttribute('data-testid') || champ.getAttribute('accept') || 'input';

  const dt = new DataTransfer();
  const fichiers = images.slice(0, 4).map((img, i) => versFichier(img.dataUrl, img.nom || `image-${i + 1}.png`));
  trace.construits = fichiers.map((f) => ({ nom: f.name, type: f.type, octets: f.size }));

  for (const f of fichiers) {
    try { dt.items.add(f); } catch (e) { trace.erreurAjout = String(e.message || e); }
  }
  trace.dansDataTransfer = dt.files.length;

  // `files` est en lecture seule : seul un DataTransfer peut la remplacer.
  champ.files = dt.files;
  trace.apresAffectation = champ.files.length;

  champ.dispatchEvent(new Event('change', { bubbles: true }));

  // Le televersement doit finir avant qu'on puisse toucher aux textes alternatifs.
  await dors(1200 + dt.files.length * 900);

  // Ce que X a reellement monte dans le composeur, et non ce qu'on lui a
  // tendu : c'est la seule mesure qui compte.
  trace.vignettesVisibles = document.querySelectorAll(
    '[data-testid="attachments"] img, [data-testid="attachments"] video, [aria-label*="Media"] img'
  ).length;

  return champ.files.length;
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
async function composer({ texte, images, alts, publier: doitPublier, comptesAutorises, programmerLe }) {
  // Ce que le script a REELLEMENT recu : sans ca, un rapport a zero ne dit
  // pas si la charge etait vide ou si la jonction a echoue.
  const rapport = {
    texte: false, images: 0, alts: 0, publie: false,
    recu: { images: images?.length ?? 0, alts: alts?.length ?? 0, texte: (texte || "").length },
  };

  /*
   * Le compte, avant tout le reste.
   *
   * Piloter le navigateur, c'est publier depuis le compte qui se trouve etre
   * connecte. Le module l'ignorait : une publication est partie du mauvais
   * compte sans que rien ne l'ait signale, ni avant ni apres.
   *
   * On verifie donc avant d'ecrire une seule lettre. Ecrire puis refuser
   * laisserait un composeur a moitie rempli sur un compte etranger, ce qui
   * est exactement ce qu'on veut eviter.
   *
   * Liste vide : aucun filtre, comme avant. On ne bloque pas quelqu'un qui
   * n'a rien demande — mais le compte detecte part dans le rapport, pour
   * qu'il soit lisible sans avoir a le chercher.
   */
  const actif = compteActif();
  rapport.compte = actif;

  if (comptesAutorises?.length) {
    const attendus = comptesAutorises.map((c) => String(c).replace(/^@/, '').toLowerCase());
    const permis =
      (actif.id && attendus.includes(actif.id)) ||
      (actif.pseudo && attendus.includes(actif.pseudo.toLowerCase()));

    if (!permis) {
      rapport.refus = actif.id || actif.pseudo
        ? `compte non autorise : ${actif.pseudo ? '@' + actif.pseudo : ''} ${actif.id || ''}`.trim()
        : 'compte indeterminable — session absente ?';
      return rapport;
    }
  }

  const ecriture = await ecrireTexte(texte);
  rapport.texte = ecriture.ok;
  rapport.ecriture = ecriture;

  // Sans texte conforme, on ne joint rien et on ne publie surtout pas : mieux
  // vaut un composeur vide qu une publication de travers.
  if (!ecriture.ok) return rapport;
  rapport.trace = {};
  rapport.images = await joindreImages(images, rapport.trace);
  rapport.alts = await ecrireAlts(alts);

  /*
   * L'horaire vient apres les images : le formulaire de X ouvre une couche
   * par-dessus le composeur, et le champ fichier n'y est plus atteignable.
   *
   * Programmer chez X, c'est publier sans surveillance — donc soumis a la
   * meme autorisation que le clic « Post ». Sans elle, l'heure est saisie et
   * la confirmation attend.
   */
  if (programmerLe) {
    rapport.horaire = await programmerChezX(programmerLe, doitPublier);
    rapport.programme = rapport.horaire.confirme === true;
    return rapport;
  }

  if (doitPublier) rapport.publie = await publier();

  return rapport;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  /*
   * « Ce composeur est-il libre ? »
   *
   * La composition commence par vider la zone, pour ne jamais ajouter a du
   * residu. Ecrire dans un onglet qui attend encore un clic effacerait donc
   * ce qui s'y trouve — texte, image et texte alternatif compris. Avant de
   * reutiliser un onglet, on lui demande s'il est vide.
   */
  if (message?.action === 'xposterEtat') {
    const zone = trouver('zoneTexte');
    sendResponse({ ok: true, present: !!zone, vide: !zone || texteActuel(zone) === '' });
    return true;
  }

  // Sert a la page d'options : « ajoute le compte ou je suis connecte »,
  // plutot que de demander a quelqu'un de retrouver son identifiant numerique.
  if (message?.action === 'xposterCompte') {
    sendResponse({ ok: true, ...compteActif() });
    return true;
  }

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

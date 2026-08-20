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

  /*
   * Le collage echoue a chaque fois, et ce n'est pas une anomalie.
   *
   * L'evenement est bien forme — verifie en Chrome 151, il transporte son
   * texte. C'est l'editeur de X qui ignore un collage qu'aucune main n'a
   * declenche. Le repli est donc le chemin normal, pas un incident : le
   * signaler en avertissement remplissait la page d'erreurs de l'extension a
   * chaque publication, ce qui apprend surtout a ne plus la lire.
   *
   * On garde la tentative : le jour ou elle passera, elle est plus sure —
   * `insertText` relance la detection de liens de X, et c'est elle qui avait
   * produit une URL repetee sept fois. D'ou la verification qui suit.
   */
  console.debug(LOG, 'collage ignore par l editeur, repli sur insertText');
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
  const date = new Date(quand);

  /*
   * La boite est peut-etre deja ouverte — un essai precedent l'a laissee la.
   * Recliquer sur le bouton d'horaire la referme ou la reouvre a vide selon
   * l'humeur de X ; on ne clique donc que s'il n'y a rien a l'ecran.
   */
  let selects = Array.from(document.querySelectorAll('select'));
  let dejaOuverte = selects.length >= 5;

  if (!dejaOuverte) {
    const bouton = await attendre('boutonHoraire', 6000);
    if (!bouton) return { ok: false, erreur: 'bouton horaire introuvable' };
    bouton.click();
    await dors(900);
    selects = Array.from(document.querySelectorAll('select'));
  }
  if (selects.length < 5) return { ok: false, erreur: `formulaire d horaire absent (${selects.length} champs)` };

  const poser = (select, valeur) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, String(valeur));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  /*
   * Chaque champ est reconnu a la forme de sa liste, pas a son etiquette.
   *
   * Premier essai : chercher « month », « day » dans `aria-label`, `name` ou
   * `id`. Aucun des cinq n'a ete trouve — X etiquette ses champs par un texte
   * a cote, pas par un attribut. Et une etiquette est traduite : la chercher
   * en anglais aurait de toute facon lache sur un compte en francais.
   *
   * La forme, elle, ne se traduit pas. Soixante entrees, c'est une liste de
   * minutes. Vingt-huit a trente et une, un jour du mois. Quatre chiffres au
   * dela de deux mille, une annee. Restent le mois et l'heure, departages par
   * l'ordre d'affichage — et verifies quand meme, parce qu'ecrire un jour
   * dans le champ du mois ne se verrait qu'a la publication.
   */
  const decrire = (s) => {
    /*
     * L'option vide de tete ne compte pas.
     *
     * X ouvre chaque liste par un choix sans valeur — le libelle du champ.
     * Les comptes tombaient donc tous a un pres : treize mois, trente-deux
     * jours, soixante et une minutes, et plus rien ne se reconnaissait.
     */
    const options = Array.from(s.options).filter((o) => o.value !== '' && o.value != null);
    const valeurs = options.map((o) => o.value);
    const nombres = valeurs.map((v) => parseInt(v, 10)).filter((n) => !isNaN(n));
    return {
      select: s,
      options,
      taille: valeurs.length,
      tousNombres: nombres.length === valeurs.length && valeurs.length > 0,
      min: nombres.length ? Math.min(...nombres) : null,
      max: nombres.length ? Math.max(...nombres) : null,
    };
  };

  const formes = selects.map(decrire);
  const annee = formes.find((f) => f.tousNombres && f.min >= 2000 && f.max < 2100 && f.taille <= 10);
  const minute = formes.find((f) => f.taille === 60);
  const jour = formes.find((f) => f.taille >= 28 && f.taille <= 31);

  // Ne restent que le mois et l'heure. Les deux peuvent compter douze entrees
  // sur un compte en 12 h, d'ou l'ordre d'affichage comme depart : la date
  // vient avant l'heure, partout.
  const restants = formes.filter((f) => f !== annee && f !== minute && f !== jour);
  const mois = restants[0];
  const heure = restants[1];

  const attendus = [
    ['mois', mois, date.getMonth() + 1, (f) => f && (f.taille === 12 || f.taille === 13)],
    ['jour', jour, date.getDate(), (f) => f && f.taille >= 28 && f.taille <= 31],
    ['annee', annee, date.getFullYear(), (f) => f && f.min >= 2000],
    ['heure', heure, date.getHours(), (f) => f && (f.taille === 24 || f.taille === 12)],
    ['minute', minute, date.getMinutes(), (f) => f && f.taille === 60],
  ];

  const suspects = attendus.filter(([, f, , conforme]) => !conforme(f)).map(([n]) => n);
  if (suspects.length) {
    return {
      ok: false,
      erreur: `champs d horaire non identifies : ${suspects.join(', ')}`,
      formes: formes.map((f) => ({ taille: f.taille, min: f.min, max: f.max })),
    };
  }

  for (const [nom, forme, valeur] of attendus) {
    // Le mois peut valoir « 8 », « 08 » ou « August » selon la locale : on
    // cherche donc l'option, on ne devine pas sa valeur.
    // `forme.options` exclut deja l'option vide, donc le rang d'un mois y est
    // bien son numero moins un.
    const options = forme.options;
    const cible =
      options.find((o) => parseInt(o.value, 10) === valeur) ||
      (nom === 'mois' ? options[valeur - 1] : null) ||
      (nom === 'heure' && forme.taille === 12 ? options[((valeur % 12) || 12) - 1] : null);

    if (!cible) return { ok: false, erreur: `valeur ${valeur} absente du champ ${nom}` };
    poser(forme.select, cible.value);
    await dors(160);
  }

  // 12 h : le champ AM/PM est un select de deux entrees, hors des cinq.
  const meridien = formes.find((f) => f.taille === 2);
  if (meridien) poser(meridien.select, date.getHours() < 12 ? 'AM' : 'PM');

  /*
   * On relit avant de conclure.
   *
   * La version precedente annoncait « rempli » aussitot apres avoir ecrit, et
   * elle a annonce un succes alors que la boite affichait encore l'heure d'un
   * essai anterieur. Un composant controle par React peut reprendre la main
   * sur la valeur qu'on vient de poser ; seule la relecture le dit.
   */
  await dors(500);
  const relu = {};
  const ecarts = [];
  for (const [nom, forme, valeur] of attendus) {
    const obtenu = parseInt(forme.select.value, 10);
    relu[nom] = forme.select.value;
    if (obtenu !== valeur) ecarts.push(`${nom} : ${obtenu} au lieu de ${valeur}`);
  }

  // X resume l'echeance en toutes lettres au-dessus du formulaire. C'est ce
  // que verra qui regarde, donc ce qu'on rapporte.
  const resume = (document.body.innerText.match(/(Will send on|Sera envoy[ée][^\n]*)[^\n]*/) || [])[0] || null;

  if (ecarts.length) {
    return { ok: false, erreur: `horaire non pris : ${ecarts.join(' ; ')}`, relu, resume, dejaOuverte };
  }

  if (!confirmer) {
    return { ok: true, confirme: false, relu, resume, note: 'horaire saisi, confirmation laissee a la main' };
  }

  await dors(400);
  // Le bouton n'a pas toujours de testid : on se rabat sur son libelle, dans
  // les deux langues que ce compte peut afficher.
  const valider =
    trouver('confirmerHoraire') ||
    Array.from(document.querySelectorAll('[role="button"], button')).find((b) =>
      /^(confirm|confirmer)$/i.test((b.innerText || '').trim())
    );
  if (!valider) return { ok: true, confirme: false, erreur: 'bouton de confirmation introuvable' };
  valider.click();
  await dors(1800);

  const encoreLa = document.querySelectorAll('select').length >= 5;
  if (encoreLa) {
    return { ok: false, confirme: false, relu, resume, erreur: 'boite d horaire toujours affichee apres confirmation' };
  }

  /*
   * Confirmer l'heure ne programme rien.
   *
   * Le bouton « Confirm » ferme la boite et rattache l'heure au composeur —
   * c'est tout. Le bouton principal devient alors « Schedule », et c'est lui
   * qui envoie la publication chez X. Sans ce second clic, la liste des
   * publications en attente reste vide, ce qu'un premier essai a montre :
   * le rapport annoncait « programme », X ne gardait rien.
   *
   * Disparition de la boite valait succes ; elle ne vaut plus que passage a
   * l'etape suivante.
   */
  const envoi = await attendre('boutonPoster', 5000);
  if (!envoi) {
    return { ok: false, confirme: true, envoye: false, relu, resume,
             erreur: 'bouton d envoi introuvable apres confirmation de l heure' };
  }
  if (envoi.getAttribute('aria-disabled') === 'true') {
    return { ok: false, confirme: true, envoye: false, relu, resume,
             erreur: 'bouton d envoi desactive apres confirmation de l heure' };
  }

  const libelle = (envoi.innerText || '').trim();
  envoi.click();
  await dors(2200);

  return { ok: true, confirme: true, envoye: true, libelle, relu, resume };
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
    // « Programme » veut dire parti chez X, pas « heure saisie » : c est la
    // difference que le premier essai avait effacee.
    rapport.programme = rapport.horaire.envoye === true;
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

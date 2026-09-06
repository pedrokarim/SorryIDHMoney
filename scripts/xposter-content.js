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
  textArea: [
    '[data-testid="tweetTextarea_0"]',
    '[role="textbox"][contenteditable="true"]',
    '.public-DraftEditor-content',
  ],
  fileField: [
    '[data-testid="fileInput"]',
    'input[type="file"][accept*="image"]',
    'input[type="file"]',
  ],
  postButton: [
    '[data-testid="tweetButtonInline"]',
    '[data-testid="tweetButton"]',
  ],
  scheduleButton: ['[data-testid="scheduleOption"]', 'button[aria-label*="chedule"]'],
  confirmScheduleButton: [
    '[data-testid="scheduledConfirmationPrimaryAction"]',
    '[data-testid="Confirmation_Dialog_Confirm"]',
  ],
  altButton: ['[data-testid="altTextButton"]', 'button[aria-label*="escription"]'],
  altField: ['[data-testid="altTextInput"]', 'textarea[aria-label*="escription"]'],
  altApplyButton: ['[data-testid="Sheet"] [role="button"][data-testid="applyButton"]',
               '[data-testid="applyButton"]'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
function activeAccount() {
  const cookie = (document.cookie.match(/(?:^|;\s*)twid=([^;]+)/) || [])[1] || '';
  const id = (decodeURIComponent(cookie).match(/u=(\d+)/) || [])[1] || null;

  let pseudo = null;
  const button = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
  if (button) pseudo = (button.innerText.match(/@([A-Za-z0-9_]+)/) || [])[1] || null;
  if (!pseudo) {
    const link = document.querySelector('[data-testid="AppTabBar_Profile_Link"]');
    const href = link && link.getAttribute('href');
    if (href) pseudo = href.replace(/^\//, '') || null;
  }

  return { id, pseudo };
}

/** Premier element trouve parmi une liste de selecteurs. */
function find(key) {
  for (const sel of SEL[key] || []) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/** Attend qu'un element apparaisse, ou rend null au bout du delai. */
async function waitFor(key, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = find(key);
    if (el) return el;
    await sleep(150);
  }
  return null;
}

/**
 * Le bouton qui envoie, parmi ceux qui lui ressemblent.
 *
 * `tweetButtonInline` designe le composeur en ligne du fil d'accueil. Il
 * existe derriere la fenetre de composition, vide et donc grise — et il
 * arrivait le premier dans la liste des selecteurs. On concluait « bouton
 * desactive » alors que le bon, dans la fenetre, attendait juste a cote.
 *
 * On prend donc tous les candidats et on garde celui qui est visible et
 * actif, en preferant celui qui se trouve dans la fenetre.
 */
function sendButton() {
  const candidates = SEL.postButton
    .flatMap((sel) => Array.from(document.querySelectorAll(sel)))
    // `offsetParent` vaut `null` sous la modale, qui est `position: fixed`.
    .filter((b) => b.getClientRects().length > 0 && b.getAttribute('aria-disabled') !== 'true');

  const modal = document.querySelector('[aria-modal="true"], [role="dialog"]');
  return (modal && candidates.find((b) => modal.contains(b))) || candidates[0] || null;
}

/** Vide le composeur avant d ecrire, pour ne jamais ajouter a du residu. */
async function clearComposer(area) {
  area.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  await sleep(120);
}

/** Texte reellement present dans le composeur, sauts de ligne normalises. */
function currentText(area) {
  return (area.innerText || area.textContent || '').trim();
}

/**
 * Les lignes non vides d'un texte, espaces internes normalises.
 *
 * ==On compare la structure, pas la mise en forme.== La verification d'origine
 * ecrasait les blancs en une seule espace des DEUX cotes : un texte dont tous
 * les sauts de ligne avaient disparu devenait alors identique a celui qu'on
 * avait demande, et le rapport annoncait `ok: true` sur un post mis en un seul
 * bloc. Le 06/09/2026, deux publications sont parties comme ca.
 *
 * En comparant ligne a ligne, un paragraphe perdu ne peut plus passer pour un
 * detail d'espacement.
 */
function textLines(value) {
  return (value || '')
    .split('\n')
    .map((line) => line.replace(/[ 	]+/g, ' ').trim())
    .filter(Boolean);
}

const sameLines = (a, b) => a.length === b.length && a.every((line, i) => line === b[i]);

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
async function writeText(texte) {
  const area = await waitFor('textArea');
  if (!area) throw new Error('composeur introuvable');

  await clearComposer(area);

  const paste = () => {
    const dt = new DataTransfer();
    dt.setData('text/plain', texte);
    area.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    );
  };

  paste();
  await sleep(400);

  // Indulgente sur les espaces d'une meme ligne, stricte sur les sauts de
  // ligne : c'est la structure du post qui doit arriver intacte.
  const waited = textLines(texte);

  if (sameLines(textLines(currentText(area)), waited)) {
    return { ok: true, methode: 'collage' };
  }

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
  await clearComposer(area);
  /*
   * ==Un bloc par ligne, et `insertParagraph` entre eux.==
   *
   * `insertText` recevant le texte entier avale ses sauts de ligne : l'editeur
   * de X est un Draft.js, il ne cree un nouveau bloc que sur un
   * `insertParagraph`. Le post partait donc d'une seule coulee, les phrases
   * collees les unes aux autres.
   *
   * On decoupe donc nous-memes. Une ligne vide de la source produit un
   * `insertParagraph` sans texte, ce qui rend la ligne blanche entre deux
   * paragraphes.
   */
  const blocs = texte.split('\n');
  for (let i = 0; i < blocs.length; i += 1) {
    if (i > 0) document.execCommand('insertParagraph', false, null);
    if (blocs[i]) document.execCommand('insertText', false, blocs[i]);
  }
  await sleep(400);

  const gotAfterRetry = textLines(currentText(area));
  if (sameLines(gotAfterRetry, waited)) return { ok: true, methode: 'insertText' };

  // On ne laisse pas un composeur a moitie rempli sans le dire. Le compte de
  // lignes est en clair : c'est lui qui trahit un post mis en un seul bloc.
  return {
    ok: false,
    methode: 'aucune',
    lignesAttendues: waited.length,
    lignesObtenues: gotAfterRetry.length,
    waited: waited.join(' | ').slice(0, 160),
    got: gotAfterRetry.join(' | ').slice(0, 160),
  };
}

/** Transforme une image encodee en `File`, seul type accepte par le champ. */
function toFile(dataUrl, nom) {
  const [entete, base64] = dataUrl.split(',');
  const type = (entete.match(/data:([^;]+)/) || [, 'image/png'])[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], nom || 'image.png', { type });
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
async function scheduleAtX(quand, confirmer) {
  const date = new Date(quand);

  /*
   * La boite est peut-etre deja ouverte — un essai precedent l'a laissee la.
   * Recliquer sur le bouton d'horaire la referme ou la reouvre a vide selon
   * l'humeur de X ; on ne clique donc que s'il n'y a rien a l'ecran.
   */
  let selects = Array.from(document.querySelectorAll('select'));
  let dejaOuverte = selects.length >= 5;

  if (!dejaOuverte) {
    const button = await waitFor('scheduleButton', 6000);
    if (!button) return { ok: false, erreur: 'bouton horaire introuvable' };
    button.click();

    /*
     * On attendait 900 ms fixes. C'est suffisant sur un composeur vide, pas
     * apres un televersement : le formulaire est arrive en retard et on a
     * conclu a son absence, ==sur un post que X aurait accepte de programmer==.
     * On attend donc que les cinq listes existent, jusqu'a six secondes.
     */
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(500);
      selects = Array.from(document.querySelectorAll('select'));
      if (selects.length >= 5) break;
    }
  }
  if (selects.length < 5) return { ok: false, erreur: `formulaire d horaire absent (${selects.length} champs)` };

  const apply = (select, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, String(value));
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
  const describe = (s) => {
    /*
     * L'option vide de tete ne compte pas.
     *
     * X ouvre chaque liste par un choix sans valeur — le libelle du champ.
     * Les comptes tombaient donc tous a un pres : treize mois, trente-deux
     * jours, soixante et une minutes, et plus rien ne se reconnaissait.
     */
    const options = Array.from(s.options).filter((o) => o.value !== '' && o.value != null);
    const values = options.map((o) => o.value);
    const nombres = values.map((v) => parseInt(v, 10)).filter((n) => !isNaN(n));
    return {
      select: s,
      options,
      taille: values.length,
      tousNombres: nombres.length === values.length && values.length > 0,
      min: nombres.length ? Math.min(...nombres) : null,
      max: nombres.length ? Math.max(...nombres) : null,
    };
  };

  const shapes = selects.map(describe);
  const year = shapes.find((f) => f.tousNombres && f.min >= 2000 && f.max < 2100 && f.taille <= 10);
  const minute = shapes.find((f) => f.taille === 60);
  const day = shapes.find((f) => f.taille >= 28 && f.taille <= 31);

  // Ne restent que le mois et l'heure. Les deux peuvent compter douze entrees
  // sur un compte en 12 h, d'ou l'ordre d'affichage comme depart : la date
  // vient avant l'heure, partout.
  const remaining = shapes.filter((f) => f !== year && f !== minute && f !== day);
  const month = remaining[0];
  const hour = remaining[1];

  const expected = [
    ['mois', month, date.getMonth() + 1, (f) => f && (f.taille === 12 || f.taille === 13)],
    ['jour', day, date.getDate(), (f) => f && f.taille >= 28 && f.taille <= 31],
    ['annee', year, date.getFullYear(), (f) => f && f.min >= 2000],
    ['heure', hour, date.getHours(), (f) => f && (f.taille === 24 || f.taille === 12)],
    ['minute', minute, date.getMinutes(), (f) => f && f.taille === 60],
  ];

  const suspicious = expected.filter(([, f, , conforme]) => !conforme(f)).map(([n]) => n);
  if (suspicious.length) {
    return {
      ok: false,
      erreur: `champs d horaire non identifies : ${suspects.join(', ')}`,
      shapes: shapes.map((f) => ({ taille: f.taille, min: f.min, max: f.max })),
    };
  }

  for (const [nom, forme, value] of expected) {
    // Le mois peut valoir « 8 », « 08 » ou « August » selon la locale : on
    // cherche donc l'option, on ne devine pas sa valeur.
    // `forme.options` exclut deja l'option vide, donc le rang d'un mois y est
    // bien son numero moins un.
    const options = forme.options;
    const cible =
      options.find((o) => parseInt(o.value, 10) === value) ||
      (nom === 'mois' ? options[value - 1] : null) ||
      (nom === 'heure' && forme.taille === 12 ? options[((value % 12) || 12) - 1] : null);

    if (!cible) return { ok: false, erreur: `valeur ${valeur} absente du champ ${nom}` };
    apply(forme.select, cible.value);
    await sleep(160);
  }

  // 12 h : le champ AM/PM est un select de deux entrees, hors des cinq.
  const meridiem = shapes.find((f) => f.taille === 2);
  if (meridiem) apply(meridiem.select, date.getHours() < 12 ? 'AM' : 'PM');

  /*
   * On relit avant de conclure.
   *
   * La version precedente annoncait « rempli » aussitot apres avoir ecrit, et
   * elle a annonce un succes alors que la boite affichait encore l'heure d'un
   * essai anterieur. Un composant controle par React peut reprendre la main
   * sur la valeur qu'on vient de poser ; seule la relecture le dit.
   */
  await sleep(500);
  const relu = {};
  const mismatches = [];
  for (const [nom, forme, value] of expected) {
    const got = parseInt(forme.select.value, 10);
    relu[nom] = forme.select.value;
    if (got !== value) mismatches.push(`${nom} : ${obtenu} au lieu de ${valeur}`);
  }

  // X resume l'echeance en toutes lettres au-dessus du formulaire. C'est ce
  // que verra qui regarde, donc ce qu'on rapporte.
  /*
   * ==Lire la modale, pas `document.body`.== `innerText` force un layout et
   * reconstruit le texte de tout ce qu'il traverse : sur le fil de X, cela
   * bloquait le thread principal a lui seul. Le resume vit dans la boite
   * d'horaire, quelques dizaines d'elements plus bas.
   */
  const modalRoot = document.querySelector('[aria-modal="true"], [role="dialog"]') || document.body;
  const resume = (modalRoot.innerText.match(/(Will send on|Sera envoy[ée][^\n]*)[^\n]*/) || [])[0] || null;

  if (mismatches.length) {
    return { ok: false, erreur: `horaire non pris : ${ecarts.join(' ; ')}`, relu, resume, dejaOuverte };
  }

  if (!confirmer) {
    return { ok: true, confirme: false, relu, resume, note: 'horaire saisi, confirmation laissee a la main' };
  }

  await sleep(400);

  /*
   * ==Le bouton ne s'appelle pas toujours « Confirm ».==
   *
   * Constate sur capture le 24/08 : quand la boite s'ouvre sur un horaire
   * deja pose — ce qui arrive des la deuxieme tentative sur le meme
   * composeur — X intitule son bouton ==« Update »==. On ne cherchait que
   * « Confirm » et « Confirmer », donc on n'appuyait sur rien : l'heure etait
   * saisie, juste, et la programmation s'arretait la sans que rien ne casse.
   *
   * ==Et on ne balaie plus le document.== La recherche portait sur tous les
   * `[role="button"], button` de la page, en lisant l'`innerText` de chacun —
   * un recalcul de layout par bouton, sur le fil entier de x.com. C'est ce
   * balayage qui figeait l'onglet a l'etape horaire. La boite d'horaire est
   * une modale : tout ce qu'on cherche y est.
   *
   * `textContent` plutot que `innerText` : le premier lit l'arbre, le second
   * demande au navigateur ce qui est reellement affiche, donc un layout.
   */
  const CONFIRM_LABELS = /^(confirm|confirmer|update|mettre a day|mettre à day)$/i;
  const dialogRoot = document.querySelector('[aria-modal="true"], [role="dialog"]') || document;
  const confirmButton =
    find('confirmScheduleButton') ||
    Array.from(dialogRoot.querySelectorAll('[role="button"], button')).find((b) =>
      CONFIRM_LABELS.test((b.textContent || '').trim())
    );
  if (!confirmButton) {
    /*
     * Le libelle change : quand aucun ne repond, on remonte ceux qu'on a vus.
     * C'est ce qui a permis de trouver « Update », et ca coute une ligne.
     */
    const seenLabels = Array.from(dialogRoot.querySelectorAll('[role="button"], button'))
      .map((b) => (b.textContent || '').trim())
      .filter(Boolean)
      .slice(0, 12);
    return { ok: true, confirme: false, relu, resume,
             erreur: `bouton de confirmation introuvable — libelles presents : ${vus.join(' | ')}` };
  }
  confirmButton.click();
  await sleep(1800);

  const stillOpen = document.querySelectorAll('select').length >= 5;
  if (stillOpen) {
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
  // On laisse le composeur se remettre en place avant de chercher son bouton.
  let sendBtn = null;
  for (let i = 0; i < 20 && !sendBtn; i++) { sendBtn = sendButton(); if (!sendBtn) await sleep(250); }
  if (!sendBtn) {
    return { ok: false, confirme: true, envoye: false, relu, resume,
             erreur: 'aucun bouton d envoi actif apres confirmation de l heure' };
  }

  const libelle = (sendBtn.innerText || '').trim();
  sendBtn.click();

  /*
   * ==Cliquer n'est pas programmer.== On retournait `envoye: true` juste apres
   * le clic : X a repondu « The content of your post is invalid. », le
   * composeur est reste ouvert, et le rapport annoncait un succes. On attend
   * donc que la modale disparaisse — seule preuve que X a accepte — et on
   * remonte le message d'erreur quand elle reste la.
   */
  const alertText = () =>
    Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"], [data-testid="error-detail"]'))
      .map((el) => (el.innerText || '').trim())
      .find(Boolean) || '';

  for (let i = 0; i < 16; i++) {
    await sleep(400);
    const message = alertText();

    // X annonce lui-meme le succes : « Your post will be sent on … ».
    if (/will be sent|sera envoy/i.test(message)) {
      return { ok: true, confirme: true, envoye: true, libelle, relu, resume, message };
    }
    if (/invalid|error|erreur/i.test(message)) {
      return { ok: false, confirme: true, envoye: false, libelle, relu, resume, erreur: message };
    }

    /*
     * Repli : la modale a disparu. ==Ne pas tester `tweetTextarea_0` seul== —
     * le composeur inline du fil, derriere la modale, porte le meme testid et
     * ne disparait jamais. Un premier essai a ainsi rapporte un echec sur une
     * publication que X avait bel et bien gardee.
     */
    if (!document.querySelector('[aria-modal="true"], [role="dialog"]')) {
      return { ok: true, confirme: true, envoye: true, libelle, relu, resume };
    }
  }

  return {
    ok: false, confirme: true, envoye: false, libelle, relu, resume,
    erreur: alertText() || 'composeur toujours ouvert apres le clic — X n a rien garde',
  };
}

/**
 * Joint les medias : quatre images au maximum, ou une seule video.
 *
 * Le champ fichier de X accepte les deux familles ; c'est la ligne de commande
 * qui refuse un melange, avant meme que le composeur s'ouvre.
 *
 * `trace` est rempli au fur et a mesure : un rapport qui dit seulement
 * « zero image » ne distingue pas un champ introuvable d'un fichier refuse
 * ou d'une affectation ignoree. Chaque etape laisse donc sa marque.
 */
async function attachImages(images, trace = {}) {
  trace.recues = images?.length ?? 0;
  if (!images?.length) return 0;

  const field = await waitFor('fileField');
  trace.champTrouve = !!field;
  if (!field) throw new Error('champ fichier introuvable');
  trace.field = field.getAttribute('data-testid') || field.getAttribute('accept') || 'input';

  const dt = new DataTransfer();
  const maxi = images.some((m) => m.video) ? 1 : 4;
  const files = images.slice(0, maxi).map((img, i) => toFile(img.dataUrl, img.nom || `media-${i + 1}.png`));
  trace.construits = files.map((f) => ({ nom: f.name, type: f.type, bytes: f.size }));

  for (const f of files) {
    try { dt.items.add(f); } catch (e) { trace.addError = String(e.message || e); }
  }
  trace.dansDataTransfer = dt.files.length;

  // `files` est en lecture seule : seul un DataTransfer peut la remplacer.
  field.files = dt.files;
  trace.apresAffectation = field.files.length;

  field.dispatchEvent(new Event('change', { bubbles: true }));

  /*
   * ==On attend la vignette, on ne la suppose pas.==
   *
   * Le comptage se faisait apres une pause fixe d'environ deux secondes. Elle
   * suffisait a une image et pas a une video : X en lit les metadonnees et
   * fabrique une previsualisation avant de monter quoi que ce soit. Le meme
   * fichier passait un essai sur deux, et le rapport annoncait ==« images: 0 »==
   * pour une video pourtant acceptee par le champ — `apresAffectation: 1` et
   * `vignettesVisibles: 0` dans la meme trace.
   *
   * Le bouton d'envoi ne sert pas de temoin ici : il est deja actif des que le
   * texte est ecrit, donc il ne dit rien de l'etat du televersement.
   */
  const compterVignettes = () => document.querySelectorAll(
    '[data-testid="attachments"] img, [data-testid="attachments"] video, [aria-label*="Media"] img'
  ).length;

  const plafondVignette = images.some((m) => m.video) ? 120000 : 20000;
  const departVignette = Date.now();
  for (;;) {
    // Ce que X a reellement monte dans le composeur, et non ce qu'on lui a
    // tendu : c'est la seule mesure qui compte.
    trace.vignettesVisibles = compterVignettes();
    if (trace.vignettesVisibles) break;
    if (Date.now() - departVignette >= plafondVignette) break;
    await sleep(500);
  }
  trace.attenteVignette = Date.now() - departVignette;

  /*
   * La vignette parait avant la fin de la montee. Programmer a cet instant,
   * c'est confier a X un post dont le media est encore en cours d'envoi : on
   * laisse donc la barre de progression disparaitre avant de rendre la main.
   *
   * ==La barre se cherche dans la zone des pieces jointes, jamais dans le
   * document.== Le compteur de caracteres de X est lui aussi un
   * `role="progressbar"`, et il ne disparait jamais : la boucle brulait ses
   * deux minutes de plafond a chaque video, montee finie depuis longtemps.
   */
  const zonePieces = () => document.querySelector('[data-testid="attachments"]');
  const monteeEnCours = () => {
    const zone = zonePieces();
    return Boolean(zone && zone.querySelector('[role="progressbar"]'));
  };

  const departMontee = Date.now();
  while (monteeEnCours() && Date.now() - departMontee < plafondVignette) {
    await sleep(500);
  }
  trace.attenteMontee = Date.now() - departMontee;

  /*
   * On retournait `champ.files.length`. X vide la liste du champ des qu'il a
   * consomme l'evenement `change` : la valeur retombait a zero et le rapport
   * annoncait ==« images: 0 »== pour des images pourtant montees, ce que la
   * trace contredisait dans le meme objet. On retourne donc ce que X a
   * reellement affiche, la seule mesure qui vaille.
   */
  return trace.vignettesVisibles || field.files.length;
}

/**
 * Les pastilles « Add description » du composeur.
 *
 * On ne se fie pas a un seul `data-testid` : X le renomme, et la pastille est
 * un `div[role="button"]` plus souvent qu'un `<button>`, ce qui faisait
 * echouer le selecteur d'origine en silence. On ratisse donc les selecteurs
 * connus, puis on complete par nom accessible, ==limite a la zone des pieces
 * jointes== pour ne jamais cliquer un « Remove media » par megarde.
 */
function altButtons() {
  const seen = new Set();
  const out = [];

  /*
   * ==Chercher dans la modale, jamais dans le document.==
   *
   * Le balayage ci-dessous portait sur `document`. Sur `x.com/home` le
   * composeur est une modale posee sur le fil, qui compte des milliers de
   * liens et de boutons : chaque tour lisait le `textContent` de tout le fil
   * et forcait un recalcul de layout par element. Repete quatre-vingt-dix
   * fois par l'attente de la pastille, l'onglet se figeait — Chrome affichait
   * « Page ne repondant pas », et le canal de message mourait avec le
   * renderer. Le rapport parlait alors d'un worker arrete : c'etait la
   * consequence, pas la cause.
   *
   * La modale contient quelques dizaines d'elements. C'est la seule zone ou
   * la pastille puisse se trouver, et le cout devient negligeable.
   */
  const root =
    document.querySelector('[aria-modal="true"], [role="dialog"]') ||
    document.querySelector('[data-testid="primaryColumn"]') ||
    document;

  /*
   * ==Ne pas revenir a `offsetParent`.== Il vaut `null` pour tout element
   * place sous un ancetre `position: fixed` — ce qu'est la modale de
   * composition de X. Le test rejetait donc en silence des boutons
   * parfaitement visibles, et c'est la vraie raison pour laquelle aucun texte
   * alternatif n'a jamais ete pose : le selecteur d'origine portait deja ce
   * filtre. `getClientRects()` ne se laisse pas piéger par le positionnement.
   */
  const isVisible = (el) => el.getClientRects().length > 0;

  const push = (el) => {
    if (!el || seen.has(el) || !isVisible(el)) return;
    seen.add(el);
    out.push(el);
  };

  for (const s of SEL.altButton) root.querySelectorAll(s).forEach(push);

  /*
   * ==Constate sur capture, pas deduit== : X n'affiche pas de pastille ALT sur
   * la vignette. Le declencheur est un lien « Add description » place SOUS
   * l'image, a cote de « Tag people » — donc hors de `[data-testid="attachments"]`,
   * ou un premier repli allait le chercher pour rien.
   *
   * On balaie donc le document. Le mot « description » est assez specifique
   * pour qu'aucun autre controle du composeur ne reponde, et un clic errone
   * echouerait de toute facon proprement : le champ n'apparaitrait pas et la
   * boucle s'arreterait en le disant.
   */
  /*
   * ==Inclure `a` nu.== Mesure faite, pas supposee : apres 45 s d'attente,
   * l'inventaire de diagnostic listait bien « Add description », que ce
   * balayage ne voyait pas. La seule difference entre les deux requetes etait
   * `a[role="button"]` ici contre `a` la-bas — X expose donc ce declencheur
   * comme un lien sans role explicite, ce qu'aucun de mes trois selecteurs
   * successifs ne pouvait atteindre.
   */
  root.querySelectorAll('button, [role="button"], a').forEach((el) => {
    /*
     * L'ordre des tests compte : `aria-label` est une lecture d'attribut,
     * `textContent` une reconstruction de sous-arbre, et `getClientRects`
     * — dans `push` — un recalcul de layout. On ne paie donc le cher qu'apres
     * avoir elimine sur le bon marche.
     */
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('descri')) return push(el);

    const texte = (el.textContent || '').trim();
    if (texte.toLowerCase().includes('description') || texte.toUpperCase() === 'ALT') {
      push(el);
    }
  });

  return out;
}

/**
 * Renseigne les textes alternatifs, une image a la fois.
 *
 * Sans eux la publication reste illisible pour qui utilise un lecteur
 * d'ecran, et c'est le genre d'oubli qu'un automate reproduit a l'infini.
 */
async function writeAlts(alts, trace = {}) {
  trace.recues = alts?.length ?? 0;
  if (!alts?.length) return 0;
  let applied = 0;

  for (let i = 0; i < alts.length; i++) {
    const texte = alts[i];
    if (!texte) continue;

    /*
     * La pastille n'existe qu'une fois la vignette montee, et X prend son
     * temps. On sortait par `break` au premier coup d'oeil : le rapport
     * affichait ==0 alternative posee== sans jamais dire qu'il n'avait
     * trouve aucun bouton. On patiente, et surtout on note ce qu'on voit.
     */
    /*
     * ==Attendre la pastille elle-meme, et longtemps.==
     *
     * Trois hypotheses sont tombees avant celle-ci. La bonne, constatee sur
     * capture : « Add description » n'existe qu'une fois le media monte chez
     * X, et cela demande bien plus que les six secondes qu'on accordait. Le
     * bouton d'envoi ne sert pas de temoin — il reste actif pendant toute la
     * montee, `attenteEnvoi` valait 0 a chaque essai.
     *
     * On patiente donc jusqu'a 45 s, et on note le delai reel : c'est la
     * mesure qui manquait pour regler cette fenetre sans deviner.
     */
    /*
     * ==Un balayage lent doit s'arreter, pas ralentir la page.==
     *
     * Cette boucle rend la main entre deux tours, elle ne bloque donc pas par
     * elle-meme. Ce qui a fige l'onglet, c'est le cout d'un seul tour :
     * `altButtons` balayait le document entier avec un recalcul de layout par
     * element, soit plusieurs secondes de thread principal, quatre-vingt-dix
     * fois de suite. Le cadrage sur la modale ramene ce cout a rien.
     *
     * On mesure quand meme. Si un tour depasse ce budget, c'est que le cadrage
     * a saute — page differente, modale absente — et on prefere abandonner en
     * le disant plutot que de rendre l'onglet inutilisable. Une publication
     * sans alternative se rattrape ; un navigateur fige se subit.
     */
    const SWEEP_BUDGET_MS = 250;
    let buttons = [];
    let waited = 0;
    for (let attempt = 0; attempt < 90; attempt++) {
      const startedAt = performance.now();
      buttons = altButtons();
      const cost = performance.now() - startedAt;

      if (cost > SWEEP_BUDGET_MS) {
        trace.sweepCostMs = Math.round(cost);
        trace.arret = `balayage trop couteux (${Math.round(cout)} ms) — abandon avant de figer l'onglet`;
        buttons = [];
        break;
      }

      if (buttons.length > i) break;
      await sleep(500);
      waited = (attempt + 1) * 500;
    }
    trace.boutonsVus = buttons.length;
    trace.attenduMs = waited;

    if (!buttons[i]) {
      trace.arret = `aucune pastille de description pour l'image ${i + 1}`;
      /*
       * Diagnostic : on ne peut pas inspecter ce DOM a distance, et deux
       * selecteurs successifs ont echoue. Plutot qu'un troisieme pari, on
       * remonte l'inventaire des controles reellement visibles — le vrai
       * libelle de la pastille apparaitra dedans.
       */
      trace.pieces = !!document.querySelector('[data-testid="attachments"]');
      // Meme cadrage que `altButtons` : l'inventaire de diagnostic ne doit pas
      // reproduire le gel qu'il sert a expliquer.
      const modalRoot = document.querySelector('[aria-modal="true"], [role="dialog"]') || document;
      trace.candidates = Array.from(modalRoot.querySelectorAll('button, [role="button"], a'))
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => `${el.getAttribute('aria-label') || ''}|${(el.textContent || '').trim()}`.slice(0, 44))
        .filter((s) => s !== '|')
        .slice(0, 70);
      break;
    }

    buttons[i].click();
    const field = await waitFor('altField', 4000);
    if (!field) {
      trace.arret = `champ de description absent apres clic sur l'image ${i + 1}`;
      break;
    }

    field.focus();
    document.execCommand('insertText', false, texte);
    await sleep(200);
    // Ce que le champ porte vraiment : « clique puis fais confiance » est
    // exactement ce qui a laisse passer des posts sans alternative.
    trace.ecrit = (field.value ?? field.textContent ?? '').length;

    const confirmButton = find('altApplyButton');
    if (confirmButton) confirmButton.click();
    else trace.arret = 'bouton de validation de la description introuvable';
    await sleep(500);
    applied++;
  }
  return applied;
}

/** Clique Poster. Uniquement si l'appelant l'a demande explicitement. */
async function publier() {
  let button = null;
  for (let i = 0; i < 20 && !button; i++) { button = sendButton(); if (!button) await sleep(250); }
  if (!button) {
    // Distingue « pas de bouton » de « bouton grise » : le second veut dire
    // texte vide ou televersement en cours, et cela se corrige autrement.
    const existe = SEL.postButton.some((sel) => document.querySelector(sel));
    throw new Error(existe
      ? 'bouton Poster desactive — texte vide ou televersement en cours'
      : 'bouton Poster introuvable');
  }
  button.click();
  await sleep(1500);
  return true;
}

/** Enchainement complet. `publier` est toujours un choix conscient. */
async function compose({ texte, images, alts, publier: shouldPublish, comptesAutorises, programmerLe }) {
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
  const active = activeAccount();
  rapport.compte = active;

  if (comptesAutorises?.length) {
    /*
     * La page d'options enregistre des objets `{ id, pseudo }` — l'identifiant
     * numerique quand on a pu le detecter, le pseudo saisi a la main sinon.
     * On lisait chaque entree comme une chaine : `String(objet)` rendait
     * ==« [object Object] »==, que ni l'identifiant ni le pseudo ne pouvaient
     * egaler. Consequence exactement inverse de l'intention : des qu'un compte
     * etait inscrit, ==tous== les comptes etaient refuses, y compris le bon.
     * Seule une liste vide passait, parce qu'elle saute ce bloc.
     *
     * On aplatit donc les deux champs, et on accepte encore les entrees en
     * chaine au cas ou d'anciens reglages en contiendraient.
     */
    const expected = comptesAutorises
      .flatMap((c) => (typeof c === 'string' ? [c] : [c?.id, c?.pseudo]))
      .filter(Boolean)
      .map((v) => String(v).replace(/^@/, '').toLowerCase());
    const permis =
      (active.id && expected.includes(active.id)) ||
      (active.pseudo && expected.includes(active.pseudo.toLowerCase()));

    if (!permis) {
      rapport.refus = active.id || active.pseudo
        ? `compte non autorise : ${actif.pseudo ? '@' + actif.pseudo : ''} ${actif.id || ''}`.trim()
        : 'compte indeterminable — session absente ?';
      return rapport;
    }
  }

  const ecriture = await writeText(texte);
  rapport.texte = ecriture.ok;
  rapport.ecriture = ecriture;

  // Sans texte conforme, on ne joint rien et on ne publie surtout pas : mieux
  // vaut un composeur vide qu une publication de travers.
  if (!ecriture.ok) return rapport;
  rapport.trace = {};
  rapport.images = await attachImages(images, rapport.trace);

  /*
   * ==L'attente du televersement vient avant les alternatives, pas apres.==
   * La vignette s'affiche des le choix du fichier, mais « Add description »
   * n'apparait qu'une fois le media monte chez X. On la cherchait donc dans
   * une page ou elle n'existait pas encore, et le rapport concluait a son
   * absence. Le bouton d'envoi, inactif pendant la montee, sert de temoin.
   */
  rapport.attenteEnvoi = 0;
  if (images?.length) {
    /*
     * Une video ne monte pas au rythme d'une image : X la transcode avant de
     * reactiver le bouton d'envoi. Les vingt secondes qui suffisaient aux
     * images laissaient une video a mi-chemin, et le composeur repartait avec
     * une piece jointe incomplete.
     */
    const tours = images.some((m) => m.video) ? 240 : 40;
    for (let i = 0; i < tours && !sendButton(); i++) {
      await sleep(500);
      rapport.attenteEnvoi = (i + 1) * 500;
    }
  }

  rapport.traceAlt = {};
  rapport.alts = await writeAlts(alts, rapport.traceAlt);

  /*
   * L'horaire vient apres les images : le formulaire de X ouvre une couche
   * par-dessus le composeur, et le champ fichier n'y est plus atteignable.
   *
   * Programmer chez X, c'est publier sans surveillance — donc soumis a la
   * meme autorisation que le clic « Post ». Sans elle, l'heure est saisie et
   * la confirmation attend.
   */
  if (programmerLe) {
    // L'attente du televersement a deja eu lieu plus haut : programmer trop
    // tot faisait repondre a X « The content of your post is invalid ».
    rapport.horaire = await scheduleAtX(programmerLe, shouldPublish);
    // « Programme » veut dire parti chez X, pas « heure saisie » : c est la
    // difference que le premier essai avait effacee.
    rapport.programme = rapport.horaire.envoye === true;
    return rapport;
  }

  if (shouldPublish) rapport.publie = await publier();

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
    const area = find('textArea');
    sendResponse({ ok: true, present: !!area, vide: !area || currentText(area) === '' });
    return true;
  }

  // Sert a la page d'options : « ajoute le compte ou je suis connecte »,
  // plutot que de demander a quelqu'un de retrouver son identifiant numerique.
  if (message?.action === 'xposterCompte') {
    sendResponse({ ok: true, ...activeAccount() });
    return true;
  }

  if (message?.action !== 'xposterComposer') return;

  compose(message.charge)
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

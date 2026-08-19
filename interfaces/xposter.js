/*
 * xposter.js — Ecran dedie au module de publication X.
 *
 * Il ne pilote rien : il lit l'etat que le service worker entretient dans le
 * stockage local et le rend lisible. La seule action offerte est la capture
 * d'ecran, et l'annulation d'une publication qui n'est pas encore partie.
 */

const DELAI_PERTE = 150000; // deux tours de sonde, plus une marge

const ETATS = {
  'en attente': ['attente', 'programmée'],
  prepare: ['ok', 'préparée'],
  publie: ['ok', 'publiée'],
  echec: ['err', 'échec'],
  manquee: ['err', 'manquée'],
};

const el = (id) => document.getElementById(id);

const quand = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }) +
         ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

/** « Dans 3 h », « il y a 12 min » — plus parlant qu'un horodatage brut. */
function relatif(ms) {
  const delta = ms - Date.now();
  const abs = Math.abs(delta);
  const min = Math.round(abs / 60000);
  if (min < 1) return delta >= 0 ? 'imminent' : "à l'instant";
  const texte = min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
  return delta >= 0 ? `dans ${texte}` : `il y a ${texte}`;
}

function carte(p) {
  const [classe, libelle] = ETATS[p.etat] || ['attente', p.etat || '—'];
  const div = document.createElement('div');
  div.className = 'xp-item';

  // Une entree en attente porte encore ses octets ; une entree passee n'a
  // plus que leur compte.
  const nbImages = (p.images || []).length || p.nbImages || 0;
  const date = p.etat === 'en attente' ? p.quand : (p.execute || p.quand);

  const meta = [
    quand(date),
    `(${relatif(date)})`,
    nbImages ? `${nbImages} image${nbImages > 1 ? 's' : ''}` : 'sans image',
    p.publier ? 'publication demandée' : 'préparation seule',
  ].join(' · ');

  div.innerHTML =
    `<span class="xp-etat ${classe}">${libelle}</span>` +
    `<div class="xp-corps">` +
      `<div class="xp-texte"></div>` +
      `<div class="xp-meta">${meta}</div>` +
      (p.rapport?.erreur ? `<div class="xp-erreur"></div>` : '') +
    `</div>`;

  // Texte insere via textContent : il vient d'un fichier local, mais rien ne
  // justifie de l'interpreter comme du HTML.
  div.querySelector('.xp-texte').textContent = p.texte || '(sans texte)';
  if (p.rapport?.erreur) div.querySelector('.xp-erreur').textContent = p.rapport.erreur;

  if (p.etat === 'en attente') {
    const annuler = document.createElement('button');
    annuler.className = 'xp-btn';
    annuler.textContent = 'Annuler';
    annuler.addEventListener('click', async () => {
      annuler.disabled = true;
      await chrome.runtime.sendMessage({ action: 'xposterAnnuler', id: p.id });
      rafraichir();
    });
    div.appendChild(annuler);
  }

  return div;
}

function remplir(conteneur, entrees, vide) {
  conteneur.innerHTML = '';
  if (!entrees.length) {
    const p = document.createElement('p');
    p.className = 'xp-vide';
    p.textContent = vide;
    conteneur.appendChild(p);
    return;
  }
  entrees.forEach((e) => conteneur.appendChild(carte(e)));
}

function rendre(cfg, local, composeurs) {
  const contact = local.xposterDernierContact || 0;
  const vivant = Date.now() - contact < DELAI_PERTE;

  el('xp-pastille').className = 'xp-pastille ' + (vivant ? 'vivant' : 'mort');

  if (!cfg.enableXPoster) {
    el('xp-pont-titre').textContent = 'Module désactivé';
    el('xp-pont-detail').textContent = 'À cocher dans les paramètres.';
  } else if (!cfg.xposterToken) {
    el('xp-pont-titre').textContent = 'Aucun jeton';
    el('xp-pont-detail').textContent = 'Génère-le dans les paramètres.';
  } else if (vivant) {
    el('xp-pont-titre').textContent = 'Pont connecté';
    el('xp-pont-detail').textContent = `port ${cfg.xposterPort} · dernier échange ${relatif(contact)}`;
  } else {
    el('xp-pont-titre').textContent = 'Pont absent';
    el('xp-pont-detail').textContent = contact
      ? `dernier échange ${relatif(contact)} — le serveur local tourne-t-il ?`
      : 'jamais connecté — lance le serveur local.';
  }

  /*
   * La capture ne passe pas par le pont : c'est le navigateur qui photographie
   * son propre onglet. Ce qu'il lui faut, c'est un composeur ouvert — la lier
   * a l'etat du serveur local grisait un bouton parfaitement utilisable.
   */
  const bouton = el('xp-capturer');
  bouton.disabled = composeurs.length === 0;
  bouton.title = composeurs.length
    ? "Photographier le composeur X"
    : "Aucun composeur X ouvert";

  const file = local.xposterFile || [];
  const attente = file.filter((p) => p.etat === 'en attente').sort((a, b) => a.quand - b.quand);
  const finies = file.filter((p) => p.etat !== 'en attente').sort((a, b) => (b.execute || 0) - (a.execute || 0));

  el('xp-n-attente').textContent = attente.length;
  el('xp-n-ok').textContent = finies.filter((p) => p.etat === 'prepare' || p.etat === 'publie').length;
  // Une echeance manquee compte parmi les ratees : elle n a rien produit.
  el('xp-n-echec').textContent = finies.filter((p) => p.etat === 'echec' || p.etat === 'manquee').length;

  remplir(el('xp-attente'), attente, 'Rien de programmé.');
  remplir(el('xp-historique'), finies, 'Rien encore.');

  el('xp-note').textContent =
    "La file vit dans l'extension : une publication programmée part même si le serveur local est éteint, tant que le navigateur tourne. " +
    (cfg.xposterAutoriserPublication
      ? 'La publication automatique est autorisée.'
      : 'La publication automatique est refusée : les demandes sont préparées, le clic final reste à toi.');
}

function rafraichir() {
  chrome.storage.sync.get(
    { enableXPoster: false, xposterToken: '', xposterPort: 8787, xposterAutoriserPublication: false },
    (cfg) => {
      chrome.storage.local.get({ xposterDernierContact: 0, xposterFile: [] }, async (local) => {
        const composeurs = await chrome.tabs.query({
          url: ['https://x.com/compose/post*', 'https://twitter.com/compose/post*'],
        });
        rendre(cfg, local, composeurs);
      });
    }
  );
}

el('xp-capturer').addEventListener('click', async function () {
  this.disabled = true;
  const avant = this.textContent;
  this.textContent = 'Capture…';
  try {
    /*
     * C'est le service worker qui photographie, pas cette page : au moment du
     * clic, l'onglet actif est celui-ci. Lui seul peut designer le composeur
     * et le ramener au premier plan.
     */
    const r = await chrome.runtime.sendMessage({ action: 'xposterCapturer' });
    if (!r || !r.ok) throw new Error(r && r.erreur ? r.erreur : 'capture refusée');

    el('xp-cliche-img').src = r.dataUrl;
    el('xp-cliche-quand').textContent = new Date().toLocaleTimeString('fr-FR');
    // Un onglet ne peut pas naviguer vers une data: URL — le lien passe donc
    // par un blob, qui lui s'ouvre.
    const blob = await (await fetch(r.dataUrl)).blob();
    const lien = el('xp-cliche-lien');
    if (lien.dataset.url) URL.revokeObjectURL(lien.dataset.url);
    lien.href = lien.dataset.url = URL.createObjectURL(blob);
    el('xp-cliche').hidden = false;
    this.textContent = avant;
  } catch (err) {
    console.error('[XPoster]', err);
    this.textContent = 'Échec';
    setTimeout(() => { this.textContent = avant; }, 1600);
  }
  this.disabled = false;
});

el('xp-cliche-fermer').addEventListener('click', () => {
  el('xp-cliche').hidden = true;
});

rafraichir();
setInterval(rafraichir, 3000);
chrome.storage.onChanged.addListener(rafraichir);

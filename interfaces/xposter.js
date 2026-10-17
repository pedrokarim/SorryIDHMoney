/*
 * xposter.js – Écran dédié au module de publication X.
 *
 * Il ne pilote rien : il lit l'état que le service worker entretient dans le
 * stockage local et le rend lisible. Les seules actions offertes sont la
 * capture d'écran, l'annulation d'une publication pas encore partie et la
 * relance d'une publication passée.
 *
 * Les champs des publications (`etat`, `quand`, `texte`, `rapport`…) et les
 * noms d'action (`xposterAnnuler`…) sont ceux du module XPoster : ils
 * franchissent la frontière avec le service worker et l'outil local.
 */

const LOST_AFTER_MS = 150000; // deux tours de sonde, plus une marge

const STATES = {
  'en attente': ['warn', 'programmée'],
  prepare: ['ok', 'préparée'],
  publie: ['ok', 'publiée'],
  echec: ['err', 'échec'],
  manquee: ['err', 'manquée'],
  'confie a X': ['ok', 'chez X'],
};

const $ = (id) => document.getElementById(id);
const { el, flash } = window.UI;

const formatWhen = (ms) => {
  if (!ms) return '–';
  const d = new Date(ms);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }) +
    ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

/** « Dans 3 h », « il y a 12 min » : plus parlant qu'un horodatage brut. */
function relative(ms) {
  const delta = ms - Date.now();
  const minutes = Math.round(Math.abs(delta) / 60000);
  if (minutes < 1) return delta >= 0 ? 'imminent' : "à l'instant";
  const span = minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
  return delta >= 0 ? `dans ${span}` : `il y a ${span}`;
}

function postRow(post) {
  const [kind, label] = STATES[post.etat] || ['', post.etat || '–'];
  const row = el('div', 'row post-row');

  // Une entrée en attente porte encore ses octets ; une entrée passée n'a
  // plus que leur compte.
  const imageCount = (post.images || []).length || post.nbImages || 0;
  const date = post.etat === 'en attente' ? post.quand : (post.execute || post.quand);
  const meta = [
    `${formatWhen(date)} (${relative(date)})`,
    imageCount ? `${imageCount} image${imageCount > 1 ? 's' : ''}` : 'sans image',
    post.publier ? 'publication demandée' : 'préparation seule',
  ].join(' · ');

  const text = el('div', 'row-text');
  // textContent : le texte vient d'un fichier local, rien ne justifie de
  // l'interpréter comme du HTML.
  text.append(el('div', 'post-text', post.texte || '(sans texte)'), el('div', 'row-desc', meta));
  if (post.rapport?.erreur) text.appendChild(el('div', 'post-error', post.rapport.erreur));

  row.append(el('span', 'badge ' + kind, label), text);

  if (post.etat === 'en attente') {
    const cancel = el('button', 'btn btn-sm', 'Annuler');
    cancel.type = 'button';
    cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      await chrome.runtime.sendMessage({ action: 'xposterAnnuler', id: post.id });
      refresh();
    });
    row.appendChild(cancel);
  } else {
    /*
     * Une composition peut partir de travers sans que rien n'ait échoué : le
     * navigateur était sur un autre compte, une image n'a pas suivi. Le
     * rapport dit « préparée », et pourtant c'est à refaire.
     */
    const bytesLost = !(post.images || []).length && post.nbImages > 0;
    const replay = el('button', 'btn btn-sm', 'Relancer');
    replay.type = 'button';
    replay.disabled = bytesLost;
    replay.title = bytesLost
      ? "Images purgées de l'historique – à redéposer depuis l'outil"
      : 'Rouvrir le composeur avec cette publication';
    replay.addEventListener('click', async () => {
      replay.disabled = true;
      replay.textContent = 'Relance…';
      const r = await chrome.runtime.sendMessage({ action: 'xposterRelancer', id: post.id });
      if (!r?.ok) {
        replay.textContent = 'Échec';
        console.error('[XPoster]', r?.erreur);
      }
      refresh();
    });
    row.appendChild(replay);
  }
  return row;
}

function fill(container, posts, emptyText) {
  if (!posts.length) {
    container.replaceChildren(el('div', 'empty', emptyText));
    return;
  }
  container.replaceChildren(...posts.map(postRow));
}

function render(cfg, local, composers) {
  const contact = local.xposterDernierContact || 0;
  const alive = Date.now() - contact < LOST_AFTER_MS;
  $('xp-dot').className = 'dot ' + (cfg.enableXPoster && cfg.xposterToken ? (alive ? 'ok' : 'err') : '');

  let title;
  let detail;
  if (!cfg.enableXPoster) {
    title = 'Module désactivé';
    detail = 'À cocher dans les paramètres.';
  } else if (!cfg.xposterToken) {
    title = 'Aucun jeton';
    detail = 'Génère-le dans les paramètres.';
  } else if (alive) {
    title = 'Pont connecté';
    detail = `Port ${cfg.xposterPort} · dernier échange ${relative(contact)}`;
  } else {
    title = 'Pont absent';
    detail = contact
      ? `Dernier échange ${relative(contact)} – le serveur local tourne-t-il ?`
      : 'Jamais connecté – lance le serveur local.';
  }
  $('xp-bridge-title').textContent = title;
  $('xp-bridge-detail').textContent = detail;

  /*
   * La capture ne passe pas par le pont : c'est le navigateur qui photographie
   * son propre onglet. Ce qu'il lui faut, c'est un composeur ouvert.
   */
  const capture = $('xp-capture');
  if (!capture.dataset.busy) capture.disabled = composers.length === 0;
  capture.title = composers.length ? 'Photographier le composeur X' : 'Aucun composeur X ouvert';

  const queue = local.xposterFile || [];
  const waiting = queue.filter((p) => p.etat === 'en attente').sort((a, b) => a.quand - b.quand);
  const done = queue.filter((p) => p.etat !== 'en attente').sort((a, b) => (b.execute || 0) - (a.execute || 0));

  $('xp-n-waiting').textContent = waiting.length;
  $('xp-n-ok').textContent = done.filter((p) => p.etat === 'prepare' || p.etat === 'publie').length;
  // Une échéance manquée compte parmi les ratées : elle n'a rien produit.
  $('xp-n-failed').textContent = done.filter((p) => p.etat === 'echec' || p.etat === 'manquee').length;

  fill($('xp-waiting'), waiting, 'Rien de programmé.');
  fill($('xp-history'), done, 'Rien encore.');

  $('xp-note').textContent =
    "La file vit dans l'extension : une publication programmée part même si le serveur local est éteint, tant que le navigateur tourne. " +
    (cfg.xposterAutoriserPublication
      ? 'La publication automatique est autorisée.'
      : 'La publication automatique est refusée : les demandes sont préparées, le clic final reste à toi.');
}

function refresh() {
  chrome.storage.sync.get(
    { enableXPoster: false, xposterToken: '', xposterPort: 8787, xposterAutoriserPublication: false },
    (cfg) => {
      chrome.storage.local.get({ xposterDernierContact: 0, xposterFile: [] }, async (local) => {
        const composers = await chrome.tabs.query({
          url: ['https://x.com/compose/post*', 'https://twitter.com/compose/post*'],
        });
        render(cfg, local, composers);
      });
    }
  );
}

$('xp-capture').addEventListener('click', async function () {
  this.disabled = true;
  this.dataset.busy = '1';
  flash(this, 'Capture…', 15000);
  try {
    /*
     * C'est le service worker qui photographie, pas cette page : au moment du
     * clic, l'onglet actif est celui-ci. Lui seul peut désigner le composeur
     * et le ramener au premier plan.
     */
    const r = await chrome.runtime.sendMessage({ action: 'xposterCapturer' });
    if (!r || !r.ok) throw new Error(r && r.erreur ? r.erreur : 'capture refusée');

    $('xp-snapshot-img').src = r.dataUrl;
    $('xp-snapshot-time').textContent = 'Capturé à ' + new Date().toLocaleTimeString('fr-FR');
    // Un onglet ne peut pas naviguer vers une data: URL : le lien passe donc
    // par un blob, qui lui s'ouvre.
    const blob = await (await fetch(r.dataUrl)).blob();
    const link = $('xp-snapshot-link');
    if (link.dataset.url) URL.revokeObjectURL(link.dataset.url);
    link.href = link.dataset.url = URL.createObjectURL(blob);
    $('xp-snapshot').hidden = false;
    flash(this, 'Capturé');
  } catch (err) {
    console.error('[XPoster]', err);
    flash(this, 'Échec', 1600);
  }
  delete this.dataset.busy;
  this.disabled = false;
});

$('xp-snapshot-close').addEventListener('click', () => {
  $('xp-snapshot').hidden = true;
});

refresh();
setInterval(refresh, 3000);
chrome.storage.onChanged.addListener(refresh);

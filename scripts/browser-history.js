/*
 * browser-history.js – Le journal du pont navigateur.
 *
 * Chaque ordre exécuté laisse une ligne : quoi, sur quelle page, avec quel
 * résultat. C'est ce que montrent la pastille posée sur la page, la popup et
 * l'écran dédié. Le contenu relevé n'y figure pas – seulement son poids – à
 * une exception près : une vignette pour les captures, parce que « on a pris
 * une capture » ne dit rien tant qu'on ne voit pas de quoi.
 */

export const HISTORY_KEY = 'browserBridgeHistory';

/** Au-delà, les plus anciennes lignes sont oubliées. */
const MAX_ENTRIES = 300;

const THUMBNAIL_WIDTH = 320;

/*
 * Les écritures passent l'une derrière l'autre : deux ordres qui finissent en
 * même temps liraient sinon le même journal, et le second écraserait la ligne
 * du premier.
 */
let writing = Promise.resolve();

export async function readHistory() {
  const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return stored[HISTORY_KEY];
}

export function record(entry) {
  writing = writing
    .then(async () => {
      const history = await readHistory();
      history.unshift(entry);
      await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, MAX_ENTRIES) });
    })
    .catch((err) => console.error('[BrowserBridge] journal non écrit', err));
  return writing;
}

/** Les dernières lignes qui concernent un site, pour la pastille de la page. */
export async function historyForHost(host, limit = 30) {
  return (await readHistory()).filter((entry) => entry.host === host).slice(0, limit);
}

export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/** Réduit une capture à une vignette JPEG légère. Rend `null` si ça échoue. */
export async function thumbnail(dataUrl) {
  try {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const scale = Math.min(1, THUMBNAIL_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    // Une page entière peut faire dix écrans de haut : on ne garde que le haut.
    const height = Math.round(Math.min(bitmap.height, bitmap.width * 1.5) * scale);

    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, bitmap.width, height / scale, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { dataUrl: `data:image/jpeg;base64,${btoa(binary)}`, width: bitmap.width, height: bitmap.height };
  } catch {
    return null;
  }
}

const count = (n, singular, plural) => `${n.toLocaleString('fr-FR')} ${n > 1 ? plural : singular}`;

/** Une phrase courte qui dit ce que l'ordre a rapporté. */
export function summarize(action, result) {
  if (!result) return '';
  switch (action) {
    case 'read': {
      const frames = result.frames?.length ? ` + ${count(result.frames.length, 'cadre', 'cadres')}` : '';
      const cut = result.truncated ? ' (tronqué)' : '';
      return `${count(result.length || 0, 'caractère', 'caractères')}${frames}${cut}`;
    }
    case 'query':
      return `${count(result.total || 0, 'élément', 'éléments')}`;
    case 'network':
      return `${count(result.total || 0, 'requête', 'requêtes')}`;
    case 'inspect':
      return `${count(result.total || 0, 'requête', 'requêtes')}`
        + (result.console ? `, ${count(result.console.length, 'message', 'messages')} de console` : '');
    case 'screenshot':
      return result.full ? 'page entière' : result.cropped ? 'un élément' : 'écran visible';
    case 'storage':
      return `${count(result.total || 0, 'clé', 'clés')}`;
    case 'fetch':
      return result.binary
        ? `HTTP ${result.status}, binaire`
        : `HTTP ${result.status}, ${count(result.length || 0, 'caractère', 'caractères')}`;
    case 'tabs':
      return `${count(result.length || 0, 'onglet', 'onglets')}`;
    default:
      return '';
  }
}

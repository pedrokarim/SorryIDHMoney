/**
 * Notifications (« toasts ») posées par l'extension sur les sites.
 *
 * Tout vit dans un Shadow DOM : le CSS du site ne peut ni déformer les
 * toasts, ni être touché par eux. Le message est inséré en texte, jamais
 * interprété comme du HTML.
 *
 *   showToast('Auto-scroll activé', { type: 'info', duration: 1800 })
 *
 * Options : type ('success' | 'error' | 'warning' | 'info'), duration en ms
 * (0 = reste jusqu'à fermeture), position ('top-right' par défaut, ou
 * top-left, top-center, bottom-left, bottom-center, bottom-right) et buttons
 * ([{ text, onClick }]).
 */
import { BRAND, BRAND_SYMBOL_PATH } from '../scripts/brand.js';

const HOST_ID = 'sorryidhmoney-toasts';

const TYPES = {
  success: { color: BRAND.ok, label: 'Succès', icon: '<path d="M20 6L9 17l-5-5"/>' },
  error: { color: BRAND.danger, label: 'Erreur', icon: '<path d="M18 6L6 18M6 6l12 12"/>' },
  warning: { color: BRAND.gold, label: 'Attention', icon: '<path d="M12 8v5M12 16.5h.01"/>' },
  info: { color: BRAND.info, label: 'Info', icon: '<path d="M12 11v5M12 7.5h.01"/>' },
};

const POSITIONS = {
  'top-left': 'top:16px;left:16px;align-items:flex-start;',
  'top-center': 'top:16px;left:50%;transform:translateX(-50%);align-items:center;',
  'top-right': 'top:16px;right:16px;align-items:flex-end;',
  'bottom-left': 'bottom:16px;left:16px;align-items:flex-start;flex-direction:column-reverse;',
  'bottom-center': 'bottom:16px;left:50%;transform:translateX(-50%);align-items:center;flex-direction:column-reverse;',
  'bottom-right': 'bottom:16px;right:16px;align-items:flex-end;flex-direction:column-reverse;',
};

const STYLE = `
  :host { all: initial; }
  .stack {
    position: fixed;
    z-index: 2147483646;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: calc(100vw - 32px);
    pointer-events: none;
    font-family: ${BRAND.font};
  }
  .toast {
    pointer-events: auto;
    box-sizing: border-box;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 340px;
    max-width: 100%;
    padding: 10px 10px 10px 12px;
    border-radius: ${BRAND.radius};
    background: ${BRAND.surface};
    border: 1px solid ${BRAND.border};
    box-shadow: ${BRAND.shadow};
    color: ${BRAND.text};
    font-size: 13px;
    line-height: 1.4;
    opacity: 0;
    transform: translateY(-6px) scale(0.98);
    transition: opacity .2s ease, transform .2s ease;
  }
  .stack.bottom .toast { transform: translateY(6px) scale(0.98); }
  .toast.shown { opacity: 1; transform: none; }
  .badge {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--c) 18%, transparent);
    color: var(--c);
  }
  .badge svg {
    width: 15px; height: 15px;
    fill: none; stroke: currentColor; stroke-width: 2.6;
    stroke-linecap: round; stroke-linejoin: round;
  }
  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding-top: 3px; }
  .brand {
    display: flex; align-items: center; gap: 5px;
    font-size: 10.5px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase;
    color: ${BRAND.faint};
  }
  .brand svg { width: 10px; height: 10px; }
  .message { overflow-wrap: anywhere; white-space: pre-line; }
  .actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
  .actions button {
    font: inherit; font-size: 12px; font-weight: 600;
    height: 26px; padding: 0 10px; border-radius: 7px; cursor: pointer;
    border: 1px solid ${BRAND.surface3}; background: ${BRAND.surface2}; color: ${BRAND.text};
  }
  .actions button.primary { background: ${BRAND.gold}; border-color: ${BRAND.gold}; color: ${BRAND.onGold}; }
  .close {
    flex: 0 0 auto;
    width: 24px; height: 24px; border-radius: 6px;
    display: grid; place-items: center;
    border: 0; background: transparent; color: ${BRAND.faint}; cursor: pointer;
  }
  .close:hover { background: ${BRAND.surface2}; color: ${BRAND.text}; }
  .close svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; }
  button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(255, 194, 51, .55); }
  @media (prefers-reduced-motion: reduce) {
    .toast { transition: opacity .15s linear; transform: none !important; }
  }
`;

class ToastManager {
  constructor() {
    this.host = null;
    this.stack = null;
    this.position = 'top-right';
  }

  /** Crée l'hôte au premier toast seulement : rien n'est posé sur la page avant. */
  ensureHost() {
    if (this.host && this.host.isConnected) return;
    this.host = document.createElement('div');
    this.host.id = HOST_ID;
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.stack = document.createElement('div');
    this.stack.setAttribute('role', 'status');
    this.stack.setAttribute('aria-live', 'polite');
    root.append(style, this.stack);
    (document.body || document.documentElement).appendChild(this.host);
    this.applyPosition();
  }

  applyPosition() {
    this.stack.className = 'stack' + (this.position.startsWith('bottom') ? ' bottom' : '');
    this.stack.style.cssText = POSITIONS[this.position] || POSITIONS['top-right'];
  }

  setPosition(position) {
    this.position = POSITIONS[position] ? position : 'top-right';
    if (this.stack) this.applyPosition();
  }

  svg(paths) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', '0 0 24 24');
    node.setAttribute('aria-hidden', 'true');
    // Chaînes constantes de ce module, jamais de donnée extérieure.
    node.innerHTML = paths;
    return node;
  }

  show(message, options = {}) {
    const { type = 'info', duration = 3000, position, buttons = [] } = options;
    if (position) this.setPosition(position);
    this.ensureHost();

    const kind = TYPES[type] || TYPES.info;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.setProperty('--c', kind.color);

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.appendChild(this.svg(kind.icon));

    const body = document.createElement('div');
    body.className = 'body';
    const brand = document.createElement('div');
    brand.className = 'brand';
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('viewBox', '0 0 256 256');
    mark.setAttribute('aria-hidden', 'true');
    const markPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    markPath.setAttribute('fill', BRAND.gold);
    markPath.setAttribute('d', BRAND_SYMBOL_PATH);
    mark.appendChild(markPath);
    brand.append(mark, document.createTextNode('SorryIDHMoney'));
    const text = document.createElement('div');
    text.className = 'message';
    text.textContent = String(message);
    body.append(brand, text);

    if (buttons.length) {
      const actions = document.createElement('div');
      actions.className = 'actions';
      for (const button of buttons) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = button.text;
        if (button.type === 'primary') b.className = 'primary';
        b.addEventListener('click', () => {
          if (typeof button.onClick === 'function') button.onClick();
          this.remove(toast);
        });
        actions.appendChild(b);
      }
      body.appendChild(actions);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('aria-label', 'Fermer');
    close.appendChild(this.svg('<path d="M18 6L6 18M6 6l12 12"/>'));
    close.addEventListener('click', () => this.remove(toast));

    toast.append(badge, body, close);
    this.stack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('shown'));

    // Survolé, il reste : on laisse le temps de lire.
    let timer = null;
    const arm = () => {
      if (duration > 0) timer = setTimeout(() => this.remove(toast), duration);
    };
    toast.addEventListener('mouseenter', () => clearTimeout(timer));
    toast.addEventListener('mouseleave', arm);
    arm();

    return toast;
  }

  remove(toast) {
    if (!toast.isConnected || toast.dataset.leaving) return;
    toast.dataset.leaving = '1';
    toast.classList.remove('shown');
    setTimeout(() => {
      toast.remove();
      if (this.stack && !this.stack.children.length) {
        this.host.remove();
        this.host = null;
        this.stack = null;
      }
    }, 220);
  }
}

const toastManager = new ToastManager();

/** Affiche un toast si les notifications sont activées dans les paramètres. */
export function showToast(message, options = {}) {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ enableToasts: true }, (items) => {
      if (!items.enableToasts) {
        console.log('[Toast désactivé]', message, options);
        resolve(null);
        return;
      }
      resolve(toastManager.show(message, options));
    });
  });
}

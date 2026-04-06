console.log("[Global content] Global content loaded :3");

// Site autorisé pour scroll-lock et roulette : hostname en base64 (ex: www.sex.com → d3d3LnNleC5jb20=)
const ALLOWED_HOST_B64 = 'd3d3LnNleC5jb20=';
function isAllowedSite() {
  try {
    const host = typeof location !== 'undefined' && location.hostname ? location.hostname : '';
    return host && btoa(host) === ALLOWED_HOST_B64;
  } catch (_) {
    return false;
  }
}

// Sélecteurs pour l'overlay de consentement cookies/18+ (ex: Sex.com)
const COOKIE_CONSENT_OVERLAY_SELECTORS = [
  'div.fixed.inset-0[class*="backdrop-blur-lg"][class*="bg-dark"]',
  'div[class*="cookie-consent-required"][class*="backdrop-blur"]',
  'div.fixed.inset-0.bg-dark\\/60.backdrop-blur-lg',
];

function removeCookieConsentOverlay() {
  for (const selector of COOKIE_CONSENT_OVERLAY_SELECTORS) {
    const overlays = document.querySelectorAll(selector);
    overlays.forEach((el) => {
      if (el.closest('body')) {
        el.remove();
      }
    });
  }
  // Fallback: div fixed plein écran avec data-state="open" et z-index élevé (bandeau consentement)
  document.querySelectorAll('div.fixed.inset-0[data-state="open"]').forEach((el) => {
    const style = getComputedStyle(el);
    if (parseInt(style.zIndex, 10) >= 999 && el.closest('body')) {
      el.remove();
    }
  });
}

// --- HTML/CSS : éléments qui bloquent le scroll ---
// 1. <html> : overflow hidden, position fixed, height 100%, touch-action none
// 2. <body> : idem + classe "fixed"
// 3. Enfants directs de <body> : wrapper type div.min-h-screen.overflow-hidden ou div.flex.min-h-screen-dvh
//    avec overflow hidden / overflow-y hidden (le scroll se fait sur la fenêtre, pas dans le wrapper)
// 4. Classes Tailwind/CSS : overflow-hidden, overflow-y-hidden, overflow-x-hidden, scroll-lock, etc.
// 5. Attributs : data-scroll-locked, data-lock-scroll (souvent sur body)

const SCROLL_LOCK_CLASSES = [
  'no-scroll',
  'overflow-hidden',
  'overflow-y-hidden',
  'overflow-x-hidden',
  'scroll-lock',
  'scroll-locked',
  'body-scroll-lock',
  'modal-open',
  'dialog-open',
  'popover-open',
  'menu-open',
  'fixed',
];

const SCROLL_LOCK_ATTRIBUTES = ['data-scroll-locked', 'data-lock-scroll'];

// Réactive le scroll sur un élément (html, body ou enfant direct de body)
function unlockElementScroll(el) {
  SCROLL_LOCK_CLASSES.forEach((cls) => {
    if (el.classList && el.classList.contains(cls)) el.classList.remove(cls);
  });
  const styles = {
    overflow: 'auto',
    overflowX: 'auto',
    overflowY: 'auto',
    pointerEvents: 'auto',
    touchAction: 'auto',
  };
  if (el === document.documentElement) {
    Object.assign(el.style, { ...styles, height: 'auto', minHeight: '100%', position: 'relative', top: 'auto', left: 'auto', right: 'auto', bottom: 'auto', width: '100%' });
  } else if (el === document.body) {
    Object.assign(el.style, { ...styles, height: 'auto', minHeight: 'auto', position: 'relative', top: 'auto', left: 'auto', right: 'auto', bottom: 'auto', width: '100%' });
  } else {
    Object.assign(el.style, styles);
  }
  const computed = getComputedStyle(el);
  if (computed.overflow === 'hidden' || computed.overflowY === 'hidden') {
    el.style.setProperty('overflow', 'auto', 'important');
    el.style.setProperty('overflow-y', 'auto', 'important');
  }
  if (computed.position === 'fixed' && (el === document.body || el === document.documentElement)) {
    el.style.setProperty('position', 'relative', 'important');
  }
}

// Réactive le scroll en neutralisant tout ce qui le bloque (html, body, enfants directs de body)
function reenableScroll() {
  const html = document.documentElement;
  const body = document.body;
  if (!body) return;

  // 1. Supprimer les attributs de verrouillage (html + body)
  SCROLL_LOCK_ATTRIBUTES.forEach((attr) => {
    body.removeAttribute(attr);
    html.removeAttribute(attr);
  });

  // 2. Débloquer html et body
  unlockElementScroll(html);
  unlockElementScroll(body);

  // 3. Enfants directs de body : souvent le wrapper principal (ex: div.min-h-screen-dvh.overflow-hidden)
  //    qui bloque le scroll de la fenêtre
  for (const child of body.children) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const computed = getComputedStyle(child);
    const hasOverflowHidden = computed.overflow === 'hidden' || computed.overflowY === 'hidden';
    const hasScrollLockClass = SCROLL_LOCK_CLASSES.some((cls) => child.classList && child.classList.contains(cls));
    if (hasOverflowHidden || hasScrollLockClass) {
      unlockElementScroll(child);
    }
  }
}

// Fonction pour appliquer les règles de nettoyage (scroll-lock, overlay) — uniquement sur le site autorisé
function applyCleanupRules() {
  if (!isAllowedSite()) return;
  removeCookieConsentOverlay();
  reenableScroll();

  // Rétrocompat: éléments avec .no-scroll (déjà couvert par reenableScroll, garde pour cibles hors html/body)
  const noScrollElements = document.querySelectorAll(".no-scroll");
  noScrollElements.forEach((element) => {
    element.classList.remove("no-scroll");
  });
}

// Application initiale des règles (si on est sur le site autorisé)
applyCleanupRules();

// Roulette : la page appelle souvent preventDefault() sur l'événement "wheel", ce qui bloque le scroll.
// On écoute "wheel" en phase capture, on scroll la fenêtre nous-mêmes, puis on preventDefault pour
// que le comportement par défaut (et les autres listeners) ne fassent pas doublon / blocage.
// Actif uniquement sur le site autorisé (ALLOWED_HOST_B64).
const WHEEL_SCROLL_MULTIPLIER = 2.2; // augmente la vitesse du scroll à la roulette (1 = normal)
function applyWheelScrollFix() {
  if (!isAllowedSite()) return;
  document.addEventListener('wheel', (e) => {
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      const lineHeight = 40;
      dx *= lineHeight;
      dy *= lineHeight;
    } else if (e.deltaMode === 2) {
      dx *= window.innerWidth;
      dy *= window.innerHeight;
    }
    window.scrollBy(dx * WHEEL_SCROLL_MULTIPLIER, dy * WHEEL_SCROLL_MULTIPLIER);
    e.preventDefault();
  }, { capture: true, passive: false });
}
applyWheelScrollFix();

// Configuration de l'observateur de mutations (scroll-lock / overlay) — uniquement sur le site autorisé
const observer = new MutationObserver((mutations) => {
  if (!isAllowedSite()) return;
  let runCleanup = false;
  mutations.forEach((mutation) => {
    if (mutation.type === 'attributes' &&
      (mutation.attributeName === 'data-scroll-locked' ||
        mutation.attributeName === 'style' ||
        mutation.attributeName === 'class')) {
      runCleanup = true;
    }
    if (mutation.type === 'childList' && mutation.addedNodes.length) {
      runCleanup = true;
    }
  });
  if (runCleanup) {
    applyCleanupRules();
  }
});

// Démarrage de l'observation uniquement sur le site autorisé
if (isAllowedSite()) {
  const observeTargets = [document.body];
  if (document.documentElement) {
    observeTargets.push(document.documentElement);
  }
  observeTargets.forEach((target) => {
    observer.observe(target, {
      attributes: true,
      attributeFilter: ['data-scroll-locked', 'data-lock-scroll', 'style', 'class'],
      childList: target === document.body,
      subtree: target === document.body
    });
  });
}

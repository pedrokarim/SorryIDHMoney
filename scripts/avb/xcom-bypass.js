/*
 * xcom-bypass.js — Bypass du gate "contenu sensible / verification d'age" sur X.
 *
 * Portage du userscript Tampermonkey AgebypassX (Saganaki22, licence MIT) :
 *   https://github.com/Saganaki22/AgebypassX
 * en content script MAIN world. Injecte/retire dynamiquement par avb-manager.js
 * selon les toggles enableAgeVerifBypass + enableAvbXcom (MAIN world n'a pas
 * acces a chrome.storage, d'ou la gestion depuis le service worker).
 *
 * Doit tourner en MAIN world a document_start pour intercepter __INITIAL_STATE__
 * avant que le bundle webpack de X ne le consomme.
 *
 * Adaptations SorryIDHMoney :
 *  - La pastille de statut est CACHEE par defaut et restylee aux tokens de
 *    l'extension. Sa visibilite est pilotee par la classe `avb-xcom-show-dot`
 *    sur <html>, posee par le pont ISOLATED (xcom-bridge.js) selon la config.
 *  - Le statut (ok/err) + les hooks installes sont mirrorés dans
 *    document.documentElement.dataset pour que la popup puisse les afficher.
 *    (plus d'alert() au clic : l'info est desormais dans la popup du plugin.)
 */
(function () {
  'use strict';

  if (window.__avbXcomPatched) return; // idempotent (re-injection eventuelle)
  window.__avbXcomPatched = true;

  const rootEl = document.documentElement;

  // Style de la pastille — cachee par defaut, revelee via .avb-xcom-show-dot,
  // look aligne sur l'extension (blanc, arrondi, accent violet, ombre).
  const style = document.createElement('style');
  style.textContent =
    '#agebypassx-indicator{position:fixed;top:16px;right:16px;z-index:2147483647;' +
    'display:none;align-items:center;gap:6px;padding:5px 9px 5px 7px;' +
    'background:#fff;color:#333;border:1.5px solid #805ad5;border-radius:8px;' +
    "box-shadow:0 3px 6px rgba(0,0,0,.16),0 3px 6px rgba(0,0,0,.23);" +
    "font:600 11px/1 'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;cursor:default;user-select:none}" +
    'html.avb-xcom-show-dot #agebypassx-indicator{display:inline-flex}' +
    '#agebypassx-indicator .avb-dot{width:9px;height:9px;border-radius:50%;' +
    'background:#4CAF50;box-shadow:0 0 6px #4CAF50}' +
    '#agebypassx-indicator[data-state="err"]{border-color:#F44336}' +
    '#agebypassx-indicator[data-state="err"] .avb-dot{background:#F44336;box-shadow:0 0 6px #F44336}';
  rootEl.appendChild(style);

  const dot = document.createElement('div');
  dot.id = 'agebypassx-indicator';
  dot.dataset.state = 'ok';
  dot.title = 'AgebypassX: ACTIVE';
  dot.innerHTML = '<span class="avb-dot"></span><span>Bypass</span>';
  rootEl.appendChild(dot);

  let ok = true;
  const installedHooks = [];
  const visited = new WeakSet();

  // Miroir du statut dans le DOM -> lisible par le pont ISOLATED / la popup.
  function publishStatus() {
    rootEl.dataset.avbXcomStatus = ok ? 'ok' : 'err';
    rootEl.dataset.avbXcomHooks = installedHooks.join(',');
    const el = document.getElementById('agebypassx-indicator');
    if (el) {
      el.dataset.state = ok ? 'ok' : 'err';
      el.title = 'AgebypassX: ' + (ok ? 'ACTIVE' : 'ERROR');
    }
  }

  // Safely check if value is a plain object we should process
  function isSafeObject(val) {
    if (!val || typeof val !== 'object') return false;
    if (visited.has(val)) return false;

    // Skip DOM nodes, Window, Document, etc.
    if (val instanceof Node) return false;
    if (val === window) return false;
    if (val === document) return false;

    return true;
  }

  // Patch function with full error protection
  function patch(obj) {
    if (!isSafeObject(obj)) return;
    visited.add(obj);

    try {
      // Direct flag patching
      const flags = {
        'rweb_age_assurance_flow_enabled': false,
        'age_verification_gate_enabled': false,
        'sensitive_tweet_warnings_enabled': false,
        'sensitive_media_settings_enabled': true,
        'grok_settings_age_restriction_enabled': false,
        'rweb_mvr_blurred_media_interstitial_enabled': false
      };

      for (const key in flags) {
        try {
          if (key in obj && obj[key] !== undefined) {
            const val = obj[key];
            if (val && typeof val === 'object' && 'value' in val) {
              val.value = flags[key];
            } else {
              obj[key] = flags[key];
            }
          }
        } catch (e) {
          // Skip properties that throw on access
        }
      }

      // Birthdate spoofing
      try {
        if (obj.birthdate && typeof obj.birthdate === 'object') {
          obj.birthdate.year = 1990;
          obj.birthdate.day = 1;
          obj.birthdate.month = 1;
        }
      } catch (e) {}

      // Recurse safely - only enumerable own properties
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k === 'window' || k === 'document' || k === 'parent' || k === 'top') continue;

        try {
          const child = obj[k];
          if (isSafeObject(child)) {
            patch(child);
          }
        } catch (e) {
          // Skip problematic properties
        }
      }
    } catch (e) {
      console.warn('[AgebypassX] Patch error:', e);
    }
  }

  console.log('[AgebypassX] Loaded');

  // Hook 1: __INITIAL_STATE__
  try {
    let stateVal;
    Object.defineProperty(window, '__INITIAL_STATE__', {
      configurable: true,
      enumerable: true,
      get: function () { return stateVal; },
      set: function (newValue) {
        try {
          patch(newValue);
          console.log('[AgebypassX] Patched __INITIAL_STATE__');
        } catch (e) {
          console.warn('[AgebypassX] State patch failed', e);
          ok = false;
        }
        stateVal = newValue;
        publishStatus();
      }
    });
    installedHooks.push('__INITIAL_STATE__');
  } catch (e) {
    console.error('[AgebypassX] __INITIAL_STATE__ hook failed', e);
    ok = false;
  }

  // Hook 2: Object.assign - only patch if it's a state-like object
  const originalAssign = Object.assign;
  Object.assign = function (target) {
    const result = originalAssign.apply(this, arguments);
    if (target && typeof target === 'object') {
      // Only patch if it looks like a state object
      if (target.featureSwitch || target.entities || target.users) {
        patch(target);
      }
    }
    return result;
  };
  installedHooks.push('Object.assign');

  // Hook 3: JSON.parse - wrap to catch API responses
  const originalParse = JSON.parse;
  JSON.parse = function (text) {
    const result = originalParse.apply(this, arguments);
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      // Check if it looks like Twitter API response
      if (result.data || result.errors || result.featureSwitch) {
        patch(result);
      }
    }
    return result;
  };
  installedHooks.push('JSON.parse');

  publishStatus();
  console.log('[AgebypassX] Ready');
})();

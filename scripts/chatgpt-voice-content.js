// Voice Gateway -- Content script pour ChatGPT
// Automatise le bouton micro pour la transcription vocale

console.log('[VoiceGateway] Content script loaded on ChatGPT');

let pendingCancelAfterStart = false;

// === Détection résiliente des éléments DOM ===

/**
 * Trouve le bouton micro dans le composer ChatGPT.
 * Stratégie multi-sélecteurs avec fallback.
 */
function findMicButton() {
  // 1. Sélecteur exact basé sur le vrai DOM ChatGPT (avril 2026)
  //    Le bouton dictée a aria-label="Démarrage de la dictée" (FR) ou "Start dictation" (EN)
  //    ATTENTION: ne PAS prendre "Démarrer le mode vocal" qui est le mode conversation
  const exactSelectors = [
    'button[aria-label="Démarrage de la dictée"]',
    'button[aria-label="Start dictation"]',
    'button[aria-label*="dictée" i]',
    'button[aria-label*="dictation" i]',
  ];
  for (const sel of exactSelectors) {
    const btn = document.querySelector(sel);
    if (btn) return btn;
  }

  // 2. Par data-testid (au cas où OpenAI en ajoute un)
  let btn = document.querySelector('[data-testid="composer-speech-button"]');
  if (btn) return btn;

  // 3. Fallback : chercher le bouton .composer-btn dans la zone trailing
  //    qui n'est PAS le bouton vocal (celui-là a la classe composer-submit-button-color)
  const trailing = document.querySelector('[grid-area="trailing"], [style*="grid-area:trailing"]');
  if (trailing) {
    const buttons = trailing.querySelectorAll('button.composer-btn');
    for (const b of buttons) {
      // Le bouton dictée est un .composer-btn simple, pas le bouton vocal rond
      if (!b.classList.contains('composer-submit-button-color') &&
          !b.getAttribute('aria-label')?.includes('mode vocal') &&
          !b.getAttribute('aria-label')?.includes('voice mode')) {
        return b;
      }
    }
  }

  // 4. Fallback générique : dans le composer, chercher les .composer-btn
  const composerArea = findComposerArea();
  if (composerArea) {
    const composerBtns = composerArea.querySelectorAll('button.composer-btn');
    for (const b of composerBtns) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('dictée') || label.includes('dictation') ||
          label.includes('speech') || label.includes('micro')) {
        return b;
      }
    }
  }

  return null;
}

/**
 * Détecte si un bouton contient une icône de microphone via son SVG.
 */
function isMicrophoneButton(button) {
  const svg = button.querySelector('svg');
  if (!svg) return false;

  const paths = svg.querySelectorAll('path');
  for (const p of paths) {
    const d = p.getAttribute('d') || '';
    // Patterns typiques d'un SVG microphone :
    // - Path avec "M12" (centre) et courbes pour la tête du micro
    // - Path avec forme arrondie en haut et tige en bas
    if (
      (d.includes('M12') && d.includes('a3') && d.includes('v')) ||
      (d.includes('M12') && d.includes('C') && d.length > 50 && d.length < 300)
    ) {
      return true;
    }
  }

  // Vérifier aussi si le SVG a un viewBox typique de micro
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox === '0 0 24 24') {
    // C'est un candidat, vérifier la structure
    const pathCount = paths.length;
    if (pathCount >= 1 && pathCount <= 4) {
      // Heuristique : un micro a peu de paths
      const totalPathLength = Array.from(paths).reduce((sum, p) => sum + (p.getAttribute('d')?.length || 0), 0);
      if (totalPathLength > 30 && totalPathLength < 400) {
        // Possible micro, mais on ne peut pas être sûr sans plus de contexte
        // On laisse les autres méthodes prendre le relais
      }
    }
  }

  return false;
}

/**
 * Trouve la zone du composer (la barre de saisie de message).
 */
function findComposerArea() {
  // 1. Par data-composer-surface (attribut réel du DOM ChatGPT)
  let area = document.querySelector('[data-composer-surface="true"]');
  if (area) return area;

  // 2. Par le form du composer
  area = document.querySelector('form[data-type="unified-composer"]');
  if (area) return area;

  // 3. Par ID
  area = document.querySelector('#composer-background');
  if (area) return area;

  // 4. Remonter depuis le textarea connu
  const editor = document.querySelector('#prompt-textarea');
  if (editor) {
    let parent = editor.parentElement;
    for (let i = 0; i < 10 && parent; i++) {
      if (parent.querySelector('button.composer-btn')) {
        return parent;
      }
      parent = parent.parentElement;
    }
  }

  return null;
}

/**
 * Trouve la zone de texte (textarea / contenteditable) du composer.
 */
function findTranscriptionArea() {
  // ChatGPT utilise un ProseMirror contenteditable avec id="prompt-textarea"
  // Note: il y a aussi un <textarea> caché (display:none) avec le même name, on veut le div
  let area = document.querySelector('div#prompt-textarea[contenteditable="true"]');
  if (area) return area;

  // Fallback sur le contenteditable ProseMirror
  area = document.querySelector('.ProseMirror[contenteditable="true"]');
  if (area) return area;

  // Fallback générique
  area = document.querySelector('#prompt-textarea');
  if (area) return area;

  return null;
}

/**
 * Trouve le bouton stop (pendant l'enregistrement, le micro se transforme en bouton stop).
 */
/**
 * Pendant la dictée, deux boutons apparaissent :
 * - "Annuler la dictée" / "Cancel dictation" (annuler)
 * - "Envoyer la dictée" / "Submit dictation" (confirmer → transcrit le texte)
 */
function findSubmitDictationButton() {
  const selectors = [
    'button[aria-label="Envoyer la dictée"]',
    'button[aria-label="Submit dictation"]',
    'button[aria-label*="Envoyer la dict" i]',
    'button[aria-label*="Submit dict" i]',
    'button[aria-label*="Send dictation" i]',
  ];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn) return btn;
  }
  return null;
}

function findCancelDictationButton() {
  const selectors = [
    'button[aria-label="Annuler la dictée"]',
    'button[aria-label="Cancel dictation"]',
    'button[aria-label*="Annuler la dict" i]',
    'button[aria-label*="Cancel dict" i]',
  ];
  for (const sel of selectors) {
    const btn = document.querySelector(sel);
    if (btn) return btn;
  }
  return null;
}

/**
 * Vérifie si la dictée est actuellement active (canvas visible dans le composer).
 */
function isDictationActive() {
  const composer = findComposerArea();
  if (!composer) return false;
  // Pendant la dictée, un canvas remplace le textarea
  return !!composer.querySelector('canvas') && !!findSubmitDictationButton();
}

/**
 * Lit le contenu textuel de la zone de transcription.
 */
function getTranscriptionText() {
  const area = findTranscriptionArea();
  if (!area) return '';

  // ProseMirror : le texte est dans des <p>, innerText les joint bien
  const text = area.innerText?.trim() || area.textContent?.trim() || '';

  // Ignorer le placeholder
  const placeholder = area.querySelector('[data-placeholder]');
  if (placeholder && text === placeholder.getAttribute('data-placeholder')) {
    return '';
  }

  return text;
}

/**
 * Vide la zone de texte du composer (pour ne pas envoyer le message à ChatGPT).
 */
function clearComposerText() {
  const area = findTranscriptionArea();
  if (!area) return;

  // ProseMirror contenteditable : sélectionner tout + delete
  area.focus();
  // Ctrl+A puis Delete (la méthode la plus fiable avec ProseMirror)
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

// === Observateur de transcription ===

/**
 * Observe la zone de texte et attend qu'une transcription apparaisse.
 * Retourne une Promise qui résout avec le texte transcrit.
 */
function waitForTranscription(timeoutMs = 15000) {
  return new Promise((resolve) => {
    let resolved = false;

    // Le textarea n'existe peut-être pas encore (il est remplacé par un canvas pendant la dictée)
    // On poll jusqu'à ce que le textarea réapparaisse AVEC du texte dedans
    const pollInterval = setInterval(() => {
      if (resolved) return;

      const area = findTranscriptionArea();
      if (!area) return; // Pas encore réapparu

      const text = getTranscriptionText();
      if (text && text.length > 0) {
        resolved = true;
        clearInterval(pollInterval);
        resolve({ text });
      }
    }, 200);

    // Observer le composer pour détecter quand le textarea réapparaît
    const composer = findComposerArea();
    if (composer) {
      const observer = new MutationObserver(() => {
        if (resolved) {
          observer.disconnect();
          return;
        }
        const area = findTranscriptionArea();
        if (!area) return;
        const text = getTranscriptionText();
        if (text && text.length > 0) {
          resolved = true;
          observer.disconnect();
          clearInterval(pollInterval);
          resolve({ text });
        }
      });

      observer.observe(composer, {
        childList: true,
        subtree: true,
        characterData: true,
      });

      // Cleanup observer au timeout
      setTimeout(() => observer.disconnect(), timeoutMs);
    }

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(pollInterval);

        // Dernière tentative
        const area = findTranscriptionArea();
        const text = area ? getTranscriptionText() : '';
        if (text && text.length > 0) {
          resolve({ text });
        } else {
          resolve({ error: 'TRANSCRIPTION_TIMEOUT' });
        }
      }
    }, timeoutMs);
  });
}

// === Gestion des commandes ===

async function startRecording() {
  pendingCancelAfterStart = false;

  // Vérifier si la dictée est déjà active
  if (isDictationActive()) {
    return { type: 'status', state: 'recording' };
  }

  const micBtn = findMicButton();
  if (!micBtn) {
    return {
      type: 'error',
      code: 'MIC_BUTTON_NOT_FOUND',
      message: 'Bouton micro introuvable sur la page ChatGPT'
    };
  }

  console.log('[VoiceGateway] Clicking mic button:', micBtn.getAttribute('aria-label'));
  micBtn.click();

  // Attendre que la dictée démarre (canvas apparaît + boutons submit/cancel)
  for (let i = 0; i < 10; i++) {
    await sleep(300);
    if (isDictationActive()) {
      if (pendingCancelAfterStart) {
        return await cancelRecording();
      }
      console.log('[VoiceGateway] Dictation started successfully');
      return { type: 'status', state: 'recording' };
    }
  }

  // Vérifier une dernière fois
  if (isDictationActive()) {
    if (pendingCancelAfterStart) {
      return await cancelRecording();
    }
    return { type: 'status', state: 'recording' };
  }

  if (pendingCancelAfterStart) {
    pendingCancelAfterStart = false;
    return { type: 'cancelled' };
  }

  return {
    type: 'error',
    code: 'DICTATION_NOT_STARTED',
    message: 'La dictée ne semble pas avoir démarré'
  };
}

async function stopRecording() {
  // Chercher le bouton "Envoyer la dictée" (confirmer)
  const submitBtn = findSubmitDictationButton();

  if (!submitBtn) {
    // Peut-être que la dictée est déjà terminée et le texte est là
    const text = getTranscriptionText();
    if (text) {
      clearComposerText();
      return { type: 'transcription', text };
    }

    return {
      type: 'error',
      code: 'STOP_BUTTON_NOT_FOUND',
      message: 'Bouton "Envoyer la dictée" introuvable'
    };
  }

  console.log('[VoiceGateway] Clicking submit dictation button');
  submitBtn.click();

  // Attendre que le canvas disparaisse et que le textarea revienne avec du texte
  const result = await waitForTranscription(15000);

  if (result.error) {
    return {
      type: 'error',
      code: result.error,
      message: `Erreur de transcription: ${result.error}`
    };
  }

  const text = result.text;
  console.log('[VoiceGateway] Transcription received:', text);

  // Vider le composer pour ne PAS envoyer le message à ChatGPT
  await sleep(200);
  clearComposerText();

  return { type: 'transcription', text };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForDictationToEnd(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isDictationActive()) {
      return true;
    }
    await sleep(120);
  }
  return !isDictationActive();
}

async function cancelRecording() {
  pendingCancelAfterStart = true;

  const cancelBtn = findCancelDictationButton();
  if (!cancelBtn) {
    if (!isDictationActive()) {
      return { type: 'cancelled' };
    }

    return {
      type: 'error',
      code: 'CANCEL_BUTTON_NOT_FOUND',
      message: 'Bouton "Annuler la dictée" introuvable'
    };
  }

  console.log('[VoiceGateway] Clicking cancel dictation button');
  cancelBtn.click();
  await waitForDictationToEnd(5000);
  pendingCancelAfterStart = false;
  clearComposerText();
  return { type: 'cancelled' };
}

// === Listener de messages du background ===

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message.action?.startsWith('voiceGateway_')) return false;

  console.log('[VoiceGateway] Received command:', message.action);

  switch (message.action) {
    case 'voiceGateway_startRecording':
      startRecording().then(response => {
        console.log('[VoiceGateway] Start response:', response);
        sendResponse(response);
      });
      return true; // Réponse asynchrone

    case 'voiceGateway_stopRecording':
      stopRecording().then(response => {
        console.log('[VoiceGateway] Stop response:', response);
        sendResponse(response);
      });
      return true; // Réponse asynchrone

    case 'voiceGateway_cancelRecording':
      cancelRecording().then(response => {
        console.log('[VoiceGateway] Cancel response:', response);
        sendResponse(response);
      });
      return true; // Réponse asynchrone

    case 'voiceGateway_getStatus': {
      const micBtn = findMicButton();
      const dictationActive = isDictationActive();
      sendResponse({
        type: 'status',
        hasMicButton: !!micBtn,
        isDictationActive: dictationActive,
        hasSubmitButton: !!findSubmitDictationButton(),
        composerText: getTranscriptionText(),
      });
      return false;
    }

    default:
      return false;
  }
});

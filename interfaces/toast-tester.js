/* Testeur de toasts : envoie une notification d'essai sur l'onglet actif. */

const $ = (id) => document.getElementById(id);

const PRESETS = {
  success: { message: 'Opération réussie !', duration: 3000 },
  error: { message: 'Une erreur est survenue.', duration: 4000 },
  warning: { message: 'Attention, quelque chose demande ton avis.', duration: 3500 },
  info: { message: 'Une information importante.', duration: 3000 },
};

function showError(message) {
  const box = $('error-message');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(box._timer);
  box._timer = setTimeout(() => { box.hidden = true; }, 3500);
}

async function sendToastToActiveTab(message, options) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showError('Aucun onglet actif trouvé.'); return; }
    if (!tab.url || !/^https?:/.test(tab.url)) {
      showError('Impossible d’afficher un toast sur cette page : ouvre un site web.');
      return;
    }
    // Le script de réception n'est pas posé partout : on l'injecte (il ne
    // s'installe qu'une fois par page).
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scripts/toast-content.js'] });
    await chrome.tabs.sendMessage(tab.id, { action: 'showToast', message, options });
  } catch (error) {
    showError('Impossible d’afficher le toast sur cette page.');
    console.error('[Toasts] Envoi impossible :', error);
  }
}

function currentOptions(type, duration) {
  const options = { type, duration, position: $('position').value };
  if ($('with-buttons').checked) {
    // Les boutons ne traversent pas le message (pas de fonctions) : leur clic
    // ferme simplement le toast.
    options.buttons = [{ text: 'Plus tard' }, { text: 'Voir', type: 'primary' }];
  }
  return options;
}

$('custom-toast-btn').addEventListener('click', () => {
  const duration = Math.max(0, parseInt($('duration').value, 10) || 0);
  sendToastToActiveTab($('message').value || 'Ceci est un test !', currentOptions($('type').value, duration));
});

for (const button of document.querySelectorAll('.preset')) {
  button.addEventListener('click', () => {
    const { message, duration } = PRESETS[button.dataset.type];
    sendToastToActiveTab(message, currentOptions(button.dataset.type, duration));
  });
}

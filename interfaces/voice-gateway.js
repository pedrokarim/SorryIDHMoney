const STORAGE_KEY = 'voiceGatewayHistory';

let history = [];

// === Éléments DOM ===
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const statusDetail = document.getElementById('status-detail');
const statTotal = document.getElementById('stat-total');
const statWords = document.getElementById('stat-words');
const statToday = document.getElementById('stat-today');
const historyList = document.getElementById('history-list');
const emptyState = document.getElementById('empty-state');
const clearBtn = document.getElementById('clear-history');
const logToggle = document.getElementById('log-toggle');
const logContainer = document.getElementById('log-container');

// === Status ===

function updateStatus(state, detail = '') {
  const states = {
    disconnected: { text: 'Déconnecté', class: 'error', detail: 'Le native host n\'est pas connecté' },
    idle: { text: 'Prêt', class: 'connected', detail: 'En attente de Ctrl+Alt+V' },
    waiting: { text: 'Connexion au micro...', class: 'processing', detail: '' },
    recording: { text: 'Enregistrement en cours', class: 'recording', detail: 'Appuyez sur Ctrl+Alt+V pour arrêter' },
    processing: { text: 'Traitement...', class: 'processing', detail: 'Récupération de la transcription' },
    error: { text: 'Erreur', class: 'error', detail: detail },
  };

  const s = states[state] || states.disconnected;
  statusIndicator.className = 'status-indicator ' + s.class;
  statusText.textContent = s.text;
  statusDetail.textContent = detail || s.detail;
}

// === Stats ===

function updateStats() {
  const total = history.length;
  const words = history.reduce((sum, h) => sum + h.text.split(/\s+/).filter(Boolean).length, 0);
  const today = new Date().toDateString();
  const todayCount = history.filter(h => new Date(h.timestamp).toDateString() === today).length;

  statTotal.textContent = total.toLocaleString('fr-FR');
  statWords.textContent = words.toLocaleString('fr-FR');
  statToday.textContent = todayCount.toLocaleString('fr-FR');
}

// === Historique ===

function renderHistory() {
  // Retirer les anciens items (garder l'empty state)
  const items = historyList.querySelectorAll('.history-item');
  items.forEach(item => item.remove());

  if (history.length === 0) {
    emptyState.style.display = '';
    return;
  }

  emptyState.style.display = 'none';

  // Afficher du plus récent au plus ancien
  const sorted = [...history].reverse();
  for (const entry of sorted) {
    const item = document.createElement('div');
    item.className = 'history-item';

    const time = new Date(entry.timestamp);
    const timeStr = time.toLocaleString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });

    item.innerHTML = `
      <div class="history-item-header">
        <span class="history-time">${timeStr}</span>
        <button class="history-copy-btn" data-text="${encodeURIComponent(entry.text)}">Copier</button>
      </div>
      <div class="history-text">${escapeHtml(entry.text)}</div>
    `;

    historyList.appendChild(item);
  }

  // Boutons copier
  historyList.querySelectorAll('.history-copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = decodeURIComponent(btn.dataset.text);
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copié';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copier';
          btn.classList.remove('copied');
        }, 1500);
      } catch (e) {
        btn.textContent = 'Erreur';
      }
    });
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// === Logs ===

function addLog(message, level = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  const time = new Date().toLocaleTimeString('fr-FR');
  entry.textContent = `[${time}] ${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// === Stockage ===

async function loadHistory() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  history = data[STORAGE_KEY] || [];
  renderHistory();
  updateStats();
}

async function saveHistory() {
  await chrome.storage.local.set({ [STORAGE_KEY]: history });
}

// === Messages depuis le background ===

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message.action?.startsWith('voiceGateway_ui_')) return false;

  switch (message.action) {
    case 'voiceGateway_ui_status':
      updateStatus(message.state, message.detail);
      addLog(`Status: ${message.state}`, 'info');
      break;

    case 'voiceGateway_ui_transcription':
      history.push({
        text: message.text,
        timestamp: Date.now(),
      });
      saveHistory();
      renderHistory();
      updateStats();
      addLog(`Transcription: "${message.text.substring(0, 60)}..."`, 'success');
      break;

    case 'voiceGateway_ui_error':
      updateStatus('error', message.message);
      addLog(`Erreur: ${message.message}`, 'error');
      break;

    case 'voiceGateway_ui_log':
      addLog(message.message, message.level || 'info');
      break;
  }

  return false;
});

// === Events ===

clearBtn.addEventListener('click', async () => {
  history = [];
  await saveHistory();
  renderHistory();
  updateStats();
  addLog('Historique effacé', 'warn');
});

logToggle.addEventListener('click', () => {
  logToggle.classList.toggle('open');
  logContainer.classList.toggle('visible');
});

// === Extension ID ===

const copyIdBtn = document.getElementById('copy-id-btn');

copyIdBtn?.addEventListener('click', async () => {
  const id = chrome.runtime.id;
  try {
    await navigator.clipboard.writeText(id);
    copyIdBtn.textContent = 'Copié';
    copyIdBtn.classList.add('copied');
    setTimeout(() => {
      copyIdBtn.textContent = 'Copier';
      copyIdBtn.classList.remove('copied');
    }, 1500);
  } catch (e) {
    copyIdBtn.textContent = 'Erreur';
  }
});

// === Init ===

document.addEventListener('DOMContentLoaded', async () => {
  await loadHistory();
  addLog('Interface Voice Gateway ouverte', 'info');

  // Afficher l'extension ID
  const extId = chrome.runtime.id;
  const idEl = document.getElementById('extension-id');
  const idPlaceholder = document.getElementById('install-id-placeholder');
  if (idEl) idEl.textContent = extId;
  if (idPlaceholder) idPlaceholder.textContent = extId;

  // Demander le statut actuel au background
  chrome.runtime.sendMessage({ action: 'voiceGateway_getStatus' }, (response) => {
    if (response?.state) {
      updateStatus(response.state);
    } else {
      updateStatus('disconnected');
    }
  });
});

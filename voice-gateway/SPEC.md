# Voice Gateway -- Specification technique

## Objectif

Application Windows standalone qui utilise la transcription vocale de ChatGPT (via l'abonnement existant) comme outil de dictation general. L'utilisateur appuie sur un raccourci clavier global, parle, et le texte transcrit est colle dans l'application active.

## Architecture

```
[App Rust standalone]  <-- WebSocket (ws://127.0.0.1:59210) -->  [Extension Chrome]
                                                                       |
                                                               [Content script ChatGPT]
                                                                       |
                                                               [Clic bouton "Demarrage de la dictee"]
                                                               [Clic bouton "Envoyer la dictee"]
                                                               [Lecture du textarea ProseMirror]
```

## Composant 1 : App Rust (standalone)

### Comportement attendu

- L'utilisateur lance le .exe manuellement (double-clic). Pas de lancement automatique par Chrome.
- L'app affiche une petite fenetre flottante (widget) style Windows Voice Input.
- L'app cree un tray icon dans la zone de notification Windows.
- La fenetre n'apparait JAMAIS dans la barre des taches Windows.
- Quand l'utilisateur ferme la fenetre (bouton X), la fenetre disparait completement. Pas de minimisation, pas dans la barre. Invisible. Le tray icon reste. L'app tourne en arriere-plan.
- Le tray icon a un menu : "Afficher" (reouvre la fenetre), "Quitter" (tue le process).
- Le raccourci Ctrl+Alt+V fonctionne en permanence (meme quand la fenetre est cachee).
- Ctrl+Alt+V quand la fenetre est cachee : reouvre la fenetre ET lance la dictee.
- L'app communique avec l'extension Chrome via un serveur WebSocket sur localhost:59210.
- Une seule instance a la fois (si le port est deja pris, la 2e instance quitte).
- Pas de console Windows visible (windows_subsystem = "windows").

### Probleme technique critique : hide/show de la fenetre

Le framework egui/eframe arrete d'appeler `update()` quand la fenetre est invisible ou minimisee. Cela signifie que le polling des events tray et hotkey s'arrete aussi.

**Solution requise :** Les events tray (Afficher, Quitter) et hotkey (Ctrl+Alt+V) doivent etre traites dans un thread dedie, independant de la boucle eframe. Ce thread doit :
1. Ecouter `MenuEvent::receiver()` en boucle bloquante (`recv()`, pas `try_recv()`)
2. Ecouter `GlobalHotKeyEvent::receiver()` en boucle
3. Pour "Quitter" : appeler `std::process::exit(0)` directement
4. Pour "Afficher" ou hotkey : mettre un flag atomique + appeler `egui_ctx.request_repaint()` pour reveiller eframe
5. Dans `update()` : verifier le flag et faire `Visible(true)` si necessaire

Le tray et le hotkey doivent etre crees AVANT eframe pour que les IDs des menu items soient disponibles dans le thread.

Le `egui::Context` doit etre partage avec le thread via un `Arc<Mutex<Option<egui::Context>>>`, set au premier appel de `update()`.

### Widget (fenetre flottante)

Inspiration : widget de saisie vocale Windows (compact, dark, 3 boutons ronds).

- Fenetre sans bordure, sans decoration, always-on-top, coins arrondis
- Fond sombre (#202020)
- Barre de drag en haut (toute la largeur, avec poignee + bouton X)
- 3 boutons ronds alignes horizontalement, centres :
  - Gauche (petit) : historique (icone 3 lignes horizontales)
  - Centre (grand) : micro/stop (bleu=pret, rouge=enregistrement, orange=traitement)
  - Droite (petit) : parametres/info (icone "i")
- Texte de status sous les boutons (petit, centre)
- Proportions exactes, pas d'espace vide

### Serveur WebSocket

- Port : 59210
- Protocole : JSON sur WebSocket
- Accepte une seule connexion a la fois (l'extension Chrome)
- Messages sortants (vers extension) : `{ "type": "start_recording" }`, `{ "type": "stop_recording" }`
- Messages entrants (depuis extension) : `{ "type": "status", "state": "recording" }`, `{ "type": "transcription", "text": "..." }`, `{ "type": "error", "message": "..." }`

### Machine a etats

```
Idle -- (hotkey) --> WaitingForRecording -- (confirmation) --> Recording
                                        -- (erreur) --> Idle
Recording -- (hotkey) --> Processing -- (transcription recue) --> Idle (paste le texte)
                                     -- (erreur) --> Idle
```

### Paste

Quand une transcription est recue :
1. Copier le texte dans le presse-papiers (crate `arboard`)
2. Attendre 150ms
3. Simuler Ctrl+V (crate `enigo`)

### Tray icon

- Icone carree 16x16 qui change de couleur selon l'etat (bleu/orange/rouge)
- Menu contextuel : "Afficher", separateur, "Raccourci : Ctrl+Alt+V" (disabled), separateur, "Quitter"

### Crates Rust

- `eframe` / `egui` : GUI
- `tray-icon` : tray icon + menu contextuel
- `global-hotkey` : raccourci global Ctrl+Alt+V
- `tungstenite` : serveur WebSocket
- `arboard` : presse-papiers
- `enigo` : simulation clavier
- `serde_json` : serialisation messages
- `chrono` : timestamps

---

## Composant 2 : Extension Chrome (modifications)

### manifest.json

- Permissions ajoutees : `tabs`
- Content script ajoute sur `chatgpt.com/*` et `chat.openai.com/*`

### background.js

- Connexion WebSocket a `ws://127.0.0.1:59210`
- Auto-reconnexion toutes les 5 secondes si deconnecte
- Bridge : recoit les commandes du WebSocket, les transmet au content script ChatGPT via `chrome.tabs.sendMessage`
- Remonte les reponses du content script vers le WebSocket
- Si aucun onglet ChatGPT ouvert : en ouvre un (epingle, en arriere-plan)
- Injection dynamique du content script si necessaire (`chrome.scripting.executeScript`)

### Content script ChatGPT (`scripts/chatgpt-voice-content.js`)

#### Selecteurs DOM (avril 2026)

- **Composer** : `[data-composer-surface="true"]` ou `form[data-type="unified-composer"]`
- **Textarea** : `div#prompt-textarea[contenteditable="true"]` (ProseMirror)
- **Bouton demarrer dictee** : `button[aria-label="Demarrage de la dictee"]` (FR) ou `button[aria-label="Start dictation"]` (EN)
- **Bouton envoyer dictee** : `button[aria-label="Envoyer la dictee"]` (confirmer la transcription)
- **Bouton annuler dictee** : `button[aria-label="Annuler la dictee"]` (annuler)

#### Comportement pendant la dictee

Quand la dictee est active :
- Le textarea ProseMirror est REMPLACE par un `<canvas>` (waveform audio)
- Deux boutons apparaissent : "Annuler la dictee" et "Envoyer la dictee"
- Le bouton "Demarrage de la dictee" disparait

#### Flow

1. `start_recording` : cliquer sur "Demarrage de la dictee", verifier que le canvas apparait
2. `stop_recording` : cliquer sur "Envoyer la dictee", attendre que le canvas disparaisse et que le textarea revienne avec du texte, lire le texte, vider le textarea (pour ne pas envoyer a ChatGPT)

#### Detection de la transcription (`waitForTranscription`)

Apres clic sur "Envoyer la dictee" :
- Le textarea n'existe pas encore (canvas visible)
- Poller toutes les 200ms + MutationObserver sur le composer
- Attendre que le textarea reapparaisse avec du texte non vide
- Timeout : 15 secondes

#### Nettoyage du textarea

Apres lecture de la transcription, vider le composer pour ne pas envoyer le message a ChatGPT :
```javascript
document.execCommand('selectAll', false);
document.execCommand('delete', false);
```

---

## Interface Chrome (page Voice Gateway)

Accessible depuis le popup de l'extension (lien "Voice Gateway").

- Indicateur de statut (connecte/deconnecte/enregistrement)
- Compteurs : transcriptions totales, mots, aujourd'hui
- Historique des transcriptions avec bouton copier
- Section installation avec l'extension ID
- Logs depliables

---

## Installation

1. Compiler : `cd voice-gateway && cargo build --release`
2. Lancer : double-clic sur `voice-gateway.exe`
3. Recharger l'extension Chrome
4. Ouvrir un onglet ChatGPT (ou laisser l'extension le faire)
5. Ctrl+Alt+V pour dicter

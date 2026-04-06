use std::fmt;

#[derive(Debug, Clone, PartialEq)]
pub enum GatewayState {
    Idle,
    WaitingForRecording,
    Recording,
    Processing,
}

impl fmt::Display for GatewayState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GatewayState::Idle => write!(f, "idle"),
            GatewayState::WaitingForRecording => write!(f, "waiting"),
            GatewayState::Recording => write!(f, "recording"),
            GatewayState::Processing => write!(f, "processing"),
        }
    }
}

#[derive(Debug)]
pub enum GatewayEvent {
    HotkeyPressed,
    RecordingStarted,
    Cancelled,
    TranscriptionReceived(String),
    Error(String),
}

#[derive(Debug)]
pub enum Action {
    SendStartRecording,
    SendCancelRecording,
    SendStopRecording,
    PasteText(String),
    ShowError(String),
    UpdateTrayRecording,
    UpdateTrayProcessing,
    UpdateTrayIdle,
}

impl GatewayState {
    pub fn transition(self, event: GatewayEvent) -> (GatewayState, Vec<Action>) {
        match (self, event) {
            // Idle + hotkey -> demander l'enregistrement
            (GatewayState::Idle, GatewayEvent::HotkeyPressed) => (
                GatewayState::WaitingForRecording,
                vec![Action::SendStartRecording, Action::UpdateTrayProcessing],
            ),

            // En attente + nouvelle pression -> annuler la connexion
            (GatewayState::WaitingForRecording, GatewayEvent::HotkeyPressed) => (
                GatewayState::Idle,
                vec![Action::SendCancelRecording, Action::UpdateTrayIdle],
            ),

            // En attente + confirmation -> enregistrement en cours
            (GatewayState::WaitingForRecording, GatewayEvent::RecordingStarted) => (
                GatewayState::Recording,
                vec![Action::UpdateTrayRecording],
            ),

            // En attente + annulation -> retour idle
            (GatewayState::WaitingForRecording, GatewayEvent::Cancelled) => (
                GatewayState::Idle,
                vec![Action::UpdateTrayIdle],
            ),

            // En attente + erreur -> retour idle
            (GatewayState::WaitingForRecording, GatewayEvent::Error(msg)) => (
                GatewayState::Idle,
                vec![Action::ShowError(msg), Action::UpdateTrayIdle],
            ),

            // Enregistrement + hotkey -> demander l'arrêt
            (GatewayState::Recording, GatewayEvent::HotkeyPressed) => (
                GatewayState::Processing,
                vec![Action::SendStopRecording, Action::UpdateTrayProcessing],
            ),

            // Enregistrement + annulation remontée du bridge -> retour idle
            (GatewayState::Recording, GatewayEvent::Cancelled) => (
                GatewayState::Idle,
                vec![Action::UpdateTrayIdle],
            ),

            // Traitement + transcription reçue -> coller + idle
            (GatewayState::Processing, GatewayEvent::TranscriptionReceived(text)) => (
                GatewayState::Idle,
                vec![Action::PasteText(text), Action::UpdateTrayIdle],
            ),

            // Traitement + erreur -> retour idle
            (GatewayState::Processing, GatewayEvent::Error(msg)) => (
                GatewayState::Idle,
                vec![Action::ShowError(msg), Action::UpdateTrayIdle],
            ),

            // Tous les autres cas -> ignorer
            (state, _) => (state, vec![]),
        }
    }
}

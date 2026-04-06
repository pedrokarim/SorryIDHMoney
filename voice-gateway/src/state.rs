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

#[cfg(test)]
mod tests {
    use super::*;

    fn action_types(actions: &[Action]) -> Vec<&str> {
        actions
            .iter()
            .map(|a| match a {
                Action::SendStartRecording => "SendStart",
                Action::SendCancelRecording => "SendCancel",
                Action::SendStopRecording => "SendStop",
                Action::PasteText(_) => "Paste",
                Action::ShowError(_) => "ShowError",
                Action::UpdateTrayRecording => "TrayRec",
                Action::UpdateTrayProcessing => "TrayProc",
                Action::UpdateTrayIdle => "TrayIdle",
            })
            .collect()
    }

    // === Flow normal : Idle -> WaitingForRecording -> Recording -> Processing -> Idle ===

    #[test]
    fn idle_hotkey_starts_recording() {
        let (state, actions) = GatewayState::Idle.transition(GatewayEvent::HotkeyPressed);
        assert_eq!(state, GatewayState::WaitingForRecording);
        assert!(action_types(&actions).contains(&"SendStart"));
    }

    #[test]
    fn waiting_confirmed_goes_to_recording() {
        let (state, actions) =
            GatewayState::WaitingForRecording.transition(GatewayEvent::RecordingStarted);
        assert_eq!(state, GatewayState::Recording);
        assert!(action_types(&actions).contains(&"TrayRec"));
    }

    #[test]
    fn recording_hotkey_stops() {
        let (state, actions) = GatewayState::Recording.transition(GatewayEvent::HotkeyPressed);
        assert_eq!(state, GatewayState::Processing);
        assert!(action_types(&actions).contains(&"SendStop"));
    }

    #[test]
    fn processing_transcription_pastes_and_idles() {
        let (state, actions) = GatewayState::Processing
            .transition(GatewayEvent::TranscriptionReceived("hello".to_string()));
        assert_eq!(state, GatewayState::Idle);
        let types = action_types(&actions);
        assert!(types.contains(&"Paste"));
        assert!(types.contains(&"TrayIdle"));
    }

    // === Annulation ===

    #[test]
    fn waiting_hotkey_cancels() {
        let (state, actions) =
            GatewayState::WaitingForRecording.transition(GatewayEvent::HotkeyPressed);
        assert_eq!(state, GatewayState::Idle);
        assert!(action_types(&actions).contains(&"SendCancel"));
    }

    #[test]
    fn waiting_cancelled_goes_idle() {
        let (state, _) = GatewayState::WaitingForRecording.transition(GatewayEvent::Cancelled);
        assert_eq!(state, GatewayState::Idle);
    }

    #[test]
    fn recording_cancelled_goes_idle() {
        let (state, _) = GatewayState::Recording.transition(GatewayEvent::Cancelled);
        assert_eq!(state, GatewayState::Idle);
    }

    // === Erreurs ===

    #[test]
    fn waiting_error_goes_idle_with_message() {
        let (state, actions) = GatewayState::WaitingForRecording
            .transition(GatewayEvent::Error("fail".to_string()));
        assert_eq!(state, GatewayState::Idle);
        let types = action_types(&actions);
        assert!(types.contains(&"ShowError"));
        assert!(types.contains(&"TrayIdle"));
    }

    #[test]
    fn processing_error_goes_idle() {
        let (state, actions) =
            GatewayState::Processing.transition(GatewayEvent::Error("timeout".to_string()));
        assert_eq!(state, GatewayState::Idle);
        assert!(action_types(&actions).contains(&"ShowError"));
    }

    // === Événements ignorés ===

    #[test]
    fn idle_ignores_transcription() {
        let (state, actions) = GatewayState::Idle
            .transition(GatewayEvent::TranscriptionReceived("nope".to_string()));
        assert_eq!(state, GatewayState::Idle);
        assert!(actions.is_empty());
    }

    #[test]
    fn idle_ignores_recording_started() {
        let (state, actions) = GatewayState::Idle.transition(GatewayEvent::RecordingStarted);
        assert_eq!(state, GatewayState::Idle);
        assert!(actions.is_empty());
    }

    #[test]
    fn recording_ignores_error() {
        let (state, actions) =
            GatewayState::Recording.transition(GatewayEvent::Error("x".to_string()));
        assert_eq!(state, GatewayState::Recording);
        assert!(actions.is_empty());
    }

    #[test]
    fn processing_ignores_hotkey() {
        let (state, actions) = GatewayState::Processing.transition(GatewayEvent::HotkeyPressed);
        assert_eq!(state, GatewayState::Processing);
        assert!(actions.is_empty());
    }

    // === Flow complet ===

    #[test]
    fn full_dictation_cycle() {
        // Idle -> hotkey -> WaitingForRecording
        let (state, _) = GatewayState::Idle.transition(GatewayEvent::HotkeyPressed);
        assert_eq!(state, GatewayState::WaitingForRecording);

        // WaitingForRecording -> confirmed -> Recording
        let (state, _) = state.transition(GatewayEvent::RecordingStarted);
        assert_eq!(state, GatewayState::Recording);

        // Recording -> hotkey -> Processing
        let (state, _) = state.transition(GatewayEvent::HotkeyPressed);
        assert_eq!(state, GatewayState::Processing);

        // Processing -> transcription -> Idle + paste
        let (state, actions) =
            state.transition(GatewayEvent::TranscriptionReceived("bonjour".to_string()));
        assert_eq!(state, GatewayState::Idle);
        assert!(action_types(&actions).contains(&"Paste"));
    }

    #[test]
    fn cancel_during_waiting() {
        let (state, _) = GatewayState::Idle.transition(GatewayEvent::HotkeyPressed);
        assert_eq!(state, GatewayState::WaitingForRecording);

        // Double hotkey = cancel
        let (state, actions) = state.transition(GatewayEvent::HotkeyPressed);
        assert_eq!(state, GatewayState::Idle);
        assert!(action_types(&actions).contains(&"SendCancel"));
    }
}

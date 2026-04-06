use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CloseAction {
    HideToTray,
    QuitApp,
}

impl Default for CloseAction {
    fn default() -> Self {
        Self::HideToTray
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default)]
    pub close_action: CloseAction,
    #[serde(default)]
    pub extension_id: String,
    #[serde(default = "default_paste_delay_ms")]
    pub paste_delay_ms: u64,
    #[serde(default = "default_history_limit")]
    pub history_limit: usize,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            close_action: CloseAction::HideToTray,
            extension_id: String::new(),
            paste_delay_ms: default_paste_delay_ms(),
            history_limit: default_history_limit(),
        }
    }
}

impl AppSettings {
    pub fn load() -> Self {
        let path = storage_path();
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(_) => return Self::default(),
        };

        serde_json::from_str::<Self>(&content)
            .map(Self::sanitized)
            .unwrap_or_default()
    }

    pub fn save(&self) -> Result<(), Box<dyn std::error::Error>> {
        let path = storage_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let json = serde_json::to_string_pretty(&self.clone().sanitized())?;
        fs::write(path, json)?;
        Ok(())
    }

    pub fn sanitized(mut self) -> Self {
        self.extension_id = self.extension_id.trim().to_owned();
        self.paste_delay_ms = self.paste_delay_ms.clamp(50, 600);
        self.history_limit = self.history_limit.clamp(10, 200);
        self
    }
}

pub fn storage_path() -> PathBuf {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("VoiceGateway")
        .join("settings.json")
}

fn default_paste_delay_ms() -> u64 {
    150
}

fn default_history_limit() -> usize {
    60
}

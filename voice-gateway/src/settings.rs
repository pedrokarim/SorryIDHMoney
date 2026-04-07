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
    #[serde(default = "default_auto_paste")]
    pub auto_paste: bool,
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            close_action: CloseAction::HideToTray,
            extension_id: String::new(),
            paste_delay_ms: default_paste_delay_ms(),
            history_limit: default_history_limit(),
            auto_paste: default_auto_paste(),
            hotkey: default_hotkey(),
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
        self.hotkey = self.hotkey.trim().to_owned();
        if self.hotkey.is_empty() || crate::hotkey::parse_hotkey_string(&self.hotkey).is_err() {
            self.hotkey = default_hotkey();
        }
        self
    }
}

pub fn storage_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join("VoiceGateway")
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::var_os("HOME")
                    .map(|h| PathBuf::from(h).join(".config"))
                    .unwrap_or_else(|| PathBuf::from("."))
            })
            .join("VoiceGateway")
    }
}

pub fn storage_path() -> PathBuf {
    storage_dir().join("settings.json")
}

pub fn history_path() -> PathBuf {
    storage_dir().join("history.json")
}

fn default_paste_delay_ms() -> u64 {
    150
}

fn default_history_limit() -> usize {
    60
}

fn default_auto_paste() -> bool {
    true
}

fn default_hotkey() -> String {
    "Ctrl+Alt+V".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_have_auto_paste_enabled() {
        let settings = AppSettings::default();
        assert!(settings.auto_paste);
    }

    #[test]
    fn sanitize_clamps_paste_delay() {
        let mut s = AppSettings::default();
        s.paste_delay_ms = 10;
        let s = s.sanitized();
        assert_eq!(s.paste_delay_ms, 50);

        let mut s = AppSettings::default();
        s.paste_delay_ms = 9999;
        let s = s.sanitized();
        assert_eq!(s.paste_delay_ms, 600);
    }

    #[test]
    fn sanitize_clamps_history_limit() {
        let mut s = AppSettings::default();
        s.history_limit = 1;
        let s = s.sanitized();
        assert_eq!(s.history_limit, 10);

        let mut s = AppSettings::default();
        s.history_limit = 999;
        let s = s.sanitized();
        assert_eq!(s.history_limit, 200);
    }

    #[test]
    fn sanitize_trims_extension_id() {
        let mut s = AppSettings::default();
        s.extension_id = "  abc123  ".to_string();
        let s = s.sanitized();
        assert_eq!(s.extension_id, "abc123");
    }

    #[test]
    fn deserialize_without_auto_paste_defaults_to_true() {
        let json = r#"{"close_action":"HideToTray","extension_id":""}"#;
        let s: AppSettings = serde_json::from_str(json).unwrap();
        assert!(s.auto_paste);
    }

    #[test]
    fn deserialize_with_auto_paste_false() {
        let json = r#"{"auto_paste":false}"#;
        let s: AppSettings = serde_json::from_str(json).unwrap();
        assert!(!s.auto_paste);
    }

    #[test]
    fn roundtrip_serialize() {
        let mut s = AppSettings::default();
        s.auto_paste = false;
        s.paste_delay_ms = 200;
        let json = serde_json::to_string(&s).unwrap();
        let s2: AppSettings = serde_json::from_str(&json).unwrap();
        assert!(!s2.auto_paste);
        assert_eq!(s2.paste_delay_ms, 200);
    }
}

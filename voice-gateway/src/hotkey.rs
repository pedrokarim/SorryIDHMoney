use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyManager,
};

pub struct HotkeyManager {
    manager: GlobalHotKeyManager,
    current_hotkey: HotKey,
}

impl HotkeyManager {
    pub fn new(hotkey_str: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let manager = GlobalHotKeyManager::new()?;
        let hotkey = parse_hotkey_string(hotkey_str)?;
        manager.register(hotkey)?;

        Ok(Self {
            manager,
            current_hotkey: hotkey,
        })
    }

    pub fn hotkey_id(&self) -> u32 {
        self.current_hotkey.id()
    }

    pub fn re_register(&mut self, hotkey_str: &str) -> Result<(), Box<dyn std::error::Error>> {
        let new_hotkey = parse_hotkey_string(hotkey_str)?;
        // Unregister l'ancien
        let _ = self.manager.unregister(self.current_hotkey);
        // Register le nouveau
        self.manager.register(new_hotkey)?;
        self.current_hotkey = new_hotkey;
        Ok(())
    }
}

pub fn parse_hotkey_string(s: &str) -> Result<HotKey, Box<dyn std::error::Error>> {
    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();

    if parts.len() < 2 {
        return Err("Le raccourci doit contenir au moins un modificateur et une touche (ex: Ctrl+Alt+V)".into());
    }

    let key_str = parts.last().unwrap();
    let modifier_strs = &parts[..parts.len() - 1];

    // Parse modifiers
    let mut modifiers = Modifiers::empty();
    for m in modifier_strs {
        match m.to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "alt" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            "super" | "win" | "meta" | "cmd" => modifiers |= Modifiers::SUPER,
            other => return Err(format!("Modificateur inconnu: '{}'", other).into()),
        }
    }

    if modifiers.is_empty() {
        return Err("Au moins un modificateur est requis (Ctrl, Alt, Shift, Super)".into());
    }

    // Parse key
    let code = parse_key_code(key_str)?;

    Ok(HotKey::new(Some(modifiers), code))
}

fn parse_key_code(s: &str) -> Result<Code, Box<dyn std::error::Error>> {
    let key = s.to_uppercase();
    let code = match key.as_str() {
        // Lettres
        "A" => Code::KeyA, "B" => Code::KeyB, "C" => Code::KeyC, "D" => Code::KeyD,
        "E" => Code::KeyE, "F" => Code::KeyF, "G" => Code::KeyG, "H" => Code::KeyH,
        "I" => Code::KeyI, "J" => Code::KeyJ, "K" => Code::KeyK, "L" => Code::KeyL,
        "M" => Code::KeyM, "N" => Code::KeyN, "O" => Code::KeyO, "P" => Code::KeyP,
        "Q" => Code::KeyQ, "R" => Code::KeyR, "S" => Code::KeyS, "T" => Code::KeyT,
        "U" => Code::KeyU, "V" => Code::KeyV, "W" => Code::KeyW, "X" => Code::KeyX,
        "Y" => Code::KeyY, "Z" => Code::KeyZ,
        // Chiffres
        "0" => Code::Digit0, "1" => Code::Digit1, "2" => Code::Digit2,
        "3" => Code::Digit3, "4" => Code::Digit4, "5" => Code::Digit5,
        "6" => Code::Digit6, "7" => Code::Digit7, "8" => Code::Digit8,
        "9" => Code::Digit9,
        // Touches fonction
        "F1" => Code::F1, "F2" => Code::F2, "F3" => Code::F3, "F4" => Code::F4,
        "F5" => Code::F5, "F6" => Code::F6, "F7" => Code::F7, "F8" => Code::F8,
        "F9" => Code::F9, "F10" => Code::F10, "F11" => Code::F11, "F12" => Code::F12,
        // Touches speciales
        "SPACE" | "ESPACE" => Code::Space,
        "TAB" => Code::Tab,
        "ENTER" | "RETURN" | "ENTREE" => Code::Enter,
        "BACKSPACE" => Code::Backspace,
        "DELETE" | "DEL" | "SUPPR" => Code::Delete,
        "ESCAPE" | "ESC" | "ECHAP" => Code::Escape,
        "HOME" | "DEBUT" => Code::Home,
        "END" | "FIN" => Code::End,
        "PAGEUP" => Code::PageUp,
        "PAGEDOWN" => Code::PageDown,
        "UP" | "HAUT" => Code::ArrowUp,
        "DOWN" | "BAS" => Code::ArrowDown,
        "LEFT" | "GAUCHE" => Code::ArrowLeft,
        "RIGHT" | "DROITE" => Code::ArrowRight,
        other => return Err(format!("Touche inconnue: '{}'", other).into()),
    };
    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ctrl_alt_v() {
        let hk = parse_hotkey_string("Ctrl+Alt+V").unwrap();
        assert_eq!(hk.id(), HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyV).id());
    }

    #[test]
    fn parse_ctrl_shift_d() {
        let hk = parse_hotkey_string("Ctrl+Shift+D").unwrap();
        assert_eq!(hk.id(), HotKey::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyD).id());
    }

    #[test]
    fn parse_case_insensitive() {
        let hk1 = parse_hotkey_string("ctrl+alt+v").unwrap();
        let hk2 = parse_hotkey_string("CTRL+ALT+V").unwrap();
        assert_eq!(hk1.id(), hk2.id());
    }

    #[test]
    fn parse_with_spaces() {
        let hk = parse_hotkey_string(" Ctrl + Alt + V ").unwrap();
        assert_eq!(hk.id(), HotKey::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyV).id());
    }

    #[test]
    fn parse_invalid_key_fails() {
        assert!(parse_hotkey_string("Ctrl+Alt+???").is_err());
    }

    #[test]
    fn parse_no_modifier_fails() {
        assert!(parse_hotkey_string("V").is_err());
    }

    #[test]
    fn parse_function_key() {
        let hk = parse_hotkey_string("Ctrl+F5").unwrap();
        assert_eq!(hk.id(), HotKey::new(Some(Modifiers::CONTROL), Code::F5).id());
    }

    #[test]
    fn parse_triple_modifier() {
        let hk = parse_hotkey_string("Ctrl+Alt+Shift+Z").unwrap();
        assert_eq!(hk.id(), HotKey::new(
            Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
            Code::KeyZ
        ).id());
    }

    #[test]
    fn parse_digit() {
        let hk = parse_hotkey_string("Alt+3").unwrap();
        assert_eq!(hk.id(), HotKey::new(Some(Modifiers::ALT), Code::Digit3).id());
    }

    #[test]
    fn parse_empty_fails() {
        assert!(parse_hotkey_string("").is_err());
    }
}

use global_hotkey::{
    hotkey::{Code, HotKey, Modifiers},
    GlobalHotKeyManager,
};

pub struct HotkeyManager {
    _manager: GlobalHotKeyManager,
    hotkey_id: u32,
}

impl HotkeyManager {
    /// Enregistre le raccourci global Ctrl+Alt+V.
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let manager = GlobalHotKeyManager::new()?;

        let hotkey = HotKey::new(
            Some(Modifiers::CONTROL | Modifiers::ALT),
            Code::KeyV,
        );
        let hotkey_id = hotkey.id();

        manager.register(hotkey)?;
        eprintln!("Hotkey registered: Ctrl+Alt+V (id={})", hotkey_id);

        Ok(Self {
            _manager: manager,
            hotkey_id,
        })
    }

    pub fn hotkey_id(&self) -> u32 {
        self.hotkey_id
    }
}

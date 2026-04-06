use std::thread;
use std::time::Duration;

use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

/// Copie le texte dans le presse-papiers puis simule Ctrl+V pour le coller.
pub fn paste_text(text: &str, paste_delay_ms: u64) -> Result<(), Box<dyn std::error::Error>> {
    // Copier dans le presse-papiers
    let mut clipboard = Clipboard::new()?;
    clipboard.set_text(text)?;

    // Petit délai pour que le presse-papiers soit prêt
    thread::sleep(Duration::from_millis(paste_delay_ms.clamp(50, 600)));

    // Simuler Ctrl+V
    let mut enigo = Enigo::new(&Settings::default())?;
    enigo.key(Key::Control, Direction::Press)?;
    enigo.key(Key::Unicode('v'), Direction::Click)?;
    enigo.key(Key::Control, Direction::Release)?;

    Ok(())
}

use std::thread;
use std::time::Duration;

use arboard::Clipboard;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

/// Copie le texte dans le presse-papiers.
pub fn copy_to_clipboard(text: &str) -> Result<(), Box<dyn std::error::Error>> {
    let mut clipboard = Clipboard::new()?;
    clipboard.set_text(text)?;
    Ok(())
}

/// Simule Ctrl+V pour coller le contenu du presse-papiers.
pub fn simulate_paste(delay_ms: u64) -> Result<(), Box<dyn std::error::Error>> {
    thread::sleep(Duration::from_millis(delay_ms.clamp(50, 600)));

    let mut enigo = Enigo::new(&Settings::default())?;
    enigo.key(Key::Control, Direction::Press)?;
    enigo.key(Key::Unicode('v'), Direction::Click)?;
    enigo.key(Key::Control, Direction::Release)?;

    Ok(())
}

/// Copie le texte dans le presse-papiers puis simule Ctrl+V pour le coller.
pub fn paste_text(text: &str, paste_delay_ms: u64) -> Result<(), Box<dyn std::error::Error>> {
    copy_to_clipboard(text)?;
    simulate_paste(paste_delay_ms)?;
    Ok(())
}

/// Copie le texte dans le presse-papiers sans simuler le collage.
/// Utilisé quand auto_paste est désactivé.
pub fn copy_only(text: &str) -> Result<(), Box<dyn std::error::Error>> {
    copy_to_clipboard(text)
}

/// Lit le contenu actuel du presse-papiers.
pub fn read_clipboard() -> Result<String, Box<dyn std::error::Error>> {
    let mut clipboard = Clipboard::new()?;
    Ok(clipboard.get_text()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_and_read_roundtrip() {
        let text = "Voice Gateway test 12345";
        copy_to_clipboard(text).expect("copy failed");
        let result = read_clipboard().expect("read failed");
        assert_eq!(result, text);
    }

    #[test]
    fn copy_only_does_not_crash() {
        copy_only("test copy only").expect("copy_only failed");
        let result = read_clipboard().expect("read failed");
        assert_eq!(result, "test copy only");
    }

    #[test]
    fn copy_empty_string() {
        copy_to_clipboard("").expect("copy empty failed");
        let result = read_clipboard().expect("read failed");
        assert_eq!(result, "");
    }

    #[test]
    fn copy_unicode() {
        let text = "Bonjour à tous ! 日本語 🎤";
        copy_to_clipboard(text).expect("copy unicode failed");
        let result = read_clipboard().expect("read failed");
        assert_eq!(result, text);
    }

    #[test]
    fn copy_long_text() {
        let text = "a".repeat(10_000);
        copy_to_clipboard(&text).expect("copy long failed");
        let result = read_clipboard().expect("read failed");
        assert_eq!(result, text);
    }
}

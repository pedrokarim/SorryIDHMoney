use tray_icon::{
    menu::{Menu, MenuId, MenuItem, PredefinedMenuItem},
    TrayIcon, TrayIconBuilder,
};

use crate::state::GatewayState;

pub struct Tray {
    tray_icon: TrayIcon,
    pub quit_item_id: MenuId,
    pub show_item_id: MenuId,
}

impl Tray {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let menu = Menu::new();

        let show_item = MenuItem::new("Afficher", true, None);
        let shortcut_item = MenuItem::new("Raccourci : Ctrl+Alt+V", false, None);
        let quit_item = MenuItem::new("Quitter", true, None);

        menu.append(&show_item)?;
        menu.append(&PredefinedMenuItem::separator())?;
        menu.append(&shortcut_item)?;
        menu.append(&PredefinedMenuItem::separator())?;
        menu.append(&quit_item)?;

        let icon = create_icon(&[64, 164, 223], 16);

        let tray_icon = TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_tooltip("Voice Gateway")
            .with_icon(icon)
            .build()?;

        let quit_item_id = quit_item.id().clone();
        let show_item_id = show_item.id().clone();

        Ok(Self {
            tray_icon,
            quit_item_id,
            show_item_id,
        })
    }

    pub fn quit_item_id(&self) -> &MenuId {
        &self.quit_item_id
    }

    pub fn show_item_id(&self) -> &MenuId {
        &self.show_item_id
    }

    pub fn update_state(&self, state: &GatewayState) {
        let (tooltip, color) = match state {
            GatewayState::Idle => ("Voice Gateway", [64u8, 164, 223]),
            GatewayState::WaitingForRecording => ("Voice Gateway - Connexion...", [255, 165, 0]),
            GatewayState::Recording => ("Voice Gateway - Enregistrement...", [220, 50, 50]),
            GatewayState::Processing => ("Voice Gateway - Traitement...", [255, 165, 0]),
        };

        let _ = self.tray_icon.set_tooltip(Some(tooltip));
        let _ = self.tray_icon.set_icon(Some(create_icon(&color, 16)));
    }
}

fn create_icon(rgb: &[u8; 3], size: u32) -> tray_icon::Icon {
    let pixel_count = (size * size) as usize;
    let mut rgba = Vec::with_capacity(pixel_count * 4);
    for _ in 0..pixel_count {
        rgba.push(rgb[0]);
        rgba.push(rgb[1]);
        rgba.push(rgb[2]);
        rgba.push(255);
    }
    tray_icon::Icon::from_rgba(rgba, size, size).expect("Failed to create icon")
}

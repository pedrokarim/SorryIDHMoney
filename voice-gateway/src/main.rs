#![windows_subsystem = "windows"]

mod clipboard;
mod hotkey;
mod settings;
mod state;
mod tray;
mod ws_server;

use std::f32::consts::TAU;
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, AtomicIsize, Ordering},
    mpsc, Arc, Mutex,
};

use chrono::{DateTime, Local};
use crossbeam_channel::select;
use eframe::egui;
use global_hotkey::GlobalHotKeyEvent;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::json;
use tray_icon::menu::{MenuEvent, MenuId};
use windows_sys::Win32::Foundation::HWND;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SetForegroundWindow, ShowWindowAsync, SW_HIDE, SW_RESTORE, SW_SHOW,
};

use settings::{AppSettings, CloseAction};
use state::{Action, GatewayEvent, GatewayState};
use ws_server::{WsEvent, WsSender};

const BG_BASE: egui::Color32 = egui::Color32::from_rgb(15, 18, 24);
const BG_PANEL: egui::Color32 = egui::Color32::from_rgb(26, 31, 41);
const BG_PANEL_SOFT: egui::Color32 = egui::Color32::from_rgb(33, 39, 52);
const BG_BUTTON: egui::Color32 = egui::Color32::from_rgb(40, 47, 63);
const BG_BUTTON_HOVER: egui::Color32 = egui::Color32::from_rgb(52, 61, 82);
const BORDER_SOFT: egui::Color32 = egui::Color32::from_rgb(67, 76, 98);
const TEXT_PRIMARY: egui::Color32 = egui::Color32::from_rgb(239, 242, 248);
const TEXT_SECONDARY: egui::Color32 = egui::Color32::from_rgb(163, 172, 189);
const TEXT_MUTED: egui::Color32 = egui::Color32::from_rgb(110, 121, 141);
const ACCENT_SKY: egui::Color32 = egui::Color32::from_rgb(96, 180, 255);
const ACCENT_RED: egui::Color32 = egui::Color32::from_rgb(255, 100, 114);
const ACCENT_ORANGE: egui::Color32 = egui::Color32::from_rgb(255, 176, 84);
const ACCENT_MINT: egui::Color32 = egui::Color32::from_rgb(96, 224, 170);
const ACCENT_GOLD: egui::Color32 = egui::Color32::from_rgb(255, 208, 102);

const COMPACT_SIZE: egui::Vec2 = egui::vec2(282.0, 196.0);
const HISTORY_SIZE: egui::Vec2 = egui::vec2(432.0, 560.0);
const SETTINGS_SIZE: egui::Vec2 = egui::vec2(432.0, 540.0);

#[derive(Clone, Copy, PartialEq, Eq)]
enum ViewMode {
    Compact,
    History,
    Settings,
}

#[derive(Clone)]
struct HistoryEntry {
    text: String,
    timestamp: DateTime<Local>,
    word_count: usize,
}

type SharedEguiContext = Arc<Mutex<Option<egui::Context>>>;

#[derive(Default)]
struct UiRequests {
    show_window: AtomicBool,
    hotkey_pressed: AtomicBool,
}

#[derive(Default)]
struct NativeWindowController {
    hwnd: AtomicIsize,
}

impl NativeWindowController {
    fn register_from_frame(&self, frame: &eframe::Frame) {
        if self.hwnd.load(Ordering::SeqCst) != 0 {
            return;
        }

        if let Ok(handle) = frame.window_handle() {
            if let RawWindowHandle::Win32(handle) = handle.as_raw() {
                self.hwnd.store(handle.hwnd.get(), Ordering::SeqCst);
            }
        }
    }

    fn show(&self) {
        let hwnd = self.hwnd.load(Ordering::SeqCst);
        if hwnd == 0 {
            return;
        }

        unsafe {
            let hwnd = hwnd as HWND;
            ShowWindowAsync(hwnd, SW_RESTORE);
            ShowWindowAsync(hwnd, SW_SHOW);
            let _ = SetForegroundWindow(hwnd);
        }
    }

    fn hide(&self) {
        let hwnd = self.hwnd.load(Ordering::SeqCst);
        if hwnd == 0 {
            return;
        }

        unsafe {
            ShowWindowAsync(hwnd as HWND, SW_HIDE);
        }
    }
}

struct VoiceGatewayApp {
    state: GatewayState,
    tray: tray::Tray,
    _hotkey_manager: hotkey::HotkeyManager,
    event_rx: mpsc::Receiver<WsEvent>,
    ws_sender: WsSender,
    history: Vec<HistoryEntry>,
    view_mode: ViewMode,
    total_words: usize,
    last_error: Option<String>,
    window_hidden: bool,
    extension_connected: bool,
    shared_ctx: SharedEguiContext,
    ui_requests: Arc<UiRequests>,
    window_controller: Arc<NativeWindowController>,
    ctx_registered: bool,
    settings: AppSettings,
}

impl VoiceGatewayApp {
    fn new(
        tray: tray::Tray,
        hotkey_manager: hotkey::HotkeyManager,
        event_rx: mpsc::Receiver<WsEvent>,
        ws_sender: WsSender,
        shared_ctx: SharedEguiContext,
        ui_requests: Arc<UiRequests>,
        window_controller: Arc<NativeWindowController>,
        settings: AppSettings,
    ) -> Self {
        Self {
            state: GatewayState::Idle,
            tray,
            _hotkey_manager: hotkey_manager,
            event_rx,
            ws_sender,
            history: Vec::new(),
            view_mode: ViewMode::Compact,
            total_words: 0,
            last_error: None,
            window_hidden: false,
            extension_connected: false,
            shared_ctx,
            ui_requests,
            window_controller,
            ctx_registered: false,
            settings: settings.sanitized(),
        }
    }

    fn handle_gateway_event(&mut self, event: GatewayEvent) {
        let old_state = self.state.clone();
        let (new_state, actions) = old_state.transition(event);
        self.state = new_state;

        for action in actions {
            self.execute_action(action);
        }
    }

    fn execute_action(&mut self, action: Action) {
        match action {
            Action::SendStartRecording => {
                self.ws_sender.send(&json!({ "type": "start_recording" }));
                self.last_error = None;
            }
            Action::SendCancelRecording => {
                self.ws_sender.send(&json!({ "type": "cancel_recording" }));
            }
            Action::SendStopRecording => {
                self.ws_sender.send(&json!({ "type": "stop_recording" }));
            }
            Action::PasteText(text) => {
                let word_count = text.split_whitespace().count();
                self.total_words += word_count;
                self.history.push(HistoryEntry {
                    text: text.clone(),
                    timestamp: Local::now(),
                    word_count,
                });
                self.enforce_history_limit();

                if let Err(err) = clipboard::paste_text(&text, self.settings.paste_delay_ms) {
                    self.last_error = Some(format!("Impossible de coller le texte: {err}"));
                }
            }
            Action::ShowError(msg) => {
                self.last_error = Some(msg);
            }
            Action::UpdateTrayRecording | Action::UpdateTrayProcessing | Action::UpdateTrayIdle => {
                self.tray.update_state(&self.state);
            }
        }
    }

    fn process_ws_message(&mut self, msg: serde_json::Value) {
        let msg_type = msg.get("type").and_then(|value| value.as_str()).unwrap_or("");
        match msg_type {
            "status" => {
                if msg.get("state").and_then(|value| value.as_str()) == Some("recording") {
                    self.handle_gateway_event(GatewayEvent::RecordingStarted);
                }
            }
            "cancelled" => {
                self.handle_gateway_event(GatewayEvent::Cancelled);
            }
            "transcription" => {
                let text = msg
                    .get("text")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_owned();
                if !text.is_empty() {
                    self.handle_gateway_event(GatewayEvent::TranscriptionReceived(text));
                }
            }
            "error" => {
                let message = msg
                    .get("message")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Erreur inconnue")
                    .to_owned();
                self.handle_gateway_event(GatewayEvent::Error(message));
            }
            _ => {}
        }
    }

    fn enforce_history_limit(&mut self) {
        let limit = self.settings.history_limit;
        if self.history.len() > limit {
            let overflow = self.history.len() - limit;
            self.history.drain(0..overflow);
        }
    }

    fn register_egui_context(&mut self, ctx: &egui::Context) {
        if self.ctx_registered {
            return;
        }

        if let Ok(mut guard) = self.shared_ctx.lock() {
            *guard = Some(ctx.clone());
            self.ctx_registered = true;
        }
    }

    fn persist_settings(&mut self) {
        self.settings = self.settings.clone().sanitized();
        self.enforce_history_limit();
        if let Err(err) = self.settings.save() {
            self.last_error = Some(format!("Impossible d'enregistrer les reglages: {err}"));
        }
    }

    fn set_view_mode(&mut self, view_mode: ViewMode) {
        self.view_mode = view_mode;
    }

    fn extension_bridge_url(&self) -> Option<String> {
        let extension_id = self.settings.extension_id.trim();
        if extension_id.is_empty() {
            None
        } else {
            Some(format!(
                "chrome-extension://{extension_id}/interfaces/voice-gateway.html"
            ))
        }
    }

    fn wake_extension_bridge(&mut self) {
        let Some(url) = self.extension_bridge_url() else {
            self.last_error = Some(
                "Renseignez d'abord l'ID de l'extension dans Reglages > Extension Chrome."
                    .to_owned(),
            );
            return;
        };

        match Command::new("cmd").args(["/C", "start", "", &url]).spawn() {
            Ok(_) => {
                self.last_error = None;
            }
            Err(err) => {
                self.last_error = Some(format!(
                    "Impossible d'ouvrir la page d'extension automatique: {err}"
                ));
            }
        }
    }

    fn process_ui_requests(&mut self, ctx: &egui::Context) {
        if self.ui_requests.show_window.swap(false, Ordering::SeqCst) {
            self.window_hidden = false;
            ctx.request_repaint();
        }

        if self.ui_requests.hotkey_pressed.swap(false, Ordering::SeqCst) {
            self.window_hidden = false;
            ctx.request_repaint();
            self.handle_gateway_event(GatewayEvent::HotkeyPressed);
        }
    }

    fn poll_events(&mut self) {
        while let Ok(event) = self.event_rx.try_recv() {
            match event {
                WsEvent::ClientConnected => self.extension_connected = true,
                WsEvent::ClientDisconnected => {
                    self.extension_connected = false;
                    self.state = GatewayState::Idle;
                }
                WsEvent::Message(msg) => self.process_ws_message(msg),
            }
        }
    }

    fn handle_close_request(&mut self) {
        match self.settings.close_action {
            CloseAction::HideToTray => {
                self.window_controller.hide();
                self.window_hidden = true;
            }
            CloseAction::QuitApp => std::process::exit(0),
        }
    }

    fn active_view_size(&self) -> egui::Vec2 {
        match self.view_mode {
            ViewMode::Compact => COMPACT_SIZE,
            ViewMode::History => HISTORY_SIZE,
            ViewMode::Settings => SETTINGS_SIZE,
        }
    }

    fn today_stats(&self) -> (usize, usize) {
        let today = Local::now().date_naive();
        let mut entries = 0usize;
        let mut words = 0usize;

        for entry in &self.history {
            if entry.timestamp.date_naive() == today {
                entries += 1;
                words += entry.word_count;
            }
        }

        (entries, words)
    }

    fn animated_dots(t: f64) -> &'static str {
        match ((t * 2.2) as usize) % 4 {
            0 => "",
            1 => ".",
            2 => "..",
            _ => "...",
        }
    }

    fn state_copy(&self, t: f64) -> (String, String, egui::Color32, &'static str) {
        match self.state {
            GatewayState::Idle => {
                if self.extension_connected {
                    (
                        "Pret a dicter".to_owned(),
                        "Pont local actif, vous pouvez lancer la capture avec Ctrl+Alt+V.".to_owned(),
                        ACCENT_MINT,
                        "Actif",
                    )
                } else {
                    (
                        "Extension introuvable".to_owned(),
                        "Ouvrez ChatGPT puis laissez l'extension reconnecter le pont local.".to_owned(),
                        ACCENT_GOLD,
                        "Hors ligne",
                    )
                }
            }
            GatewayState::WaitingForRecording => (
                format!("Connexion{}", Self::animated_dots(t)),
                "On attend que ChatGPT prenne la main sur la dictee. Cliquez encore pour annuler."
                    .to_owned(),
                ACCENT_ORANGE,
                "Connexion",
            ),
            GatewayState::Recording => (
                "Ecoute en cours".to_owned(),
                "Parlez normalement. Appuyez encore sur Ctrl+Alt+V pour envoyer.".to_owned(),
                ACCENT_SKY,
                "Micro ouvert",
            ),
            GatewayState::Processing => (
                format!("Transcription{}", Self::animated_dots(t)),
                "Le texte revient dans le champ puis sera colle dans l'application active.".to_owned(),
                ACCENT_SKY,
                "Traitement",
            ),
        }
    }

    fn draw_background(&self, _ui: &mut egui::Ui) {}

    fn draw_topbar(
        &mut self,
        ui: &mut egui::Ui,
        title: &str,
        subtitle: &str,
        show_back: bool,
        back_target: ViewMode,
    ) {
        let rect = ui.max_rect();
        let bar_rect = egui::Rect::from_min_size(rect.min, egui::vec2(rect.width(), 42.0));
        let painter = ui.painter();
        painter.rect_filled(bar_rect, 0.0, BG_PANEL);

        let drag_resp =
            ui.interact(bar_rect, egui::Id::new(("drag_bar", title)), egui::Sense::click_and_drag());
        if drag_resp.dragged() {
            ui.ctx().send_viewport_cmd(egui::ViewportCommand::StartDrag);
        }

        let mut left_x = bar_rect.left() + 14.0;
        if show_back {
            let back_rect = egui::Rect::from_min_size(
                egui::pos2(left_x, bar_rect.top() + 9.0),
                egui::vec2(24.0, 24.0),
            );
            let back_resp = ui.interact(back_rect, egui::Id::new(("back", title)), egui::Sense::click());
            painter.rect_filled(
                back_rect,
                12.0,
                if back_resp.hovered() {
                    BG_BUTTON_HOVER
                } else {
                    BG_BUTTON
                },
            );
            Self::paint_back_icon(painter, back_rect.center(), TEXT_PRIMARY);
            if back_resp.clicked() {
                self.set_view_mode(back_target);
            }
            left_x += 32.0;
        }

        painter.text(
            egui::pos2(left_x, bar_rect.top() + 11.0),
            egui::Align2::LEFT_TOP,
            title,
            egui::FontId::proportional(15.0),
            TEXT_PRIMARY,
        );
        painter.text(
            egui::pos2(left_x, bar_rect.top() + 28.0),
            egui::Align2::LEFT_TOP,
            subtitle,
            egui::FontId::proportional(10.5),
            TEXT_MUTED,
        );

        let close_rect = egui::Rect::from_min_size(
            egui::pos2(bar_rect.right() - 38.0, bar_rect.top() + 9.0),
            egui::vec2(24.0, 24.0),
        );
        let close_resp = ui.interact(close_rect, egui::Id::new(("close", title)), egui::Sense::click());
        painter.rect_filled(
            close_rect,
            12.0,
            if close_resp.hovered() {
                egui::Color32::from_rgb(92, 44, 52)
            } else {
                BG_BUTTON
            },
        );
        Self::paint_close_icon(painter, close_rect.center(), 7.0, TEXT_PRIMARY);
        if close_resp.clicked() {
            self.handle_close_request();
        }
    }

    fn draw_compact(&mut self, ctx: &egui::Context) {
        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(COMPACT_SIZE));

        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(egui::Color32::TRANSPARENT).inner_margin(0.0))
            .show(ctx, |ui| {
                self.draw_background(ui);
                self.draw_topbar(ui, "Voice Gateway", "Capture vocale locale", false, ViewMode::Compact);

                let t = ctx.input(|input| input.time);
                let (status_title, status_subtitle, accent, badge) = self.state_copy(t);
                let rect = ui.max_rect();

                let painter = ui.painter();

                let center_y = rect.top() + 100.0;
                let center_x = rect.center().x;
                let history_rect = egui::Rect::from_center_size(egui::pos2(center_x - 71.0, center_y), egui::vec2(42.0, 42.0));
                let settings_rect = egui::Rect::from_center_size(egui::pos2(center_x + 71.0, center_y), egui::vec2(42.0, 42.0));
                let mic_rect = egui::Rect::from_center_size(egui::pos2(center_x, center_y), egui::vec2(72.0, 72.0));

                let history_resp = ui.interact(history_rect, egui::Id::new("history_button"), egui::Sense::click());
                painter.rect_filled(
                    history_rect,
                    21.0,
                    if history_resp.hovered() { BG_BUTTON_HOVER } else { BG_BUTTON },
                );
                painter.rect_stroke(
                    history_rect,
                    21.0,
                    egui::Stroke::new(1.0, BORDER_SOFT),
                    egui::StrokeKind::Middle,
                );
                Self::paint_list_icon(painter, history_rect.center(), TEXT_PRIMARY);
                if history_resp.clicked() {
                    self.set_view_mode(ViewMode::History);
                }

                let settings_resp = ui.interact(settings_rect, egui::Id::new("settings_button"), egui::Sense::click());
                painter.rect_filled(
                    settings_rect,
                    21.0,
                    if settings_resp.hovered() { BG_BUTTON_HOVER } else { BG_BUTTON },
                );
                painter.rect_stroke(
                    settings_rect,
                    21.0,
                    egui::Stroke::new(1.0, BORDER_SOFT),
                    egui::StrokeKind::Middle,
                );
                Self::paint_gear_icon(painter, settings_rect.center(), TEXT_PRIMARY, t as f32 * 0.1);
                if settings_resp.clicked() {
                    self.set_view_mode(ViewMode::Settings);
                }

                let is_busy =
                    matches!(self.state, GatewayState::WaitingForRecording | GatewayState::Processing);
                let is_recording = self.state == GatewayState::Recording;
                let can_toggle = self.state != GatewayState::Processing;
                let mic_resp = ui.interact(mic_rect, egui::Id::new("mic_button"), egui::Sense::click());
                self.paint_action_button(painter, mic_rect, accent, t as f32, is_recording, is_busy);
                if mic_resp.clicked() && can_toggle {
                    self.handle_gateway_event(GatewayEvent::HotkeyPressed);
                }

                // Status : une seule ligne propre sous les boutons
                let status_y = rect.top() + 158.0;
                let max_w = rect.width() - 36.0;

                let status_galley = painter.layout_no_wrap(
                    status_title,
                    egui::FontId::proportional(12.0),
                    accent,
                );
                painter.galley(
                    egui::pos2(rect.center().x - status_galley.size().x / 2.0, status_y),
                    status_galley,
                    accent,
                );
            });
    }

    fn draw_history(&mut self, ctx: &egui::Context) {
        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(HISTORY_SIZE));

        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(egui::Color32::TRANSPARENT).inner_margin(0.0))
            .show(ctx, |ui| {
                self.draw_background(ui);
                self.draw_topbar(ui, "Historique", "Session locale de transcription", true, ViewMode::Compact);

                let rect = ui.max_rect();
                let painter = ui.painter();
                let (today_entries, today_words) = self.today_stats();

                let stat_top = rect.top() + 58.0;
                let stat_w = (rect.width() - 48.0) / 3.0;
                for (index, (title, value, color)) in [
                    ("Aujourd'hui", today_entries.to_string(), ACCENT_SKY),
                    ("Mots", today_words.to_string(), ACCENT_MINT),
                    ("Session", self.history.len().to_string(), ACCENT_GOLD),
                ]
                .into_iter()
                .enumerate()
                {
                    let x = rect.left() + 18.0 + index as f32 * (stat_w + 6.0);
                    let card = egui::Rect::from_min_size(egui::pos2(x, stat_top), egui::vec2(stat_w, 78.0));
                    painter.rect_filled(card, 18.0, BG_PANEL_SOFT);
                    painter.rect_stroke(
                        card,
                        18.0,
                        egui::Stroke::new(1.0, BORDER_SOFT),
                        egui::StrokeKind::Middle,
                    );
                    painter.text(
                        egui::pos2(card.left() + 14.0, card.top() + 13.0),
                        egui::Align2::LEFT_TOP,
                        title,
                        egui::FontId::proportional(10.5),
                        TEXT_MUTED,
                    );
                    painter.text(
                        egui::pos2(card.left() + 14.0, card.top() + 34.0),
                        egui::Align2::LEFT_TOP,
                        value,
                        egui::FontId::proportional(24.0),
                        color,
                    );
                }

                let clear_rect = egui::Rect::from_min_size(
                    egui::pos2(rect.right() - 112.0, stat_top + 88.0),
                    egui::vec2(94.0, 28.0),
                );
                let clear_resp = ui.interact(clear_rect, egui::Id::new("clear_history"), egui::Sense::click());
                painter.rect_filled(
                    clear_rect,
                    14.0,
                    if clear_resp.hovered() { BG_BUTTON_HOVER } else { BG_BUTTON },
                );
                painter.rect_stroke(
                    clear_rect,
                    14.0,
                    egui::Stroke::new(1.0, BORDER_SOFT),
                    egui::StrokeKind::Middle,
                );
                painter.text(
                    clear_rect.center(),
                    egui::Align2::CENTER_CENTER,
                    "Effacer",
                    egui::FontId::proportional(11.0),
                    TEXT_PRIMARY,
                );
                if clear_resp.clicked() {
                    self.history.clear();
                    self.total_words = 0;
                }

                let scroll_rect = egui::Rect::from_min_max(
                    egui::pos2(rect.left() + 12.0, stat_top + 118.0),
                    egui::pos2(rect.right() - 12.0, rect.bottom() - 12.0),
                );
                ui.scope_builder(egui::UiBuilder::new().max_rect(scroll_rect), |ui| {
                    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
                        ui.add_space(2.0);
                        if self.history.is_empty() {
                            self.empty_state(
                                ui,
                                "Aucune transcription",
                                "Le panneau se remplira ici au fur et a mesure des captures.",
                            );
                        } else {
                            for entry in self.history.iter().rev() {
                                self.history_card(ui, entry);
                                ui.add_space(8.0);
                            }
                        }
                    });
                });
            });
    }

    fn draw_settings(&mut self, ctx: &egui::Context) {
        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(SETTINGS_SIZE));

        egui::CentralPanel::default()
            .frame(egui::Frame::new().fill(egui::Color32::TRANSPARENT).inner_margin(0.0))
            .show(ctx, |ui| {
                self.draw_background(ui);
                self.draw_topbar(ui, "Reglages", "Comportement local du widget", true, ViewMode::Compact);

                let rect = ui.max_rect();
                let body_rect = egui::Rect::from_min_max(
                    egui::pos2(rect.left() + 12.0, rect.top() + 56.0),
                    egui::pos2(rect.right() - 12.0, rect.bottom() - 12.0),
                );
                ui.scope_builder(egui::UiBuilder::new().max_rect(body_rect), |ui| {
                    egui::ScrollArea::vertical().auto_shrink([false, false]).show(ui, |ui| {
                        ui.add_space(2.0);

                        self.settings_card(ui, "Fenetre", "Choisissez ce que fait le bouton X.");
                        let mut settings_changed = false;
                        ui.add_space(8.0);
                        ui.horizontal(|ui| {
                            settings_changed |= ui
                                .radio_value(
                                    &mut self.settings.close_action,
                                    CloseAction::HideToTray,
                                    "Masquer en arriere-plan",
                                )
                                .changed();
                            settings_changed |= ui
                                .radio_value(
                                    &mut self.settings.close_action,
                                    CloseAction::QuitApp,
                                    "Quitter l'application",
                                )
                                .changed();
                        });

                        ui.add_space(18.0);
                        self.settings_card(
                            ui,
                            "Extension Chrome",
                            "ID de l'extension pour que le logiciel puisse reveiller sa page Voice Gateway.",
                        );
                        ui.add_space(8.0);
                        settings_changed |= ui
                            .text_edit_singleline(&mut self.settings.extension_id)
                            .changed();

                        ui.add_space(8.0);
                        ui.horizontal(|ui| {
                            let wake = ui.add(
                                egui::Button::new(
                                    egui::RichText::new("Reveiller l'extension")
                                        .size(10.8)
                                        .color(TEXT_PRIMARY),
                                )
                                .fill(BG_BUTTON)
                                .corner_radius(12.0),
                            );
                            if wake.clicked() {
                                self.wake_extension_bridge();
                            }

                            if let Some(url) = self.extension_bridge_url() {
                                let copy = ui.add(
                                    egui::Button::new(
                                        egui::RichText::new("Copier l'URL")
                                            .size(10.8)
                                            .color(TEXT_PRIMARY),
                                    )
                                    .fill(BG_BUTTON)
                                    .corner_radius(12.0),
                                );
                                if copy.clicked() {
                                    ui.ctx().copy_text(url);
                                }
                            }
                        });

                        ui.add_space(18.0);
                        self.settings_card(ui, "Collage", "Le delai laisse au presse-papiers avant Ctrl+V.");
                        ui.add_space(8.0);
                        settings_changed |= ui
                            .add(
                                egui::Slider::new(&mut self.settings.paste_delay_ms, 50..=600)
                                    .suffix(" ms")
                                    .show_value(true),
                            )
                            .changed();

                        ui.add_space(18.0);
                        self.settings_card(ui, "Historique", "Combien d'elements garder dans la session.");
                        ui.add_space(8.0);
                        settings_changed |= ui
                            .add(
                                egui::Slider::new(&mut self.settings.history_limit, 10..=200)
                                    .suffix(" entrees")
                                    .show_value(true),
                            )
                            .changed();

                        if settings_changed {
                            self.persist_settings();
                        }

                        ui.add_space(20.0);
                        egui::Frame::new()
                            .fill(BG_PANEL_SOFT)
                            .stroke(egui::Stroke::new(1.0, BORDER_SOFT))
                            .corner_radius(18.0)
                            .inner_margin(egui::Margin::same(14))
                            .show(ui, |ui| {
                                ui.label(egui::RichText::new("Fichier de reglages").size(12.0).color(TEXT_MUTED));
                                ui.add_space(4.0);
                                ui.label(
                                    egui::RichText::new(settings::storage_path().display().to_string())
                                        .size(11.0)
                                        .color(TEXT_PRIMARY),
                                );
                                ui.add_space(10.0);
                                ui.label(
                                    egui::RichText::new(
                                        "Les changements sont appliques tout de suite et sauvegardes localement.",
                                    )
                                    .size(10.5)
                                    .color(TEXT_SECONDARY),
                                );
                            });
                    });
                });
            });
    }

    fn empty_state(&self, ui: &mut egui::Ui, title: &str, body: &str) {
        egui::Frame::new()
            .fill(BG_PANEL_SOFT)
            .stroke(egui::Stroke::new(1.0, BORDER_SOFT))
            .corner_radius(20.0)
            .inner_margin(egui::Margin::same(24))
            .show(ui, |ui| {
                ui.vertical_centered(|ui| {
                    ui.add_space(20.0);
                    ui.label(egui::RichText::new(title).size(17.0).color(TEXT_PRIMARY));
                    ui.add_space(8.0);
                    ui.label(egui::RichText::new(body).size(11.0).color(TEXT_SECONDARY));
                    ui.add_space(20.0);
                });
            });
    }

    fn history_card(&self, ui: &mut egui::Ui, entry: &HistoryEntry) {
        egui::Frame::new()
            .fill(BG_PANEL_SOFT)
            .stroke(egui::Stroke::new(1.0, BORDER_SOFT))
            .corner_radius(18.0)
            .inner_margin(egui::Margin::same(14))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(
                        egui::RichText::new(entry.timestamp.format("%d/%m - %H:%M").to_string())
                            .size(10.5)
                            .color(TEXT_MUTED),
                    );
                    ui.separator();
                    ui.label(
                        egui::RichText::new(format!("{} mots", entry.word_count))
                            .size(10.5)
                            .color(TEXT_MUTED),
                    );
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        let copy = ui.add(
                            egui::Button::new(
                                egui::RichText::new("Copier").size(10.5).color(TEXT_PRIMARY),
                            )
                            .fill(BG_BUTTON)
                            .corner_radius(12.0),
                        );
                        if copy.clicked() {
                            ui.ctx().copy_text(entry.text.clone());
                        }
                    });
                });

                ui.add_space(10.0);
                ui.label(
                    egui::RichText::new(&entry.text)
                        .size(12.0)
                        .line_height(Some(18.0))
                        .color(TEXT_PRIMARY),
                );
            });
    }

    fn settings_card(&self, ui: &mut egui::Ui, title: &str, body: &str) {
        egui::Frame::new()
            .fill(BG_PANEL_SOFT)
            .stroke(egui::Stroke::new(1.0, BORDER_SOFT))
            .corner_radius(18.0)
            .inner_margin(egui::Margin::same(14))
            .show(ui, |ui| {
                ui.label(egui::RichText::new(title).size(13.0).color(TEXT_PRIMARY));
                ui.add_space(3.0);
                ui.label(egui::RichText::new(body).size(10.5).color(TEXT_SECONDARY));
            });
    }

    fn paint_status_badge(
        &self,
        painter: &egui::Painter,
        rect: egui::Rect,
        label: &str,
        accent: egui::Color32,
    ) {
        painter.rect_filled(
            rect,
            12.0,
            egui::Color32::from_rgba_unmultiplied(accent.r(), accent.g(), accent.b(), 32),
        );
        painter.rect_stroke(
            rect,
            12.0,
            egui::Stroke::new(
                1.0,
                egui::Color32::from_rgba_unmultiplied(accent.r(), accent.g(), accent.b(), 90),
            ),
            egui::StrokeKind::Middle,
        );
        painter.circle_filled(egui::pos2(rect.left() + 12.0, rect.center().y), 4.0, accent);
        painter.text(
            egui::pos2(rect.left() + 22.0, rect.center().y),
            egui::Align2::LEFT_CENTER,
            label,
            egui::FontId::proportional(10.5),
            TEXT_PRIMARY,
        );
    }

    fn paint_action_button(
        &self,
        painter: &egui::Painter,
        rect: egui::Rect,
        accent: egui::Color32,
        t: f32,
        is_recording: bool,
        _is_busy: bool,
    ) {
        let center = rect.center();
        let radius = rect.width() / 2.0;

        if is_recording {
            // Un seul cercle qui pulse (effet vague)
            let wave = ((t * 2.0).sin() * 0.5 + 0.5);
            let wave_radius = radius + 6.0 + wave * 8.0;
            let wave_alpha = (30.0 + wave * 30.0) as u8;
            painter.circle_filled(
                center,
                wave_radius,
                egui::Color32::from_rgba_unmultiplied(
                    ACCENT_SKY.r(), ACCENT_SKY.g(), ACCENT_SKY.b(), wave_alpha,
                ),
            );
        } else {
            // Un seul cercle de fond discret
            painter.circle_filled(
                center,
                radius + 4.0,
                egui::Color32::from_rgba_unmultiplied(accent.r(), accent.g(), accent.b(), 25),
            );
        }

        // Le bouton principal
        painter.circle_filled(center, radius, accent);

        // Icone
        if is_recording {
            Self::paint_stop_icon(painter, center, egui::Color32::WHITE);
        } else {
            Self::paint_mic_icon(painter, center, egui::Color32::WHITE);
        }
    }

    fn paint_idle_glow(&self, painter: &egui::Painter, center: egui::Pos2, t: f32) {
        for index in 0..4 {
            let phase = t * 0.6 + index as f32 * 0.7;
            let radius = 30.0 + index as f32 * 8.0 + phase.sin().abs() * 2.5;
            let alpha = 14 + index as u8 * 6;
            painter.circle_stroke(
                center,
                radius,
                egui::Stroke::new(
                    1.0,
                    egui::Color32::from_rgba_unmultiplied(
                        ACCENT_SKY.r(),
                        ACCENT_SKY.g(),
                        ACCENT_SKY.b(),
                        alpha,
                    ),
                ),
            );
        }
    }

    fn paint_orbit(
        &self,
        painter: &egui::Painter,
        center: egui::Pos2,
        radius: f32,
        accent: egui::Color32,
        t: f32,
    ) {
        for index in 0..10 {
            let progress = index as f32 / 10.0;
            let angle = t * 2.6 + progress * TAU;
            let dot_center = egui::pos2(center.x + angle.cos() * radius, center.y + angle.sin() * radius);
            let strength = ((t * 3.0 + progress * TAU).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
            let alpha = (40.0 + strength * 120.0) as u8;
            painter.circle_filled(
                dot_center,
                2.8 + strength * 1.6,
                egui::Color32::from_rgba_unmultiplied(accent.r(), accent.g(), accent.b(), alpha),
            );
        }
    }

    fn paint_equalizer(&self, painter: &egui::Painter, center: egui::Pos2, t: f32) {
        for index in 0..4 {
            let x = center.x - 14.0 + index as f32 * 9.0;
            let strength = ((t * 5.8 + index as f32 * 0.9).sin() * 0.5 + 0.5).clamp(0.0, 1.0);
            let height = 10.0 + strength * 14.0;
            let bar_rect = egui::Rect::from_center_size(egui::pos2(x, center.y + 22.0), egui::vec2(4.0, height));
            painter.rect_filled(bar_rect, 2.0, egui::Color32::WHITE);
        }
    }

    fn paint_back_icon(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32) {
        let stroke = egui::Stroke::new(2.0, color);
        painter.line_segment(
            [egui::pos2(center.x + 3.0, center.y - 6.0), egui::pos2(center.x - 3.0, center.y)],
            stroke,
        );
        painter.line_segment(
            [egui::pos2(center.x - 3.0, center.y), egui::pos2(center.x + 3.0, center.y + 6.0)],
            stroke,
        );
    }

    fn paint_close_icon(painter: &egui::Painter, center: egui::Pos2, size: f32, color: egui::Color32) {
        let delta = size / 2.0;
        let stroke = egui::Stroke::new(1.7, color);
        painter.line_segment(
            [egui::pos2(center.x - delta, center.y - delta), egui::pos2(center.x + delta, center.y + delta)],
            stroke,
        );
        painter.line_segment(
            [egui::pos2(center.x + delta, center.y - delta), egui::pos2(center.x - delta, center.y + delta)],
            stroke,
        );
    }

    fn paint_mic_icon(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32) {
        let stroke = egui::Stroke::new(2.2, color);
        painter.rect_filled(
            egui::Rect::from_center_size(egui::pos2(center.x, center.y - 5.0), egui::vec2(10.0, 16.0)),
            5.0,
            color,
        );
        painter.line_segment([egui::pos2(center.x - 9.0, center.y + 1.0), egui::pos2(center.x - 9.0, center.y + 7.0)], stroke);
        painter.line_segment([egui::pos2(center.x + 9.0, center.y + 1.0), egui::pos2(center.x + 9.0, center.y + 7.0)], stroke);
        painter.line_segment([egui::pos2(center.x - 9.0, center.y + 7.0), egui::pos2(center.x - 4.5, center.y + 11.0)], stroke);
        painter.line_segment([egui::pos2(center.x + 9.0, center.y + 7.0), egui::pos2(center.x + 4.5, center.y + 11.0)], stroke);
        painter.line_segment([egui::pos2(center.x - 4.5, center.y + 11.0), egui::pos2(center.x + 4.5, center.y + 11.0)], stroke);
        painter.line_segment([egui::pos2(center.x, center.y + 11.0), egui::pos2(center.x, center.y + 15.0)], stroke);
        painter.line_segment([egui::pos2(center.x - 5.5, center.y + 15.0), egui::pos2(center.x + 5.5, center.y + 15.0)], stroke);
    }

    fn paint_stop_icon(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32) {
        painter.rect_filled(egui::Rect::from_center_size(center, egui::vec2(16.0, 16.0)), 4.0, color);
    }

    fn paint_list_icon(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32) {
        let stroke = egui::Stroke::new(2.0, color);
        for offset in [-6.0, 0.0, 6.0] {
            painter.line_segment(
                [egui::pos2(center.x - 8.0, center.y + offset), egui::pos2(center.x + 8.0, center.y + offset)],
                stroke,
            );
        }
    }

    fn paint_gear_icon(painter: &egui::Painter, center: egui::Pos2, color: egui::Color32, rotation_hint: f32) {
        let stroke = egui::Stroke::new(1.8, color);
        for index in 0..6 {
            let angle = rotation_hint + index as f32 * (TAU / 6.0);
            let inner = egui::pos2(center.x + angle.cos() * 6.0, center.y + angle.sin() * 6.0);
            let outer = egui::pos2(center.x + angle.cos() * 9.0, center.y + angle.sin() * 9.0);
            painter.line_segment([inner, outer], stroke);
        }
        painter.circle_stroke(center, 6.0, stroke);
        painter.circle_filled(center, 2.3, color);
    }

}

impl eframe::App for VoiceGatewayApp {
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        self.window_controller.register_from_frame(frame);
        self.register_egui_context(ctx);
        self.poll_events();
        self.process_ui_requests(ctx);

        if self.window_hidden {
            return;
        }

        ctx.send_viewport_cmd(egui::ViewportCommand::InnerSize(self.active_view_size()));
        ctx.request_repaint_after(std::time::Duration::from_millis(16));

        match self.view_mode {
            ViewMode::Compact => self.draw_compact(ctx),
            ViewMode::History => self.draw_history(ctx),
            ViewMode::Settings => self.draw_settings(ctx),
        }
    }
}

fn request_repaint(shared_ctx: &SharedEguiContext) {
    if let Ok(guard) = shared_ctx.lock() {
        if let Some(ctx) = guard.as_ref() {
            ctx.request_repaint();
        }
    }
}

fn spawn_ui_event_thread(
    show_item_id: MenuId,
    quit_item_id: MenuId,
    hotkey_id: u32,
    ui_requests: Arc<UiRequests>,
    shared_ctx: SharedEguiContext,
    window_controller: Arc<NativeWindowController>,
) {
    std::thread::spawn(move || {
        let menu_rx = MenuEvent::receiver();
        let hotkey_rx = GlobalHotKeyEvent::receiver();

        loop {
            select! {
                recv(menu_rx) -> event => match event {
                    Ok(event) if event.id() == &quit_item_id => std::process::exit(0),
                    Ok(event) if event.id() == &show_item_id => {
                        ui_requests.show_window.store(true, Ordering::SeqCst);
                        window_controller.show();
                        request_repaint(&shared_ctx);
                    }
                    Ok(_) => {}
                    Err(_) => break,
                },
                recv(hotkey_rx) -> event => match event {
                    Ok(event) if event.id() == hotkey_id
                        && event.state == global_hotkey::HotKeyState::Pressed => {
                        ui_requests.hotkey_pressed.store(true, Ordering::SeqCst);
                        window_controller.show();
                        request_repaint(&shared_ctx);
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
            }
        }
    });
}

fn truncate(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let truncated: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

fn main() {
    if std::net::TcpListener::bind(format!("127.0.0.1:{}", ws_server::WS_PORT)).is_err() {
        std::process::exit(0);
    }

    let tray = tray::Tray::new().expect("Failed to create tray icon");
    let hotkey_manager = hotkey::HotkeyManager::new().expect("Failed to register global hotkey");
    let show_item_id = tray.show_item_id().clone();
    let quit_item_id = tray.quit_item_id().clone();
    let hotkey_id = hotkey_manager.hotkey_id();
    let settings = AppSettings::load();

    let shared_ctx: SharedEguiContext = Arc::new(Mutex::new(None));
    let ui_requests = Arc::new(UiRequests::default());
    let window_controller = Arc::new(NativeWindowController::default());

    let (event_tx, event_rx) = mpsc::channel::<WsEvent>();
    let wake_ui: Arc<dyn Fn() + Send + Sync> = {
        let shared_ctx = shared_ctx.clone();
        Arc::new(move || request_repaint(&shared_ctx))
    };
    let ws_sender = ws_server::start_server(event_tx, wake_ui);

    spawn_ui_event_thread(
        show_item_id,
        quit_item_id,
        hotkey_id,
        ui_requests.clone(),
        shared_ctx.clone(),
        window_controller.clone(),
    );

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([COMPACT_SIZE.x, COMPACT_SIZE.y])
            .with_min_inner_size([COMPACT_SIZE.x, COMPACT_SIZE.y])
            .with_title("Voice Gateway")
            .with_always_on_top()
            .with_decorations(false)
            .with_taskbar(false),
        ..Default::default()
    };

    let app = VoiceGatewayApp::new(
        tray,
        hotkey_manager,
        event_rx,
        ws_sender,
        shared_ctx,
        ui_requests,
        window_controller,
        settings,
    );

    eframe::run_native(
        "Voice Gateway",
        options,
        Box::new(|cc| {
            let mut visuals = egui::Visuals::dark();
            visuals.panel_fill = BG_BASE;
            visuals.window_fill = BG_BASE;
            visuals.extreme_bg_color = BG_PANEL;
            visuals.widgets.noninteractive.bg_fill = BG_PANEL_SOFT;
            visuals.widgets.inactive.bg_fill = BG_BUTTON;
            visuals.widgets.hovered.bg_fill = BG_BUTTON_HOVER;
            visuals.widgets.active.bg_fill = ACCENT_SKY;
            visuals.window_corner_radius = egui::CornerRadius::same(24);
            cc.egui_ctx.set_visuals(visuals);

            let mut style = (*cc.egui_ctx.style()).clone();
            style.spacing.item_spacing = egui::vec2(8.0, 6.0);
            style.spacing.button_padding = egui::vec2(12.0, 8.0);
            cc.egui_ctx.set_style(style);

            Ok(Box::new(app))
        }),
    )
    .expect("Failed to start GUI");
}

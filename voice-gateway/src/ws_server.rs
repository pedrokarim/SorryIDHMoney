use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tungstenite::{accept, Message, WebSocket};

pub const WS_PORT: u16 = 59210;

#[derive(Debug)]
pub enum WsEvent {
    ClientConnected,
    ClientDisconnected,
    Message(serde_json::Value),
}

#[derive(Clone)]
pub struct WsSender {
    tx: Arc<Mutex<Option<mpsc::Sender<String>>>>,
}

impl WsSender {
    fn new() -> Self {
        Self {
            tx: Arc::new(Mutex::new(None)),
        }
    }

    pub fn send(&self, msg: &serde_json::Value) {
        if let Ok(guard) = self.tx.lock() {
            if let Some(tx) = guard.as_ref() {
                let json = serde_json::to_string(msg).unwrap_or_default();
                let _ = tx.send(json);
            }
        }
    }

    fn set_sender(&self, sender: Option<mpsc::Sender<String>>) {
        if let Ok(mut guard) = self.tx.lock() {
            *guard = sender;
        }
    }
}

pub fn start_server(
    event_tx: mpsc::Sender<WsEvent>,
    wake_ui: Arc<dyn Fn() + Send + Sync>,
) -> WsSender {
    let ws_sender = WsSender::new();
    let ws_sender_clone = ws_sender.clone();

    thread::spawn(move || {
        let addr = format!("127.0.0.1:{}", WS_PORT);
        let listener = match TcpListener::bind(&addr) {
            Ok(l) => {
                eprintln!("WebSocket server listening on ws://{}", addr);
                l
            }
            Err(e) => {
                eprintln!("Failed to bind WebSocket server on {}: {}", addr, e);
                return;
            }
        };

        for stream in listener.incoming() {
            let stream = match stream {
                Ok(s) => s,
                Err(_) => continue,
            };

            let mut websocket = match accept(stream) {
                Ok(ws) => ws,
                Err(_) => continue,
            };

            eprintln!("WebSocket client connected!");
            let _ = event_tx.send(WsEvent::ClientConnected);
            wake_ui();

            // Canal pour envoyer des messages au client depuis le thread principal
            let (send_tx, send_rx) = mpsc::channel::<String>();
            ws_sender_clone.set_sender(Some(send_tx));

            // Cloner le stream TCP pour avoir un reader ET un writer séparés
            let raw_stream: TcpStream = {
                let tcp = websocket.get_ref();
                tcp.try_clone().expect("Failed to clone TCP stream")
            };

            // Le stream reste en mode BLOQUANT mais avec un timeout de lecture
            // pour pouvoir vérifier les messages à envoyer périodiquement
            let _ = websocket.get_ref().set_read_timeout(Some(Duration::from_millis(200)));
            let _ = websocket.get_ref().set_nonblocking(false);

            // Flag pour signaler la déconnexion entre les threads
            let disconnected = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let disconnected_writer = disconnected.clone();

            // Thread writer : envoie les messages en attente
            let write_stream = raw_stream;
            let writer_handle = thread::spawn(move || {
                // On crée un deuxième WebSocket sur le stream cloné juste pour écrire
                // Non, on ne peut pas faire ça avec tungstenite. On utilise un autre mécanisme.
                // On va plutôt écrire les messages bruts sur le TCP stream.
                // Mais c'est compliqué avec le framing WebSocket.
                //
                // Approche alternative : on garde un seul WebSocket, on alterne read/write
                // dans la même boucle avec un timeout de lecture court.
                drop(write_stream);
            });

            // Boucle principale : read avec timeout + write des messages en attente
            loop {
                if disconnected.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }

                // Lire (avec timeout de 50ms, donc non-bloquant en pratique)
                match websocket.read() {
                    Ok(Message::Text(text)) => {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                            let _ = event_tx.send(WsEvent::Message(json));
                            wake_ui();
                        }
                    }
                    Ok(Message::Close(_)) => break,
                    Ok(Message::Ping(data)) => {
                        let _ = websocket.write(Message::Pong(data));
                        let _ = websocket.flush();
                    }
                    Ok(_) => {}
                    Err(tungstenite::Error::Io(ref e))
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        // Timeout de lecture, c'est normal
                    }
                    Err(tungstenite::Error::Io(ref e))
                        if e.kind() == std::io::ErrorKind::Interrupted =>
                    {
                        // Interrompu, on réessaie
                    }
                    Err(tungstenite::Error::ConnectionClosed)
                    | Err(tungstenite::Error::AlreadyClosed) => break,
                    Err(tungstenite::Error::Protocol(
                        tungstenite::error::ProtocolError::ResetWithoutClosingHandshake,
                    )) => break,
                    Err(e) => {
                        if matches!(e, tungstenite::Error::Io(_)) {
                            break;
                        }
                        // Erreur non-IO : on log et on continue
                        eprintln!("WebSocket read warning: {}", e);
                    }
                }

                // Écrire les messages en attente (non-bloquant via try_recv)
                let mut write_error = false;
                while let Ok(msg) = send_rx.try_recv() {
                    if websocket.write(Message::Text(msg.into())).is_err() {
                        write_error = true;
                        break;
                    }
                    if websocket.flush().is_err() {
                        write_error = true;
                        break;
                    }
                }
                if write_error {
                    break;
                }
            }

            let _ = writer_handle.join();
            ws_sender_clone.set_sender(None);
            let _ = event_tx.send(WsEvent::ClientDisconnected);
            wake_ui();
            eprintln!("WebSocket client disconnected, waiting for new connection...");
        }
    });

    ws_sender
}

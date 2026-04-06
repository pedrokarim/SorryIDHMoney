use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;

use semver::Version;

const GITHUB_REPO: &str = "pedrokarim/SorryIDHMoney";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug)]
pub struct UpdateInfo {
    pub version: String,
    pub download_url: String,
    pub release_url: String,
}

#[derive(Clone, Debug)]
pub enum UpdateStatus {
    Idle,
    Checking,
    UpToDate,
    Available(UpdateInfo),
    Downloading(u8), // progress 0-100
    ReadyToInstall(PathBuf),
    Error(String),
}

pub struct Updater {
    pub status: Arc<Mutex<UpdateStatus>>,
}

impl Updater {
    pub fn new() -> Self {
        Self {
            status: Arc::new(Mutex::new(UpdateStatus::Idle)),
        }
    }

    pub fn current_version() -> &'static str {
        CURRENT_VERSION
    }

    pub fn check_for_updates(&self) {
        let status = self.status.clone();

        {
            let mut s = status.lock().unwrap();
            *s = UpdateStatus::Checking;
        }

        thread::spawn(move || {
            match fetch_latest_release() {
                Ok(Some(info)) => {
                    let current = Version::parse(CURRENT_VERSION).unwrap_or(Version::new(0, 0, 0));
                    let latest =
                        Version::parse(&info.version).unwrap_or(Version::new(0, 0, 0));

                    if latest > current {
                        *status.lock().unwrap() = UpdateStatus::Available(info);
                    } else {
                        *status.lock().unwrap() = UpdateStatus::UpToDate;
                    }
                }
                Ok(None) => {
                    *status.lock().unwrap() = UpdateStatus::UpToDate;
                }
                Err(e) => {
                    *status.lock().unwrap() = UpdateStatus::Error(e);
                }
            }
        });
    }

    pub fn download_and_install(&self) {
        let status = self.status.clone();

        let info = {
            let s = status.lock().unwrap();
            match &*s {
                UpdateStatus::Available(info) => info.clone(),
                _ => return,
            }
        };

        *status.lock().unwrap() = UpdateStatus::Downloading(0);

        thread::spawn(move || {
            match download_update(&info, &status) {
                Ok(path) => {
                    *status.lock().unwrap() = UpdateStatus::ReadyToInstall(path);
                }
                Err(e) => {
                    *status.lock().unwrap() = UpdateStatus::Error(e);
                }
            }
        });
    }

    pub fn apply_update(&self) {
        let status = self.status.lock().unwrap();
        let path = match &*status {
            UpdateStatus::ReadyToInstall(path) => path.clone(),
            _ => return,
        };
        drop(status);

        let current_exe = match std::env::current_exe() {
            Ok(p) => p,
            Err(_) => return,
        };

        // Renommer l'exe actuel en .old, copier le nouveau, puis relancer
        let old_exe = current_exe.with_extension("exe.old");
        let _ = fs::remove_file(&old_exe);

        if fs::rename(&current_exe, &old_exe).is_ok() {
            if fs::copy(&path, &current_exe).is_ok() {
                // Relancer le nouveau exe et quitter
                let _ = std::process::Command::new(&current_exe).spawn();
                std::process::exit(0);
            } else {
                // Rollback
                let _ = fs::rename(&old_exe, &current_exe);
            }
        }
    }

    pub fn get_status(&self) -> UpdateStatus {
        self.status.lock().unwrap().clone()
    }
}

fn fetch_latest_release() -> Result<Option<UpdateInfo>, String> {
    let url = format!(
        "https://api.github.com/repos/{}/releases/latest",
        GITHUB_REPO
    );

    let agent = ureq::agent();
    let body: serde_json::Value = agent
        .get(&url)
        .set("User-Agent", "voice-gateway-updater")
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Requete GitHub echouee: {}", e))?
        .into_json()
        .map_err(|e| format!("JSON invalide: {}", e))?;

    let tag = body["tag_name"]
        .as_str()
        .ok_or("Pas de tag_name")?
        .trim_start_matches('v')
        .to_string();

    let release_url = body["html_url"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let assets = body["assets"].as_array().ok_or("Pas d'assets")?;

    let exe_asset = assets.iter().find(|a: &&serde_json::Value| {
        a["name"]
            .as_str()
            .map(|n| n.ends_with(".exe"))
            .unwrap_or(false)
    });

    match exe_asset {
        Some(asset) => {
            let download_url = asset["browser_download_url"]
                .as_str()
                .unwrap_or("")
                .to_string();

            Ok(Some(UpdateInfo {
                version: tag,
                download_url,
                release_url,
            }))
        }
        None => Ok(None),
    }
}

fn download_update(
    info: &UpdateInfo,
    status: &Arc<Mutex<UpdateStatus>>,
) -> Result<PathBuf, String> {
    let agent = ureq::agent();
    let response = agent
        .get(&info.download_url)
        .set("User-Agent", "voice-gateway-updater")
        .call()
        .map_err(|e| format!("Telechargement echoue: {}", e))?;

    let content_length: usize = response
        .header("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0);

    let download_dir = crate::settings::storage_dir().join("updates");
    let _ = fs::create_dir_all(&download_dir);
    let dest = download_dir.join(format!("voice-gateway-{}.exe", info.version));

    let mut reader = response.into_reader();
    let mut file = fs::File::create(&dest)
        .map_err(|e| format!("Impossible de creer le fichier: {}", e))?;

    let mut downloaded = 0usize;
    let mut buf = [0u8; 8192];
    loop {
        let n = std::io::Read::read(&mut reader, &mut buf)
            .map_err(|e| format!("Erreur lecture: {}", e))?;
        if n == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buf[..n])
            .map_err(|e| format!("Erreur ecriture: {}", e))?;

        downloaded += n;
        if content_length > 0 {
            let progress = ((downloaded as f64 / content_length as f64) * 100.0) as u8;
            *status.lock().unwrap() = UpdateStatus::Downloading(progress.min(99));
        }
    }

    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_version_is_valid_semver() {
        Version::parse(CURRENT_VERSION).expect("CARGO_PKG_VERSION is not valid semver");
    }

    #[test]
    fn update_info_detects_newer_version() {
        let current = Version::parse("0.1.0").unwrap();
        let newer = Version::parse("0.2.0").unwrap();
        assert!(newer > current);
    }

    #[test]
    fn update_info_same_version_is_not_newer() {
        let current = Version::parse("0.1.0").unwrap();
        let same = Version::parse("0.1.0").unwrap();
        assert!(!(same > current));
    }

    #[test]
    fn initial_status_is_idle() {
        let updater = Updater::new();
        assert!(matches!(updater.get_status(), UpdateStatus::Idle));
    }
}

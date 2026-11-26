//! Trouve l'application SixM déjà ouverte, ou la démarre sans fenêtre.

use crate::api::Api;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Dossier des réglages : SIXM_HOME, sinon ~/SixM (comme app/main.js).
pub fn data_dir() -> PathBuf {
    if let Some(d) = std::env::var_os("SIXM_HOME").filter(|d| !d.is_empty()) {
        return PathBuf::from(d);
    }
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap_or_default();
    PathBuf::from(home).join("SixM")
}

/// Adresse de l'application d'après son fichier de verrou, si elle répond.
fn from_lock(lock: &Path) -> Option<Api> {
    let text = std::fs::read_to_string(lock).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let api = Api::from_url(v.get("url")?.as_str()?)?;
    api.state().ok().map(|_| api)
}

/// Dossier du code de SixM (celui qui contient bin/sixm.js).
fn app_root() -> Option<PathBuf> {
    let has = |d: &Path| d.join("bin").join("sixm.js").is_file();
    if let Some(r) = std::env::var_os("SIXM_ROOT").map(PathBuf::from).filter(|d| has(d)) {
        return Some(r);
    }
    let exe = std::env::current_exe().ok()?;
    for dir in exe.ancestors().skip(1) {
        if has(dir) {
            return Some(dir.to_path_buf());
        }
        // Installé : <racine>/SixM.exe, <racine>/app/…
        if has(&dir.join("app")) {
            return Some(dir.join("app"));
        }
    }
    std::env::current_dir().ok().filter(|d| has(d))
}

/// node.exe fourni à côté de l'installation, sinon celui du PATH.
fn node_for(root: &Path) -> PathBuf {
    let bundled = root.parent().map(|p| p.join("node").join(if cfg!(windows) { "node.exe" } else { "node" }));
    match bundled {
        Some(p) if p.is_file() => p,
        _ => PathBuf::from("node"),
    }
}

fn spawn_app(root: &Path) -> Result<(), String> {
    let mut cmd = Command::new(node_for(root));
    cmd.arg(root.join("bin").join("sixm.js"))
        .args(["app", "--no-open"])
        .current_dir(root)
        .env("SIXM_BACKGROUND", "1")
        .env_remove("NODE_OPTIONS")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("Node.js introuvable ({e}). Installez Node.js 20.15 ou plus récent."))
}

/// Se branche sur SixM : adresse transmise par SixM (SIXM_URL), instance déjà ouverte, ou nouvelle instance.
pub fn connect(url: Option<String>, on_step: impl Fn(&str)) -> Result<Api, String> {
    if let Some(url) = url {
        if let Some(api) = Api::from_url(&url) {
            return Ok(api);
        }
    }
    let lock = data_dir().join("app.json");
    if let Some(api) = from_lock(&lock) {
        return Ok(api);
    }
    let root = app_root().ok_or("Fichiers de SixM introuvables : placez sixm-ui à côté de SixM ou définissez SIXM_ROOT.")?;
    on_step("Démarrage de SixM…");
    spawn_app(&root)?;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(30) {
        std::thread::sleep(Duration::from_millis(200));
        if let Some(api) = from_lock(&lock) {
            return Ok(api);
        }
    }
    Err("SixM ne répond pas. Lancez-le depuis un terminal (npm run app) pour voir l'erreur.".into())
}

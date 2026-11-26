//! Client de l'API locale de SixM (app/server.js) : 127.0.0.1, jeton de session dans `x-sixm-token`.
//! Tout ce qui vient d'un serveur distant est affiché comme du texte brut par egui.

use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct State {
    pub settings: Settings,
    pub discovered: Vec<Discovered>,
    pub session: Session,
    pub hosts: Vec<Host>,
    pub lan: Option<String>,
    pub game: GameState,
    pub link_supported: bool,
    pub victory: Victory,
    pub update: Update,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub name: String,
    pub auto_update: bool,
    pub target: String,
    pub victory: String,
    pub games: Vec<Game>,
    pub favorites: Vec<Favorite>,
    pub recents: Vec<String>,
    pub directories: Vec<String>,
    /// Identifiant public du joueur (sixm:…), à donner aux hôtes.
    pub uid: String,
}

/// Serveur public annoncé sur le réseau local.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Discovered {
    pub address: String,
    pub name: String,
}

/// Menu envoyé par un serveur (voir server/menus.js).
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct Menu {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub color: Option<String>,
    pub items: Vec<MenuItem>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct MenuItem {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    pub description: String,
    pub right: String,
    pub icon: String,
    pub disabled: bool,
    pub value: Value,
    pub options: Vec<String>,
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub menu: Option<Box<Menu>>,
}

#[derive(Clone, Debug, Default, Deserialize, serde::Serialize, PartialEq)]
#[serde(default)]
pub struct Game {
    pub id: String,
    pub name: String,
    pub path: String,
    pub console: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Favorite {
    pub address: String,
    pub label: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct LogLine {
    pub seq: i64,
    pub text: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Pos {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Player {
    pub id: Value,
    pub name: String,
    pub pos: Pos,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Module {
    pub connected: bool,
    pub build: Value,
    pub profile: Value,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Session {
    pub status: String,
    pub uid: Option<String>,
    pub admin: bool,
    pub menu: Option<Menu>,
    pub menu_seq: i64,
    pub attempt: i64,
    pub address: Option<String>,
    pub adapter: Option<String>,
    pub error: Option<String>,
    pub log: Vec<LogLine>,
    pub server_name: Option<String>,
    pub id: Value,
    pub module: Option<Module>,
    pub local: Option<Pos>,
    pub players: Vec<Player>,
    pub roster: Vec<Player>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct AccessEntry {
    pub uid: String,
    pub name: String,
    pub at: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Access {
    pub whitelist: Vec<AccessEntry>,
    pub requests: Vec<AccessEntry>,
    pub admins: Vec<AccessEntry>,
}

/// Joueur connecté à un serveur hébergé ici.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct HostPlayer {
    pub id: i64,
    pub name: String,
    pub uid: Option<String>,
    pub admin: bool,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Mod {
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub server: bool,
    pub client: bool,
    pub broken: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub name: String,
    pub description: String,
    pub port: u32,
    pub max_players: u32,
    pub status: String,
    pub log: Vec<String>,
    pub stale: bool,
    pub has_password: bool,
    pub mods: Vec<Mod>,
    pub broken: Option<String>,
    pub visibility: String,
    pub whitelist: bool,
    pub tags: Vec<String>,
    pub motd: String,
    pub directories: Vec<String>,
    pub access: Access,
    pub players: Vec<HostPlayer>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct GameState {
    pub status: String,
    pub name: Option<String>,
    pub error: Option<String>,
    pub log: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Check {
    pub id: String,
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Installed {
    pub commit: String,
    pub built_at: Value,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Victory {
    pub supported: bool,
    pub status: String,
    pub task: Option<String>,
    pub step: String,
    pub progress: Option<f64>,
    pub error: Option<String>,
    pub checks: Option<Vec<Check>>,
    pub pinned: String,
    pub installed: Option<Installed>,
    pub module_stale: bool,
    pub valid: bool,
    pub log: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct Update {
    pub version: String,
    pub status: String,
    pub latest: Option<String>,
    pub error: Option<String>,
    pub mode: String,
}

/// Fiche publique d'un serveur (/info.json), relayée par /api/query.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ServerInfo {
    pub online: bool,
    pub name: String,
    pub description: String,
    pub players: u32,
    pub max_players: u32,
    pub password: bool,
    pub resources: Vec<String>,
    pub ping: u32,
    pub tags: Vec<String>,
    pub visibility: String,
    pub whitelist: bool,
}

/// Serveur listé par un annuaire public.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Listed {
    pub address: String,
    pub name: String,
    pub description: String,
    pub players: u32,
    pub max_players: u32,
    pub password: bool,
    pub whitelist: bool,
    pub tags: Vec<String>,
}

#[derive(Clone)]
pub struct Api {
    origin: String,
    token: String,
    agent: ureq::Agent,
}

impl Api {
    /// `url` : l'adresse donnée par SixM, `http://127.0.0.1:<port>/#<jeton>`.
    pub fn from_url(url: &str) -> Option<Api> {
        let (origin, token) = url.split_once("/#")?;
        if !origin.starts_with("http://127.0.0.1:") || token.is_empty() {
            return None;
        }
        let agent = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_secs(30)))
            .http_status_as_error(false)
            .build()
            .into();
        Some(Api { origin: origin.to_string(), token: token.to_string(), agent })
    }

    fn check(mut res: ureq::http::Response<ureq::Body>) -> Result<ureq::http::Response<ureq::Body>, String> {
        if res.status().is_success() {
            return Ok(res);
        }
        let status = res.status().as_u16();
        let err = res
            .body_mut()
            .read_json::<Value>()
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from));
        Err(err.unwrap_or_else(|| format!("erreur {status}")))
    }

    fn offline(_: ureq::Error) -> String {
        "SixM est fermé. Relancez-le pour continuer.".into()
    }

    pub fn state(&self) -> Result<State, String> {
        let res = self
            .agent
            .get(format!("{}/api/state", self.origin))
            .header("x-sixm-token", &self.token)
            .call()
            .map_err(Self::offline)?;
        Self::check(res)?.body_mut().read_json::<State>().map_err(|e| e.to_string())
    }

    pub fn post(&self, path: &str, body: Value) -> Result<Value, String> {
        let res = self
            .agent
            .post(format!("{}{}", self.origin, path))
            .header("x-sixm-token", &self.token)
            .header("content-type", "application/json")
            .send(body.to_string())
            .map_err(Self::offline)?;
        let mut res = Self::check(res)?;
        Ok(res.body_mut().read_json::<Value>().unwrap_or(Value::Null))
    }

    /// Requête qui renvoie des octets (zip du serveur).
    pub fn post_bytes(&self, path: &str, body: Value) -> Result<Vec<u8>, String> {
        let res = self
            .agent
            .post(format!("{}{}", self.origin, path))
            .header("x-sixm-token", &self.token)
            .send(body.to_string())
            .map_err(Self::offline)?;
        let mut res = Self::check(res)?;
        res.body_mut()
            .with_config()
            .limit(200 << 20)
            .read_to_vec()
            .map_err(|e| e.to_string())
    }

    pub fn import_mod(&self, id: &str, file: &str, data: Vec<u8>) -> Result<Value, String> {
        let enc = |s: &str| -> String {
            s.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                    _ => format!("%{b:02X}"),
                })
                .collect()
        };
        let res = self
            .agent
            .post(format!("{}/api/hosts/import?id={}&file={}", self.origin, enc(id), enc(file)))
            .header("x-sixm-token", &self.token)
            .send(&data[..])
            .map_err(Self::offline)?;
        let mut res = Self::check(res)?;
        Ok(res.body_mut().read_json::<Value>().unwrap_or(Value::Null))
    }

    pub fn query(&self, address: &str) -> Option<ServerInfo> {
        let v = self.post("/api/query", json!({ "address": address })).ok()?;
        serde_json::from_value(v).ok()
    }
}

/// Ce que le fil de fond partage avec l'interface.
#[derive(Default)]
pub struct Shared {
    pub api: Option<Api>,
    pub state: Option<State>,
    pub error: Option<String>,
    pub infos: HashMap<String, ServerInfo>,
    pub toasts: Vec<(String, bool)>,
    /// Adresses à interroger au prochain passage.
    pub wanted: Vec<String>,
    pub query_now: bool,
    pub last_state: Option<Instant>,
    /// Le fil peut ralentir quand la fenêtre est cachée.
    pub hidden: bool,
}

pub type Hub = Arc<Mutex<Shared>>;

/// Rafraîchit l'état toutes les 600 ms et la fiche des serveurs toutes les 10 s.
pub fn spawn_poller(hub: Hub, repaint: impl Fn() + Send + Sync + 'static) {
    let repaint = Arc::new(repaint);
    let current = {
        let hub = hub.clone();
        move || hub.lock().unwrap().api.clone()
    };
    {
        let (hub, repaint, current) = (hub.clone(), repaint.clone(), current.clone());
        std::thread::spawn(move || loop {
            let Some(api) = current() else { return };
            let result = api.state();
            let hidden = {
                let mut s = hub.lock().unwrap();
                match result {
                    Ok(st) => {
                        s.state = Some(st);
                        s.error = None;
                        s.last_state = Some(Instant::now());
                    }
                    Err(e) => s.error = Some(e),
                }
                s.hidden
            };
            repaint();
            std::thread::sleep(Duration::from_millis(if hidden { 3000 } else { 600 }));
        });
    }
    std::thread::spawn(move || {
        let mut last = Instant::now() - Duration::from_secs(60);
        loop {
            let (due, wanted) = {
                let mut s = hub.lock().unwrap();
                let due = s.query_now || last.elapsed() > Duration::from_secs(10);
                s.query_now = false;
                (due && !s.hidden, s.wanted.clone())
            };
            if due && !wanted.is_empty() {
                let Some(api) = current() else { return };
                last = Instant::now();
                let handles: Vec<_> = wanted
                    .into_iter()
                    .map(|a| {
                        let api = api.clone();
                        std::thread::spawn(move || {
                            let info = api.query(&a);
                            (a, info)
                        })
                    })
                    .collect();
                for h in handles {
                    if let Ok((a, Some(info))) = h.join() {
                        hub.lock().unwrap().infos.insert(a, info);
                    }
                }
                repaint();
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    });
}

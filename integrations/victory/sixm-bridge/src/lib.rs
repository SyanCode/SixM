//! SixM module for VIctory. Original code, MIT.
//!
//! Starts only when SixM launched VIctory (it sets `SIXM_BRIDGE_PORT` and `SIXM_BRIDGE_TOKEN`). It then
//! listens on 127.0.0.1 and, for a client that knows the token, sends one JSON object per line:
//!
//! * `{"t":"ready","build":"…","profile":true}` once the title is mapped, and again when that changes;
//! * `{"t":"localPlayer","x":…,"y":…,"z":…,"h":…}`;
//! * `{"t":"camera","m":[…16…]}`: row-major, `clip = m * (x, y, z, 1)`;
//! * `{"t":"did","what":"…","ok":true|false,"error":…}` after each order below.
//!
//! `ready` also says what the profile lets SixM change: `"teleport":true|false` and
//! `"values":[{"name":"noclip","type":"u8"},…]`. The client may then send, one per line:
//!
//! * `{"t":"teleport","x":…,"y":…,"z":…,"h":…}` (`h` optional): writes the player's position;
//! * `{"t":"set","name":"noclip","value":1,"hold":true}`: writes a value; held, it is written again every
//!   frame (the title may reset it) until `{"t":"release","name":"noclip"}`.
//!
//! It goes through checked calls only, and knows no address by itself: those come from a profile the
//! user writes (see [`profile`]). Without `teleport = on` or `value.` lines in it, nothing is written.

#[cfg(windows)]
mod memory;
pub mod orders;
pub mod profile;

/// Call once, early. Does nothing without SixM's environment.
pub fn start() {
    #[cfg(windows)]
    server::start();
}

#[cfg(windows)]
mod server {
    use crate::orders::Order;
    use crate::{memory, profile};
    use std::collections::HashMap;
    use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
    use std::net::{Ipv4Addr, TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::sync::mpsc;
    use std::time::Duration;

    const FRAME: Duration = Duration::from_millis(33);
    const MAX_PROFILE: u64 = 64 << 10;
    const MAX_ORDER: usize = 1024;
    const MAX_ORDERS: usize = 64; // per frame

    pub fn start() {
        let (Ok(port), Ok(token)) = (std::env::var("SIXM_BRIDGE_PORT"), std::env::var("SIXM_BRIDGE_TOKEN")) else { return };
        let Ok(port) = port.parse::<u16>() else { return };
        if token.len() < 16 {
            return;
        }
        let profiles = std::env::var_os("SIXM_PROFILES").map(PathBuf::from);
        // A small stack, below the title's threads: the module must never cost the game a frame.
        let _ = std::thread::Builder::new().name("sixm-bridge".into()).stack_size(256 << 10).spawn(move || {
            memory::lower_priority();
            match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
                Ok(listener) => serve(&listener, &token, profiles.as_deref()),
                Err(e) => eprintln!("sixm-bridge: port {port}: {e}"),
            }
        });
    }

    /// One client at a time.
    pub fn serve(listener: &TcpListener, token: &str, profiles: Option<&Path>) {
        for stream in listener.incoming().flatten() {
            let _ = client(stream, token, profiles);
        }
    }

    fn client(mut stream: TcpStream, token: &str, profiles: Option<&Path>) -> std::io::Result<()> {
        stream.set_nodelay(true)?;
        stream.set_read_timeout(Some(Duration::from_secs(2)))?;
        stream.set_write_timeout(Some(Duration::from_secs(2)))?;
        let mut line = String::new();
        BufReader::new(stream.try_clone()?.take(256)).read_line(&mut line)?;
        if !same(line.trim_end(), token) {
            return Ok(());
        }
        let orders = read_orders(&stream)?;
        let mut held: HashMap<String, Vec<u8>> = HashMap::new();
        let mut title: Option<Title> = None;
        let mut announced = None;
        for tick in 0u64.. {
            // Titles map their image late, and a profile may be written while playing.
            if tick % 60 == 0 {
                title = find_title(profiles);
                let now = title.as_ref().map(|t| (t.build.clone(), t.profile.is_some(), t.error.clone(), abilities(t.profile.as_ref())));
                if now != announced {
                    if let Some((build, ok, error, can)) = &now {
                        let error = error.as_deref().map_or("null".into(), json);
                        writeln!(stream, r#"{{"t":"ready","build":{},"profile":{ok},"error":{error},{can}}}"#, json(build))?;
                    }
                    announced = now;
                }
                // A value the profile no longer has is no longer held.
                let names: Vec<&str> = title.as_ref().and_then(|t| t.profile.as_ref()).map_or(Vec::new(), |p| p.values.iter().map(|v| v.name.as_str()).collect());
                held.retain(|name, _| names.contains(&name.as_str()));
            }
            let target = title.as_ref().and_then(|t| Some((t.base, t.profile.as_ref()?)));
            for order in orders.try_iter().take(MAX_ORDERS) {
                let (what, done) = match target {
                    Some((base, p)) => apply(&order, base, p, &mut held),
                    None => (order.what(), Err("no profile for this build".to_owned())),
                };
                let error = done.as_ref().err().map_or("null".into(), |e| json(e));
                writeln!(stream, r#"{{"t":"did","what":{},"ok":{},"error":{error}}}"#, json(&what), done.is_ok())?;
            }
            if let Some((base, p)) = target {
                for v in &p.values {
                    if let (Some(bytes), Some(at)) = (held.get(&v.name), memory::resolve(base, &v.chain)) {
                        memory::write(at, bytes);
                    }
                }
            }
            if let Some((base, p)) = target {
                if let Some([x, y, z]) = memory::floats::<3>(base, &p.position).filter(|v| v.iter().all(|c| c.abs() < 1e6)) {
                    let h = p.heading.as_ref().and_then(|c| memory::floats::<1>(base, c)).map_or(0.0, |[h]| h);
                    writeln!(stream, r#"{{"t":"localPlayer","x":{x},"y":{y},"z":{z},"h":{h}}}"#)?;
                }
                if let Some(m) = p.camera.as_ref().and_then(|c| memory::floats::<16>(base, c)) {
                    let m = if p.column_major { transpose(m) } else { m };
                    let m: Vec<String> = m.iter().map(f32::to_string).collect();
                    writeln!(stream, r#"{{"t":"camera","m":[{}]}}"#, m.join(","))?;
                }
            }
            // Also notices a client that left, even with nothing to say.
            if tick % 30 == 0 {
                writeln!(stream, r#"{{"t":"tick"}}"#)?;
            }
            std::thread::sleep(FRAME);
        }
        Ok(())
    }

    /// What the profile lets SixM change, as `ready` gives it.
    fn abilities(p: Option<&profile::Profile>) -> String {
        let values: Vec<String> = p.map_or(Vec::new(), |p| {
            p.values.iter().map(|v| format!(r#"{{"name":{},"type":"{}"}}"#, json(&v.name), v.kind.name())).collect()
        });
        format!(r#""teleport":{},"values":[{}]"#, p.is_some_and(|p| p.teleport), values.join(","))
    }

    /// Carries out an order through the profile.
    fn apply(order: &Order, base: u64, p: &profile::Profile, held: &mut HashMap<String, Vec<u8>>) -> (String, Result<(), String>) {
        let done = match order {
            Order::Teleport { x, y, z, h } => {
                if !p.teleport {
                    Err("the profile does not allow teleport".to_owned())
                } else {
                    let bytes: Vec<u8> = [x, y, z].iter().flat_map(|v| v.to_le_bytes()).collect();
                    if !memory::resolve(base, &p.position).is_some_and(|at| memory::write(at, &bytes)) {
                        Err("the position could not be written".to_owned())
                    } else {
                        if let (Some(h), Some(at)) = (h, p.heading.as_ref().and_then(|c| memory::resolve(base, c))) {
                            memory::write(at, &h.to_le_bytes());
                        }
                        Ok(())
                    }
                }
            }
            Order::Set { name, value, hold } => match p.values.iter().find(|v| &v.name == name) {
                None => Err("the profile has no such value".to_owned()),
                Some(v) => match v.kind.bytes(*value) {
                    None => Err(format!("{value} does not fit in {}", v.kind.name())),
                    Some(bytes) => match memory::resolve(base, &v.chain) {
                        Some(at) if memory::write(at, &bytes) => {
                            if *hold {
                                held.insert(name.clone(), bytes);
                            } else {
                                held.remove(name);
                            }
                            Ok(())
                        }
                        _ => Err("the value could not be written".to_owned()),
                    },
                },
            },
            Order::Release { name } => {
                held.remove(name);
                Ok(())
            }
        };
        (order.what(), done)
    }

    /// Lines from the client, read on a thread of their own until it leaves.
    fn read_orders(stream: &TcpStream) -> std::io::Result<mpsc::Receiver<Order>> {
        let (tx, rx) = mpsc::sync_channel(MAX_ORDERS);
        let mut reader = BufReader::new(stream.try_clone()?);
        let _ = std::thread::Builder::new().name("sixm-bridge-orders".into()).stack_size(64 << 10).spawn(move || {
            memory::lower_priority();
            let mut line = Vec::new();
            loop {
                match reader.by_ref().take(MAX_ORDER as u64 + 1).read_until(b'\n', &mut line) {
                    Ok(0) => return,
                    Ok(_) if line.last() != Some(&b'\n') && line.len() > MAX_ORDER => return, // too long: drop the client's orders
                    Ok(_) if line.last() == Some(&b'\n') => {
                        if let Some(order) = std::str::from_utf8(&line).ok().and_then(Order::parse) {
                            if tx.send(order).is_err() {
                                return;
                            }
                        }
                        line.clear();
                    }
                    Ok(_) => {}
                    Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted) => {}
                    Err(_) => return,
                }
            }
        });
        Ok(rx)
    }

    struct Title {
        base: u64,
        build: String,
        profile: Option<profile::Profile>,
        error: Option<String>,
    }

    /// The image a profile names, or else the one VIctory mapped from its cache.
    fn find_title(profiles: Option<&Path>) -> Option<Title> {
        let modules = memory::modules();
        for m in &modules {
            let Some(file) = profiles.map(|d| d.join(format!("{}.profile", m.build))) else { break };
            let Some(text) = read_limited(&file) else { continue };
            let (profile, error) = match profile::parse(&text) {
                Ok(p) if p.build == m.build => (Some(p), None),
                Ok(p) => (None, Some(format!("the profile is for build {}", p.build))),
                Err(e) => (None, Some(e)),
            };
            return Some(Title { base: m.base, build: m.build.clone(), profile, error });
        }
        let m = modules.into_iter().find(|m| {
            let p = m.path.to_lowercase();
            p.ends_with(".exe") && p.contains("\\images\\")
        })?;
        Some(Title { base: m.base, build: m.build, profile: None, error: None })
    }

    fn read_limited(file: &Path) -> Option<String> {
        let f = std::fs::File::open(file).ok()?;
        let mut text = String::new();
        f.take(MAX_PROFILE).read_to_string(&mut text).ok()?;
        Some(text)
    }

    fn transpose(m: [f32; 16]) -> [f32; 16] {
        std::array::from_fn(|i| m[(i % 4) * 4 + i / 4])
    }

    fn json(s: &str) -> String {
        let mut out = String::from("\"");
        for c in s.chars() {
            match c {
                '"' | '\\' => out.extend(['\\', c]),
                c if (c as u32) < 0x20 => out.push(' '),
                c => out.push(c),
            }
        }
        out.push('"');
        out
    }

    /// Compares without stopping at the first difference.
    fn same(a: &str, b: &str) -> bool {
        a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |d, (x, y)| d | (x ^ y)) == 0
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        static POS: [f32; 3] = [10.0, -20.5, 30.0];
        static CAM: [f32; 16] = [1., 2., 3., 4., 5., 6., 7., 8., 9., 10., 11., 12., 13., 14., 15., 16.];
        const TOKEN: &str = "0123456789abcdef";

        fn run(profiles: Option<PathBuf>) -> u16 {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = l.local_addr().unwrap().port();
            std::thread::spawn(move || serve(&l, TOKEN, profiles.as_deref()));
            port
        }

        fn lines(port: u16, hello: &str, n: usize) -> Vec<String> {
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            s.write_all(hello.as_bytes()).unwrap();
            BufReader::new(s).lines().take(n).map_while(Result::ok).collect()
        }

        #[test]
        fn reads_through_a_profile() {
            let exe = std::env::current_exe().unwrap().to_string_lossy().to_lowercase();
            let me = memory::modules().into_iter().find(|m| m.path.to_lowercase() == exe).unwrap();
            let rva = |p: *const f32| p as u64 - me.base;
            let dir = std::env::temp_dir().join(format!("sixm-bridge-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let file = dir.join(format!("{}.profile", me.build));
            std::fs::write(&file, format!("build = {}\nposition = {:#x}\ncamera = {:#x}\ncamera_order = column\n", me.build, rva(POS.as_ptr()), rva(CAM.as_ptr()))).unwrap();
            let out = lines(run(Some(dir.clone())), &format!("{TOKEN}\n"), 4);
            assert_eq!(out[0], format!(r#"{{"t":"ready","build":"{}","profile":true,"error":null,"teleport":false,"values":[]}}"#, me.build));
            assert_eq!(out[1], r#"{"t":"localPlayer","x":10,"y":-20.5,"z":30,"h":0}"#);
            assert_eq!(out[2], r#"{"t":"camera","m":[1,5,9,13,2,6,10,14,3,7,11,15,4,8,12,16]}"#);

            std::fs::write(&file, "build = 1-2\nposition = 0\n").unwrap();
            let out = lines(run(Some(dir.clone())), &format!("{TOKEN}\n"), 1);
            assert!(out[0].contains(r#""profile":false,"error":"the profile is for build 1-2""#), "{}", out[0]);
            std::fs::remove_dir_all(dir).unwrap();
        }

        static WRITABLE: [std::sync::atomic::AtomicU32; 4] = [const { std::sync::atomic::AtomicU32::new(0) }; 4];

        #[test]
        fn carries_out_orders_the_profile_allows() {
            use std::sync::atomic::Ordering::Relaxed;
            let exe = std::env::current_exe().unwrap().to_string_lossy().to_lowercase();
            let me = memory::modules().into_iter().find(|m| m.path.to_lowercase() == exe).unwrap();
            let rva = |i: usize| WRITABLE[i].as_ptr() as u64 - me.base;
            let dir = std::env::temp_dir().join(format!("sixm-bridge-orders-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(format!("{}.profile", me.build)), format!("build = {}\nposition = {:#x}\nteleport = on\nvalue.flag = u8, {:#x}\n", me.build, rva(0), rva(3))).unwrap();
            let mut s = TcpStream::connect(("127.0.0.1", run(Some(dir.clone())))).unwrap();
            s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            s.write_all(format!("{TOKEN}\n").as_bytes()).unwrap();
            let mut lines = BufReader::new(s.try_clone().unwrap()).lines().map_while(Result::ok);
            let ready = lines.next().unwrap();
            assert!(ready.ends_with(r#""teleport":true,"values":[{"name":"flag","type":"u8"}]}"#), "{ready}");
            s.write_all(b"{\"t\":\"teleport\",\"x\":1,\"y\":2,\"z\":3}\n{\"t\":\"set\",\"name\":\"flag\",\"value\":7,\"hold\":true}\n{\"t\":\"set\",\"name\":\"nope\",\"value\":1}\n{\"t\":\"set\",\"name\":\"flag\",\"value\":300}\n").unwrap();
            let did: Vec<String> = lines.filter(|l| l.contains(r#""t":"did""#)).take(4).collect();
            assert_eq!(did[0], r#"{"t":"did","what":"teleport","ok":true,"error":null}"#);
            assert_eq!(did[1], r#"{"t":"did","what":"flag","ok":true,"error":null}"#);
            assert!(did[2].contains(r#""ok":false"#) && did[2].contains("no such value"), "{}", did[2]);
            assert!(did[3].contains("does not fit in u8"), "{}", did[3]);
            let f = |i: usize| f32::from_bits(WRITABLE[i].load(Relaxed));
            assert_eq!([f(0), f(1), f(2)], [1.0, 2.0, 3.0]);
            assert_eq!(WRITABLE[3].load(Relaxed) & 0xff, 7);
            // Held: written again when the title puts it back.
            WRITABLE[3].store(0, Relaxed);
            std::thread::sleep(Duration::from_millis(200));
            assert_eq!(WRITABLE[3].load(Relaxed) & 0xff, 7);
            std::fs::remove_dir_all(dir).unwrap();
        }

        #[test]
        fn refuses_without_the_token() {
            let port = run(None);
            for bad in ["\n", "0123456789abcdeX\n", "POST / HTTP/1.1\r\n\r\n", "0123456789abcdef0\n"] {
                assert!(lines(port, bad, 1).is_empty(), "{bad:?}");
            }
            assert_eq!(lines(port, &format!("{TOKEN}\n"), 1), [r#"{"t":"tick"}"#]);
        }

        #[test]
        fn escapes() {
            assert_eq!(json("a\"b\\c\n"), r#""a\"b\\c ""#);
        }
    }
}

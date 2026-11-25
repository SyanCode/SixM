//! SixM module for VIctory. Original code, MIT.
//!
//! Starts only when SixM launched VIctory (it sets `SIXM_BRIDGE_PORT` and `SIXM_BRIDGE_TOKEN`). It then
//! listens on 127.0.0.1 and, for a client that knows the token, sends one JSON object per line:
//!
//! * `{"t":"ready","build":"…","profile":true}` once the title is mapped, and again when that changes;
//! * `{"t":"localPlayer","x":…,"y":…,"z":…,"h":…}`;
//! * `{"t":"camera","m":[…16…]}`: row-major, `clip = m * (x, y, z, 1)`.
//!
//! It reads the process through checked calls, writes nothing, and knows no address by itself: those
//! come from a profile the user writes (see [`profile`]).

#[cfg(windows)]
mod memory;
pub mod profile;

/// Call once, early. Does nothing without SixM's environment.
pub fn start() {
    #[cfg(windows)]
    server::start();
}

#[cfg(windows)]
mod server {
    use crate::{memory, profile};
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::{Ipv4Addr, TcpListener, TcpStream};
    use std::path::{Path, PathBuf};
    use std::time::Duration;

    const FRAME: Duration = Duration::from_millis(33);
    const MAX_PROFILE: u64 = 64 << 10;

    pub fn start() {
        let (Ok(port), Ok(token)) = (std::env::var("SIXM_BRIDGE_PORT"), std::env::var("SIXM_BRIDGE_TOKEN")) else { return };
        let Ok(port) = port.parse::<u16>() else { return };
        if token.len() < 16 {
            return;
        }
        let profiles = std::env::var_os("SIXM_PROFILES").map(PathBuf::from);
        let _ = std::thread::Builder::new().name("sixm-bridge".into()).spawn(move || {
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
        let mut title: Option<Title> = None;
        let mut announced = None;
        for tick in 0u64.. {
            // Titles map their image late, and a profile may be written while playing.
            if tick % 60 == 0 {
                title = find_title(profiles);
                let now = title.as_ref().map(|t| (t.build.clone(), t.profile.is_some(), t.error.clone()));
                if now != announced {
                    if let Some((build, ok, error)) = &now {
                        let error = error.as_deref().map_or("null".into(), json);
                        writeln!(stream, r#"{{"t":"ready","build":{},"profile":{ok},"error":{error}}}"#, json(build))?;
                    }
                    announced = now;
                }
            }
            if let Some((base, p)) = title.as_ref().and_then(|t| Some((t.base, t.profile.as_ref()?))) {
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
            assert_eq!(out[0], format!(r#"{{"t":"ready","build":"{}","profile":true,"error":null}}"#, me.build));
            assert_eq!(out[1], r#"{"t":"localPlayer","x":10,"y":-20.5,"z":30,"h":0}"#);
            assert_eq!(out[2], r#"{"t":"camera","m":[1,5,9,13,2,6,10,14,3,7,11,15,4,8,12,16]}"#);

            std::fs::write(&file, "build = 1-2\nposition = 0\n").unwrap();
            let out = lines(run(Some(dir.clone())), &format!("{TOKEN}\n"), 1);
            assert!(out[0].contains(r#""profile":false,"error":"the profile is for build 1-2""#), "{}", out[0]);
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

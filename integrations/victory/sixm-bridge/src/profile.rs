//! A profile says where one build of a title keeps the player and the camera. It is a small text file
//! written by the user and kept on their machine. None ships with SixM.
//!
//! ```text
//! build    = 6912ab34-1a2b000        # TimeDateStamp-SizeOfImage, shown by the module
//! position = 0x1000, 0x20, 0x90      # three f32: x, y, z
//! heading  = 0x1000, 0x20, 0xa0      # one f32, radians (optional)
//! camera   = 0x2000, 0x0             # sixteen f32: view-projection matrix (optional)
//! camera_order = row                 # row or column (default: row)
//! ```
//!
//! A chain is an offset from the image base, then offsets followed through pointers: `a` reads at
//! `base + a`; `a, b, c` reads at `[[base + a] + b] + c`.

pub const MAX_CHAIN: usize = 16;

#[derive(Debug, Clone, PartialEq)]
pub struct Profile {
    pub build: String,
    pub position: Vec<u64>,
    pub heading: Option<Vec<u64>>,
    pub camera: Option<Vec<u64>>,
    pub column_major: bool,
}

pub fn parse(text: &str) -> Result<Profile, String> {
    let (mut build, mut position, mut heading, mut camera, mut column_major) = (None, None, None, None, false);
    for (i, raw) in text.trim_start_matches('\u{feff}').lines().enumerate() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let at = |m: &str| format!("line {}: {m}", i + 1);
        let (key, value) = line.split_once('=').ok_or_else(|| at("expected key = value"))?;
        let value = value.trim();
        match key.trim() {
            "build" if is_build(value) => build = Some(value.to_ascii_lowercase()),
            "build" => return Err(at("build must look like 6912ab34-1a2b000")),
            "position" => position = Some(chain(value).map_err(|m| at(&m))?),
            "heading" => heading = Some(chain(value).map_err(|m| at(&m))?),
            "camera" => camera = Some(chain(value).map_err(|m| at(&m))?),
            "camera_order" => {
                column_major = match value {
                    "row" => false,
                    "column" => true,
                    _ => return Err(at("camera_order must be row or column")),
                }
            }
            other => return Err(at(&format!("unknown key {other}"))),
        }
    }
    Ok(Profile {
        build: build.ok_or("missing build")?,
        position: position.ok_or("missing position")?,
        heading,
        camera,
        column_major,
    })
}

fn is_build(s: &str) -> bool {
    let hex = |p: &str| !p.is_empty() && p.len() <= 8 && p.bytes().all(|b| b.is_ascii_hexdigit());
    s.split_once('-').is_some_and(|(a, b)| hex(a) && hex(b))
}

fn chain(s: &str) -> Result<Vec<u64>, String> {
    let out = s
        .split(',')
        .map(|p| {
            let p = p.trim();
            let parsed = match p.strip_prefix("0x") {
                Some(h) => u64::from_str_radix(h, 16),
                None => p.parse(),
            };
            parsed.ok().filter(|v| *v < 1 << 40).ok_or(format!("bad offset {p:?}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if out.len() > MAX_CHAIN {
        return Err(format!("at most {MAX_CHAIN} offsets"));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete() {
        let p = parse("\u{feff}build = 6912AB34-1a2b000 # c\r\nposition=0x10, 32,0x90\n\nheading = 1\ncamera = 0x2000\ncamera_order = column\n").unwrap();
        assert_eq!(p.build, "6912ab34-1a2b000");
        assert_eq!(p.position, [16, 32, 0x90]);
        assert_eq!((p.heading, p.camera, p.column_major), (Some(vec![1]), Some(vec![0x2000]), true));
    }

    #[test]
    fn rejects() {
        for bad in [
            "", "build = 1-2", "position = 1", "build = x\nposition = 1", "build = 1-2\nposition =",
            "build = 1-2\nposition = -1", "build = 1-2\nposition = 0xfffffffffffffff", "build = 1-2\nposition = 1\nnope = 2",
            "build = 1-2\nposition = 1\ncamera_order = diagonal", "build = 1-2\nposition 1", "build = 123456789-2\nposition = 1",
            "build = 1-2\nposition = 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1",
        ] {
            assert!(parse(bad).is_err(), "{bad:?}");
        }
    }
}

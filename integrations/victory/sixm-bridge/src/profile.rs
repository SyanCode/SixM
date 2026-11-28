//! A profile says where one build of a title keeps the player and the camera. It is a small text file
//! written by the user and kept on their machine. None ships with SixM.
//!
//! ```text
//! build    = 6912ab34-1a2b000        # TimeDateStamp-SizeOfImage, shown by the module
//! position = 0x1000, 0x20, 0x90      # three f32: x, y, z
//! heading  = 0x1000, 0x20, 0xa0      # one f32, radians (optional)
//! camera   = 0x2000, 0x0             # sixteen f32: view-projection matrix (optional)
//! camera_order = row                 # row or column (default: row)
//! teleport = on                      # the server may move the player (writes `position`)
//! value.noclip = u8, 0x3000, 0x18    # a value the server may set: name = type (u8, i32, f32), chain
//! ```
//!
//! A chain is an offset from the image base, then offsets followed through pointers: `a` reads at
//! `base + a`; `a, b, c` reads at `[[base + a] + b] + c`.
//!
//! Nothing is written unless the profile says so: `teleport = on` for the position, a `value.` line
//! for each other place. The user, who writes the profile, decides what a server may change.

pub const MAX_CHAIN: usize = 16;
pub const MAX_VALUES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    U8,
    I32,
    F32,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::U8 => "u8",
            Kind::I32 => "i32",
            Kind::F32 => "f32",
        }
    }

    pub fn size(self) -> usize {
        match self {
            Kind::U8 => 1,
            Kind::I32 | Kind::F32 => 4,
        }
    }

    pub fn parse(name: &str) -> Option<Kind> {
        match name {
            "u8" => Some(Kind::U8),
            "i32" => Some(Kind::I32),
            "f32" => Some(Kind::F32),
            _ => None,
        }
    }

    /// The value of the first `size()` bytes of `b`.
    pub fn decode(self, b: &[u8]) -> f64 {
        match self {
            Kind::U8 => f64::from(b[0]),
            Kind::I32 => f64::from(i32::from_le_bytes([b[0], b[1], b[2], b[3]])),
            Kind::F32 => f64::from(f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
        }
    }

    /// The bytes of `v` for this type, or None when it does not fit.
    pub fn bytes(self, v: f64) -> Option<Vec<u8>> {
        if !v.is_finite() {
            return None;
        }
        match self {
            Kind::U8 => (v.fract() == 0.0 && (0.0..=255.0).contains(&v)).then(|| vec![v as u8]),
            Kind::I32 => (v.fract() == 0.0 && (f64::from(i32::MIN)..=f64::from(i32::MAX)).contains(&v)).then(|| (v as i32).to_le_bytes().to_vec()),
            Kind::F32 => (v.abs() < 1e30).then(|| (v as f32).to_le_bytes().to_vec()),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Value {
    pub name: String,
    pub kind: Kind,
    pub chain: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Profile {
    pub build: String,
    pub position: Vec<u64>,
    pub heading: Option<Vec<u64>>,
    pub camera: Option<Vec<u64>>,
    pub column_major: bool,
    pub teleport: bool,
    pub values: Vec<Value>,
}

pub fn parse(text: &str) -> Result<Profile, String> {
    let (mut build, mut position, mut heading, mut camera, mut column_major) = (None, None, None, None, false);
    let (mut teleport, mut values) = (false, Vec::<Value>::new());
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
            "teleport" => {
                teleport = match value {
                    "on" | "yes" | "1" => true,
                    "off" | "no" | "0" => false,
                    _ => return Err(at("teleport must be on or off")),
                }
            }
            key if key.starts_with("value.") => {
                let name = &key["value.".len()..];
                if name.is_empty() || name.len() > 24 || !name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
                    return Err(at("a value name is 1 to 24 of a-z, 0-9 and _"));
                }
                if values.iter().any(|v| v.name == name) {
                    return Err(at(&format!("value {name} given twice")));
                }
                if values.len() == MAX_VALUES {
                    return Err(at(&format!("at most {MAX_VALUES} values")));
                }
                let (kind, rest) = value.split_once(',').ok_or_else(|| at("expected a type, then the chain"))?;
                let kind = Kind::parse(kind.trim()).ok_or_else(|| at("the type is u8, i32 or f32"))?;
                values.push(Value { name: name.to_owned(), kind, chain: chain(rest).map_err(|m| at(&m))? });
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
        teleport,
        values,
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
    fn values_and_teleport() {
        let p = parse("build = 1-2\nposition = 1\nteleport = on\nvalue.noclip = u8, 0x3000, 0x18\nvalue.speed = f32,4\n").unwrap();
        assert!(p.teleport);
        assert_eq!(p.values, [
            Value { name: "noclip".into(), kind: Kind::U8, chain: vec![0x3000, 0x18] },
            Value { name: "speed".into(), kind: Kind::F32, chain: vec![4] },
        ]);
        assert!(!parse("build = 1-2\nposition = 1\n").unwrap().teleport, "off unless asked");
        assert_eq!(Kind::U8.bytes(1.0), Some(vec![1]));
        assert_eq!(Kind::U8.bytes(256.0), None);
        assert_eq!(Kind::U8.bytes(0.5), None);
        assert_eq!(Kind::I32.bytes(-2.0), Some((-2i32).to_le_bytes().to_vec()));
        assert_eq!(Kind::F32.bytes(1.5), Some(1.5f32.to_le_bytes().to_vec()));
        assert_eq!(Kind::F32.bytes(f64::NAN), None);
    }

    #[test]
    fn rejects() {
        for bad in [
            "", "build = 1-2", "position = 1", "build = x\nposition = 1", "build = 1-2\nposition =",
            "build = 1-2\nposition = -1", "build = 1-2\nposition = 0xfffffffffffffff", "build = 1-2\nposition = 1\nnope = 2",
            "build = 1-2\nposition = 1\ncamera_order = diagonal", "build = 1-2\nposition 1", "build = 123456789-2\nposition = 1",
            "build = 1-2\nposition = 1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1",
            "build = 1-2\nposition = 1\nteleport = maybe", "build = 1-2\nposition = 1\nvalue. = u8, 1",
            "build = 1-2\nposition = 1\nvalue.Noclip = u8, 1", "build = 1-2\nposition = 1\nvalue.x = u16, 1",
            "build = 1-2\nposition = 1\nvalue.x = u8", "build = 1-2\nposition = 1\nvalue.x = u8, 1\nvalue.x = u8, 2",
        ] {
            assert!(parse(bad).is_err(), "{bad:?}");
        }
    }
}

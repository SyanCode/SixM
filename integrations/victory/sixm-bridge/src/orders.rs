//! Orders from SixM to the module, one flat JSON object per line (see the crate's documentation). Parsed by
//! hand: the module adds no dependency to the title's build.

use crate::profile::Kind;
use crate::scan::Test;

#[derive(Debug, PartialEq)]
pub enum Order {
    Teleport { x: f32, y: f32, z: f32, h: Option<f32> },
    Set { name: String, value: f64, hold: bool },
    Release { name: String },
    // The memory search (only when the player turned it on in SixM: SIXM_SCANNER=1).
    /// A new search (`first`) or a search among the last results.
    Scan { first: bool, kind: Kind, test: Test },
    /// Writes a value at an address found by the search; held, again every frame.
    Poke { address: u64, kind: Kind, value: f64, hold: bool },
    Unpoke { address: u64 },
    /// Paths of pointers from the title's image to an address.
    Pointers { address: u64 },
}

impl Order {
    pub fn what(&self) -> String {
        match self {
            Order::Teleport { .. } => "teleport".into(),
            Order::Set { name, .. } | Order::Release { name } => name.clone(),
            Order::Scan { .. } => "scan".into(),
            Order::Poke { .. } | Order::Unpoke { .. } => "poke".into(),
            Order::Pointers { .. } => "pointers".into(),
        }
    }

    /// Whether the order belongs to the memory search.
    pub fn scanner(&self) -> bool {
        matches!(self, Order::Scan { .. } | Order::Poke { .. } | Order::Unpoke { .. } | Order::Pointers { .. })
    }

    /// One line from the client. Only the flat objects above: anything else is ignored.
    pub fn parse(line: &str) -> Option<Order> {
        let line = line.trim();
        if !line.starts_with('{') || !line.ends_with('}') {
            return None;
        }
        let num = |k: &str| field(line, k)?.parse::<f64>().ok().filter(|v| v.is_finite());
        let pos = |k: &str| num(k).filter(|v| v.abs() < 1e6).map(|v| v as f32);
        let text = |k: &str| field(line, k)?.strip_prefix('"')?.strip_suffix('"');
        // A user-space address, as a JSON number (exact below 2^53).
        let address = || num("address").filter(|a| a.fract() == 0.0 && *a >= 65536.0 && *a < 140_737_488_355_328.0).map(|a| a as u64);
        let name = || {
            let n = field(line, "name")?.strip_prefix('"')?.strip_suffix('"')?;
            (!n.is_empty() && n.len() <= 24 && n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')).then(|| n.to_owned())
        };
        match field(line, "t")? {
            r#""teleport""# => Some(Order::Teleport { x: pos("x")?, y: pos("y")?, z: pos("z")?, h: pos("h") }),
            r#""set""# => Some(Order::Set { name: name()?, value: num("value")?, hold: field(line, "hold") == Some("true") }),
            r#""release""# => Some(Order::Release { name: name()? }),
            r#""scan""# => {
                let first = match field(line, "kind")? {
                    r#""first""# => true,
                    r#""next""# => false,
                    _ => return None,
                };
                let test = Test::parse(text("test")?, num("a"), num("b"))?;
                Some(Order::Scan { first, kind: Kind::parse(text("type")?)?, test }).filter(|_| !first || test.first())
            }
            r#""poke""# => Some(Order::Poke { address: address()?, kind: Kind::parse(text("type")?)?, value: num("value")?, hold: field(line, "hold") == Some("true") }),
            r#""unpoke""# => Some(Order::Unpoke { address: address()? }),
            r#""pointers""# => Some(Order::Pointers { address: address()? }),
            _ => None,
        }
    }
}

/// The raw value of `"key":` in a flat JSON object: a number, `true`, or a string without escapes.
fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let tag = format!("\"{key}\":");
    let at = line.find(&tag)? + tag.len();
    let rest = line[at..].trim_start();
    let end = if let Some(s) = rest.strip_prefix('"') { s.find(['"', '\\'])? + 2 } else { rest.find([',', '}'])? };
    Some(rest[..end].trim())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_orders() {
        assert_eq!(Order::parse(r#"{"t":"teleport","x":1.5,"y":-2,"z":3e2}"#), Some(Order::Teleport { x: 1.5, y: -2.0, z: 300.0, h: None }));
        assert_eq!(Order::parse(r#"{"t":"teleport","x":1,"y":2,"z":3,"h":0.5}"#).map(|o| o.what()), Some("teleport".into()));
        assert_eq!(Order::parse(r#"{"t":"set","name":"noclip","value":1,"hold":true}"#), Some(Order::Set { name: "noclip".into(), value: 1.0, hold: true }));
        assert_eq!(Order::parse(r#"{"t":"set","name":"speed","value":2.5}"#), Some(Order::Set { name: "speed".into(), value: 2.5, hold: false }));
        assert_eq!(Order::parse(r#"{"t":"release","name":"noclip"}"#), Some(Order::Release { name: "noclip".into() }));
        assert_eq!(
            Order::parse(r#"{"t":"scan","kind":"first","type":"f32","test":"between","a":10,"b":-5}"#),
            Some(Order::Scan { first: true, kind: Kind::F32, test: Test::Between(-5.0, 10.0) })
        );
        assert_eq!(Order::parse(r#"{"t":"scan","kind":"next","type":"i32","test":"decreased"}"#), Some(Order::Scan { first: false, kind: Kind::I32, test: Test::Decreased }));
        assert_eq!(
            Order::parse(r#"{"t":"poke","address":1311768467294899695,"type":"u8","value":1}"#),
            None,
            "beyond user space"
        );
        assert_eq!(Order::parse(r#"{"t":"poke","address":4096000,"type":"u8","value":1,"hold":true}"#), Some(Order::Poke { address: 4096000, kind: Kind::U8, value: 1.0, hold: true }));
        assert_eq!(Order::parse(r#"{"t":"pointers","address":4096000}"#).map(|o| o.scanner()), Some(true));
        for bad in [
            r#"{"t":"scan","kind":"first","type":"f32","test":"changed"}"#, r#"{"t":"scan","kind":"next","type":"u64","test":"changed"}"#,
            r#"{"t":"poke","address":12,"type":"u8","value":1}"#, r#"{"t":"pointers","address":-1}"#,
            "", "[]", r#"{"t":"teleport","x":1,"y":2}"#, r#"{"t":"teleport","x":1e9,"y":2,"z":3}"#, r#"{"t":"set","name":"No","value":1}"#,
            r#"{"t":"set","name":"a\"b","value":1}"#, r#"{"t":"set","name":"x","value":"1"}"#, r#"{"t":"set","name":"x","value":NaN}"#,
            r#"{"t":"write","address":4096}"#, r#"{"t":"release"}"#,
        ] {
            assert_eq!(Order::parse(bad), None, "{bad}");
        }
    }
}

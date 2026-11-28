//! Orders from SixM to the module, one flat JSON object per line (see the crate's documentation). Parsed by
//! hand: the module adds no dependency to the title's build.

#[derive(Debug, PartialEq)]
pub enum Order {
    Teleport { x: f32, y: f32, z: f32, h: Option<f32> },
    Set { name: String, value: f64, hold: bool },
    Release { name: String },
}

impl Order {
    pub fn what(&self) -> String {
        match self {
            Order::Teleport { .. } => "teleport".into(),
            Order::Set { name, .. } | Order::Release { name } => name.clone(),
        }
    }

    /// One line from the client. Only the flat objects above: anything else is ignored.
    pub fn parse(line: &str) -> Option<Order> {
        let line = line.trim();
        if !line.starts_with('{') || !line.ends_with('}') {
            return None;
        }
        let num = |k: &str| field(line, k)?.parse::<f64>().ok().filter(|v| v.is_finite());
        let pos = |k: &str| num(k).filter(|v| v.abs() < 1e6).map(|v| v as f32);
        let name = || {
            let n = field(line, "name")?.strip_prefix('"')?.strip_suffix('"')?;
            (!n.is_empty() && n.len() <= 24 && n.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')).then(|| n.to_owned())
        };
        match field(line, "t")? {
            r#""teleport""# => Some(Order::Teleport { x: pos("x")?, y: pos("y")?, z: pos("z")?, h: pos("h") }),
            r#""set""# => Some(Order::Set { name: name()?, value: num("value")?, hold: field(line, "hold") == Some("true") }),
            r#""release""# => Some(Order::Release { name: name()? }),
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
        for bad in [
            "", "[]", r#"{"t":"teleport","x":1,"y":2}"#, r#"{"t":"teleport","x":1e9,"y":2,"z":3}"#, r#"{"t":"set","name":"No","value":1}"#,
            r#"{"t":"set","name":"a\"b","value":1}"#, r#"{"t":"set","name":"x","value":"1"}"#, r#"{"t":"set","name":"x","value":NaN}"#,
            r#"{"t":"write","address":4096}"#, r#"{"t":"release"}"#,
        ] {
            assert_eq!(Order::parse(bad), None, "{bad}");
        }
    }
}

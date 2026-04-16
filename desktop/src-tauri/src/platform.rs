use serde_json::{json, Value};

/// Returns platform info: OS, architecture, hostname
pub fn get_info() -> Value {
    json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "family": std::env::consts::FAMILY,
        "hostname": whoami::hostname(),
        "username": whoami::username(),
    })
}

use reqwest::Client;
use std::time::Duration;

/// Optional deployment prerequisite. The operator supplies a trusted absolute wg
/// executable, one interface and the expected server public key. Handshake age
/// indicates peer activity only. Routing and the kill switch remain OS policy.
pub async fn require_recent_peer() -> Result<(), String> {
    let Some(executable) = option_env!("REMOTESHIELD_WG_EXECUTABLE") else {
        return Ok(());
    };
    let interface = std::env::var("REMOTESHIELD_WG_INTERFACE")
        .map_err(|_| "WireGuard interface not configured")?;
    let peer =
        std::env::var("REMOTESHIELD_WG_PEER").map_err(|_| "WireGuard peer not configured")?;
    let path = std::path::PathBuf::from(executable);
    if !path.is_absolute()
        || interface.is_empty()
        || interface.len() > 64
        || interface.starts_with('-')
        || !interface
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        || peer.len() != 44
    {
        return Err("Invalid WireGuard probe configuration".into());
    }
    let mut command = tokio::process::Command::new(path);
    command
        .args(["show", &interface, "latest-handshakes"])
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(2), command.output())
        .await
        .map_err(|_| "WireGuard probe timed out")?
        .map_err(|_| "WireGuard probe unavailable")?;
    if !output.status.success() || output.stdout.len() > 65536 {
        return Err("WireGuard probe unavailable".into());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Clock unavailable")?
        .as_secs();
    if recent_peer(&String::from_utf8_lossy(&output.stdout), &peer, now) {
        Ok(())
    } else {
        Err("Expected WireGuard peer has no recent handshake".into())
    }
}

fn recent_peer(output: &str, peer: &str, now: u64) -> bool {
    output
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .any(|(key, value)| {
            key == peer
                && value.trim().parse::<u64>().is_ok_and(|timestamp| {
                    timestamp > 0 && timestamp <= now && now - timestamp <= 180
                })
        })
}

#[tauri::command]
pub async fn wireguard_status(window: tauri::WebviewWindow) -> Result<&'static str, String> {
    if window.label() != "main" {
        return Err("Untrusted caller".into());
    }
    if option_env!("REMOTESHIELD_WG_EXECUTABLE").is_none() {
        return Ok("not_configured");
    }
    require_recent_peer().await?;
    Ok("recent_peer_handshake")
}

/// Legacy command adapter: reports control-plane availability only.
/// This does not inspect WireGuard, routes, DNS, or a kill switch.
pub async fn check_vpn_connected(server_url: &str) -> Result<bool, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(4))
        .danger_accept_invalid_certs(false)
        .build()
        .map_err(|e| e.to_string())?;

    match client.get(format!("{}/health", server_url)).send().await {
        Ok(res) => Ok(res.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn requires_exact_peer_and_recent_handshake() {
        assert!(super::recent_peer("key\t900\nother\t1000", "key", 1000));
        for sample in ["key\t0", "key\t1001", "key\t819", "other\t1000", "key\tn/a"] {
            assert!(!super::recent_peer(sample, "key", 1000));
        }
    }
}

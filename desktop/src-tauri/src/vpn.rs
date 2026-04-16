use reqwest::Client;
use std::time::Duration;

/// Checks VPN connectivity by hitting the backend /health endpoint.
/// If the server is unreachable or the IP doesn't match, returns false.
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

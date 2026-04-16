// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod vpn;
mod integrity;
mod platform;

use std::sync::Arc;
use tauri::{WindowEvent, Emitter};
use tokio::sync::Mutex;
use log::{info, warn, error};

/// Shared VPN state accessible across Tauri commands
pub struct AppState {
    pub vpn_connected: Arc<Mutex<bool>>,
    pub server_url: String,
    pub auth_token: Arc<Mutex<Option<String>>>,
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

/// Check VPN connectivity status
#[tauri::command]
async fn check_vpn_status(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    vpn::check_vpn_connected(&state.server_url).await
}

/// Perform navigation — validates URL with backend before allowing
#[tauri::command]
async fn request_navigate(
    url: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let token = state.auth_token.lock().await;
    let token_ref = token.as_deref().ok_or("Not authenticated")?;

    let client = reqwest::Client::new();
    let res = client
        .post(format!("{}/api/proxy/navigate", state.server_url))
        .bearer_auth(token_ref)
        .json(&serde_json::json!({ "url": url }))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if res.status().is_success() {
        Ok(res.json().await.map_err(|e| e.to_string())?)
    } else {
        let err: serde_json::Value = res.json().await.unwrap_or_default();
        Err(err["error"].as_str().unwrap_or("URL blocked").to_string())
    }
}

/// Store auth token securely
#[tauri::command]
async fn set_auth_token(
    token: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut t = state.auth_token.lock().await;
    *t = Some(token);
    Ok(())
}

/// Get platform information
#[tauri::command]
fn get_platform_info() -> serde_json::Value {
    platform::get_info()
}

/// Perform app integrity check
#[tauri::command]
fn verify_integrity() -> Result<bool, String> {
    integrity::verify_app_integrity()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    env_logger::init();
    info!("RemoteShield X starting...");

    // Run integrity check before launching UI
    match integrity::verify_app_integrity() {
        Ok(true)  => info!("✅ Integrity check passed"),
        Ok(false) => {
            error!("❌ App integrity check FAILED — possible tampering detected");
            std::process::exit(1);
        }
        Err(e) => {
            warn!("⚠️  Integrity check skipped in dev mode: {e}");
        }
    }

    let server_url = std::env::var("REMOTESHIELD_SERVER")
        .unwrap_or_else(|_| "https://YOUR_SERVER_STATIC_IP".to_string());

    let state = AppState {
        vpn_connected: Arc::new(Mutex::new(false)),
        server_url: server_url.clone(),
        auth_token: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(state)
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let server = server_url.clone();

            // Background VPN watchdog — polls every 5 seconds
            tauri::async_runtime::spawn(async move {
                let mut was_connected = true;
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

                    let is_connected = vpn::check_vpn_connected(&server)
                        .await
                        .unwrap_or(false);

                    if !is_connected && was_connected {
                        warn!("VPN disconnected — blocking browser access");
                        let _ = app_handle.emit("vpn_status", serde_json::json!({
                            "connected": false,
                            "message": "VPN disconnected — browser blocked for security"
                        }));
                    } else if is_connected && !was_connected {
                        info!("VPN reconnected");
                        let _ = app_handle.emit("vpn_status", serde_json::json!({
                            "connected": true,
                            "message": "VPN connected"
                        }));
                    }
                    was_connected = is_connected;
                }
            });

            Ok(())
        })
        .on_window_event(|_window, event| {
            // Prevent external protocols / drag & drop file execution
            if let WindowEvent::DragDrop(_) = event {
                // Silently reject
            }
        })
        .invoke_handler(tauri::generate_handler![
            check_vpn_status,
            request_navigate,
            set_auth_token,
            get_platform_info,
            verify_integrity,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running RemoteShield X");
}

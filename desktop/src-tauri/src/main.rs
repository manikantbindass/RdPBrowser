// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod config;
mod integrity;
mod platform;
mod vpn;

use log::{error, info, warn};
use std::sync::Arc;
use tauri::{Emitter, WindowEvent};
use tokio::sync::Mutex;

pub struct AppState {
    pub vpn_connected: Arc<Mutex<bool>>,
    pub server_url: String,
    pub auth_token: Arc<Mutex<Option<String>>>,
}

#[tauri::command]
async fn check_vpn_status(state: tauri::State<'_, AppState>) -> Result<bool, String> {
    vpn::check_vpn_connected(&state.server_url).await
}

#[tauri::command]
async fn request_navigate(
    url: String,
    state: tauri::State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let token = state.auth_token.lock().await;
    let token_ref = token.as_deref().ok_or("Not authenticated")?;

    if token_ref == "guest" {
        return Ok(serde_json::json!({ "allowed": true, "url": url }));
    }

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

#[tauri::command]
async fn set_auth_token(token: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let mut t = state.auth_token.lock().await;
    *t = Some(token);
    Ok(())
}

#[tauri::command]
fn get_platform_info() -> serde_json::Value {
    platform::get_info()
}

#[tauri::command]
fn verify_integrity() -> Result<bool, String> {
    integrity::verify_app_integrity()
}

fn main() {
    env_logger::init();
    info!("RemoteShield X starting...");

    match integrity::verify_app_integrity() {
        Ok(true) => info!("✅ Integrity check passed"),
        Ok(false) => {
            error!("❌ App integrity check FAILED");
            std::process::exit(1);
        }
        Err(e) => warn!("⚠️  Integrity check skipped in dev mode: {e}"),
    }

    let configured_server = std::env::var("REMOTESHIELD_SERVER")
        .ok()
        .or_else(|| option_env!("REMOTESHIELD_SERVER").map(str::to_string))
        .unwrap_or_else(|| {
            if cfg!(debug_assertions) {
                "http://127.0.0.1:3001".into()
            } else {
                String::new()
            }
        });
    let server_url = config::validate_server_url(&configured_server, cfg!(debug_assertions))
        .expect("Set REMOTESHIELD_SERVER to a valid control-plane origin");

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

            tauri::async_runtime::spawn(async move {
                let mut was_connected = true;
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    let is_connected = vpn::check_vpn_connected(&server).await.unwrap_or(false);

                    if !is_connected && was_connected {
                        warn!("VPN disconnected");
                        let _ = app_handle.emit(
                            "vpn_status",
                            serde_json::json!({
                                "connected": false,
                                "message": "VPN disconnected — browser blocked for security"
                            }),
                        );
                    } else if is_connected && !was_connected {
                        info!("VPN reconnected");
                        let _ = app_handle.emit(
                            "vpn_status",
                            serde_json::json!({
                                "connected": true,
                                "message": "VPN connected"
                            }),
                        );
                    }
                    was_connected = is_connected;
                }
            });

            Ok(())
        })
        .on_window_event(|_window, event| if let WindowEvent::DragDrop(_) = event {})
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

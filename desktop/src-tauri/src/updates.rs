use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct PendingUpdate(pub tokio::sync::Mutex<Option<Update>>);

fn signed_feed(app: &tauri::AppHandle) -> Result<Option<tauri_plugin_updater::Updater>, String> {
    let (Some(endpoint), Some(key)) = (
        option_env!("REMOTESHIELD_UPDATE_URL"),
        option_env!("REMOTESHIELD_UPDATE_PUBKEY"),
    ) else {
        return Ok(None);
    };
    let url = url::Url::parse(endpoint).map_err(|_| "Invalid update feed")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || key.trim().is_empty()
    {
        return Err("Invalid signed update configuration".into());
    }
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|_| "Invalid update endpoint")?
        .pubkey(key)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|_| "Invalid updater configuration")?;
    Ok(Some(updater))
}

fn version(value: &str) -> Option<(u64, u64, u64)> {
    let parts: Vec<_> = value.trim_start_matches('v').split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    Some((
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    ))
}
#[tauri::command]
pub async fn check_updates(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<serde_json::Value, String> {
    if window.label() != "main" {
        return Err("Untrusted caller".into());
    }
    let state = app.state::<PendingUpdate>();
    let mut pending = state
        .0
        .try_lock()
        .map_err(|_| "An update operation is running")?;
    *pending = None;
    if let Some(updater) = signed_feed(&app)? {
        let update = updater
            .check()
            .await
            .map_err(|_| "Signed update feed check failed")?;
        let version = update.as_ref().map(|item| item.version.clone());
        *pending = update;
        return Ok(serde_json::json!({
            "available":version.is_some(),"version":version,"installationEnabled":!cfg!(debug_assertions),
            "message":"Installation requires a release build, explicit confirmation and a valid package signature."
        }));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("RemoteShieldX-update-notification")
        .build()
        .map_err(|_| "Update client unavailable")?;
    let mut response = client
        .get("https://api.github.com/repos/manikantbindass/RdPBrowser/releases/latest")
        .send()
        .await
        .map_err(|_| "Release check unavailable")?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(
            serde_json::json!({"available":false,"message":"No published release","installationEnabled":false}),
        );
    }
    if !response.status().is_success() {
        return Err("Release check failed".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Release response unavailable")?
    {
        if bytes.len() + chunk.len() > 1048576 {
            return Err("Release response too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let release: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid release metadata")?;
    let tag = release["tag_name"]
        .as_str()
        .filter(|v| v.len() < 40)
        .ok_or("Missing release version")?;
    let current = app.config().version.clone().unwrap_or_default();
    let available = version(tag)
        .zip(version(&current))
        .is_some_and(|(new, old)| new > old);
    Ok(
        serde_json::json!({"available":available,"version":tag,"current":current,"installationEnabled":false,"message":"Notification only. Signed updater feed and trusted public key must be provisioned before automatic installation."}),
    )
}

#[tauri::command]
pub async fn install_update(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    pending: tauri::State<'_, PendingUpdate>,
    version: String,
) -> Result<(), String> {
    if window.label() != "main" || cfg!(debug_assertions) || signed_feed(&app)?.is_none() {
        return Err("Signed updates are unavailable".into());
    }
    let mut pending = pending
        .0
        .try_lock()
        .map_err(|_| "An update operation is running")?;
    let update = pending
        .take()
        .filter(|item| item.version == version)
        .ok_or("Check for updates again")?;
    if update.download_url.scheme() != "https" {
        return Err("Update package must use HTTPS".into());
    }
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|_| "Update download or signature verification failed")?;
    update
        .install(bytes)
        .map_err(|_| "Verified package installation failed")?;
    app.restart();
}
#[cfg(test)]
mod tests {
    use super::version;
    #[test]
    fn release_versions_are_strict() {
        assert!(version("v2.3.0") > version("2.2.4"));
        assert_eq!(version("2.3.0-beta"), None);
        assert_eq!(version("https://evil.test"), None);
    }
}

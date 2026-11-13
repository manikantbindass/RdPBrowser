use crate::{navigation, AppState};
use tauri::Manager;

const MAX_BYTES: usize = 5 * 1024 * 1024;

/// Explicit download of an independently fetched HTTPS text response. The WebView's
/// download callback never writes to disk and never passes cookies or credentials here.
#[tauri::command]
pub async fn save_text_download(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, AppState>,
    address: String,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("Untrusted caller".into());
    }
    let url = navigation::validate(&address)?;
    if url.scheme() != "https" {
        return Err("Downloads require HTTPS".into());
    }
    crate::vpn::require_recent_peer().await?;
    let token = state
        .auth_token
        .lock()
        .await
        .clone()
        .ok_or("Sign in first")?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Download client unavailable")?;
    let decision = client
        .get(format!("{}/api/v1/proxy/check", state.server_url))
        .bearer_auth(&token)
        .query(&[("url", url.as_str())])
        .send()
        .await
        .map_err(|_| "Policy unavailable")?;
    if !decision.status().is_success()
        || !decision
            .json::<serde_json::Value>()
            .await
            .is_ok_and(|body| body["allowed"] == true && body["url"].as_str() == Some(url.as_str()))
    {
        return Err("Organization policy denied this download".into());
    }
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Download unavailable")?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !response.status().is_success() || content_type.split(';').next() != Some("text/plain") {
        return Err("Only direct HTTPS plain-text responses are accepted".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "Download interrupted")? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("Download exceeds 5 MiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !valid_text(&bytes) {
        return Err("Download is not UTF-8 plain text".into());
    }
    let session = state.auth_token.lock().await;
    if session.as_deref() != Some(token.as_str()) {
        return Err("Session changed".into());
    }
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Download folder unavailable")?
        .join("downloads");
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|_| "Could not create download folder")?;
    if tokio::fs::symlink_metadata(&directory)
        .await
        .map_err(|_| "Download folder unavailable")?
        .file_type()
        .is_symlink()
    {
        return Err("Download folder cannot be a symbolic link".into());
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Clock unavailable")?
        .as_nanos();
    let path = directory.join(format!("remoteshield-{timestamp}.txt"));
    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(|_| "Could not create new download")?;
    let result = file.write_all(&bytes).await;
    drop(file);
    if result.is_err() {
        let _ = tokio::fs::remove_file(&path).await;
        return Err("Could not save download".into());
    }
    Ok(path.to_string_lossy().into_owned())
}

fn valid_text(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_ok_and(|text| {
        text.chars()
            .all(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn rejects_binary_and_terminal_control_sequences() {
        assert!(super::valid_text("hello\r\nworld\t✓".as_bytes()));
        for bytes in [&b"abc\0def"[..], &b"\x1b[31m"[..], &[0xff][..]] {
            assert!(!super::valid_text(bytes));
        }
    }
}

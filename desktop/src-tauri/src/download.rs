use crate::{navigation, AppState};
use std::{path::PathBuf, sync::atomic::Ordering, time::Duration};
use tauri::Manager;
use tokio::io::AsyncWriteExt;

const MAX_FILE_BYTES: u64 = 128 * 1024 * 1024;
const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;
const PREFIX_BYTES: usize = 16;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Format {
    Text,
    Pdf,
    Png,
    Jpeg,
    Gif,
    Webp,
    Mp4,
    Webm,
    Mp3,
    Wav,
}

impl Format {
    fn from_content_type(value: &str) -> Option<Self> {
        match value
            .split(';')
            .next()?
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "text/plain" => Some(Self::Text),
            "application/pdf" => Some(Self::Pdf),
            "image/png" => Some(Self::Png),
            "image/jpeg" => Some(Self::Jpeg),
            "image/gif" => Some(Self::Gif),
            "image/webp" => Some(Self::Webp),
            "video/mp4" => Some(Self::Mp4),
            "video/webm" => Some(Self::Webm),
            "audio/mpeg" => Some(Self::Mp3),
            "audio/wav" | "audio/x-wav" => Some(Self::Wav),
            _ => None,
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Text => "txt",
            Self::Pdf => "pdf",
            Self::Png => "png",
            Self::Jpeg => "jpg",
            Self::Gif => "gif",
            Self::Webp => "webp",
            Self::Mp4 => "mp4",
            Self::Webm => "webm",
            Self::Mp3 => "mp3",
            Self::Wav => "wav",
        }
    }

    fn limit(self) -> u64 {
        if self == Self::Text {
            MAX_TEXT_BYTES
        } else {
            MAX_FILE_BYTES
        }
    }

    fn matches_prefix(self, bytes: &[u8]) -> bool {
        match self {
            Self::Text => true, // Validate the complete UTF-8 body before committing it.
            Self::Pdf => bytes.starts_with(b"%PDF-"),
            Self::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
            Self::Jpeg => bytes.starts_with(b"\xff\xd8\xff"),
            Self::Gif => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
            Self::Webp => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
            Self::Mp4 => bytes.get(4..8) == Some(b"ftyp"),
            Self::Webm => bytes.starts_with(b"\x1a\x45\xdf\xa3"),
            Self::Mp3 => {
                bytes.starts_with(b"ID3")
                    || (bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0)
            }
            Self::Wav => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE"),
        }
    }
}

struct PendingFile(PathBuf);

impl Drop for PendingFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

async fn authorize(
    client: &reqwest::Client,
    origin: &str,
    token: &str,
    url: &url::Url,
    starting: bool,
) -> Result<(), String> {
    let addresses = [url.to_string()];
    // Keep signed URL parameters out of the control-plane request line. The
    // initial navigation decision also performs the proxy's geographic check.
    let (route, payload) = if starting {
        ("proxy/navigate", serde_json::json!({"url": url.as_str()}))
    } else {
        ("auth/status", serde_json::json!({"urls": addresses}))
    };
    let decision = client
        .post(format!("{origin}/api/v1/{route}"))
        .timeout(Duration::from_secs(8))
        .bearer_auth(token)
        .json(&payload)
        .send()
        .await
        .map_err(|_| "Download policy unavailable")?;
    if !decision.status().is_success()
        || !decision
            .json::<serde_json::Value>()
            .await
            .is_ok_and(|body| {
                if starting {
                    body["allowed"] == true && body["url"].as_str() == Some(url.as_str())
                } else {
                    crate::browser::policy_allows(&body, &addresses)
                }
            })
    {
        return Err("Organization policy denied this download".into());
    }
    Ok(())
}

/// Save an approved direct file without handing WebView credentials to the downloader.
#[tauri::command]
pub async fn save_file_download(
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
    let _download = state
        .download
        .try_lock()
        .map_err(|_| "A download is already running")?;
    let generation = state.generation.load(Ordering::SeqCst);
    let token = state
        .auth_token
        .lock()
        .await
        .clone()
        .ok_or("Sign in first")?;
    let current = || state.generation.load(Ordering::SeqCst) == generation;
    crate::vpn::require_recent_peer().await?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .read_timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Download client unavailable")?;
    authorize(&client, &state.server_url, &token, &url, true).await?;
    if !current() {
        return Err("Session changed".into());
    }
    // Construct a separate request: only the control-plane call above carries the bearer token.
    let mut response = client
        .get(url.clone())
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|_| "Download unavailable")?;
    let format = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|header| header.to_str().ok())
        .and_then(Format::from_content_type);
    if response.status() != reqwest::StatusCode::OK {
        return Err(
            "Open a direct HTTPS file link. Redirects and partial responses are not saved.".into(),
        );
    }
    let format =
        format.ok_or("This address did not return a supported image, PDF, media or text file")?;
    let expected = response.content_length();
    if expected.is_some_and(|length| length == 0 || length > format.limit()) {
        return Err("The file is empty or exceeds the download limit".into());
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
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "Clock unavailable")?
        .as_nanos();
    let destination = directory.join(format!("remoteshield-{id}.{}", format.extension()));
    let pending_path = directory.join(format!("remoteshield-{id}.part"));
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending_path)
        .await
        .map_err(|_| "Could not create a temporary download")?;
    let pending = PendingFile(pending_path);
    let mut prefix = Vec::with_capacity(PREFIX_BYTES);
    let mut size = 0;
    let result = async {
        while let Some(chunk) = response.chunk().await.map_err(|_| "Download interrupted")? {
            size += chunk.len() as u64;
            if !current() || size > format.limit() {
                return Err("Session changed or file exceeded its download limit");
            }
            if prefix.len() < PREFIX_BYTES {
                let count = chunk.len().min(PREFIX_BYTES - prefix.len());
                prefix.extend_from_slice(&chunk[..count]);
                if prefix.len() == PREFIX_BYTES && !format.matches_prefix(&prefix) {
                    return Err("File content does not match its reported format");
                }
            }
            file.write_all(&chunk)
                .await
                .map_err(|_| "Could not write download")?;
        }
        if size == 0
            || expected.is_some_and(|length| length != size)
            || !format.matches_prefix(&prefix)
        {
            return Err("File is incomplete or does not match its reported format");
        }
        file.sync_all().await.map_err(|_| "Could not save download")
    }
    .await;
    // Close the descriptor before returning an error so cleanup also works on Windows.
    drop(file);
    result?;
    if format == Format::Text
        && !valid_text(
            &tokio::fs::read(&pending.0)
                .await
                .map_err(|_| "Could not read download")?,
        )
    {
        return Err("Download is not UTF-8 plain text".into());
    }
    crate::vpn::require_recent_peer().await?;
    authorize(&client, &state.server_url, &token, &url, false).await?;
    let session = state.auth_token.lock().await;
    if !current() || session.as_deref() != Some(token.as_str()) {
        return Err("Session changed".into());
    }
    // Publishing with a hard link makes the complete file visible without replacing an existing one.
    tokio::fs::hard_link(&pending.0, &destination)
        .await
        .map_err(|_| "Could not complete download")?;
    Ok(destination.to_string_lossy().into_owned())
}

fn valid_text(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_ok_and(|text| {
        text.chars()
            .all(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_content_types_require_matching_headers() {
        for (mime, sample, extension) in [
            ("application/pdf", &b"%PDF-1.7"[..], "pdf"),
            ("IMAGE/PNG; x=y", &b"\x89PNG\r\n\x1a\n"[..], "png"),
            ("video/mp4", &b"\0\0\0\x20ftypisom"[..], "mp4"),
            ("image/webp", &b"RIFF\0\0\0\0WEBP"[..], "webp"),
        ] {
            let format = Format::from_content_type(mime).unwrap();
            assert_eq!(format.extension(), extension);
            assert!(format.matches_prefix(sample));
            assert!(!format.matches_prefix(b"<html>not a file"));
        }
        for mime in [
            "text/html",
            "image/svg+xml",
            "application/octet-stream",
            "application/x-msdownload",
            "application/vnd.apple.mpegurl",
        ] {
            assert!(Format::from_content_type(mime).is_none());
        }
    }

    #[test]
    fn rejects_binary_and_terminal_control_sequences() {
        assert!(valid_text("hello\r\nworld\t✓".as_bytes()));
        for bytes in [&b"abc\0def"[..], &b"\x1b[31m"[..], &[0xff][..]] {
            assert!(!valid_text(bytes));
        }
    }
}

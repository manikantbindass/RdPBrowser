use url::Url;

pub fn validate(raw: &str) -> Result<Url, String> {
    if raw.len() > 8192 || raw.chars().any(char::is_control) {
        return Err("Invalid navigation URL".into());
    }
    let url = Url::parse(raw).map_err(|_| "Invalid navigation URL")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || matches!(
            url.host_str(),
            Some("tauri.localhost" | "asset.localhost" | "ipc.localhost")
        )
    {
        return Err("Only HTTP(S) URLs without credentials are supported".into());
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::validate;
    #[test]
    fn rejects_unsafe_navigation() {
        for value in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,x",
            "https://user:pass@example.com",
            "https://example.com\n",
            "http://tauri.localhost/",
            "https://asset.localhost/",
        ] {
            assert!(validate(value).is_err(), "{value}");
        }
        assert!(validate("https://example.com/path?q=test").is_ok());
        assert!(validate(&format!("https://example.com/{}", "x".repeat(8192))).is_err());
    }
}

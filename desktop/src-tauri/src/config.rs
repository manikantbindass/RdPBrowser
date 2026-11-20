use url::Url;

pub fn validate_server_url(raw: &str, allow_local_http: bool) -> Result<String, String> {
    let parsed = Url::parse(raw).map_err(|_| "Invalid REMOTESHIELD_SERVER URL")?;
    let local = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if (parsed.scheme() != "https" && !(allow_local_http && local && parsed.scheme() == "http"))
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.host_str().is_none()
    {
        return Err(
            "REMOTESHIELD_SERVER must be HTTPS origin (local HTTP allowed in debug)".into(),
        );
    }
    Ok(parsed.as_str().trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::validate_server_url;
    #[test]
    fn validates_control_plane_origin() {
        assert!(validate_server_url("https://control.test", false).is_ok());
        assert!(validate_server_url("http://127.0.0.1:3001", true).is_ok());
        for value in [
            "http://remote.test",
            "https://user:secret@control.test",
            "https://control.test/api",
            "https://control.test?token=secret",
        ] {
            assert!(validate_server_url(value, false).is_err());
        }
        assert!(validate_server_url("http://127.0.0.1:3001", false).is_err());
    }
}

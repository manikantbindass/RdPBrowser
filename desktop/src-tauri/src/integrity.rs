use sha2::{Sha256, Digest};
use std::fs;
use std::path::Path;

/// In production, we hash the main binary and compare to a known-good hash.
/// In debug/dev mode, this is skipped.
pub fn verify_app_integrity() -> Result<bool, String> {
    #[cfg(debug_assertions)]
    {
        return Err("Dev mode — integrity check skipped".to_string());
    }

    #[cfg(not(debug_assertions))]
    {
        let exe_path = std::env::current_exe()
            .map_err(|e| format!("Cannot locate exe: {e}"))?;

        let bytes = fs::read(&exe_path)
            .map_err(|e| format!("Cannot read exe: {e}"))?;

        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let result = hex::encode(hasher.finalize());

        // In a real deployment, embed the expected hash at build time
        // using a build.rs script or environment variable.
        let expected = option_env!("REMOTESHIELD_EXPECTED_HASH");

        match expected {
            Some(hash) => Ok(result == hash),
            None => {
                log::warn!("REMOTESHIELD_EXPECTED_HASH not set — skipping hash comparison");
                Ok(true)
            }
        }
    }
}

//! Lightweight self-updater backed by GitHub Releases.
//!
//! Checks the repo's latest published release; if its version is higher than
//! the running app, the UI offers an update. Installing downloads the NSIS
//! setup .exe from that release and runs it in passive mode (progress bar,
//! no prompts), which upgrades in place and relaunches Ripple.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_http::reqwest;

const REPO: &str = "larosa023/Ripple";
const USER_AGENT: &str = concat!("Ripple/", env!("CARGO_PKG_VERSION"));

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub version: String,
    pub notes: String,
    pub page_url: String,
    pub download_url: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}

fn parse_version(v: &str) -> Option<semver::Version> {
    semver::Version::parse(v.trim().trim_start_matches('v')).ok()
}

/// Returns update details when a newer release exists, otherwise `None`.
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let current = app.package_info().version.clone();
    let body = client()?
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub returned an error: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Couldn't reach GitHub: {e}"))?;
    let release: GhRelease =
        serde_json::from_slice(&body).map_err(|e| format!("Unexpected response from GitHub: {e}"))?;

    let Some(latest) = parse_version(&release.tag_name) else {
        return Ok(None);
    };
    if latest <= current {
        return Ok(None);
    }
    let Some(asset) = release
        .assets
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with("-setup.exe"))
    else {
        return Ok(None); // release still uploading, or no Windows installer
    };

    Ok(Some(UpdateInfo {
        current: current.to_string(),
        version: latest.to_string(),
        notes: release.body.unwrap_or_default(),
        page_url: release.html_url,
        download_url: asset.browser_download_url.clone(),
    }))
}

/// Downloads the installer and hands over to it. The app exits so files can be replaced.
#[tauri::command]
pub async fn install_update(app: AppHandle, url: String) -> Result<(), String> {
    // Only ever run installers published on this repo's releases.
    let allowed = format!("https://github.com/{REPO}/releases/download/");
    if !url.starts_with(&allowed) || !url.to_ascii_lowercase().ends_with(".exe") {
        return Err("Refusing to install from an unexpected location.".into());
    }

    let bytes = client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Download failed: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    let path = std::env::temp_dir().join("Ripple-update-setup.exe");
    std::fs::write(&path, &bytes).map_err(|e| format!("Couldn't save the installer: {e}"))?;

    // /P = passive (progress only), /UPDATE = upgrade in place, /R = relaunch when done.
    std::process::Command::new(&path)
        .args(["/P", "/UPDATE", "/R"])
        .spawn()
        .map_err(|e| format!("Couldn't start the installer: {e}"))?;

    app.exit(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_version;

    #[test]
    fn compares_release_tags() {
        let v = |s| parse_version(s).unwrap();
        assert!(v("v0.1.1") > v("0.1.0"));
        assert!(v("v0.2.0") > v("v0.1.9"));
        assert!(v("v0.10.0") > v("v0.9.0"));
        assert!(v("v0.1.0") <= v("0.1.0"));
        assert!(parse_version("nightly").is_none());
    }
}

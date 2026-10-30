//! Launches streams in an external player (mpv, VLC, or any custom executable).
//!
//! Arguments are passed directly to the process (no shell), so stream URLs and
//! titles coming from addons cannot inject commands.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    /// "mpv", "vlc" or "custom".
    pub player: String,
    /// Explicit executable path; falls back to auto-detection when empty.
    pub path: Option<String>,
    pub url: String,
    pub title: Option<String>,
    #[serde(default)]
    pub subtitles: Vec<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    pub start_seconds: Option<f64>,
    /// Extra user-defined arguments from Settings.
    #[serde(default)]
    pub extra_args: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DetectedPlayer {
    pub player: String,
    pub path: String,
}

fn allowed_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ["http://", "https://", "magnet:", "rtmp://", "rtsp://", "file://"]
        .iter()
        .any(|p| lower.starts_with(p))
}

fn candidates(player: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    #[cfg(windows)]
    {
        let env = |k: &str| std::env::var(k).unwrap_or_default();
        match player {
            "mpv" => {
                out.push(PathBuf::from(env("ProgramFiles")).join("mpv").join("mpv.exe"));
                out.push(PathBuf::from(env("USERPROFILE")).join("scoop/apps/mpv/current/mpv.exe"));
                out.push(PathBuf::from(env("LOCALAPPDATA")).join("Programs/mpv/mpv.exe"));
                out.push(PathBuf::from(env("ProgramData")).join("chocolatey/bin/mpv.exe"));
            }
            "vlc" => {
                out.push(PathBuf::from(env("ProgramFiles")).join("VideoLAN/VLC/vlc.exe"));
                out.push(PathBuf::from(env("ProgramFiles(x86)")).join("VideoLAN/VLC/vlc.exe"));
            }
            _ => {}
        }
    }
    #[cfg(not(windows))]
    {
        match player {
            "mpv" => out.extend(["/usr/bin/mpv", "/usr/local/bin/mpv", "/opt/homebrew/bin/mpv"].map(PathBuf::from)),
            "vlc" => out.extend(["/usr/bin/vlc", "/Applications/VLC.app/Contents/MacOS/VLC"].map(PathBuf::from)),
            _ => {}
        }
    }
    out
}

fn find_on_path(exe: &str) -> Option<PathBuf> {
    let name = if cfg!(windows) { format!("{exe}.exe") } else { exe.to_string() };
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|d| d.join(&name)).find(|p| p.is_file())
}

fn resolve(player: &str, explicit: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = explicit.map(str::trim).filter(|p| !p.is_empty()) {
        let path = Path::new(p);
        return if path.is_file() {
            Ok(path.to_path_buf())
        } else {
            Err(format!("Player not found at {p}"))
        };
    }
    if player == "custom" {
        return Err("Set a custom player path in Settings.".into());
    }
    candidates(player)
        .into_iter()
        .find(|p| p.is_file())
        .or_else(|| find_on_path(player))
        .ok_or_else(|| format!("{player} was not found. Install it or set its path in Settings."))
}

#[tauri::command]
pub fn detect_players() -> Vec<DetectedPlayer> {
    ["mpv", "vlc"]
        .iter()
        .filter_map(|p| {
            resolve(p, None).ok().map(|path| DetectedPlayer {
                player: p.to_string(),
                path: path.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

#[tauri::command]
pub fn play_external(req: PlayRequest) -> Result<(), String> {
    if !allowed_url(&req.url) {
        return Err("Unsupported stream URL.".into());
    }
    let exe = resolve(&req.player, req.path.as_deref())?;
    let mut cmd = Command::new(&exe);
    let is_vlc = req.player == "vlc";

    if is_vlc {
        if let Some(t) = &req.title {
            cmd.arg(format!("--meta-title={t}"));
        }
        if let Some(s) = req.start_seconds.filter(|s| *s > 0.0) {
            cmd.arg(format!("--start-time={s}"));
        }
        if let Some(sub) = req.subtitles.first() {
            cmd.arg(format!("--input-slave={sub}"));
        }
        if let Some((_, ua)) = req.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("user-agent")) {
            cmd.arg(format!("--http-user-agent={ua}"));
        }
    } else {
        // mpv (and mpv-compatible custom players such as mpv.net)
        if let Some(t) = &req.title {
            cmd.arg(format!("--force-media-title={t}"));
        }
        if let Some(s) = req.start_seconds.filter(|s| *s > 0.0) {
            cmd.arg(format!("--start={s}"));
        }
        for sub in &req.subtitles {
            cmd.arg(format!("--sub-file={sub}"));
        }
        if !req.headers.is_empty() {
            let joined = req
                .headers
                .iter()
                .map(|(k, v)| format!("{k}: {}", v.replace(',', "\\,")))
                .collect::<Vec<_>>()
                .join(",");
            cmd.arg(format!("--http-header-fields={joined}"));
        }
    }

    cmd.args(&req.extra_args);
    if !is_vlc && req.player != "custom" {
        cmd.arg("--"); // end of options: the URL can never be read as a flag
    }
    cmd.arg(&req.url);

    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    cmd.spawn().map(|_| ()).map_err(|e| format!("Could not start player: {e}"))
}

//! Launches streams in an external player (mpv, VLC, or any custom executable).
//!
//! Arguments are passed directly to the process (no shell), so stream URLs and
//! titles coming from addons cannot inject commands.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

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

/// Executable names that count as each player. mpv.net accepts mpv's options.
fn exe_names(player: &str) -> &'static [&'static str] {
    match (player, cfg!(windows)) {
        ("mpv", true) => &["mpv.exe", "mpvnet.exe"],
        // The built-in player needs real mpv (mpv.net can't render into another window).
        ("mpv-embed", true) => &["mpv.exe"],
        ("mpv-embed", false) => &["mpv"],
        ("vlc", true) => &["vlc.exe"],
        ("mpv", false) => &["mpv"],
        ("vlc", false) => &["vlc"],
        _ => &[],
    }
}

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var_os(key).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// Well-known install locations, checked directly.
fn known_paths(player: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if cfg!(windows) {
        let pf = env_dir("ProgramFiles");
        let pf86 = env_dir("ProgramFiles(x86)");
        let local = env_dir("LOCALAPPDATA");
        let home = env_dir("USERPROFILE");
        let data = env_dir("ProgramData");
        let mut push = |base: &Option<PathBuf>, rel: &str| {
            if let Some(b) = base {
                out.push(b.join(rel));
            }
        };
        match player {
            "mpv" => {
                push(&pf, "mpv/mpv.exe");
                push(&pf, "mpv.net/mpvnet.exe");
                push(&local, "Programs/mpv/mpv.exe");
                push(&local, "Programs/mpv.net/mpvnet.exe");
                // winget portable installs and command aliases
                push(&local, "Microsoft/WinGet/Links/mpv.exe");
                push(&local, "Microsoft/WindowsApps/mpv.exe");
                push(&home, "scoop/apps/mpv/current/mpv.exe");
                push(&home, "scoop/shims/mpv.exe");
                push(&data, "chocolatey/bin/mpv.exe");
                push(&data, "chocolatey/lib/mpvio.install/tools/mpv.exe");
            }
            "vlc" => {
                push(&pf, "VideoLAN/VLC/vlc.exe");
                push(&pf86, "VideoLAN/VLC/vlc.exe");
                push(&home, "scoop/apps/vlc/current/vlc.exe");
            }
            _ => {}
        }
    } else {
        let names: &[&str] = match player {
            "mpv" => &["/usr/bin/mpv", "/usr/local/bin/mpv", "/opt/homebrew/bin/mpv"],
            "vlc" => &["/usr/bin/vlc", "/Applications/VLC.app/Contents/MacOS/VLC"],
            _ => &[],
        };
        out.extend(names.iter().map(PathBuf::from));
    }
    out
}

/// PATH directories, including the *saved* user and system PATH from the
/// registry: a player installed while Ripple is running isn't in our own
/// environment yet.
fn path_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if cfg!(windows) {
        for key in [
            r"HKCU\Environment",
            r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        ] {
            let mut cmd = Command::new("reg");
            cmd.args(["query", key, "/v", "Path"]);
            hide_console(&mut cmd);
            if let Ok(out) = cmd.output() {
                let text = String::from_utf8_lossy(&out.stdout);
                if let Some(value) = text.lines().find_map(|l| l.split_once("REG_").map(|(_, v)| v)) {
                    // "SZ    C:\a;C:\b" or "EXPAND_SZ    %USERPROFILE%\a;..."
                    let value = value.split_once(char::is_whitespace).map(|(_, v)| v.trim()).unwrap_or("");
                    dirs.extend(value.split(';').filter(|d| !d.is_empty()).map(|d| PathBuf::from(expand_env(d))));
                }
            }
        }
    }
    dirs
}

/// Expands %VAR% references (as stored in REG_EXPAND_SZ values).
fn expand_env(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                out.push_str(&std::env::var(name).unwrap_or_else(|_| format!("%{name}%")));
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// Shallow search for a player in folders where people unzip portable builds
/// (Downloads, Desktop, Program Files, winget's package cache).
fn search_dirs(player: &str) -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    let names = exe_names(player);
    let roots: Vec<(Option<PathBuf>, usize)> = vec![
        (env_dir("LOCALAPPDATA").map(|d| d.join("Microsoft/WinGet/Packages")), 3),
        (env_dir("ProgramFiles"), 2),
        (env_dir("LOCALAPPDATA").map(|d| d.join("Programs")), 2),
        (env_dir("USERPROFILE").map(|d| d.join("Downloads")), 3),
        (env_dir("USERPROFILE").map(|d| d.join("Desktop")), 2),
        (env_dir("USERPROFILE").map(|d| d.join("Documents")), 2),
        (Some(PathBuf::from("C:\\")), 1),
    ];
    for (root, depth) in roots {
        if let Some(found) = root.and_then(|r| walk(&r, names, depth, &mut 0)) {
            return Some(found);
        }
    }
    None
}

/// Depth-limited directory walk with a cap on directories visited, so a huge
/// Downloads folder can't stall playback.
fn walk(dir: &Path, names: &[&str], depth: usize, visited: &mut usize) -> Option<PathBuf> {
    *visited += 1;
    if *visited > 4000 {
        return None;
    }
    let entries = std::fs::read_dir(dir).ok()?;
    let mut subdirs = Vec::new();
    for e in entries.flatten() {
        let path = e.path();
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_file() {
            let fname = e.file_name().to_string_lossy().to_ascii_lowercase();
            if names.iter().any(|n| *n == fname) {
                return Some(path);
            }
        } else if ft.is_dir() && depth > 0 {
            let lname = e.file_name().to_string_lossy().to_ascii_lowercase();
            // Skip folders that never contain a player and are expensive to walk.
            if !matches!(lname.as_str(), "windows" | "$recycle.bin" | "node_modules" | ".git" | "system volume information") {
                subdirs.push(path);
            }
        }
    }
    // Look in obviously-named folders first.
    subdirs.sort_by_key(|p| {
        let n = p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        !(n.contains("mpv") || n.contains("vlc") || n.contains("videolan"))
    });
    subdirs.into_iter().find_map(|d| walk(&d, names, depth - 1, visited))
}

static FOUND: Mutex<Vec<(String, PathBuf)>> = Mutex::new(Vec::new());

/// Finds a player: cached hit, known paths, PATH (live + saved), then a shallow search.
/// Real mpv for the built-in player, skipping mpv.net even if it's found first.
pub(crate) fn locate_embeddable_mpv() -> Option<PathBuf> {
    locate("mpv-embed")
}

pub(crate) fn locate(player: &str) -> Option<PathBuf> {
    if let Ok(cache) = FOUND.lock() {
        if let Some((_, p)) = cache.iter().find(|(k, p)| k == player && p.is_file()) {
            return Some(p.clone());
        }
    }
    let names = exe_names(player);
    let base = if player == "mpv-embed" { "mpv" } else { player };
    let allowed = |p: &PathBuf| {
        let file = p.file_name().map(|f| f.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        names.iter().any(|n| n.eq_ignore_ascii_case(&file))
    };
    let found = known_paths(base)
        .into_iter()
        .find(|p| p.is_file() && allowed(p))
        .or_else(|| path_dirs().into_iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file()))
        .or_else(|| search_dirs(player))?;
    if let Ok(mut cache) = FOUND.lock() {
        cache.retain(|(k, _)| k != player);
        cache.push((player.to_string(), found.clone()));
    }
    Some(found)
}

/// Prefix the UI looks for to offer an "Install mpv" action.
const NO_PLAYER: &str = "NO_PLAYER:";

/// Resolves which executable to launch and which argument style it takes.
/// If the chosen player isn't installed, falls back to the other one.
fn resolve(player: &str, explicit: Option<&str>) -> Result<(String, PathBuf), String> {
    if let Some(p) = explicit.map(str::trim).filter(|p| !p.is_empty()) {
        let path = Path::new(p);
        if !path.is_file() {
            return Err(format!("Player not found at {p}. Fix the path in Settings > Playback, or clear it to auto-detect."));
        }
        let lower = p.to_ascii_lowercase();
        let kind = if player == "custom" && lower.contains("vlc") { "vlc" } else if player == "custom" { "mpv" } else { player };
        return Ok((kind.to_string(), path.to_path_buf()));
    }
    if player == "custom" {
        return Err("Set your player's path in Settings > Playback.".into());
    }
    if let Some(p) = locate(player) {
        return Ok((player.to_string(), p));
    }
    let other = if player == "mpv" { "vlc" } else { "mpv" };
    if let Some(p) = locate(other) {
        return Ok((other.to_string(), p));
    }
    Err(format!("{NO_PLAYER}No video player found. Install mpv (one click) or set a player in Settings > Playback."))
}

#[cfg(windows)]
pub(crate) fn hide_console(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn hide_console(_cmd: &mut Command) {}

#[tauri::command]
pub async fn detect_players() -> Vec<DetectedPlayer> {
    tauri::async_runtime::spawn_blocking(|| {
        ["mpv", "vlc", "mpv-embed"]
            .iter()
            .filter_map(|p| {
                locate(p).map(|path| DetectedPlayer {
                    player: p.to_string(),
                    path: path.to_string_lossy().into_owned(),
                })
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Installs mpv with winget (built into Windows 10/11), then returns its path.
#[tauri::command]
pub async fn install_mpv() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if !cfg!(windows) {
            return Err("Automatic install is only available on Windows.".to_string());
        }
        let mut cmd = Command::new("winget");
        cmd.args([
            "install",
            "--id",
            "shinchiro.mpv",
            "--exact",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity",
        ]);
        hide_console(&mut cmd);
        let out = cmd.output().map_err(|_| {
            "Windows Package Manager (winget) isn't available. Download mpv from mpv.io and set its path in Settings.".to_string()
        })?;
        if let Ok(mut cache) = FOUND.lock() {
            cache.clear();
        }
        match locate_embeddable_mpv() {
            Some(p) => Ok(p.to_string_lossy().into_owned()),
            None if out.status.success() => Err("mpv installed, but Ripple couldn't find it yet. Restart Ripple and try again.".into()),
            None => {
                let msg = String::from_utf8_lossy(&out.stdout);
                let last = msg.lines().rev().map(str::trim).find(|l| !l.is_empty()).unwrap_or("unknown error");
                Err(format!("Couldn't install mpv: {last}"))
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Async so the first-time player search never blocks the window.
#[tauri::command]
pub async fn play_external(req: PlayRequest) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || launch(req)).await.map_err(|e| e.to_string())?
}

fn launch(req: PlayRequest) -> Result<(), String> {
    if !allowed_url(&req.url) {
        return Err("Unsupported stream URL.".into());
    }
    let (kind, exe) = resolve(&req.player, req.path.as_deref())?;
    let mut cmd = Command::new(&exe);
    let is_vlc = kind == "vlc";

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

    // Extra arguments are written for the chosen player; skip them if we fell back to the other one.
    if kind == req.player || req.player == "custom" {
        cmd.args(&req.extra_args);
    }
    if !is_vlc {
        cmd.arg("--"); // end of options: the URL can never be read as a flag
    }
    cmd.arg(&req.url);

    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    cmd.spawn().map(|_| ()).map_err(|e| format!("Could not start player: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{expand_env, walk};

    #[test]
    fn expands_env_vars() {
        std::env::set_var("RIPPLE_TEST_DIR", "C:\\Users\\me");
        assert_eq!(expand_env("%RIPPLE_TEST_DIR%\\bin;x"), "C:\\Users\\me\\bin;x");
        assert_eq!(expand_env("%NOPE_NOT_SET%\\a"), "%NOPE_NOT_SET%\\a");
        assert_eq!(expand_env("50%"), "50%");
    }

    #[test]
    fn finds_player_in_nested_folder() {
        let root = std::env::temp_dir().join("ripple-walk-test");
        let deep = root.join("Downloads").join("mpv-x86_64-20261001");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::create_dir_all(root.join("Downloads").join("other")).unwrap();
        std::fs::write(deep.join("mpv.exe"), b"").unwrap();
        let found = walk(&root, &["mpv.exe"], 3, &mut 0);
        assert_eq!(found, Some(deep.join("mpv.exe")));
        assert_eq!(walk(&root, &["mpv.exe"], 1, &mut 0), None); // respects depth
        std::fs::remove_dir_all(&root).ok();
    }
}

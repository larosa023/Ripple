//! Seek-bar previews: a small, hidden helper mpv grabs one frame at the time you hover.
//! Only one grab runs at a time; a newer request cancels the older one.

use base64::Engine;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use crate::player::{hide_console, locate_embeddable_mpv};

static GEN: AtomicU64 = AtomicU64::new(0);

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbRequest {
    pub url: String,
    pub seconds: f64,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub width: Option<u32>,
}

fn allowed(url: &str) -> bool {
    let l = url.to_ascii_lowercase();
    ["http://", "https://", "file://"].iter().any(|p| l.starts_with(p))
}

/// Your chosen mpv if it's mpv itself (not mpv.net or another player), else the one Ripple finds.
fn mpv_exe(path: Option<&str>) -> Option<PathBuf> {
    match path.map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) if p_is_mpv(p) => Some(PathBuf::from(p)),
        _ => locate_embeddable_mpv(),
    }
}

fn p_is_mpv(p: &str) -> bool {
    let name = std::path::Path::new(p).file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();
    std::path::Path::new(p).is_file() && (name == "mpv" || name == "mpv.exe")
}

/// The mpv options that grab one frame at `seconds` into `dir` and exit.
pub(crate) fn thumb_args(req: &ThumbRequest, dir: &std::path::Path) -> Vec<String> {
    let w = req.width.unwrap_or(320).clamp(120, 640);
    let mut args = vec![
        "--no-config".into(),
        "--really-quiet".into(),
        "--no-terminal".into(),
        "--ao=null".into(),
        "--no-audio".into(),
        "--no-sub".into(),
        "--vo=image".into(),
        "--vo-image-format=jpg".into(),
        "--vo-image-jpeg-quality=72".into(),
        format!("--vo-image-outdir={}", dir.display()),
        "--frames=1".into(),
        format!("--start={:.2}", req.seconds.max(0.0)),
        // Nearest keyframe: much faster, and close enough for a preview.
        "--hr-seek=no".into(),
        format!("--vf=scale={w}:-2"),
        "--cache=no".into(),
        "--hwdec=no".into(),
        "--network-timeout=8".into(),
    ];
    args.extend(crate::embed::header_args(&req.headers));
    args.push("--".into());
    args.push(req.url.clone());
    args
}

/// A JPEG of the frame at `seconds`, as a data: URL. Err("CANCELLED") if a newer request came in.
#[tauri::command]
pub async fn player_thumb(req: ThumbRequest) -> Result<String, String> {
    if !allowed(&req.url) || !req.seconds.is_finite() {
        return Err("Unsupported URL.".into());
    }
    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn_blocking(move || grab(req, gen)).await.map_err(|e| e.to_string())?
}

fn grab(req: ThumbRequest, gen: u64) -> Result<String, String> {
    let exe = mpv_exe(req.path.as_deref()).ok_or("mpv not found")?;
    let dir = std::env::temp_dir().join(format!("ripple-thumb-{}-{gen}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let cleanup = |d: &PathBuf| {
        let _ = std::fs::remove_dir_all(d);
    };
    let mut cmd = Command::new(exe);
    cmd.args(thumb_args(&req, &dir)).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    hide_console(&mut cmd);
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            cleanup(&dir);
            return Err(e.to_string());
        }
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    let outcome = loop {
        if GEN.load(Ordering::SeqCst) != gen {
            break Err("CANCELLED".to_string());
        }
        match child.try_wait() {
            Ok(Some(_)) => break Ok(()),
            Ok(None) if Instant::now() > deadline => break Err("timed out".to_string()),
            Ok(None) => std::thread::sleep(Duration::from_millis(30)),
            Err(e) => break Err(e.to_string()),
        }
    };
    if outcome.is_err() {
        let _ = child.kill();
    }
    let _ = child.wait();
    let result = outcome.and_then(|_| {
        let file = std::fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case("jpg")))
            .ok_or("no frame")?;
        let bytes = std::fs::read(file).map_err(|e| e.to_string())?;
        Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
    });
    cleanup(&dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Needs mpv and a video: RIPPLE_TEST_VIDEO=http://... cargo test thumbs
    #[test]
    fn grabs_a_frame() {
        let Ok(url) = std::env::var("RIPPLE_TEST_VIDEO") else { return };
        let req = ThumbRequest { url, seconds: 60.0, headers: vec![], path: None, width: Some(320) };
        let t = Instant::now();
        let out = grab(req, GEN.fetch_add(1, Ordering::SeqCst) + 1).expect("frame");
        assert!(out.starts_with("data:image/jpeg;base64,") && out.len() > 2000, "{}", &out[..40.min(out.len())]);
        eprintln!("thumb in {:?}, {} bytes", t.elapsed(), out.len());
    }

    #[test]
    fn newer_request_cancels_older() {
        let Ok(url) = std::env::var("RIPPLE_TEST_VIDEO") else { return };
        let first = GEN.fetch_add(1, Ordering::SeqCst) + 1;
        let u = url.clone();
        let h = std::thread::spawn(move || grab(ThumbRequest { url: u, seconds: 10.0, headers: vec![], path: None, width: None }, first));
        std::thread::sleep(Duration::from_millis(50));
        GEN.fetch_add(1, Ordering::SeqCst);
        assert_eq!(h.join().unwrap(), Err("CANCELLED".to_string()));
    }

    #[test]
    fn rejects_other_schemes() {
        assert!(!allowed("javascript:alert(1)"));
        assert!(!allowed("C:\\Windows\\x.mkv"));
        assert!(allowed("file:///C:/Videos/a.mkv"));
    }
}

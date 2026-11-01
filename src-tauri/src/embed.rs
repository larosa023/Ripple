//! Built-in player: runs mpv *inside* Ripple's window.
//!
//! mpv is started with `--wid=<Ripple's window handle>`, so it draws video into
//! our window, behind the (transparent) webview. The UI controls it over mpv's
//! JSON IPC: one long-lived pipe connection streams property changes to the UI
//! as `player://*` events, and each command uses its own short connection.

use crate::player::{hide_console, locate_embeddable_mpv};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// The running mpv and the session it belongs to.
static PLAYER: Mutex<Option<(u64, Child)>> = Mutex::new(None);
/// Serializes starts so two quick clicks can't race each other.
static START: Mutex<()> = Mutex::new(());
/// Bumped on every start, so a listener from a previous video never emits stale events.
static SESSION: AtomicU64 = AtomicU64::new(0);
static REQUEST_ID: AtomicU32 = AtomicU32::new(1);

/// Properties streamed to the UI.
const OBSERVED: &[&str] = &[
    "time-pos",
    "duration",
    "pause",
    "paused-for-cache",
    "cache-buffering-state",
    "demuxer-cache-time",
    "eof-reached",
    "volume",
    "mute",
    "speed",
    "track-list",
    "sid",
    "aid",
    "idle-active",
    "video-params/w",
    "chapter-list",
    // Reported as soon as we subscribe, so a file that loaded before we connected still counts as loaded.
    "path",
];

fn pipe_name() -> String {
    if cfg!(windows) {
        format!(r"\\.\pipe\ripple-mpv-{}", std::process::id())
    } else {
        format!("/tmp/ripple-mpv-{}.sock", std::process::id())
    }
}

#[cfg(windows)]
type Conn = std::fs::File;
#[cfg(unix)]
type Conn = std::os::unix::net::UnixStream;

fn connect() -> std::io::Result<Conn> {
    #[cfg(windows)]
    {
        std::fs::OpenOptions::new().read(true).write(true).open(pipe_name())
    }
    #[cfg(unix)]
    {
        std::os::unix::net::UnixStream::connect(pipe_name())
    }
}

fn window_id<R: Runtime>(app: &AppHandle<R>) -> Result<i64, String> {
    let win = app.get_webview_window("main").ok_or("Main window not found")?;
    let handle = win.window_handle().map_err(|e| e.to_string())?;
    match handle.as_raw() {
        RawWindowHandle::Win32(h) => Ok(h.hwnd.get() as i64),
        RawWindowHandle::Xlib(h) => Ok(h.window as i64),
        RawWindowHandle::Xcb(h) => Ok(h.window.get() as i64),
        _ => Err("The built-in player isn't supported on this platform.".into()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedRequest {
    pub url: String,
    pub title: Option<String>,
    #[serde(default)]
    pub subtitles: Vec<String>,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
    pub start_seconds: Option<f64>,
    /// Explicit mpv path from Settings; auto-detected when empty.
    pub path: Option<String>,
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// Preferred subtitle/audio languages, e.g. "eng,spa".
    pub sub_langs: Option<String>,
    pub volume: Option<f64>,
}

/// Prefix the UI looks for to offer installing mpv.
const NEED_MPV: &str = "NEED_MPV:";

/// Asks mpv to quit without waiting for a reply (a hung mpv must never block us).
fn send_quit() {
    if let Ok(mut c) = connect() {
        let _ = c.write_all(b"{\"command\":[\"quit\"]}\n");
        let _ = c.flush();
    }
}

fn stop_current() {
    // Take the child out first so the lock is never held while waiting on a process.
    let child = PLAYER.lock().ok().and_then(|mut p| p.take());
    if let Some((_, mut child)) = child {
        // Ask nicely first so mpv can release the GPU cleanly, then make sure.
        send_quit();
        let deadline = Instant::now() + Duration::from_millis(600);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(30));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
pub async fn player_start<R: Runtime>(app: AppHandle<R>, req: EmbedRequest) -> Result<(), String> {
    let lower = req.url.to_ascii_lowercase();
    if !["http://", "https://", "magnet:", "rtmp://", "rtsp://", "file://"].iter().any(|p| lower.starts_with(p)) {
        return Err("Unsupported stream URL.".into());
    }
    let wid = window_id(&app)?;
    tauri::async_runtime::spawn_blocking(move || start(app, req, wid)).await.map_err(|e| e.to_string())?
}

fn start<R: Runtime>(app: AppHandle<R>, req: EmbedRequest, wid: i64) -> Result<(), String> {
    let (conn, session) = spawn_mpv(&req, &[format!("--wid={wid}")])?;
    std::thread::spawn(move || {
        listen(conn, session, |event, payload| {
            let _ = app.emit(event, payload);
        })
    });
    Ok(())
}

/// Starts mpv for `req` and returns a connected event pipe plus the session id.
fn spawn_mpv(req: &EmbedRequest, platform_args: &[String]) -> Result<(Conn, u64), String> {
    let _start = START.lock().unwrap_or_else(|e| e.into_inner());
    // New session first: the old video's listener then sees it's stale and stays quiet
    // instead of reporting "player exited" to the new one.
    let session = SESSION.fetch_add(1, Ordering::SeqCst) + 1;
    let current = || SESSION.load(Ordering::SeqCst) == session;
    stop_current();

    let exe = match req.path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) if Path::new(p).is_file() && !p.to_ascii_lowercase().contains("vlc") && !p.to_ascii_lowercase().ends_with("mpvnet.exe") => {
            Path::new(p).to_path_buf()
        }
        // mpv.net is its own app and can't be embedded; this finds the real mpv even when mpv.net is installed too.
        _ => locate_embeddable_mpv()
            .ok_or_else(|| format!("{NEED_MPV}The built-in player needs mpv. Install it in one click."))?,
    };

    let pipe = pipe_name();
    let mut args: Vec<String> = platform_args.to_vec();
    args.extend([
        format!("--input-ipc-server={pipe}"),
        // Ripple draws all controls; mpv just renders.
        "--osc=no".into(),
        "--osd-level=0".into(),
        "--input-default-bindings=no".into(),
        "--input-vo-keyboard=no".into(),
        "--cursor-autohide=no".into(),
        "--force-window=yes".into(),
        "--keep-open=yes".into(),
        "--idle=yes".into(),
        "--hwdec=auto-safe".into(),
        "--cache=yes".into(),
        "--demuxer-max-bytes=256MiB".into(),
        "--demuxer-max-back-bytes=64MiB".into(),
        "--sub-auto=fuzzy".into(),
        "--msg-level=all=error".into(),
        "--no-terminal".into(),
    ]);
    if let Some(t) = &req.title {
        args.push(format!("--force-media-title={t}"));
    }
    if let Some(s) = req.start_seconds.filter(|s| *s > 1.0) {
        args.push(format!("--start={s}"));
    }
    if let Some(v) = req.volume.filter(|v| (0.0..=130.0).contains(v)) {
        args.push(format!("--volume={v}"));
    }
    if let Some(langs) = req.sub_langs.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        args.push(format!("--slang={langs}"));
    }
    for sub in &req.subtitles {
        args.push(format!("--sub-file={sub}"));
    }
    if !req.headers.is_empty() {
        let joined = req
            .headers
            .iter()
            .map(|(k, v)| format!("{k}: {}", v.replace(',', "\\,")))
            .collect::<Vec<_>>()
            .join(",");
        args.push(format!("--http-header-fields={joined}"));
    }
    args.extend(req.extra_args.iter().cloned());
    args.push("--".into());
    args.push(req.url.clone());

    let mut cmd = Command::new(&exe);
    cmd.args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    hide_console(&mut cmd);
    if !current() {
        return Err(CANCELLED.into()); // closed while we were finding mpv
    }
    let child = cmd.spawn().map_err(|e| format!("Couldn't start mpv: {e}"))?;
    let stray = PLAYER.lock().ok().and_then(|mut p| p.replace((session, child)));
    if let Some((_, mut old)) = stray {
        let _ = old.kill();
        let _ = old.wait();
    }

    // Wait for mpv's IPC server, then stream events from it.
    let deadline = Instant::now() + Duration::from_secs(10);
    let conn = loop {
        match connect() {
            Ok(c) => break c,
            Err(_) if !current() => {
                stop_session(session);
                return Err(CANCELLED.into());
            }
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => {
                stop_session(session);
                return Err("mpv started but didn't respond. Try again, or switch to an external player in Settings.".into());
            }
        }
    };
    if !current() {
        stop_session(session);
        return Err(CANCELLED.into());
    }
    Ok((conn, session))
}

/// Error returned when a start was superseded by Back/Esc or another video; the UI ignores it.
const CANCELLED: &str = "CANCELLED:";

/// Stops mpv only if it still belongs to `session`.
fn stop_session(session: u64) {
    let child = PLAYER.lock().ok().and_then(|mut p| if p.as_ref().map(|(s, _)| *s) == Some(session) { p.take() } else { None });
    if let Some((_, mut child)) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn listen(mut conn: Conn, session: u64, emit: impl Fn(&str, Value)) {
    for (i, name) in OBSERVED.iter().enumerate() {
        let line = json!({ "command": ["observe_property", i + 1, name] }).to_string() + "\n";
        if conn.write_all(line.as_bytes()).is_err() {
            break;
        }
    }
    let _ = conn.flush();
    let current = || SESSION.load(Ordering::SeqCst) == session;
    let mut loaded = false;

    for line in BufReader::new(conn).lines() {
        let Ok(line) = line else { break };
        if !current() {
            return;
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        match msg.get("event").and_then(Value::as_str) {
            Some("property-change") if msg["name"] == "path" => {
                if msg["data"].is_string() && !loaded {
                    loaded = true;
                    emit("player://loaded", json!({}));
                }
            }
            Some("property-change") => {
                emit("player://prop", json!({ "name": msg["name"], "data": msg["data"] }));
            }
            Some("end-file") => {
                emit("player://end", json!({ "reason": msg["reason"], "error": msg["file_error"] }));
            }
            Some("file-loaded") if !loaded => {
                loaded = true;
                emit("player://loaded", json!({}));
            }
            _ => {}
        }
    }
    // Pipe closed: mpv exited (or was replaced by a newer video).
    if current() {
        let child = PLAYER.lock().ok().and_then(|mut p| if p.as_ref().map(|(s, _)| *s) == Some(session) { p.take() } else { None });
        if let Some((_, mut child)) = child {
            let _ = child.wait(); // outside the lock
        }
        emit("player://exit", json!({}));
    }
}

/// Sends one command on its own connection and returns mpv's reply.
fn send(command: Value) -> Result<Value, String> {
    let id = REQUEST_ID.fetch_add(1, Ordering::SeqCst);
    // A pipe instance can be momentarily busy when several commands arrive at once; retry briefly.
    let mut tries = 0;
    let mut conn = loop {
        match connect() {
            Ok(c) => break c,
            Err(_) if tries < 25 => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(8));
            }
            Err(_) => return Err("Player isn't running.".to_string()),
        }
    };
    let line = json!({ "command": command, "request_id": id }).to_string() + "\n";
    conn.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    conn.flush().map_err(|e| e.to_string())?;
    // Pipe reads can't time out on Windows, so read on a helper thread and stop waiting after a few seconds.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(read_reply(conn, id));
    });
    rx.recv_timeout(Duration::from_secs(4)).unwrap_or_else(|_| Err("Player didn't answer.".into()))
}

fn read_reply(conn: Conn, id: u32) -> Result<Value, String> {
    let mut reader = BufReader::new(conn);
    let mut buf = String::new();
    // mpv also broadcasts events on every connection; skip until our reply.
    for _ in 0..200 {
        buf.clear();
        if reader.read_line(&mut buf).map_err(|e| e.to_string())? == 0 {
            return Err("Player closed.".into());
        }
        if let Ok(v) = serde_json::from_str::<Value>(&buf) {
            if v.get("request_id").and_then(Value::as_u64) == Some(id as u64) {
                return match v.get("error").and_then(Value::as_str) {
                    Some("success") | None => Ok(v.get("data").cloned().unwrap_or(Value::Null)),
                    Some(err) => Err(err.to_string()),
                };
            }
        }
    }
    Err("No reply from player.".into())
}

#[tauri::command]
pub async fn player_command(args: Vec<Value>) -> Result<Value, String> {
    // Only the commands the UI needs; nothing that runs programs or writes files.
    const ALLOWED: &[&str] = &["set_property", "get_property", "cycle", "seek", "add", "sub-add", "audio-add", "frame-step", "frame-back-step"];
    let name = args.first().and_then(Value::as_str).unwrap_or_default();
    if !ALLOWED.contains(&name) {
        return Err(format!("Command '{name}' isn't allowed."));
    }
    tauri::async_runtime::spawn_blocking(move || send(Value::Array(args))).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn player_stop() -> Result<(), String> {
    SESSION.fetch_add(1, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(stop_current).await.map_err(|e| e.to_string())
}

/// Called when Ripple exits so mpv never lingers.
pub fn shutdown() {
    SESSION.fetch_add(1, Ordering::SeqCst);
    stop_current();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};

    #[test]
    fn rejects_unsafe_commands() {
        let rt = tauri::async_runtime::block_on(player_command(vec![json!("run"), json!("calc.exe")]));
        assert!(rt.unwrap_err().contains("isn't allowed"));
        let rt = tauri::async_runtime::block_on(player_command(vec![json!("loadfile"), json!("x")]));
        assert!(rt.is_err());
    }

    #[test]
    fn pipe_name_is_per_process() {
        assert!(pipe_name().contains(&std::process::id().to_string()));
    }

    /// End-to-end against a real mpv (skipped when mpv or the test video isn't available):
    /// every option Ripple passes is accepted, events stream in, and commands work.
    #[test]
    fn drives_real_mpv() {
        let Ok(video) = std::env::var("RIPPLE_TEST_VIDEO") else { return };
        if locate_embeddable_mpv().is_none() {
            return;
        }
        let req = EmbedRequest {
            url: video,
            title: Some("Test — S1E1".into()),
            subtitles: vec![],
            headers: vec![("User-Agent".into(), "Ripple/1, test".into())],
            start_seconds: Some(3.0),
            path: None,
            extra_args: vec![],
            sub_langs: Some("eng".into()),
            volume: Some(80.0),
        };
        let headless = ["--vo=null".to_string(), "--ao=null".to_string()];
        let (conn, session) = spawn_mpv(&req, &headless).expect("mpv should accept every option");
        let seen: Arc<StdMutex<Vec<(String, Value)>>> = Arc::default();
        let sink = seen.clone();
        let listener = std::thread::spawn(move || {
            listen(conn, session, move |ev, payload| sink.lock().unwrap().push((ev.to_string(), payload)))
        });

        let wait_for = |pred: &dyn Fn(&[(String, Value)]) -> bool| {
            let deadline = Instant::now() + Duration::from_secs(10);
            while Instant::now() < deadline {
                if pred(&seen.lock().unwrap()) {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            false
        };
        let prop = |name: &'static str| {
            move |evs: &[(String, Value)]| evs.iter().any(|(e, p)| e == "player://prop" && p["name"] == name && !p["data"].is_null())
        };

        assert!(wait_for(&prop("duration")), "duration event");
        assert!(wait_for(&prop("track-list")), "track list event");
        assert!(wait_for(&|evs: &[(String, Value)]| evs.iter().any(|(e, p)| e == "player://prop"
            && p["name"] == "time-pos" && p["data"].as_f64().unwrap_or(0.0) >= 2.9)), "started at resume point");

        // Commands over separate connections.
        assert_eq!(send(json!(["get_property", "volume"])).unwrap(), json!(80.0));
        send(json!(["set_property", "pause", true])).unwrap();
        assert_eq!(send(json!(["get_property", "pause"])).unwrap(), json!(true));
        send(json!(["seek", 10, "absolute"])).unwrap();
        let pos = send(json!(["get_property", "time-pos"])).unwrap().as_f64().unwrap();
        assert!((pos - 10.0).abs() < 1.5, "seeked to {pos}");
        send(json!(["set_property", "aid", 2])).unwrap();
        assert_eq!(send(json!(["get_property", "aid"])).unwrap(), json!(2));
        assert!(send(json!(["get_property", "no-such-prop"])).is_err());
        assert_eq!(send(json!(["get_property", "media-title"])).unwrap(), json!("Test — S1E1"));

        // Stopping ends the session and the listener.
        shutdown();
        listener.join().unwrap();
        assert!(PLAYER.lock().unwrap().is_none());
        eprintln!("REAL_MPV_TEST_RAN events={}", seen.lock().unwrap().len());
    }

    /// Switching videos (next episode) must not report the old mpv's exit, and must not leave it running.
    #[test]
    fn switching_videos_is_clean() {
        let Ok(video) = std::env::var("RIPPLE_TEST_VIDEO") else { return };
        if locate_embeddable_mpv().is_none() {
            return;
        }
        let req = || EmbedRequest {
            url: video.clone(),
            title: None,
            subtitles: vec![],
            headers: vec![],
            start_seconds: None,
            path: None,
            extra_args: vec![],
            sub_langs: None,
            volume: Some(0.0),
        };
        let headless = ["--vo=null".to_string(), "--ao=null".to_string()];
        let first_events: Arc<StdMutex<Vec<String>>> = Arc::default();
        let (c1, s1) = spawn_mpv(&req(), &headless).unwrap();
        let sink = first_events.clone();
        let l1 = std::thread::spawn(move || listen(c1, s1, move |ev, _| sink.lock().unwrap().push(ev.to_string())));
        std::thread::sleep(Duration::from_millis(800));
        let first_pid = PLAYER.lock().unwrap().as_ref().map(|(_, c)| c.id()).unwrap();

        let second_events: Arc<StdMutex<Vec<String>>> = Arc::default();
        let (c2, s2) = spawn_mpv(&req(), &headless).unwrap();
        let sink = second_events.clone();
        let l2 = std::thread::spawn(move || listen(c2, s2, move |ev, _| sink.lock().unwrap().push(ev.to_string())));
        l1.join().unwrap(); // the old listener ends once its mpv is gone
        std::thread::sleep(Duration::from_millis(800));

        assert!(!first_events.lock().unwrap().iter().any(|e| e == "player://exit"), "old video must not report exit");
        assert!(second_events.lock().unwrap().iter().any(|e| e == "player://loaded"), "new video should load");
        let second_pid = PLAYER.lock().unwrap().as_ref().map(|(_, c)| c.id()).unwrap();
        assert_ne!(first_pid, second_pid);
        assert!(!std::path::Path::new(&format!("/proc/{first_pid}")).exists() || std::fs::read_to_string(format!("/proc/{first_pid}/stat")).map(|s| s.contains(") Z ")).unwrap_or(true), "old mpv must be gone");

        // Stopping while a start is pending cancels it instead of leaving mpv running.
        SESSION.fetch_add(1, Ordering::SeqCst);
        stop_current();
        l2.join().unwrap();
        assert!(PLAYER.lock().unwrap().is_none());
    }
}

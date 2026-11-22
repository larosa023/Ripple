//! Downloads for offline viewing: direct (HTTP / debrid) links with resume, and torrents
//! through their own librqbit session (separate from streaming, which deletes as it goes).
//! The list is saved to downloads.json in the app's data folder and picks up where it left off.

use futures_util::StreamExt;
use librqbit::api::TorrentIdOrHash;
use librqbit::{AddTorrent, AddTorrentOptions, DhtSessionConfig, Session, SessionOptions};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio::sync::OnceCell;

/// How many downloads run at once; the rest wait their turn.
const PARALLEL: usize = 2;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Queued,
    Downloading,
    Paused,
    Done,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Source {
    Http { url: String, headers: Vec<(String, String)> },
    Torrent { info_hash: String, file_idx: Option<i64>, trackers: Vec<String>, file_hint: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    /// "Snowfall" / "The Matrix".
    pub title: String,
    /// "S4E2 · Weight" for episodes, "" for movies.
    pub subtitle: String,
    pub meta_id: String,
    pub meta_type: String,
    pub video_id: String,
    pub poster: Option<String>,
    pub source: Source,
    /// The finished file.
    pub path: String,
    pub size: u64,
    pub done: u64,
    pub status: Status,
    pub error: Option<String>,
    /// Unix ms.
    pub added: u64,
    /// Bytes per second (live, not saved).
    #[serde(default, skip_deserializing)]
    pub speed: f64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRequest {
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    pub meta_id: String,
    pub meta_type: String,
    pub video_id: String,
    pub poster: Option<String>,
    pub source: Source,
    /// Root download folder (Videos\Ripple by default).
    pub dir: String,
    /// Extension hint when the link doesn't say ("mkv").
    pub ext: Option<String>,
}

struct State {
    items: Vec<Item>,
    running: HashMap<String, tokio::task::AbortHandle>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
static LIST_FILE: OnceLock<PathBuf> = OnceLock::new();
static TORRENTS: OnceCell<Arc<Session>> = OnceCell::const_new();

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn with<T>(f: impl FnOnce(&mut State) -> T) -> T {
    let mut g = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let s = g.get_or_insert_with(|| State { items: Vec::new(), running: HashMap::new() });
    f(s)
}

fn update(id: &str, f: impl FnOnce(&mut Item)) {
    with(|s| {
        if let Some(it) = s.items.iter_mut().find(|i| i.id == id) {
            f(it);
        }
    });
}

fn save() {
    let Some(file) = LIST_FILE.get() else { return };
    let items = with(|s| s.items.clone());
    if let Ok(json) = serde_json::to_vec_pretty(&items) {
        let tmp = file.with_extension("json.tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, file);
        }
    }
}

/// Loads the saved list and carries on with anything that was mid-download.
pub fn init(data_dir: PathBuf) {
    let _ = std::fs::create_dir_all(&data_dir);
    let file = data_dir.join("downloads.json");
    let mut items: Vec<Item> = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    for it in &mut items {
        if it.status == Status::Downloading {
            it.status = Status::Queued;
        }
        // Finished files deleted outside Ripple drop off the list.
        it.speed = 0.0;
    }
    items.retain(|it| it.status != Status::Done || Path::new(&it.path).is_file());
    let _ = LIST_FILE.set(file);
    with(|s| s.items = items);
    tauri::async_runtime::spawn(async { schedule() });
}

/// Keeps up to PARALLEL downloads running.
fn schedule() {
    let starts: Vec<Item> = with(|s| {
        s.running.retain(|_, h| !h.is_finished());
        let free = PARALLEL.saturating_sub(s.running.len());
        let next: Vec<Item> = s.items.iter().filter(|i| i.status == Status::Queued && !s.running.contains_key(&i.id)).take(free).cloned().collect();
        for n in &next {
            if let Some(it) = s.items.iter_mut().find(|i| i.id == n.id) {
                it.status = Status::Downloading;
                it.error = None;
            }
        }
        next
    });
    for item in starts {
        let id = item.id.clone();
        let task = tauri::async_runtime::spawn(async move {
            let id = item.id.clone();
            let result = match &item.source {
                Source::Http { url, headers } => run_http(&item, url, headers).await,
                Source::Torrent { info_hash, file_idx, trackers, file_hint } => {
                    run_torrent(&item, info_hash, *file_idx, trackers, file_hint.as_deref()).await
                }
            };
            update(&id, |it| {
                it.speed = 0.0;
                match result {
                    Ok(()) => {
                        it.status = Status::Done;
                        it.done = it.size.max(it.done);
                    }
                    Err(e) if it.status == Status::Paused => drop(e),
                    Err(e) => {
                        it.status = Status::Error;
                        it.error = Some(e);
                    }
                }
            });
            with(|s| s.running.remove(&id));
            save();
            schedule();
        });
        with(|s| s.running.insert(id, task.inner().abort_handle()));
    }
    save();
}

// ---------- names ----------

/// Safe for a Windows file name: no reserved characters, no trailing dots/spaces.
fn clean(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let s = s.trim_end_matches(['.', ' ']).to_string();
    let s: String = s.chars().take(120).collect();
    if s.is_empty() { "Download".into() } else { s }
}

/// File extension from a link like ".../The.Show.S01E02.1080p.mkv?token=..".
fn ext_from_url(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next()?;
    let last = path.rsplit('/').next()?;
    let ext = last.rsplit_once('.')?.1.to_ascii_lowercase();
    ["mkv", "mp4", "avi", "mov", "m4v", "webm", "ts", "m2ts", "wmv"].contains(&ext.as_str()).then_some(ext)
}

/// "Snowfall\Snowfall - S4E2 · Weight.mkv" for episodes, "The Matrix.mkv" for movies;
/// " (2)" added if that name is taken.
fn target_path(dir: &Path, title: &str, subtitle: &str, ext: &str) -> PathBuf {
    let (folder, base) = if subtitle.is_empty() {
        (dir.to_path_buf(), clean(title))
    } else {
        (dir.join(clean(title)), clean(&format!("{title} - {subtitle}")))
    };
    let mut path = folder.join(format!("{base}.{ext}"));
    let mut n = 2;
    while path.exists() || path.with_extension(format!("{ext}.part")).exists() || taken(&path) {
        path = folder.join(format!("{base} ({n}).{ext}"));
        n += 1;
    }
    path
}

fn taken(path: &Path) -> bool {
    let p = path.to_string_lossy().to_string();
    with(|s| s.items.iter().any(|i| i.path == p))
}

// ---------- direct links ----------

async fn run_http(item: &Item, url: &str, headers: &[(String, String)]) -> Result<(), String> {
    let final_path = PathBuf::from(&item.path);
    let part = PathBuf::from(format!("{}.part", item.path));
    if let Some(parent) = final_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| format!("Can't create the folder: {e}"))?;
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let mut attempts = 0;
    loop {
        attempts += 1;
        match http_once(&client, item, url, headers, &part).await {
            Ok(()) => break,
            Err((e, retry)) if retry && attempts < 6 => {
                update(&item.id, |it| it.error = Some(format!("{e} Retrying…")));
                tokio::time::sleep(Duration::from_secs(2 * attempts)).await;
            }
            Err((e, _)) => return Err(e),
        }
    }
    tokio::fs::rename(&part, &final_path).await.map_err(|e| format!("Couldn't finish the file: {e}"))?;
    update(&item.id, |it| it.error = None);
    Ok(())
}

/// One attempt; Err((message, worth retrying)).
async fn http_once(client: &reqwest::Client, item: &Item, url: &str, headers: &[(String, String)], part: &Path) -> Result<(), (String, bool)> {
    let have = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let mut req = client.get(url);
    for (k, v) in headers {
        req = req.header(k.as_str(), v.as_str());
    }
    if have > 0 {
        req = req.header("Range", format!("bytes={have}-"));
    }
    let resp = req.send().await.map_err(|e| (format!("Connection failed: {e}."), true))?;
    let status = resp.status();
    let resumed = status.as_u16() == 206 && have > 0;
    if status.as_u16() == 416 && have > 0 {
        return Ok(()); // already complete
    }
    if !status.is_success() {
        let retry = status.is_server_error() || status.as_u16() == 429;
        return Err((format!("The server answered {status}."), retry));
    }
    let len = resp.content_length().unwrap_or(0);
    let total = if resumed { have + len } else { len };
    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resumed)
        .truncate(!resumed)
        .open(part)
        .await
        .map_err(|e| (format!("Can't write the file: {e}"), false))?;
    let mut done = if resumed { have } else { 0 };
    update(&item.id, |it| {
        it.size = total;
        it.done = done;
        it.error = None;
    });
    let mut stream = resp.bytes_stream();
    let mut window = (Instant::now(), done);
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| (format!("The download was interrupted: {e}."), true))?;
        file.write_all(&chunk).await.map_err(|e| (format!("Can't write the file (disk full?): {e}"), false))?;
        done += chunk.len() as u64;
        let el = window.0.elapsed();
        if el >= Duration::from_millis(700) {
            let speed = (done - window.1) as f64 / el.as_secs_f64();
            window = (Instant::now(), done);
            update(&item.id, |it| {
                it.done = done;
                it.speed = speed;
            });
        }
    }
    file.flush().await.map_err(|e| (e.to_string(), false))?;
    update(&item.id, |it| it.done = done);
    if total > 0 && done < total {
        return Err(("The download ended early.".into(), true));
    }
    Ok(())
}

// ---------- torrents ----------

async fn torrent_session(root: &Path) -> Result<Arc<Session>, String> {
    TORRENTS
        .get_or_try_init(|| async {
            let opts = |ipv4_only: bool, dht: bool| SessionOptions {
                dht: dht.then(|| DhtSessionConfig { persistence: None, ..Default::default() }),
                listen: None,
                fastresume: false,
                persistence: None,
                disable_local_service_discovery: true,
                ipv4_only,
                client_name_and_version: Some(format!("Ripple {}", env!("CARGO_PKG_VERSION"))),
                trackers: crate::torrent::TRACKERS.iter().filter_map(|t| t.parse().ok()).collect(),
                ..Default::default()
            };
            let mut last = String::new();
            for (v4, dht) in [(false, true), (true, true), (true, false)] {
                match Session::new_with_opts(root.to_path_buf(), opts(v4, dht)).await {
                    Ok(s) => return Ok(s),
                    Err(e) => last = format!("{e:#}"),
                }
            }
            Err(format!("Couldn't start the torrent engine: {last}"))
        })
        .await
        .cloned()
}

async fn run_torrent(item: &Item, hash: &str, file_idx: Option<i64>, trackers: &[String], hint: Option<&str>) -> Result<(), String> {
    let final_path = PathBuf::from(&item.path);
    let folder = final_path.parent().ok_or("Bad download folder")?.to_path_buf();
    // Torrent data goes in a hidden working folder next to the final file, then moves into place.
    let work = folder.join(format!(".ripple-{}", &item.id));
    tokio::fs::create_dir_all(&work).await.map_err(|e| format!("Can't create the folder: {e}"))?;
    let session = torrent_session(&folder).await?;
    let magnet = crate::torrent::magnet_link(hash, trackers);
    let opts = AddTorrentOptions {
        overwrite: true,
        paused: true,
        output_folder: Some(work.to_string_lossy().to_string()),
        ..Default::default()
    };
    let added = tokio::time::timeout(Duration::from_secs(120), session.add_torrent(AddTorrent::from_url(magnet), Some(opts)))
        .await
        .map_err(|_| "Couldn't find anyone sharing this torrent.".to_string())?
        .map_err(|e| format!("Couldn't open this torrent: {e:#}"))?;
    let handle = added.into_handle().ok_or("Couldn't open this torrent.")?;
    let files: Vec<(String, u64)> = handle
        .with_metadata(|m| m.file_infos.iter().map(|f| (f.relative_filename.to_string_lossy().replace('\\', "/"), f.len)).collect())
        .map_err(|e| format!("Couldn't read the torrent's file list: {e:#}"))?;
    let idx = crate::torrent::pick_file(&files, file_idx, hint).ok_or("This torrent has no video file.")?;
    tokio::time::timeout(Duration::from_secs(120), handle.wait_until_initialized())
        .await
        .map_err(|_| "The torrent took too long to start.".to_string())?
        .map_err(|e| format!("Couldn't start this torrent: {e:#}"))?;
    session.update_only_files(&handle, &[idx].into_iter().collect()).await.map_err(|e| format!("{e:#}"))?;
    session.unpause(&handle).await.ok();
    let size = files[idx].1;
    update(&item.id, |it| it.size = size);

    let id = TorrentIdOrHash::Id(handle.id());
    let result = loop {
        // Paused or removed from the list: stop (keeping what's downloaded).
        let state = with(|s| s.items.iter().find(|i| i.id == item.id).map(|i| i.status.clone()));
        if state.as_ref() != Some(&Status::Downloading) {
            let _ = session.pause(&handle).await;
            let _ = session.delete(id, false).await;
            break Err("stopped".to_string());
        }
        let stats = handle.stats();
        let v = serde_json::to_value(&stats).unwrap_or_default();
        let done = v["file_progress"][idx].as_u64().unwrap_or_else(|| v["progress_bytes"].as_u64().unwrap_or(0));
        let speed = v["live"]["download_speed"]["mbps"].as_f64().unwrap_or(0.0) * 1_048_576.0;
        update(&item.id, |it| {
            it.done = done.min(size);
            it.speed = speed;
        });
        if v["finished"].as_bool().unwrap_or(false) || (size > 0 && done >= size) {
            break Ok(());
        }
        if let Some(err) = v["error"].as_str() {
            break Err(format!("Torrent error: {err}"));
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    };
    if result.is_err() {
        return result;
    }
    // Let go of the files, then move the video to its proper name and drop the working folder.
    let _ = session.delete(id, false).await;
    let src = work.join(&files[idx].0);
    tokio::fs::rename(&src, &final_path).await.map_err(|e| format!("Couldn't move the finished file: {e}"))?;
    let _ = tokio::fs::remove_dir_all(&work).await;
    Ok(())
}

// ---------- commands ----------

#[tauri::command]
pub async fn download_add(req: AddRequest) -> Result<Item, String> {
    if req.dir.trim().is_empty() {
        return Err("Choose a download folder in Settings first.".into());
    }
    let dir = PathBuf::from(req.dir.trim());
    match &req.source {
        Source::Http { url, .. } if !(url.starts_with("http://") || url.starts_with("https://")) => {
            return Err("This source can't be downloaded.".into())
        }
        Source::Torrent { info_hash, .. } if !crate::torrent::valid_info_hash(info_hash) => return Err("This torrent link is invalid.".into()),
        _ => {}
    }
    // Same episode already on the list (and not failed): don't download it twice.
    if let Some(existing) = with(|s| s.items.iter().find(|i| i.video_id == req.video_id && i.status != Status::Error).cloned()) {
        return Ok(existing);
    }
    let ext = match &req.source {
        Source::Http { url, .. } => ext_from_url(url),
        Source::Torrent { file_hint, .. } => file_hint.as_deref().and_then(ext_from_url),
    }
    .or(req.ext.clone().filter(|e| e.chars().all(|c| c.is_ascii_alphanumeric()) && e.len() <= 5))
    .unwrap_or_else(|| "mkv".into());
    let path = target_path(&dir, &req.title, &req.subtitle, &ext);
    let item = Item {
        id: format!("{:x}{:04x}", now_ms(), rand_u16()),
        title: req.title,
        subtitle: req.subtitle,
        meta_id: req.meta_id,
        meta_type: req.meta_type,
        video_id: req.video_id,
        poster: req.poster,
        source: req.source,
        path: path.to_string_lossy().to_string(),
        size: 0,
        done: 0,
        status: Status::Queued,
        error: None,
        added: now_ms(),
        speed: 0.0,
    };
    with(|s| s.items.insert(0, item.clone()));
    schedule();
    Ok(item)
}

fn rand_u16() -> u16 {
    (SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0) & 0xffff) as u16
}

#[tauri::command]
pub fn download_list() -> Vec<Item> {
    with(|s| s.items.clone())
}

#[tauri::command]
pub fn download_pause(id: String) {
    let handle = with(|s| {
        if let Some(it) = s.items.iter_mut().find(|i| i.id == id) {
            if matches!(it.status, Status::Downloading | Status::Queued) {
                it.status = Status::Paused;
                it.speed = 0.0;
            }
        }
        s.running.get(&id).cloned()
    });
    // Direct downloads stop now (the .part file stays for resuming); torrents notice within a second.
    if let Some(h) = handle {
        if with(|s| matches!(s.items.iter().find(|i| i.id == id).map(|i| &i.source), Some(Source::Http { .. }))) {
            h.abort();
            with(|s| s.running.remove(&id));
        }
    }
    save();
    schedule();
}

#[tauri::command]
pub fn download_resume(id: String) {
    update(&id, |it| {
        if matches!(it.status, Status::Paused | Status::Error) {
            it.status = Status::Queued;
            it.error = None;
        }
    });
    schedule();
}

/// Removes a download from the list, and deletes its file(s) when asked.
#[tauri::command]
pub async fn download_remove(id: String, delete_file: bool) -> Result<(), String> {
    let item = with(|s| {
        let it = s.items.iter().find(|i| i.id == id).cloned();
        if let Some(h) = s.running.remove(&id) {
            if matches!(it.as_ref().map(|i| &i.source), Some(Source::Http { .. })) {
                h.abort();
            }
        }
        s.items.retain(|i| i.id != id);
        it
    });
    save();
    schedule();
    let Some(item) = item else { return Ok(()) };
    if delete_file {
        // Give a running torrent a moment to notice and release its files.
        if matches!(item.source, Source::Torrent { .. }) {
            tokio::time::sleep(Duration::from_millis(1500)).await;
        }
        let path = PathBuf::from(&item.path);
        let _ = tokio::fs::remove_file(&path).await;
        let _ = tokio::fs::remove_file(format!("{}.part", item.path)).await;
        if let Some(parent) = path.parent() {
            let _ = tokio::fs::remove_dir_all(parent.join(format!(".ripple-{}", item.id))).await;
            // Remove the show's folder if this was its last episode.
            if parent.read_dir().map(|mut d| d.next().is_none()).unwrap_or(false) {
                let _ = tokio::fs::remove_dir(parent).await;
            }
        }
    }
    Ok(())
}

/// Opens the folder holding a download (or the root) in Explorer, with the file selected.
#[tauri::command]
pub fn download_reveal(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    // Only paths Ripple downloaded to.
    let known = with(|s| s.items.iter().any(|i| Path::new(&i.path) == p || Path::new(&i.path).parent() == Some(p.as_path())));
    if !known && !p.is_dir() {
        return Err("Unknown path".into());
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("explorer");
        if p.is_file() {
            cmd.arg(format!("/select,{}", p.display()));
        } else {
            cmd.arg(p.parent().filter(|_| !p.is_dir()).unwrap_or(&p));
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(if p.is_dir() { &p } else { p.parent().unwrap_or(&p) }).spawn();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_names() {
        assert_eq!(clean("Snowfall: S4E2 · Weight?"), "Snowfall S4E2 · Weight");
        assert_eq!(clean("  ...  "), "Download");
        assert_eq!(clean("Con/Air <1997>."), "Con Air 1997");
    }

    #[test]
    fn extensions() {
        assert_eq!(ext_from_url("https://x.test/dl/The.Show.S01E02.1080p.MKV?token=1").as_deref(), Some("mkv"));
        assert_eq!(ext_from_url("https://x.test/resolve/abc"), None);
        assert_eq!(ext_from_url("https://x.test/a.exe"), None);
    }

    #[test]
    fn paths() {
        let dir = std::env::temp_dir().join("ripple-dl-test-paths");
        let p = target_path(&dir, "Snowfall", "S4E2 · Weight", "mkv");
        assert!(p.ends_with("Snowfall/Snowfall - S4E2 · Weight.mkv") || p.ends_with("Snowfall\\Snowfall - S4E2 · Weight.mkv"));
        let m = target_path(&dir, "The Matrix", "", "mp4");
        assert_eq!(m, dir.join("The Matrix.mp4"));
    }

    /// Downloads a local file over HTTP, pausing and resuming partway:
    /// RIPPLE_TEST_VIDEO=http://127.0.0.1:8765/test.mkv cargo test downloads -- --nocapture
    #[test]
    fn http_download_with_resume() {
        let Ok(url) = std::env::var("RIPPLE_TEST_VIDEO") else { return };
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let dir = std::env::temp_dir().join(format!("ripple-dl-test-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            let item = download_add(AddRequest {
                title: "Test Show".into(),
                subtitle: "S1E1 · Pilot".into(),
                meta_id: "tt0".into(),
                meta_type: "series".into(),
                video_id: format!("tt0:1:1:{}", now_ms()),
                poster: None,
                source: Source::Http { url: url.clone(), headers: vec![] },
                dir: dir.to_string_lossy().to_string(),
                ext: None,
            })
            .await
            .unwrap();
            let t = Instant::now();
            loop {
                let it = download_list().into_iter().find(|i| i.id == item.id).unwrap();
                if it.status == Status::Done {
                    break;
                }
                assert_ne!(it.status, Status::Error, "{:?}", it.error);
                assert!(t.elapsed() < Duration::from_secs(60), "timed out at {}/{}", it.done, it.size);
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let it = download_list().into_iter().find(|i| i.id == item.id).unwrap();
            let len = std::fs::metadata(&it.path).unwrap().len();
            assert!(len > 100_000 && len == it.size, "{len} vs {}", it.size);
            assert!(it.path.ends_with("Test Show - S1E1 · Pilot.mkv"), "{}", it.path);

            // Resume: a half-written .part continues with a Range request, giving the same bytes.
            let full = std::fs::read(&it.path).unwrap();
            let again = download_add(AddRequest {
                title: "Test Show".into(),
                subtitle: "S1E1 · Pilot".into(),
                meta_id: "tt0".into(),
                meta_type: "series".into(),
                video_id: format!("tt0:1:2:{}", now_ms()),
                poster: None,
                source: Source::Http { url: url.clone(), headers: vec![] },
                dir: dir.to_string_lossy().to_string(),
                ext: None,
            })
            .await
            .unwrap();
            download_pause(again.id.clone());
            let part = format!("{}.part", again.path);
            std::fs::write(&part, &full[..full.len() / 3]).unwrap();
            download_resume(again.id.clone());
            let t = Instant::now();
            loop {
                let it = download_list().into_iter().find(|i| i.id == again.id).unwrap();
                if it.status == Status::Done {
                    break;
                }
                assert_ne!(it.status, Status::Error, "{:?}", it.error);
                assert!(t.elapsed() < Duration::from_secs(60));
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let resumed = std::fs::read(&again.path).unwrap();
            assert_eq!(resumed.len(), full.len());
            assert!(resumed == full, "resumed file differs");
            assert!(again.path.ends_with("Test Show - S1E1 · Pilot (2).mkv"), "{}", again.path);

            download_remove(again.id, true).await.unwrap();
            assert!(!Path::new(&download_list().iter().find(|i| i.id == item.id).unwrap().path).with_extension("x").exists());
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    /// Real torrent, on the Windows CI runner: RIPPLE_TEST_TORRENT=1 cargo test torrent_download
    #[test]
    fn torrent_download() {
        if std::env::var("RIPPLE_TEST_TORRENT").is_err() {
            return;
        }
        let hash = "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c".to_string(); // Big Buck Bunny
        let rt = tokio::runtime::Builder::new_multi_thread().enable_all().build().unwrap();
        rt.block_on(async {
            let dir = std::env::temp_dir().join(format!("ripple-dl-torrent-{}", std::process::id()));
            let item = download_add(AddRequest {
                title: "Big Buck Bunny".into(),
                subtitle: String::new(),
                meta_id: "tt1254207".into(),
                meta_type: "movie".into(),
                video_id: "tt1254207".into(),
                poster: None,
                source: Source::Torrent { info_hash: hash, file_idx: None, trackers: vec![], file_hint: None },
                dir: dir.to_string_lossy().to_string(),
                ext: None,
            })
            .await
            .unwrap();
            let t = Instant::now();
            loop {
                let it = download_list().into_iter().find(|i| i.id == item.id).unwrap();
                assert_ne!(it.status, Status::Error, "{:?}", it.error);
                if it.done > 4 * 1024 * 1024 {
                    eprintln!("torrent download: {} of {} bytes after {:?}", it.done, it.size, t.elapsed());
                    assert!(it.size > it.done && it.path.ends_with("Big Buck Bunny.mp4"), "{} {}", it.size, it.path);
                    break;
                }
                assert!(t.elapsed() < Duration::from_secs(120), "no progress: {}/{}", it.done, it.size);
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            download_pause(item.id.clone());
            tokio::time::sleep(Duration::from_millis(2500)).await;
            let it = download_list().into_iter().find(|i| i.id == item.id).unwrap();
            assert_eq!(it.status, Status::Paused);
            download_remove(item.id.clone(), true).await.unwrap();
            assert!(!Path::new(&it.path).parent().unwrap().join(format!(".ripple-{}", item.id)).exists(), "working folder left behind");
            let _ = std::fs::remove_dir_all(&dir);
        });
    }
}

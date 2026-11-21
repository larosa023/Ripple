//! Built-in torrent streaming, so P2P (infoHash) streams play without installing Stremio Service.
//!
//! A librqbit session downloads only the chosen file, prioritising the pieces around where the
//! player is reading, and a tiny local HTTP server hands that file to mpv with range support
//! (so seeking works). Everything is stored in Ripple's cache folder and deleted when playback
//! stops or the app closes.

use std::io::SeekFrom;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::time::Duration;

use librqbit::api::TorrentIdOrHash;
use librqbit::{AddTorrent, AddTorrentOptions, Api, DhtSessionConfig, Session, SessionOptions};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{Mutex, OnceCell};

struct Engine {
    api: Api,
    port: u16,
    folder: PathBuf,
}

static ENGINE: OnceCell<Engine> = OnceCell::const_new();
static FOLDER: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
/// Info hashes added this session (deleted on stop).
static ACTIVE: Mutex<Vec<String>> = Mutex::const_new(Vec::new());

/// Public trackers added to every torrent, as Stremio does: magnet links from addons often
/// carry few or none, and these make finding peers much faster.
const TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://explodie.org:6969/announce",
    "udp://tracker.dler.org:6969/announce",
];

const VIDEO_EXT: &[&str] = &["mkv", "mp4", "avi", "mov", "m4v", "webm", "ts", "m2ts", "wmv", "flv", "mpg", "mpeg"];

/// Where downloads go. Set once at startup to the app cache dir.
pub fn init(cache_dir: PathBuf) {
    let folder = cache_dir.join("torrents");
    // Leftovers from a crash or forced quit.
    let _ = std::fs::remove_dir_all(&folder);
    let _ = FOLDER.set(folder);
}

async fn engine() -> Result<&'static Engine, String> {
    ENGINE
        .get_or_try_init(|| async {
            let folder = FOLDER
                .get()
                .cloned()
                .unwrap_or_else(|| std::env::temp_dir().join("ripple-torrents"));
            std::fs::create_dir_all(&folder).map_err(|e| format!("Can't create the download folder: {e}"))?;
            let opts = |ipv4_only: bool, dht: bool| SessionOptions {
                dht: dht.then(|| DhtSessionConfig { persistence: None, ..Default::default() }),
                // Outgoing connections only: no inbound listener, so Windows doesn't ask
                // about firewall access. Popular torrents stream fine this way.
                listen: None,
                fastresume: false,
                persistence: None,
                disable_local_service_discovery: true,
                ipv4_only,
                client_name_and_version: Some(format!("Ripple {}", env!("CARGO_PKG_VERSION"))),
                trackers: TRACKERS.iter().filter_map(|t| t.parse().ok()).collect(),
                ..Default::default()
            };
            // PCs with IPv6 turned off can't open the dual-stack DHT socket: fall back to IPv4,
            // then to trackers only, rather than failing outright.
            let mut last = String::new();
            let mut session = None;
            for (v4, dht) in [(false, true), (true, true), (true, false)] {
                match Session::new_with_opts(folder.clone(), opts(v4, dht)).await {
                    Ok(s) => {
                        session = Some(s);
                        break;
                    }
                    Err(e) => last = format!("{e:#}"),
                }
            }
            let session = session.ok_or_else(|| format!("Couldn't start the torrent engine: {last}"))?;
            let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
                .await
                .map_err(|e| format!("Couldn't open the local stream port: {e}"))?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let api = Api::new(session, None);
            tauri::async_runtime::spawn(serve(listener));
            Ok(Engine { api, port, folder })
        })
        .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStream {
    pub url: String,
    pub file_name: String,
    pub size: u64,
    pub info_hash: String,
}

fn is_video(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower
        .rsplit('.')
        .next()
        .map(|ext| VIDEO_EXT.contains(&ext))
        .unwrap_or(false)
        && !lower.contains("sample")
}

/// Picks the file to play: the one the addon named, else the largest video (skipping samples).
fn choose_file(files: &[(String, u64)], wanted: Option<i64>, hint: Option<&str>) -> Option<usize> {
    if let Some(i) = wanted {
        if i >= 0 && (i as usize) < files.len() {
            return Some(i as usize);
        }
    }
    if let Some(hint) = hint.filter(|h| !h.is_empty()) {
        let h = hint.to_ascii_lowercase();
        if let Some(i) = files.iter().position(|(n, _)| n.to_ascii_lowercase().ends_with(&h)) {
            return Some(i);
        }
    }
    let videos = files.iter().enumerate().filter(|(_, (n, _))| is_video(n));
    let best = videos.max_by_key(|(_, (_, len))| *len).map(|(i, _)| i);
    best.or_else(|| files.iter().enumerate().max_by_key(|(_, (_, l))| *l).map(|(i, _)| i))
}

fn magnet(hash: &str, trackers: &[String]) -> String {
    let mut m = format!("magnet:?xt=urn:btih:{hash}");
    for t in trackers.iter().take(30) {
        m.push_str("&tr=");
        m.push_str(&urlencode(t));
    }
    m
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn valid_hash(h: &str) -> bool {
    h.len() == 40 && h.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Starts (or reuses) a torrent and returns a local http:// link mpv can play.
#[tauri::command]
pub async fn torrent_stream(
    info_hash: String,
    file_idx: Option<i64>,
    trackers: Option<Vec<String>>,
    file_hint: Option<String>,
) -> Result<TorrentStream, String> {
    let hash = info_hash.trim().to_ascii_lowercase();
    if !valid_hash(&hash) {
        return Err("This torrent link is invalid.".into());
    }
    let eng = engine().await?;
    let session = eng.api.session().clone();
    let trackers: Vec<String> = trackers
        .unwrap_or_default()
        .into_iter()
        .filter_map(|t| t.strip_prefix("tracker:").map(str::to_string).or(Some(t)))
        .filter(|t| t.starts_with("udp://") || t.starts_with("http://") || t.starts_with("https://"))
        .collect();

    let opts = AddTorrentOptions {
        overwrite: true,
        // Paused until we know which file is wanted; then only that file downloads.
        paused: true,
        ..Default::default()
    };
    let added = tokio::time::timeout(
        Duration::from_secs(60),
        session.add_torrent(AddTorrent::from_url(magnet(&hash, &trackers)), Some(opts)),
    )
    .await
    .map_err(|_| "Couldn't find anyone sharing this torrent. Try another source.".to_string())?
    .map_err(|e| format!("Couldn't open this torrent: {e:#}"))?;
    let handle = added.into_handle().ok_or("Couldn't open this torrent.")?;
    {
        let mut active = ACTIVE.lock().await;
        if !active.contains(&hash) {
            active.push(hash.clone());
        }
    }

    let files: Vec<(String, u64)> = handle
        .with_metadata(|m| {
            m.file_infos
                .iter()
                .map(|f| (f.relative_filename.to_string_lossy().replace('\\', "/"), f.len))
                .collect()
        })
        .map_err(|e| format!("Couldn't read the torrent's file list: {e:#}"))?;
    let idx = choose_file(&files, file_idx, file_hint.as_deref()).ok_or("This torrent has no files.")?;
    // File selection can only change once the torrent has finished setting up.
    tokio::time::timeout(Duration::from_secs(30), handle.wait_until_initialized())
        .await
        .map_err(|_| "The torrent took too long to start.".to_string())?
        .map_err(|e| format!("Couldn't start this torrent: {e:#}"))?;
    session
        .update_only_files(&handle, &[idx].into_iter().collect())
        .await
        .map_err(|e| format!("Couldn't select the video file: {e:#}"))?;
    session.unpause(&handle).await.ok();

    let (name, size) = files[idx].clone();
    let short = name.rsplit('/').next().unwrap_or(&name).to_string();
    Ok(TorrentStream {
        url: format!("http://127.0.0.1:{}/{hash}/{idx}/{}", eng.port, urlencode(&short)),
        file_name: short,
        size,
        info_hash: hash,
    })
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TorrentStatus {
    pub peers: u64,
    /// Bytes per second.
    pub download_speed: f64,
    pub downloaded: u64,
    pub total: u64,
}

/// Peers and speed, for the "Connecting to peers…" overlay.
#[tauri::command]
pub async fn torrent_status(info_hash: String) -> Result<TorrentStatus, String> {
    let Some(eng) = ENGINE.get() else { return Ok(TorrentStatus::default()) };
    let id = TorrentIdOrHash::parse(&info_hash.to_ascii_lowercase()).map_err(|e| e.to_string())?;
    let stats = eng.api.api_stats_v1(id).map_err(|e| e.to_string())?;
    let v = serde_json::to_value(&stats).unwrap_or_default();
    let live = &v["live"];
    Ok(TorrentStatus {
        peers: live["snapshot"]["peer_stats"]["live"].as_u64().unwrap_or(0),
        download_speed: live["download_speed"]["mbps"].as_f64().unwrap_or(0.0) * 1_048_576.0,
        downloaded: v["progress_bytes"].as_u64().unwrap_or(0),
        total: v["total_bytes"].as_u64().unwrap_or(0),
    })
}

/// Stops every torrent (except `keep`, the one about to play) and deletes what was downloaded.
#[tauri::command]
pub async fn torrent_stop_all(keep: Option<String>) {
    let Some(eng) = ENGINE.get() else { return };
    let keep = keep.map(|k| k.to_ascii_lowercase());
    let hashes: Vec<String> = {
        let mut active = ACTIVE.lock().await;
        let (kept, gone): (Vec<String>, Vec<String>) = active.drain(..).partition(|h| Some(h) == keep.as_ref());
        *active = kept;
        gone
    };
    for h in hashes {
        if let Ok(id) = TorrentIdOrHash::parse(&h) {
            let _ = eng.api.session().delete(id, true).await;
        }
    }
}

/// On exit: drop everything on disk.
pub fn shutdown() {
    if let Some(eng) = ENGINE.get() {
        let _ = std::fs::remove_dir_all(&eng.folder);
    } else if let Some(f) = FOLDER.get() {
        let _ = std::fs::remove_dir_all(f);
    }
}

// ---------- local HTTP server (GET/HEAD with Range) ----------

async fn serve(listener: TcpListener) {
    loop {
        let Ok((sock, addr)) = listener.accept().await else { continue };
        if !addr.ip().is_loopback() {
            continue;
        }
        tauri::async_runtime::spawn(async move {
            let _ = handle_conn(sock, addr).await;
        });
    }
}

fn mime(name: &str) -> &'static str {
    match name.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("mp4") | Some("m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("ts") | Some("m2ts") => "video/mp2t",
        Some("mov") => "video/quicktime",
        _ => "application/octet-stream",
    }
}

/// Parses "bytes=a-b" into a half-open range within `len`.
fn parse_range(v: &str, len: u64) -> Option<Result<(u64, u64), ()>> {
    let spec = v.trim().strip_prefix("bytes=")?;
    let (a, b) = spec.split(',').next()?.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    let range = if a.is_empty() {
        // suffix: last N bytes
        let n: u64 = b.parse().ok()?;
        (len.saturating_sub(n), len)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { len } else { b.parse::<u64>().ok()?.saturating_add(1).min(len) };
        (start, end)
    };
    Some(if range.0 >= len || range.1 <= range.0 { Err(()) } else { Ok(range) })
}

async fn handle_conn(sock: TcpStream, _addr: SocketAddr) -> std::io::Result<()> {
    let (rd, mut wr) = sock.into_split();
    let mut rd = BufReader::new(rd);
    let mut request = String::new();
    rd.read_line(&mut request).await?;
    let mut range_header = None;
    let mut total = request.len();
    loop {
        let mut line = String::new();
        let n = rd.read_line(&mut line).await?;
        total += n;
        if n == 0 || line == "\r\n" || line == "\n" || total > 16_384 {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range_header = Some(v.trim().to_string());
            }
        }
    }
    let mut parts = request.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");
    let head = method == "HEAD";
    if method != "GET" && !head {
        return respond(&mut wr, "405 Method Not Allowed", &[]).await;
    }
    let segs: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let (Some(hash), Some(idx)) = (segs.first(), segs.get(1).and_then(|s| s.parse::<usize>().ok())) else {
        return respond(&mut wr, "404 Not Found", &[]).await;
    };
    let Some(eng) = ENGINE.get() else { return respond(&mut wr, "503 Service Unavailable", &[]).await };
    let Ok(id) = TorrentIdOrHash::parse(hash) else { return respond(&mut wr, "404 Not Found", &[]).await };
    let mut stream = match eng.api.api_stream(id, idx).await {
        Ok(s) => s,
        Err(_) => return respond(&mut wr, "404 Not Found", &[]).await,
    };
    let len = stream.len();
    let name = segs.get(2).copied().unwrap_or("");
    let ctype = mime(name);

    let (status, start, end) = match range_header.as_deref().and_then(|r| parse_range(r, len)) {
        Some(Ok((s, e))) => ("206 Partial Content", s, e),
        Some(Err(())) => {
            let cr = format!("bytes */{len}");
            return respond(&mut wr, "416 Range Not Satisfiable", &[("Content-Range", &cr)]).await;
        }
        None => ("200 OK", 0, len),
    };
    let clen = (end - start).to_string();
    let crange = format!("bytes {}-{}/{len}", start, end.saturating_sub(1));
    let mut headers: Vec<(&str, &str)> = vec![("Content-Type", ctype), ("Accept-Ranges", "bytes"), ("Content-Length", &clen)];
    if status.starts_with("206") {
        headers.push(("Content-Range", &crange));
    }
    respond(&mut wr, status, &headers).await?;
    if head {
        return Ok(());
    }
    stream.seek(SeekFrom::Start(start)).await?;
    let mut body = stream.take(end - start);
    tokio::io::copy(&mut body, &mut wr).await?;
    wr.shutdown().await
}

async fn respond(wr: &mut tokio::net::tcp::OwnedWriteHalf, status: &str, headers: &[(&str, &str)]) -> std::io::Result<()> {
    let mut out = format!("HTTP/1.1 {status}\r\nConnection: close\r\nCache-Control: no-store\r\n");
    for (k, v) in headers {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    if !headers.iter().any(|(k, _)| *k == "Content-Length") {
        out.push_str("Content-Length: 0\r\n");
    }
    out.push_str("\r\n");
    wr.write_all(out.as_bytes()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_right_file() {
        let f = |n: &str, l: u64| (n.to_string(), l);
        let files = vec![f("Show/sample.mkv", 900), f("Show/ep.mkv", 500), f("Show/extras.nfo", 5000), f("Show/ep2.mp4", 400)];
        assert_eq!(choose_file(&files, None, None), Some(1));
        assert_eq!(choose_file(&files, Some(3), None), Some(3));
        assert_eq!(choose_file(&files, Some(-1), None), Some(1));
        assert_eq!(choose_file(&files, Some(99), Some("ep2.mp4")), Some(3));
        assert_eq!(choose_file(&[f("a.txt", 1), f("b.bin", 9)], None, None), Some(1));
        assert_eq!(choose_file(&[], None, None), None);
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 100), Some(Ok((0, 100))));
        assert_eq!(parse_range("bytes=10-19", 100), Some(Ok((10, 20))));
        assert_eq!(parse_range("bytes=90-200", 100), Some(Ok((90, 100))));
        assert_eq!(parse_range("bytes=-10", 100), Some(Ok((90, 100))));
        assert_eq!(parse_range("bytes=100-", 100), Some(Err(())));
        assert_eq!(parse_range("items=1-2", 100), None);
    }

    #[test]
    fn magnet_links() {
        let m = magnet("abc", &["udp://t.example:80/announce".into()]);
        assert_eq!(m, "magnet:?xt=urn:btih:abc&tr=udp%3A%2F%2Ft.example%3A80%2Fannounce");
        assert!(valid_hash("0123456789abcdef0123456789abcdef01234567"));
        assert!(!valid_hash("xyz"));
    }

    /// Real network test: streams a well-seeded public-domain torrent (Big Buck Bunny).
    /// Only runs with RIPPLE_TEST_TORRENT=1.
    #[test]
    fn streams_a_real_torrent() {
        if std::env::var("RIPPLE_TEST_TORRENT").is_err() {
            return;
        }
        init(std::env::temp_dir().join("ripple-torrent-test"));
        tauri::async_runtime::block_on(async {
            let s = torrent_stream("dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c".into(), None, None, None)
                .await
                .expect("stream");
            println!("{} {} {}", s.url, s.file_name, s.size);
            assert!(s.file_name.ends_with(".mp4"));
            // Fetch the first 64 KB through our HTTP server.
            let url = s.url.trim_start_matches("http://");
            let (host, path) = url.split_once('/').unwrap();
            let mut sock = TcpStream::connect(host).await.unwrap();
            sock.write_all(format!("GET /{path} HTTP/1.1\r\nHost: x\r\nRange: bytes=0-65535\r\n\r\n").as_bytes())
                .await
                .unwrap();
            let mut buf = Vec::new();
            tokio::time::timeout(Duration::from_secs(120), sock.read_to_end(&mut buf)).await.unwrap().unwrap();
            let text = String::from_utf8_lossy(&buf[..200.min(buf.len())]).to_string();
            assert!(text.starts_with("HTTP/1.1 206"), "{text}");
            assert!(buf.len() > 65536, "got {}", buf.len());
            let st = torrent_status(s.info_hash.clone()).await.unwrap();
            println!("peers {} speed {}", st.peers, st.download_speed);
            torrent_stop_all(None).await;
        });
        shutdown();
    }
}

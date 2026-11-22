//! Windows media controls: what's playing shows in the volume/media overlay and on the lock
//! screen, and the keyboard's play/pause/next keys work even when Ripple isn't focused.
//! The controls live on their own thread; the page sends updates through a channel.

use serde::Deserialize;
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)] // only read on Windows
pub struct MediaInfo {
    pub title: String,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub album: Option<String>,
    /// http(s) artwork URL.
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
}

#[derive(Debug)]
#[allow(dead_code)] // only read on Windows
enum Msg {
    Info(MediaInfo),
    State { playing: bool, position: f64 },
    Clear,
}

/// Turns a seconds value from the page into a Duration, ignoring nonsense.
#[allow(dead_code)]
fn secs(v: f64) -> std::time::Duration {
    std::time::Duration::from_secs_f64(if v.is_finite() && v > 0.0 { v.min(1e7) } else { 0.0 })
}

#[cfg(windows)]
mod imp {
    use super::*;
    use serde_json::json;
    use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig, SeekDirection};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, OnceLock};
    use tauri::Emitter;

    static TX: OnceLock<Mutex<Sender<Msg>>> = OnceLock::new();

    pub fn init<R: Runtime>(app: &AppHandle<R>) {
        let Ok(hwnd) = crate::embed::window_id(app) else { return };
        let (tx, rx) = channel::<Msg>();
        if TX.set(Mutex::new(tx)).is_err() {
            return;
        }
        let app = app.clone();
        std::thread::spawn(move || {
            let config = PlatformConfig { display_name: "Ripple", dbus_name: "ripple", hwnd: Some(hwnd as isize as *mut std::ffi::c_void) };
            let Ok(mut controls) = MediaControls::new(config) else { return };
            let emit = app.clone();
            let _ = controls.attach(move |e: MediaControlEvent| {
                let (action, value) = match e {
                    MediaControlEvent::Play => ("play", 0.0),
                    MediaControlEvent::Pause => ("pause", 0.0),
                    MediaControlEvent::Toggle => ("toggle", 0.0),
                    MediaControlEvent::Next => ("next", 0.0),
                    MediaControlEvent::Previous => ("previous", 0.0),
                    MediaControlEvent::Stop => ("stop", 0.0),
                    MediaControlEvent::Seek(SeekDirection::Forward) => ("seekBy", 10.0),
                    MediaControlEvent::Seek(SeekDirection::Backward) => ("seekBy", -10.0),
                    MediaControlEvent::SeekBy(SeekDirection::Forward, d) => ("seekBy", d.as_secs_f64()),
                    MediaControlEvent::SeekBy(SeekDirection::Backward, d) => ("seekBy", -d.as_secs_f64()),
                    MediaControlEvent::SetPosition(MediaPosition(d)) => ("seekTo", d.as_secs_f64()),
                    _ => return,
                };
                let _ = emit.emit("media://key", json!({ "action": action, "value": value }));
            });
            for msg in rx {
                let _ = match msg {
                    Msg::Info(i) => controls.set_metadata(MediaMetadata {
                        title: Some(&i.title),
                        artist: i.artist.as_deref(),
                        album: i.album.as_deref(),
                        cover_url: i.cover.as_deref().filter(|u| u.starts_with("https://") || u.starts_with("http://")),
                        duration: i.duration.map(secs),
                    }),
                    Msg::State { playing, position } => {
                        let progress = Some(MediaPosition(secs(position)));
                        controls.set_playback(if playing { MediaPlayback::Playing { progress } } else { MediaPlayback::Paused { progress } })
                    }
                    Msg::Clear => controls.set_playback(MediaPlayback::Stopped),
                };
            }
        });
    }

    pub(super) fn send(msg: Msg) {
        if let Some(tx) = TX.get() {
            if let Ok(tx) = tx.lock() {
                let _ = tx.send(msg);
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn init<R: Runtime>(_app: &AppHandle<R>) {}
    pub(super) fn send(_msg: Msg) {}
}

pub use imp::init;

/// What's playing changed (new video).
#[tauri::command]
pub fn media_info(info: MediaInfo) {
    imp::send(Msg::Info(info));
}

/// Playing / paused and where.
#[tauri::command]
pub fn media_state(playing: bool, position: f64) {
    imp::send(Msg::State { playing, position });
}

/// Nothing is playing any more.
#[tauri::command]
pub fn media_clear() {
    imp::send(Msg::Clear);
}

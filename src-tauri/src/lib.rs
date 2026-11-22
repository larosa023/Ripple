mod discord;
mod downloads;
mod embed;
mod media;
mod player;
mod thumbs;
mod torrent;
mod updater;

pub fn run() {
    use tauri::Manager;
    use tauri_plugin_window_state::StateFlags;

    tauri::Builder::default()
        // Opening Ripple again focuses the window that's already running instead of starting a second copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        // Reopen at the same size and place (and maximized if it was). Fullscreen and title-bar
        // style are left to Ripple so a video left fullscreen doesn't reopen fullscreen.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if let Ok(dir) = app.path().app_cache_dir() {
                torrent::init(dir);
            }
            // The window is transparent so mpv's video can show through the page, but the
            // page itself only needs to be see-through while a video plays. Until then (and
            // during resizes, before the page has painted) WebView2 fills with a solid color,
            // so the desktop never shows through. The page switches this as playback starts
            // and stops, and keeps it in step with the theme.
            media::init(app.handle());
            if let Ok(dir) = app.path().app_data_dir() {
                downloads::init(dir);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some(tauri::window::Color(11, 13, 18, 255)));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            player::play_external,
            player::detect_players,
            player::install_mpv,
            embed::player_start,
            embed::player_command,
            embed::player_stop,
            updater::check_update,
            updater::install_update,
            discord::discord_set,
            torrent::torrent_stream,
            torrent::torrent_status,
            torrent::torrent_stop_all,
            thumbs::player_thumb,
            media::media_info,
            media::media_state,
            media::media_clear,
            downloads::download_add,
            downloads::download_list,
            downloads::download_pause,
            downloads::download_resume,
            downloads::download_remove,
            downloads::download_reveal
        ])
        .build(tauri::generate_context!())
        .expect("error while building Ripple")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                embed::shutdown();
                discord::shutdown();
                torrent::shutdown();
            }
        });
}

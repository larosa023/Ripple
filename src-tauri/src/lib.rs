mod discord;
mod embed;
mod player;
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
        .invoke_handler(tauri::generate_handler![
            player::play_external,
            player::detect_players,
            player::install_mpv,
            embed::player_start,
            embed::player_command,
            embed::player_stop,
            updater::check_update,
            updater::install_update,
            discord::discord_set
        ])
        .build(tauri::generate_context!())
        .expect("error while building Ripple")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                embed::shutdown();
                discord::shutdown();
            }
        });
}

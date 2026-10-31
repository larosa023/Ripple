mod embed;
mod player;
mod updater;

pub fn run() {
    tauri::Builder::default()
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
            updater::install_update
        ])
        .build(tauri::generate_context!())
        .expect("error while building Ripple")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                embed::shutdown();
            }
        });
}

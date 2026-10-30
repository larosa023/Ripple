mod player;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            player::play_external,
            player::detect_players
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ripple");
}

use tauri::{Manager, path::BaseDirectory};
use tauri_plugin_shell::ShellExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            let model_file = app.path().resolve(
                "models/ggml-kotoba-whisper-v2.0-q5_0.bin",
                BaseDirectory::Resource,
            )?;
            let (_events, _child) = app
                .shell()
                .sidecar("whisper-server")?
                .args(["--host", "0.0.0.0", "--port", "53102", "--model"])
                .arg(&model_file)
                .args(["--language", "ja", "--threads", "4", "--flash-attn"])
                .spawn()
                .map_err(|error| format!("whisper-serverの起動に失敗しました: {error}"))?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

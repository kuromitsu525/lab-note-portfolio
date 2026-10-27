use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use tauri::{Manager, path::BaseDirectory};
use tauri_plugin_shell::ShellExt;

const CLOUDFLARE_ACCESS_KEYRING_SERVICE: &str = "net.kajilab.labnote.cloudflare-access";
const CLOUDFLARE_ACCESS_KEYRING_ACCOUNT: &str = "service-token";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CloudflareAccessCredentials {
    client_id: String,
    client_secret: String,
}

fn cloudflare_access_keyring_entry() -> Result<Entry, String> {
    Entry::new(
        CLOUDFLARE_ACCESS_KEYRING_SERVICE,
        CLOUDFLARE_ACCESS_KEYRING_ACCOUNT,
    )
    .map_err(|error| format!("資格情報ストアを利用できません: {error}"))
}

#[tauri::command]
fn load_cloudflare_access_credentials() -> Result<Option<CloudflareAccessCredentials>, String> {
    let entry = cloudflare_access_keyring_entry()?;
    let stored_value = match entry.get_password() {
        Ok(value) => value,
        Err(KeyringError::NoEntry) => return Ok(None),
        Err(error) => return Err(format!("Cloudflare Access設定を読み込めません: {error}")),
    };

    serde_json::from_str(&stored_value).map(Some).map_err(|_| {
        "保存済みのCloudflare Access設定を読み取れません。設定を削除して再登録してください。"
            .to_string()
    })
}

#[tauri::command]
fn save_cloudflare_access_credentials(
    credentials: CloudflareAccessCredentials,
) -> Result<(), String> {
    let client_id = credentials.client_id.trim();
    let client_secret = credentials.client_secret.trim();
    if client_id.is_empty() || client_secret.is_empty() {
        return Err("Client IDとClient Secretの両方を入力してください。".to_string());
    }

    let stored_value = serde_json::to_string(&CloudflareAccessCredentials {
        client_id: client_id.to_string(),
        client_secret: client_secret.to_string(),
    })
    .map_err(|_| "Cloudflare Access設定を保存用に変換できません。".to_string())?;

    cloudflare_access_keyring_entry()?
        .set_password(&stored_value)
        .map_err(|error| format!("Cloudflare Access設定を保存できません: {error}"))
}

#[tauri::command]
fn delete_cloudflare_access_credentials() -> Result<(), String> {
    match cloudflare_access_keyring_entry()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(error) => Err(format!("Cloudflare Access設定を削除できません: {error}")),
    }
}

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
        .invoke_handler(tauri::generate_handler![
            greet,
            load_cloudflare_access_credentials,
            save_cloudflare_access_credentials,
            delete_cloudflare_access_credentials
        ])
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

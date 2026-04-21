#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::StreamExt;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::Serialize;
use std::collections::HashSet;
use std::io::Write;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const MAIN_WINDOW_LABEL: &str = "main";
static CANCELLED_ATTACHMENT_DOWNLOADS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LivekitVideoGrant {
    room_join: bool,
    room: String,
    can_publish: bool,
    can_subscribe: bool,
}

#[derive(Serialize)]
struct LivekitClaims {
    iss: String,
    sub: String,
    nbf: usize,
    exp: usize,
    video: LivekitVideoGrant,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentDownloadProgressPayload {
    operation_id: String,
    bytes_downloaded: u64,
    total_bytes: Option<u64>,
    completed: bool,
}

struct DownloadCancellationGuard {
    operation_id: String,
}

impl Drop for DownloadCancellationGuard {
    fn drop(&mut self) {
        clear_attachment_download_cancelled(&self.operation_id);
    }
}

fn mark_attachment_download_cancelled(operation_id: String) -> Result<(), String> {
    let mut cancelled = CANCELLED_ATTACHMENT_DOWNLOADS
        .lock()
        .map_err(|_| "Could not access download cancellation state.".to_string())?;
    cancelled.insert(operation_id);
    Ok(())
}

fn clear_attachment_download_cancelled(operation_id: &str) {
    if let Ok(mut cancelled) = CANCELLED_ATTACHMENT_DOWNLOADS.lock() {
        cancelled.remove(operation_id);
    }
}

fn is_attachment_download_cancelled(operation_id: &str) -> bool {
    if let Ok(cancelled) = CANCELLED_ATTACHMENT_DOWNLOADS.lock() {
        return cancelled.contains(operation_id);
    }
    false
}

#[tauri::command]
fn get_livekit_url() -> String {
    std::env::var("LIVEKIT_URL").unwrap_or_else(|_| "http://127.0.0.1:7880".to_string())
}

#[tauri::command]
fn generate_livekit_token(room: String, identity: String) -> Result<String, String> {
    let api_key = std::env::var("LIVEKIT_API_KEY").unwrap_or_else(|_| "devkey".to_string());
    let api_secret = std::env::var("LIVEKIT_API_SECRET")
        .unwrap_or_else(|_| "devsecret0123456789devsecret0123456789".to_string());

    let now_secs = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()) as usize;

    let claims = LivekitClaims {
        iss: api_key,
        sub: identity,
        nbf: now_secs,
        exp: now_secs + 3600,
        video: LivekitVideoGrant {
            room_join: true,
            room,
            can_publish: true,
            can_subscribe: true,
        },
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(api_secret.as_bytes()),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_notification(app: AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_badge_count(app: AppHandle, count: u32) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let window = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "main window not found".to_string())?;
        let badge_value = if count == 0 {
            None
        } else {
            Some(i64::from(count))
        };
        window
            .set_badge_count(badge_value)
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    let _ = (app, count);

    Ok(())
}

#[tauri::command]
fn minimize_to_tray(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window not found".to_string())?;
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn cancel_attachment_download(operation_id: String) -> Result<(), String> {
    mark_attachment_download_cancelled(operation_id)
}

#[tauri::command]
async fn save_attachment_file(
    app: AppHandle,
    url: String,
    file_name: String,
    operation_id: String,
) -> Result<bool, String> {
    let operation_id_for_cleanup = operation_id.clone();
    clear_attachment_download_cancelled(&operation_id_for_cleanup);
    let _cancellation_guard = DownloadCancellationGuard {
        operation_id: operation_id_for_cleanup.clone(),
    };

    let suggested_file_name = Path::new(file_name.as_str())
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or("download");

    let Some(path) = rfd::FileDialog::new()
        .set_file_name(suggested_file_name)
        .save_file()
    else {
        return Ok(false);
    };

    let response = reqwest::Client::new()
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Download request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Download failed ({status})."));
    }
    let total_bytes = response.content_length();
    let mut file =
        std::fs::File::create(&path).map_err(|error| format!("Saving file failed: {error}"))?;
    let mut stream = response.bytes_stream();
    let mut bytes_downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if is_attachment_download_cancelled(&operation_id) {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Ok(false);
        }

        let bytes = chunk.map_err(|error| format!("Reading download response failed: {error}"))?;
        file.write_all(&bytes)
            .map_err(|error| format!("Saving file failed: {error}"))?;
        bytes_downloaded += bytes.len() as u64;

        let _ = app.emit(
            "attachment-download-progress",
            AttachmentDownloadProgressPayload {
                operation_id: operation_id.clone(),
                bytes_downloaded,
                total_bytes,
                completed: false,
            },
        );
    }

    file.flush()
        .map_err(|error| format!("Saving file failed: {error}"))?;

    let _ = app.emit(
        "attachment-download-progress",
        AttachmentDownloadProgressPayload {
            operation_id: operation_id.clone(),
            bytes_downloaded,
            total_bytes,
            completed: true,
        },
    );
    Ok(true)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_livekit_url,
            generate_livekit_token,
            open_url,
            show_notification,
            set_badge_count,
            minimize_to_tray,
            get_app_version,
            cancel_attachment_download,
            save_attachment_file
        ])
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "tray_open", "Open", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])?;
            let app_icon = tauri::include_image!("icons/icon-stealthchat.png");
            let tray_icon = app_icon.clone();

            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.set_icon(app_icon);
            }

            let app_handle = app.handle().clone();
            TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event: MenuEvent| match event.id().as_ref() {
                    "tray_open" => show_main_window(app),
                    "tray_quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(&app_handle);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

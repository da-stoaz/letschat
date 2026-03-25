#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::Serialize;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const MAIN_WINDOW_LABEL: &str = "main";

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

#[tauri::command]
fn get_livekit_url() -> String {
    std::env::var("LIVEKIT_URL").unwrap_or_else(|_| "http://localhost:7880".to_string())
}

#[tauri::command]
fn generate_livekit_token(room: String, identity: String) -> Result<String, String> {
    let api_key = std::env::var("LIVEKIT_API_KEY").unwrap_or_else(|_| "devkey".to_string());
    let api_secret = std::env::var("LIVEKIT_API_SECRET").unwrap_or_else(|_| "secret".to_string());

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
        window
            .set_badge_count(Some(i64::from(count)))
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

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_livekit_url,
            generate_livekit_token,
            open_url,
            show_notification,
            set_badge_count,
            minimize_to_tray,
            get_app_version
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

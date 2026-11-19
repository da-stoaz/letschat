#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures_util::StreamExt;
use serde::Serialize;
use std::collections::HashSet;
use std::io::Write;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{AppHandle, Emitter, Manager, State, Url};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};

const MAIN_WINDOW_LABEL: &str = "main";
static CANCELLED_ATTACHMENT_DOWNLOADS: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

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

/// Opens a web page in the default browser. The OS opener behind it also runs
/// programs, opens local files and network shares and starts any registered
/// protocol handler, so only plain http(s) links get through. Otherwise any
/// script in the webview could run code on the machine.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = web_url(&url)?;
    // Hand over the re-serialized URL, so what opens is exactly what was checked.
    app.opener()
        .open_url(url.as_str(), None::<String>)
        .map_err(|e| e.to_string())
}

fn web_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "Not a valid link.".to_string())?;
    let web = matches!(url.scheme(), "http" | "https") && url.host_str().is_some();
    // Credentials in a link only serve to disguise the real host.
    if !web || !url.username().is_empty() || url.password().is_some() {
        return Err("Only web links can be opened.".to_string());
    }
    Ok(url)
}

/// Opens the system page where this app's camera or microphone access is
/// switched on. Fixed URLs per OS, so the page can't pass in arbitrary links.
#[tauri::command]
fn open_privacy_settings(app: AppHandle, device: String) -> Result<(), String> {
    let url = match (device.as_str(), std::env::consts::OS) {
        ("camera", "windows") => "ms-settings:privacy-webcam",
        ("microphone", "windows") => "ms-settings:privacy-microphone",
        ("camera", "macos") => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"
        }
        ("microphone", "macos") => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        _ => return Err("This system has no privacy settings page to open.".to_string()),
    };
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}

/// Pages this app ships, as opposed to anything the window might navigate to.
fn is_app_url(url: &Url) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        // `tauri dev` serves the frontend from the Vite dev server.
        ("http", Some("localhost")) => cfg!(debug_assertions),
        _ => false,
    }
}

/// Clicking Camera, Mute or Share is the consent; the OS privacy controls stay
/// in charge. The webview's own prompt only added a second question, and on
/// Windows WebView2 remembered a "Block" forever with no way to undo it.
fn media_permission<R: tauri::Runtime>(
    webview: &tauri::Webview<R>,
    kind: PermissionKind,
) -> PermissionResponse {
    let media = matches!(
        kind,
        PermissionKind::Camera | PermissionKind::Microphone | PermissionKind::DisplayCapture
    );
    if media && webview.url().is_ok_and(|url| is_app_url(&url)) {
        PermissionResponse::Allow
    } else {
        PermissionResponse::Default
    }
}

/// Clears camera/microphone "Block" decisions WebView2 saved from its own
/// prompt before `media_permission` existed. While one is stored, WebView2
/// answers from it and never asks the handler again.
#[cfg(windows)]
fn forget_blocked_media_permissions(window: &tauri::WebviewWindow) {
    use webview2_com::{
        CoTaskMemPWSTR, GetNonDefaultPermissionSettingsCompletedHandler,
        Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
            COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE,
            COREWEBVIEW2_PERMISSION_STATE_DEFAULT, COREWEBVIEW2_PERMISSION_STATE_DENY,
            ICoreWebView2_13, ICoreWebView2Profile4,
        },
        SetPermissionStateCompletedHandler,
    };
    use windows_core::{HSTRING, Interface, PWSTR};

    let _ = window.with_webview(|webview| unsafe {
        // Older WebView2 runtimes lack these interfaces; they also never saved the state.
        let Ok(profile) = webview
            .controller()
            .CoreWebView2()
            .and_then(|core| core.cast::<ICoreWebView2_13>())
            .and_then(|core| core.Profile())
            .and_then(|profile| profile.cast::<ICoreWebView2Profile4>())
        else {
            return;
        };
        let reset = profile.clone();
        let handler = GetNonDefaultPermissionSettingsCompletedHandler::create(Box::new(
            move |result, settings| {
                result?;
                let Some(settings) = settings else {
                    return Ok(());
                };
                let mut count = 0;
                settings.Count(&mut count)?;
                for index in 0..count {
                    let setting = settings.GetValueAtIndex(index)?;
                    let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                    let mut state = COREWEBVIEW2_PERMISSION_STATE::default();
                    setting.PermissionKind(&mut kind)?;
                    setting.PermissionState(&mut state)?;
                    let media = kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                        || kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE;
                    if !media || state != COREWEBVIEW2_PERMISSION_STATE_DENY {
                        continue;
                    }
                    let mut origin = PWSTR::null();
                    setting.PermissionOrigin(&mut origin)?;
                    let origin = HSTRING::from(CoTaskMemPWSTR::from(origin).to_string());
                    reset.SetPermissionState(
                        kind,
                        &origin,
                        COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
                        &SetPermissionStateCompletedHandler::create(Box::new(|result| result)),
                    )?;
                }
                Ok(())
            },
        ));
        if let Err(error) = profile.GetNonDefaultPermissionSettings(&handler) {
            eprintln!("permissions: could not read saved WebView2 permissions: {error}");
        }
    });
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

/// The update the user was last offered; installing consumes it.
#[derive(Default)]
struct OfferedUpdate(Mutex<Option<Update>>);

/// Update feed of one published release. A connected server names the version, so
/// only a real version may reach the URL; drafts and unknown versions are a 404.
fn release_feed(version: &str) -> Result<(semver::Version, Url), String> {
    let version = semver::Version::parse(version).map_err(|error| error.to_string())?;
    let feed =
        format!("https://github.com/da-stoaz/letschat/releases/download/v{version}/latest.json");
    Ok((
        version,
        Url::parse(&feed).map_err(|error| error.to_string())?,
    ))
}

/// Looks for exactly the given release and returns its version when it is newer than
/// this app and correctly signed metadata exists for this platform.
#[tauri::command]
async fn check_app_update(
    app: AppHandle,
    offered: State<'_, OfferedUpdate>,
    version: String,
) -> Result<Option<String>, String> {
    let (version, feed) = release_feed(&version)?;
    let update = app
        .updater_builder()
        .endpoints(vec![feed])
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        // The feed of a release must describe that release, never a newer one.
        .filter(|update| update.version == version.to_string());
    let found = update.as_ref().map(|update| update.version.clone());
    *offered.0.lock().map_err(|error| error.to_string())? = update;
    Ok(found)
}

/// Downloads the offered update, verifies its signature, installs it and restarts.
#[tauri::command]
async fn install_app_update(
    app: AppHandle,
    offered: State<'_, OfferedUpdate>,
) -> Result<(), String> {
    let update = offered
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or("No update has been offered.")?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    app.restart()
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

    let safe_operation_id: String = operation_id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(64)
        .collect();
    let temporary_name = format!(".{suggested_file_name}.{safe_operation_id}.part");
    let temporary_path = path.with_file_name(temporary_name);

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
    let mut file = std::fs::File::create(&temporary_path)
        .map_err(|error| format!("Saving file failed: {error}"))?;
    let mut stream = response.bytes_stream();
    let mut bytes_downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if is_attachment_download_cancelled(&operation_id) {
            drop(file);
            let _ = std::fs::remove_file(&temporary_path);
            return Ok(false);
        }

        let bytes = match chunk {
            Ok(bytes) => bytes,
            Err(error) => {
                drop(file);
                let _ = std::fs::remove_file(&temporary_path);
                return Err(format!("Reading download response failed: {error}"));
            }
        };
        if let Err(error) = file.write_all(&bytes) {
            drop(file);
            let _ = std::fs::remove_file(&temporary_path);
            return Err(format!("Saving file failed: {error}"));
        }
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

    if let Err(error) = file.flush() {
        drop(file);
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!("Saving file failed: {error}"));
    }
    drop(file);
    if let Err(error) = std::fs::rename(&temporary_path, &path) {
        let _ = std::fs::remove_file(&temporary_path);
        return Err(format!("Finalizing download failed: {error}"));
    }

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
        // The single-instance callback fires when the OS launches a second copy
        // of the app — on Windows/Linux that's how a `letschat://…` click reaches
        // an already-running instance, so the URL arrives as a command-line arg.
        // Emit a custom event the frontend hook listens for, alongside the
        // `onOpenUrl` listener used for cold-start and for macOS warm-start
        // (which the deep-link plugin handles natively via NSAppleEventManager).
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            {
                if let Some(url) = args.iter().skip(1).find(|a| a.starts_with("letschat://")) {
                    let _ = app.emit("letschat-deeplink-warm", url.clone());
                }
            }
            #[cfg(not(any(target_os = "windows", target_os = "linux")))]
            let _ = args;
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(OfferedUpdate::default())
        .on_permission_request(|webview, kind| media_permission(&webview, kind))
        .invoke_handler(tauri::generate_handler![
            open_url,
            open_privacy_settings,
            show_notification,
            set_badge_count,
            minimize_to_tray,
            get_app_version,
            check_app_update,
            install_app_update,
            cancel_attachment_download,
            save_attachment_file
        ])
        .setup(|app| {
            // Register the `letschat://` URL scheme with the OS so that clicking
            // a join link launches this app. On installed builds the OS already
            // knows about the scheme (macOS via Info.plist, Windows via the
            // installer's registry entry, Linux via the .desktop file) so this
            // call is effectively a dev-mode safety net to keep `tauri dev` and
            // unpackaged binaries working too.
            #[cfg(debug_assertions)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(error) = app.deep_link().register("letschat") {
                    eprintln!("deep-link: failed to register `letschat` scheme: {error}");
                }
            }

            let open_item = MenuItem::with_id(app, "tray_open", "Open", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "tray_quit", "Quit", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let tray_menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])?;
            let app_icon = tauri::include_image!("icons/icon-stealthchat.png");
            let tray_icon = app_icon.clone();

            if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let _ = window.set_icon(app_icon);
                #[cfg(windows)]
                forget_blocked_media_permissions(&window);
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

#[cfg(test)]
mod tests {
    use super::{is_app_url, release_feed, web_url};
    use tauri::Url;

    #[test]
    fn open_url_opens_only_web_links() {
        for web in [
            "https://github.com/da-stoaz/letschat",
            "http://192.168.1.5:8080/x?y=1",
        ] {
            assert!(web_url(web).is_ok(), "{web}");
        }
        for hostile in [
            "file:///C:/Windows/System32/calc.exe",
            "file://attacker/share/payload.exe",
            r"\\attacker\share\payload.exe",
            r"C:\Windows\System32\calc.exe",
            "/Applications/Calculator.app",
            "smb://attacker/share",
            "ms-msdt:/id PCWDiagnostic",
            "search-ms:query=x&crumb=location:\\\\attacker",
            "javascript:alert(1)",
            "letschat://join/x",
            "https://github.com@attacker.example/",
            "https://user:pass@example.com/",
            "",
        ] {
            assert!(web_url(hostile).is_err(), "{hostile}");
        }
    }

    #[test]
    fn media_is_granted_only_to_app_pages() {
        for app in [
            "tauri://localhost/app",
            "http://tauri.localhost/",
            "https://tauri.localhost/x",
        ] {
            assert!(is_app_url(&Url::parse(app).unwrap()), "{app}");
        }
        for other in [
            "https://localhost.evil.example/",
            "https://tauri.localhost.evil.example/",
            "tauri://evil/",
            "file:///C:/x.html",
            "https://example.com/",
        ] {
            assert!(!is_app_url(&Url::parse(other).unwrap()), "{other}");
        }
        assert_eq!(
            is_app_url(&Url::parse("http://localhost:5173/").unwrap()),
            cfg!(debug_assertions)
        );
    }

    #[test]
    fn release_feed_accepts_only_versions() {
        let (version, feed) = release_feed("1.7.0").unwrap();
        assert_eq!(version.to_string(), "1.7.0");
        assert_eq!(
            feed.as_str(),
            "https://github.com/da-stoaz/letschat/releases/download/v1.7.0/latest.json"
        );
        assert!(release_feed("1.7.0-rc.1").is_ok());
        for hostile in [
            "",
            "latest",
            "1.7",
            "v1.7.0",
            "1.7.0/../../../evil/x",
            "1.7.0?x=1",
            "1.7.0#x",
            "1.7.0 ",
            "../1.7.0",
            "1.7.0%2F..",
        ] {
            assert!(release_feed(hostile).is_err(), "{hostile}");
        }
    }
}

use sqlx::FromRow;

use crate::ApiError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PushPlatform {
    ApnsSandbox,
    WindowsWns,
    WebPush,
}

impl PushPlatform {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            PushPlatform::ApnsSandbox => "apns_sandbox",
            PushPlatform::WindowsWns => "windows_wns",
            PushPlatform::WebPush => "web_push",
        }
    }

    pub(super) fn parse(raw: &str) -> Result<Self, ApiError> {
        match raw.trim().to_lowercase().as_str() {
            "apns_sandbox" => Ok(Self::ApnsSandbox),
            "windows_wns" => Ok(Self::WindowsWns),
            "web_push" => Ok(Self::WebPush),
            _ => Err(ApiError::BadRequest(
                "Unsupported platform. Use one of: apns_sandbox, windows_wns, web_push".to_string(),
            )),
        }
    }
}

#[derive(Debug, FromRow)]
pub(super) struct PushOutboxRow {
    pub(super) id: String,
    pub(super) username: String,
    pub(super) event_type: String,
    pub(super) title: String,
    pub(super) body: String,
    pub(super) payload_json: Option<String>,
    pub(super) attempt_count: i64,
}

#[derive(Debug, FromRow)]
pub(super) struct PushDeviceRow {
    pub(super) platform: String,
    pub(super) device_token: String,
    pub(super) app_bundle_id: Option<String>,
}

use std::sync::Arc;

use anyhow::Context;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::Serialize;
use serde_json::json;
use tokio::sync::Mutex;

use crate::{ApiError, internal};

use super::types::{PushDeviceRow, PushPlatform};

const APNS_SANDBOX_URL: &str = "https://api.sandbox.push.apple.com";

#[derive(Debug, Serialize)]
struct ApnsAuthClaims {
    iss: String,
    iat: usize,
}

#[derive(Debug, Clone)]
struct CachedApnsToken {
    token: String,
    issued_at_unix: i64,
}

#[derive(Clone)]
struct ApnsSandboxProvider {
    team_id: String,
    key_id: String,
    bundle_id: String,
    signing_key: EncodingKey,
    client: reqwest::Client,
    cached_token: Arc<Mutex<Option<CachedApnsToken>>>,
}

impl ApnsSandboxProvider {
    fn from_env() -> anyhow::Result<Option<Self>> {
        let enabled = std::env::var("APNS_SANDBOX_ENABLED")
            .map(|raw| raw.trim().eq_ignore_ascii_case("true") || raw.trim() == "1")
            .unwrap_or(false);
        if !enabled {
            return Ok(None);
        }

        let team_id = std::env::var("APNS_TEAM_ID").context("missing APNS_TEAM_ID")?;
        let key_id = std::env::var("APNS_KEY_ID").context("missing APNS_KEY_ID")?;
        let bundle_id = std::env::var("APNS_BUNDLE_ID").context("missing APNS_BUNDLE_ID")?;
        let private_key_pem = load_apns_private_key()?;

        let signing_key =
            EncodingKey::from_ec_pem(private_key_pem.as_bytes()).context("invalid APNS private key")?;
        let client = reqwest::Client::builder()
            .http2_adaptive_window(true)
            .use_rustls_tls()
            .build()
            .context("failed to build APNS HTTP client")?;

        Ok(Some(Self {
            team_id,
            key_id,
            bundle_id,
            signing_key,
            client,
            cached_token: Arc::new(Mutex::new(None)),
        }))
    }

    async fn authorization_token(&self) -> Result<String, ApiError> {
        let now_unix = chrono::Utc::now().timestamp();
        {
            let guard = self.cached_token.lock().await;
            if let Some(cached) = guard.as_ref() {
                if now_unix - cached.issued_at_unix < 50 * 60 {
                    return Ok(cached.token.clone());
                }
            }
        }

        let mut header = Header::new(Algorithm::ES256);
        header.kid = Some(self.key_id.clone());
        let claims = ApnsAuthClaims {
            iss: self.team_id.clone(),
            iat: now_unix as usize,
        };
        let token = encode(&header, &claims, &self.signing_key).map_err(internal)?;
        let mut guard = self.cached_token.lock().await;
        *guard = Some(CachedApnsToken {
            token: token.clone(),
            issued_at_unix: now_unix,
        });
        Ok(token)
    }

    async fn send_alert(
        &self,
        device_token: &str,
        title: &str,
        body: &str,
        event_type: &str,
        payload_json: Option<&str>,
        app_bundle_override: Option<&str>,
    ) -> Result<(), ApiError> {
        let auth_jwt = self.authorization_token().await?;
        let apns_topic = app_bundle_override
            .filter(|bundle| !bundle.trim().is_empty())
            .unwrap_or(self.bundle_id.as_str());

        let mut payload = json!({
            "aps": {
                "alert": { "title": title, "body": body },
                "sound": "default"
            },
            "eventType": event_type
        });
        if let Some(raw) = payload_json {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(raw) {
                payload["payload"] = parsed;
            }
        }

        let url = format!("{APNS_SANDBOX_URL}/3/device/{}", device_token.trim());
        let response = self
            .client
            .post(url)
            .header("authorization", format!("bearer {auth_jwt}"))
            .header("apns-topic", apns_topic)
            .header("apns-push-type", "alert")
            .json(&payload)
            .send()
            .await
            .map_err(internal)?;

        if response.status().is_success() {
            return Ok(());
        }

        let status = response.status();
        let detail = response.text().await.unwrap_or_else(|_| "".to_string());
        Err(ApiError::Internal(format!(
            "APNS send failed ({status}): {detail}"
        )))
    }
}

fn load_apns_private_key() -> anyhow::Result<String> {
    if let Ok(inline_key) = std::env::var("APNS_PRIVATE_KEY") {
        let trimmed = inline_key.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.replace("\\n", "\n"));
        }
    }
    let path = std::env::var("APNS_PRIVATE_KEY_PATH").context("missing APNS_PRIVATE_KEY_PATH")?;
    let key = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read APNS private key at {path}"))?;
    Ok(key)
}

#[derive(Clone)]
pub(crate) struct PushService {
    apns_sandbox: Option<ApnsSandboxProvider>,
}

impl PushService {
    pub(crate) fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            apns_sandbox: ApnsSandboxProvider::from_env()?,
        })
    }

    pub(super) async fn dispatch(
        &self,
        device: &PushDeviceRow,
        event_type: &str,
        title: &str,
        body: &str,
        payload_json: Option<&str>,
    ) -> Result<(), ApiError> {
        let platform = PushPlatform::parse(&device.platform)?;
        match platform {
            PushPlatform::ApnsSandbox => {
                let provider = self.apns_sandbox.as_ref().ok_or_else(|| {
                    ApiError::Internal(
                        "APNS sandbox provider is disabled. Configure APNS_SANDBOX_* env vars."
                            .to_string(),
                    )
                })?;
                provider
                    .send_alert(
                        &device.device_token,
                        title,
                        body,
                        event_type,
                        payload_json,
                        device.app_bundle_id.as_deref(),
                    )
                    .await
            }
            PushPlatform::WindowsWns => Err(ApiError::Internal(
                "windows_wns delivery path is not implemented yet.".to_string(),
            )),
            PushPlatform::WebPush => Err(ApiError::Internal(
                "web_push delivery path is not implemented yet.".to_string(),
            )),
        }
    }
}

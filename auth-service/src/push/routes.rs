use auth_framework::tokens::AuthToken;
use axum::{
    Json, Router,
    extract::State,
    routing::post,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::{ApiError, AppState, internal, require_valid_session};

use super::types::PushPlatform;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterDeviceRequest {
    session_token: AuthToken,
    platform: String,
    device_token: String,
    app_bundle_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UnregisterDeviceRequest {
    session_token: AuthToken,
    platform: String,
    device_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnqueuePushEventRequest {
    session_token: AuthToken,
    recipient_identity: String,
    event_type: String,
    title: String,
    body: String,
    payload: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PushDeliveryResponse {
    queued: bool,
    queue_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushTestRequest {
    session_token: AuthToken,
    title: String,
    body: String,
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/devices/register", post(register_device))
        .route("/devices/unregister", post(unregister_device))
        .route("/events/enqueue", post(enqueue_push_event))
        .route("/events/test", post(enqueue_test_push))
}

async fn register_device(
    State(state): State<AppState>,
    Json(request): Json<RegisterDeviceRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let username = require_valid_session(&state, &request.session_token).await?;
    let platform = PushPlatform::parse(&request.platform)?;
    let token = request.device_token.trim();
    if token.is_empty() {
        return Err(ApiError::BadRequest("deviceToken is required.".to_string()));
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO push_devices (id, username, platform, device_token, app_bundle_id, enabled)
        VALUES (?, ?, ?, ?, ?, 1)
        ON CONFLICT(platform, device_token) DO UPDATE SET
            username = excluded.username,
            app_bundle_id = excluded.app_bundle_id,
            enabled = 1,
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        "#,
    )
    .bind(id)
    .bind(username)
    .bind(platform.as_str())
    .bind(token)
    .bind(request.app_bundle_id.as_deref().map(str::trim))
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(json!({ "ok": true })))
}

async fn unregister_device(
    State(state): State<AppState>,
    Json(request): Json<UnregisterDeviceRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let username = require_valid_session(&state, &request.session_token).await?;
    let platform = PushPlatform::parse(&request.platform)?;
    let token = request.device_token.trim();
    if token.is_empty() {
        return Err(ApiError::BadRequest("deviceToken is required.".to_string()));
    }

    sqlx::query(
        r#"
        UPDATE push_devices
        SET enabled = 0, updated_at = CURRENT_TIMESTAMP
        WHERE username = ? AND platform = ? AND device_token = ?
        "#,
    )
    .bind(username)
    .bind(platform.as_str())
    .bind(token)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(json!({ "ok": true })))
}

async fn enqueue_push_event(
    State(state): State<AppState>,
    Json(request): Json<EnqueuePushEventRequest>,
) -> Result<Json<PushDeliveryResponse>, ApiError> {
    let sender_username = require_valid_session(&state, &request.session_token).await?;
    if request.recipient_identity.trim().is_empty() {
        return Err(ApiError::BadRequest("recipientIdentity is required.".to_string()));
    }
    if request.title.trim().is_empty() {
        return Err(ApiError::BadRequest("title is required.".to_string()));
    }
    if request.body.trim().is_empty() {
        return Err(ApiError::BadRequest("body is required.".to_string()));
    }
    if request.event_type.trim().is_empty() {
        return Err(ApiError::BadRequest("eventType is required.".to_string()));
    }

    let recipient_username = sqlx::query_scalar::<_, String>(
        "SELECT username FROM accounts WHERE lower(spacetime_identity) = lower(?)",
    )
    .bind(request.recipient_identity.trim())
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .ok_or_else(|| ApiError::BadRequest("recipientIdentity is not linked to any account.".to_string()))?;

    if recipient_username == sender_username {
        return Ok(Json(PushDeliveryResponse {
            queued: false,
            queue_id: None,
        }));
    }

    let queue_id = Uuid::new_v4().to_string();
    let payload_json = request
        .payload
        .and_then(|value| serde_json::to_string(&value).ok());
    sqlx::query(
        r#"
        INSERT INTO push_outbox (id, username, event_type, title, body, payload_json, status, attempt_count, next_attempt_unix)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, 0)
        "#,
    )
    .bind(&queue_id)
    .bind(recipient_username)
    .bind(request.event_type.trim())
    .bind(request.title.trim())
    .bind(request.body.trim())
    .bind(payload_json)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(PushDeliveryResponse {
        queued: true,
        queue_id: Some(queue_id),
    }))
}

async fn enqueue_test_push(
    State(state): State<AppState>,
    Json(request): Json<PushTestRequest>,
) -> Result<Json<PushDeliveryResponse>, ApiError> {
    let username = require_valid_session(&state, &request.session_token).await?;
    if request.title.trim().is_empty() || request.body.trim().is_empty() {
        return Err(ApiError::BadRequest("title and body are required.".to_string()));
    }

    let queue_id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO push_outbox (id, username, event_type, title, body, status, attempt_count, next_attempt_unix)
        VALUES (?, ?, 'test', ?, ?, 'pending', 0, 0)
        "#,
    )
    .bind(&queue_id)
    .bind(username)
    .bind(request.title.trim())
    .bind(request.body.trim())
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(Json(PushDeliveryResponse {
        queued: true,
        queue_id: Some(queue_id),
    }))
}

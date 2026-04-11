use axum::{Json, extract::State};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};

use crate::db::accounts as account_db;
use crate::{ApiError, AppState, internal};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LivekitTokenRequest {
    room: String,
    identity: String,
    session_token: auth_framework::tokens::AuthToken,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LivekitTokenResponse {
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LivekitVideoGrant {
    room_join: bool,
    room: String,
    can_publish: bool,
    can_subscribe: bool,
}

#[derive(Debug, Serialize)]
struct LivekitClaims {
    iss: String,
    sub: String,
    nbf: usize,
    exp: usize,
    video: LivekitVideoGrant,
}

pub(crate) async fn livekit_token(
    State(state): State<AppState>,
    Json(request): Json<LivekitTokenRequest>,
) -> Result<Json<LivekitTokenResponse>, ApiError> {
    if request.room.trim().is_empty() {
        return Err(ApiError::BadRequest("Room is required.".to_string()));
    }
    if request.identity.trim().is_empty() {
        return Err(ApiError::BadRequest("Identity is required.".to_string()));
    }

    let auth = state.auth.read().await;
    let valid = auth
        .validate_token(&request.session_token)
        .await
        .map_err(internal)?;
    if !valid {
        return Err(ApiError::Unauthorized("Invalid auth session.".to_string()));
    }
    drop(auth);

    let username = request.session_token.user_id.trim().to_lowercase();
    let account = account_db::find_by_username(&state.db, &username)
        .await
        .map_err(internal)?
        .ok_or_else(|| {
            ApiError::Unauthorized("Account not found for session token.".to_string())
        })?;

    if !account
        .spacetime_identity
        .trim()
        .eq_ignore_ascii_case(request.identity.trim())
    {
        return Err(ApiError::Unauthorized(
            "Session user does not match requested voice identity.".to_string(),
        ));
    }

    let api_key = std::env::var("LIVEKIT_API_KEY").unwrap_or_else(|_| "devkey".to_string());
    let api_secret = std::env::var("LIVEKIT_API_SECRET")
        .unwrap_or_else(|_| "devsecret0123456789devsecret0123456789".to_string());
    let now_secs = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(internal)?
        .as_secs()) as usize;

    let claims = LivekitClaims {
        iss: api_key,
        sub: request.identity.trim().to_string(),
        nbf: now_secs,
        exp: now_secs + 3600,
        video: LivekitVideoGrant {
            room_join: true,
            room: request.room.trim().to_string(),
            can_publish: true,
            can_subscribe: true,
        },
    };

    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(api_secret.as_bytes()),
    )
    .map_err(internal)?;

    Ok(Json(LivekitTokenResponse { token }))
}

use auth_framework::tokens::AuthToken;
use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};

use crate::db::accounts::{self as account_db, NewAccount};
use crate::security::{
    hash_password, normalize_username, validate_password, validate_username, verify_password,
};
use crate::session::{issue_session_token, require_valid_session};
use crate::{ApiError, AppState, db, internal};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterRequest {
    username: String,
    display_name: String,
    password: String,
    spacetime_token: String,
    spacetime_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkRequest {
    username: String,
    display_name: String,
    password: String,
    spacetime_token: String,
    spacetime_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyRequest {
    session_token: AuthToken,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenewSessionRequest {
    spacetime_token: String,
    spacetime_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RefreshSpacetimeTokenRequest {
    session_token: AuthToken,
    spacetime_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthResponse {
    username: String,
    display_name: String,
    spacetime_token: String,
    spacetime_identity: String,
    session_token: AuthToken,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifyResponse {
    valid: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenewSessionResponse {
    session_token: AuthToken,
}

pub(crate) async fn register(
    State(state): State<AppState>,
    Json(request): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let username = normalize_username(&request.username);
    validate_username(&username)?;
    validate_password(&request.password)?;
    if request.display_name.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Display name is required.".to_string(),
        ));
    }
    if request.spacetime_token.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Spacetime token is required.".to_string(),
        ));
    }
    if request.spacetime_identity.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Spacetime identity is required.".to_string(),
        ));
    }
    let spacetime_identity = request.spacetime_identity.trim();
    let spacetime_token = request.spacetime_token.trim();
    let display_name = request.display_name.trim();

    if account_db::find_by_username(&state.db, &username)
        .await
        .map_err(internal)?
        .is_some()
    {
        return Err(ApiError::Conflict("Username already exists.".to_string()));
    }
    if account_db::find_by_identity(&state.db, spacetime_identity)
        .await
        .map_err(internal)?
        .is_some()
    {
        return Err(ApiError::Conflict(
            "Spacetime identity is already linked to another account.".to_string(),
        ));
    }

    let password_hash = hash_password(&request.password).map_err(internal)?;
    account_db::insert_account(
        &state.db,
        &NewAccount {
            username: &username,
            display_name,
            password_hash: &password_hash,
            spacetime_token,
            spacetime_identity,
        },
    )
    .await
    .map_err(|error| {
        if db::is_unique_violation(&error) {
            ApiError::Conflict("Username or identity is already linked.".to_string())
        } else {
            internal(error)
        }
    })?;

    let session_token = issue_session_token(&state, &username).await?;

    Ok(Json(AuthResponse {
        username,
        display_name: display_name.to_string(),
        spacetime_token: spacetime_token.to_string(),
        spacetime_identity: spacetime_identity.to_string(),
        session_token,
    }))
}

pub(crate) async fn login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let username = normalize_username(&request.username);
    validate_username(&username)?;
    validate_password(&request.password)?;

    let account = account_db::find_by_username(&state.db, &username)
        .await
        .map_err(internal)?
        .ok_or_else(|| ApiError::Unauthorized("Invalid username or password.".to_string()))?;

    verify_password(&request.password, &account.password_hash)
        .map_err(|_| ApiError::Unauthorized("Invalid username or password.".to_string()))?;

    let session_token = issue_session_token(&state, &account.username).await?;

    Ok(Json(AuthResponse {
        username: account.username,
        display_name: account.display_name,
        spacetime_token: account.spacetime_token,
        spacetime_identity: account.spacetime_identity,
        session_token,
    }))
}

pub(crate) async fn link(
    State(state): State<AppState>,
    Json(request): Json<LinkRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let username = normalize_username(&request.username);
    validate_username(&username)?;
    validate_password(&request.password)?;
    if request.display_name.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Display name is required.".to_string(),
        ));
    }
    if request.spacetime_token.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Spacetime token is required.".to_string(),
        ));
    }
    if request.spacetime_identity.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "Spacetime identity is required.".to_string(),
        ));
    }
    let spacetime_identity = request.spacetime_identity.trim();
    let spacetime_token = request.spacetime_token.trim();
    let display_name = request.display_name.trim();

    let existing = account_db::find_by_username(&state.db, &username)
        .await
        .map_err(internal)?;

    let password_hash = hash_password(&request.password).map_err(internal)?;
    match existing {
        Some(account) => {
            if !account
                .spacetime_identity
                .trim()
                .eq_ignore_ascii_case(spacetime_identity)
            {
                return Err(ApiError::Conflict(
                    "Username is linked to a different Spacetime identity.".to_string(),
                ));
            }
            account_db::update_linked_credentials(
                &state.db,
                &username,
                display_name,
                &password_hash,
                spacetime_token,
            )
            .await
            .map_err(internal)?;
        }
        None => {
            if account_db::find_by_identity(&state.db, spacetime_identity)
                .await
                .map_err(internal)?
                .is_some()
            {
                return Err(ApiError::Conflict(
                    "Spacetime identity is already linked to another account.".to_string(),
                ));
            }

            account_db::insert_account(
                &state.db,
                &NewAccount {
                    username: &username,
                    display_name,
                    password_hash: &password_hash,
                    spacetime_token,
                    spacetime_identity,
                },
            )
            .await
            .map_err(|error| {
                if db::is_unique_violation(&error) {
                    ApiError::Conflict("Username or identity is already linked.".to_string())
                } else {
                    internal(error)
                }
            })?;
        }
    }

    let session_token = issue_session_token(&state, &username).await?;
    Ok(Json(AuthResponse {
        username,
        display_name: display_name.to_string(),
        spacetime_token: spacetime_token.to_string(),
        spacetime_identity: spacetime_identity.to_string(),
        session_token,
    }))
}

pub(crate) async fn verify(
    State(state): State<AppState>,
    Json(request): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    let auth = state.auth.read().await;
    let valid = auth
        .validate_token(&request.session_token)
        .await
        .map_err(internal)?;
    Ok(Json(VerifyResponse { valid }))
}

pub(crate) async fn renew_session(
    State(state): State<AppState>,
    Json(request): Json<RenewSessionRequest>,
) -> Result<Json<RenewSessionResponse>, ApiError> {
    let spacetime_token = request.spacetime_token.trim();
    let spacetime_identity = request.spacetime_identity.trim();
    if spacetime_token.is_empty() {
        return Err(ApiError::BadRequest(
            "Spacetime token is required.".to_string(),
        ));
    }
    if spacetime_identity.is_empty() {
        return Err(ApiError::BadRequest(
            "Spacetime identity is required.".to_string(),
        ));
    }

    let account =
        account_db::find_by_token_and_identity(&state.db, spacetime_token, spacetime_identity)
            .await
            .map_err(internal)?
            .ok_or_else(|| {
                ApiError::Unauthorized("Could not renew session for this account.".to_string())
            })?;

    let session_token = issue_session_token(&state, &account.username).await?;
    Ok(Json(RenewSessionResponse { session_token }))
}

pub(crate) async fn refresh_spacetime_token(
    State(state): State<AppState>,
    Json(request): Json<RefreshSpacetimeTokenRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let username = require_valid_session(&state, &request.session_token).await?;
    if request.spacetime_token.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "spacetimeToken is required.".to_string(),
        ));
    }
    account_db::update_spacetime_token(&state.db, &username, request.spacetime_token.trim())
        .await
        .map_err(internal)?;
    Ok(Json(serde_json::json!({})))
}

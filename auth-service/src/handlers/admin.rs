use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};

use crate::db::accounts as account_db;
use crate::security::{normalize_username, validate_username};
use crate::{ApiError, AppState, db, internal};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminRebindAccountRequest {
    admin_api_key: String,
    username: String,
    spacetime_identity: String,
    spacetime_token: Option<String>,
    display_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminRebindAccountResponse {
    username: String,
    spacetime_identity: String,
}

pub(crate) async fn admin_rebind_account(
    State(state): State<AppState>,
    Json(request): Json<AdminRebindAccountRequest>,
) -> Result<Json<AdminRebindAccountResponse>, ApiError> {
    let configured_key = state
        .admin_api_key
        .as_deref()
        .ok_or_else(|| ApiError::Unauthorized("Admin rebind endpoint is disabled.".to_string()))?;

    if request.admin_api_key.trim() != configured_key {
        return Err(ApiError::Unauthorized("Invalid admin API key.".to_string()));
    }

    let username = normalize_username(&request.username);
    validate_username(&username)?;

    let spacetime_identity = request.spacetime_identity.trim();
    if spacetime_identity.is_empty() {
        return Err(ApiError::BadRequest(
            "Spacetime identity is required.".to_string(),
        ));
    }

    let display_name = request
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let spacetime_token = request
        .spacetime_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let rows_affected = account_db::admin_rebind_identity(
        &state.db,
        &username,
        display_name,
        spacetime_token,
        spacetime_identity,
    )
    .await
    .map_err(|error| {
        if db::is_unique_violation(&error) {
            ApiError::Conflict("Target identity is already linked to another account.".to_string())
        } else {
            internal(error)
        }
    })?;

    if rows_affected == 0 {
        return Err(ApiError::BadRequest(
            "Account username was not found.".to_string(),
        ));
    }

    Ok(Json(AdminRebindAccountResponse {
        username,
        spacetime_identity: spacetime_identity.to_string(),
    }))
}

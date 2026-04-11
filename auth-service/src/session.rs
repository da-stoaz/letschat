use auth_framework::tokens::AuthToken;

use crate::{ApiError, AppState, internal};

pub(crate) async fn issue_session_token(
    state: &AppState,
    username: &str,
) -> Result<AuthToken, ApiError> {
    let auth = state.auth.write().await;
    auth.create_auth_token(
        username,
        vec!["chat:use".to_string(), "chat:voice".to_string()],
        "jwt",
        None,
    )
    .await
    .map_err(internal)
}

/// Validates the session token and returns the lowercase username, or
/// `Unauthorized`. Shared with the `uploads` module.
pub(crate) async fn require_valid_session(
    state: &AppState,
    token: &auth_framework::tokens::AuthToken,
) -> Result<String, ApiError> {
    let auth = state.auth.read().await;
    let valid = auth.validate_token(token).await.map_err(internal)?;
    if !valid {
        return Err(ApiError::Unauthorized(
            "Invalid or expired session token.".to_string(),
        ));
    }
    Ok(token.user_id.trim().to_lowercase())
}

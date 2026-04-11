mod db;
mod uploads;

use std::{net::SocketAddr, str::FromStr, sync::Arc, time::Duration};

use anyhow::Context;
use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use auth_framework::{
    AuthConfig, AuthFramework,
    methods::{AuthMethodEnum, JwtMethod},
    tokens::AuthToken,
};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use thiserror::Error;
use tokio::sync::RwLock;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::Level;

use crate::db::accounts::{self as account_db, NewAccount};
use crate::db::uploads as upload_db;

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
    auth: Arc<RwLock<AuthFramework>>,
    uploads: uploads::UploadConfig,
    admin_api_key: Option<String>,
}

#[derive(Debug, Error)]
enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let body = Json(ErrorBody {
            error: self.to_string(),
        });
        (status, body).into_response()
    }
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegisterRequest {
    username: String,
    display_name: String,
    password: String,
    spacetime_token: String,
    spacetime_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkRequest {
    username: String,
    display_name: String,
    password: String,
    spacetime_token: String,
    spacetime_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginRequest {
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyRequest {
    session_token: AuthToken,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenewSessionRequest {
    spacetime_token: String,
    spacetime_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LivekitTokenRequest {
    room: String,
    identity: String,
    session_token: AuthToken,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminRebindAccountRequest {
    admin_api_key: String,
    username: String,
    spacetime_identity: String,
    spacetime_token: Option<String>,
    display_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthResponse {
    username: String,
    display_name: String,
    spacetime_token: String,
    spacetime_identity: String,
    session_token: AuthToken,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyResponse {
    valid: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenewSessionResponse {
    session_token: AuthToken,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LivekitTokenResponse {
    token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AdminRebindAccountResponse {
    username: String,
    spacetime_identity: String,
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env.dev when APP_ENV=dev, .env otherwise.
    // In Docker the file won't exist and this silently no-ops.
    match std::env::var("APP_ENV").as_deref() {
        Ok("dev") => {
            dotenvy::from_filename(".env.development").ok();
        }
        _ => {
            dotenvy::dotenv().ok();
        }
    }

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_max_level(Level::INFO)
        .init();

    let database_url = std::env::var("AUTH_DATABASE_URL")
        .unwrap_or_else(|_| "sqlite://auth-service/auth.db".to_string());
    let bind = std::env::var("AUTH_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    let jwt_secret = std::env::var("AUTH_JWT_SECRET")
        .unwrap_or_else(|_| "w7Qk9R2mN5xH3cV8pL4tJ6dF1sA0zB7uY2gE5nK8qM3rT9hC".to_string());
    let admin_api_key = std::env::var("AUTH_ADMIN_API_KEY")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    // MinIO / S3
    let minio_access_key =
        std::env::var("MINIO_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".to_string());
    let minio_secret_key =
        std::env::var("MINIO_SECRET_KEY").unwrap_or_else(|_| "minioadmin".to_string());
    let minio_bucket =
        std::env::var("MINIO_BUCKET").unwrap_or_else(|_| "letschat-files".to_string());
    let minio_internal_endpoint = std::env::var("MINIO_INTERNAL_ENDPOINT")
        .unwrap_or_else(|_| "http://127.0.0.1:9000".to_string());
    // Public endpoint is what gets baked into presigned URLs that clients use.
    let minio_public_endpoint =
        std::env::var("MINIO_PUBLIC_ENDPOINT").unwrap_or_else(|_| minio_internal_endpoint.clone());

    ensure_sqlite_parent_exists(&database_url)
        .context("failed to prepare SQLite parent directory")?;

    let connect_options = SqliteConnectOptions::from_str(&database_url)
        .with_context(|| format!("invalid sqlite connection string: {database_url}"))?
        .create_if_missing(true);

    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .with_context(|| format!("failed to connect to sqlite at {database_url}"))?;

    db::run_migrations(&db).await?;
    account_db::ensure_schema_invariants(&db).await?;

    // Purge stale pending_uploads left from previous runs.
    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    upload_db::delete_expired_pending_uploads(&db, now_unix)
        .await
        .context("failed to clean up expired pending uploads")?;

    let config = AuthConfig::new()
        .secret(jwt_secret.clone())
        .token_lifetime(Duration::from_secs(60 * 60))
        .refresh_token_lifetime(Duration::from_secs(60 * 60 * 24 * 7));
    let mut auth = AuthFramework::new(config);
    let jwt_method = JwtMethod::new()
        .secret_key(&jwt_secret)
        .issuer("letschat-auth");
    auth.register_method("jwt", AuthMethodEnum::Jwt(jwt_method));
    auth.initialize()
        .await
        .map_err(|e| anyhow::anyhow!("failed to initialize auth-framework: {e}"))?;

    let upload_config = uploads::UploadConfig::new(
        &minio_access_key,
        &minio_secret_key,
        &minio_bucket,
        &minio_internal_endpoint,
        &minio_public_endpoint,
    )
    .context("failed to initialise MinIO client")?;
    tracing::info!(
        internal = %minio_internal_endpoint,
        public = %minio_public_endpoint,
        bucket = %minio_bucket,
        "MinIO configured",
    );

    let state = AppState {
        db,
        auth: Arc::new(RwLock::new(auth)),
        uploads: upload_config,
        admin_api_key,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(register))
        .route("/auth/link", post(link))
        .route("/auth/login", post(login))
        .route("/auth/verify", post(verify))
        .route("/auth/renew-session", post(renew_session))
        .route("/admin/accounts/rebind", post(admin_rebind_account))
        .route("/livekit/token", post(livekit_token))
        // File uploads
        .route(
            "/auth/refresh-spacetime-token",
            post(refresh_spacetime_token),
        )
        .route("/uploads/request", post(uploads::upload_request))
        .route("/uploads/confirm", post(uploads::upload_confirm))
        .route("/uploads/download-url", post(uploads::download_url))
        .route("/uploads/download-urls", post(uploads::download_urls))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let addr: SocketAddr = bind
        .parse()
        .with_context(|| format!("invalid AUTH_BIND address: {bind}"))?;
    tracing::info!("auth-service listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .context("failed to bind tcp listener")?;
    axum::serve(listener, app)
        .await
        .context("auth-service server failed")?;

    Ok(())
}

fn ensure_sqlite_parent_exists(database_url: &str) -> anyhow::Result<()> {
    if !database_url.starts_with("sqlite://") {
        return Ok(());
    }
    let path = database_url.trim_start_matches("sqlite://");
    let parent = std::path::Path::new(path).parent();
    if let Some(dir) = parent {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir)?;
        }
    }
    Ok(())
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

async fn register(
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

async fn login(
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

async fn link(
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

async fn verify(
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

async fn renew_session(
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

async fn admin_rebind_account(
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

async fn livekit_token(
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

async fn issue_session_token(state: &AppState, username: &str) -> Result<AuthToken, ApiError> {
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

fn validate_username(username: &str) -> Result<(), ApiError> {
    let valid_len = (2..=32).contains(&username.len());
    let valid_chars = username
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '_');
    if !valid_len || !valid_chars {
        return Err(ApiError::BadRequest(
            "Username must be 2-32 characters using [a-z0-9_] only.".to_string(),
        ));
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), ApiError> {
    if password.len() < 8 {
        return Err(ApiError::BadRequest(
            "Password must be at least 8 characters.".to_string(),
        ));
    }
    Ok(())
}

fn normalize_username(username: &str) -> String {
    username.trim().to_lowercase()
}

fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .context("failed to hash password")?
        .to_string();
    Ok(hash)
}

fn verify_password(password: &str, hash: &str) -> anyhow::Result<()> {
    let parsed_hash = PasswordHash::new(hash).context("invalid password hash")?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .context("password verification failed")
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RefreshSpacetimeTokenRequest {
    session_token: AuthToken,
    spacetime_token: String,
}

async fn refresh_spacetime_token(
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

pub(crate) fn internal(error: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(error.to_string())
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

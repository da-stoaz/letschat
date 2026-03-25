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
use serde::{Deserialize, Serialize};
use sqlx::{
    FromRow, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};
use thiserror::Error;
use tokio::sync::Mutex;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::Level;

#[derive(Clone)]
struct AppState {
    db: SqlitePool,
    auth: Arc<Mutex<AuthFramework>>,
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

#[derive(Debug, FromRow)]
struct AccountRow {
    username: String,
    display_name: String,
    password_hash: String,
    spacetime_token: String,
    spacetime_identity: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_max_level(Level::INFO)
        .init();

    let database_url =
        std::env::var("AUTH_DATABASE_URL").unwrap_or_else(|_| "sqlite://auth-service/auth.db".to_string());
    let bind = std::env::var("AUTH_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
    let jwt_secret = std::env::var("AUTH_JWT_SECRET")
        .unwrap_or_else(|_| "w7Qk9R2mN5xH3cV8pL4tJ6dF1sA0zB7uY2gE5nK8qM3rT9hC".to_string());

    ensure_sqlite_parent_exists(&database_url).context("failed to prepare SQLite parent directory")?;

    let connect_options = SqliteConnectOptions::from_str(&database_url)
        .with_context(|| format!("invalid sqlite connection string: {database_url}"))?
        .create_if_missing(true);

    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .with_context(|| format!("failed to connect to sqlite at {database_url}"))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS accounts (
            username TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            spacetime_token TEXT NOT NULL,
            spacetime_identity TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )
    .execute(&db)
    .await
    .context("failed to create accounts table")?;

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

    let state = AppState {
        db,
        auth: Arc::new(Mutex::new(auth)),
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/auth/register", post(register))
        .route("/auth/link", post(link))
        .route("/auth/login", post(login))
        .route("/auth/verify", post(verify))
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
        return Err(ApiError::BadRequest("Display name is required.".to_string()));
    }
    if request.spacetime_token.trim().is_empty() {
        return Err(ApiError::BadRequest("Spacetime token is required.".to_string()));
    }
    if request.spacetime_identity.trim().is_empty() {
        return Err(ApiError::BadRequest("Spacetime identity is required.".to_string()));
    }

    let existing = sqlx::query_scalar::<_, String>("SELECT username FROM accounts WHERE username = ?")
        .bind(&username)
        .fetch_optional(&state.db)
        .await
        .map_err(internal)?;
    if existing.is_some() {
        return Err(ApiError::Conflict("Username already exists.".to_string()));
    }

    let password_hash = hash_password(&request.password).map_err(internal)?;
    sqlx::query(
        r#"
        INSERT INTO accounts (username, display_name, password_hash, spacetime_token, spacetime_identity)
        VALUES (?, ?, ?, ?, ?)
        "#,
    )
    .bind(&username)
    .bind(request.display_name.trim())
    .bind(password_hash)
    .bind(request.spacetime_token.trim())
    .bind(request.spacetime_identity.trim())
    .execute(&state.db)
    .await
    .map_err(internal)?;

    let session_token = issue_session_token(&state, &username).await?;

    Ok(Json(AuthResponse {
        username,
        display_name: request.display_name.trim().to_string(),
        spacetime_token: request.spacetime_token.trim().to_string(),
        spacetime_identity: request.spacetime_identity.trim().to_string(),
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

    let account = sqlx::query_as::<_, AccountRow>(
        "SELECT username, display_name, password_hash, spacetime_token, spacetime_identity FROM accounts WHERE username = ?",
    )
    .bind(&username)
    .fetch_optional(&state.db)
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
        return Err(ApiError::BadRequest("Display name is required.".to_string()));
    }
    if request.spacetime_token.trim().is_empty() {
        return Err(ApiError::BadRequest("Spacetime token is required.".to_string()));
    }
    if request.spacetime_identity.trim().is_empty() {
        return Err(ApiError::BadRequest("Spacetime identity is required.".to_string()));
    }

    let existing = sqlx::query_as::<_, AccountRow>(
        "SELECT username, display_name, password_hash, spacetime_token, spacetime_identity FROM accounts WHERE username = ?",
    )
    .bind(&username)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?;

    let password_hash = hash_password(&request.password).map_err(internal)?;
    match existing {
        Some(account) => {
            if account.spacetime_identity != request.spacetime_identity.trim() {
                return Err(ApiError::Conflict(
                    "Username is linked to a different Spacetime identity.".to_string(),
                ));
            }
            sqlx::query(
                r#"
                UPDATE accounts
                SET display_name = ?, password_hash = ?, spacetime_token = ?, updated_at = CURRENT_TIMESTAMP
                WHERE username = ?
                "#,
            )
            .bind(request.display_name.trim())
            .bind(password_hash)
            .bind(request.spacetime_token.trim())
            .bind(&username)
            .execute(&state.db)
            .await
            .map_err(internal)?;
        }
        None => {
            sqlx::query(
                r#"
                INSERT INTO accounts (username, display_name, password_hash, spacetime_token, spacetime_identity)
                VALUES (?, ?, ?, ?, ?)
                "#,
            )
            .bind(&username)
            .bind(request.display_name.trim())
            .bind(password_hash)
            .bind(request.spacetime_token.trim())
            .bind(request.spacetime_identity.trim())
            .execute(&state.db)
            .await
            .map_err(internal)?;
        }
    }

    let session_token = issue_session_token(&state, &username).await?;
    Ok(Json(AuthResponse {
        username,
        display_name: request.display_name.trim().to_string(),
        spacetime_token: request.spacetime_token.trim().to_string(),
        spacetime_identity: request.spacetime_identity.trim().to_string(),
        session_token,
    }))
}

async fn verify(
    State(state): State<AppState>,
    Json(request): Json<VerifyRequest>,
) -> Result<Json<VerifyResponse>, ApiError> {
    let auth = state.auth.lock().await;
    let valid = auth
        .validate_token(&request.session_token)
        .await
        .map_err(internal)?;
    Ok(Json(VerifyResponse { valid }))
}

async fn issue_session_token(state: &AppState, username: &str) -> Result<AuthToken, ApiError> {
    let auth = state.auth.lock().await;
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

fn internal(error: impl std::fmt::Display) -> ApiError {
    ApiError::Internal(error.to_string())
}

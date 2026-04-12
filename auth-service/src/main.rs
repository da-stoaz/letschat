mod config;
mod db;
mod errors;
mod handlers;
mod security;
mod session;
mod state;
mod uploads;

use std::{net::SocketAddr, str::FromStr, sync::Arc, time::Duration};

use anyhow::Context;
use auth_framework::{
    AuthConfig, AuthFramework,
    methods::{AuthMethodEnum, JwtMethod},
};
use axum::{
    Router,
    routing::{get, post},
};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use tokio::sync::RwLock;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::Level;

use crate::config::{ServiceConfig, ensure_sqlite_parent_exists, load_env_file};
use crate::db::accounts as account_db;
use crate::db::uploads as upload_db;

pub(crate) use crate::errors::{ApiError, internal};
pub(crate) use crate::session::require_valid_session;
pub(crate) use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    load_env_file();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_max_level(Level::INFO)
        .init();

    let config = ServiceConfig::from_env();

    ensure_sqlite_parent_exists(&config.database_url)
        .context("failed to prepare SQLite parent directory")?;

    let connect_options = SqliteConnectOptions::from_str(&config.database_url)
        .with_context(|| format!("invalid sqlite connection string: {}", config.database_url))?
        .create_if_missing(true);

    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .with_context(|| format!("failed to connect to sqlite at {}", config.database_url))?;

    db::run_migrations(&db).await?;
    account_db::ensure_schema_invariants(&db).await?;

    let now_unix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    upload_db::delete_expired_pending_uploads(&db, now_unix)
        .await
        .context("failed to clean up expired pending uploads")?;

    let auth = build_auth_framework(&config.jwt_secret).await?;

    let upload_config = uploads::UploadConfig::new(
        &config.minio_access_key,
        &config.minio_secret_key,
        &config.minio_bucket,
        &config.minio_internal_endpoint,
        &config.minio_public_endpoint,
    )
    .context("failed to initialise MinIO client")?;
    tracing::info!(
        internal = %config.minio_internal_endpoint,
        public = %config.minio_public_endpoint,
        bucket = %config.minio_bucket,
        "MinIO configured",
    );

    let state = AppState {
        db,
        auth: Arc::new(RwLock::new(auth)),
        uploads: upload_config,
        admin_api_key: config.admin_api_key,
    };

    let app = Router::new()
        .route("/health", get(handlers::health::health))
        .route("/auth/register", post(handlers::auth::register))
        .route("/auth/link", post(handlers::auth::link))
        .route("/auth/login", post(handlers::auth::login))
        .route("/auth/verify", post(handlers::auth::verify))
        .route("/auth/renew-session", post(handlers::auth::renew_session))
        .route(
            "/admin/accounts/rebind",
            post(handlers::admin::admin_rebind_account),
        )
        .route("/livekit/token", post(handlers::livekit::livekit_token))
        .route(
            "/auth/refresh-spacetime-token",
            post(handlers::auth::refresh_spacetime_token),
        )
        .route("/uploads/request", post(uploads::upload_request))
        .route("/uploads/confirm", post(uploads::upload_confirm))
        .route("/uploads/download-url", post(uploads::download_url))
        .route("/uploads/download-urls", post(uploads::download_urls))
        .with_state(state)
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http());

    let addr: SocketAddr = config
        .bind
        .parse()
        .with_context(|| format!("invalid AUTH_BIND address: {}", config.bind))?;
    tracing::info!("auth-service listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .context("failed to bind tcp listener")?;
    axum::serve(listener, app)
        .await
        .context("auth-service server failed")?;

    Ok(())
}

async fn build_auth_framework(jwt_secret: &str) -> anyhow::Result<AuthFramework> {
    let config = AuthConfig::new()
        .secret(jwt_secret.to_string())
        .token_lifetime(Duration::from_secs(60 * 60))
        .refresh_token_lifetime(Duration::from_secs(60 * 60 * 24 * 7));

    let mut auth = AuthFramework::new(config);
    let jwt_method = JwtMethod::new()
        .secret_key(jwt_secret)
        .issuer("letschat-auth");
    auth.register_method("jwt", AuthMethodEnum::Jwt(jwt_method));
    auth.initialize()
        .await
        .map_err(|error| anyhow::anyhow!("failed to initialize auth-framework: {error}"))?;

    Ok(auth)
}

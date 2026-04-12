#[derive(Debug, Clone)]
pub(crate) struct ServiceConfig {
    pub(crate) database_url: String,
    pub(crate) bind: String,
    pub(crate) jwt_secret: String,
    pub(crate) admin_api_key: Option<String>,
    pub(crate) minio_access_key: String,
    pub(crate) minio_secret_key: String,
    pub(crate) minio_bucket: String,
    pub(crate) minio_internal_endpoint: String,
    pub(crate) minio_public_endpoint: String,
}

impl ServiceConfig {
    pub(crate) fn from_env() -> Self {
        let database_url = std::env::var("AUTH_DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://auth-service/auth.db".to_string());
        let bind = std::env::var("AUTH_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_string());
        let jwt_secret = std::env::var("AUTH_JWT_SECRET")
            .unwrap_or_else(|_| "w7Qk9R2mN5xH3cV8pL4tJ6dF1sA0zB7uY2gE5nK8qM3rT9hC".to_string());
        let admin_api_key = std::env::var("AUTH_ADMIN_API_KEY")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        let minio_access_key =
            std::env::var("MINIO_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".to_string());
        let minio_secret_key =
            std::env::var("MINIO_SECRET_KEY").unwrap_or_else(|_| "minioadmin".to_string());
        let minio_bucket =
            std::env::var("MINIO_BUCKET").unwrap_or_else(|_| "letschat-files".to_string());
        let minio_internal_endpoint = std::env::var("MINIO_INTERNAL_ENDPOINT")
            .unwrap_or_else(|_| "http://127.0.0.1:9000".to_string());
        let minio_public_endpoint = std::env::var("MINIO_PUBLIC_ENDPOINT")
            .unwrap_or_else(|_| minio_internal_endpoint.clone());

        Self {
            database_url,
            bind,
            jwt_secret,
            admin_api_key,
            minio_access_key,
            minio_secret_key,
            minio_bucket,
            minio_internal_endpoint,
            minio_public_endpoint,
        }
    }
}

pub(crate) fn load_env_file() {
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
}

pub(crate) fn ensure_sqlite_parent_exists(database_url: &str) -> anyhow::Result<()> {
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

use std::sync::Arc;

use auth_framework::AuthFramework;
use sqlx::SqlitePool;
use tokio::sync::RwLock;

use crate::uploads;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) db: SqlitePool,
    pub(crate) auth: Arc<RwLock<AuthFramework>>,
    pub(crate) uploads: uploads::UploadConfig,
    pub(crate) admin_api_key: Option<String>,
    pub(crate) discovery_spacetimedb_uri: String,
    pub(crate) discovery_auth_url: String,
    pub(crate) discovery_livekit_url: String,
    pub(crate) discovery_database: String,
}

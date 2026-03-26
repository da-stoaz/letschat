use axum::{Json, extract::State};
use chrono::Utc;
use s3::{Bucket, Region, creds::Credentials as S3Credentials};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{AppState, ApiError, internal, require_valid_session};

// ─── Limits ──────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500 MB
const DAILY_QUOTA: u64 = 2 * 1024 * 1024 * 1024; // 2 GB per user per day
const PRESIGN_UPLOAD_SECS: u32 = 600; // 10 min to complete the PUT
const PRESIGN_DOWNLOAD_SECS: u32 = 3600; // 1 h download link lifetime
const PENDING_UPLOAD_TTL_SECS: u64 = 900; // 15 min to call /confirm

/// MIME type prefixes that are never permitted.
const BLOCKED_MIME_PREFIXES: &[&str] = &[
    "application/x-msdownload",
    "application/x-executable",
    "application/x-sh",
    "application/x-bat",
    "application/x-msdos-program",
    "application/x-dosexec",
];

// ─── S3 config bundle ─────────────────────────────────────────────────────────

/// Holds two bucket handles:
/// - `internal` is pointed at the Docker-network MinIO address (used for
///   `HEAD` object verification; never leaves the server).
/// - `presign` is pointed at the *public* MinIO address (the URL baked into
///   presigned PUT/GET links that clients use directly).
// rust-s3 0.34: with_path_style() returns Bucket, not Box<Bucket>.
#[derive(Clone)]
pub struct UploadConfig {
    pub bucket_internal: Bucket,
    pub bucket_presign: Bucket,
}

impl UploadConfig {
    pub fn new(
        access_key: &str,
        secret_key: &str,
        bucket_name: &str,
        internal_endpoint: &str,
        public_endpoint: &str,
    ) -> anyhow::Result<Self> {
        use anyhow::Context;

        let creds_internal =
            S3Credentials::new(Some(access_key), Some(secret_key), None, None, None)
                .context("failed to build S3 credentials (internal)")?;
        let creds_presign =
            S3Credentials::new(Some(access_key), Some(secret_key), None, None, None)
                .context("failed to build S3 credentials (presign)")?;

        let region_internal = Region::Custom {
            region: "us-east-1".to_string(),
            endpoint: internal_endpoint.to_string(),
        };
        let region_presign = Region::Custom {
            region: "us-east-1".to_string(),
            endpoint: public_endpoint.to_string(),
        };

        let bucket_internal = Bucket::new(bucket_name, region_internal, creds_internal)
            .context("failed to create internal S3 bucket handle")?
            .with_path_style();

        let bucket_presign = Bucket::new(bucket_name, region_presign, creds_presign)
            .context("failed to create presign S3 bucket handle")?
            .with_path_style();

        Ok(Self {
            bucket_internal,
            bucket_presign,
        })
    }
    // Bucket creation is handled by the MinIO init container in docker-compose.prod.yml.
    // No runtime bucket creation needed here.
}

// ─── Request / response types ─────────────────────────────────────────────────

use auth_framework::tokens::AuthToken;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequestPayload {
    pub session_token: AuthToken,
    pub file_name: String,
    /// Declared byte size. Must match what the client PUTs.
    pub file_size: u64,
    pub mime_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequestResponse {
    pub upload_id: String,
    /// Presigned PUT URL — client uploads directly here, no proxy.
    pub upload_url: String,
    pub expires_in: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadConfirmPayload {
    pub session_token: AuthToken,
    pub upload_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadConfirmResponse {
    /// Opaque key to store in the SpacetimeDB `Attachment` table.
    pub storage_key: String,
    pub file_name: String,
    pub file_size: u64,
    pub mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadUrlPayload {
    pub session_token: AuthToken,
    pub storage_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadUrlResponse {
    /// Short-lived presigned GET URL — use as `<img src>`, `<video src>`, or `<a href>`.
    pub url: String,
    pub expires_in: u32,
}

// ─── Internal DB row ──────────────────────────────────────────────────────────

#[derive(Debug, FromRow)]
struct PendingUploadRow {
    username: String,
    storage_key: String,
    file_name: String,
    file_size: i64,
    mime_type: String,
    expires_at: i64,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/// **Step 1** — client requests a presigned PUT URL.
///
/// Validates quota and MIME type, records a pending upload, and returns a
/// short-lived URL the client must PUT the raw file bytes to directly
/// (no proxy through this server — MinIO handles the transfer).
pub async fn upload_request(
    State(state): State<AppState>,
    Json(payload): Json<UploadRequestPayload>,
) -> Result<Json<UploadRequestResponse>, ApiError> {
    let username = require_valid_session(&state, &payload.session_token).await?;

    // Validate file name.
    let file_name = payload.file_name.trim().to_string();
    if file_name.is_empty() {
        return Err(ApiError::BadRequest("file_name is required.".to_string()));
    }
    if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
        return Err(ApiError::BadRequest("file_name contains invalid characters.".to_string()));
    }

    // Validate size.
    if payload.file_size == 0 {
        return Err(ApiError::BadRequest("file_size must be greater than 0.".to_string()));
    }
    if payload.file_size > MAX_FILE_SIZE {
        return Err(ApiError::BadRequest(format!(
            "File exceeds the maximum allowed size of {} MB.",
            MAX_FILE_SIZE / 1024 / 1024
        )));
    }

    // Validate MIME type.
    let mime_type = payload.mime_type.trim().to_lowercase();
    if mime_type.is_empty() {
        return Err(ApiError::BadRequest("mime_type is required.".to_string()));
    }
    for blocked in BLOCKED_MIME_PREFIXES {
        if mime_type.starts_with(blocked) {
            return Err(ApiError::BadRequest("This file type is not allowed.".to_string()));
        }
    }

    // Check daily quota.
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let used_today: i64 = sqlx::query_scalar(
        "SELECT COALESCE(bytes_uploaded, 0) FROM upload_quota WHERE username = ? AND quota_date = ?",
    )
    .bind(&username)
    .bind(&today)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .unwrap_or(0);

    if (used_today as u64).saturating_add(payload.file_size) > DAILY_QUOTA {
        return Err(ApiError::BadRequest(format!(
            "Daily upload quota of {} GB exceeded.",
            DAILY_QUOTA / 1024 / 1024 / 1024
        )));
    }

    // Build a unique storage key: uploads/YYYY/MM/DD/<username>/<uuid>[.<ext>]
    let upload_id = Uuid::new_v4().to_string();
    let ext = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let date_path = Utc::now().format("%Y/%m/%d").to_string();
    let storage_key = if ext.is_empty() {
        format!("uploads/{date_path}/{username}/{upload_id}")
    } else {
        format!("uploads/{date_path}/{username}/{upload_id}.{ext}")
    };

    // Generate presigned PUT URL (client POSTs/PUTs directly to MinIO).
    let s3_path = format!("/{storage_key}");
    let upload_url = state
        .uploads
        .bucket_presign
        .presign_put(&s3_path, PRESIGN_UPLOAD_SECS, None)
        .await
        .map_err(|e| ApiError::Internal(format!("Failed to generate upload URL: {e}")))?;

    // Persist pending record so /confirm can look it up.
    let expires_at = (unix_now_secs() + PENDING_UPLOAD_TTL_SECS) as i64;
    sqlx::query(
        "INSERT INTO pending_uploads (id, username, storage_key, file_name, file_size, mime_type, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&upload_id)
    .bind(&username)
    .bind(&storage_key)
    .bind(&file_name)
    .bind(payload.file_size as i64)
    .bind(&mime_type)
    .bind(expires_at)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    tracing::info!(username, upload_id, storage_key, "Upload requested");

    Ok(Json(UploadRequestResponse {
        upload_id,
        upload_url,
        expires_in: PRESIGN_UPLOAD_SECS,
    }))
}

/// **Step 2** — client calls this after the PUT to MinIO succeeds.
///
/// Verifies the object actually landed in MinIO, updates the daily quota,
/// and returns the metadata the client should store in SpacetimeDB.
pub async fn upload_confirm(
    State(state): State<AppState>,
    Json(payload): Json<UploadConfirmPayload>,
) -> Result<Json<UploadConfirmResponse>, ApiError> {
    let username = require_valid_session(&state, &payload.session_token).await?;

    // Load pending record.
    let pending = sqlx::query_as::<_, PendingUploadRow>(
        "SELECT username, storage_key, file_name, file_size, mime_type, expires_at
         FROM pending_uploads WHERE id = ?",
    )
    .bind(&payload.upload_id)
    .fetch_optional(&state.db)
    .await
    .map_err(internal)?
    .ok_or_else(|| ApiError::BadRequest("Upload ID not found or already confirmed.".to_string()))?;

    if pending.username != username {
        return Err(ApiError::Unauthorized("Upload does not belong to this session.".to_string()));
    }
    if pending.expires_at < unix_now_secs() as i64 {
        // Clean up the stale row, then tell the client.
        let _ = sqlx::query("DELETE FROM pending_uploads WHERE id = ?")
            .bind(&payload.upload_id)
            .execute(&state.db)
            .await;
        return Err(ApiError::BadRequest(
            "Upload session expired. Please start over.".to_string(),
        ));
    }

    // Verify the object exists in MinIO via the internal (Docker-network) endpoint.
    let s3_path = format!("/{}", pending.storage_key);
    verify_object_exists(&state.uploads.bucket_internal, &s3_path).await?;

    // Update daily quota.
    let today = Utc::now().format("%Y-%m-%d").to_string();
    sqlx::query(
        "INSERT INTO upload_quota (username, quota_date, bytes_uploaded)
         VALUES (?, ?, ?)
         ON CONFLICT (username, quota_date)
         DO UPDATE SET bytes_uploaded = bytes_uploaded + excluded.bytes_uploaded",
    )
    .bind(&username)
    .bind(&today)
    .bind(pending.file_size)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    // Delete the pending record — it has been confirmed.
    sqlx::query("DELETE FROM pending_uploads WHERE id = ?")
        .bind(&payload.upload_id)
        .execute(&state.db)
        .await
        .map_err(internal)?;

    tracing::info!(
        username,
        storage_key = pending.storage_key,
        file_name = pending.file_name,
        bytes = pending.file_size,
        "Upload confirmed",
    );

    Ok(Json(UploadConfirmResponse {
        storage_key: pending.storage_key,
        file_name: pending.file_name,
        file_size: pending.file_size as u64,
        mime_type: pending.mime_type,
    }))
}

/// Returns a short-lived presigned GET URL for an authenticated user.
///
/// Call this every time you need to display or download a file — the URL
/// expires after `PRESIGN_DOWNLOAD_SECS` seconds (~1 hour).
pub async fn download_url(
    State(state): State<AppState>,
    Json(payload): Json<DownloadUrlPayload>,
) -> Result<Json<DownloadUrlResponse>, ApiError> {
    require_valid_session(&state, &payload.session_token).await?;

    // Reject anything that doesn't look like one of our keys.
    if !payload.storage_key.starts_with("uploads/") {
        return Err(ApiError::BadRequest("Invalid storage key.".to_string()));
    }

    let s3_path = format!("/{}", payload.storage_key);
    let url = state
        .uploads
        .bucket_presign
        .presign_get(&s3_path, PRESIGN_DOWNLOAD_SECS, None)
        .await
        .map_err(|e| ApiError::Internal(format!("Failed to generate download URL: {e}")))?;

    Ok(Json(DownloadUrlResponse {
        url,
        expires_in: PRESIGN_DOWNLOAD_SECS,
    }))
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/// HEAD-checks an object in MinIO. Returns `BadRequest` if it doesn't exist yet.
async fn verify_object_exists(bucket: &Bucket, s3_path: &str) -> Result<(), ApiError> {
    match bucket.head_object(s3_path).await {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("404") || msg.contains("not found") || msg.contains("nosuchkey") {
                Err(ApiError::BadRequest(
                    "File has not been uploaded yet — complete the PUT request first.".to_string(),
                ))
            } else {
                Err(ApiError::Internal(format!("Storage error while verifying upload: {e}")))
            }
        }
    }
}

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

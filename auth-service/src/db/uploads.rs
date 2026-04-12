use sqlx::{FromRow, SqlitePool};

#[derive(Debug)]
pub struct PendingUploadInsert<'a> {
    pub id: &'a str,
    pub username: &'a str,
    pub storage_key: &'a str,
    pub file_name: &'a str,
    pub file_size: i64,
    pub mime_type: &'a str,
    pub expires_at: i64,
}

#[derive(Debug, FromRow)]
pub struct PendingUploadRow {
    pub username: String,
    pub storage_key: String,
    pub file_name: String,
    pub file_size: i64,
    pub mime_type: String,
    pub expires_at: i64,
}

pub async fn delete_expired_pending_uploads(
    db: &SqlitePool,
    now_unix: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM pending_uploads WHERE expires_at < ?")
        .bind(now_unix)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn quota_used_for_day(
    db: &SqlitePool,
    username: &str,
    quota_date: &str,
) -> Result<i64, sqlx::Error> {
    let used = sqlx::query_scalar(
        "SELECT COALESCE(bytes_uploaded, 0)
         FROM upload_quota
         WHERE username = ? AND quota_date = ?",
    )
    .bind(username)
    .bind(quota_date)
    .fetch_optional(db)
    .await?
    .unwrap_or(0);

    Ok(used)
}

pub async fn create_pending_upload(
    db: &SqlitePool,
    pending: &PendingUploadInsert<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO pending_uploads (id, username, storage_key, file_name, file_size, mime_type, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(pending.id)
    .bind(pending.username)
    .bind(pending.storage_key)
    .bind(pending.file_name)
    .bind(pending.file_size)
    .bind(pending.mime_type)
    .bind(pending.expires_at)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn find_pending_upload(
    db: &SqlitePool,
    id: &str,
) -> Result<Option<PendingUploadRow>, sqlx::Error> {
    sqlx::query_as::<_, PendingUploadRow>(
        "SELECT username, storage_key, file_name, file_size, mime_type, expires_at
         FROM pending_uploads
         WHERE id = ?",
    )
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn delete_pending_upload(db: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM pending_uploads WHERE id = ?")
        .bind(id)
        .execute(db)
        .await?;
    Ok(())
}

pub async fn increment_quota(
    db: &SqlitePool,
    username: &str,
    quota_date: &str,
    bytes: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO upload_quota (username, quota_date, bytes_uploaded)
         VALUES (?, ?, ?)
         ON CONFLICT (username, quota_date)
         DO UPDATE SET bytes_uploaded = bytes_uploaded + excluded.bytes_uploaded",
    )
    .bind(username)
    .bind(quota_date)
    .bind(bytes)
    .execute(db)
    .await?;

    Ok(())
}

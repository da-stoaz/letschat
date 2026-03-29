use anyhow::Context;
use sqlx::SqlitePool;

pub(crate) async fn prepare_schema(db: &SqlitePool) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS push_devices (
            id            TEXT PRIMARY KEY,
            username      TEXT NOT NULL,
            platform      TEXT NOT NULL,
            device_token  TEXT NOT NULL,
            app_bundle_id TEXT,
            enabled       INTEGER NOT NULL DEFAULT 1,
            last_seen_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(platform, device_token)
        )
        "#,
    )
    .execute(db)
    .await
    .context("failed to create push_devices table")?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS push_outbox (
            id               TEXT PRIMARY KEY,
            username         TEXT NOT NULL,
            event_type       TEXT NOT NULL,
            title            TEXT NOT NULL,
            body             TEXT NOT NULL,
            payload_json     TEXT,
            status           TEXT NOT NULL DEFAULT 'pending',
            attempt_count    INTEGER NOT NULL DEFAULT 0,
            next_attempt_unix INTEGER NOT NULL DEFAULT 0,
            last_error       TEXT,
            created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            sent_at          TEXT
        )
        "#,
    )
    .execute(db)
    .await
    .context("failed to create push_outbox table")?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_push_devices_username ON push_devices(username)")
        .execute(db)
        .await
        .context("failed to create idx_push_devices_username")?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_push_outbox_pending ON push_outbox(status, next_attempt_unix)")
        .execute(db)
        .await
        .context("failed to create idx_push_outbox_pending")?;

    Ok(())
}

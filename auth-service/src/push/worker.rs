use std::time::Duration;

use tracing::{debug, error, warn};

use crate::{ApiError, AppState, internal};

use super::types::{PushDeviceRow, PushOutboxRow};

const PUSH_WORKER_POLL_MS: u64 = 2_000;
const PUSH_MAX_ATTEMPTS: i64 = 5;

pub(crate) fn spawn_worker(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Err(error) = process_pending_notifications(&state).await {
                error!(%error, "push worker iteration failed");
            }
            tokio::time::sleep(Duration::from_millis(PUSH_WORKER_POLL_MS)).await;
        }
    });
}

async fn process_pending_notifications(state: &AppState) -> Result<(), ApiError> {
    let now_unix = chrono::Utc::now().timestamp();
    let pending = sqlx::query_as::<_, PushOutboxRow>(
        r#"
        SELECT id, username, event_type, title, body, payload_json, attempt_count
        FROM push_outbox
        WHERE status IN ('pending', 'retry') AND next_attempt_unix <= ?
        ORDER BY created_at ASC
        LIMIT 25
        "#,
    )
    .bind(now_unix)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    for entry in pending {
        deliver_outbox_entry(state, entry).await?;
    }
    Ok(())
}

async fn deliver_outbox_entry(state: &AppState, entry: PushOutboxRow) -> Result<(), ApiError> {
    let devices = sqlx::query_as::<_, PushDeviceRow>(
        r#"
        SELECT platform, device_token, app_bundle_id
        FROM push_devices
        WHERE username = ? AND enabled = 1
        "#,
    )
    .bind(&entry.username)
    .fetch_all(&state.db)
    .await
    .map_err(internal)?;

    if devices.is_empty() {
        sqlx::query(
            "UPDATE push_outbox SET status = 'dropped', sent_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(&entry.id)
        .execute(&state.db)
        .await
        .map_err(internal)?;
        return Ok(());
    }

    let mut delivered = false;
    let mut errors: Vec<String> = Vec::new();
    for device in &devices {
        match state
            .push
            .dispatch(
                device,
                &entry.event_type,
                &entry.title,
                &entry.body,
                entry.payload_json.as_deref(),
            )
            .await
        {
            Ok(()) => delivered = true,
            Err(error) => {
                warn!(
                    queue_id = %entry.id,
                    username = %entry.username,
                    platform = %device.platform,
                    %error,
                    "push delivery attempt failed"
                );
                errors.push(error.to_string());
            }
        }
    }

    if delivered {
        sqlx::query(
            "UPDATE push_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?",
        )
        .bind(&entry.id)
        .execute(&state.db)
        .await
        .map_err(internal)?;
        return Ok(());
    }

    let next_attempt = entry.attempt_count + 1;
    if next_attempt >= PUSH_MAX_ATTEMPTS {
        sqlx::query(
            "UPDATE push_outbox SET status = 'failed', attempt_count = ?, last_error = ? WHERE id = ?",
        )
        .bind(next_attempt)
        .bind(errors.join(" | "))
        .bind(&entry.id)
        .execute(&state.db)
        .await
        .map_err(internal)?;
        return Ok(());
    }

    let backoff_seconds = 5_i64.saturating_mul(2_i64.pow(next_attempt as u32));
    let next_attempt_unix = chrono::Utc::now().timestamp() + backoff_seconds;
    debug!(
        queue_id = %entry.id,
        username = %entry.username,
        backoff_seconds,
        "scheduling push retry"
    );
    sqlx::query(
        "UPDATE push_outbox SET status = 'retry', attempt_count = ?, next_attempt_unix = ?, last_error = ? WHERE id = ?",
    )
    .bind(next_attempt)
    .bind(next_attempt_unix)
    .bind(errors.join(" | "))
    .bind(&entry.id)
    .execute(&state.db)
    .await
    .map_err(internal)?;

    Ok(())
}

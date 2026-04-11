use anyhow::Context;
use sqlx::SqlitePool;

pub mod accounts;
pub mod uploads;

pub async fn run_migrations(db: &SqlitePool) -> anyhow::Result<()> {
    sqlx::migrate!("./migrations")
        .run(db)
        .await
        .context("failed to run sqlite migrations")?;
    Ok(())
}

pub fn is_unique_violation(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::Database(db_error) => db_error.is_unique_violation(),
        _ => false,
    }
}

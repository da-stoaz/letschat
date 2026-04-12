use anyhow::{Context, anyhow};
use sqlx::{FromRow, SqlitePool};

#[derive(Debug, Clone, FromRow)]
pub struct AccountRow {
    pub username: String,
    pub display_name: String,
    pub password_hash: String,
    pub spacetime_token: String,
    pub spacetime_identity: String,
}

#[derive(Debug)]
pub struct NewAccount<'a> {
    pub username: &'a str,
    pub display_name: &'a str,
    pub password_hash: &'a str,
    pub spacetime_token: &'a str,
    pub spacetime_identity: &'a str,
}

pub fn normalize_identity(identity: &str) -> String {
    identity.trim().to_ascii_lowercase()
}

pub async fn ensure_schema_invariants(db: &SqlitePool) -> anyhow::Result<()> {
    let columns: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info('accounts')")
        .fetch_all(db)
        .await
        .context("failed to inspect accounts table columns")?;

    if !columns
        .iter()
        .any(|column| column == "spacetime_identity_norm")
    {
        sqlx::query("ALTER TABLE accounts ADD COLUMN spacetime_identity_norm TEXT")
            .execute(db)
            .await
            .context("failed to add accounts.spacetime_identity_norm")?;
    }

    sqlx::query(
        "UPDATE accounts
         SET spacetime_identity_norm = lower(trim(spacetime_identity))
         WHERE spacetime_identity_norm IS NULL OR spacetime_identity_norm = ''",
    )
    .execute(db)
    .await
    .context("failed to backfill accounts.spacetime_identity_norm")?;

    let duplicates: Vec<String> = sqlx::query_scalar(
        "SELECT spacetime_identity_norm
         FROM accounts
         WHERE spacetime_identity_norm IS NOT NULL AND spacetime_identity_norm != ''
         GROUP BY spacetime_identity_norm
         HAVING COUNT(*) > 1",
    )
    .fetch_all(db)
    .await
    .context("failed to validate account identity uniqueness")?;

    if !duplicates.is_empty() {
        return Err(anyhow!(
            "duplicate account identity bindings found: {}",
            duplicates.join(", ")
        ));
    }

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_identity_norm
         ON accounts(spacetime_identity_norm)",
    )
    .execute(db)
    .await
    .context("failed to create unique identity index for accounts")?;

    Ok(())
}

pub async fn find_by_username(
    db: &SqlitePool,
    username: &str,
) -> Result<Option<AccountRow>, sqlx::Error> {
    sqlx::query_as::<_, AccountRow>(
        "SELECT username, display_name, password_hash, spacetime_token, spacetime_identity
         FROM accounts
         WHERE username = ?",
    )
    .bind(username)
    .fetch_optional(db)
    .await
}

pub async fn find_by_identity(
    db: &SqlitePool,
    spacetime_identity: &str,
) -> Result<Option<AccountRow>, sqlx::Error> {
    sqlx::query_as::<_, AccountRow>(
        "SELECT username, display_name, password_hash, spacetime_token, spacetime_identity
         FROM accounts
         WHERE spacetime_identity_norm = ?",
    )
    .bind(normalize_identity(spacetime_identity))
    .fetch_optional(db)
    .await
}

pub async fn find_by_token_and_identity(
    db: &SqlitePool,
    spacetime_token: &str,
    spacetime_identity: &str,
) -> Result<Option<AccountRow>, sqlx::Error> {
    sqlx::query_as::<_, AccountRow>(
        "SELECT username, display_name, password_hash, spacetime_token, spacetime_identity
         FROM accounts
         WHERE spacetime_token = ? AND spacetime_identity_norm = ?",
    )
    .bind(spacetime_token)
    .bind(normalize_identity(spacetime_identity))
    .fetch_optional(db)
    .await
}

pub async fn insert_account(db: &SqlitePool, account: &NewAccount<'_>) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO accounts (
            username,
            display_name,
            password_hash,
            spacetime_token,
            spacetime_identity,
            spacetime_identity_norm
         )
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(account.username)
    .bind(account.display_name)
    .bind(account.password_hash)
    .bind(account.spacetime_token)
    .bind(account.spacetime_identity)
    .bind(normalize_identity(account.spacetime_identity))
    .execute(db)
    .await?;

    Ok(())
}

pub async fn update_linked_credentials(
    db: &SqlitePool,
    username: &str,
    display_name: &str,
    password_hash: &str,
    spacetime_token: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE accounts
         SET display_name = ?, password_hash = ?, spacetime_token = ?, updated_at = CURRENT_TIMESTAMP
         WHERE username = ?",
    )
    .bind(display_name)
    .bind(password_hash)
    .bind(spacetime_token)
    .bind(username)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn update_spacetime_token(
    db: &SqlitePool,
    username: &str,
    spacetime_token: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE accounts
         SET spacetime_token = ?, updated_at = CURRENT_TIMESTAMP
         WHERE username = ?",
    )
    .bind(spacetime_token)
    .bind(username)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn admin_rebind_identity(
    db: &SqlitePool,
    username: &str,
    display_name: Option<&str>,
    spacetime_token: Option<&str>,
    spacetime_identity: &str,
) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE accounts
         SET display_name = COALESCE(?, display_name),
             spacetime_token = COALESCE(?, spacetime_token),
             spacetime_identity = ?,
             spacetime_identity_norm = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE username = ?",
    )
    .bind(display_name)
    .bind(spacetime_token)
    .bind(spacetime_identity)
    .bind(normalize_identity(spacetime_identity))
    .bind(username)
    .execute(db)
    .await?;

    Ok(result.rows_affected())
}

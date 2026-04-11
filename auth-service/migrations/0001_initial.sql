CREATE TABLE IF NOT EXISTS accounts (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    spacetime_token TEXT NOT NULL,
    spacetime_identity TEXT NOT NULL,
    spacetime_identity_norm TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pending_uploads (
    id          TEXT    PRIMARY KEY,
    username    TEXT    NOT NULL,
    storage_key TEXT    NOT NULL,
    file_name   TEXT    NOT NULL,
    file_size   INTEGER NOT NULL,
    mime_type   TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_uploads_expires_at
ON pending_uploads(expires_at);

CREATE TABLE IF NOT EXISTS upload_quota (
    username       TEXT    NOT NULL,
    quota_date     TEXT    NOT NULL,
    bytes_uploaded INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (username, quota_date)
);

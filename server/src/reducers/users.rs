use spacetimedb::{ReducerContext, Table};

use crate::helpers::{assert_or_err, is_valid_username, normalize_username};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn register_user(ctx: &ReducerContext, username: String, display_name: String) -> Result<(), String> {
    assert_or_err(
        is_valid_username(&username),
        "username must be 2-32 and alphanumeric/underscore",
    )?;
    assert_or_err(
        ctx.db.user().username().find(&username).is_none(),
        "username already exists",
    )?;
    assert_or_err(
        ctx.db.user().identity().find(ctx.sender()).is_none(),
        "user already registered for this identity",
    )?;

    ctx.db.user().insert(User {
        identity: ctx.sender(),
        username,
        display_name,
        avatar_url: None,
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[spacetimedb::reducer]
pub fn upsert_auth_credential(
    ctx: &ReducerContext,
    username: String,
    password_salt: String,
    password_hash: String,
    token_iv: String,
    token_cipher: String,
) -> Result<(), String> {
    let normalized = normalize_username(&username);
    assert_or_err(
        is_valid_username(&normalized),
        "username must be 2-32 and alphanumeric/underscore",
    )?;
    assert_or_err(!password_salt.is_empty(), "password_salt is required")?;
    assert_or_err(!password_hash.is_empty(), "password_hash is required")?;
    assert_or_err(!token_iv.is_empty(), "token_iv is required")?;
    assert_or_err(!token_cipher.is_empty(), "token_cipher is required")?;

    let user_row = ctx
        .db
        .user()
        .identity()
        .find(ctx.sender())
        .ok_or_else(|| "register your user first".to_string())?;

    assert_or_err(
        normalize_username(&user_row.username) == normalized,
        "username does not match your identity",
    )?;

    if let Some(mut existing) = ctx.db.auth_credential().username().find(&normalized) {
        assert_or_err(
            existing.identity == ctx.sender(),
            "username credential belongs to another identity",
        )?;
        existing.password_salt = password_salt;
        existing.password_hash = password_hash;
        existing.token_iv = token_iv;
        existing.token_cipher = token_cipher;
        existing.updated_at = ctx.timestamp;
        ctx.db.auth_credential().username().update(existing);
    } else {
        ctx.db.auth_credential().insert(AuthCredential {
            username: normalized,
            identity: ctx.sender(),
            password_salt,
            password_hash,
            token_iv,
            token_cipher,
            created_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        });
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_profile(
    ctx: &ReducerContext,
    display_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<(), String> {
    let mut user_row = ctx
        .db
        .user()
        .identity()
        .find(ctx.sender())
        .ok_or_else(|| "user not found".to_string())?;

    if let Some(name) = display_name {
        user_row.display_name = name;
    }
    if avatar_url.is_some() {
        user_row.avatar_url = avatar_url;
    }

    ctx.db.user().identity().update(user_row);
    Ok(())
}

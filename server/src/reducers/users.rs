use spacetimedb::{ReducerContext, Table};

use crate::helpers::{assert_or_err, is_valid_username, normalize_username};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn register_user(
    ctx: &ReducerContext,
    username: String,
    display_name: String,
) -> Result<(), String> {
    let normalized = normalize_username(&username);
    assert_or_err(
        is_valid_username(&normalized),
        "username must be 2-32 and alphanumeric/underscore",
    )?;
    assert_or_err(
        ctx.db.user().username().find(&normalized).is_none(),
        "username already exists",
    )?;
    assert_or_err(
        ctx.db.user().identity().find(ctx.sender()).is_none(),
        "user already registered for this identity",
    )?;

    ctx.db.user().insert(User {
        identity: ctx.sender(),
        username: normalized,
        display_name,
        avatar_url: None,
        created_at: ctx.timestamp,
    });
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

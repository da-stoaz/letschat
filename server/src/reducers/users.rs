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

    // First-admin bootstrap. A fresh instance has NO instance admin: `init`
    // can only promote the publisher if a User row already exists, and in a
    // container deployment the publisher is an automated `spacetime publish`
    // that never signs in. That left every admin-gated reducer permanently
    // unreachable — including `set_archive_service_identity`, so the archive
    // worker (the durability guarantee) could never be registered.
    //
    // So: whoever registers first on an instance with zero admins becomes the
    // instance admin — the same bootstrap Gitea and Grafana use. Only ever
    // true while the count is zero, and `set_user_admin`'s last-admin guard
    // keeps it that way afterwards. Operators should sign in once before
    // exposing a new instance publicly.
    let is_first_admin = !ctx.db.user().iter().any(|user| user.is_admin);

    ctx.db.user().insert(User {
        identity: ctx.sender(),
        username: normalized,
        display_name,
        avatar_url: None,
        created_at: ctx.timestamp,
        is_admin: is_first_admin,
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

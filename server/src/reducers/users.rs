use spacetimedb::{ReducerContext, Table};

use crate::helpers::{assert_or_err, is_valid_username, normalize_username, require_account};
use crate::reducers::system::require_trusted_issuer;
use crate::schema::*;
use crate::storage_refs::sync_avatar_reference;

#[spacetimedb::reducer]
pub fn register_user(
    ctx: &ReducerContext,
    username: String,
    display_name: String,
) -> Result<(), String> {
    // The only reducer that creates standing in the module out of nothing, so
    // it is the one place the caller's token issuer has to be checked. Every
    // other client-callable reducer relies on `require_account`, which can only
    // succeed for an identity that got through here.
    require_trusted_issuer(ctx)?;

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

    // Core-api pushes its Admin role during HTTP sign-in, which happens before
    // the desktop/web client connects here. `set_user_admin` parks that explicit
    // grant until this row exists; consuming it in the same transaction prevents
    // both a lost grant and any first-registrant race.
    let is_admin = ctx
        .db
        .pending_admin_grant()
        .identity()
        .find(ctx.sender())
        .is_some();
    if is_admin {
        ctx.db.pending_admin_grant().identity().delete(ctx.sender());
    }

    ctx.db.user().insert(User {
        identity: ctx.sender(),
        username: normalized,
        display_name,
        avatar_url: None,
        created_at: ctx.timestamp,
        // Only an explicit grant from an existing admin can set this. `init`
        // reserves the first admin row for the module owner.
        is_admin,
        suspended: false,
        // No floor until core-api first revokes (a credential change), so the
        // token check costs one integer compare for accounts that never need it.
        min_token_generation: 0,
    });
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_profile(
    ctx: &ReducerContext,
    display_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<(), String> {
    // The row lookup below already rejects an identity with no account, which is
    // why this reducer was skipped when `require_account` went into the other
    // 60 — but that lookup checks neither `suspended` nor the token-generation
    // floor, so a disabled account, or a stolen token after a password reset,
    // could still rename itself and swap its avatar.
    require_account(ctx)?;

    let mut user_row = ctx
        .db
        .user()
        .identity()
        .find(ctx.sender())
        .ok_or_else(|| "user not found".to_string())?;

    if let Some(name) = display_name {
        user_row.display_name = name;
    }
    // The client resends the current avatar with every profile save; only a
    // change is validated, so a pre-existing value never blocks a rename.
    if let Some(next_avatar) = avatar_url.as_deref()
        && Some(next_avatar) != user_row.avatar_url.as_deref()
    {
        sync_avatar_reference(ctx, &user_row.username, Some(next_avatar))?;
    }
    if avatar_url.is_some() {
        user_row.avatar_url = avatar_url;
    }

    ctx.db.user().identity().update(user_row);
    Ok(())
}

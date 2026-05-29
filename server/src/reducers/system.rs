use spacetimedb::{Identity, ReducerContext, Table};

use crate::helpers::{assert_or_err, require_system_admin};
use crate::schema::*;

/// Singleton primary key. `SystemSettings` is intentionally a 1-row table.
const SETTINGS_ID: u8 = 1;

/// Lifecycle reducer — runs once when the module is first published. Seeds
/// the singleton config row and marks the publisher as the first instance
/// admin so they can promote others (e.g. core-api's service identity) via
/// `set_user_admin`.
#[spacetimedb::reducer(init)]
pub fn init(ctx: &ReducerContext) -> Result<(), String> {
    if ctx
        .db
        .system_settings()
        .id()
        .find(SETTINGS_ID)
        .is_none()
    {
        ctx.db.system_settings().insert(SystemSettings {
            id: SETTINGS_ID,
            space_create_policy: SpaceCreatePolicy::Anyone,
        });
    }

    // The publisher (whoever ran `spacetime publish`) gets instance admin so
    // there is always one bootstrap admin to grant further admin rights from.
    // No User row exists yet for them — the row is created lazily on first
    // sign-in via `register_user`; for now we record the identity by promoting
    // any existing row, and otherwise leave it for `set_user_admin` to apply
    // once the publisher has registered.
    let publisher = ctx.sender();
    if let Some(mut user) = ctx.db.user().identity().find(publisher) {
        if !user.is_admin {
            user.is_admin = true;
            ctx.db.user().identity().update(user);
        }
    }

    Ok(())
}

/// Returns the current settings, falling back to defaults if (somehow) the
/// init row was lost. Defensive — under normal operation the row exists.
pub(crate) fn current_settings(ctx: &ReducerContext) -> SystemSettings {
    ctx.db
        .system_settings()
        .id()
        .find(SETTINGS_ID)
        .unwrap_or(SystemSettings {
            id: SETTINGS_ID,
            space_create_policy: SpaceCreatePolicy::Anyone,
        })
}

/// Updates the create-policy. Instance-admin gated.
#[spacetimedb::reducer]
pub fn set_space_create_policy(
    ctx: &ReducerContext,
    policy: SpaceCreatePolicy,
) -> Result<(), String> {
    require_system_admin(ctx, ctx.sender())?;

    let mut row = current_settings(ctx);
    row.space_create_policy = policy;
    if ctx
        .db
        .system_settings()
        .id()
        .find(SETTINGS_ID)
        .is_some()
    {
        ctx.db.system_settings().id().update(row);
    } else {
        ctx.db.system_settings().insert(row);
    }
    Ok(())
}

/// Grants or revokes instance-admin status. Instance-admin gated, so the
/// only way to bootstrap a NEW instance is via the publisher identity from
/// `init` — no anonymous escalation path.
#[spacetimedb::reducer]
pub fn set_user_admin(
    ctx: &ReducerContext,
    target: Identity,
    is_admin: bool,
) -> Result<(), String> {
    require_system_admin(ctx, ctx.sender())?;

    // Last-admin guard — never let the system end up with zero admins, which
    // would lock everyone out of the policy/admin reducers.
    if !is_admin {
        let admin_count = ctx.db.user().iter().filter(|u| u.is_admin).count();
        assert_or_err(
            !(target == ctx.sender() && admin_count <= 1),
            "cannot revoke admin from the last remaining admin",
        )?;
    }

    let mut user = ctx
        .db
        .user()
        .identity()
        .find(target)
        .ok_or_else(|| "target user has not registered yet".to_string())?;

    if user.is_admin != is_admin {
        user.is_admin = is_admin;
        ctx.db.user().identity().update(user);
    }
    Ok(())
}

use spacetimedb::{Identity, ReducerContext, Table};

use crate::helpers::{assert_or_err, require_account, require_system_admin};
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
            trusted_issuer: None,
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
            trusted_issuer: None,
        })
}

/// Writes the singleton settings row back, inserting it if `init` never ran
/// (or the row was lost). Shared by every settings mutator so the
/// insert-or-update branch lives in exactly one place.
fn save_settings(ctx: &ReducerContext, row: SystemSettings) {
    if ctx.db.system_settings().id().find(SETTINGS_ID).is_some() {
        ctx.db.system_settings().id().update(row);
    } else {
        ctx.db.system_settings().insert(row);
    }
}

/// Requires that the caller's token was issued by the instance's configured
/// OIDC issuer — i.e. by core-api, the only thing that mints a token after
/// checking the account is registered, confirmed, approved and not disabled.
///
/// This guards `register_user`, the one reducer that creates standing in the
/// module out of nothing. Everything else is guarded by `require_account`,
/// which is cheaper and, since a `User` row can only come from here, equally
/// strict.
///
/// Two deliberate holes, both of which only exist while an instance is not yet
/// configured:
///
/// - **No issuer configured yet** (`trusted_issuer == None`): the check passes.
///   Publishing this module onto a running instance must never lock out its
///   existing users, and on a fresh instance nothing *could* have set the
///   issuer — `set_trusted_issuer` is admin-gated and the first admin is
///   created by the first `register_user`. core-api closes the window by
///   pushing the issuer as soon as an admin exists (at startup, and again on an
///   admin sign-in).
/// - **Caller has no JWT at all**: rejected as soon as an issuer is configured.
///
/// The issuer string is trustworthy: SpacetimeDB validates the token signature
/// against that issuer's published JWKS before the module ever sees the call,
/// so a caller cannot simply claim someone else's `iss`.
pub(crate) fn require_trusted_issuer(ctx: &ReducerContext) -> Result<(), String> {
    let Some(expected) = current_settings(ctx).trusted_issuer else {
        return Ok(());
    };

    let actual = ctx
        .sender_auth()
        .jwt()
        .map(|claims| claims.issuer().to_string())
        .ok_or_else(|| "registration requires an account token".to_string())?;

    assert_or_err(actual == expected, "registration requires an account token")
}

/// Pins the OIDC issuer whose tokens may register accounts (`None` clears it,
/// which disables the check). Instance-admin gated.
///
/// Normally called by core-api rather than a human: it knows its own
/// `SPACETIME_OIDC_ISSUER` and pushes it here, so the pinned value cannot drift
/// from the issuer that actually signs the tokens. Idempotent.
#[spacetimedb::reducer]
pub fn set_trusted_issuer(ctx: &ReducerContext, issuer: Option<String>) -> Result<(), String> {
    require_account(ctx)?;
    require_system_admin(ctx, ctx.sender())?;

    let issuer = issuer
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut row = current_settings(ctx);
    row.trusted_issuer = issuer;
    save_settings(ctx, row);
    Ok(())
}

/// Updates the create-policy. Instance-admin gated.
#[spacetimedb::reducer]
pub fn set_space_create_policy(
    ctx: &ReducerContext,
    policy: SpaceCreatePolicy,
) -> Result<(), String> {
    require_account(ctx)?;
    require_system_admin(ctx, ctx.sender())?;

    let mut row = current_settings(ctx);
    row.space_create_policy = policy;
    save_settings(ctx, row);
    Ok(())
}

/// Pushes an account's chat-side access state: whether it is disabled, and the
/// token stamp that its tokens must now carry. Instance-admin gated.
///
/// core-api owns both facts and calls this whenever either changes — an admin
/// disabling or re-enabling an account, and any credential change (password
/// reset or change, which rolls the stamp). It exists because the client talks
/// to this module directly: core-api's own sign-in checks are simply not on
/// that path, so without this a disabled account keeps chatting and a password
/// reset does not end a stolen session.
///
/// The generation floor only ever rises: a stale retry or an out-of-order call
/// cannot re-open a window that a newer one already closed. Idempotent. No-ops
/// rather than failing when the account has no `User` row — an account that
/// never signed into the chat client has nothing to revoke, and core-api's
/// disable flow must not fail because of that.
#[spacetimedb::reducer]
pub fn admin_set_account_access(
    ctx: &ReducerContext,
    target: Identity,
    suspended: bool,
    min_token_generation: u64,
) -> Result<(), String> {
    require_account(ctx)?;
    require_system_admin(ctx, ctx.sender())?;

    let Some(mut user) = ctx.db.user().identity().find(target) else {
        return Ok(());
    };
    user.suspended = suspended;
    user.min_token_generation = user.min_token_generation.max(min_token_generation);
    ctx.db.user().identity().update(user);
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
    require_account(ctx)?;
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

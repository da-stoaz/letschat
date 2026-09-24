use spacetimedb::{Identity, ReducerContext, Table, TimeDuration};

use crate::helpers::{
    assert_or_err, ban_key, member_key, remove_voice_presence, require_account, require_member_role,
    require_mod_or_owner, require_owner,
};
use crate::schema::*;

/// Shared gate for the two reducers that remove someone else from a space.
///
/// Both had the same four checks copied out, and the one that was missing was
/// missing from both (BUG_ANALYSIS B2): nothing stopped the caller naming
/// themselves. An owner doing that deletes their own `ServerMember` row, so
/// every later `require_owner` / `require_mod_or_owner` fails with "not a
/// server member" — the space can never be administered or deleted again, and
/// after `ban_member` the owner cannot even re-enter by invite. `leave_server`
/// is the supported way out and already refuses an owner outright.
///
/// Nobody may target themselves here, not just the owner: a moderator
/// self-kicking is `leave_server` with extra steps, so there is nothing to
/// allow and one less case to reason about.
fn require_can_remove_member(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
    action: &str,
) -> Result<(), String> {
    let caller_role = require_mod_or_owner(ctx, server_id, ctx.sender())?;
    let target_role = require_member_role(ctx, server_id, target_identity)?;

    assert_or_err(
        target_identity != ctx.sender(),
        &format!("cannot {action} yourself; leave the space instead"),
    )?;

    if matches!(target_role, Role::Moderator | Role::Owner) {
        assert_or_err(
            caller_role == Role::Owner,
            &format!("only owner can {action} moderators/owner"),
        )?;
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn kick_member(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
) -> Result<(), String> {
    require_account(ctx)?;
    require_can_remove_member(ctx, server_id, target_identity, "kick")?;

    ctx.db
        .server_member()
        .member_key()
        .delete(member_key(server_id, target_identity));
    remove_voice_presence(ctx, server_id, target_identity);

    Ok(())
}

#[spacetimedb::reducer]
pub fn ban_member(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
    reason: Option<String>,
) -> Result<(), String> {
    require_account(ctx)?;
    require_can_remove_member(ctx, server_id, target_identity, "ban")?;

    let key = ban_key(server_id, target_identity);
    if ctx.db.ban().ban_key().find(&key).is_none() {
        ctx.db.ban().insert(Ban {
            ban_key: key,
            server_id,
            user_identity: target_identity,
            banned_by: ctx.sender(),
            reason,
            banned_at: ctx.timestamp,
        });
    }

    ctx.db
        .server_member()
        .member_key()
        .delete(member_key(server_id, target_identity));
    // kick_member always did this; a banned user stayed a visible voice
    // participant holding a slot until they disconnected (BUG_ANALYSIS B11).
    remove_voice_presence(ctx, server_id, target_identity);

    Ok(())
}

#[spacetimedb::reducer]
pub fn unban_member(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
) -> Result<(), String> {
    require_account(ctx)?;
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    ctx.db
        .ban()
        .ban_key()
        .delete(ban_key(server_id, target_identity));
    Ok(())
}

#[spacetimedb::reducer]
pub fn timeout_member(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
    duration_seconds: u64,
) -> Result<(), String> {
    require_account(ctx)?;
    let caller_role = require_mod_or_owner(ctx, server_id, ctx.sender())?;
    let target_role = require_member_role(ctx, server_id, target_identity)?;

    if matches!(target_role, Role::Moderator | Role::Owner) {
        assert_or_err(
            caller_role == Role::Owner,
            "only owner can timeout moderators/owner",
        )?;
    }

    assert_or_err(
        duration_seconds > 0 && duration_seconds <= 60 * 60 * 24 * 28,
        "timeout must be 1s–28d",
    )?;

    let mut member_row = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(server_id, target_identity))
        .ok_or_else(|| "target is not a member".to_string())?;

    member_row.timeout_until =
        Some(ctx.timestamp + TimeDuration::from_micros((duration_seconds as i64) * 1_000_000));
    ctx.db.server_member().member_key().update(member_row);
    remove_voice_presence(ctx, server_id, target_identity);
    Ok(())
}

#[spacetimedb::reducer]
pub fn remove_timeout(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
) -> Result<(), String> {
    require_account(ctx)?;
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    require_member_role(ctx, server_id, target_identity)?;

    let mut member_row = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(server_id, target_identity))
        .ok_or_else(|| "target is not a member".to_string())?;

    member_row.timeout_until = None;
    ctx.db.server_member().member_key().update(member_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_member_role(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
    new_role: Role,
) -> Result<(), String> {
    require_account(ctx)?;
    require_owner(ctx, server_id, ctx.sender())?;
    assert_or_err(
        new_role != Role::Owner,
        "use transfer_ownership for owner role",
    )?;

    let mut member_row = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(server_id, target_identity))
        .ok_or_else(|| "target is not a member".to_string())?;
    // Only the owner gets here, so an Owner target is the caller demoting
    // themselves — the space would be left with no owner (BUG_ANALYSIS B10).
    assert_or_err(
        member_row.role != Role::Owner,
        "use transfer_ownership to hand over the owner role",
    )?;

    member_row.role = new_role;
    ctx.db.server_member().member_key().update(member_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn transfer_ownership(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
) -> Result<(), String> {
    require_account(ctx)?;
    require_owner(ctx, server_id, ctx.sender())?;

    // Transferring to yourself locks you out permanently (BUG_ANALYSIS B1). The
    // two updates below are then the same row: it is set to Owner, re-read, and
    // set to Moderator — the second write wins. `Server.owner_identity` still
    // names the caller, but `require_owner` only reads `ServerMember.role`, so
    // every owner-gated reducer (including this one) refuses them from then on.
    // Worse, being a Moderator now passes the `leave_server` owner check, so the
    // ex-owner can walk out and orphan the space for good.
    assert_or_err(
        target_identity != ctx.sender(),
        "you already own this space",
    )?;

    let mut target_row = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(server_id, target_identity))
        .ok_or_else(|| "target is not a member".to_string())?;
    target_row.role = Role::Owner;
    ctx.db.server_member().member_key().update(target_row);

    let mut caller_row = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(server_id, ctx.sender()))
        .ok_or_else(|| "caller member row missing".to_string())?;
    caller_row.role = Role::Moderator;
    ctx.db.server_member().member_key().update(caller_row);

    let mut server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;
    server_row.owner_identity = target_identity;
    ctx.db.server().id().update(server_row);

    Ok(())
}

use spacetimedb::{Identity, ReducerContext, Table, TimeDuration};

use crate::helpers::{
    assert_or_err, ban_key, member_key, require_member_role, require_mod_or_owner, require_owner,
    voice_key,
};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn kick_member(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
) -> Result<(), String> {
    let caller_role = require_mod_or_owner(ctx, server_id, ctx.sender())?;
    let target_role = require_member_role(ctx, server_id, target_identity)?;

    if matches!(target_role, Role::Moderator | Role::Owner) {
        assert_or_err(
            caller_role == Role::Owner,
            "only owner can kick moderators/owner",
        )?;
    }

    ctx.db
        .server_member()
        .member_key()
        .delete(member_key(server_id, target_identity));

    let channel_ids: Vec<u64> = ctx
        .db
        .channel()
        .iter()
        .filter(|c| c.server_id == server_id)
        .map(|c| c.id)
        .collect();

    for channel_id in channel_ids {
        ctx.db
            .voice_participant()
            .voice_key()
            .delete(voice_key(channel_id, target_identity));
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn ban_member(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
    reason: Option<String>,
) -> Result<(), String> {
    let caller_role = require_mod_or_owner(ctx, server_id, ctx.sender())?;
    let target_role = require_member_role(ctx, server_id, target_identity)?;

    if matches!(target_role, Role::Moderator | Role::Owner) {
        assert_or_err(
            caller_role == Role::Owner,
            "only owner can ban moderators/owner",
        )?;
    }

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

    Ok(())
}

#[spacetimedb::reducer]
pub fn unban_member(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
) -> Result<(), String> {
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
    Ok(())
}

#[spacetimedb::reducer]
pub fn remove_timeout(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
) -> Result<(), String> {
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
    require_owner(ctx, server_id, ctx.sender())?;

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

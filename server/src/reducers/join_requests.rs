use spacetimedb::{Identity, ReducerContext, Table};

use crate::helpers::{
    assert_or_err, has_member_role, is_banned, join_request_key, member_key, require_mod_or_owner,
};
use crate::schema::*;

/// A non-member asks to join a discoverable, invite-only space. Only valid for a
/// space that is discoverable AND `ModeratorsOnly` (an `Everyone` space is joined
/// directly via `join_discoverable_server`). Rejects members, banned users, and
/// duplicate requests.
#[spacetimedb::reducer]
pub fn request_to_join(ctx: &ReducerContext, server_id: u64) -> Result<(), String> {
    let caller = ctx.sender();

    let server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;

    assert_or_err(server_row.is_discoverable, "this space is not discoverable")?;
    assert_or_err(
        matches!(server_row.invite_policy, InvitePolicy::ModeratorsOnly),
        "this space can be joined directly",
    )?;
    assert_or_err(
        has_member_role(ctx, server_id, caller).is_none(),
        "you are already a member of this space",
    )?;
    assert_or_err(
        !is_banned(ctx, server_id, caller),
        "you are banned from this space",
    )?;

    let key = join_request_key(server_id, caller);
    assert_or_err(
        ctx.db.join_request().request_key().find(&key).is_none(),
        "you already have a pending request to join",
    )?;

    ctx.db.join_request().insert(JoinRequest {
        request_key: key,
        server_id,
        user_identity: caller,
        created_at: ctx.timestamp,
    });

    Ok(())
}

/// The requester withdraws their own pending request. Idempotent.
#[spacetimedb::reducer]
pub fn cancel_join_request(ctx: &ReducerContext, server_id: u64) -> Result<(), String> {
    ctx.db
        .join_request()
        .request_key()
        .delete(join_request_key(server_id, ctx.sender()));
    Ok(())
}

/// A moderator/owner approves a pending request: the requester becomes a Member
/// and the request is removed. Re-checks the ban (a banned user can't be let in)
/// and that they aren't already a member.
#[spacetimedb::reducer]
pub fn approve_join_request(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;

    let key = join_request_key(server_id, target_identity);
    assert_or_err(
        ctx.db.join_request().request_key().find(&key).is_some(),
        "no pending request from this user",
    )?;
    assert_or_err(
        !is_banned(ctx, server_id, target_identity),
        "cannot approve a user who is banned from this space",
    )?;

    if has_member_role(ctx, server_id, target_identity).is_none() {
        ctx.db.server_member().insert(ServerMember {
            member_key: member_key(server_id, target_identity),
            server_id,
            user_identity: target_identity,
            role: Role::Member,
            joined_at: ctx.timestamp,
            timeout_until: None,
        });
    }

    ctx.db.join_request().request_key().delete(&key);
    Ok(())
}

/// A moderator/owner declines a pending request, removing it. Idempotent.
#[spacetimedb::reducer]
pub fn decline_join_request(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    ctx.db
        .join_request()
        .request_key()
        .delete(join_request_key(server_id, target_identity));
    Ok(())
}

use spacetimedb::rand::{distributions::Alphanumeric, Rng};
use spacetimedb::{ReducerContext, Table, TimeDuration};

use crate::helpers::{assert_or_err, has_member_role, is_banned, member_key, require_mod_or_owner};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn create_invite(
    ctx: &ReducerContext,
    server_id: u64,
    expires_in_seconds: Option<u64>,
    max_uses: Option<u32>,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    assert_or_err(
        ctx.db.server().id().find(server_id).is_some(),
        "server not found",
    )?;

    let token: String = ctx
        .rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();

    let expiry = if let Some(seconds) = expires_in_seconds {
        ctx.timestamp + TimeDuration::from_micros((seconds as i64) * 1_000_000)
    } else {
        ctx.timestamp + TimeDuration::from_micros(100_i64 * 365 * 24 * 3600 * 1_000_000)
    };

    ctx.db.invite().insert(Invite {
        token: token.clone(),
        server_id,
        created_by: ctx.sender(),
        expires_at: expiry,
        max_uses,
        use_count: 0,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn use_invite(ctx: &ReducerContext, token: String) -> Result<(), String> {
    let mut invite_row = ctx
        .db
        .invite()
        .token()
        .find(&token)
        .ok_or_else(|| "invite not found".to_string())?;

    assert_or_err(ctx.timestamp <= invite_row.expires_at, "invite expired")?;
    if let Some(max_uses) = invite_row.max_uses {
        assert_or_err(invite_row.use_count < max_uses, "invite max uses reached")?;
    }

    assert_or_err(!is_banned(ctx, invite_row.server_id, ctx.sender()), "you are banned")?;
    assert_or_err(
        has_member_role(ctx, invite_row.server_id, ctx.sender()).is_none(),
        "already a member",
    )?;

    ctx.db.server_member().insert(ServerMember {
        member_key: member_key(invite_row.server_id, ctx.sender()),
        server_id: invite_row.server_id,
        user_identity: ctx.sender(),
        role: Role::Member,
        joined_at: ctx.timestamp,
    });

    invite_row.use_count += 1;
    ctx.db.invite().token().update(invite_row);
    Ok(())
}

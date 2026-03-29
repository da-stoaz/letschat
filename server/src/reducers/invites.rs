use spacetimedb::rand::{distributions::Alphanumeric, Rng};
use spacetimedb::{Identity, ReducerContext, Table, TimeDuration};

use crate::helpers::{assert_or_err, has_member_role, is_banned, member_key, require_mod_or_owner};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn create_invite(
    ctx: &ReducerContext,
    server_id: u64,
    expires_in_seconds: Option<u64>,
    max_uses: Option<u32>,
    allowed_usernames: Vec<String>,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    assert_or_err(
        ctx.db.server().id().find(server_id).is_some(),
        "server not found",
    )?;

    // Validate that a whitelist and max_uses are not set simultaneously
    if !allowed_usernames.is_empty() {
        assert_or_err(max_uses.is_none(), "cannot combine allowed_usernames whitelist with max_uses")?;
    }

    let token: String = ctx
        .rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();

    let expiry = if let Some(seconds) = expires_in_seconds {
        ctx.timestamp + TimeDuration::from_micros((seconds as i64) * 1_000_000)
    } else {
        // Default: 100 years (effectively never)
        ctx.timestamp + TimeDuration::from_micros(100_i64 * 365 * 24 * 3600 * 1_000_000)
    };

    // Normalize allowed usernames to lowercase
    let normalized_usernames: Vec<String> = allowed_usernames.into_iter().map(|u| u.trim().to_lowercase()).collect();

    ctx.db.invite().insert(Invite {
        token: token.clone(),
        server_id,
        created_by: ctx.sender(),
        expires_at: expiry,
        max_uses,
        use_count: 0,
        allowed_usernames: normalized_usernames,
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

    // Check username whitelist if set
    if !invite_row.allowed_usernames.is_empty() {
        let caller_user = ctx.db.user().identity().find(ctx.sender())
            .ok_or_else(|| "user not found".to_string())?;
        let caller_username = caller_user.username.trim().to_lowercase();
        assert_or_err(
            invite_row.allowed_usernames.contains(&caller_username),
            "you are not on the invite whitelist",
        )?;
    }

    ctx.db.server_member().insert(ServerMember {
        member_key: member_key(invite_row.server_id, ctx.sender()),
        server_id: invite_row.server_id,
        user_identity: ctx.sender(),
        role: Role::Member,
        joined_at: ctx.timestamp,
        timeout_until: None,
    });

    invite_row.use_count += 1;
    ctx.db.invite().token().update(invite_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_invite(ctx: &ReducerContext, token: String) -> Result<(), String> {
    let invite_row = ctx
        .db
        .invite()
        .token()
        .find(&token)
        .ok_or_else(|| "invite not found".to_string())?;

    require_mod_or_owner(ctx, invite_row.server_id, ctx.sender())?;
    ctx.db.invite().token().delete(token);
    Ok(())
}

/// Prune invites that have expired or exhausted their max uses.
/// Can be called by any moderator/owner of a server, or by anyone to clean up globally.
#[spacetimedb::reducer]
pub fn cleanup_expired_invites(ctx: &ReducerContext) -> Result<(), String> {
    let expired: Vec<String> = ctx.db.invite().iter()
        .filter(|inv| {
            let expired = ctx.timestamp > inv.expires_at;
            let exhausted = inv.max_uses.map(|max| inv.use_count >= max).unwrap_or(false);
            expired || exhausted
        })
        .map(|inv| inv.token.clone())
        .collect();

    for token in expired {
        ctx.db.invite().token().delete(token);
    }
    Ok(())
}

/// Send a server invite to another user via in-app DM.
/// Creates an invite token and a DmServerInvite record.
#[spacetimedb::reducer]
pub fn send_dm_server_invite(
    ctx: &ReducerContext,
    recipient_identity: Identity,
    server_id: u64,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    assert_or_err(
        ctx.db.server().id().find(server_id).is_some(),
        "server not found",
    )?;
    assert_or_err(
        ctx.db.user().identity().find(recipient_identity).is_some(),
        "recipient not found",
    )?;
    assert_or_err(ctx.sender() != recipient_identity, "cannot invite yourself")?;
    assert_or_err(
        has_member_role(ctx, server_id, recipient_identity).is_none(),
        "user is already a member",
    )?;
    assert_or_err(!is_banned(ctx, server_id, recipient_identity), "user is banned from this server")?;

    // Create a single-use invite token for this DM invite (expires in 7 days)
    let token: String = ctx
        .rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();

    let expiry = ctx.timestamp + TimeDuration::from_micros(7 * 24 * 3600 * 1_000_000_i64);

    ctx.db.invite().insert(Invite {
        token: token.clone(),
        server_id,
        created_by: ctx.sender(),
        expires_at: expiry,
        max_uses: Some(1),
        use_count: 0,
        allowed_usernames: Vec::new(),
    });

    ctx.db.dm_server_invite().insert(DmServerInvite {
        id: 0,
        server_id,
        invite_token: token,
        sender_identity: ctx.sender(),
        recipient_identity,
        status: DmInviteStatus::Pending,
        created_at: ctx.timestamp,
    });

    Ok(())
}

/// Accept or decline an in-app DM server invite.
#[spacetimedb::reducer]
pub fn respond_dm_server_invite(
    ctx: &ReducerContext,
    invite_id: u64,
    accept: bool,
) -> Result<(), String> {
    let mut dm_invite = ctx
        .db
        .dm_server_invite()
        .id()
        .find(invite_id)
        .ok_or_else(|| "dm invite not found".to_string())?;

    assert_or_err(
        dm_invite.recipient_identity == ctx.sender(),
        "not the invite recipient",
    )?;
    assert_or_err(
        matches!(dm_invite.status, DmInviteStatus::Pending),
        "invite already responded to",
    )?;

    if accept {
        // Try to use the underlying invite token
        use_invite(ctx, dm_invite.invite_token.clone())?;
        dm_invite.status = DmInviteStatus::Accepted;
    } else {
        dm_invite.status = DmInviteStatus::Declined;
    }

    ctx.db.dm_server_invite().id().update(dm_invite);
    Ok(())
}

use spacetimedb::{Identity, ReducerContext};

use crate::schema::*;

pub(crate) fn assert_or_err(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

pub(crate) fn is_valid_username(username: &str) -> bool {
    let len_ok = (2..=32).contains(&username.len());
    len_ok
        && username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub(crate) fn normalize_username(username: &str) -> String {
    username.trim().to_lowercase()
}

pub(crate) fn normalize_identity_string(identity: &str) -> String {
    identity.trim().to_lowercase()
}

pub(crate) fn member_key(server_id: u64, user_identity: Identity) -> String {
    format!("{server_id}:{user_identity}")
}

pub(crate) fn ban_key(server_id: u64, user_identity: Identity) -> String {
    format!("{server_id}:{user_identity}")
}

pub(crate) fn voice_key(channel_id: u64, user_identity: Identity) -> String {
    format!("{channel_id}:{user_identity}")
}

pub(crate) fn dm_room_key(a: Identity, b: Identity) -> String {
    let (x, y) = ordered_pair(a, b);
    format!("{x}:{y}")
}

pub(crate) fn dm_voice_key(room_key: &str, user_identity: Identity) -> String {
    format!("{room_key}:{user_identity}")
}

pub(crate) fn ordered_pair(a: Identity, b: Identity) -> (Identity, Identity) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

pub(crate) fn friend_pair_key(a: Identity, b: Identity) -> String {
    let (x, y) = ordered_pair(a, b);
    format!("{x}:{y}")
}

pub(crate) fn block_key(blocker: Identity, blocked: Identity) -> String {
    format!("{blocker}:{blocked}")
}

pub(crate) fn has_member_role(
    ctx: &ReducerContext,
    server_id: u64,
    user_identity: Identity,
) -> Option<Role> {
    ctx.db
        .server_member()
        .member_key()
        .find(member_key(server_id, user_identity))
        .map(|m| m.role)
}

pub(crate) fn require_member_role(
    ctx: &ReducerContext,
    server_id: u64,
    user_identity: Identity,
) -> Result<Role, String> {
    has_member_role(ctx, server_id, user_identity).ok_or_else(|| "not a server member".to_string())
}

pub(crate) fn require_mod_or_owner(
    ctx: &ReducerContext,
    server_id: u64,
    user_identity: Identity,
) -> Result<Role, String> {
    match require_member_role(ctx, server_id, user_identity)? {
        Role::Moderator => Ok(Role::Moderator),
        Role::Owner => Ok(Role::Owner),
        Role::Member => Err("insufficient permissions".to_string()),
    }
}

pub(crate) fn require_owner(
    ctx: &ReducerContext,
    server_id: u64,
    user_identity: Identity,
) -> Result<(), String> {
    let role = require_member_role(ctx, server_id, user_identity)?;
    assert_or_err(role == Role::Owner, "owner permission required")
}

pub(crate) fn find_channel(ctx: &ReducerContext, channel_id: u64) -> Result<Channel, String> {
    ctx.db
        .channel()
        .id()
        .find(channel_id)
        .ok_or_else(|| "channel not found".to_string())
}

pub(crate) fn is_banned(ctx: &ReducerContext, server_id: u64, user_identity: Identity) -> bool {
    ctx.db
        .ban()
        .ban_key()
        .find(ban_key(server_id, user_identity))
        .is_some()
}

pub(crate) fn find_friend_row(ctx: &ReducerContext, a: Identity, b: Identity) -> Option<Friend> {
    ctx.db.friend().pair_key().find(friend_pair_key(a, b))
}

pub(crate) fn has_block_either_direction(ctx: &ReducerContext, a: Identity, b: Identity) -> bool {
    ctx.db.block().block_key().find(block_key(a, b)).is_some()
        || ctx.db.block().block_key().find(block_key(b, a)).is_some()
}

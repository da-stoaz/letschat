use spacetimedb::{ReducerContext, Table};

use crate::helpers::{assert_or_err, find_channel};
use crate::schema::*;

fn normalize_identity(value: &str) -> String {
    value.trim().to_lowercase()
}

fn parse_channel_scope(scope_key: &str) -> Option<u64> {
    let raw = scope_key.strip_prefix("channel:")?;
    raw.parse::<u64>().ok()
}

fn parse_dm_scope(scope_key: &str) -> Option<(String, String)> {
    let raw = scope_key.strip_prefix("dm:")?;
    let mut parts = raw.split(':');
    let a = parts.next()?;
    let b = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    Some((normalize_identity(a), normalize_identity(b)))
}

fn ensure_scope_allowed(ctx: &ReducerContext, scope_key: &str) -> Result<(), String> {
    if let Some(channel_id) = parse_channel_scope(scope_key) {
        let channel_row = find_channel(ctx, channel_id)?;
        let is_member = ctx
            .db
            .server_member()
            .server_id()
            .filter(channel_row.server_id)
            .any(|row| row.user_identity == ctx.sender());
        return assert_or_err(is_member, "not a member of this channel server");
    }

    if let Some((a, b)) = parse_dm_scope(scope_key) {
        let me = normalize_identity(&ctx.sender().to_string());
        assert_or_err(
            a == me || b == me,
            "dm scope does not include sender identity",
        )?;
        let other = if a == me { b } else { a };

        let friend_row = ctx
            .db
            .friend()
            .iter()
            .find(|row| {
                row.status == FriendStatus::Accepted
                    && ((row.user_a == ctx.sender()
                        && normalize_identity(&row.user_b.to_string()) == other)
                        || (row.user_b == ctx.sender()
                            && normalize_identity(&row.user_a.to_string()) == other))
            })
            .ok_or_else(|| "friendship not accepted for dm scope".to_string())?;

        assert_or_err(
            friend_row.status == FriendStatus::Accepted,
            "friendship not accepted for dm scope",
        )?;
        return Ok(());
    }

    Err("invalid typing scope".to_string())
}

fn upsert_presence(ctx: &ReducerContext, online: bool, bump_interaction: bool) {
    if let Some(mut row) = ctx.db.presence_state().identity().find(ctx.sender()) {
        row.online = online;
        if bump_interaction {
            row.last_interaction_at = ctx.timestamp;
        }
        row.updated_at = ctx.timestamp;
        ctx.db.presence_state().identity().update(row);
    } else {
        ctx.db.presence_state().insert(PresenceState {
            identity: ctx.sender(),
            online,
            last_interaction_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        });
    }
}

#[spacetimedb::reducer]
pub fn touch_presence(ctx: &ReducerContext) -> Result<(), String> {
    upsert_presence(ctx, true, true);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_presence_offline(ctx: &ReducerContext) -> Result<(), String> {
    upsert_presence(ctx, false, false);
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_typing_state(
    ctx: &ReducerContext,
    scope_key: String,
    is_typing: bool,
) -> Result<(), String> {
    assert_or_err(
        !scope_key.trim().is_empty() && scope_key.len() <= 160,
        "invalid typing scope",
    )?;
    ensure_scope_allowed(ctx, &scope_key)?;

    let typing_key = format!("{scope_key}:{}", ctx.sender());

    if is_typing {
        if let Some(mut row) = ctx.db.typing_state().typing_key().find(&typing_key) {
            row.updated_at = ctx.timestamp;
            ctx.db.typing_state().typing_key().update(row);
        } else {
            ctx.db.typing_state().insert(TypingState {
                typing_key,
                scope_key,
                user_identity: ctx.sender(),
                updated_at: ctx.timestamp,
            });
        }
        upsert_presence(ctx, true, true);
    } else {
        ctx.db.typing_state().typing_key().delete(typing_key);
    }

    Ok(())
}

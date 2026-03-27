use spacetimedb::{Identity, ReducerContext, Table};

use crate::helpers::{
    assert_or_err,
    find_channel,
    find_friend_row,
    normalize_identity_string,
    ordered_pair,
};
use crate::schema::*;

fn upsert_read_state(ctx: &ReducerContext, scope_key: String) {
    let read_key = format!("{scope_key}:{}", ctx.sender());
    if let Some(mut row) = ctx.db.read_state().read_key().find(&read_key) {
        row.last_read_at = ctx.timestamp;
        row.updated_at = ctx.timestamp;
        ctx.db.read_state().read_key().update(row);
    } else {
        ctx.db.read_state().insert(ReadState {
            read_key,
            scope_key,
            user_identity: ctx.sender(),
            last_read_at: ctx.timestamp,
            updated_at: ctx.timestamp,
        });
    }
}

fn dm_scope_key(a: Identity, b: Identity) -> String {
    let (x, y) = ordered_pair(a, b);
    let x_norm = normalize_identity_string(&x.to_string());
    let y_norm = normalize_identity_string(&y.to_string());
    format!("dm:{x_norm}:{y_norm}")
}

#[spacetimedb::reducer]
pub fn mark_channel_read(ctx: &ReducerContext, channel_id: u64) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    let is_member = ctx
        .db
        .server_member()
        .server_id()
        .filter(channel_row.server_id)
        .any(|row| row.user_identity == ctx.sender());
    assert_or_err(is_member, "not a member of this channel server")?;

    upsert_read_state(ctx, format!("channel:{channel_id}"));
    Ok(())
}

#[spacetimedb::reducer]
pub fn mark_dm_read(ctx: &ReducerContext, other_identity: Identity) -> Result<(), String> {
    assert_or_err(other_identity != ctx.sender(), "cannot mark self dm scope")?;

    let friend_row = find_friend_row(ctx, ctx.sender(), other_identity)
        .ok_or_else(|| "friend relationship not found".to_string())?;
    assert_or_err(friend_row.status == FriendStatus::Accepted, "friendship not accepted")?;

    upsert_read_state(ctx, dm_scope_key(ctx.sender(), other_identity));
    Ok(())
}

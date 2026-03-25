use spacetimedb::{ReducerContext, Table};

use crate::helpers::{assert_or_err, find_channel, require_mod_or_owner};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn create_channel(
    ctx: &ReducerContext,
    server_id: u64,
    name: String,
    kind: ChannelKind,
    moderator_only: bool,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    assert_or_err((1..=100).contains(&name.len()), "channel name must be 1-100 chars")?;

    let max_position = ctx
        .db
        .channel()
        .iter()
        .filter(|c| c.server_id == server_id)
        .map(|c| c.position)
        .max()
        .unwrap_or(0);

    let next_position = if ctx.db.channel().iter().any(|c| c.server_id == server_id) {
        max_position.saturating_add(1)
    } else {
        0
    };

    ctx.db.channel().insert(Channel {
        id: 0,
        server_id,
        name,
        kind,
        position: next_position,
        moderator_only,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn update_channel(
    ctx: &ReducerContext,
    channel_id: u64,
    name: Option<String>,
    moderator_only: Option<bool>,
    position: Option<u32>,
) -> Result<(), String> {
    let mut channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    if let Some(new_name) = name {
        assert_or_err((1..=100).contains(&new_name.len()), "channel name must be 1-100 chars")?;
        channel_row.name = new_name;
    }
    if let Some(mod_only) = moderator_only {
        channel_row.moderator_only = mod_only;
    }
    if let Some(new_position) = position {
        channel_row.position = new_position;
    }

    ctx.db.channel().id().update(channel_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_channel(ctx: &ReducerContext, channel_id: u64) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    if channel_row.kind == ChannelKind::Text {
        let text_count = ctx
            .db
            .channel()
            .iter()
            .filter(|c| c.server_id == channel_row.server_id && c.kind == ChannelKind::Text)
            .count();
        assert_or_err(text_count > 1, "cannot delete the last text channel")?;
    }

    let message_ids: Vec<u64> = ctx
        .db
        .message()
        .iter()
        .filter(|m| m.channel_id == channel_id)
        .map(|m| m.id)
        .collect();

    for msg_id in message_ids {
        ctx.db.message().id().delete(msg_id);
    }

    let participant_keys: Vec<String> = ctx
        .db
        .voice_participant()
        .iter()
        .filter(|v| v.channel_id == channel_id)
        .map(|v| v.voice_key)
        .collect();

    for key in participant_keys {
        ctx.db.voice_participant().voice_key().delete(key);
    }

    ctx.db.channel().id().delete(channel_id);
    Ok(())
}

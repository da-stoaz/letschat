use spacetimedb::{ReducerContext, Table};

use crate::helpers::{assert_or_err, find_channel, require_mod_or_owner};
use crate::schema::*;

/// Bound the pinned-message table per channel so it can't grow without limit.
const MAX_PINS_PER_CHANNEL: usize = 50;

#[spacetimedb::reducer]
pub fn pin_message(ctx: &ReducerContext, channel_id: u64, message_id: u64) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    let message_row = ctx
        .db
        .message()
        .id()
        .find(message_id)
        .ok_or_else(|| "message not found".to_string())?;
    assert_or_err(
        message_row.channel_id == channel_id,
        "message does not belong to this channel",
    )?;
    assert_or_err(!message_row.deleted, "cannot pin a deleted message")?;

    // Idempotent: pinning an already-pinned message is a no-op.
    if ctx.db.pinned_message().message_id().find(message_id).is_some() {
        return Ok(());
    }

    let pin_count = ctx.db.pinned_message().channel_id().filter(channel_id).count();
    assert_or_err(
        pin_count < MAX_PINS_PER_CHANNEL,
        "this channel has reached its pin limit (50)",
    )?;

    ctx.db.pinned_message().insert(PinnedMessage {
        pin_id: 0,
        channel_id,
        message_id,
        pinned_by: ctx.sender(),
        pinned_at: ctx.timestamp,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn unpin_message(ctx: &ReducerContext, channel_id: u64, message_id: u64) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    let pin = ctx
        .db
        .pinned_message()
        .message_id()
        .find(message_id)
        .ok_or_else(|| "message is not pinned".to_string())?;
    assert_or_err(
        pin.channel_id == channel_id,
        "pin does not belong to this channel",
    )?;

    ctx.db.pinned_message().message_id().delete(message_id);

    Ok(())
}

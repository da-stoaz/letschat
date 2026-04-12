use spacetimedb::{ReducerContext, Table};

use crate::helpers::{
    assert_or_err, find_channel, member_key, require_member_role, require_mod_or_owner,
};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn send_message(ctx: &ReducerContext, channel_id: u64, content: String) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    let role = require_member_role(ctx, channel_row.server_id, ctx.sender())?;

    if channel_row.moderator_only {
        assert_or_err(role != Role::Member, "channel is moderator-only")?;
    }

    // Check if member is timed out
    if let Some(member_row) = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(channel_row.server_id, ctx.sender()))
    {
        if let Some(timeout_until) = member_row.timeout_until {
            assert_or_err(ctx.timestamp > timeout_until, "you are timed out")?;
        }
    }

    assert_or_err(
        (1..=4000).contains(&content.len()),
        "message must be 1-4000 chars",
    )?;

    ctx.db.message().insert(Message {
        id: 0,
        channel_id,
        sender_identity: ctx.sender(),
        content,
        sent_at: ctx.timestamp,
        edited_at: None,
        deleted: false,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn edit_message(
    ctx: &ReducerContext,
    message_id: u64,
    new_content: String,
) -> Result<(), String> {
    assert_or_err(
        (1..=4000).contains(&new_content.len()),
        "message must be 1-4000 chars",
    )?;

    let mut message_row = ctx
        .db
        .message()
        .id()
        .find(message_id)
        .ok_or_else(|| "message not found".to_string())?;

    assert_or_err(
        message_row.sender_identity == ctx.sender(),
        "only sender can edit message",
    )?;

    message_row.content = new_content;
    message_row.edited_at = Some(ctx.timestamp);
    ctx.db.message().id().update(message_row);

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_message(ctx: &ReducerContext, message_id: u64) -> Result<(), String> {
    let mut message_row = ctx
        .db
        .message()
        .id()
        .find(message_id)
        .ok_or_else(|| "message not found".to_string())?;

    if message_row.sender_identity != ctx.sender() {
        let channel_row = find_channel(ctx, message_row.channel_id)?;
        require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;
    }

    message_row.deleted = true;
    message_row.content = "[message deleted]".to_string();
    message_row.edited_at = Some(ctx.timestamp);
    ctx.db.message().id().update(message_row);

    Ok(())
}

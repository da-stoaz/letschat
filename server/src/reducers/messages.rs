use spacetimedb::{ReducerContext, Table};

use crate::helpers::{
    assert_or_err, find_channel, next_id, require_account, require_can_post, require_mod_or_owner,
};
use crate::schema::*;
use crate::storage_refs::{
    AttachmentScope, message_owner_key, remove_references, sync_message_references,
};

#[spacetimedb::reducer]
pub fn send_message(ctx: &ReducerContext, channel_id: u64, content: String) -> Result<(), String> {
    require_account(ctx)?;
    let channel_row = find_channel(ctx, channel_id)?;
    require_can_post(ctx, &channel_row)?;

    assert_or_err(
        (1..=4000).contains(&content.len()),
        "message must be 1-4000 chars",
    )?;

    let message_row = ctx.db.message().insert(Message {
        id: next_id!(ctx, message, id),
        channel_id,
        sender_identity: ctx.sender(),
        content,
        sent_at: ctx.timestamp,
        edited_at: None,
        deleted: false,
    });
    sync_message_references(
        ctx,
        message_owner_key(message_row.id),
        &message_row.content,
        ctx.sender(),
        AttachmentScope::Channel(channel_id),
    )?;

    Ok(())
}

#[spacetimedb::reducer]
pub fn edit_message(
    ctx: &ReducerContext,
    message_id: u64,
    new_content: String,
) -> Result<(), String> {
    require_account(ctx)?;
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
    // Authorship alone let a kicked, banned or timed-out sender keep writing
    // into the channel, and overwrite a moderator's deletion (BUG_ANALYSIS B4).
    assert_or_err(!message_row.deleted, "message was deleted")?;
    require_can_post(ctx, &find_channel(ctx, message_row.channel_id)?)?;

    sync_message_references(
        ctx,
        message_owner_key(message_id),
        &new_content,
        ctx.sender(),
        AttachmentScope::Channel(message_row.channel_id),
    )?;
    message_row.content = new_content;
    message_row.edited_at = Some(ctx.timestamp);
    ctx.db.message().id().update(message_row);

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_message(ctx: &ReducerContext, message_id: u64) -> Result<(), String> {
    require_account(ctx)?;
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
    remove_references(ctx, &message_owner_key(message_id));

    // Drop any pin for this message so the pins list never shows tombstones.
    if ctx.db.pinned_message().message_id().find(message_id).is_some() {
        ctx.db.pinned_message().message_id().delete(message_id);
    }

    Ok(())
}

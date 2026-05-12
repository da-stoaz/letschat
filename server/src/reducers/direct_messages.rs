use spacetimedb::{Identity, ReducerContext, Table};

use crate::helpers::{assert_or_err, find_friend_row, has_block_either_direction};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn send_direct_message(
    ctx: &ReducerContext,
    recipient_identity: Identity,
    content: String,
) -> Result<(), String> {
    assert_or_err(
        (1..=4000).contains(&content.len()),
        "message must be 1-4000 chars",
    )?;
    assert_or_err(
        !has_block_either_direction(ctx, ctx.sender(), recipient_identity),
        "blocked relationship exists",
    )?;

    let friend_row = find_friend_row(ctx, ctx.sender(), recipient_identity)
        .ok_or_else(|| "friend relationship not found".to_string())?;
    assert_or_err(
        friend_row.status == FriendStatus::Accepted,
        "friendship not accepted",
    )?;

    ctx.db.direct_message().insert(DirectMessage {
        id: 0,
        sender_identity: ctx.sender(),
        recipient_identity,
        content,
        sent_at: ctx.timestamp,
        edited_at: None,
        deleted_by_sender: false,
        deleted_by_recipient: false,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn edit_direct_message(
    ctx: &ReducerContext,
    message_id: u64,
    new_content: String,
) -> Result<(), String> {
    assert_or_err(
        (1..=4000).contains(&new_content.len()),
        "message must be 1-4000 chars",
    )?;

    let mut dm_row = ctx
        .db
        .direct_message()
        .id()
        .find(message_id)
        .ok_or_else(|| "direct message not found".to_string())?;

    assert_or_err(
        dm_row.sender_identity == ctx.sender(),
        "only sender can edit message",
    )?;

    dm_row.content = new_content;
    dm_row.edited_at = Some(ctx.timestamp);
    ctx.db.direct_message().id().update(dm_row);

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_direct_message(ctx: &ReducerContext, message_id: u64) -> Result<(), String> {
    let mut dm_row = ctx
        .db
        .direct_message()
        .id()
        .find(message_id)
        .ok_or_else(|| "direct message not found".to_string())?;

    if dm_row.sender_identity == ctx.sender() {
        dm_row.deleted_by_sender = true;
    } else if dm_row.recipient_identity == ctx.sender() {
        dm_row.deleted_by_recipient = true;
    } else {
        return Err("not authorized to delete this direct message".to_string());
    }

    if dm_row.deleted_by_sender && dm_row.deleted_by_recipient {
        ctx.db.direct_message().id().delete(dm_row.id);
    } else {
        ctx.db.direct_message().id().update(dm_row);
    }

    Ok(())
}

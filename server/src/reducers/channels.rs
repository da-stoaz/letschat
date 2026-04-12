use spacetimedb::{ReducerContext, Table};

use crate::helpers::{assert_or_err, find_channel, require_mod_or_owner};
use crate::schema::*;

const CHANNEL_SECTION_MAX_LEN: usize = 40;

fn normalize_channel_section(section: Option<String>) -> Result<Option<String>, String> {
    let normalized = section
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(section_name) = normalized.as_ref() {
        assert_or_err(
            section_name.len() <= CHANNEL_SECTION_MAX_LEN,
            "section name must be at most 40 chars",
        )?;
    }

    Ok(normalized)
}

fn same_channel_section(left: &Option<String>, right: &Option<String>) -> bool {
    left.as_deref() == right.as_deref()
}

fn is_message_channel(kind: &ChannelKind) -> bool {
    matches!(kind, ChannelKind::Text | ChannelKind::Announcement)
}

fn section_channels_sorted(
    ctx: &ReducerContext,
    server_id: u64,
    section: &Option<String>,
) -> Vec<Channel> {
    let mut rows: Vec<Channel> = ctx
        .db
        .channel()
        .iter()
        .filter(|channel| {
            channel.server_id == server_id && same_channel_section(&channel.section, section)
        })
        .collect();

    rows.sort_by(|left, right| {
        left.position
            .cmp(&right.position)
            .then(left.id.cmp(&right.id))
    });
    rows
}

fn normalize_section_positions(ctx: &ReducerContext, server_id: u64, section: &Option<String>) {
    let mut rows = section_channels_sorted(ctx, server_id, section);
    for (index, mut row) in rows.drain(..).enumerate() {
        let expected = index as u32;
        if row.position != expected {
            row.position = expected;
            ctx.db.channel().id().update(row);
        }
    }
}

fn move_channel_to_position(
    ctx: &ReducerContext,
    channel_row: Channel,
    target_section: &Option<String>,
    target_position: u32,
) {
    let server_id = channel_row.server_id;
    let source_section = channel_row.section.clone();

    let mut target_rows: Vec<Channel> = section_channels_sorted(ctx, channel_row.server_id, target_section)
        .into_iter()
        .filter(|row| row.id != channel_row.id)
        .collect();

    let insert_index = usize::min(target_position as usize, target_rows.len());
    let mut moved_row = channel_row;
    moved_row.section = target_section.clone();
    target_rows.insert(insert_index, moved_row);

    for (new_position, mut row) in target_rows.into_iter().enumerate() {
        let expected = new_position as u32;
        let section_changed = !same_channel_section(&row.section, target_section);
        if row.position != expected || section_changed {
            row.position = expected;
            row.section = target_section.clone();
            ctx.db.channel().id().update(row);
        }
    }

    if !same_channel_section(&source_section, target_section) {
        normalize_section_positions(ctx, server_id, &source_section);
    }
}

fn delete_channel_with_dependencies(ctx: &ReducerContext, channel_id: u64) {
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
}

#[spacetimedb::reducer]
pub fn create_channel(
    ctx: &ReducerContext,
    server_id: u64,
    name: String,
    kind: ChannelKind,
    section: Option<String>,
    moderator_only: bool,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    assert_or_err(
        (1..=100).contains(&name.len()),
        "channel name must be 1-100 chars",
    )?;
    let normalized_section = normalize_channel_section(section)?;

    let next_position = section_channels_sorted(ctx, server_id, &normalized_section).len() as u32;

    ctx.db.channel().insert(Channel {
        id: 0,
        server_id,
        name,
        kind,
        position: next_position,
        section: normalized_section,
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
        assert_or_err(
            (1..=100).contains(&new_name.len()),
            "channel name must be 1-100 chars",
        )?;
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
pub fn set_channel_section(
    ctx: &ReducerContext,
    channel_id: u64,
    section: Option<String>,
) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    let normalized_section = normalize_channel_section(section)?;
    if same_channel_section(&channel_row.section, &normalized_section) {
        return Ok(());
    }

    let next_position = section_channels_sorted(ctx, channel_row.server_id, &normalized_section)
        .into_iter()
        .filter(|row| row.id != channel_row.id)
        .count() as u32;

    move_channel_to_position(ctx, channel_row, &normalized_section, next_position);
    Ok(())
}

#[spacetimedb::reducer]
pub fn move_channel(ctx: &ReducerContext, channel_id: u64, direction: i32) -> Result<(), String> {
    assert_or_err(
        direction == -1 || direction == 1,
        "direction must be either -1 or 1",
    )?;

    let channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    let siblings: Vec<Channel> = section_channels_sorted(ctx, channel_row.server_id, &channel_row.section);
    let index = siblings
        .iter()
        .position(|row| row.id == channel_row.id)
        .ok_or_else(|| "channel not found in sibling group".to_string())?;

    let target_index = if direction < 0 {
        if index == 0 {
            return Ok(());
        }
        index - 1
    } else {
        if index + 1 >= siblings.len() {
            return Ok(());
        }
        index + 1
    };

    let target_section = channel_row.section.clone();
    move_channel_to_position(ctx, channel_row, &target_section, target_index as u32);
    Ok(())
}

#[spacetimedb::reducer]
pub fn move_channel_to(
    ctx: &ReducerContext,
    channel_id: u64,
    section: Option<String>,
    position: u32,
) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    let normalized_section = normalize_channel_section(section)?;
    move_channel_to_position(ctx, channel_row, &normalized_section, position);
    Ok(())
}

#[spacetimedb::reducer]
pub fn move_channel_relative(
    ctx: &ReducerContext,
    channel_id: u64,
    target_channel_id: u64,
    place_after: bool,
) -> Result<(), String> {
    assert_or_err(channel_id != target_channel_id, "source and target channel must differ")?;

    let channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    let target_row = find_channel(ctx, target_channel_id)?;
    assert_or_err(
        channel_row.server_id == target_row.server_id,
        "target channel must belong to the same server",
    )?;

    let target_section = target_row.section.clone();
    let target_rows = section_channels_sorted(ctx, channel_row.server_id, &target_section)
        .into_iter()
        .filter(|row| row.id != channel_row.id)
        .collect::<Vec<_>>();

    let target_index = target_rows
        .iter()
        .position(|row| row.id == target_channel_id)
        .ok_or_else(|| "target channel not found in destination section".to_string())?;

    let insert_index = if place_after {
        target_index + 1
    } else {
        target_index
    };

    move_channel_to_position(ctx, channel_row, &target_section, insert_index as u32);
    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_channel(ctx: &ReducerContext, channel_id: u64) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    if is_message_channel(&channel_row.kind) {
        let message_channel_count = ctx
            .db
            .channel()
            .iter()
            .filter(|c| c.server_id == channel_row.server_id && is_message_channel(&c.kind))
            .count();
        assert_or_err(
            message_channel_count > 1,
            "cannot delete the last message channel",
        )?;
    }

    delete_channel_with_dependencies(ctx, channel_id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_channel_section(
    ctx: &ReducerContext,
    server_id: u64,
    section: Option<String>,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;

    let normalized_section = normalize_channel_section(section)?;
    let section_channels: Vec<Channel> = ctx
        .db
        .channel()
        .iter()
        .filter(|channel| {
            channel.server_id == server_id
                && same_channel_section(&channel.section, &normalized_section)
        })
        .collect();

    let channel_ids: Vec<u64> = section_channels.iter().map(|channel| channel.id).collect();
    assert_or_err(!channel_ids.is_empty(), "section has no channels")?;

    let message_channels_in_section = section_channels
        .iter()
        .filter(|channel| is_message_channel(&channel.kind))
        .count();

    if message_channels_in_section > 0 {
        let total_message_channels = ctx
            .db
            .channel()
            .iter()
            .filter(|channel| channel.server_id == server_id && is_message_channel(&channel.kind))
            .count();
        assert_or_err(
            total_message_channels > message_channels_in_section,
            "cannot delete all message channels in a server",
        )?;
    }

    for channel_id in channel_ids {
        delete_channel_with_dependencies(ctx, channel_id);
    }

    Ok(())
}

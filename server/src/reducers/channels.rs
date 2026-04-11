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

    let max_position = ctx
        .db
        .channel()
        .iter()
        .filter(|c| {
            c.server_id == server_id
                && c.kind == kind
                && same_channel_section(&c.section, &normalized_section)
        })
        .map(|c| c.position)
        .max()
        .unwrap_or(0);

    let next_position = if ctx.db.channel().iter().any(|c| {
        c.server_id == server_id
            && c.kind == kind
            && same_channel_section(&c.section, &normalized_section)
    }) {
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
    let mut channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    let normalized_section = normalize_channel_section(section)?;
    if same_channel_section(&channel_row.section, &normalized_section) {
        return Ok(());
    }

    let max_position = ctx
        .db
        .channel()
        .iter()
        .filter(|c| {
            c.id != channel_row.id
                && c.server_id == channel_row.server_id
                && c.kind == channel_row.kind
                && same_channel_section(&c.section, &normalized_section)
        })
        .map(|c| c.position)
        .max()
        .unwrap_or(0);

    let next_position = if ctx.db.channel().iter().any(|c| {
        c.id != channel_row.id
            && c.server_id == channel_row.server_id
            && c.kind == channel_row.kind
            && same_channel_section(&c.section, &normalized_section)
    }) {
        max_position.saturating_add(1)
    } else {
        0
    };

    channel_row.section = normalized_section;
    channel_row.position = next_position;

    ctx.db.channel().id().update(channel_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn move_channel(ctx: &ReducerContext, channel_id: u64, direction: i32) -> Result<(), String> {
    assert_or_err(
        direction == -1 || direction == 1,
        "direction must be either -1 or 1",
    )?;

    let mut channel_row = find_channel(ctx, channel_id)?;
    require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;

    let mut siblings: Vec<Channel> = ctx
        .db
        .channel()
        .iter()
        .filter(|c| {
            c.server_id == channel_row.server_id
                && c.kind == channel_row.kind
                && same_channel_section(&c.section, &channel_row.section)
        })
        .collect();

    siblings.sort_by(|left, right| {
        left.position
            .cmp(&right.position)
            .then(left.id.cmp(&right.id))
    });

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

    let target_id = siblings[target_index].id;
    let target_position = siblings[target_index].position;
    let current_position = channel_row.position;

    let mut target_row = find_channel(ctx, target_id)?;
    channel_row.position = target_position;
    target_row.position = current_position;

    ctx.db.channel().id().update(channel_row);
    ctx.db.channel().id().update(target_row);
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

    delete_channel_with_dependencies(ctx, channel_id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_channel_section(
    ctx: &ReducerContext,
    server_id: u64,
    kind: ChannelKind,
    section: Option<String>,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;

    let normalized_section = normalize_channel_section(section)?;
    let channel_ids: Vec<u64> = ctx
        .db
        .channel()
        .iter()
        .filter(|channel| {
            channel.server_id == server_id
                && channel.kind == kind
                && same_channel_section(&channel.section, &normalized_section)
        })
        .map(|channel| channel.id)
        .collect();

    assert_or_err(!channel_ids.is_empty(), "section has no channels")?;

    if kind == ChannelKind::Text {
        let total_text_channels = ctx
            .db
            .channel()
            .iter()
            .filter(|channel| channel.server_id == server_id && channel.kind == ChannelKind::Text)
            .count();
        assert_or_err(
            total_text_channels > channel_ids.len(),
            "cannot delete all text channels in a server",
        )?;
    }

    for channel_id in channel_ids {
        delete_channel_with_dependencies(ctx, channel_id);
    }

    Ok(())
}

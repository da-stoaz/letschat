use spacetimedb::{ReducerContext, Table};

use crate::helpers::{assert_or_err, find_channel, require_member_role, voice_key};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn join_voice_channel(ctx: &ReducerContext, channel_id: u64) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    assert_or_err(channel_row.kind == ChannelKind::Voice, "not a voice channel")?;

    let role = require_member_role(ctx, channel_row.server_id, ctx.sender())?;
    if channel_row.moderator_only {
        assert_or_err(role != Role::Member, "channel is moderator-only")?;
    }

    let participant_count = ctx
        .db
        .voice_participant()
        .iter()
        .filter(|v| v.channel_id == channel_id)
        .count();
    assert_or_err(participant_count < 15, "voice channel is full")?;

    let existing_in_server: Vec<String> = ctx
        .db
        .voice_participant()
        .iter()
        .filter_map(|vp| {
            if vp.user_identity != ctx.sender() {
                return None;
            }
            ctx.db
                .channel()
                .id()
                .find(vp.channel_id)
                .filter(|ch| ch.server_id == channel_row.server_id)
                .map(|_| vp.voice_key)
        })
        .collect();

    for key in existing_in_server {
        ctx.db.voice_participant().voice_key().delete(key);
    }

    ctx.db.voice_participant().insert(VoiceParticipant {
        voice_key: voice_key(channel_id, ctx.sender()),
        channel_id,
        user_identity: ctx.sender(),
        joined_at: ctx.timestamp,
        muted: false,
        deafened: false,
        sharing_screen: false,
        sharing_camera: false,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn leave_voice_channel(ctx: &ReducerContext, channel_id: u64) -> Result<(), String> {
    ctx.db
        .voice_participant()
        .voice_key()
        .delete(voice_key(channel_id, ctx.sender()));
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_voice_state(
    ctx: &ReducerContext,
    channel_id: u64,
    muted: bool,
    deafened: bool,
    sharing_screen: bool,
    sharing_camera: bool,
) -> Result<(), String> {
    let mut participant_row = ctx
        .db
        .voice_participant()
        .voice_key()
        .find(voice_key(channel_id, ctx.sender()))
        .ok_or_else(|| "not in this voice channel".to_string())?;

    participant_row.muted = muted;
    participant_row.deafened = deafened;
    participant_row.sharing_screen = sharing_screen;
    participant_row.sharing_camera = sharing_camera;

    ctx.db.voice_participant().voice_key().update(participant_row);
    Ok(())
}

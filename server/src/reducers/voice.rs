use spacetimedb::{ReducerContext, Table};

use crate::helpers::{
    assert_or_err, find_channel, member_key, require_account, require_not_timed_out, voice_key,
};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn join_voice_channel(ctx: &ReducerContext, channel_id: u64) -> Result<(), String> {
    require_account(ctx)?;
    let channel_row = find_channel(ctx, channel_id)?;
    assert_or_err(
        channel_row.kind == ChannelKind::Voice,
        "not a voice channel",
    )?;

    let member = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(channel_row.server_id, ctx.sender()))
        .ok_or_else(|| "not a server member".to_string())?;
    if channel_row.moderator_only {
        assert_or_err(member.role != Role::Member, "channel is moderator-only")?;
    }
    // A timeout silences text; it has to silence voice too (BUG_ANALYSIS B13).
    require_not_timed_out(ctx, &member)?;

    let participant_count = ctx
        .db
        .voice_participant()
        .channel_id()
        .filter(channel_id)
        .count();
    assert_or_err(participant_count < 15, "voice channel is full")?;

    let existing_in_server: Vec<String> = ctx
        .db
        .voice_participant()
        .user_identity()
        .filter(ctx.sender())
        .filter_map(|vp| {
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
        connection_id: ctx.connection_id(),
    });

    Ok(())
}

#[spacetimedb::reducer(client_connected)]
pub fn on_client_connected(ctx: &ReducerContext) {
    if let Some(connection_id) = ctx.connection_id() {
        ctx.db.client_connection().insert(ClientConnection {
            connection_id,
            identity: ctx.sender(),
        });
    }
}

/// Voice presence is connection-scoped (see `VoiceParticipant::connection_id`):
/// when a client's socket dies — app killed, network drop, logout, module
/// republish — its presence rows go with it. This is the single authority for
/// stale-row cleanup; the client performs NO presence reconciliation. Rows from
/// other live connections of the same identity are left alone.
#[spacetimedb::reducer(client_disconnected)]
pub fn on_client_disconnected(ctx: &ReducerContext) {
    let sender = ctx.sender();
    let conn = ctx.connection_id();
    let owned_by_dying_connection =
        |row_conn: &Option<spacetimedb::ConnectionId>| row_conn.is_none() || *row_conn == conn;

    let voice_keys: Vec<String> = ctx
        .db
        .voice_participant()
        .user_identity()
        .filter(sender)
        .filter(|vp| owned_by_dying_connection(&vp.connection_id))
        .map(|vp| vp.voice_key)
        .collect();
    for key in voice_keys {
        ctx.db.voice_participant().voice_key().delete(key);
    }

    let dm_keys: Vec<String> = ctx
        .db
        .dm_voice_participant()
        .user_identity()
        .filter(sender)
        .filter(|vp| owned_by_dying_connection(&vp.connection_id))
        .map(|vp| vp.dm_voice_key)
        .collect();
    for key in dm_keys {
        ctx.db.dm_voice_participant().dm_voice_key().delete(key);
    }

    // Typing rows only ever went away through an explicit "stopped typing",
    // so a crash mid-sentence left them forever (BUG_ANALYSIS D1). Typing is
    // per keystroke; another open client re-sends it on the next one.
    let typing_keys: Vec<String> = ctx
        .db
        .typing_state()
        .by_user()
        .filter(sender)
        .map(|row| row.typing_key)
        .collect();
    for key in typing_keys {
        ctx.db.typing_state().typing_key().delete(key);
    }

    // Presence went offline only through an orderly sign-out, so a killed app
    // stayed "online" forever (BUG_ANALYSIS D2). Offline once the identity's
    // last connection is gone; connections from before this table existed
    // have no row, and the live client's heartbeat re-asserts within 25 s.
    if let Some(conn) = conn {
        ctx.db.client_connection().connection_id().delete(conn);
    }
    let still_connected = ctx.db.client_connection().identity().filter(sender).next().is_some();
    if !still_connected
        && let Some(mut presence) = ctx.db.presence_state().identity().find(sender)
        && presence.online
    {
        presence.online = false;
        presence.updated_at = ctx.timestamp;
        ctx.db.presence_state().identity().update(presence);
    }
}

#[spacetimedb::reducer]
pub fn leave_voice_channel(ctx: &ReducerContext, channel_id: u64) -> Result<(), String> {
    require_account(ctx)?;
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
    require_account(ctx)?;
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

    ctx.db
        .voice_participant()
        .voice_key()
        .update(participant_row);
    Ok(())
}

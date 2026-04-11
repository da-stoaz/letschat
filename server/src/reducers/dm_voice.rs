use spacetimedb::{Identity, ReducerContext, Table};

use crate::helpers::{
    assert_or_err, dm_room_key, dm_voice_key, find_friend_row, has_block_either_direction,
    ordered_pair,
};
use crate::schema::*;

const DM_VOICE_PARTICIPANT_LIMIT: usize = 2;

#[spacetimedb::reducer]
pub fn join_dm_voice(ctx: &ReducerContext, other_identity: Identity) -> Result<(), String> {
    assert_or_err(other_identity != ctx.sender(), "cannot call yourself")?;
    assert_or_err(
        !has_block_either_direction(ctx, ctx.sender(), other_identity),
        "blocked relationship exists",
    )?;

    let friend_row = find_friend_row(ctx, ctx.sender(), other_identity)
        .ok_or_else(|| "friend relationship not found".to_string())?;
    assert_or_err(
        friend_row.status == FriendStatus::Accepted,
        "friendship not accepted",
    )?;

    let room_key = dm_room_key(ctx.sender(), other_identity);
    let (user_a, user_b) = ordered_pair(ctx.sender(), other_identity);

    let existing_rows: Vec<String> = ctx
        .db
        .dm_voice_participant()
        .iter()
        .filter(|row| row.user_identity == ctx.sender())
        .map(|row| row.dm_voice_key)
        .collect();
    for key in existing_rows {
        ctx.db.dm_voice_participant().dm_voice_key().delete(key);
    }

    let participant_count = ctx
        .db
        .dm_voice_participant()
        .iter()
        .filter(|row| row.room_key == room_key)
        .count();
    assert_or_err(
        participant_count < DM_VOICE_PARTICIPANT_LIMIT,
        "dm voice call is full",
    )?;

    ctx.db.dm_voice_participant().insert(DmVoiceParticipant {
        dm_voice_key: dm_voice_key(&room_key, ctx.sender()),
        room_key,
        user_a,
        user_b,
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
pub fn leave_dm_voice(ctx: &ReducerContext, other_identity: Identity) -> Result<(), String> {
    let room_key = dm_room_key(ctx.sender(), other_identity);
    ctx.db
        .dm_voice_participant()
        .dm_voice_key()
        .delete(dm_voice_key(&room_key, ctx.sender()));
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_dm_voice_state(
    ctx: &ReducerContext,
    other_identity: Identity,
    muted: bool,
    deafened: bool,
    sharing_screen: bool,
    sharing_camera: bool,
) -> Result<(), String> {
    let room_key = dm_room_key(ctx.sender(), other_identity);
    let mut row = ctx
        .db
        .dm_voice_participant()
        .dm_voice_key()
        .find(dm_voice_key(&room_key, ctx.sender()))
        .ok_or_else(|| "not in this dm voice call".to_string())?;

    row.muted = muted;
    row.deafened = deafened;
    row.sharing_screen = sharing_screen;
    row.sharing_camera = sharing_camera;

    ctx.db.dm_voice_participant().dm_voice_key().update(row);
    Ok(())
}

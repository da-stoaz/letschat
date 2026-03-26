use spacetimedb::ViewContext;

use crate::schema::{
    Block,
    DmVoiceParticipant,
    Friend,
    block__view,
    dm_voice_participant__view,
    friend__view,
};

#[spacetimedb::view(accessor = my_friends, public)]
pub fn my_friends(ctx: &ViewContext) -> Vec<Friend> {
    let me = ctx.sender();
    let mut rows: Vec<Friend> = ctx.db.friend().user_a().filter(me).collect();
    rows.extend(ctx.db.friend().user_b().filter(me));
    rows
}

#[spacetimedb::view(accessor = my_blocks, public)]
pub fn my_blocks(ctx: &ViewContext) -> Vec<Block> {
    ctx.db.block().blocker().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = my_dm_voice_participants, public)]
pub fn my_dm_voice_participants(ctx: &ViewContext) -> Vec<DmVoiceParticipant> {
    let me = ctx.sender();
    let mut rows: Vec<DmVoiceParticipant> = ctx
        .db
        .dm_voice_participant()
        .user_a()
        .filter(me)
        .collect();
    rows.extend(ctx.db.dm_voice_participant().user_b().filter(me));
    rows
}

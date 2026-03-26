use spacetimedb::ViewContext;

use crate::schema::{Block, Friend, block__view, friend__view};

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

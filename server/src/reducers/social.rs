use spacetimedb::{Identity, ReducerContext, Table};

use crate::helpers::{
    assert_or_err,
    block_key,
    find_friend_row,
    friend_pair_key,
    has_block_either_direction,
    ordered_pair,
};
use crate::schema::*;

#[spacetimedb::reducer]
pub fn send_friend_request(ctx: &ReducerContext, target_identity: Identity) -> Result<(), String> {
    assert_or_err(target_identity != ctx.sender(), "cannot friend yourself")?;
    assert_or_err(
        !has_block_either_direction(ctx, ctx.sender(), target_identity),
        "blocked relationship exists",
    )?;
    assert_or_err(
        find_friend_row(ctx, ctx.sender(), target_identity).is_none(),
        "friend relationship already exists",
    )?;

    let (user_a, user_b) = ordered_pair(ctx.sender(), target_identity);
    ctx.db.friend().insert(Friend {
        pair_key: friend_pair_key(ctx.sender(), target_identity),
        user_a,
        user_b,
        status: FriendStatus::Pending,
        requested_by: ctx.sender(),
        updated_at: ctx.timestamp,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn accept_friend_request(ctx: &ReducerContext, requester_identity: Identity) -> Result<(), String> {
    let key = friend_pair_key(ctx.sender(), requester_identity);
    let mut friend_row = ctx
        .db
        .friend()
        .pair_key()
        .find(key)
        .ok_or_else(|| "friend request not found".to_string())?;

    assert_or_err(friend_row.status == FriendStatus::Pending, "request is not pending")?;
    assert_or_err(
        friend_row.requested_by != ctx.sender(),
        "cannot accept your own request",
    )?;

    friend_row.status = FriendStatus::Accepted;
    friend_row.updated_at = ctx.timestamp;
    ctx.db.friend().pair_key().update(friend_row);

    Ok(())
}

#[spacetimedb::reducer]
pub fn decline_friend_request(ctx: &ReducerContext, requester_identity: Identity) -> Result<(), String> {
    ctx.db
        .friend()
        .pair_key()
        .delete(friend_pair_key(ctx.sender(), requester_identity));
    Ok(())
}

#[spacetimedb::reducer]
pub fn remove_friend(ctx: &ReducerContext, other_identity: Identity) -> Result<(), String> {
    ctx.db
        .friend()
        .pair_key()
        .delete(friend_pair_key(ctx.sender(), other_identity));
    Ok(())
}

#[spacetimedb::reducer]
pub fn block_user(ctx: &ReducerContext, target_identity: Identity) -> Result<(), String> {
    assert_or_err(target_identity != ctx.sender(), "cannot block yourself")?;

    let key = block_key(ctx.sender(), target_identity);
    if ctx.db.block().block_key().find(&key).is_none() {
        ctx.db.block().insert(Block {
            block_key: key,
            blocker: ctx.sender(),
            blocked: target_identity,
            created_at: ctx.timestamp,
        });
    }

    ctx.db
        .friend()
        .pair_key()
        .delete(friend_pair_key(ctx.sender(), target_identity));

    Ok(())
}

#[spacetimedb::reducer]
pub fn unblock_user(ctx: &ReducerContext, target_identity: Identity) -> Result<(), String> {
    ctx.db
        .block()
        .block_key()
        .delete(block_key(ctx.sender(), target_identity));
    Ok(())
}

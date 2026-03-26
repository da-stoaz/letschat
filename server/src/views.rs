use std::collections::HashSet;

use spacetimedb::{Identity, ViewContext};

use crate::schema::{
    Block,
    DmVoiceParticipant,
    Friend,
    FriendStatus,
    PresenceState,
    TypingState,
    block__view,
    dm_voice_participant__view,
    friend__view,
    presence_state__view,
    typing_state__view,
    channel__view,
    server_member__view,
};

fn normalize_identity(value: &str) -> String {
    value.trim().to_lowercase()
}

fn parse_channel_scope(scope_key: &str) -> Option<u64> {
    let raw = scope_key.strip_prefix("channel:")?;
    raw.parse::<u64>().ok()
}

fn parse_dm_scope(scope_key: &str) -> Option<(String, String)> {
    let raw = scope_key.strip_prefix("dm:")?;
    let mut parts = raw.split(':');
    let a = parts.next()?;
    let b = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    Some((normalize_identity(a), normalize_identity(b)))
}

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

#[spacetimedb::view(accessor = my_presence_states, public)]
pub fn my_presence_states(ctx: &ViewContext) -> Vec<PresenceState> {
    let me = ctx.sender();
    let mut allowed_identities = HashSet::<Identity>::new();
    allowed_identities.insert(me);

    let joined_server_ids: HashSet<u64> = ctx
        .db
        .server_member()
        .user_identity()
        .filter(me)
        .map(|row| row.server_id)
        .collect();

    for server_id in joined_server_ids {
        for member in ctx.db.server_member().server_id().filter(server_id) {
            allowed_identities.insert(member.user_identity);
        }
    }

    for friend in ctx.db.friend().user_a().filter(me) {
        allowed_identities.insert(friend.user_b);
    }
    for friend in ctx.db.friend().user_b().filter(me) {
        allowed_identities.insert(friend.user_a);
    }

    let mut rows = Vec::<PresenceState>::new();
    for identity in allowed_identities {
        if let Some(row) = ctx.db.presence_state().identity().find(identity) {
            rows.push(row);
        }
    }
    rows
}

#[spacetimedb::view(accessor = my_typing_states, public)]
pub fn my_typing_states(ctx: &ViewContext) -> Vec<TypingState> {
    let me = ctx.sender();
    let me_normalized = normalize_identity(&me.to_string());

    let joined_server_ids: HashSet<u64> = ctx
        .db
        .server_member()
        .user_identity()
        .filter(me)
        .map(|row| row.server_id)
        .collect();

    let mut accepted_dm_partners = HashSet::<String>::new();
    for friend in ctx.db.friend().user_a().filter(me) {
        if friend.status == FriendStatus::Accepted {
            accepted_dm_partners.insert(normalize_identity(&friend.user_b.to_string()));
        }
    }
    for friend in ctx.db.friend().user_b().filter(me) {
        if friend.status == FriendStatus::Accepted {
            accepted_dm_partners.insert(normalize_identity(&friend.user_a.to_string()));
        }
    }

    let mut allowed_typers = HashSet::<Identity>::new();
    allowed_typers.insert(me);
    for server_id in &joined_server_ids {
        for member in ctx.db.server_member().server_id().filter(*server_id) {
            allowed_typers.insert(member.user_identity);
        }
    }
    for friend in ctx.db.friend().user_a().filter(me) {
        if friend.status == FriendStatus::Accepted {
            allowed_typers.insert(friend.user_b);
        }
    }
    for friend in ctx.db.friend().user_b().filter(me) {
        if friend.status == FriendStatus::Accepted {
            allowed_typers.insert(friend.user_a);
        }
    }

    let mut rows = Vec::<TypingState>::new();
    let mut seen = HashSet::<String>::new();
    for typer in allowed_typers {
        for row in ctx.db.typing_state().by_user().filter(typer) {
            if !seen.insert(row.typing_key.clone()) {
                continue;
            }

            if row.user_identity == me {
                rows.push(row);
                continue;
            }

            if let Some(channel_id) = parse_channel_scope(&row.scope_key) {
                if let Some(channel_row) = ctx.db.channel().id().find(channel_id) {
                    if joined_server_ids.contains(&channel_row.server_id) {
                        rows.push(row);
                    }
                }
                continue;
            }

            if let Some((a, b)) = parse_dm_scope(&row.scope_key) {
                if a != me_normalized && b != me_normalized {
                    continue;
                }
                let other = if a == me_normalized { b } else { a };
                if accepted_dm_partners.contains(&other) {
                    rows.push(row);
                }
            }
        }
    }

    rows
}

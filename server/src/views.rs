use std::collections::HashSet;
use std::ops::Bound;

use spacetimedb::{Identity, Timestamp, ViewContext};

use crate::schema::{
    Ban, Block, Channel, DirectMessage, DmServerInvite, DmVoiceParticipant, Friend, FriendStatus,
    Invite, JoinRequest, Message, PresenceState, ReadState, Role, Server, ServerMember, TypingState,
    User, VoiceParticipant, archive_service__view, ban__view, block__view, channel__view,
    direct_message__view, dm_server_invite__view, dm_voice_participant__view, friend__view,
    invite__view, join_request__view, message__view, presence_state__view, read_state__view,
    server__view, server_member__view, typing_state__view, user__view, voice_participant__view,
};

/// Server ids the caller is a member of. Shared by several scoped views below.
fn my_server_ids(ctx: &ViewContext) -> HashSet<u64> {
    ctx.db
        .server_member()
        .user_identity()
        .filter(ctx.sender())
        .map(|member| member.server_id)
        .collect()
}

/// Server ids the caller moderates (Owner or Moderator). Shared by the views
/// that expose moderation surfaces (join requests, ban list, visible users).
fn moderated_server_ids(ctx: &ViewContext) -> HashSet<u64> {
    ctx.db
        .server_member()
        .user_identity()
        .filter(ctx.sender())
        .filter(|member| member.role == Role::Owner || member.role == Role::Moderator)
        .map(|member| member.server_id)
        .collect()
}

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
    let mut rows: Vec<DmVoiceParticipant> =
        ctx.db.dm_voice_participant().user_a().filter(me).collect();
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

#[spacetimedb::view(accessor = my_read_states, public)]
pub fn my_read_states(ctx: &ViewContext) -> Vec<ReadState> {
    ctx.db.read_state().by_user().filter(ctx.sender()).collect()
}

// ─── Space-scoped views (replace the formerly-public base tables) ──────────────

/// Spaces the caller can see: ones they're a member of, plus any space opted in
/// to Discover. Mirrors what the client already filters for `syncServers`
/// (joined) and `syncDiscover` (discoverable, not-joined).
#[spacetimedb::view(accessor = my_servers, public)]
pub fn my_servers(ctx: &ViewContext) -> Vec<Server> {
    let mut rows = Vec::<Server>::new();
    let mut seen = HashSet::<u64>::new();
    // Spaces the caller belongs to (looked up by id).
    for server_id in my_server_ids(ctx) {
        if let Some(server) = ctx.db.server().id().find(server_id) {
            if seen.insert(server.id) {
                rows.push(server);
            }
        }
    }
    // Spaces opted in to Discover.
    for server in ctx.db.server().is_discoverable().filter(true) {
        if seen.insert(server.id) {
            rows.push(server);
        }
    }
    rows
}

/// Members of spaces the caller belongs to, plus members of discoverable spaces
/// (so Discover cards can show member counts for spaces the caller hasn't
/// joined). A superset of every membership view the client builds.
#[spacetimedb::view(accessor = my_server_members, public)]
pub fn my_server_members(ctx: &ViewContext) -> Vec<ServerMember> {
    let mut visible = my_server_ids(ctx);
    for server in ctx.db.server().is_discoverable().filter(true) {
        visible.insert(server.id);
    }

    let mut rows = Vec::<ServerMember>::new();
    for server_id in &visible {
        rows.extend(ctx.db.server_member().server_id().filter(*server_id));
    }
    rows
}

/// Channel messages for spaces the caller is a member of.
#[spacetimedb::view(accessor = my_channel_messages, public)]
pub fn my_channel_messages(ctx: &ViewContext) -> Vec<Message> {
    let mine = my_server_ids(ctx);
    let mut rows = Vec::<Message>::new();
    for server_id in &mine {
        for channel in ctx.db.channel().server_id().filter(*server_id) {
            rows.extend(ctx.db.message().channel_id().filter(channel.id));
        }
    }
    rows
}

/// Direct messages the caller sent or received.
#[spacetimedb::view(accessor = my_direct_messages, public)]
pub fn my_direct_messages(ctx: &ViewContext) -> Vec<DirectMessage> {
    let me = ctx.sender();
    let mut rows: Vec<DirectMessage> =
        ctx.db.direct_message().sender_identity().filter(me).collect();
    rows.extend(ctx.db.direct_message().recipient_identity().filter(me));
    rows
}

/// Invites for spaces the caller belongs to (management UI). Joining uses the
/// `use_invite` reducer with the token, so non-members never need to read this.
#[spacetimedb::view(accessor = my_invites, public)]
pub fn my_invites(ctx: &ViewContext) -> Vec<Invite> {
    let mine = my_server_ids(ctx);
    let mut rows = Vec::<Invite>::new();
    for server_id in &mine {
        rows.extend(ctx.db.invite().server_id().filter(*server_id));
    }
    rows
}

/// Join requests the caller made, plus requests for spaces they moderate.
#[spacetimedb::view(accessor = my_join_requests, public)]
pub fn my_join_requests(ctx: &ViewContext) -> Vec<JoinRequest> {
    let me = ctx.sender();
    let moderated = moderated_server_ids(ctx);

    // The caller's own requests.
    let mut rows: Vec<JoinRequest> = ctx.db.join_request().user_identity().filter(me).collect();
    // Requests for spaces the caller moderates (skip their own to avoid dupes).
    for server_id in &moderated {
        for request in ctx.db.join_request().server_id().filter(*server_id) {
            if request.user_identity != me {
                rows.push(request);
            }
        }
    }
    rows
}

/// DM-delivered space invites the caller sent or received.
#[spacetimedb::view(accessor = my_dm_server_invites, public)]
pub fn my_dm_server_invites(ctx: &ViewContext) -> Vec<DmServerInvite> {
    let me = ctx.sender();
    let mut rows: Vec<DmServerInvite> =
        ctx.db.dm_server_invite().by_sender().filter(me).collect();
    rows.extend(ctx.db.dm_server_invite().by_recipient().filter(me));
    rows
}

/// Channels for spaces the caller is a member of.
#[spacetimedb::view(accessor = my_channels, public)]
pub fn my_channels(ctx: &ViewContext) -> Vec<Channel> {
    let mine = my_server_ids(ctx);
    let mut rows = Vec::<Channel>::new();
    for server_id in &mine {
        rows.extend(ctx.db.channel().server_id().filter(*server_id));
    }
    rows
}

/// Voice presence for channels in spaces the caller is a member of.
#[spacetimedb::view(accessor = my_voice_participants, public)]
pub fn my_voice_participants(ctx: &ViewContext) -> Vec<VoiceParticipant> {
    let mine = my_server_ids(ctx);
    let mut rows = Vec::<VoiceParticipant>::new();
    for server_id in &mine {
        for channel in ctx.db.channel().server_id().filter(*server_id) {
            rows.extend(ctx.db.voice_participant().channel_id().filter(channel.id));
        }
    }
    rows
}

/// The directory of people the caller can actually see — instead of every
/// account on the instance. The union covers everyone the UI can render a name
/// or avatar for: members of shared spaces, friends (pending or accepted),
/// people who requested to join spaces the caller moderates, and DM space-invite
/// counterparties. A missing identity degrades to a truncated id in the UI, not
/// an error, so an over-tight set fails safe.
#[spacetimedb::view(accessor = my_visible_users, public)]
pub fn my_visible_users(ctx: &ViewContext) -> Vec<User> {
    let me = ctx.sender();
    let mut allowed = HashSet::<Identity>::new();
    allowed.insert(me);

    // Members of spaces the caller belongs to.
    let mine = my_server_ids(ctx);
    for server_id in &mine {
        for member in ctx.db.server_member().server_id().filter(*server_id) {
            allowed.insert(member.user_identity);
        }
    }

    // Friends (pending requests render too, so include both directions).
    for friend in ctx.db.friend().user_a().filter(me) {
        allowed.insert(friend.user_b);
    }
    for friend in ctx.db.friend().user_b().filter(me) {
        allowed.insert(friend.user_a);
    }

    // People tied to spaces the caller moderates: join-requesters (not members
    // yet) and banned users (no longer members) — so both lists render names.
    for server_id in &moderated_server_ids(ctx) {
        for request in ctx.db.join_request().server_id().filter(*server_id) {
            allowed.insert(request.user_identity);
        }
        for ban in ctx.db.ban().server_id().filter(*server_id) {
            allowed.insert(ban.user_identity);
        }
    }

    // DM space-invite counterparties.
    for invite in ctx.db.dm_server_invite().by_sender().filter(me) {
        allowed.insert(invite.recipient_identity);
    }
    for invite in ctx.db.dm_server_invite().by_recipient().filter(me) {
        allowed.insert(invite.sender_identity);
    }

    let mut rows = Vec::<User>::new();
    for identity in allowed {
        if let Some(user) = ctx.db.user().identity().find(identity) {
            rows.push(user);
        }
    }
    rows
}

/// Bans for spaces the caller moderates (Owner/Moderator) — powers the ban-list
/// moderation modal. Non-moderators get an empty set.
#[spacetimedb::view(accessor = my_bans, public)]
pub fn my_bans(ctx: &ViewContext) -> Vec<Ban> {
    let mut rows = Vec::<Ban>::new();
    for server_id in &moderated_server_ids(ctx) {
        rows.extend(ctx.db.ban().server_id().filter(*server_id));
    }
    rows
}

// ─── Archive replication views (storage-tiering, plan 2 phase 1) ───────────────
//
// Full-table views gated to the registered archive worker identity. Every
// sensitive base table is private, and private tables are not emitted into the
// generated client bindings at all — so the worker cannot subscribe to them
// directly. These views give the worker (and ONLY the worker) a complete,
// live-maintained copy of each durable table to mirror into PostgreSQL. For any
// other caller they return an empty set, exactly like the `my_*` views do for
// rows outside the caller's scope.
//
// Scope: durable domain data only. The ephemeral runtime tables — presence,
// typing, and voice participants — are intentionally NOT archived: they are
// reconstructed by clients on reconnect, carry no archival value, and (typing
// especially) would generate pathological write churn into the cold store.

/// Singleton-id used by [`crate::schema::ArchiveService`]. Mirrors the constant
/// in `reducers/archive.rs` (kept local to avoid a cross-module pub constant).
const ARCHIVE_SERVICE_ID: u8 = 1;

/// True if the subscribing identity is the registered archive worker.
fn is_archive_service(ctx: &ViewContext) -> bool {
    ctx.db
        .archive_service()
        .id()
        .find(ARCHIVE_SERVICE_ID)
        .map(|row| row.service_identity == ctx.sender())
        .unwrap_or(false)
}

/// An unbounded range over a btree-indexed column — i.e. "every row". View
/// handles are read-only and deliberately do NOT implement `Table`, so `iter()`
/// is unavailable; a full scan is expressed as an unbounded index range instead.
/// Every row is present in every btree index, so this returns the whole table.
fn all<T>() -> (Bound<T>, Bound<T>) {
    (Bound::Unbounded, Bound::Unbounded)
}

#[spacetimedb::view(accessor = archive_users, public)]
pub fn archive_users(ctx: &ViewContext) -> Vec<User> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.user().created_at().filter(all::<Timestamp>()).collect()
}

#[spacetimedb::view(accessor = archive_servers, public)]
pub fn archive_servers(ctx: &ViewContext) -> Vec<Server> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.server().is_discoverable().filter(all::<bool>()).collect()
}

#[spacetimedb::view(accessor = archive_server_members, public)]
pub fn archive_server_members(ctx: &ViewContext) -> Vec<ServerMember> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.server_member().server_id().filter(all::<u64>()).collect()
}

#[spacetimedb::view(accessor = archive_bans, public)]
pub fn archive_bans(ctx: &ViewContext) -> Vec<Ban> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.ban().server_id().filter(all::<u64>()).collect()
}

#[spacetimedb::view(accessor = archive_join_requests, public)]
pub fn archive_join_requests(ctx: &ViewContext) -> Vec<JoinRequest> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.join_request().server_id().filter(all::<u64>()).collect()
}

#[spacetimedb::view(accessor = archive_invites, public)]
pub fn archive_invites(ctx: &ViewContext) -> Vec<Invite> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.invite().server_id().filter(all::<u64>()).collect()
}

#[spacetimedb::view(accessor = archive_dm_server_invites, public)]
pub fn archive_dm_server_invites(ctx: &ViewContext) -> Vec<DmServerInvite> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.dm_server_invite().by_sender().filter(all::<Identity>()).collect()
}

#[spacetimedb::view(accessor = archive_channels, public)]
pub fn archive_channels(ctx: &ViewContext) -> Vec<Channel> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.channel().server_id().filter(all::<u64>()).collect()
}

#[spacetimedb::view(accessor = archive_messages, public)]
pub fn archive_messages(ctx: &ViewContext) -> Vec<Message> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.message().channel_id().filter(all::<u64>()).collect()
}

#[spacetimedb::view(accessor = archive_direct_messages, public)]
pub fn archive_direct_messages(ctx: &ViewContext) -> Vec<DirectMessage> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.direct_message().sender_identity().filter(all::<Identity>()).collect()
}

#[spacetimedb::view(accessor = archive_friends, public)]
pub fn archive_friends(ctx: &ViewContext) -> Vec<Friend> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.friend().user_a().filter(all::<Identity>()).collect()
}

#[spacetimedb::view(accessor = archive_blocks, public)]
pub fn archive_blocks(ctx: &ViewContext) -> Vec<Block> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.block().blocker().filter(all::<Identity>()).collect()
}

#[spacetimedb::view(accessor = archive_read_states, public)]
pub fn archive_read_states(ctx: &ViewContext) -> Vec<ReadState> {
    if !is_archive_service(ctx) {
        return Vec::new();
    }
    ctx.db.read_state().updated_at().filter(all::<Timestamp>()).collect()
}

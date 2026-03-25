use spacetimedb::rand::{distributions::Alphanumeric, Rng};
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, TimeDuration, Timestamp};

#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum Role {
    Member,
    Moderator,
    Owner,
}

#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum ChannelKind {
    Text,
    Voice,
}

#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum FriendStatus {
    Pending,
    Accepted,
}

#[spacetimedb::table(accessor = user, public)]
pub struct User {
    #[primary_key]
    identity: Identity,
    #[unique]
    username: String,
    display_name: String,
    avatar_url: Option<String>,
    #[index(btree)]
    created_at: Timestamp,
}

#[spacetimedb::table(accessor = server, public)]
pub struct Server {
    #[primary_key]
    #[auto_inc]
    id: u64,
    name: String,
    #[index(btree)]
    owner_identity: Identity,
    icon_url: Option<String>,
    created_at: Timestamp,
}

#[spacetimedb::table(
    accessor = server_member,
    public,
    index(accessor = by_server_and_user, btree(columns = [server_id, user_identity]))
)]
pub struct ServerMember {
    #[primary_key]
    member_key: String,
    #[index(btree)]
    server_id: u64,
    #[index(btree)]
    user_identity: Identity,
    role: Role,
    joined_at: Timestamp,
}

#[spacetimedb::table(
    accessor = ban,
    public,
    index(accessor = by_server_and_user, btree(columns = [server_id, user_identity]))
)]
pub struct Ban {
    #[primary_key]
    ban_key: String,
    #[index(btree)]
    server_id: u64,
    #[index(btree)]
    user_identity: Identity,
    banned_by: Identity,
    reason: Option<String>,
    banned_at: Timestamp,
}

#[spacetimedb::table(accessor = invite, public)]
pub struct Invite {
    #[primary_key]
    token: String,
    #[index(btree)]
    server_id: u64,
    created_by: Identity,
    expires_at: Timestamp,
    max_uses: Option<u32>,
    use_count: u32,
}

#[spacetimedb::table(
    accessor = channel,
    public,
    index(accessor = by_server_and_position, btree(columns = [server_id, position]))
)]
pub struct Channel {
    #[primary_key]
    #[auto_inc]
    id: u64,
    #[index(btree)]
    server_id: u64,
    name: String,
    kind: ChannelKind,
    position: u32,
    moderator_only: bool,
}

#[spacetimedb::table(
    accessor = message,
    public,
    index(accessor = by_channel_and_sent_at, btree(columns = [channel_id, sent_at]))
)]
pub struct Message {
    #[primary_key]
    #[auto_inc]
    id: u64,
    #[index(btree)]
    channel_id: u64,
    sender_identity: Identity,
    content: String,
    sent_at: Timestamp,
    edited_at: Option<Timestamp>,
    deleted: bool,
}

#[spacetimedb::table(
    accessor = voice_participant,
    public,
    index(accessor = by_channel_and_user, btree(columns = [channel_id, user_identity]))
)]
pub struct VoiceParticipant {
    #[primary_key]
    voice_key: String,
    #[index(btree)]
    channel_id: u64,
    user_identity: Identity,
    joined_at: Timestamp,
    muted: bool,
    deafened: bool,
    sharing_screen: bool,
    sharing_camera: bool,
}

#[spacetimedb::table(accessor = friend, public)]
pub struct Friend {
    #[primary_key]
    pair_key: String,
    #[index(btree)]
    user_a: Identity,
    #[index(btree)]
    user_b: Identity,
    status: FriendStatus,
    requested_by: Identity,
    updated_at: Timestamp,
}

#[spacetimedb::table(accessor = block, public)]
pub struct Block {
    #[primary_key]
    block_key: String,
    #[index(btree)]
    blocker: Identity,
    #[index(btree)]
    blocked: Identity,
    created_at: Timestamp,
}

#[spacetimedb::table(
    accessor = direct_message,
    public,
    index(accessor = by_sender_recipient_sent_at, btree(columns = [sender_identity, recipient_identity, sent_at]))
)]
pub struct DirectMessage {
    #[primary_key]
    #[auto_inc]
    id: u64,
    sender_identity: Identity,
    recipient_identity: Identity,
    content: String,
    sent_at: Timestamp,
    deleted_by_sender: bool,
    deleted_by_recipient: bool,
}

fn assert_or_err(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

fn is_valid_username(username: &str) -> bool {
    let len_ok = (2..=32).contains(&username.len());
    len_ok
        && username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn member_key(server_id: u64, user_identity: Identity) -> String {
    format!("{server_id}:{user_identity}")
}

fn ban_key(server_id: u64, user_identity: Identity) -> String {
    format!("{server_id}:{user_identity}")
}

fn voice_key(channel_id: u64, user_identity: Identity) -> String {
    format!("{channel_id}:{user_identity}")
}

fn ordered_pair(a: Identity, b: Identity) -> (Identity, Identity) {
    if a <= b {
        (a, b)
    } else {
        (b, a)
    }
}

fn friend_pair_key(a: Identity, b: Identity) -> String {
    let (x, y) = ordered_pair(a, b);
    format!("{x}:{y}")
}

fn block_key(blocker: Identity, blocked: Identity) -> String {
    format!("{blocker}:{blocked}")
}

fn has_member_role(ctx: &ReducerContext, server_id: u64, user_identity: Identity) -> Option<Role> {
    ctx.db
        .server_member()
        .member_key()
        .find(member_key(server_id, user_identity))
        .map(|m| m.role)
}

fn require_member_role(ctx: &ReducerContext, server_id: u64, user_identity: Identity) -> Result<Role, String> {
    has_member_role(ctx, server_id, user_identity).ok_or_else(|| "not a server member".to_string())
}

fn require_mod_or_owner(ctx: &ReducerContext, server_id: u64, user_identity: Identity) -> Result<Role, String> {
    match require_member_role(ctx, server_id, user_identity)? {
        Role::Moderator => Ok(Role::Moderator),
        Role::Owner => Ok(Role::Owner),
        Role::Member => Err("insufficient permissions".to_string()),
    }
}

fn require_owner(ctx: &ReducerContext, server_id: u64, user_identity: Identity) -> Result<(), String> {
    let role = require_member_role(ctx, server_id, user_identity)?;
    assert_or_err(role == Role::Owner, "owner permission required")
}

fn find_channel(ctx: &ReducerContext, channel_id: u64) -> Result<Channel, String> {
    ctx.db
        .channel()
        .id()
        .find(channel_id)
        .ok_or_else(|| "channel not found".to_string())
}

fn is_banned(ctx: &ReducerContext, server_id: u64, user_identity: Identity) -> bool {
    ctx.db
        .ban()
        .ban_key()
        .find(ban_key(server_id, user_identity))
        .is_some()
}

fn find_friend_row(ctx: &ReducerContext, a: Identity, b: Identity) -> Option<Friend> {
    ctx.db.friend().pair_key().find(friend_pair_key(a, b))
}

fn has_block_either_direction(ctx: &ReducerContext, a: Identity, b: Identity) -> bool {
    ctx.db.block().block_key().find(block_key(a, b)).is_some()
        || ctx.db.block().block_key().find(block_key(b, a)).is_some()
}

#[spacetimedb::reducer]
pub fn register_user(ctx: &ReducerContext, username: String, display_name: String) -> Result<(), String> {
    assert_or_err(is_valid_username(&username), "username must be 2-32 and alphanumeric/underscore")?;
    assert_or_err(
        ctx.db.user().username().find(&username).is_none(),
        "username already exists",
    )?;
    assert_or_err(
        ctx.db.user().identity().find(ctx.sender()).is_none(),
        "user already registered for this identity",
    )?;

    ctx.db.user().insert(User {
        identity: ctx.sender(),
        username,
        display_name,
        avatar_url: None,
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_profile(
    ctx: &ReducerContext,
    display_name: Option<String>,
    avatar_url: Option<String>,
) -> Result<(), String> {
    let mut user_row = ctx
        .db
        .user()
        .identity()
        .find(ctx.sender())
        .ok_or_else(|| "user not found".to_string())?;

    if let Some(name) = display_name {
        user_row.display_name = name;
    }
    if avatar_url.is_some() {
        user_row.avatar_url = avatar_url;
    }

    ctx.db.user().identity().update(user_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn create_server(ctx: &ReducerContext, name: String) -> Result<(), String> {
    assert_or_err((2..=100).contains(&name.len()), "server name must be 2-100 chars")?;

    let server_row = ctx.db.server().insert(Server {
        id: 0,
        name,
        owner_identity: ctx.sender(),
        icon_url: None,
        created_at: ctx.timestamp,
    });

    let server_id = server_row.id;

    ctx.db.server_member().insert(ServerMember {
        member_key: member_key(server_id, ctx.sender()),
        server_id,
        user_identity: ctx.sender(),
        role: Role::Owner,
        joined_at: ctx.timestamp,
    });

    ctx.db.channel().insert(Channel {
        id: 0,
        server_id,
        name: "general".to_string(),
        kind: ChannelKind::Text,
        position: 0,
        moderator_only: false,
    });

    ctx.db.channel().insert(Channel {
        id: 0,
        server_id,
        name: "General".to_string(),
        kind: ChannelKind::Voice,
        position: 0,
        moderator_only: false,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn rename_server(ctx: &ReducerContext, server_id: u64, new_name: String) -> Result<(), String> {
    assert_or_err((2..=100).contains(&new_name.len()), "server name must be 2-100 chars")?;
    require_owner(ctx, server_id, ctx.sender())?;

    let mut server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;
    server_row.name = new_name;
    ctx.db.server().id().update(server_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_server(ctx: &ReducerContext, server_id: u64) -> Result<(), String> {
    require_owner(ctx, server_id, ctx.sender())?;

    let channel_ids: Vec<u64> = ctx
        .db
        .channel()
        .iter()
        .filter(|c| c.server_id == server_id)
        .map(|c| c.id)
        .collect();

    for channel_id in &channel_ids {
        let messages: Vec<Message> = ctx
            .db
            .message()
            .iter()
            .filter(|m| m.channel_id == *channel_id)
            .collect();
        for msg in messages {
            ctx.db.message().id().delete(msg.id);
        }

        let participants: Vec<VoiceParticipant> = ctx
            .db
            .voice_participant()
            .iter()
            .filter(|v| v.channel_id == *channel_id)
            .collect();
        for vp in participants {
            ctx.db.voice_participant().voice_key().delete(&vp.voice_key);
        }
    }

    let members: Vec<ServerMember> = ctx
        .db
        .server_member()
        .iter()
        .filter(|m| m.server_id == server_id)
        .collect();
    for member in members {
        ctx.db.server_member().member_key().delete(&member.member_key);
    }

    let bans: Vec<Ban> = ctx.db.ban().iter().filter(|b| b.server_id == server_id).collect();
    for ban_row in bans {
        ctx.db.ban().ban_key().delete(&ban_row.ban_key);
    }

    let invites: Vec<Invite> = ctx
        .db
        .invite()
        .iter()
        .filter(|i| i.server_id == server_id)
        .collect();
    for invite_row in invites {
        ctx.db.invite().token().delete(&invite_row.token);
    }

    for channel_id in channel_ids {
        ctx.db.channel().id().delete(channel_id);
    }

    ctx.db.server().id().delete(server_id);
    Ok(())
}

#[spacetimedb::reducer]
pub fn create_invite(
    ctx: &ReducerContext,
    server_id: u64,
    expires_in_seconds: Option<u64>,
    max_uses: Option<u32>,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    assert_or_err(
        ctx.db.server().id().find(server_id).is_some(),
        "server not found",
    )?;

    let token: String = ctx
        .rng()
        .sample_iter(&Alphanumeric)
        .take(8)
        .map(char::from)
        .collect();

    let expiry = if let Some(seconds) = expires_in_seconds {
        ctx.timestamp + TimeDuration::from_micros((seconds as i64) * 1_000_000)
    } else {
        ctx.timestamp + TimeDuration::from_micros(100_i64 * 365 * 24 * 3600 * 1_000_000)
    };

    ctx.db.invite().insert(Invite {
        token: token.clone(),
        server_id,
        created_by: ctx.sender(),
        expires_at: expiry,
        max_uses,
        use_count: 0,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn use_invite(ctx: &ReducerContext, token: String) -> Result<(), String> {
    let mut invite_row = ctx
        .db
        .invite()
        .token()
        .find(&token)
        .ok_or_else(|| "invite not found".to_string())?;

    assert_or_err(ctx.timestamp <= invite_row.expires_at, "invite expired")?;
    if let Some(max_uses) = invite_row.max_uses {
        assert_or_err(invite_row.use_count < max_uses, "invite max uses reached")?;
    }

    assert_or_err(!is_banned(ctx, invite_row.server_id, ctx.sender()), "you are banned")?;
    assert_or_err(
        has_member_role(ctx, invite_row.server_id, ctx.sender()).is_none(),
        "already a member",
    )?;

    ctx.db.server_member().insert(ServerMember {
        member_key: member_key(invite_row.server_id, ctx.sender()),
        server_id: invite_row.server_id,
        user_identity: ctx.sender(),
        role: Role::Member,
        joined_at: ctx.timestamp,
    });

    invite_row.use_count += 1;
    ctx.db.invite().token().update(invite_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn kick_member(ctx: &ReducerContext, server_id: u64, target_identity: Identity) -> Result<(), String> {
    let caller_role = require_mod_or_owner(ctx, server_id, ctx.sender())?;
    let target_role = require_member_role(ctx, server_id, target_identity)?;

    if matches!(target_role, Role::Moderator | Role::Owner) {
        assert_or_err(caller_role == Role::Owner, "only owner can kick moderators/owner")?;
    }

    ctx.db
        .server_member()
        .member_key()
        .delete(member_key(server_id, target_identity));

    let channel_ids: Vec<u64> = ctx
        .db
        .channel()
        .iter()
        .filter(|c| c.server_id == server_id)
        .map(|c| c.id)
        .collect();

    for channel_id in channel_ids {
        ctx.db
            .voice_participant()
            .voice_key()
            .delete(voice_key(channel_id, target_identity));
    }

    Ok(())
}

#[spacetimedb::reducer]
pub fn ban_member(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
    reason: Option<String>,
) -> Result<(), String> {
    let caller_role = require_mod_or_owner(ctx, server_id, ctx.sender())?;
    let target_role = require_member_role(ctx, server_id, target_identity)?;

    if matches!(target_role, Role::Moderator | Role::Owner) {
        assert_or_err(caller_role == Role::Owner, "only owner can ban moderators/owner")?;
    }

    let key = ban_key(server_id, target_identity);
    if ctx.db.ban().ban_key().find(&key).is_none() {
        ctx.db.ban().insert(Ban {
            ban_key: key,
            server_id,
            user_identity: target_identity,
            banned_by: ctx.sender(),
            reason,
            banned_at: ctx.timestamp,
        });
    }

    ctx.db
        .server_member()
        .member_key()
        .delete(member_key(server_id, target_identity));

    Ok(())
}

#[spacetimedb::reducer]
pub fn unban_member(ctx: &ReducerContext, server_id: u64, target_identity: Identity) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    ctx.db.ban().ban_key().delete(ban_key(server_id, target_identity));
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_member_role(
    ctx: &ReducerContext,
    server_id: u64,
    target_identity: Identity,
    new_role: Role,
) -> Result<(), String> {
    require_owner(ctx, server_id, ctx.sender())?;
    assert_or_err(new_role != Role::Owner, "use transfer_ownership for owner role")?;

    let mut member_row = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(server_id, target_identity))
        .ok_or_else(|| "target is not a member".to_string())?;

    member_row.role = new_role;
    ctx.db.server_member().member_key().update(member_row);
    Ok(())
}

#[spacetimedb::reducer]
pub fn transfer_ownership(ctx: &ReducerContext, server_id: u64, target_identity: Identity) -> Result<(), String> {
    require_owner(ctx, server_id, ctx.sender())?;

    let mut target_row = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(server_id, target_identity))
        .ok_or_else(|| "target is not a member".to_string())?;
    target_row.role = Role::Owner;
    ctx.db.server_member().member_key().update(target_row);

    let mut caller_row = ctx
        .db
        .server_member()
        .member_key()
        .find(member_key(server_id, ctx.sender()))
        .ok_or_else(|| "caller member row missing".to_string())?;
    caller_row.role = Role::Moderator;
    ctx.db.server_member().member_key().update(caller_row);

    let mut server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;
    server_row.owner_identity = target_identity;
    ctx.db.server().id().update(server_row);

    Ok(())
}

#[spacetimedb::reducer]
pub fn create_channel(
    ctx: &ReducerContext,
    server_id: u64,
    name: String,
    kind: ChannelKind,
    moderator_only: bool,
) -> Result<(), String> {
    require_mod_or_owner(ctx, server_id, ctx.sender())?;
    assert_or_err((1..=100).contains(&name.len()), "channel name must be 1-100 chars")?;

    let max_position = ctx
        .db
        .channel()
        .iter()
        .filter(|c| c.server_id == server_id)
        .map(|c| c.position)
        .max()
        .unwrap_or(0);

    let next_position = if ctx.db.channel().iter().any(|c| c.server_id == server_id) {
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
        assert_or_err((1..=100).contains(&new_name.len()), "channel name must be 1-100 chars")?;
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
    Ok(())
}

#[spacetimedb::reducer]
pub fn send_message(ctx: &ReducerContext, channel_id: u64, content: String) -> Result<(), String> {
    let channel_row = find_channel(ctx, channel_id)?;
    let role = require_member_role(ctx, channel_row.server_id, ctx.sender())?;

    if channel_row.moderator_only {
        assert_or_err(role != Role::Member, "channel is moderator-only")?;
    }

    assert_or_err((1..=4000).contains(&content.len()), "message must be 1-4000 chars")?;

    ctx.db.message().insert(Message {
        id: 0,
        channel_id,
        sender_identity: ctx.sender(),
        content,
        sent_at: ctx.timestamp,
        edited_at: None,
        deleted: false,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn edit_message(ctx: &ReducerContext, message_id: u64, new_content: String) -> Result<(), String> {
    assert_or_err((1..=4000).contains(&new_content.len()), "message must be 1-4000 chars")?;

    let mut message_row = ctx
        .db
        .message()
        .id()
        .find(message_id)
        .ok_or_else(|| "message not found".to_string())?;

    assert_or_err(
        message_row.sender_identity == ctx.sender(),
        "only sender can edit message",
    )?;

    message_row.content = new_content;
    message_row.edited_at = Some(ctx.timestamp);
    ctx.db.message().id().update(message_row);

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_message(ctx: &ReducerContext, message_id: u64) -> Result<(), String> {
    let mut message_row = ctx
        .db
        .message()
        .id()
        .find(message_id)
        .ok_or_else(|| "message not found".to_string())?;

    if message_row.sender_identity != ctx.sender() {
        let channel_row = find_channel(ctx, message_row.channel_id)?;
        require_mod_or_owner(ctx, channel_row.server_id, ctx.sender())?;
    }

    message_row.deleted = true;
    message_row.content = "[message deleted]".to_string();
    message_row.edited_at = Some(ctx.timestamp);
    ctx.db.message().id().update(message_row);

    Ok(())
}

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

#[spacetimedb::reducer]
pub fn send_direct_message(
    ctx: &ReducerContext,
    recipient_identity: Identity,
    content: String,
) -> Result<(), String> {
    assert_or_err((1..=4000).contains(&content.len()), "message must be 1-4000 chars")?;
    assert_or_err(
        !has_block_either_direction(ctx, ctx.sender(), recipient_identity),
        "blocked relationship exists",
    )?;

    let friend_row = find_friend_row(ctx, ctx.sender(), recipient_identity)
        .ok_or_else(|| "friend relationship not found".to_string())?;
    assert_or_err(friend_row.status == FriendStatus::Accepted, "friendship not accepted")?;

    ctx.db.direct_message().insert(DirectMessage {
        id: 0,
        sender_identity: ctx.sender(),
        recipient_identity,
        content,
        sent_at: ctx.timestamp,
        deleted_by_sender: false,
        deleted_by_recipient: false,
    });

    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_direct_message(ctx: &ReducerContext, message_id: u64) -> Result<(), String> {
    let mut dm_row = ctx
        .db
        .direct_message()
        .id()
        .find(message_id)
        .ok_or_else(|| "direct message not found".to_string())?;

    if dm_row.sender_identity == ctx.sender() {
        dm_row.deleted_by_sender = true;
    } else if dm_row.recipient_identity == ctx.sender() {
        dm_row.deleted_by_recipient = true;
    } else {
        return Err("not authorized to delete this direct message".to_string());
    }

    if dm_row.deleted_by_sender && dm_row.deleted_by_recipient {
        ctx.db.direct_message().id().delete(dm_row.id);
    } else {
        ctx.db.direct_message().id().update(dm_row);
    }

    Ok(())
}

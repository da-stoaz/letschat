use spacetimedb::{Identity, SpacetimeType, Timestamp};

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

#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum InvitePolicy {
    ModeratorsOnly,
    Everyone,
}

#[spacetimedb::table(accessor = user, public)]
pub struct User {
    #[primary_key]
    pub identity: Identity,
    #[unique]
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    #[index(btree)]
    pub created_at: Timestamp,
}

#[spacetimedb::table(accessor = auth_credential)]
pub struct AuthCredential {
    #[primary_key]
    pub username: String,
    #[index(btree)]
    pub identity: Identity,
    pub password_salt: String,
    pub password_hash: String,
    pub token_iv: String,
    pub token_cipher: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(accessor = server, public)]
pub struct Server {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub name: String,
    #[index(btree)]
    pub owner_identity: Identity,
    pub invite_policy: InvitePolicy,
    pub icon_url: Option<String>,
    pub created_at: Timestamp,
}

#[spacetimedb::table(
    accessor = server_member,
    public,
    index(accessor = by_server_and_user, btree(columns = [server_id, user_identity]))
)]
pub struct ServerMember {
    #[primary_key]
    pub member_key: String,
    #[index(btree)]
    pub server_id: u64,
    #[index(btree)]
    pub user_identity: Identity,
    pub role: Role,
    pub joined_at: Timestamp,
    pub timeout_until: Option<Timestamp>,
}

#[spacetimedb::table(
    accessor = ban,
    public,
    index(accessor = by_server_and_user, btree(columns = [server_id, user_identity]))
)]
pub struct Ban {
    #[primary_key]
    pub ban_key: String,
    #[index(btree)]
    pub server_id: u64,
    #[index(btree)]
    pub user_identity: Identity,
    pub banned_by: Identity,
    pub reason: Option<String>,
    pub banned_at: Timestamp,
}

#[spacetimedb::table(accessor = invite, public)]
pub struct Invite {
    #[primary_key]
    pub token: String,
    #[index(btree)]
    pub server_id: u64,
    pub created_by: Identity,
    pub expires_at: Timestamp,
    pub max_uses: Option<u32>,
    pub use_count: u32,
    pub allowed_usernames: Vec<String>,
}

#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum DmInviteStatus {
    Pending,
    Accepted,
    Declined,
}

#[spacetimedb::table(
    accessor = dm_server_invite,
    public,
    index(accessor = by_recipient, btree(columns = [recipient_identity])),
    index(accessor = by_sender, btree(columns = [sender_identity]))
)]
pub struct DmServerInvite {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub server_id: u64,
    pub invite_token: String,
    pub sender_identity: Identity,
    pub recipient_identity: Identity,
    pub status: DmInviteStatus,
    pub created_at: Timestamp,
}

#[spacetimedb::table(
    accessor = channel,
    public,
    index(accessor = by_server_and_position, btree(columns = [server_id, position]))
)]
pub struct Channel {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub server_id: u64,
    pub name: String,
    pub kind: ChannelKind,
    pub position: u32,
    pub moderator_only: bool,
}

#[spacetimedb::table(
    accessor = message,
    public,
    index(accessor = by_channel_and_sent_at, btree(columns = [channel_id, sent_at]))
)]
pub struct Message {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub channel_id: u64,
    pub sender_identity: Identity,
    pub content: String,
    pub sent_at: Timestamp,
    pub edited_at: Option<Timestamp>,
    pub deleted: bool,
}

#[spacetimedb::table(
    accessor = voice_participant,
    public,
    index(accessor = by_channel_and_user, btree(columns = [channel_id, user_identity]))
)]
pub struct VoiceParticipant {
    #[primary_key]
    pub voice_key: String,
    #[index(btree)]
    pub channel_id: u64,
    pub user_identity: Identity,
    pub joined_at: Timestamp,
    pub muted: bool,
    pub deafened: bool,
    pub sharing_screen: bool,
    pub sharing_camera: bool,
}

#[spacetimedb::table(accessor = friend)]
pub struct Friend {
    #[primary_key]
    pub pair_key: String,
    #[index(btree)]
    pub user_a: Identity,
    #[index(btree)]
    pub user_b: Identity,
    pub status: FriendStatus,
    pub requested_by: Identity,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(accessor = block)]
pub struct Block {
    #[primary_key]
    pub block_key: String,
    #[index(btree)]
    pub blocker: Identity,
    #[index(btree)]
    pub blocked: Identity,
    pub created_at: Timestamp,
}

#[spacetimedb::table(
    accessor = direct_message,
    public,
    index(accessor = by_sender_recipient_sent_at, btree(columns = [sender_identity, recipient_identity, sent_at]))
)]
pub struct DirectMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub sender_identity: Identity,
    pub recipient_identity: Identity,
    pub content: String,
    pub sent_at: Timestamp,
    pub deleted_by_sender: bool,
    pub deleted_by_recipient: bool,
}

#[spacetimedb::table(
    accessor = dm_voice_participant,
    index(accessor = by_room_and_user, btree(columns = [room_key, user_identity]))
)]
pub struct DmVoiceParticipant {
    #[primary_key]
    pub dm_voice_key: String,
    #[index(btree)]
    pub room_key: String,
    #[index(btree)]
    pub user_a: Identity,
    #[index(btree)]
    pub user_b: Identity,
    #[index(btree)]
    pub user_identity: Identity,
    pub joined_at: Timestamp,
    pub muted: bool,
    pub deafened: bool,
    pub sharing_screen: bool,
    pub sharing_camera: bool,
}

#[spacetimedb::table(accessor = presence_state)]
pub struct PresenceState {
    #[primary_key]
    pub identity: Identity,
    pub online: bool,
    #[index(btree)]
    pub last_interaction_at: Timestamp,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(
    accessor = typing_state,
    index(accessor = by_scope, btree(columns = [scope_key])),
    index(accessor = by_user, btree(columns = [user_identity]))
)]
pub struct TypingState {
    #[primary_key]
    pub typing_key: String,
    pub scope_key: String,
    pub user_identity: Identity,
    #[index(btree)]
    pub updated_at: Timestamp,
}

#[spacetimedb::table(
    accessor = read_state,
    index(accessor = by_scope, btree(columns = [scope_key])),
    index(accessor = by_user, btree(columns = [user_identity]))
)]
pub struct ReadState {
    #[primary_key]
    pub read_key: String,
    pub scope_key: String,
    pub user_identity: Identity,
    pub last_read_at: Timestamp,
    #[index(btree)]
    pub updated_at: Timestamp,
}

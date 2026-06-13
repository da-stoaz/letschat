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
    Announcement,
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

/// Who may call `create_server`. Set on the `SystemSettings` singleton and
/// editable by any user with `User.is_admin = true`.
#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum SpaceCreatePolicy {
    /// Default — preserves the historical behaviour where any signed-in user
    /// can create unlimited spaces.
    Anyone,
    /// Only users with `User.is_admin = true` can create spaces.
    AdminsOnly,
}

/// Instance-wide chat-domain settings (singleton, primary key fixed at 1).
/// Seeded by the `init` lifecycle reducer on first module publish.
#[spacetimedb::table(accessor = system_settings, public)]
pub struct SystemSettings {
    #[primary_key]
    pub id: u8,
    pub space_create_policy: SpaceCreatePolicy,
}

/// Records the identity of the archive replication worker (storage-tiering,
/// plan 2). Singleton, primary key fixed at 1; a row existing == a worker
/// identity is registered. The `archive_*` views and (later) the eviction /
/// restore reducers recognise this identity and serve it the full dataset that
/// the scoped `my_*` views deliberately withhold.
///
/// Public so the gated views can read it to compare against `ctx.sender()`.
/// The identity is not a secret (identities are public); only the worker's
/// *token* grants the identity, and that lives outside the module. Set by an
/// instance admin via `set_archive_service_identity` once the worker has
/// connected and reported its identity — same bootstrap shape as the core-api
/// service token.
#[spacetimedb::table(accessor = archive_service, public)]
pub struct ArchiveService {
    #[primary_key]
    pub id: u8,
    pub service_identity: Identity,
}

// Private: clients read the directory of people they can actually see (members
// of shared spaces, friends, join-requesters they moderate, DM-invite
// counterparties) through the `my_visible_users` view, instead of enumerating
// every account on the instance. Username → identity lookups for adding friends
// go through the `send_friend_request_by_username` reducer server-side.
#[spacetimedb::table(accessor = user)]
pub struct User {
    #[primary_key]
    pub identity: Identity,
    #[unique]
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    #[index(btree)]
    pub created_at: Timestamp,
    /// Instance-level admin flag (independent of per-server Owner/Moderator).
    /// Gates `set_space_create_policy`, `set_user_admin`, and the policy
    /// check in `create_server`. Default is `false`; populated by the
    /// `init` reducer (publisher becomes admin) and by `set_user_admin`.
    #[default(false)]
    pub is_admin: bool,
}

// Private: clients read servers they're a member of (or that are discoverable)
// through the `my_servers` view. The base table is owner/module-only so the
// `/sql` endpoint and raw subscriptions can't enumerate every space.
#[spacetimedb::table(accessor = server)]
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
    /// Opt-in: when true the space is listed on the "Discover" surface for
    /// non-members. Owner-controlled via `set_server_discovery`. Default off.
    /// Indexed so the `my_servers` / `my_server_members` views can pull the
    /// discoverable set without a full-table scan (view handles are index-only).
    #[index(btree)]
    #[default(false)]
    pub is_discoverable: bool,
    /// Short blurb shown on the Discover card (≤280 chars, enforced at the
    /// reducer). Only meaningful when `is_discoverable`.
    #[default(None::<String>)]
    pub description: Option<String>,
    /// Up to 5 lowercased topic tags (≤24 chars each), used to filter the
    /// Discover surface. Owner-controlled via `set_server_tags`. `None` ==
    /// no tags (a Vec column can't carry a const default).
    #[default(None::<Vec<String>>)]
    pub tags: Option<Vec<String>>,
}

// Private: the `my_server_members` view exposes members of spaces the caller
// belongs to (plus discoverable spaces, for Discover member counts). Keeps the
// full membership graph off the public `/sql` surface.
#[spacetimedb::table(
    accessor = server_member,
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

// Private: enforced server-side in reducers; the `my_bans` view exposes a
// space's ban list only to its moderators (the ban-list modal). Stays off the
// public surface.
#[spacetimedb::table(
    accessor = ban,
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

/// A non-member's pending request to join a discoverable, invite-only space.
/// A row existing == the request is pending; approving creates a `ServerMember`
/// and removes the row, declining/cancelling just removes it.
// Private: the `my_join_requests` view returns the caller's own requests plus
// requests for spaces they moderate. Stops anyone from listing who asked to
// join where.
#[spacetimedb::table(accessor = join_request)]
pub struct JoinRequest {
    /// "{server_id}:{user_identity}" — one request per user per space.
    #[primary_key]
    pub request_key: String,
    #[index(btree)]
    pub server_id: u64,
    #[index(btree)]
    pub user_identity: Identity,
    pub created_at: Timestamp,
    /// A moderator declined this request. The row is kept (not deleted) so the
    /// requester gets feedback; re-requesting flips it back to pending. Appended
    /// last so the migration stays additive.
    #[default(false)]
    pub declined: bool,
}

// Private: invite tokens are bearer credentials. The `my_invites` view shows
// invites for spaces the caller belongs to (management UI); joining happens via
// the `use_invite` reducer with the token, so clients never need to read the
// table to accept. Keeps tokens off the public `/sql` surface.
#[spacetimedb::table(accessor = invite)]
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

// Private: the `my_dm_server_invites` view returns invites the caller sent or
// received.
#[spacetimedb::table(
    accessor = dm_server_invite,
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

// Private: the `my_channels` view returns channels for spaces the caller is a
// member of. Keeps every space's channel layout off the public surface.
#[spacetimedb::table(
    accessor = channel,
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
    #[default(None::<String>)]
    pub section: Option<String>,
}

// Private: clients read messages for channels in spaces they belong to via the
// `my_channel_messages` view. The base table is module-only so neither raw
// subscriptions nor `/sql` can read every channel's history.
#[spacetimedb::table(
    accessor = message,
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

// Private: the `my_voice_participants` view returns voice presence for channels
// in spaces the caller belongs to.
#[spacetimedb::table(
    accessor = voice_participant,
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

// Private: DMs are the most sensitive rows in the system. The
// `my_direct_messages` view returns only conversations the caller is a party to
// (sender or recipient). The standalone sender/recipient indexes let that view
// filter without scanning the whole table.
#[spacetimedb::table(
    accessor = direct_message,
    index(accessor = by_sender_recipient_sent_at, btree(columns = [sender_identity, recipient_identity, sent_at]))
)]
pub struct DirectMessage {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub sender_identity: Identity,
    #[index(btree)]
    pub recipient_identity: Identity,
    pub content: String,
    pub sent_at: Timestamp,
    pub edited_at: Option<Timestamp>,
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

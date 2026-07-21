using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace CoreApi.Data.Archive;

// Storage-tiering (plan 2) — EF entities for the PostgreSQL `archive` database, a
// verbatim mirror of the durable SpacetimeDB tables. core-api owns this schema
// (migrations applied on startup); the archive-worker writes the steady-state
// mirror via raw Npgsql, and Phase 3 read endpoints / Phase 5 write-through use
// these entities through EF.
//
// Type mapping from the module schema:
//   Identity    -> string  (hex)
//   u64 / u32   -> long    (bigint; auto-inc ids start at 1, ValueGeneratedNever
//                           so EF doesn't make them identity columns — the worker
//                           and the rebuild path set them explicitly)
//   Timestamp   -> long    (microseconds since the unix epoch, stored exactly)
//   Option<T>   -> nullable property
//   Vec<String> -> string[] (text[])
//   enum        -> string  (variant name)

[Table("archive_user")]
public sealed class ArchiveUser
{
    [Key, Column("identity")] public string Identity { get; set; } = "";
    [Column("username")] public string Username { get; set; } = "";
    [Column("display_name")] public string DisplayName { get; set; } = "";
    [Column("avatar_url")] public string? AvatarUrl { get; set; }
    [Column("created_at")] public long CreatedAt { get; set; }
    [Column("is_admin")] public bool IsAdmin { get; set; }
}

[Table("archive_server")]
public sealed class ArchiveServer
{
    [Key, Column("id")] public long Id { get; set; }
    [Column("name")] public string Name { get; set; } = "";
    [Column("owner_identity")] public string OwnerIdentity { get; set; } = "";
    [Column("invite_policy")] public string InvitePolicy { get; set; } = "";
    [Column("icon_url")] public string? IconUrl { get; set; }
    [Column("created_at")] public long CreatedAt { get; set; }
    [Column("is_discoverable")] public bool IsDiscoverable { get; set; }
    [Column("description")] public string? Description { get; set; }
    [Column("tags")] public string[]? Tags { get; set; }
}

[Table("archive_server_member")]
public sealed class ArchiveServerMember
{
    [Key, Column("member_key")] public string MemberKey { get; set; } = "";
    [Column("server_id")] public long ServerId { get; set; }
    [Column("user_identity")] public string UserIdentity { get; set; } = "";
    [Column("role")] public string Role { get; set; } = "";
    [Column("joined_at")] public long JoinedAt { get; set; }
    [Column("timeout_until")] public long? TimeoutUntil { get; set; }
}

[Table("archive_ban")]
public sealed class ArchiveBan
{
    [Key, Column("ban_key")] public string BanKey { get; set; } = "";
    [Column("server_id")] public long ServerId { get; set; }
    [Column("user_identity")] public string UserIdentity { get; set; } = "";
    [Column("banned_by")] public string BannedBy { get; set; } = "";
    [Column("reason")] public string? Reason { get; set; }
    [Column("banned_at")] public long BannedAt { get; set; }
}

[Table("archive_join_request")]
public sealed class ArchiveJoinRequest
{
    [Key, Column("request_key")] public string RequestKey { get; set; } = "";
    [Column("server_id")] public long ServerId { get; set; }
    [Column("user_identity")] public string UserIdentity { get; set; } = "";
    [Column("created_at")] public long CreatedAt { get; set; }
    [Column("declined")] public bool Declined { get; set; }
}

[Table("archive_invite")]
public sealed class ArchiveInvite
{
    [Key, Column("token")] public string Token { get; set; } = "";
    [Column("server_id")] public long ServerId { get; set; }
    [Column("created_by")] public string CreatedBy { get; set; } = "";
    [Column("expires_at")] public long ExpiresAt { get; set; }
    [Column("max_uses")] public long? MaxUses { get; set; }
    [Column("use_count")] public long UseCount { get; set; }
    [Column("allowed_usernames")] public string[] AllowedUsernames { get; set; } = [];
}

[Table("archive_dm_server_invite")]
public sealed class ArchiveDmServerInvite
{
    [Key, Column("id")] public long Id { get; set; }
    [Column("server_id")] public long ServerId { get; set; }
    [Column("invite_token")] public string InviteToken { get; set; } = "";
    [Column("sender_identity")] public string SenderIdentity { get; set; } = "";
    [Column("recipient_identity")] public string RecipientIdentity { get; set; } = "";
    [Column("status")] public string Status { get; set; } = "";
    [Column("created_at")] public long CreatedAt { get; set; }
}

[Table("archive_channel")]
public sealed class ArchiveChannel
{
    [Key, Column("id")] public long Id { get; set; }
    [Column("server_id")] public long ServerId { get; set; }
    [Column("name")] public string Name { get; set; } = "";
    [Column("kind")] public string Kind { get; set; } = "";
    [Column("position")] public long Position { get; set; }
    [Column("moderator_only")] public bool ModeratorOnly { get; set; }
    [Column("section")] public string? Section { get; set; }
}

[Table("archive_message")]
public sealed class ArchiveMessage
{
    [Key, Column("id")] public long Id { get; set; }
    [Column("channel_id")] public long ChannelId { get; set; }
    [Column("sender_identity")] public string SenderIdentity { get; set; } = "";
    [Column("content")] public string Content { get; set; } = "";
    [Column("sent_at")] public long SentAt { get; set; }
    [Column("edited_at")] public long? EditedAt { get; set; }
    [Column("deleted")] public bool Deleted { get; set; }
}

[Table("archive_direct_message")]
public sealed class ArchiveDirectMessage
{
    [Key, Column("id")] public long Id { get; set; }
    [Column("sender_identity")] public string SenderIdentity { get; set; } = "";
    [Column("recipient_identity")] public string RecipientIdentity { get; set; } = "";
    [Column("content")] public string Content { get; set; } = "";
    [Column("sent_at")] public long SentAt { get; set; }
    [Column("edited_at")] public long? EditedAt { get; set; }
    [Column("deleted_by_sender")] public bool DeletedBySender { get; set; }
    [Column("deleted_by_recipient")] public bool DeletedByRecipient { get; set; }

    /// <summary>
    /// Sorted identity pair, generated in the database so a conversation pages
    /// with one index regardless of message direction. Read-only.
    /// </summary>
    [Column("conversation_key"), DatabaseGenerated(DatabaseGeneratedOption.Computed)]
    public string? ConversationKey { get; private set; }
}

[Table("archive_friend")]
public sealed class ArchiveFriend
{
    [Key, Column("pair_key")] public string PairKey { get; set; } = "";
    [Column("user_a")] public string UserA { get; set; } = "";
    [Column("user_b")] public string UserB { get; set; } = "";
    [Column("status")] public string Status { get; set; } = "";
    [Column("requested_by")] public string RequestedBy { get; set; } = "";
    [Column("updated_at")] public long UpdatedAt { get; set; }
}

[Table("archive_block")]
public sealed class ArchiveBlock
{
    [Key, Column("block_key")] public string BlockKey { get; set; } = "";
    [Column("blocker")] public string Blocker { get; set; } = "";
    [Column("blocked")] public string Blocked { get; set; } = "";
    [Column("created_at")] public long CreatedAt { get; set; }
}

[Table("archive_read_state")]
public sealed class ArchiveReadState
{
    [Key, Column("read_key")] public string ReadKey { get; set; } = "";
    [Column("scope_key")] public string ScopeKey { get; set; } = "";
    [Column("user_identity")] public string UserIdentity { get; set; } = "";
    [Column("last_read_at")] public long LastReadAt { get; set; }
    [Column("updated_at")] public long UpdatedAt { get; set; }
}

/// <summary>
/// Per-table sync watermarks written by the worker. SpacetimeDB exposes no
/// resumable change-log position, so this is observability state, not a cursor.
/// </summary>
[Table("replication_state")]
public sealed class ReplicationState
{
    [Key, Column("table_name")] public string TableName { get; set; } = "";
    [Column("last_full_sync_at")] public DateTimeOffset? LastFullSyncAt { get; set; }
    [Column("last_reconcile_at")] public DateTimeOffset? LastReconcileAt { get; set; }
    [Column("row_count")] public long RowCount { get; set; }
    [Column("updated_at")] public DateTimeOffset UpdatedAt { get; set; }
}

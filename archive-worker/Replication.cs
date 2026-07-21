using Microsoft.Extensions.Logging;
using SpacetimeDB;
using SpacetimeDB.BSATN;
using SpacetimeDB.Types;

namespace ArchiveWorker;

/// <summary>Timestamp → microseconds helpers (the archive stores micros as BIGINT).</summary>
internal static class TimestampExt
{
    public static long Micros(this Timestamp t) => t.MicrosecondsSinceUnixEpoch;
    public static long? Micros(this Timestamp? t) => t?.MicrosecondsSinceUnixEpoch;
}

/// <summary>
/// Maps one SpacetimeDB table to its archive table: builds the upsert/delete SQL
/// once, and extracts column / primary-key values from a row.
/// </summary>
public sealed class TableReplicator<TRow> where TRow : class
{
    public string PgTable { get; }
    public IReadOnlyList<string> PkColumns { get; }
    public string UpsertSql { get; }
    public string DeleteSql { get; }

    private readonly Func<TRow, object?[]> _values;
    private readonly Func<TRow, object?[]> _pk;

    public TableReplicator(
        string pgTable,
        string[] columns,
        string[] pkColumns,
        Func<TRow, object?[]> values,
        Func<TRow, object?[]> pk)
    {
        PgTable = pgTable;
        PkColumns = pkColumns;
        _values = values;
        _pk = pk;

        var placeholders = string.Join(", ", columns.Select((_, i) => $"${i + 1}"));
        var updates = columns.Where(c => !pkColumns.Contains(c)).Select(c => $"{c} = EXCLUDED.{c}").ToArray();
        var onConflict = updates.Length > 0
            ? $"DO UPDATE SET {string.Join(", ", updates)}"
            : "DO NOTHING";
        UpsertSql =
            $"INSERT INTO {pgTable} ({string.Join(", ", columns)}) VALUES ({placeholders}) " +
            $"ON CONFLICT ({string.Join(", ", pkColumns)}) {onConflict}";

        var where = string.Join(" AND ", pkColumns.Select((c, i) => $"{c} = ${i + 1}"));
        DeleteSql = $"DELETE FROM {pgTable} WHERE {where}";
    }

    public object?[] UpsertValues(TRow row) => _values(row);
    public object?[] PkValues(TRow row) => _pk(row);
    public string LiveKey(TRow row) => ReconcileRequest.KeyOf(_pk(row));
}

/// <summary>
/// Owns every table replicator, wires the SpacetimeDB row callbacks to the
/// archive write queue, and drives reconcile on each (re)subscribe.
/// </summary>
public sealed class Replication(ArchiveDatabase db, ILogger<Replication> logger)
{
    private readonly TableReplicator<User> _users = new(
        "archive_user",
        ["identity", "username", "display_name", "avatar_url", "created_at", "is_admin"],
        ["identity"],
        u => [u.Identity.ToString(), u.Username, u.DisplayName, u.AvatarUrl, u.CreatedAt.Micros(), u.IsAdmin],
        u => [u.Identity.ToString()]);

    private readonly TableReplicator<Server> _servers = new(
        "archive_server",
        ["id", "name", "owner_identity", "invite_policy", "icon_url", "created_at", "is_discoverable", "description", "tags"],
        ["id"],
        s => [(long)s.Id, s.Name, s.OwnerIdentity.ToString(), s.InvitePolicy.ToString(), s.IconUrl, s.CreatedAt.Micros(), s.IsDiscoverable, s.Description, s.Tags?.ToArray()],
        s => [(long)s.Id]);

    private readonly TableReplicator<ServerMember> _members = new(
        "archive_server_member",
        ["member_key", "server_id", "user_identity", "role", "joined_at", "timeout_until"],
        ["member_key"],
        m => [m.MemberKey, (long)m.ServerId, m.UserIdentity.ToString(), m.Role.ToString(), m.JoinedAt.Micros(), m.TimeoutUntil.Micros()],
        m => [m.MemberKey]);

    private readonly TableReplicator<Ban> _bans = new(
        "archive_ban",
        ["ban_key", "server_id", "user_identity", "banned_by", "reason", "banned_at"],
        ["ban_key"],
        b => [b.BanKey, (long)b.ServerId, b.UserIdentity.ToString(), b.BannedBy.ToString(), b.Reason, b.BannedAt.Micros()],
        b => [b.BanKey]);

    private readonly TableReplicator<JoinRequest> _joinRequests = new(
        "archive_join_request",
        ["request_key", "server_id", "user_identity", "created_at", "declined"],
        ["request_key"],
        j => [j.RequestKey, (long)j.ServerId, j.UserIdentity.ToString(), j.CreatedAt.Micros(), j.Declined],
        j => [j.RequestKey]);

    private readonly TableReplicator<Invite> _invites = new(
        "archive_invite",
        ["token", "server_id", "created_by", "expires_at", "max_uses", "use_count", "allowed_usernames"],
        ["token"],
        i => [i.Token, (long)i.ServerId, i.CreatedBy.ToString(), i.ExpiresAt.Micros(), i.MaxUses.HasValue ? (long)i.MaxUses.Value : null, (long)i.UseCount, i.AllowedUsernames.ToArray()],
        i => [i.Token]);

    private readonly TableReplicator<DmServerInvite> _dmServerInvites = new(
        "archive_dm_server_invite",
        ["id", "server_id", "invite_token", "sender_identity", "recipient_identity", "status", "created_at"],
        ["id"],
        d => [(long)d.Id, (long)d.ServerId, d.InviteToken, d.SenderIdentity.ToString(), d.RecipientIdentity.ToString(), d.Status.ToString(), d.CreatedAt.Micros()],
        d => [(long)d.Id]);

    private readonly TableReplicator<Channel> _channels = new(
        "archive_channel",
        ["id", "server_id", "name", "kind", "position", "moderator_only", "section"],
        ["id"],
        c => [(long)c.Id, (long)c.ServerId, c.Name, c.Kind.ToString(), (long)c.Position, c.ModeratorOnly, c.Section],
        c => [(long)c.Id]);

    private readonly TableReplicator<Message> _messages = new(
        "archive_message",
        ["id", "channel_id", "sender_identity", "content", "sent_at", "edited_at", "deleted"],
        ["id"],
        m => [(long)m.Id, (long)m.ChannelId, m.SenderIdentity.ToString(), m.Content, m.SentAt.Micros(), m.EditedAt.Micros(), m.Deleted],
        m => [(long)m.Id]);

    private readonly TableReplicator<DirectMessage> _directMessages = new(
        "archive_direct_message",
        // conversation_key is a generated column — never written directly.
        ["id", "sender_identity", "recipient_identity", "content", "sent_at", "edited_at", "deleted_by_sender", "deleted_by_recipient"],
        ["id"],
        d => [(long)d.Id, d.SenderIdentity.ToString(), d.RecipientIdentity.ToString(), d.Content, d.SentAt.Micros(), d.EditedAt.Micros(), d.DeletedBySender, d.DeletedByRecipient],
        d => [(long)d.Id]);

    private readonly TableReplicator<Friend> _friends = new(
        "archive_friend",
        ["pair_key", "user_a", "user_b", "status", "requested_by", "updated_at"],
        ["pair_key"],
        f => [f.PairKey, f.UserA.ToString(), f.UserB.ToString(), f.Status.ToString(), f.RequestedBy.ToString(), f.UpdatedAt.Micros()],
        f => [f.PairKey]);

    private readonly TableReplicator<Block> _blocks = new(
        "archive_block",
        ["block_key", "blocker", "blocked", "created_at"],
        ["block_key"],
        b => [b.BlockKey, b.Blocker.ToString(), b.Blocked.ToString(), b.CreatedAt.Micros()],
        b => [b.BlockKey]);

    private readonly TableReplicator<ReadState> _readStates = new(
        "archive_read_state",
        ["read_key", "scope_key", "user_identity", "last_read_at", "updated_at"],
        ["read_key"],
        r => [r.ReadKey, r.ScopeKey, r.UserIdentity.ToString(), r.LastReadAt.Micros(), r.UpdatedAt.Micros()],
        r => [r.ReadKey]);

    /// <summary>The SQL queries the worker subscribes to — one per archive view.</summary>
    public static string[] SubscriptionQueries =>
    [
        "SELECT * FROM archive_users",
        "SELECT * FROM archive_servers",
        "SELECT * FROM archive_server_members",
        "SELECT * FROM archive_bans",
        "SELECT * FROM archive_join_requests",
        "SELECT * FROM archive_invites",
        "SELECT * FROM archive_dm_server_invites",
        "SELECT * FROM archive_channels",
        "SELECT * FROM archive_messages",
        "SELECT * FROM archive_direct_messages",
        "SELECT * FROM archive_friends",
        "SELECT * FROM archive_blocks",
        "SELECT * FROM archive_read_states",
        // Needed so the worker can observe its own service-identity registration
        // (and re-evaluate the gated views) without a reconnect.
        "SELECT * FROM archive_service",
    ];

    /// <summary>Registers insert/update/delete handlers for every archive table.</summary>
    public void Wire(DbConnection conn)
    {
        Wire(conn.Db.ArchiveUsers, _users);
        Wire(conn.Db.ArchiveServers, _servers);
        Wire(conn.Db.ArchiveServerMembers, _members);
        Wire(conn.Db.ArchiveBans, _bans);
        Wire(conn.Db.ArchiveJoinRequests, _joinRequests);
        Wire(conn.Db.ArchiveInvites, _invites);
        Wire(conn.Db.ArchiveDmServerInvites, _dmServerInvites);
        Wire(conn.Db.ArchiveChannels, _channels);
        Wire(conn.Db.ArchiveMessages, _messages);
        Wire(conn.Db.ArchiveDirectMessages, _directMessages);
        Wire(conn.Db.ArchiveFriends, _friends);
        Wire(conn.Db.ArchiveBlocks, _blocks);
        Wire(conn.Db.ArchiveReadStates, _readStates);
    }

    /// <summary>
    /// Diff the live snapshot against the archive for every table and remove
    /// rows that no longer exist upstream. Runs after a (re)subscribe.
    ///
    /// NOTE (phase 2): once eviction lands, Message / DirectMessage reconcile
    /// must be scoped to the hot window — an evicted row is absent from
    /// SpacetimeDB but must NOT be deleted from the archive. Until eviction
    /// exists, SpacetimeDB holds the full set, so a full diff is correct.
    /// </summary>
    public void ReconcileAll(DbConnection conn)
    {
        Reconcile(conn.Db.ArchiveUsers, _users);
        Reconcile(conn.Db.ArchiveServers, _servers);
        Reconcile(conn.Db.ArchiveServerMembers, _members);
        Reconcile(conn.Db.ArchiveBans, _bans);
        Reconcile(conn.Db.ArchiveJoinRequests, _joinRequests);
        Reconcile(conn.Db.ArchiveInvites, _invites);
        Reconcile(conn.Db.ArchiveDmServerInvites, _dmServerInvites);
        Reconcile(conn.Db.ArchiveChannels, _channels);
        Reconcile(conn.Db.ArchiveMessages, _messages);
        Reconcile(conn.Db.ArchiveDirectMessages, _directMessages);
        Reconcile(conn.Db.ArchiveFriends, _friends);
        Reconcile(conn.Db.ArchiveBlocks, _blocks);
        Reconcile(conn.Db.ArchiveReadStates, _readStates);
    }

    private void Wire<TRow>(RemoteTableHandle<EventContext, TRow> handle, TableReplicator<TRow> rep)
        where TRow : class, IStructuralReadWrite, new()
    {
        handle.OnInsert += (_, row) =>
            db.EnqueueExec($"upsert {rep.PgTable}", rep.UpsertSql, rep.UpsertValues(row));
        handle.OnUpdate += (_, _, row) =>
            db.EnqueueExec($"update {rep.PgTable}", rep.UpsertSql, rep.UpsertValues(row));
        handle.OnDelete += (_, row) =>
        {
            // Views carry NO primary key to the client, so the SDK can't coalesce
            // an in-place row update into OnUpdate — it delivers delete(old) +
            // insert(new) for the same PK, and the two callbacks may arrive in
            // either order. If we deleted unconditionally, an insert-then-delete
            // ordering would drop a row that's actually still live. The SDK cache
            // is authoritative (it already reflects the new row), so: only delete
            // when the PK is truly gone from the cache; otherwise this "delete" is
            // the old half of an update and an upsert is (or will be) enqueued.
            var key = rep.LiveKey(row);
            foreach (var live in handle.Iter())
                if (rep.LiveKey(live) == key)
                    return;
            db.EnqueueExec($"delete {rep.PgTable}", rep.DeleteSql, rep.PkValues(row));
        };
    }

    private void Reconcile<TRow>(RemoteTableHandle<EventContext, TRow> handle, TableReplicator<TRow> rep)
        where TRow : class, IStructuralReadWrite, new()
    {
        var live = new HashSet<string>();
        foreach (var row in handle.Iter())
            live.Add(rep.LiveKey(row));
        db.EnqueueReconcile(new ReconcileRequest(rep.PgTable, rep.PkColumns, rep.DeleteSql, live));
        logger.LogDebug("Reconcile queued for {Table} ({N} live rows).", rep.PgTable, live.Count);
    }
}

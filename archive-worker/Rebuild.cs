using Microsoft.Extensions.Logging;
using Npgsql;
using SpacetimeDB;
using SpacetimeDB.Types;

namespace ArchiveWorker;

/// <summary>
/// Rebuild-from-cold (storage-tiering A2). After a destructive
/// <c>spacetime publish --delete-data</c> wiped the module, this reloads every
/// durable table from the PostgreSQL archive into SpacetimeDB via the worker-only
/// <c>archive_restore_*</c> reducers. Rows are restored verbatim — original
/// primary keys and timestamps preserved — so the module comes back byte-for-byte.
///
/// The reverse column map here is the exact inverse of <see cref="Replication"/>'s
/// forward map: identities are stored as hex (no <c>0x</c>), timestamps as
/// micros-since-epoch BIGINT, unit enums as their name, Vec&lt;String&gt; as text[].
///
/// Ordering note: SpacetimeDB has no foreign keys, so restore order is
/// immaterial; parents-first below is just for readability.
/// </summary>
public sealed class Rebuild(WorkerOptions options, ILogger<Rebuild> logger)
{
    private const int BatchSize = 500;

    public async Task RunAsync(DbConnection conn, CancellationToken ct)
    {
        await using var db = new NpgsqlConnection(options.ArchiveConnectionString);
        await db.OpenAsync(ct);

        var users = await ReadUsersAsync(db, ct);
        var servers = await ReadServersAsync(db, ct);
        var channels = await ReadChannelsAsync(db, ct);
        var members = await ReadServerMembersAsync(db, ct);
        var bans = await ReadBansAsync(db, ct);
        var joinRequests = await ReadJoinRequestsAsync(db, ct);
        var invites = await ReadInvitesAsync(db, ct);
        var dmInvites = await ReadDmServerInvitesAsync(db, ct);
        var friends = await ReadFriendsAsync(db, ct);
        var blocks = await ReadBlocksAsync(db, ct);
        var readStates = await ReadReadStatesAsync(db, ct);
        var pins = await ReadPinnedMessagesAsync(db, ct);
        var messages = await ReadMessagesAsync(db, ct);
        var dms = await ReadDirectMessagesAsync(db, ct);

        logger.LogInformation(
            "Rebuild: {U} user, {S} server, {C} channel, {M} member, {B} ban, {J} join_request, " +
            "{I} invite, {D} dm_invite, {F} friend, {Bl} block, {R} read_state, {P} pinned, {Msg} message, {Dm} direct_message.",
            users.Count, servers.Count, channels.Count, members.Count, bans.Count, joinRequests.Count,
            invites.Count, dmInvites.Count, friends.Count, blocks.Count, readStates.Count, pins.Count, messages.Count, dms.Count);

        var confirmed = new ConfirmedRestore(conn.FrameTick, TimeSpan.FromMinutes(1));
        conn.Reducers.OnArchiveRestoreUser += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreServer += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreChannel += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreServerMember += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreBan += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreJoinRequest += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreInvite += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreDmServerInvite += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreFriend += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreBlock += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreReadState += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestorePinnedMessage += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreMessage += (ctx, _) => confirmed.Complete(ctx.Event.Status);
        conn.Reducers.OnArchiveRestoreDirectMessage += (ctx, _) => confirmed.Complete(ctx.Event.Status);

        await SubmitAllAsync(users, conn.Reducers.ArchiveRestoreUser, confirmed, ct);
        await SubmitAllAsync(servers, conn.Reducers.ArchiveRestoreServer, confirmed, ct);
        await SubmitAllAsync(channels, conn.Reducers.ArchiveRestoreChannel, confirmed, ct);
        await SubmitAllAsync(members, conn.Reducers.ArchiveRestoreServerMember, confirmed, ct);
        await SubmitAllAsync(bans, conn.Reducers.ArchiveRestoreBan, confirmed, ct);
        await SubmitAllAsync(joinRequests, conn.Reducers.ArchiveRestoreJoinRequest, confirmed, ct);
        await SubmitAllAsync(invites, conn.Reducers.ArchiveRestoreInvite, confirmed, ct);
        await SubmitAllAsync(dmInvites, conn.Reducers.ArchiveRestoreDmServerInvite, confirmed, ct);
        await SubmitAllAsync(friends, conn.Reducers.ArchiveRestoreFriend, confirmed, ct);
        await SubmitAllAsync(blocks, conn.Reducers.ArchiveRestoreBlock, confirmed, ct);
        await SubmitAllAsync(readStates, conn.Reducers.ArchiveRestoreReadState, confirmed, ct);
        await SubmitAllAsync(pins, conn.Reducers.ArchiveRestorePinnedMessage, confirmed, ct);
        await SubmitAllAsync(messages, conn.Reducers.ArchiveRestoreMessage, confirmed, ct);
        await SubmitAllAsync(dms, conn.Reducers.ArchiveRestoreDirectMessage, confirmed, ct);

        logger.LogInformation("Rebuild: all durable tables committed successfully.");
    }

    // ── Reverse-map readers (inverse of Replication's forward maps) ──

    private static async Task<List<Reader>> QueryAsync(NpgsqlConnection db, string sql, CancellationToken ct)
    {
        var rows = new List<Reader>();
        await using var cmd = new NpgsqlCommand(sql, db);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) rows.Add(Reader.Snapshot(r));
        return rows;
    }

    private static async Task<List<User>> ReadUsersAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT identity, username, display_name, avatar_url, created_at, is_admin FROM archive_user", ct))
        .Select(x => new User
        {
            Identity = Id(x, 0), Username = x.Str(1), DisplayName = x.Str(2),
            AvatarUrl = x.NStr(3), CreatedAt = Ts(x, 4), IsAdmin = x.Bool(5),
        }).ToList();

    private static async Task<List<Server>> ReadServersAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT id, name, owner_identity, invite_policy, icon_url, created_at, is_discoverable, description, tags FROM archive_server", ct))
        .Select(x => new Server
        {
            Id = U64(x, 0), Name = x.Str(1), OwnerIdentity = Id(x, 2),
            InvitePolicy = Enum.Parse<InvitePolicy>(x.Str(3)), IconUrl = x.NStr(4),
            CreatedAt = Ts(x, 5), IsDiscoverable = x.Bool(6), Description = x.NStr(7),
            Tags = x.NArr(8)?.ToList(),
        }).ToList();

    private static async Task<List<Channel>> ReadChannelsAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT id, server_id, name, kind, position, moderator_only, section FROM archive_channel", ct))
        .Select(x => new Channel
        {
            Id = U64(x, 0), ServerId = U64(x, 1), Name = x.Str(2),
            Kind = Enum.Parse<ChannelKind>(x.Str(3)), Position = (uint)x.I64(4),
            ModeratorOnly = x.Bool(5), Section = x.NStr(6),
        }).ToList();

    private static async Task<List<ServerMember>> ReadServerMembersAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT member_key, server_id, user_identity, role, joined_at, timeout_until FROM archive_server_member", ct))
        .Select(x => new ServerMember
        {
            MemberKey = x.Str(0), ServerId = U64(x, 1), UserIdentity = Id(x, 2),
            Role = Enum.Parse<Role>(x.Str(3)), JoinedAt = Ts(x, 4), TimeoutUntil = NTs(x, 5),
        }).ToList();

    private static async Task<List<Ban>> ReadBansAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT ban_key, server_id, user_identity, banned_by, reason, banned_at FROM archive_ban", ct))
        .Select(x => new Ban
        {
            BanKey = x.Str(0), ServerId = U64(x, 1), UserIdentity = Id(x, 2),
            BannedBy = Id(x, 3), Reason = x.NStr(4), BannedAt = Ts(x, 5),
        }).ToList();

    private static async Task<List<JoinRequest>> ReadJoinRequestsAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT request_key, server_id, user_identity, created_at, declined FROM archive_join_request", ct))
        .Select(x => new JoinRequest
        {
            RequestKey = x.Str(0), ServerId = U64(x, 1), UserIdentity = Id(x, 2),
            CreatedAt = Ts(x, 3), Declined = x.Bool(4),
        }).ToList();

    private static async Task<List<Invite>> ReadInvitesAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT token, server_id, created_by, expires_at, max_uses, use_count, allowed_usernames FROM archive_invite", ct))
        .Select(x => new Invite
        {
            Token = x.Str(0), ServerId = U64(x, 1), CreatedBy = Id(x, 2), ExpiresAt = Ts(x, 3),
            MaxUses = x.IsNull(4) ? null : (uint)x.I64(4), UseCount = (uint)x.I64(5),
            AllowedUsernames = (x.NArr(6) ?? Array.Empty<string>()).ToList(),
        }).ToList();

    private static async Task<List<DmServerInvite>> ReadDmServerInvitesAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT id, server_id, invite_token, sender_identity, recipient_identity, status, created_at FROM archive_dm_server_invite", ct))
        .Select(x => new DmServerInvite
        {
            Id = U64(x, 0), ServerId = U64(x, 1), InviteToken = x.Str(2),
            SenderIdentity = Id(x, 3), RecipientIdentity = Id(x, 4),
            Status = Enum.Parse<DmInviteStatus>(x.Str(5)), CreatedAt = Ts(x, 6),
        }).ToList();

    private static async Task<List<Friend>> ReadFriendsAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT pair_key, user_a, user_b, status, requested_by, updated_at FROM archive_friend", ct))
        .Select(x => new Friend
        {
            PairKey = x.Str(0), UserA = Id(x, 1), UserB = Id(x, 2),
            Status = Enum.Parse<FriendStatus>(x.Str(3)), RequestedBy = Id(x, 4), UpdatedAt = Ts(x, 5),
        }).ToList();

    private static async Task<List<Block>> ReadBlocksAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT block_key, blocker, blocked, created_at FROM archive_block", ct))
        .Select(x => new Block
        {
            BlockKey = x.Str(0), Blocker = Id(x, 1), Blocked = Id(x, 2), CreatedAt = Ts(x, 3),
        }).ToList();

    private static async Task<List<ReadState>> ReadReadStatesAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT read_key, scope_key, user_identity, last_read_at, updated_at FROM archive_read_state", ct))
        .Select(x => new ReadState
        {
            ReadKey = x.Str(0), ScopeKey = x.Str(1), UserIdentity = Id(x, 2),
            LastReadAt = Ts(x, 3), UpdatedAt = Ts(x, 4),
        }).ToList();

    private static async Task<List<PinnedMessage>> ReadPinnedMessagesAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT pin_id, channel_id, message_id, pinned_by, pinned_at FROM archive_pinned_message", ct))
        .Select(x => new PinnedMessage
        {
            PinId = U64(x, 0), ChannelId = U64(x, 1), MessageId = U64(x, 2),
            PinnedBy = Id(x, 3), PinnedAt = Ts(x, 4),
        }).ToList();

    private static async Task<List<Message>> ReadMessagesAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT id, channel_id, sender_identity, content, sent_at, edited_at, deleted FROM archive_message", ct))
        .Select(x => new Message
        {
            Id = U64(x, 0), ChannelId = U64(x, 1), SenderIdentity = Id(x, 2), Content = x.Str(3),
            SentAt = Ts(x, 4), EditedAt = NTs(x, 5), Deleted = x.Bool(6),
        }).ToList();

    private static async Task<List<DirectMessage>> ReadDirectMessagesAsync(NpgsqlConnection db, CancellationToken ct) =>
        (await QueryAsync(db, "SELECT id, sender_identity, recipient_identity, content, sent_at, edited_at, deleted_by_sender, deleted_by_recipient FROM archive_direct_message", ct))
        .Select(x => new DirectMessage
        {
            Id = U64(x, 0), SenderIdentity = Id(x, 1), RecipientIdentity = Id(x, 2), Content = x.Str(3),
            SentAt = Ts(x, 4), EditedAt = NTs(x, 5), DeletedBySender = x.Bool(6), DeletedByRecipient = x.Bool(7),
        }).ToList();

    // ── Column decoders ──
    private static ulong U64(Reader x, int i) => (ulong)x.I64(i);
    private static Identity Id(Reader x, int i) => Identity.FromHexString(x.Str(i));
    private static Timestamp Ts(Reader x, int i) => new(x.I64(i));
    private static Timestamp? NTs(Reader x, int i) => x.IsNull(i) ? null : new Timestamp(x.I64(i));

    private static async Task SubmitAllAsync<T>(List<T> rows, Action<List<T>> call,
        ConfirmedRestore confirmed, CancellationToken ct)
    {
        for (var i = 0; i < rows.Count; i += BatchSize)
        {
            var batch = rows.GetRange(i, Math.Min(BatchSize, rows.Count - i));
            await confirmed.ExecuteAsync(() => call(batch), ct);
        }
    }

    /// <summary>A materialised row snapshot — the reader is advanced past it, so
    /// we copy the values out once and decode them into structs afterwards.</summary>
    private sealed class Reader
    {
        private readonly object?[] _values;
        private Reader(object?[] values) => _values = values;

        public static Reader Snapshot(NpgsqlDataReader r)
        {
            var v = new object?[r.FieldCount];
            for (var i = 0; i < v.Length; i++) v[i] = r.IsDBNull(i) ? null : r.GetValue(i);
            return new Reader(v);
        }

        public bool IsNull(int i) => _values[i] is null;
        public long I64(int i) => (long)_values[i]!;
        public string Str(int i) => (string)_values[i]!;
        public string? NStr(int i) => (string?)_values[i];
        public bool Bool(int i) => (bool)_values[i]!;
        public string[]? NArr(int i) => (string[]?)_values[i];
    }
}

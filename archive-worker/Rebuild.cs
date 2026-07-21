using Microsoft.Extensions.Logging;
using Npgsql;
using SpacetimeDB;
using SpacetimeDB.Types;

namespace ArchiveWorker;

/// <summary>
/// Rebuild-from-cold (storage-tiering A2). Reloads the durable bulk tables from
/// the PostgreSQL archive into SpacetimeDB via the worker-only
/// <c>archive_restore_*</c> reducers, after a destructive <c>--delete-data</c>
/// migration wiped the module. Rows are restored verbatim — original primary
/// keys and timestamps preserved — so the module comes back byte-for-byte.
///
/// Scope: message + direct_message (the unbounded tables storage-tiering exists
/// to protect). A whole-database rebuild also needs the bounded tables restored
/// the same way; see the note in <c>server/src/reducers/archive.rs</c>.
///
/// The reverse column map is the exact inverse of <see cref="Replication"/>'s
/// forward map: identities are stored as hex (no <c>0x</c>), timestamps as
/// micros-since-epoch BIGINT.
/// </summary>
public sealed class Rebuild(WorkerOptions options, ILogger<Rebuild> logger)
{
    private const int BatchSize = 500;

    public async Task RunAsync(DbConnection conn, CancellationToken ct)
    {
        await using var db = new NpgsqlConnection(options.ArchiveConnectionString);
        await db.OpenAsync(ct);

        var messages = await ReadMessagesAsync(db, ct);
        var dms = await ReadDirectMessagesAsync(db, ct);
        logger.LogInformation(
            "Rebuild: read {M} message(s) + {D} direct_message(s) from the cold archive.",
            messages.Count, dms.Count);

        foreach (var batch in Chunk(messages))
        {
            conn.Reducers.ArchiveRestoreMessage(batch);
            Flush(conn);
        }
        foreach (var batch in Chunk(dms))
        {
            conn.Reducers.ArchiveRestoreDirectMessage(batch);
            Flush(conn);
        }

        // Grace period so every enqueued reducer call is flushed and applied
        // before the process exits.
        for (var i = 0; i < 300 && !ct.IsCancellationRequested; i++)
        {
            conn.FrameTick();
            await Task.Delay(10, ct);
        }
        logger.LogInformation(
            "Rebuild: submitted restore for {M} message(s) + {D} direct_message(s). Done.",
            messages.Count, dms.Count);
    }

    private static async Task<List<Message>> ReadMessagesAsync(NpgsqlConnection db, CancellationToken ct)
    {
        var rows = new List<Message>();
        await using var cmd = new NpgsqlCommand(
            "SELECT id, channel_id, sender_identity, content, sent_at, edited_at, deleted FROM archive_message", db);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            rows.Add(new Message
            {
                Id = (ulong)r.GetInt64(0),
                ChannelId = (ulong)r.GetInt64(1),
                SenderIdentity = Identity.FromHexString(r.GetString(2)),
                Content = r.GetString(3),
                SentAt = new Timestamp(r.GetInt64(4)),
                EditedAt = r.IsDBNull(5) ? null : new Timestamp(r.GetInt64(5)),
                Deleted = r.GetBoolean(6),
            });
        }
        return rows;
    }

    private static async Task<List<DirectMessage>> ReadDirectMessagesAsync(NpgsqlConnection db, CancellationToken ct)
    {
        var rows = new List<DirectMessage>();
        await using var cmd = new NpgsqlCommand(
            "SELECT id, sender_identity, recipient_identity, content, sent_at, edited_at, " +
            "deleted_by_sender, deleted_by_recipient FROM archive_direct_message", db);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            rows.Add(new DirectMessage
            {
                Id = (ulong)r.GetInt64(0),
                SenderIdentity = Identity.FromHexString(r.GetString(1)),
                RecipientIdentity = Identity.FromHexString(r.GetString(2)),
                Content = r.GetString(3),
                SentAt = new Timestamp(r.GetInt64(4)),
                EditedAt = r.IsDBNull(5) ? null : new Timestamp(r.GetInt64(5)),
                DeletedBySender = r.GetBoolean(6),
                DeletedByRecipient = r.GetBoolean(7),
            });
        }
        return rows;
    }

    private static IEnumerable<List<T>> Chunk<T>(List<T> src)
    {
        for (var i = 0; i < src.Count; i += BatchSize)
            yield return src.GetRange(i, Math.Min(BatchSize, src.Count - i));
    }

    private static void Flush(DbConnection conn)
    {
        for (var i = 0; i < 3; i++) conn.FrameTick();
    }
}

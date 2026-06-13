using System.Threading.Channels;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace ArchiveWorker;

/// <summary>
/// Owns the PostgreSQL <c>archive</c> connection and serialises every write
/// through a single background consumer. Replication callbacks fire on the
/// SpacetimeDB client's tick thread; they only enqueue work, so DB I/O never
/// blocks message processing and all writes apply in arrival order on one
/// connection (no cross-write races).
/// </summary>
public sealed class ArchiveDatabase(WorkerOptions options, ILogger<ArchiveDatabase> logger) : IAsyncDisposable
{
    private readonly Channel<WriteOp> _queue =
        Channel.CreateUnbounded<WriteOp>(new UnboundedChannelOptions { SingleReader = true });

    private NpgsqlConnection? _conn;

    private sealed record WriteOp(string Description, Func<NpgsqlConnection, CancellationToken, Task> Run);

    /// <summary>
    /// Waits for the core-api-owned archive schema to exist, then opens the write
    /// connection. core-api owns the <c>archive</c> database and its EF migrations
    /// (created on its startup); the worker is a pure writer, so it just waits for
    /// the schema rather than creating it.
    /// </summary>
    public async Task InitializeAsync(CancellationToken ct)
    {
        await WaitForSchemaAsync(ct);

        _conn = new NpgsqlConnection(options.ArchiveConnectionString);
        await _conn.OpenAsync(ct);
        logger.LogInformation("Archive write connection open.");
    }

    /// <summary>
    /// Polls until the archive database is reachable and core-api has migrated the
    /// schema (the <c>archive_user</c> table exists). Tolerates a not-yet-created
    /// database and an un-migrated schema with capped exponential backoff.
    /// </summary>
    private async Task WaitForSchemaAsync(CancellationToken ct)
    {
        var delayMs = 1000;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await using var probe = new NpgsqlConnection(options.ArchiveConnectionString);
                await probe.OpenAsync(ct);
                // `to_regclass` returns the `regclass` OID type, which Npgsql won't
                // read as a scalar object — compare to NULL so we get a bool back.
                await using var cmd = new NpgsqlCommand(
                    "SELECT to_regclass('public.archive_user') IS NOT NULL", probe);
                if (await cmd.ExecuteScalarAsync(ct) is true)
                {
                    logger.LogInformation("Archive schema present.");
                    return;
                }
                logger.LogInformation("Archive schema not migrated yet (core-api owns it); waiting…");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogInformation("Archive database not reachable yet ({Message}); waiting…", ex.Message);
            }

            await Task.Delay(delayMs, ct);
            delayMs = Math.Min(delayMs * 2, 15000);
        }
    }

    /// <summary>Drains the write queue until cancellation. Runs as a long task.</summary>
    public async Task RunConsumerAsync(CancellationToken ct)
    {
        await foreach (var op in _queue.Reader.ReadAllAsync(ct))
        {
            try
            {
                await op.Run(_conn!, ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // Idempotent upserts + the reconcile-on-resubscribe path heal a
                // dropped write, so log and keep draining rather than wedging.
                logger.LogError(ex, "Archive write failed: {Description}", op.Description);
                await EnsureConnectionAsync(ct);
            }
        }
    }

    /// <summary>Enqueue a parameterised statement (positional <c>$1..$n</c> args).</summary>
    public void EnqueueExec(string description, string sql, object?[] args) =>
        _queue.Writer.TryWrite(new WriteOp(description, async (conn, ct) =>
        {
            await using var cmd = new NpgsqlCommand(sql, conn);
            foreach (var a in args)
                cmd.Parameters.Add(new NpgsqlParameter { Value = a ?? DBNull.Value });
            await cmd.ExecuteNonQueryAsync(ct);
        }));

    /// <summary>
    /// Enqueue a reconcile pass for one table: delete any archive row whose
    /// primary key is absent from the live SpacetimeDB snapshot, then stamp the
    /// table's watermark. Runs after the snapshot's upserts (FIFO), so the
    /// surviving set is authoritative.
    /// </summary>
    public void EnqueueReconcile(ReconcileRequest req) =>
        _queue.Writer.TryWrite(new WriteOp($"reconcile {req.PgTable}", async (conn, ct) =>
        {
            // Read current archive PK tuples.
            var pgKeys = new Dictionary<string, object?[]>();
            var selectPk = $"SELECT {string.Join(", ", req.PkColumns)} FROM {req.PgTable}";
            await using (var read = new NpgsqlCommand(selectPk, conn))
            await using (var reader = await read.ExecuteReaderAsync(ct))
            {
                while (await reader.ReadAsync(ct))
                {
                    var vals = new object?[req.PkColumns.Count];
                    for (var i = 0; i < vals.Length; i++)
                        vals[i] = reader.GetValue(i);
                    pgKeys[ReconcileRequest.KeyOf(vals)] = vals;
                }
            }

            var deleted = 0;
            foreach (var (key, vals) in pgKeys)
            {
                if (req.LiveKeys.Contains(key)) continue;
                await using var del = new NpgsqlCommand(req.DeleteSql, conn);
                foreach (var v in vals)
                    del.Parameters.Add(new NpgsqlParameter { Value = v ?? DBNull.Value });
                await del.ExecuteNonQueryAsync(ct);
                deleted++;
            }

            await using var stamp = new NpgsqlCommand(
                """
                INSERT INTO replication_state (table_name, last_full_sync_at, last_reconcile_at, row_count, updated_at)
                VALUES ($1, now(), now(), $2, now())
                ON CONFLICT (table_name) DO UPDATE SET
                    last_full_sync_at = now(), last_reconcile_at = now(),
                    row_count = EXCLUDED.row_count, updated_at = now()
                """, conn);
            stamp.Parameters.Add(new NpgsqlParameter { Value = req.PgTable });
            stamp.Parameters.Add(new NpgsqlParameter { Value = (long)req.LiveKeys.Count });
            await stamp.ExecuteNonQueryAsync(ct);

            if (deleted > 0)
                logger.LogInformation("Reconcile {Table}: removed {N} stale row(s), {Live} live.",
                    req.PgTable, deleted, req.LiveKeys.Count);
        }));

    private async Task EnsureConnectionAsync(CancellationToken ct)
    {
        try
        {
            if (_conn is { State: System.Data.ConnectionState.Open }) return;
            _conn?.Dispose();
            _conn = new NpgsqlConnection(options.ArchiveConnectionString);
            await _conn.OpenAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to re-open archive connection.");
        }
    }

    public async ValueTask DisposeAsync()
    {
        _queue.Writer.TryComplete();
        if (_conn is not null) await _conn.DisposeAsync();
    }
}

/// <summary>A single table's reconcile inputs.</summary>
public sealed record ReconcileRequest(
    string PgTable,
    IReadOnlyList<string> PkColumns,
    string DeleteSql,
    HashSet<string> LiveKeys)
{
    /// <summary>Stable string key for a PK tuple, consistent between the live snapshot and archive reads.</summary>
    public static string KeyOf(IReadOnlyList<object?> values) =>
        string.Join("", values.Select(v => v switch
        {
            null => "\0",
            long l => l.ToString(),
            _ => v.ToString(),
        }));
}

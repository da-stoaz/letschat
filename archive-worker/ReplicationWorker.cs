using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SpacetimeDB;
using SpacetimeDB.Types;

namespace ArchiveWorker;

/// <summary>
/// Long-running replication loop: connect to SpacetimeDB as the archive service
/// identity, subscribe to the <c>archive_*</c> views, mirror every insert/
/// update/delete into PostgreSQL, and reconcile on each (re)subscribe. Survives
/// disconnects by rebuilding the connection after a backoff.
/// </summary>
public sealed class ReplicationWorker(
    WorkerOptions options,
    ArchiveCredentials credentials,
    ArchiveDatabase db,
    Replication replication,
    Rebuild rebuild,
    IHostApplicationLifetime lifetime,
    ILogger<ReplicationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (options.Rebuild)
        {
            try
            {
                await RunRebuildAsync(ct);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Rebuild failed.");
            }
            lifetime.StopApplication();
            return;
        }

        await db.InitializeAsync(ct);
        var consumer = Task.Run(() => db.RunConsumerAsync(ct), ct);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await RunConnectionAsync(ct);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Replication connection failed; retrying.");
            }

            if (ct.IsCancellationRequested) break;
            logger.LogInformation("Reconnecting in {Ms}ms…", options.ReconnectDelayMs);
            await Task.Delay(options.ReconnectDelayMs, ct);
        }

        await consumer;
    }

    /// <summary>
    /// One-shot rebuild (A2): connect as the archive service identity, reload the
    /// durable tables from PostgreSQL via the <c>archive_restore_*</c> reducers,
    /// then exit. Assumes the worker's identity has been re-registered in the
    /// freshly-published module (see the migration runbook) so the gated restore
    /// reducers accept it.
    /// </summary>
    private async Task RunRebuildAsync(CancellationToken ct)
    {
        var token = await credentials.GetTokenAsync(ct);
        var connected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var builder = DbConnection.Builder()
            .WithUri(options.SpacetimeUri)
            .WithDatabaseName(options.SpacetimeModule)
            .OnConnect((conn, identity, _) =>
            {
                logger.LogInformation("Rebuild: connected as {Identity}", identity);
                WaitForRegistration(conn, identity, () => connected.TrySetResult(), ex => connected.TrySetException(ex));
            })
            .OnConnectError(ex =>
            {
                logger.LogError(ex, "Rebuild connect error.");
                connected.TrySetException(ex);
            });

        if (!string.IsNullOrWhiteSpace(token))
            builder = builder.WithToken(token);

        var connection = builder.Build();

        while (!connected.Task.IsCompleted && !ct.IsCancellationRequested)
        {
            connection.FrameTick();
            await Task.Delay(options.TickIntervalMs, ct);
        }
        await connected.Task; // surfaces a connect error

        await rebuild.RunAsync(connection, ct);
        try { connection.Disconnect(); } catch { /* already closing */ }
    }

    private async Task RunConnectionAsync(CancellationToken ct)
    {
        var token = await credentials.GetTokenAsync(ct);
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var builder = DbConnection.Builder()
            .WithUri(options.SpacetimeUri)
            .WithDatabaseName(options.SpacetimeModule)
            .OnConnect((conn, identity, _) =>
            {
                logger.LogInformation(
                    "Connected to SpacetimeDB. Archive worker identity: {Identity}", identity);
                logger.LogInformation(
                    "core-api automatically registers this identity from the shared token volume.");

                WaitForRegistration(conn, identity, () =>
                {
                    replication.Wire(conn);
                    var subscribed = false;
                    var canDelete = false;
                    void ReconcileWhenReady()
                    {
                        if (!subscribed) return;
                        var ready = conn.Db.ArchiveReplicationStatus.Iter().Any(row => row.CanDelete);
                        if (ready && !canDelete) replication.ReconcileAll(conn);
                        canDelete = ready;
                    }
                    conn.Db.ArchiveReplicationStatus.OnInsert += (_, _) => ReconcileWhenReady();
                    conn.Db.ArchiveReplicationStatus.OnUpdate += (_, _, _) => ReconcileWhenReady();
                    conn.Db.ArchiveReplicationStatus.OnDelete += (_, _) => ReconcileWhenReady();
                    conn.SubscriptionBuilder()
                        .OnApplied(_ =>
                        {
                            logger.LogInformation("Subscription applied; watching archive reconciliation readiness.");
                            subscribed = true;
                            ReconcileWhenReady();
                        })
                        .OnError((_, ex) =>
                        {
                            logger.LogError(ex, "Subscription error; reconnecting.");
                            closed.TrySetResult();
                        })
                        .Subscribe(Replication.SubscriptionQueries);
                }, ex =>
                {
                    logger.LogError(ex, "Archive registration subscription failed.");
                    closed.TrySetResult();
                });
            })
            .OnConnectError(ex =>
            {
                logger.LogError(ex, "Connect error.");
                closed.TrySetResult();
            })
            .OnDisconnect((_, ex) =>
            {
                if (ex is not null) logger.LogWarning("Disconnected: {Message}", ex.Message);
                else logger.LogInformation("Disconnected.");
                closed.TrySetResult();
            });

        if (!string.IsNullOrWhiteSpace(token))
            builder = builder.WithToken(token);

        var connection = builder.Build();

        try
        {
            while (!ct.IsCancellationRequested && !closed.Task.IsCompleted)
            {
                connection.FrameTick();
                await Task.Delay(options.TickIntervalMs, ct);
            }
        }
        finally
        {
            try { connection.Disconnect(); } catch { /* already closing */ }
        }
    }

    // Subscribe to gated archive views only after core-api has registered this
    // identity, including when token recovery happens after core-api started.
    private static void WaitForRegistration(DbConnection conn, Identity identity,
        Action ready, Action<Exception> failed)
    {
        var applied = false;
        void TryReady()
        {
            if (applied || !conn.Db.ArchiveService.Iter().Any(row => row.ServiceIdentity == identity)) return;
            applied = true;
            ready();
        }
        conn.Db.ArchiveService.OnInsert += (_, _) => TryReady();
        conn.Db.ArchiveService.OnUpdate += (_, _, _) => TryReady();
        conn.SubscriptionBuilder()
            .OnApplied(_ => TryReady())
            .OnError((_, ex) => failed(ex))
            .Subscribe(["SELECT * FROM archive_service"]);
    }
}

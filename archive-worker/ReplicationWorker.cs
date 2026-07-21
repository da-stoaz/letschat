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
    ArchiveDatabase db,
    Replication replication,
    ILogger<ReplicationWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
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

    private async Task RunConnectionAsync(CancellationToken ct)
    {
        var token = LoadToken();
        var closed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        var builder = DbConnection.Builder()
            .WithUri(options.SpacetimeUri)
            .WithDatabaseName(options.SpacetimeModule)
            .OnConnect((conn, identity, freshToken) =>
            {
                PersistToken(freshToken);
                logger.LogInformation(
                    "Connected to SpacetimeDB. Archive worker identity: {Identity}", identity);
                logger.LogInformation(
                    "If the archive views are empty, register this identity once (as an instance admin): " +
                    "spacetime call {Module} set_archive_service_identity '[\"{Identity}\"]'",
                    options.SpacetimeModule, identity);

                replication.Wire(conn);
                conn.SubscriptionBuilder()
                    .OnApplied(_ =>
                    {
                        logger.LogInformation("Subscription applied; reconciling archive.");
                        replication.ReconcileAll(conn);
                    })
                    .OnError((_, ex) => logger.LogError(ex, "Subscription error."))
                    .Subscribe(Replication.SubscriptionQueries);
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

        // Pump the client until it drops or we're asked to stop.
        while (!ct.IsCancellationRequested && !closed.Task.IsCompleted)
        {
            connection.FrameTick();
            await Task.Delay(options.TickIntervalMs, ct);
        }

        try { connection.Disconnect(); } catch { /* already closing */ }
    }

    private string? LoadToken()
    {
        if (!string.IsNullOrWhiteSpace(options.Token)) return options.Token;
        try
        {
            return File.Exists(options.TokenFile) ? File.ReadAllText(options.TokenFile).Trim() : null;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not read token file {File}.", options.TokenFile);
            return null;
        }
    }

    private void PersistToken(string token)
    {
        // Only the auto-issued token is cached; an explicitly configured token is authoritative.
        if (!string.IsNullOrWhiteSpace(options.Token) || string.IsNullOrWhiteSpace(token)) return;
        try
        {
            File.WriteAllText(options.TokenFile, token);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not persist token to {File}; identity may change on restart.", options.TokenFile);
        }
    }
}

using CoreApi.Data;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Services;

/// <summary>Replays durable account state after outages, restarts or a module rebuild.</summary>
public sealed class AccountAccessReconciler(IServiceScopeFactory scopes,
    ILogger<AccountAccessReconciler> logger) : BackgroundService
{
    private string? _afterId;

    internal async Task ReconcileBatchAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        // ponytail: periodically replay authoritative rows instead of maintaining
        // a second durable queue; use an outbox if account count makes this costly.
        var users = await db.Users.AsNoTracking()
            .Where(user => user.SpacetimeIdentity != "" && (_afterId == null || string.Compare(user.Id, _afterId) > 0))
            .OrderBy(user => user.Id).Take(100).ToListAsync(ct);
        var access = scope.ServiceProvider.GetRequiredService<AccountAccessService>();
        foreach (var user in users)
        {
            ct.ThrowIfCancellationRequested();
            _afterId = user.Id;
            await access.PushAsync(user, ct);
        }
        if (users.Count < 100) _afterId = null;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var batch = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                batch.CancelAfter(TimeSpan.FromSeconds(10));
                await ReconcileBatchAsync(batch.Token);
            }
            catch (OperationCanceledException) { }
            catch (Exception ex) { logger.LogWarning(ex, "Account access reconciliation will retry"); }
            try { await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }
}

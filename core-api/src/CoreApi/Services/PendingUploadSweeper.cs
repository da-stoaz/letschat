using CoreApi.Data;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Services;

/// <summary>
/// Removes objects whose upload was never confirmed. Pending rows continue to
/// reserve quota until the corresponding object has actually been deleted.
/// </summary>
public sealed class PendingUploadSweeper(
    IServiceScopeFactory scopes,
    StorageService storage,
    ILogger<PendingUploadSweeper> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);
    private const long GraceSeconds = 60;
    private const int BatchSize = 500;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        do
        {
            try
            {
                await SweepOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not sweep expired pending uploads; will retry.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    internal async Task SweepOnceAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var cutoff = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - GraceSeconds;
        var expired = await db.PendingUploads
            .AsNoTracking()
            .Where(p => p.ExpiresAt < cutoff)
            .OrderBy(p => p.ExpiresAt)
            .Take(BatchSize)
            .ToListAsync(ct);

        var swept = 0;
        foreach (var pending in expired)
        {
            try
            {
                await storage.DeleteObjectAsync(pending.StorageKey);
                if (db.Database.IsRelational())
                {
                    swept += await db.PendingUploads
                        .Where(p => p.Id == pending.Id && p.ExpiresAt < cutoff)
                        .ExecuteDeleteAsync(ct);
                }
                else
                {
                    var current = await db.PendingUploads.FindAsync([pending.Id], ct);
                    if (current is not null && current.ExpiresAt < cutoff)
                    {
                        db.PendingUploads.Remove(current);
                        swept += await db.SaveChangesAsync(ct);
                    }
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex,
                    "Could not remove expired pending upload {UploadId}; its quota remains reserved.",
                    pending.Id);
            }
        }

        if (swept > 0)
        {
            logger.LogInformation("Removed {Count} expired pending upload(s) from storage.", swept);
        }
    }
}

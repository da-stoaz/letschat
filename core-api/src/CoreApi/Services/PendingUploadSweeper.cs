using CoreApi.Data;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Services;

/// <summary>
/// Removes unconfirmed uploads and confirmed objects no longer referenced by
/// the chat domain. Database rows remain until MinIO deletion succeeds, so a
/// dependency outage can delay cleanup but can never make an object unknown.
/// </summary>
public sealed class PendingUploadSweeper(
    IServiceScopeFactory scopes,
    StorageService storage,
    SpacetimeClient spacetime,
    ILogger<PendingUploadSweeper> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);
    private const long GraceSeconds = 60;
    private const long ConfirmedGraceSeconds = 3600;
    private const int BatchSize = 500;
    private bool _inventoryImported;

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

        await SweepUnreferencedConfirmedAsync(db, ct);
    }

    private async Task SweepUnreferencedConfirmedAsync(AppDbContext db, CancellationToken ct)
    {
        if (!await spacetime.EnsureStorageReferencesReadyAsync(ct))
        {
            return;
        }
        if (!_inventoryImported)
        {
            await ImportExistingObjectsAsync(db, ct);
            _inventoryImported = true;
        }

        var cutoff = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - ConfirmedGraceSeconds;
        var candidates = await db.ConfirmedUploads
            .AsNoTracking()
            .Where(upload => upload.ConfirmedAt < cutoff)
            .OrderBy(upload => upload.ConfirmedAt)
            .Take(BatchSize)
            .ToListAsync(ct);
        if (candidates.Count == 0)
        {
            return;
        }

        var claimed = await spacetime.ClaimUnreferencedStorageAsync(
            candidates.Select(upload => upload.StorageKey).ToArray(), ct);
        if (claimed is null)
        {
            return;
        }

        var swept = 0;
        foreach (var upload in candidates.Where(upload => claimed.Contains(upload.StorageKey)))
        {
            try
            {
                await storage.DeleteObjectAsync(upload.StorageKey);
                if (db.Database.IsRelational())
                {
                    swept += await db.ConfirmedUploads
                        .Where(row => row.StorageKey == upload.StorageKey && row.ConfirmedAt < cutoff)
                        .ExecuteDeleteAsync(ct);
                }
                else
                {
                    var current = await db.ConfirmedUploads.FindAsync([upload.StorageKey], ct);
                    if (current is not null && current.ConfirmedAt < cutoff)
                    {
                        db.ConfirmedUploads.Remove(current);
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
                    "Could not remove unreferenced confirmed object {StorageKey}; will retry.",
                    upload.StorageKey);
            }
        }

        if (swept > 0)
        {
            logger.LogInformation("Removed {Count} unreferenced confirmed object(s) from storage.", swept);
        }
    }

    private async Task ImportExistingObjectsAsync(AppDbContext db, CancellationToken ct)
    {
        string? continuationToken = null;
        var imported = 0;
        do
        {
            var page = await storage.ListObjectsPageAsync(continuationToken, ct);
            continuationToken = page.NextContinuationToken;
            var keys = page.Objects.Select(item => item.StorageKey).ToArray();
            var known = await db.ConfirmedUploads
                .Where(row => keys.Contains(row.StorageKey))
                .Select(row => row.StorageKey)
                .ToHashSetAsync(StringComparer.Ordinal, ct);
            var pending = await db.PendingUploads
                .Where(row => keys.Contains(row.StorageKey))
                .Select(row => row.StorageKey)
                .ToHashSetAsync(StringComparer.Ordinal, ct);

            foreach (var item in page.Objects)
            {
                var parsed = StorageKey.TryParse(item.StorageKey);
                if (parsed is null || item.Size <= 0
                    || known.Contains(item.StorageKey) || pending.Contains(item.StorageKey))
                {
                    continue;
                }
                db.ConfirmedUploads.Add(new ConfirmedUpload
                {
                    StorageKey = item.StorageKey,
                    Username = parsed.Uploader,
                    FileName = Path.GetFileName(item.StorageKey),
                    FileSize = item.Size,
                    MimeType = "application/octet-stream",
                    ConfirmedAt = new DateTimeOffset(item.LastModifiedUtc.ToUniversalTime())
                        .ToUnixTimeSeconds(),
                });
                imported++;
            }
            await db.SaveChangesAsync(ct);
        }
        while (!string.IsNullOrEmpty(continuationToken));

        if (imported > 0)
        {
            logger.LogInformation(
                "Adopted {Count} existing MinIO object(s) into lifecycle tracking.", imported);
        }
    }
}

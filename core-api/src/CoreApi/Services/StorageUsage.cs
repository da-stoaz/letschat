using CoreApi.Data;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Services;

public static class StorageUsage
{
    /// <summary>One SQL snapshot sees a file either pending or confirmed during promotion.</summary>
    public static Task<long> RetainedAndPendingAsync(
        AppDbContext db, string? username, CancellationToken ct = default)
    {
        var confirmed = db.ConfirmedUploads
            .Where(row => username == null || row.Username == username)
            .Select(row => row.FileSize);
        var pending = db.PendingUploads
            .Where(row => username == null || row.Username == username)
            .Select(row => row.FileSize);
        return confirmed.Concat(pending).SumAsync(ct);
    }
}

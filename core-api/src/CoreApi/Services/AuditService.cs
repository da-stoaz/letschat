using CoreApi.Data;

namespace CoreApi.Services;

/// <summary>
/// Appends entries to the admin audit log. Singleton; each write uses a fresh
/// DB scope. Audit failures are swallowed (logged) — an audit hiccup must never
/// fail the underlying admin action.
/// </summary>
public sealed class AuditService(IServiceScopeFactory scopeFactory, ILogger<AuditService> logger)
{
    public async Task RecordAsync(
        string actor,
        string action,
        string targetType,
        string? targetId = null,
        string? detail = null)
    {
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.AuditLog.Add(new AuditLogEntry
            {
                TimestampUtc = DateTime.UtcNow,
                Actor = actor,
                Action = action,
                TargetType = targetType,
                TargetId = targetId,
                Detail = detail,
            });
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to write audit entry {Action} by {Actor}", action, actor);
        }
    }
}

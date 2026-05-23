using CoreApi.Configuration;
using CoreApi.Data;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Services;

/// <summary>
/// Provides the runtime-editable <see cref="SystemConfig"/> as a cached,
/// thread-safe snapshot. Registered as a singleton so other singletons (the
/// rate limiter, the SMTP sender) can read it synchronously; database access
/// goes through a fresh scope each time.
///
/// <para>
/// On first run the row is seeded from <c>ServiceOptions</c> — the values an
/// operator already set via environment variables become the initial config.
/// </para>
/// </summary>
public sealed class SystemConfigService(IServiceScopeFactory scopeFactory, ServiceOptions options)
{
    private volatile SystemConfig _current = SeedFrom(options);

    /// <summary>The current configuration snapshot.</summary>
    public SystemConfig Current => _current;

    /// <summary>Ensures the row exists (seeding on first run) and loads the cache.</summary>
    public async Task InitializeAsync()
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var row = await db.SystemConfig.FirstOrDefaultAsync(c => c.Id == SystemConfig.SingletonId);
        if (row is null)
        {
            row = SeedFrom(options);
            db.SystemConfig.Add(row);
            await db.SaveChangesAsync();
        }

        _current = row;
    }

    /// <summary>Applies an update to the persisted config and refreshes the cache.</summary>
    public async Task UpdateAsync(Action<SystemConfig> apply)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var row = await db.SystemConfig.FirstAsync(c => c.Id == SystemConfig.SingletonId);
        apply(row);
        row.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync();

        _current = row;
    }

    private static SystemConfig SeedFrom(ServiceOptions o) => new()
    {
        Id = SystemConfig.SingletonId,
        RegistrationOpen = true,
        RequireEmailConfirmation = o.RequireEmailConfirmation,
        RequireAdminApproval = o.RequireAdminApproval,
        RateLimitPermitLimit = o.RateLimitPermitLimit,
        RateLimitWindowSeconds = o.RateLimitWindowSeconds,
        SmtpHost = o.SmtpHost,
        SmtpPort = o.SmtpPort,
        SmtpUser = o.SmtpUser,
        SmtpPassword = o.SmtpPassword,
        SmtpUseStartTls = o.SmtpUseStartTls,
        EmailFromAddress = o.EmailFromAddress,
        EmailFromName = o.EmailFromName,
        UpdatedAtUtc = DateTime.UtcNow,
    };
}

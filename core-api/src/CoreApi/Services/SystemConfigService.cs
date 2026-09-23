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
            var envError = UploadLimits.ValidationError(options.UploadPartSizeMiB, options.UploadMaxFileSizeMiB,
                options.DailyUploadQuotaMiB, options.UserStorageLimitMiB, options.InstanceStorageLimitMiB);
            if (envError is not null) throw new InvalidOperationException(envError);
            row = SeedFrom(options);
            db.SystemConfig.Add(row);
            await db.SaveChangesAsync();
        }
        else if (row.UploadPartSizeMiB == 0 || row.UploadMaxFileSizeMiB == 0 || !row.UploadQuotaSettingsSeeded)
        {
            var envError = UploadLimits.ValidationError(options.UploadPartSizeMiB, options.UploadMaxFileSizeMiB,
                options.DailyUploadQuotaMiB, options.UserStorageLimitMiB, options.InstanceStorageLimitMiB);
            if (envError is not null) throw new InvalidOperationException(envError);
            // Newly added columns use zero on upgrade. Seed each only once;
            // subsequent .env edits never override the persisted admin choice.
            if (row.UploadPartSizeMiB == 0) row.UploadPartSizeMiB = options.UploadPartSizeMiB;
            if (row.UploadMaxFileSizeMiB == 0) row.UploadMaxFileSizeMiB = options.UploadMaxFileSizeMiB;
            if (!row.UploadQuotaSettingsSeeded)
            {
                row.DailyUploadQuotaMiB = options.DailyUploadQuotaMiB;
                row.UserStorageLimitMiB = options.UserStorageLimitMiB;
                row.InstanceStorageLimitMiB = options.InstanceStorageLimitMiB;
                row.UploadQuotaSettingsSeeded = true;
            }
            await db.SaveChangesAsync();
        }

        var error = UploadLimits.ValidationError(row.UploadPartSizeMiB, row.UploadMaxFileSizeMiB,
            row.DailyUploadQuotaMiB, row.UserStorageLimitMiB, row.InstanceStorageLimitMiB);
        if (error is not null) throw new InvalidOperationException(error);

        _current = row;
    }

    /// <summary>Applies an update to the persisted config and refreshes the cache.</summary>
    public async Task UpdateAsync(Action<SystemConfig> apply)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var row = await db.SystemConfig.FirstAsync(c => c.Id == SystemConfig.SingletonId);
        apply(row);
        var error = UploadLimits.ValidationError(row.UploadPartSizeMiB, row.UploadMaxFileSizeMiB,
            row.DailyUploadQuotaMiB, row.UserStorageLimitMiB, row.InstanceStorageLimitMiB);
        if (error is not null) throw new ArgumentException(error);
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
        UploadPartSizeMiB = o.UploadPartSizeMiB,
        UploadMaxFileSizeMiB = o.UploadMaxFileSizeMiB,
        DailyUploadQuotaMiB = o.DailyUploadQuotaMiB,
        UserStorageLimitMiB = o.UserStorageLimitMiB,
        InstanceStorageLimitMiB = o.InstanceStorageLimitMiB,
        UploadQuotaSettingsSeeded = true,
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

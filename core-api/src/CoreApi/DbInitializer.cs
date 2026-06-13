using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Data.Archive;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace CoreApi;

/// <summary>
/// Startup database work: apply EF migrations, sweep stale pending uploads,
/// seed the system <c>Admin</c> role, and (optionally) create the bootstrap
/// administrator from configuration.
/// </summary>
public static class DbInitializer
{
    public const string AdminRole = "Admin";

    public static async Task InitializeAsync(WebApplication app)
    {
        await using var scope = app.Services.CreateAsyncScope();
        var services = scope.ServiceProvider;
        var logger = services.GetRequiredService<ILoggerFactory>().CreateLogger("DbInitializer");

        var db = services.GetRequiredService<AppDbContext>();
        // Relational providers (Postgres in prod) run real EF migrations; the
        // InMemory provider used in tests has no migration story, so let EF
        // derive a transient schema from the model instead.
        if (db.Database.IsRelational())
        {
            await db.Database.MigrateAsync();
            logger.LogInformation("Database migrations applied.");
        }
        else
        {
            await db.Database.EnsureCreatedAsync();
            logger.LogInformation("Non-relational schema created from model.");
        }

        // The cold-archive schema (storage-tiering, plan 2) lives in a separate
        // database; MigrateAsync creates it if missing. core-api owns it so the
        // archive-worker can connect to an already-migrated schema.
        var archive = services.GetRequiredService<ArchiveDbContext>();
        if (archive.Database.IsRelational())
        {
            await archive.Database.MigrateAsync();
            logger.LogInformation("Archive database migrations applied.");
        }
        else
        {
            await archive.Database.EnsureCreatedAsync();
        }

        // Load (seeding on first run) the runtime-editable system configuration.
        await services.GetRequiredService<Services.SystemConfigService>().InitializeAsync();
        logger.LogInformation("System configuration loaded.");

        // ExecuteDeleteAsync is a relational-only EF method; the InMemory
        // provider in tests has no pending uploads to sweep anyway.
        if (db.Database.IsRelational())
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var swept = await db.PendingUploads.Where(p => p.ExpiresAt < now).ExecuteDeleteAsync();
            if (swept > 0)
            {
                logger.LogInformation("Swept {Count} expired pending upload(s).", swept);
            }
        }

        var roleManager = services.GetRequiredService<RoleManager<IdentityRole>>();
        if (!await roleManager.RoleExistsAsync(AdminRole))
        {
            await roleManager.CreateAsync(new IdentityRole(AdminRole));
            logger.LogInformation("Seeded the '{Role}' role.", AdminRole);
        }

        await SeedBootstrapAdminAsync(services, logger);
    }

    private static async Task SeedBootstrapAdminAsync(IServiceProvider services, ILogger logger)
    {
        var options = services.GetRequiredService<ServiceOptions>();
        if (string.IsNullOrWhiteSpace(options.BootstrapAdminUsername)
            || string.IsNullOrWhiteSpace(options.BootstrapAdminPassword))
        {
            return;
        }

        var users = services.GetRequiredService<UserManager<ApplicationUser>>();
        var username = Validation.NormalizeUsername(options.BootstrapAdminUsername);

        if (await users.FindByNameAsync(username) is not null)
        {
            return;
        }

        // Bootstrap admin uses a placeholder SpacetimeDB identity — it's
        // valid as an admin-panel principal but can't sign in to the desktop
        // client until rebound. Email is required (RequireUniqueEmail=true).
        var admin = new ApplicationUser
        {
            UserName = username,
            Email = options.BootstrapAdminEmail,
            DisplayName = "Administrator",
            SpacetimeIdentity = "pending:bootstrap-admin",
            SpacetimeIdentityNorm = "pending:bootstrap-admin",
            Status = AccountStatus.Active,
            EmailConfirmed = true,
        };

        var created = await users.CreateAsync(admin, options.BootstrapAdminPassword);
        if (!created.Succeeded)
        {
            logger.LogWarning(
                "Failed to create bootstrap admin: {Errors}",
                string.Join("; ", created.Errors.Select(e => e.Description)));
            return;
        }

        await users.AddToRoleAsync(admin, AdminRole);
        logger.LogInformation("Created bootstrap admin '{Username}'.", username);
    }
}

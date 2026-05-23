using CoreApi.Configuration;
using CoreApi.Data;
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
        await db.Database.MigrateAsync();
        logger.LogInformation("Database migrations applied.");

        // Load (seeding on first run) the runtime-editable system configuration.
        await services.GetRequiredService<Services.SystemConfigService>().InitializeAsync();
        logger.LogInformation("System configuration loaded.");

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var swept = await db.PendingUploads.Where(p => p.ExpiresAt < now).ExecuteDeleteAsync();
        if (swept > 0)
        {
            logger.LogInformation("Swept {Count} expired pending upload(s).", swept);
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

        var admin = new ApplicationUser
        {
            UserName = username,
            DisplayName = "Administrator",
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

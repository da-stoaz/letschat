using CoreApi.Data;
using CoreApi.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// The startup identity migration now reads two columns and loads full rows
/// only for accounts that need a change (BUG_ANALYSIS F3). It must still fix
/// every stale account and leave the rest alone.
/// </summary>
public sealed class LegacyIdentityMigrationTests
{
    [Fact]
    public async Task Fixes_Only_Accounts_Whose_Identity_Is_Not_Yet_Derived()
    {
        using var factory = new LetsChatWebApplicationFactory();
        _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var spacetime = scope.ServiceProvider.GetRequiredService<SpacetimeTokenService>();

        // A junk legacy value: fixed locally, nothing to re-key in SpacetimeDB.
        var stale = new ApplicationUser { UserName = "stale", SpacetimeIdentity = "junk", SpacetimeIdentityNorm = "junk" };
        var current = new ApplicationUser { UserName = "current" };
        current.SpacetimeIdentity = current.SpacetimeIdentityNorm = spacetime.ComputeIdentityHex(current.Id);
        var untouchedStamp = current.UpdatedAtUtc;
        db.Users.AddRange(stale, current);
        await db.SaveChangesAsync();

        await DbInitializer.MigrateLegacyIdentitiesAsync(
            db, spacetime, scope.ServiceProvider.GetRequiredService<SpacetimeClient>(), NullLogger.Instance);

        var rows = await db.Users.AsNoTracking().Where(u => u.UserName == "stale" || u.UserName == "current").ToListAsync();
        Assert.Equal(spacetime.ComputeIdentityHex(stale.Id), rows.Single(u => u.UserName == "stale").SpacetimeIdentityNorm);
        Assert.Equal(untouchedStamp, rows.Single(u => u.UserName == "current").UpdatedAtUtc);
    }
}

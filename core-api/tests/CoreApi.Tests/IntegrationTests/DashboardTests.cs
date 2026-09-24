using CoreApi.Data;
using CoreApi.Pages.Admin;
using CoreApi.Services;
using Microsoft.Extensions.DependencyInjection;

namespace CoreApi.Tests.IntegrationTests;

public sealed class DashboardTests
{
    [Fact]
    public async Task Overview_Groups_Accounts_Fills_Empty_Days_And_Reports_Storage()
    {
        using var factory = new LetsChatWebApplicationFactory();
        _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var services = scope.ServiceProvider;
        var db = services.GetRequiredService<AppDbContext>();
        var page = ActivatorUtilities.CreateInstance<IndexModel>(services);
        await page.OnGetAsync();
        Assert.Equal(14, page.Signups.Count);
        Assert.All(page.Signups, day => Assert.Equal(0, day.Count));
        Assert.Empty(page.RecentActivity);

        var today = DateTime.UtcNow.Date;
        db.Users.AddRange(
            new ApplicationUser { UserName = "pending", Status = AccountStatus.EmailVerified, CreatedAtUtc = today.AddDays(-2) },
            new ApplicationUser { UserName = "active", Status = AccountStatus.Active, CreatedAtUtc = today.AddDays(-13) },
            new ApplicationUser { UserName = "old", Status = AccountStatus.Disabled, CreatedAtUtc = today.AddDays(-14) });
        db.ConfirmedUploads.Add(new ConfirmedUpload { StorageKey = "stored", FileSize = 2048 });
        db.PendingUploads.Add(new PendingUpload { Id = "pending", FileSize = 1024 });
        for (var i = 0; i < 7; i++)
            db.AuditLog.Add(new AuditLogEntry { Action = $"action-{i}", TimestampUtc = today.AddMinutes(i) });
        await db.SaveChangesAsync();
        services.GetRequiredService<StorageInventoryState>().MarkReady();
        await page.OnGetAsync();

        Assert.Equal(3, page.Total);
        Assert.Equal(1, page.PendingApproval);
        Assert.Equal("pending", Assert.Single(page.PendingUsers).UserName);
        Assert.Equal(2, page.Signups.Sum(day => day.Count));
        Assert.Equal(1, page.Signups.First().Count);
        Assert.Equal(0, page.Signups.Last().Count);
        Assert.Equal(2048, page.StoredBytes);
        Assert.Equal(1024, page.ReservedBytes);
        Assert.Equal(1, page.StoredFiles);
        Assert.Equal(1, page.PendingUploads);
        Assert.Equal(5, page.RecentActivity.Count);
        Assert.Equal("action-6", page.RecentActivity.First().Action);
        Assert.Equal("100", IndexModel.Percent(110));
        Assert.Equal("0", IndexModel.Percent(-1));
    }
}

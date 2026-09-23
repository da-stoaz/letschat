using CoreApi.Data;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Tests;

public sealed class MigrationTests
{
    [Fact]
    public void Confirmed_Upload_Registry_Migration_Is_Discoverable()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql("Host=localhost;Database=unused;Username=unused;Password=unused")
            .Options;
        using var db = new AppDbContext(options);

        Assert.Contains("20260919150000_TrackConfirmedUploads", db.Database.GetMigrations());
    }
}

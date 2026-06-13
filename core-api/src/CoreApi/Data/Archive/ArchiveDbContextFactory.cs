using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace CoreApi.Data.Archive;

/// <summary>
/// Design-time factory so <c>dotnet ef</c> can build the archive context without
/// booting the web host. Reads the same <c>ARCHIVE_DATABASE_URL</c> the running
/// service uses, falling back to the local dev connection string.
/// </summary>
public sealed class ArchiveDbContextFactory : IDesignTimeDbContextFactory<ArchiveDbContext>
{
    public ArchiveDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("ARCHIVE_DATABASE_URL")
            ?? "Host=localhost;Port=5432;Database=archive;Username=letschat;Password=letschat";

        var options = new DbContextOptionsBuilder<ArchiveDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new ArchiveDbContext(options);
    }
}

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace CoreApi.Data;

/// <summary>
/// Design-time factory so <c>dotnet ef</c> can build the context without
/// booting the whole web host. Reads the same <c>AUTH_DATABASE_URL</c> the
/// running service uses, falling back to the local dev connection string.
/// </summary>
public sealed class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("AUTH_DATABASE_URL")
            ?? "Host=localhost;Port=5432;Database=auth;Username=letschat;Password=letschat";

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new AppDbContext(options);
    }
}

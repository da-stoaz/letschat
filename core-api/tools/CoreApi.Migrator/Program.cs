using CoreApi.Data;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

// ─────────────────────────────────────────────────────────────────────────────
// CoreApi.Migrator — one-time data migration from the legacy Rust auth-service.
//
// Reads the SQLite `accounts` table and writes ASP.NET Core Identity users into
// the PostgreSQL `auth` database. Argon2id password hashes are copied verbatim
// (Argon2Phc verifies them as-is, so migrated users keep their passwords).
//
// Usage:
//   dotnet run --project tools/CoreApi.Migrator -- \
//       --sqlite ../auth-service/auth.db \
//       --postgres "Host=localhost;Port=5433;Database=auth;Username=letschat;Password=letschat"
//
// The migration is idempotent: an account whose username OR SpacetimeDB
// identity already exists in PostgreSQL is skipped.
// ─────────────────────────────────────────────────────────────────────────────

var arguments = ParseArgs(args);

if (!arguments.TryGetValue("sqlite", out var sqlitePath))
{
    sqlitePath = Path.Combine("..", "auth-service", "auth.db");
}

if (!arguments.TryGetValue("postgres", out var postgresConn))
{
    postgresConn = Environment.GetEnvironmentVariable("AUTH_DATABASE_URL")
        ?? "Host=localhost;Port=5433;Database=auth;Username=letschat;Password=letschat";
}

var dryRun = arguments.ContainsKey("dry-run");

if (!File.Exists(sqlitePath))
{
    Console.Error.WriteLine($"ERROR: SQLite database not found at '{sqlitePath}'.");
    return 1;
}

Console.WriteLine($"Source (SQLite)  : {Path.GetFullPath(sqlitePath)}");
Console.WriteLine($"Target (Postgres): {postgresConn}");
Console.WriteLine(dryRun ? "Mode             : DRY RUN (no writes)" : "Mode             : APPLY");
Console.WriteLine();

var legacyAccounts = ReadLegacyAccounts(sqlitePath);
Console.WriteLine($"Found {legacyAccounts.Count} legacy account(s).");

var dbOptions = new DbContextOptionsBuilder<AppDbContext>()
    .UseNpgsql(postgresConn)
    .Options;

await using var db = new AppDbContext(dbOptions);

if (!await db.Database.CanConnectAsync())
{
    Console.Error.WriteLine("ERROR: cannot connect to the PostgreSQL target database.");
    return 1;
}

int migrated = 0, skipped = 0;

foreach (var account in legacyAccounts)
{
    var username = account.Username.Trim().ToLowerInvariant();
    var identityNorm = account.SpacetimeIdentity.Trim().ToLowerInvariant();
    var normalizedUserName = username.ToUpperInvariant();

    var clashes = await db.Users.AnyAsync(u =>
        u.NormalizedUserName == normalizedUserName
        || (u.SpacetimeIdentityNorm == identityNorm && identityNorm != ""));

    if (clashes)
    {
        Console.WriteLine($"  SKIP  {username} (username or identity already present)");
        skipped++;
        continue;
    }

    var user = new ApplicationUser
    {
        Id = Guid.NewGuid().ToString(),
        UserName = username,
        NormalizedUserName = normalizedUserName,
        Email = null,
        NormalizedEmail = null,
        EmailConfirmed = true,
        PasswordHash = account.PasswordHash,
        SecurityStamp = Guid.NewGuid().ToString(),
        ConcurrencyStamp = Guid.NewGuid().ToString(),
        LockoutEnabled = true,
        DisplayName = account.DisplayName,
        SpacetimeIdentity = account.SpacetimeIdentity,
        SpacetimeIdentityNorm = identityNorm,
        SpacetimeToken = account.SpacetimeToken,
        // Existing users are grandfathered: fully usable, no email/approval gate.
        Status = AccountStatus.Active,
        CreatedAtUtc = DateTime.UtcNow,
        UpdatedAtUtc = DateTime.UtcNow,
    };

    if (!dryRun)
    {
        db.Users.Add(user);
    }

    var identityPreview = identityNorm[..Math.Min(16, identityNorm.Length)];
    Console.WriteLine($"  OK    {username}  ->  identity {identityPreview}…");
    migrated++;
}

if (!dryRun)
{
    await db.SaveChangesAsync();
}

Console.WriteLine();
Console.WriteLine($"Done. Migrated: {migrated}, Skipped: {skipped}.");
return 0;

// ── helpers ──────────────────────────────────────────────────────────────────

static Dictionary<string, string> ParseArgs(string[] args)
{
    var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    for (var i = 0; i < args.Length; i++)
    {
        if (!args[i].StartsWith("--", StringComparison.Ordinal))
        {
            continue;
        }

        var key = args[i][2..];
        if (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal))
        {
            result[key] = args[++i];
        }
        else
        {
            result[key] = "true";
        }
    }

    return result;
}

static List<LegacyAccount> ReadLegacyAccounts(string sqlitePath)
{
    var accounts = new List<LegacyAccount>();
    using var connection = new SqliteConnection($"Data Source={sqlitePath};Mode=ReadOnly");
    connection.Open();

    using var command = connection.CreateCommand();
    command.CommandText =
        "SELECT username, display_name, password_hash, spacetime_token, spacetime_identity " +
        "FROM accounts";

    using var reader = command.ExecuteReader();
    while (reader.Read())
    {
        accounts.Add(new LegacyAccount(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4)));
    }

    return accounts;
}

internal sealed record LegacyAccount(
    string Username,
    string DisplayName,
    string PasswordHash,
    string SpacetimeToken,
    string SpacetimeIdentity);

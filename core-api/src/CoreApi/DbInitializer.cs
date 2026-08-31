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
        //
        // The archive is an OPTIONAL background replica and must never take down
        // the essential auth service. Two guards encode that priority:
        //   1. Not configured (ARCHIVE_DATABASE_URL unset → context not
        //      registered): GetService returns null and we skip it entirely.
        //   2. Configured but unreachable (Postgres still starting, archive DB
        //      not yet created, transient network fault): log loudly and carry
        //      on, rather than letting the throw crash-loop the whole service.
        // The auth MigrateAsync above is deliberately NOT wrapped this way — if
        // auth's DB is down, core-api genuinely can't function and should fail.
        var archive = services.GetService<ArchiveDbContext>();
        if (archive is null)
        {
            logger.LogInformation(
                "Archive database not configured (ARCHIVE_DATABASE_URL unset); archive features disabled.");
        }
        else if (archive.Database.IsRelational())
        {
            try
            {
                await archive.Database.MigrateAsync();
                logger.LogInformation("Archive database migrations applied.");
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "Archive database migration failed; archive features disabled, auth continues.");
            }
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
        // Detached on purpose: a diagnostic, never a dependency. Awaiting it would
        // add its whole retry budget to every cold start — and to every
        // integration-test host — to learn something startup does not act on.
        _ = Task.Run(() => WarnIfSpacetimeUnreachableAsync(
            services.GetRequiredService<Services.SpacetimeClient>(),
            services.GetRequiredService<ServiceOptions>(), logger));
        await PinTrustedIssuerBestEffortAsync(
            services.GetRequiredService<Services.SpacetimeClient>(), logger);
        await MigrateLegacyIdentitiesAsync(
            services.GetRequiredService<AppDbContext>(),
            services.GetRequiredService<Services.SpacetimeTokenService>(),
            services.GetRequiredService<Services.SpacetimeClient>(),
            logger);
    }

    /// <summary>Startup reachability probe: attempts before giving up.</summary>
    private const int SpacetimeProbeAttempts = 3;

    /// <summary>Gap between probes — SpacetimeDB is only <c>depends_on: service_started</c>.</summary>
    private static readonly TimeSpan SpacetimeProbeRetryDelay = TimeSpan.FromSeconds(3);

    /// <summary>
    /// Proves at startup that core-api can actually reach SpacetimeDB, and says so
    /// loudly if it cannot.
    ///
    /// <para>
    /// Every core-api → module call is individually fail-soft by design: the
    /// issuer pin is best-effort, the identity migration defers, and the voice
    /// gate fails closed. Each of those is right on its own, but together they
    /// meant a wholly unreachable module produced nothing louder than scattered
    /// warnings — and surfaced to users as a wrong answer about voice permissions.
    /// This is the one place that names the actual fault, once, at Error.
    /// </para>
    ///
    /// <para>
    /// Deliberately NOT fatal. SpacetimeDB is only <c>depends_on:
    /// service_started</c>, so it routinely lags core-api on a cold boot; refusing
    /// to start would turn a slow dependency into a crash loop. It retries a few
    /// times first for the same reason.
    /// </para>
    /// </summary>
    private static async Task WarnIfSpacetimeUnreachableAsync(
        Services.SpacetimeClient spacetime, ServiceOptions options, ILogger logger)
    {
        try
        {
            await ProbeSpacetimeAsync(spacetime, options, logger);
        }
        catch (Exception ex)
        {
            // Detached, so nothing is awaiting this to observe a fault — and a
            // host shutting down mid-probe must not surface as an unhandled task.
            logger.LogDebug(ex, "SpacetimeDB reachability probe ended early.");
        }
    }

    private static async Task ProbeSpacetimeAsync(
        Services.SpacetimeClient spacetime, ServiceOptions options, ILogger logger)
    {
        for (var attempt = 1; ; attempt++)
        {
            var reason = await spacetime.ProbeUnreachableReasonAsync();
            if (reason is null)
            {
                logger.LogInformation(
                    "SpacetimeDB reachable at {Url}.", options.SpacetimeHttpUrl);
                return;
            }

            if (attempt >= SpacetimeProbeAttempts)
            {
                logger.LogError(
                    "core-api CANNOT REACH SpacetimeDB at {Url} ({Reason}). Voice authorization, "
                    + "instance-admin propagation, the trusted-issuer pin and the identity "
                    + "migration will all fail until this is fixed. In Docker this must be the "
                    + "compose service address (SPACETIMEDB_HTTP_URL=http://spacetimedb:3000) — "
                    + "'localhost' resolves to the core-api container itself, not the database.",
                    options.SpacetimeHttpUrl, reason);
                return;
            }

            await Task.Delay(SpacetimeProbeRetryDelay);
        }
    }

    /// <summary>
    /// Tells the SpacetimeDB module which OIDC issuer may register accounts, so
    /// an anonymous WebSocket client can't create one behind core-api's back.
    /// See <see cref="Services.SpacetimeClient.PinTrustedIssuerAsync"/>.
    ///
    /// <para>
    /// Never fatal: a brand-new instance has no admin to sign the call with
    /// until its first user registers, and SpacetimeDB may simply not be up yet.
    /// Both are expected, and an admin sign-in retries.
    /// </para>
    /// </summary>
    private static async Task PinTrustedIssuerBestEffortAsync(
        Services.SpacetimeClient spacetime, ILogger logger)
    {
        try
        {
            if (!await spacetime.PinTrustedIssuerAsync())
            {
                logger.LogInformation(
                    "SpacetimeDB trusted issuer not pinned yet: no instance admin exists. "
                    + "It is pinned automatically once an admin signs in.");
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(
                ex, "Could not pin the SpacetimeDB trusted issuer; retrying on the next admin sign-in.");
        }
    }

    /// <summary>A 32-byte SpacetimeDB identity as lower/upper-case hex (64 chars).</summary>
    private static bool IsHexIdentity(string value) =>
        value.Length == 64 && value.All(Uri.IsHexDigit);

    /// <summary>
    /// One-time identity migration for the OIDC cutover. Accounts created before
    /// core-api became the issuer hold a legacy (client-supplied) SpacetimeDB
    /// identity; the identity is now derived deterministically from the account
    /// id. This rewrites every account's stored identity to the derived value so
    /// the identity core-api returns matches the one its minted tokens resolve to.
    ///
    /// <para>
    /// Automatic and idempotent: a fresh install has no legacy accounts (new ones
    /// are already derived at creation), so it's a no-op; on an upgrade it runs
    /// once and then finds nothing to change. The matching SpacetimeDB row-data
    /// re-key is handled out-of-band by the archive rebuild (see the migration
    /// runbook) — this covers the core-api-owned side.
    /// </para>
    /// </summary>
    private static async Task MigrateLegacyIdentitiesAsync(
        AppDbContext db,
        Services.SpacetimeTokenService spacetime,
        Services.SpacetimeClient client,
        ILogger logger)
    {
        // Compute the target (derived) identity for every account and gather what
        // needs to change. `pairs` are the accounts that also have live
        // SpacetimeDB data to re-key (a valid 64-hex legacy identity); accounts
        // with a junk/empty legacy value still get their stored identity fixed,
        // but have no rows to move.
        var pending = new List<(ApplicationUser User, string Derived)>();
        var pairs = new List<(string OldHex, string NewHex)>();
        foreach (var user in await db.Users.ToListAsync())
        {
            var derived = spacetime.ComputeIdentityHex(user.Id);
            if (string.Equals(user.SpacetimeIdentityNorm, derived, StringComparison.Ordinal))
            {
                continue;
            }
            pending.Add((user, derived));
            if (IsHexIdentity(user.SpacetimeIdentityNorm))
            {
                pairs.Add((user.SpacetimeIdentityNorm, derived));
            }
        }

        if (pending.Count == 0)
        {
            return; // fresh install, or already migrated — nothing to do.
        }

        // Re-key SpacetimeDB's data FIRST, so core-api's stored identities and the
        // chat-domain rows never diverge. If it can't run now (service token
        // absent, SpacetimeDB unreachable), defer the whole migration — leaving
        // stored identities untouched — and retry on the next start. One batched,
        // transactional reducer call, driven while the service token's identity is
        // still admin.
        if (pairs.Count > 0)
        {
            if (!client.IsConfigured)
            {
                logger.LogWarning(
                    "Identity migration deferred: SPACETIMEDB_SERVICE_TOKEN not configured "
                    + "({Count} account(s) awaiting re-key).", pairs.Count);
                return;
            }
            try
            {
                await client.RekeyIdentitiesAsync(pairs);
            }
            catch (Exception ex)
            {
                logger.LogError(ex,
                    "Identity migration deferred: SpacetimeDB re-key failed; will retry on next start.");
                return;
            }
        }

        // Data moved (or there was none) — now advance core-api's own copy.
        foreach (var (user, derived) in pending)
        {
            user.SpacetimeIdentity = derived;
            user.SpacetimeIdentityNorm = derived;
            user.UpdatedAtUtc = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();
        logger.LogInformation(
            "Identity migration: {Accounts} account(s) updated, {Pairs} re-keyed in SpacetimeDB.",
            pending.Count, pairs.Count);
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

        // Deterministic identity from the account id — so the bootstrap admin can
        // sign in to the desktop client too. Email is required (RequireUniqueEmail=true).
        var admin = new ApplicationUser
        {
            UserName = username,
            Email = options.BootstrapAdminEmail,
            DisplayName = "Administrator",
            Status = AccountStatus.Active,
            EmailConfirmed = true,
        };
        Endpoints.AuthEndpoints.AssignDerivedIdentity(
            admin, services.GetRequiredService<Services.SpacetimeTokenService>());

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

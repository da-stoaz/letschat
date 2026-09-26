using System.Net;
using CoreApi.Services;

namespace CoreApi.Configuration;

/// <summary>
/// Strongly-typed service configuration. Values are read from environment
/// variables (matching the names the legacy Rust auth-service used, so the
/// existing docker-compose / .env files carry over) with sensible dev defaults.
/// </summary>
public sealed class ServiceOptions
{
    // Public dev defaults. These are checked-in, well-known values used for local
    // development. They are referenced both as the fallbacks in
    // <see cref="FromConfiguration"/> and by <see cref="FindInsecureDefaults"/>,
    // so a default can never silently drift out of the production guard.
    internal const string DevJwtSecret = "w7Qk9R2mN5xH3cV8pL4tJ6dF1sA0zB7uY2gE5nK8qM3rT9hC";
    internal const string DevLiveKitApiSecret = "devsecret0123456789devsecret0123456789";
    internal const string DevMinioSecretKey = "minioadmin";

    // The dev OIDC issuer. SpacetimeDB (in Docker) reaches core-api (on the host)
    // via host.docker.internal; this URL is baked into every derived identity, so
    // it is guarded like a secret — prod MUST override it (see FindInsecureDefaults).
    internal const string DevSpacetimeOidcIssuer = "http://host.docker.internal:8787";

    // Every secret in the shipped .env.production.*.example templates starts
    // with this. The templates are as public as the dev defaults above, so a
    // placeholder left in place is just as forgeable.
    internal const string TemplatePlaceholderPrefix = "change-me";

    public required string ConnectionString { get; init; }

    /// <summary>
    /// Npgsql connection string for the <c>archive</c> database (storage-tiering,
    /// plan 2). core-api owns this schema via <c>ArchiveDbContext</c> + EF
    /// migrations — applied on startup, like the <c>auth</c> context — and the
    /// archive-worker connects to the already-migrated schema.
    /// <para>
    /// <b>Optional, and deliberately has no default.</b> When
    /// <c>ARCHIVE_DATABASE_URL</c> is unset this is <c>null</c> and the archive is
    /// disabled: the <c>ArchiveDbContext</c> is not registered and no migration
    /// runs. The archive is a background replica; it must never be able to take
    /// down the (essential) auth service, so an unconfigured or unreachable
    /// archive degrades gracefully instead of crashing startup.
    /// </para>
    /// </summary>
    public string? ArchiveConnectionString { get; init; }

    public required string Bind { get; init; }

    /// <summary>
    /// Listener for the admin control panel (<c>/admin/*</c>). A separate port
    /// that the public reverse proxy does not expose — defence in depth so the
    /// panel is not reachable from the open internet.
    /// </summary>
    public required string AdminBind { get; init; }
    public required string JwtSecret { get; init; }

    public required string MinioAccessKey { get; init; }
    public required string MinioSecretKey { get; init; }
    public required string MinioBucket { get; init; }
    public required string MinioInternalEndpoint { get; init; }
    public required string MinioPublicEndpoint { get; init; }
    public required int UploadPartSizeMiB { get; init; }
    public required int UploadMaxFileSizeMiB { get; init; }
    public long DailyUploadQuotaMiB { get; init; } = UploadLimits.DefaultDailyMiB;
    public long UserStorageLimitMiB { get; init; }
    public long InstanceStorageLimitMiB { get; init; }
    /// <summary>ffmpeg binary for video poster frames; missing binary disables thumbnails.</summary>
    public string FfmpegPath { get; init; } = "ffmpeg";

    public required string LiveKitApiKey { get; init; }
    public required string LiveKitApiSecret { get; init; }

    public required string DiscoverySpacetimeDbUri { get; init; }
    public required string DiscoveryAuthUrl { get; init; }
    public required string DiscoveryLiveKitUrl { get; init; }

    /// <summary>
    /// Public URL of this instance's hosted web client (e.g. <c>https://app.example.com</c>).
    /// Optional; advertised in discovery so the desktop app can build invite links
    /// that open in a browser. Unset means the instance hosts no web client.
    /// </summary>
    public string? DiscoveryWebUrl { get; init; }

    /// <summary>
    /// LiveKit's HTTP API as core-api reaches it (not the public signalling URL):
    /// <see cref="Services.LiveKitVoiceReconciler"/> removes participants who lost
    /// voice presence through it. Compose sets <c>http://livekit:44380</c>.
    /// </summary>
    public string LiveKitInternalUrl { get; init; } = "http://127.0.0.1:7880";
    public required string DiscoveryDatabase { get; init; }

    /// <summary>Optional bootstrap admin — created on startup if both are set.</summary>
    public string? BootstrapAdminUsername { get; init; }
    public string? BootstrapAdminPassword { get; init; }
    /// <summary>
    /// Email for the bootstrap admin. Defaults to <c>admin@letschat.local</c>;
    /// must be set explicitly when the placeholder collides with a real account.
    /// Required because <c>RequireUniqueEmail</c> is on — Identity rejects an
    /// empty email even on the first seeded account.
    /// </summary>
    public required string BootstrapAdminEmail { get; init; }

    // ── Phase 2: registration hardening ──────────────────────────────────────

    /// <summary>
    /// When true, a self-registered account starts <c>Registered</c> and cannot
    /// sign in until its email is confirmed. When false, registration behaves as
    /// in Phase 1 (account created <c>Active</c>, immediately usable).
    /// </summary>
    public required bool RequireEmailConfirmation { get; init; }

    /// <summary>
    /// When true, a self-registered account waits in <c>EmailVerified</c> for an
    /// admin to approve it before becoming <c>Active</c>. Only meaningful with
    /// <see cref="RequireEmailConfirmation"/> enabled — the approval queue is
    /// entered via the email-confirmation step.
    /// </summary>
    public required bool RequireAdminApproval { get; init; }

    /// <summary>Email transport: <c>smtp</c> or <c>log</c> (dev — writes to the log).</summary>
    public required string EmailSenderKind { get; init; }

    public required string SmtpHost { get; init; }
    public required int SmtpPort { get; init; }
    public string? SmtpUser { get; init; }
    public string? SmtpPassword { get; init; }
    public required bool SmtpUseStartTls { get; init; }
    public required string EmailFromAddress { get; init; }
    public required string EmailFromName { get; init; }

    /// <summary>Requests permitted per IP per <see cref="RateLimitWindowSeconds"/> on auth endpoints.</summary>
    public required int RateLimitPermitLimit { get; init; }
    public required int RateLimitWindowSeconds { get; init; }

    // ── SpacetimeDB service identity (1.5 — space permissions & discovery) ───

    /// <summary>HTTP base for SpacetimeDB reducer / SQL calls.</summary>
    public required string SpacetimeHttpUrl { get; init; }

    /// <summary>Module name (database identifier) for reducer URLs.</summary>
    public required string SpacetimeModuleName { get; init; }

    /// <summary>
    /// Bearer token for the SpacetimeDB module owner. The module's init reducer
    /// creates that publisher identity's admin row, so no public account is used
    /// for bootstrap. Optional override: Compose normally reads the persisted
    /// publisher credential via <see cref="SpacetimeServiceTokenFile"/>.
    /// </summary>
    public string? SpacetimeServiceToken { get; init; }

    /// <summary>
    /// The <c>spacetime</c> CLI config (<c>cli.toml</c>) of the identity that
    /// published the module. Compose mounts module-init's volume read-only and
    /// points this at it, so core-api reads the owner credential itself instead
    /// of an operator copying it into <c>.env</c>. Re-read on every use: on a
    /// fresh install the file only appears once module-init has run.
    /// <see cref="SpacetimeServiceToken"/>, when set, wins.
    /// </summary>
    public string? SpacetimeServiceTokenFile { get; init; }

    /// <summary>
    /// The archive-worker's persisted SpacetimeDB token. When set, core-api
    /// registers that identity as the archive service itself, so replication
    /// starts without a manual <c>set_archive_service_identity</c> call.
    /// </summary>
    public string? ArchiveWorkerTokenFile { get; init; }

    // ── OIDC issuer for SpacetimeDB (identity-authority-inversion) ───────────

    /// <summary>
    /// The canonical issuer URL. Baked into every derived SpacetimeDB identity
    /// via <c>blake3(iss + "|" + sub)</c>, so it is a <b>permanent deployment
    /// constant</b> — changing it silently re-hashes every account into a
    /// different identity. Must be byte-identical to the URL the SpacetimeDB
    /// server fetches OIDC metadata from, and reachable server-to-server from it.
    /// Prod must override the dev default (guarded in <see cref="FindInsecureDefaults"/>).
    /// </summary>
    public required string SpacetimeOidcIssuer { get; init; }

    /// <summary>
    /// RSA private key (PEM inline, or a path to a PEM file) that signs the
    /// SpacetimeDB JWT. Optional in dev — when unset a fresh in-memory key is
    /// generated per process (fine, because the identity derivation is
    /// key-independent). Prod must set a stable key so multiple instances /
    /// restarts publish a consistent JWKS.
    /// </summary>
    public string? SpacetimeOidcPrivateKey { get; init; }

    /// <summary>
    /// Where core-api keeps a signing key it generated itself when
    /// <see cref="SpacetimeOidcPrivateKey"/> is unset. Compose points this at a
    /// persistent volume, so the key survives restarts and upgrades without an
    /// operator ever handling it.
    /// </summary>
    public string? SpacetimeOidcKeyFile { get; init; }

    public static ServiceOptions FromConfiguration(IConfiguration config)
    {
        string Get(string key, string fallback) =>
            config[key] is { Length: > 0 } value ? value : fallback;

        string? GetOptional(string key) =>
            config[key] is { Length: > 0 } value ? value.Trim() : null;

        // A set but unrecognised value refuses to start. It used to read as
        // false (or the default), so REQUIRE_EMAIL_CONFIRMATION=on silently
        // turned confirmation off (BUG_ANALYSIS F1).
        bool GetBool(string key, bool fallback) =>
            config[key] is not { Length: > 0 } value ? fallback
                : value.Trim().ToLowerInvariant() switch
                {
                    "true" or "1" or "yes" or "on" => true,
                    "false" or "0" or "no" or "off" => false,
                    _ => throw new InvalidOperationException(
                        $"{key} must be true or false, got '{value}'."),
                };

        int GetInt(string key, int fallback) =>
            config[key] is not { Length: > 0 } value ? fallback
                : int.TryParse(value.Trim(), out var parsed) ? parsed
                : throw new InvalidOperationException($"{key} must be a whole number, got '{value}'.");

        // New upload fields are seeded only once. An invalid initial value is
        // rejected during seeding, but .env no longer controls an existing row.
        int GetInitialUploadInt(string key, int fallback) =>
            config[key] is not { Length: > 0 } value ? fallback
                : int.TryParse(value, out var parsed) ? parsed : 0;

        long GetInitialUploadLong(string key, long fallback) =>
            config[key] is not { Length: > 0 } value ? fallback
                : long.TryParse(value, out var parsed) ? parsed : -1;

        var minioInternal = Get("MINIO_INTERNAL_ENDPOINT", "http://127.0.0.1:4390");

        return new ServiceOptions
        {
            ConnectionString = Get(
                "AUTH_DATABASE_URL",
                "Host=localhost;Port=5432;Database=auth;Username=letschat;Password=letschat"),
            // No default: unset == archive disabled (see ArchiveConnectionString).
            ArchiveConnectionString = GetOptional("ARCHIVE_DATABASE_URL"),
            Bind = Get("AUTH_BIND", "127.0.0.1:8787"),
            AdminBind = Get("ADMIN_BIND", "127.0.0.1:8788"),
            JwtSecret = Get("AUTH_JWT_SECRET", DevJwtSecret),

            MinioAccessKey = Get("MINIO_ACCESS_KEY", "minioadmin"),
            MinioSecretKey = Get("MINIO_SECRET_KEY", DevMinioSecretKey),
            MinioBucket = Get("MINIO_BUCKET", "letschat-files"),
            MinioInternalEndpoint = minioInternal,
            MinioPublicEndpoint = Get("MINIO_PUBLIC_ENDPOINT", minioInternal),
            UploadPartSizeMiB = GetInitialUploadInt("UPLOAD_PART_SIZE_MIB", 64),
            UploadMaxFileSizeMiB = GetInitialUploadInt("UPLOAD_MAX_FILE_SIZE_MIB", 500),
            DailyUploadQuotaMiB = GetInitialUploadLong("DAILY_UPLOAD_QUOTA_MIB", UploadLimits.DefaultDailyMiB),
            UserStorageLimitMiB = GetInitialUploadLong("USER_STORAGE_LIMIT_MIB", 0),
            InstanceStorageLimitMiB = GetInitialUploadLong("INSTANCE_STORAGE_LIMIT_MIB", 0),
            FfmpegPath = Get("FFMPEG_PATH", "ffmpeg"),

            LiveKitApiKey = Get("LIVEKIT_API_KEY", "devkey"),
            LiveKitApiSecret = Get("LIVEKIT_API_SECRET", DevLiveKitApiSecret),

            DiscoverySpacetimeDbUri = Get("DISCOVERY_SPACETIMEDB_URI", "ws://localhost:4300"),
            DiscoveryAuthUrl = Get("DISCOVERY_AUTH_URL", "http://localhost:8787"),
            DiscoveryLiveKitUrl = Get("DISCOVERY_LIVEKIT_URL", "ws://localhost:7880"),
            DiscoveryWebUrl = GetOptional("DISCOVERY_WEB_URL")?.TrimEnd('/'),
            LiveKitInternalUrl = Get("LIVEKIT_INTERNAL_URL", "http://127.0.0.1:7880"),
            DiscoveryDatabase = Get("DISCOVERY_DATABASE", "letschat"),

            BootstrapAdminUsername = GetOptional("ADMIN_BOOTSTRAP_USERNAME"),
            BootstrapAdminPassword = GetOptional("ADMIN_BOOTSTRAP_PASSWORD"),
            BootstrapAdminEmail = Get("ADMIN_BOOTSTRAP_EMAIL", "admin@letschat.local"),

            RequireEmailConfirmation = GetBool("REQUIRE_EMAIL_CONFIRMATION", true),
            RequireAdminApproval = GetBool("REQUIRE_ADMIN_APPROVAL", false),
            EmailSenderKind = Get("EMAIL_SENDER", "log").Trim().ToLowerInvariant(),
            SmtpHost = Get("SMTP_HOST", "localhost"),
            SmtpPort = GetInt("SMTP_PORT", 1025),
            SmtpUser = GetOptional("SMTP_USER"),
            SmtpPassword = GetOptional("SMTP_PASSWORD"),
            SmtpUseStartTls = GetBool("SMTP_USE_STARTTLS", false),
            EmailFromAddress = Get("EMAIL_FROM_ADDRESS", "no-reply@letschat.local"),
            EmailFromName = Get("EMAIL_FROM_NAME", "LetsChat"),

            RateLimitPermitLimit = GetInt("RATE_LIMIT_PERMIT", 10),
            RateLimitWindowSeconds = GetInt("RATE_LIMIT_WINDOW_SECONDS", 300),

            SpacetimeHttpUrl = Get("SPACETIMEDB_HTTP_URL", "http://localhost:4300"),
            SpacetimeModuleName = Get("SPACETIMEDB_MODULE_NAME", "letschat"),
            SpacetimeServiceToken = GetOptional("SPACETIMEDB_SERVICE_TOKEN"),
            SpacetimeServiceTokenFile = GetOptional("SPACETIMEDB_SERVICE_TOKEN_FILE"),
            ArchiveWorkerTokenFile = GetOptional("ARCHIVE_WORKER_TOKEN_FILE"),

            SpacetimeOidcIssuer = Get("SPACETIME_OIDC_ISSUER", DevSpacetimeOidcIssuer),
            SpacetimeOidcPrivateKey = GetOptional("SPACETIME_OIDC_PRIVATE_KEY"),
            SpacetimeOidcKeyFile = GetOptional("SPACETIME_OIDC_KEY_FILE"),
        };
    }

    /// <summary>
    /// Returns the names of secrets still set to their public dev default. A
    /// default secret is exploitable — anyone can forge session / LiveKit tokens
    /// or reach object storage with the checked-in key — so callers should refuse
    /// to start outside Development when this is non-empty. The danger is that the
    /// system otherwise keeps working, masking the misconfiguration.
    /// </summary>
    public IReadOnlyList<string> FindInsecureDefaults()
    {
        var issues = new List<string>();

        void Check(string envVar, string value, string devDefault)
        {
            if (string.Equals(value, devDefault, StringComparison.Ordinal))
            {
                issues.Add(envVar);
            }
        }

        Check("AUTH_JWT_SECRET", JwtSecret, DevJwtSecret);
        Check("LIVEKIT_API_SECRET", LiveKitApiSecret, DevLiveKitApiSecret);
        Check("MINIO_SECRET_KEY", MinioSecretKey, DevMinioSecretKey);

        void CheckPlaceholder(string envVar, string? value)
        {
            if (value?.StartsWith(TemplatePlaceholderPrefix, StringComparison.OrdinalIgnoreCase) == true)
            {
                issues.Add(envVar);
            }
        }

        CheckPlaceholder("AUTH_JWT_SECRET", JwtSecret);
        CheckPlaceholder("LIVEKIT_API_SECRET", LiveKitApiSecret);
        CheckPlaceholder("MINIO_ACCESS_KEY", MinioAccessKey);
        CheckPlaceholder("MINIO_SECRET_KEY", MinioSecretKey);
        CheckPlaceholder("ADMIN_BOOTSTRAP_PASSWORD", BootstrapAdminPassword);
        CheckPlaceholder("SPACETIME_OIDC_PRIVATE_KEY", SpacetimeOidcPrivateKey);
        // Compose builds both connection strings from POSTGRES_PASSWORD.
        if (ConnectionString.Contains($"Password={TemplatePlaceholderPrefix}", StringComparison.OrdinalIgnoreCase))
        {
            issues.Add("POSTGRES_PASSWORD");
        }

        // The issuer is permanent and identity-defining — a prod deployment left
        // on the dev default would derive host.docker.internal identities and, if
        // ever corrected, silently orphan every account. Force an explicit value.
        Check("SPACETIME_OIDC_ISSUER", SpacetimeOidcIssuer, DevSpacetimeOidcIssuer);
        // Without a stable signing key, JWKS differs per instance/restart and
        // tokens fail to verify. Require one in prod — either configured, or a
        // file core-api persists its own generated key to.
        if (string.IsNullOrWhiteSpace(SpacetimeOidcPrivateKey) && SpacetimeOidcKeyFile is null)
        {
            issues.Add("SPACETIME_OIDC_PRIVATE_KEY");
        }

        return issues;
    }

    /// <summary>
    /// Returns problems with the endpoints handed to CLIENTS — the presigned-URL
    /// host and the addresses in `/.well-known/letschat.json`. Every one of
    /// them defaults to something only this machine can reach, so leaving one
    /// unset in production is silent: the service starts, logs nothing, and every
    /// client fails on an address it cannot resolve. Uploads and avatars die with
    /// a bare "network error", and the app cannot connect at all.
    ///
    /// Two rules, both chosen to have no false positives:
    ///
    /// - `MINIO_PUBLIC_ENDPOINT` equal to `MINIO_INTERNAL_ENDPOINT` is exactly the
    ///   unset case — the fallback is the internal value — and a Docker service
    ///   name resolves nowhere outside the compose network.
    /// - A loopback host on any of them is wrong by definition for an address a
    ///   remote client is told to use. It also breaks a packaged macOS build even
    ///   locally: App Transport Security exempts the `localhost` hostname but not
    ///   the bare `127.0.0.1` address.
    ///
    /// Not checked: a plain-http public endpoint. It fails on macOS desktop for
    /// the same ATS reason, but a browser-only or LAN deployment can legitimately
    /// run without TLS, and refusing to boot would break those on upgrade.
    /// </summary>
    public IReadOnlyList<string> FindClientUnreachableEndpoints()
    {
        var issues = new List<string>();

        if (string.Equals(MinioPublicEndpoint, MinioInternalEndpoint, StringComparison.OrdinalIgnoreCase))
        {
            issues.Add(
                $"MINIO_PUBLIC_ENDPOINT is unset, so it fell back to MINIO_INTERNAL_ENDPOINT " +
                $"('{MinioInternalEndpoint}') — an address only this host can reach. Every presigned " +
                "upload and download URL would point there. Set it to the public files host, " +
                "e.g. https://files.<domain>.");
        }

        CheckNotLoopback("MINIO_PUBLIC_ENDPOINT", MinioPublicEndpoint);
        CheckNotLoopback("DISCOVERY_AUTH_URL", DiscoveryAuthUrl);
        CheckNotLoopback("DISCOVERY_SPACETIMEDB_URI", DiscoverySpacetimeDbUri);
        CheckNotLoopback("DISCOVERY_LIVEKIT_URL", DiscoveryLiveKitUrl);
        if (DiscoveryWebUrl is not null)
        {
            CheckNotLoopback("DISCOVERY_WEB_URL", DiscoveryWebUrl);
        }

        return issues;

        void CheckNotLoopback(string envVar, string value)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri))
            {
                issues.Add($"{envVar} ('{value}') is not an absolute URL.");
                return;
            }

            var isLoopback =
                string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase)
                || (IPAddress.TryParse(uri.Host, out var address) && IPAddress.IsLoopback(address));

            if (isLoopback)
            {
                issues.Add(
                    $"{envVar} ('{value}') points at this machine. Clients are handed this address " +
                    "verbatim, so set it to the public host for this service.");
            }
        }
    }
}

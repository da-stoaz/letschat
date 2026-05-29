namespace CoreApi.Configuration;

/// <summary>
/// Strongly-typed service configuration. Values are read from environment
/// variables (matching the names the legacy Rust auth-service used, so the
/// existing docker-compose / .env files carry over) with sensible dev defaults.
/// </summary>
public sealed class ServiceOptions
{
    public required string ConnectionString { get; init; }
    public required string Bind { get; init; }

    /// <summary>
    /// Listener for the admin control panel (<c>/admin/*</c>). A separate port
    /// that the public reverse proxy does not expose — defence in depth so the
    /// panel is not reachable from the open internet.
    /// </summary>
    public required string AdminBind { get; init; }
    public required string JwtSecret { get; init; }
    public string? AdminApiKey { get; init; }

    public required string MinioAccessKey { get; init; }
    public required string MinioSecretKey { get; init; }
    public required string MinioBucket { get; init; }
    public required string MinioInternalEndpoint { get; init; }
    public required string MinioPublicEndpoint { get; init; }

    public required string LiveKitApiKey { get; init; }
    public required string LiveKitApiSecret { get; init; }

    public required string DiscoverySpacetimeDbUri { get; init; }
    public required string DiscoveryAuthUrl { get; init; }
    public required string DiscoveryLiveKitUrl { get; init; }
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
    /// Bearer token for the SpacetimeDB Identity that core-api signs reducer
    /// calls with. Optional — when unset, instance-admin features that require
    /// SpacetimeDB writes (space create policy, future admin pushes) are
    /// disabled in the panel with a clear hint. To bootstrap: publish the
    /// module, generate a token (<c>spacetime token gen</c>), promote that
    /// token's identity to admin (<c>spacetime call letschat set_user_admin
    /// &lt;identity&gt; true</c>) using the publisher identity, then set this var.
    /// </summary>
    public string? SpacetimeServiceToken { get; init; }

    public static ServiceOptions FromConfiguration(IConfiguration config)
    {
        string Get(string key, string fallback) =>
            config[key] is { Length: > 0 } value ? value : fallback;

        string? GetOptional(string key) =>
            config[key] is { Length: > 0 } value ? value.Trim() : null;

        bool GetBool(string key, bool fallback) =>
            config[key] is { Length: > 0 } value
                ? value.Trim().ToLowerInvariant() is "true" or "1" or "yes"
                : fallback;

        int GetInt(string key, int fallback) =>
            config[key] is { Length: > 0 } value && int.TryParse(value, out var parsed)
                ? parsed
                : fallback;

        var minioInternal = Get("MINIO_INTERNAL_ENDPOINT", "http://127.0.0.1:4390");

        return new ServiceOptions
        {
            ConnectionString = Get(
                "AUTH_DATABASE_URL",
                "Host=localhost;Port=5432;Database=auth;Username=letschat;Password=letschat"),
            Bind = Get("AUTH_BIND", "127.0.0.1:8787"),
            AdminBind = Get("ADMIN_BIND", "127.0.0.1:8788"),
            JwtSecret = Get(
                "AUTH_JWT_SECRET",
                "w7Qk9R2mN5xH3cV8pL4tJ6dF1sA0zB7uY2gE5nK8qM3rT9hC"),
            AdminApiKey = GetOptional("AUTH_ADMIN_API_KEY"),

            MinioAccessKey = Get("MINIO_ACCESS_KEY", "minioadmin"),
            MinioSecretKey = Get("MINIO_SECRET_KEY", "minioadmin"),
            MinioBucket = Get("MINIO_BUCKET", "letschat-files"),
            MinioInternalEndpoint = minioInternal,
            MinioPublicEndpoint = Get("MINIO_PUBLIC_ENDPOINT", minioInternal),

            LiveKitApiKey = Get("LIVEKIT_API_KEY", "devkey"),
            LiveKitApiSecret = Get(
                "LIVEKIT_API_SECRET",
                "devsecret0123456789devsecret0123456789"),

            DiscoverySpacetimeDbUri = Get("DISCOVERY_SPACETIMEDB_URI", "ws://localhost:4300"),
            DiscoveryAuthUrl = Get("DISCOVERY_AUTH_URL", "http://localhost:8787"),
            DiscoveryLiveKitUrl = Get("DISCOVERY_LIVEKIT_URL", "ws://localhost:7880"),
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
        };
    }
}

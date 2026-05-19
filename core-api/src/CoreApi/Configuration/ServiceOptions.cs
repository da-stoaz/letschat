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

    public static ServiceOptions FromConfiguration(IConfiguration config)
    {
        string Get(string key, string fallback) =>
            config[key] is { Length: > 0 } value ? value : fallback;

        string? GetOptional(string key) =>
            config[key] is { Length: > 0 } value ? value.Trim() : null;

        var minioInternal = Get("MINIO_INTERNAL_ENDPOINT", "http://127.0.0.1:4390");

        return new ServiceOptions
        {
            ConnectionString = Get(
                "AUTH_DATABASE_URL",
                "Host=localhost;Port=5432;Database=auth;Username=letschat;Password=letschat"),
            Bind = Get("AUTH_BIND", "127.0.0.1:8787"),
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
        };
    }
}

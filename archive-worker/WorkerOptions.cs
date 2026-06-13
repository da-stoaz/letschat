namespace ArchiveWorker;

/// <summary>
/// Strongly-typed worker configuration, read from environment variables with
/// dev-friendly defaults (mirrors how core-api's <c>ServiceOptions</c> works).
/// </summary>
public sealed class WorkerOptions
{
    /// <summary>WebSocket URI of the SpacetimeDB host.</summary>
    public required string SpacetimeUri { get; init; }

    /// <summary>Module / database name to connect to.</summary>
    public required string SpacetimeModule { get; init; }

    /// <summary>
    /// Explicit bearer token for the worker's dedicated service identity. When
    /// empty, the worker connects without one: SpacetimeDB issues a fresh
    /// identity + token on first connect, which the worker persists to
    /// <see cref="TokenFile"/> and reuses on subsequent runs so its identity is
    /// stable across restarts.
    /// </summary>
    public string? Token { get; init; }

    /// <summary>Where the auto-issued token is cached (used only when <see cref="Token"/> is empty).</summary>
    public required string TokenFile { get; init; }

    /// <summary>Npgsql connection string for the <c>archive</c> database.</summary>
    public required string ArchiveConnectionString { get; init; }

    /// <summary>How often to pump the SpacetimeDB client message queue.</summary>
    public int TickIntervalMs { get; init; }

    /// <summary>Backoff between reconnect attempts after a disconnect.</summary>
    public int ReconnectDelayMs { get; init; }

    public static WorkerOptions FromConfiguration(IConfiguration config)
    {
        string Get(string key, string fallback) =>
            config[key] is { Length: > 0 } v ? v : fallback;

        string? GetOptional(string key) =>
            config[key] is { Length: > 0 } v ? v.Trim() : null;

        int GetInt(string key, int fallback) =>
            config[key] is { Length: > 0 } v && int.TryParse(v, out var n) ? n : fallback;

        return new WorkerOptions
        {
            SpacetimeUri = Get("SPACETIMEDB_URI", "ws://localhost:4300"),
            SpacetimeModule = Get("SPACETIMEDB_MODULE_NAME", "letschat"),
            Token = GetOptional("ARCHIVE_WORKER_TOKEN"),
            TokenFile = Get("ARCHIVE_WORKER_TOKEN_FILE", "archive-worker.token"),
            ArchiveConnectionString = Get(
                "ARCHIVE_DATABASE_URL",
                "Host=localhost;Port=5433;Database=archive;Username=letschat;Password=letschat"),
            TickIntervalMs = GetInt("ARCHIVE_TICK_INTERVAL_MS", 50),
            ReconnectDelayMs = GetInt("ARCHIVE_RECONNECT_DELAY_MS", 3000),
        };
    }
}

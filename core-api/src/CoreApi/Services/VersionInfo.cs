using System.Reflection;

namespace CoreApi.Services;

/// <summary>
/// Single source of truth for the running backend's version and the desktop-app
/// versions it considers compatible. <see cref="ServerVersion"/> comes from the
/// build (the <c>&lt;Version&gt;</c> property in the csproj, overridden by CI from
/// the git tag); the client-compat range is operator-overridable so an operator
/// who pins a different desktop-app version can do so without rebuilding.
/// </summary>
public sealed class VersionInfo
{
    public string ServerVersion { get; }

    /// <summary>The app version the landing page will offer for download.</summary>
    public string RecommendedClientVersion { get; }

    /// <summary>Oldest desktop app this backend still accepts at connect time.</summary>
    public string MinClientVersion { get; }

    public bool IsDevBuild => ServerVersion.StartsWith("0.0.0", StringComparison.Ordinal);

    public VersionInfo(IConfiguration config)
    {
        var raw = Assembly.GetEntryAssembly()
            ?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion
            ?? "0.0.0-dev";

        // SourceLink appends "+{commitSha}" to InformationalVersion; strip it for
        // a clean SemVer that survives "v{x}" tag matching against GH releases.
        var plus = raw.IndexOf('+');
        ServerVersion = plus > 0 ? raw[..plus] : raw;

        RecommendedClientVersion =
            (config["RECOMMENDED_CLIENT_VERSION"]?.Trim() is { Length: > 0 } rec)
                ? rec : ServerVersion;
        MinClientVersion =
            (config["MIN_CLIENT_VERSION"]?.Trim() is { Length: > 0 } min)
                ? min : ServerVersion;
    }
}

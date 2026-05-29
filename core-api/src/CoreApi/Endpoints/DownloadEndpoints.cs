using System.Text.Json.Serialization;
using CoreApi.Services;
using Microsoft.Extensions.Caching.Memory;

namespace CoreApi.Endpoints;

/// <summary>
/// <c>/downloads/{os}</c> — visitor-friendly installer resolver. Hides the
/// distribution mechanism behind a single URL the landing page can link to.
/// </summary>
/// <remarks>
/// Resolution order:
/// 1. <c>wwwroot/downloads/</c> — operator-hosted installers on this instance.
///    Drop files named <c>macos-arm64.dmg</c>, <c>macos-universal.dmg</c>,
///    <c>windows-x64.msi</c>, <c>windows-x64.exe</c>, <c>linux-x64.AppImage</c>,
///    or <c>linux-x64.deb</c>. The endpoint streams the matching file with a
///    versioned <c>Content-Disposition</c> filename.
/// 2. GitHub Releases for tag <c>v{recommendedClient}</c> — fallback when the
///    operator hasn't dropped a local copy. 302-redirects to the asset.
/// 3. Friendly 404 — neither source has an installer for the requested OS.
///
/// Bandwidth note: option 1 hits the operator's own bandwidth; option 2 uses
/// GitHub's CDN. For high-traffic instances prefer (1) or proxy via MinIO.
/// </remarks>
public static class DownloadEndpoints
{
    private const string GitHubRepo = "da-stoaz/letschat";
    private const string CachePrefix = "downloads:";
    private const string LocalDownloadsFolder = "downloads";
    private static readonly TimeSpan GitHubCacheTtl = TimeSpan.FromHours(1);

    public static void MapDownloadEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/downloads/{os}", Resolve);
    }

    private static async Task<IResult> Resolve(
        string os,
        VersionInfo version,
        IWebHostEnvironment env,
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var normalized = os.Trim().ToLowerInvariant();
        if (!AssetMatcher.IsKnown(normalized))
        {
            return Results.NotFound(new { error = $"Unknown platform '{os}'. Use macos, windows, or linux." });
        }

        // 1. Local file on this instance — preferred.
        var localFile = ResolveLocalInstaller(env, normalized);
        if (localFile is not null)
        {
            var downloadName = BuildDownloadFilename(normalized, version.RecommendedClientVersion, localFile);
            return Results.File(
                localFile,
                contentType: ContentTypeFor(localFile),
                fileDownloadName: downloadName,
                enableRangeProcessing: true);
        }

        // 2. GitHub Releases fallback.
        if (version.IsDevBuild)
        {
            return Results.NotFound(new
            {
                error = $"No {normalized} installer is hosted on this instance, and the operator hasn't tagged a release yet.",
            });
        }

        var cacheKey = $"{CachePrefix}{version.RecommendedClientVersion}:{normalized}";
        if (cache.TryGetValue(cacheKey, out string? cachedUrl) && cachedUrl is not null)
        {
            return Results.Redirect(cachedUrl, permanent: false);
        }

        var logger = loggerFactory.CreateLogger("Downloads");
        var http = httpClientFactory.CreateClient("github");
        var tag = $"v{version.RecommendedClientVersion}";

        GitHubRelease? release;
        try
        {
            release = await http.GetFromJsonAsync<GitHubRelease>(
                $"https://api.github.com/repos/{GitHubRepo}/releases/tags/{tag}",
                cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            logger.LogWarning(ex, "GitHub releases lookup failed for {Tag}", tag);
            return Results.NotFound(new
            {
                error = $"Could not reach GitHub to resolve installer for {tag}.",
            });
        }

        var asset = release is null ? null : AssetMatcher.PickGitHubAsset(normalized, release.Assets);
        if (asset is null)
        {
            return Results.NotFound(new
            {
                error = $"No {normalized} installer found for {tag}.",
            });
        }

        cache.Set(cacheKey, asset.BrowserDownloadUrl, GitHubCacheTtl);
        return Results.Redirect(asset.BrowserDownloadUrl, permanent: false);
    }

    private static string? ResolveLocalInstaller(IWebHostEnvironment env, string os)
    {
        var dir = Path.Combine(env.WebRootPath, LocalDownloadsFolder);
        if (!Directory.Exists(dir)) return null;

        // Preference list mirrors PickGitHubAsset — universal/x64 first, fallback last.
        var preferences = os switch
        {
            "macos" => new[] { "macos-universal.dmg", "macos-arm64.dmg", "macos-x64.dmg", "macos.dmg" },
            "windows" => new[] { "windows-x64.msi", "windows-x64.exe", "windows.msi", "windows.exe" },
            "linux" => new[] { "linux-x64.AppImage", "linux.AppImage", "linux-x64.deb", "linux.deb" },
            _ => [],
        };

        foreach (var name in preferences)
        {
            var candidate = Path.Combine(dir, name);
            if (File.Exists(candidate)) return candidate;
        }

        return null;
    }

    private static string BuildDownloadFilename(string os, string version, string sourcePath)
    {
        var extension = Path.GetExtension(sourcePath);
        return $"LetsChat-{version}-{os}{extension}";
    }

    private static string ContentTypeFor(string path) =>
        Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".dmg" => "application/x-apple-diskimage",
            ".msi" => "application/x-msi",
            ".exe" => "application/vnd.microsoft.portable-executable",
            ".appimage" => "application/vnd.appimage",
            ".deb" => "application/vnd.debian.binary-package",
            _ => "application/octet-stream",
        };

    private static class AssetMatcher
    {
        public static bool IsKnown(string os) => os is "macos" or "windows" or "linux";

        public static GitHubAsset? PickGitHubAsset(string os, IReadOnlyList<GitHubAsset> assets)
        {
            var preferences = os switch
            {
                "macos" => new[] { "_universal.dmg", "_aarch64.dmg", "_x64.dmg", ".dmg" },
                "windows" => new[] { "_x64-setup.exe", "_x64_en-US.msi", ".msi", ".exe" },
                "linux" => new[] { "_amd64.AppImage", ".AppImage", "_amd64.deb", ".deb" },
                _ => [],
            };

            foreach (var suffix in preferences)
            {
                var match = assets.FirstOrDefault(a =>
                    a.Name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));
                if (match is not null) return match;
            }

            return null;
        }
    }

    private sealed record GitHubRelease(
        [property: JsonPropertyName("tag_name")] string TagName,
        [property: JsonPropertyName("assets")] List<GitHubAsset> Assets);

    private sealed record GitHubAsset(
        [property: JsonPropertyName("name")] string Name,
        [property: JsonPropertyName("browser_download_url")] string BrowserDownloadUrl);
}

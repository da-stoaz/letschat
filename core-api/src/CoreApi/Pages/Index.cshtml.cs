using CoreApi.Configuration;
using CoreApi.Services;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CoreApi.Pages;

/// <summary>
/// Public landing page at <c>/</c>. Built so a shared link works in any
/// browser/messenger: detects the visitor's platform, points them at the
/// desktop downloads (resolved through <c>/downloads/{os}</c> so visitors
/// never see GitHub's UI), and offers an "Open in app" button that triggers
/// the <c>letschat://join?…</c> deep link with the instance's discovery config.
/// </summary>
public sealed class IndexModel(
    ServiceOptions options,
    VersionInfo version,
    IWebHostEnvironment env) : PageModel
{
    public string DeepLink { get; private set; } = string.Empty;

    public string RecommendedClientVersion => version.RecommendedClientVersion;

    /// <summary>
    /// True if /downloads/{os} can serve anything — either the operator dropped
    /// an installer into wwwroot/downloads/, or there's a tagged GH release to
    /// fall back on. False only on a dev build with no local installers, where
    /// the download CTA would just lead to an error page.
    /// </summary>
    public bool HasAnyInstaller
    {
        get
        {
            if (!version.IsDevBuild) return true;
            var dir = Path.Combine(env.WebRootPath, "downloads");
            if (!Directory.Exists(dir)) return false;
            return Directory.EnumerateFiles(dir, "*.*")
                .Any(f =>
                {
                    var ext = Path.GetExtension(f).ToLowerInvariant();
                    return ext is ".dmg" or ".msi" or ".exe" or ".appimage" or ".deb";
                });
        }
    }

    public void OnGet()
    {
        // Mirrors `buildJoinLink` in src/stores/serverConfigStore.ts — short
        // param keys (s/a/l/d) so the resulting URL stays compact.
        var query = string.Join('&',
        [
            "s=" + Uri.EscapeDataString(options.DiscoverySpacetimeDbUri),
            "a=" + Uri.EscapeDataString(options.DiscoveryAuthUrl),
            "l=" + Uri.EscapeDataString(options.DiscoveryLiveKitUrl),
            "d=" + Uri.EscapeDataString(options.DiscoveryDatabase),
        ]);
        DeepLink = $"letschat://join?{query}";
    }
}

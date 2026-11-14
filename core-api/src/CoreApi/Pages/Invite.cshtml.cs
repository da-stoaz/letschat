using System.Text.RegularExpressions;
using CoreApi.Configuration;
using CoreApi.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CoreApi.Pages;

/// <summary>
/// Shared space invite link, <c>/invite/{token}</c>. Link unfurlers (Discord,
/// Slack, messengers) run no JavaScript, so the preview card's OG tags are
/// rendered here. The card shows the space name only, and only for a live
/// invite open to anyone (see the module's <c>invite_preview</c>); everything
/// else gets the same generic card. People then continue in the desktop app
/// (<c>letschat://join?…&amp;i=token</c>) or the hosted web client.
/// </summary>
public sealed partial class InviteModel(
    ServiceOptions options,
    VersionInfo version,
    IWebHostEnvironment env,
    SpacetimeClient spacetime) : PageModel
{
    public string? SpaceName { get; private set; }
    public string DeepLink { get; private set; } = string.Empty;
    public string? WebLink { get; private set; }
    public string ImageUrl => $"{options.DiscoveryAuthUrl.TrimEnd('/')}/img/letschat-logo.png";
    public bool HasAnyInstaller => IndexModel.AnyInstaller(version, env);

    // Module tokens are 16 alphanumerics; anything else is never looked up.
    [GeneratedRegex("^[A-Za-z0-9]{1,64}$")]
    private static partial Regex TokenPattern();

    public async Task<IActionResult> OnGetAsync(string token, CancellationToken ct)
    {
        if (!TokenPattern().IsMatch(token)) return NotFound();

        // The token is in the URL: keep it out of caches, referrers and indexes.
        Response.Headers.CacheControl = "no-store";
        Response.Headers["Referrer-Policy"] = "no-referrer";
        Response.Headers["X-Robots-Tag"] = "noindex";

        SpaceName = await spacetime.GetInvitePreviewAsync(token, ct);
        DeepLink = $"{IndexModel.JoinLink(options)}&i={token}";
        if (options.DiscoveryWebUrl is { } web) WebLink = $"{web}/invite/{token}";
        return Page();
    }
}

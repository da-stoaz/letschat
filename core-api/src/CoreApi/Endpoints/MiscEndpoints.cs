using CoreApi.Configuration;
using CoreApi.Models;
using CoreApi.Services;

namespace CoreApi.Endpoints;

/// <summary>
/// Health, OIDC discovery, and the LetsChat service-discovery document.
/// </summary>
public static class MiscEndpoints
{
    public static void MapMiscEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/health", () => Results.Json(new { status = "ok" }));

        // OIDC discovery — the SpacetimeDB server fetches these to learn the
        // signing key and verify the JWTs core-api mints. Must be reachable
        // server-to-server from SpacetimeDB (see SpacetimeTokenService.Issuer).
        routes.MapGet("/.well-known/openid-configuration",
            (SpacetimeTokenService spacetime) => Results.Json(spacetime.OpenIdConfiguration()));
        routes.MapGet("/.well-known/jwks.json",
            (SpacetimeTokenService spacetime) => Results.Json(spacetime.Jwks()));

        routes.MapGet("/.well-known/letschat.json", (ServiceOptions options, VersionInfo version) =>
            new WellKnownResponse(
                options.DiscoverySpacetimeDbUri,
                options.DiscoveryAuthUrl,
                options.DiscoveryLiveKitUrl,
                options.DiscoveryDatabase,
                version.ServerVersion,
                version.RecommendedClientVersion,
                version.MinClientVersion));
    }
}

using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Endpoints;

/// <summary>
/// Discovery, health, and the admin account-rebind endpoint.
/// </summary>
public static class MiscEndpoints
{
    public static void MapMiscEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapGet("/health", () => Results.Json(new { status = "ok" }));

        routes.MapGet("/.well-known/letschat.json", (ServiceOptions options) =>
            new WellKnownResponse(
                options.DiscoverySpacetimeDbUri,
                options.DiscoveryAuthUrl,
                options.DiscoveryLiveKitUrl,
                options.DiscoveryDatabase));

        routes.MapPost("/admin/accounts/rebind", AdminRebind);
    }

    /// <summary>
    /// Re-points an account at a different SpacetimeDB identity. Guarded by the
    /// shared <c>AUTH_ADMIN_API_KEY</c>; ports <c>handlers/admin.rs</c>.
    /// </summary>
    private static async Task<AdminRebindAccountResponse> AdminRebind(
        AdminRebindAccountRequest request,
        ServiceOptions options,
        UserManager<ApplicationUser> users)
    {
        var configuredKey = options.AdminApiKey
            ?? throw ApiException.Unauthorized("Admin rebind endpoint is disabled.");

        if (!string.Equals(request.AdminApiKey?.Trim(), configuredKey, StringComparison.Ordinal))
        {
            throw ApiException.Unauthorized("Invalid admin API key.");
        }

        var username = Validation.NormalizeUsername(request.Username);
        Validation.ValidateUsername(username);
        var spacetimeIdentity = Validation.Required(
            request.SpacetimeIdentity, "Spacetime identity is required.");
        var identityNorm = Validation.NormalizeIdentity(spacetimeIdentity);

        var user = await users.FindByNameAsync(username)
            ?? throw ApiException.BadRequest("Account username was not found.");

        var conflicting = await users.Users.AnyAsync(u =>
            u.SpacetimeIdentityNorm == identityNorm && u.Id != user.Id);
        if (conflicting)
        {
            throw ApiException.Conflict(
                "Target identity is already linked to another account.");
        }

        var displayName = request.DisplayName?.Trim();
        if (!string.IsNullOrEmpty(displayName))
        {
            user.DisplayName = displayName;
        }

        var spacetimeToken = request.SpacetimeToken?.Trim();
        if (!string.IsNullOrEmpty(spacetimeToken))
        {
            user.SpacetimeToken = spacetimeToken;
        }

        user.SpacetimeIdentity = spacetimeIdentity;
        user.SpacetimeIdentityNorm = identityNorm;
        user.UpdatedAtUtc = DateTime.UtcNow;

        var update = await users.UpdateAsync(user);
        if (!update.Succeeded)
        {
            throw ApiException.Conflict(
                "Target identity is already linked to another account.");
        }

        return new AdminRebindAccountResponse(username, spacetimeIdentity);
    }
}

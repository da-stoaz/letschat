using CoreApi.Data;
using CoreApi.Models;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;

namespace CoreApi.Endpoints;

/// <summary>
/// <c>/livekit/token</c> — issues a LiveKit access token, gated on a valid
/// session whose account is bound to the requested voice identity. Ports
/// <c>handlers/livekit.rs</c>.
/// </summary>
public static class LiveKitEndpoints
{
    public static void MapLiveKitEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/livekit/token", IssueToken);
    }

    private static async Task<LivekitTokenResponse> IssueToken(
        LivekitTokenRequest request,
        UserManager<ApplicationUser> users,
        TokenService tokens,
        LiveKitTokenService livekit)
    {
        var room = Validation.Required(request.Room, "Room is required.");
        var identity = Validation.Required(request.Identity, "Identity is required.");

        var username = await tokens.ValidateAsync(request.SessionToken)
            ?? throw ApiException.Unauthorized("Invalid auth session.");

        var user = await users.FindByNameAsync(username)
            ?? throw ApiException.Unauthorized("Account not found for session token.");

        if (!string.Equals(
                Validation.NormalizeIdentity(user.SpacetimeIdentity),
                Validation.NormalizeIdentity(identity),
                StringComparison.Ordinal))
        {
            throw ApiException.Unauthorized(
                "Session user does not match requested voice identity.");
        }

        return new LivekitTokenResponse(livekit.GenerateToken(identity, room));
    }
}

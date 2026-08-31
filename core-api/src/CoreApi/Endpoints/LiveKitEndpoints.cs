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
        LiveKitTokenService livekit,
        SpacetimeClient spacetime,
        CancellationToken ct)
    {
        var room = Validation.Required(request.Room, "Room is required.");
        var identity = Validation.Required(request.Identity, "Identity is required.");

        // Resolves the account AND rejects a session revoked by a credential
        // change or a disabled account — a voice token is full room access, so
        // it must not outlive the session that asked for it.
        var user = await tokens.RequireAccountAsync(
            request.SessionToken, users, "Invalid auth session.");

        if (!string.Equals(
                Validation.NormalizeIdentity(user.SpacetimeIdentity),
                Validation.NormalizeIdentity(identity),
                StringComparison.Ordinal))
        {
            throw ApiException.Unauthorized(
                "Session user does not match requested voice identity.");
        }

        if (!VoiceRoom.TryParse(room, out var voiceRoom))
        {
            throw ApiException.BadRequest("Unrecognised voice room.");
        }

        // Authorize the room against the membership SpacetimeDB already enforces.
        // Authenticating as the session is not enough — without this anyone could
        // mint a publish/subscribe token for any room (any channel, any DM) just
        // by naming it.
        var presence = await spacetime.HasVoicePresenceAsync(
            user.Id, user.SpacetimeIdentity, voiceRoom, ct);

        // Still fails closed — no token is minted unless the module actually
        // admitted the caller — but an unreachable module is reported as the
        // outage it is, not as a permission the caller doesn't have. 503 is also
        // honest to the client: this one is worth retrying, a 403 never is.
        if (presence == VoicePresence.Unavailable)
        {
            throw ApiException.ServiceUnavailable(
                "Voice is temporarily unavailable: could not reach the chat database to "
                + "confirm you joined this room. Please try again in a moment.");
        }

        if (presence != VoicePresence.Admitted)
        {
            throw ApiException.Forbidden("You are not a participant in this voice room.");
        }

        return new LivekitTokenResponse(livekit.GenerateToken(identity, room));
    }
}

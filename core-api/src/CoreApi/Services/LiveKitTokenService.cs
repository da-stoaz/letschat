using System.Text;
using CoreApi.Configuration;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace CoreApi.Services;

/// <summary>
/// Mints LiveKit access tokens — an HS256 JWT signed with the LiveKit API
/// secret, carrying a <c>video</c> grant. Reproduces the legacy
/// <c>handlers/livekit.rs</c> claim shape exactly (iss = API key, sub =
/// identity, 1 h lifetime, room-join grant).
/// </summary>
public sealed class LiveKitTokenService(ServiceOptions options)
{
    private readonly JsonWebTokenHandler _handler = new();

    public string GenerateToken(string identity, string room)
    {
        var now = DateTime.UtcNow;
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.LiveKitApiSecret));

        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = options.LiveKitApiKey,
            IssuedAt = now,
            NotBefore = now,
            Expires = now.AddHours(1),
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
            Claims = new Dictionary<string, object>
            {
                ["sub"] = identity,
                ["video"] = new Dictionary<string, object>
                {
                    ["roomJoin"] = true,
                    ["room"] = room,
                    ["canPublish"] = true,
                    ["canSubscribe"] = true,
                },
            },
        };

        return _handler.CreateToken(descriptor);
    }

    /// <summary>
    /// A one-minute server token for LiveKit's room API. Listing rooms needs
    /// <c>roomList</c>; listing or removing a room's participants needs
    /// <c>roomAdmin</c> scoped to that <paramref name="room"/>.
    /// </summary>
    public string ServerToken(string? room = null)
    {
        var now = DateTime.UtcNow;
        var video = new Dictionary<string, object> { ["roomList"] = true, ["roomAdmin"] = true };
        if (room is not null)
        {
            video["room"] = room;
        }
        return _handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = options.LiveKitApiKey,
            IssuedAt = now,
            NotBefore = now,
            Expires = now.AddMinutes(1),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.LiveKitApiSecret)), SecurityAlgorithms.HmacSha256),
            Claims = new Dictionary<string, object> { ["sub"] = "core-api", ["video"] = video },
        });
    }
}

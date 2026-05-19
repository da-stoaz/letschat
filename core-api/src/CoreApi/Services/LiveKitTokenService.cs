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
}

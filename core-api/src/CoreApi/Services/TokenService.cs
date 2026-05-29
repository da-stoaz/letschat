using System.Globalization;
using System.Text;
using CoreApi.Configuration;
using CoreApi.Models;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace CoreApi.Services;

/// <summary>
/// Issues and validates the <see cref="SessionToken"/> handed to the client.
///
/// <para>
/// The legacy service used <c>auth-framework</c>'s JWT method (HS256, 1 h
/// access lifetime, 7 d refresh lifetime). This re-implements that directly:
/// <see cref="SessionToken.access_token"/> is a self-contained HS256 JWT and
/// is the sole source of truth on validation — the rest of the struct is
/// opaque pass-through for the client.
/// </para>
/// </summary>
public sealed class TokenService
{
    private const string Issuer = "letschat-core-api";
    private static readonly TimeSpan AccessLifetime = TimeSpan.FromHours(1);
    private static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(7);

    private readonly SymmetricSecurityKey _key;
    private readonly JsonWebTokenHandler _handler = new();

    public TokenService(ServiceOptions options)
    {
        _key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.JwtSecret));
    }

    /// <summary>Mints a fresh session for the (already normalised) username.</summary>
    public SessionToken IssueSession(string username, IEnumerable<string> roles)
    {
        var now = DateTime.UtcNow;
        var accessExpires = now.Add(AccessLifetime);
        var tokenId = Guid.NewGuid().ToString();
        var credentials = new SigningCredentials(_key, SecurityAlgorithms.HmacSha256);

        var accessToken = _handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            IssuedAt = now,
            NotBefore = now,
            Expires = accessExpires,
            SigningCredentials = credentials,
            Claims = new Dictionary<string, object>
            {
                ["sub"] = username,
                ["jti"] = tokenId,
                ["token_use"] = "access",
            },
        });

        var refreshToken = _handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            IssuedAt = now,
            NotBefore = now,
            Expires = now.Add(RefreshLifetime),
            SigningCredentials = credentials,
            Claims = new Dictionary<string, object>
            {
                ["sub"] = username,
                ["jti"] = Guid.NewGuid().ToString(),
                ["token_use"] = "refresh",
            },
        });

        return new SessionToken
        {
            token_id = tokenId,
            user_id = username,
            access_token = accessToken,
            token_type = "Bearer",
            subject = username,
            issuer = Issuer,
            refresh_token = refreshToken,
            issued_at = now.ToString("o", CultureInfo.InvariantCulture),
            expires_at = accessExpires.ToString("o", CultureInfo.InvariantCulture),
            scopes = ["chat:use", "chat:voice"],
            auth_method = "jwt",
            permissions = [],
            roles = [.. roles],
            metadata = [],
        };
    }

    /// <summary>
    /// Validates a session by verifying its access-token JWT (signature,
    /// issuer, lifetime). Returns the normalised username, or <c>null</c> if
    /// the token is missing, malformed, or expired.
    /// </summary>
    public async Task<string?> ValidateAsync(SessionToken? token)
    {
        if (token is null || string.IsNullOrWhiteSpace(token.access_token))
        {
            return null;
        }

        var result = await _handler.ValidateTokenAsync(token.access_token, new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = Issuer,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = _key,
            ClockSkew = TimeSpan.FromSeconds(30),
        });

        if (!result.IsValid)
        {
            return null;
        }

        if (!result.Claims.TryGetValue("sub", out var subject) || subject is null)
        {
            return null;
        }

        var username = subject.ToString();
        return string.IsNullOrWhiteSpace(username)
            ? null
            : username.Trim().ToLowerInvariant();
    }
}

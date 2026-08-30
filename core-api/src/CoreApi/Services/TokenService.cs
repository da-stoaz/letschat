using System.Globalization;
using System.Text;
using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Models;
using Microsoft.AspNetCore.Identity;
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

    /// <summary>The <c>token_use</c> value a session's access token must carry.</summary>
    private const string AccessTokenUse = "access";
    private const string RefreshTokenUse = "refresh";
    private static readonly TimeSpan AccessLifetime = TimeSpan.FromHours(1);
    private static readonly TimeSpan RefreshLifetime = TimeSpan.FromDays(7);

    private readonly SymmetricSecurityKey _key;
    private readonly JsonWebTokenHandler _handler = new();

    public TokenService(ServiceOptions options)
    {
        _key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(options.JwtSecret));
    }

    /// <summary>The claim carrying the account's token generation. See <see cref="GenerationClaim"/>.</summary>
    public const string GenerationClaim = "gen";

    /// <summary>
    /// Mints a fresh session for the (already normalised) username.
    /// <paramref name="generation"/> is the account's current
    /// <c>TokenGeneration</c>; it is stamped into both tokens so a session
    /// minted before a credential change can be told apart from one after it.
    /// </summary>
    public SessionToken IssueSession(string username, IEnumerable<string> roles, long generation)
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
                ["token_use"] = AccessTokenUse,
                [GenerationClaim] = generation,
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
                ["token_use"] = RefreshTokenUse,
                [GenerationClaim] = generation,
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

        // Both tokens are signed with the same key and issuer, and only this
        // claim tells them apart. Without the check, a client that sends its
        // 7-day refresh token in the access_token field gets a 7-day session
        // where it should have had one hour — the longer-lived credential
        // silently doing the shorter-lived one's job.
        if (!result.Claims.TryGetValue("token_use", out var use)
            || !string.Equals(use?.ToString(), AccessTokenUse, StringComparison.Ordinal))
        {
            return null;
        }

        if (!result.Claims.TryGetValue("sub", out var subject) || subject is null)
        {
            return null;
        }

        var username = subject.ToString();
        if (string.IsNullOrWhiteSpace(username))
        {
            return null;
        }

        return username.Trim().ToLowerInvariant();
    }

    /// <summary>
    /// Reads the <c>gen</c> claim out of an already-validated session token.
    /// Absent or unparseable counts as generation 0 — the value every account
    /// starts at, so a token minted before this claim existed still validates
    /// against an account that has never had a credential change.
    /// </summary>
    public static long ReadGeneration(SessionToken? token)
    {
        if (token is null || string.IsNullOrWhiteSpace(token.access_token))
        {
            return 0;
        }

        try
        {
            var claim = new JsonWebToken(token.access_token).GetClaim(GenerationClaim);
            return long.TryParse(claim?.Value, out var generation) ? generation : 0;
        }
        catch (ArgumentException)
        {
            // Malformed token — the caller already rejected it on validation.
            return 0;
        }
    }

    /// <summary>
    /// Resolves a session token to its account, refusing what a plain signature
    /// check would still wave through: a token minted before the account's last
    /// credential change, and an account that may no longer sign in.
    ///
    /// <para>
    /// The generation check is what makes a password reset bite on the HTTP
    /// side. Without it a stolen session token keeps working until it expires —
    /// and since it can be traded for fresh ones at
    /// <c>/auth/renew-session</c>, "until it expires" effectively means
    /// "indefinitely".
    /// </para>
    ///
    /// <para>Returns <c>null</c> for any failure; callers must not distinguish
    /// between them, so an attacker learns nothing from the response.</para>
    /// </summary>
    public async Task<ApplicationUser?> ResolveAccountAsync(
        SessionToken? sessionToken, UserManager<ApplicationUser> users)
    {
        var username = await ValidateAsync(sessionToken);
        if (username is null)
        {
            return null;
        }

        var user = await users.FindByNameAsync(username);
        if (user is null)
        {
            return null;
        }

        if (ReadGeneration(sessionToken) < user.TokenGeneration)
        {
            return null;
        }

        return user.Status is AccountStatus.Active ? user : null;
    }

    /// <summary><see cref="ResolveAccountAsync"/>, throwing a 401 instead of returning null.</summary>
    public async Task<ApplicationUser> RequireAccountAsync(
        SessionToken? sessionToken, UserManager<ApplicationUser> users, string message) =>
        await ResolveAccountAsync(sessionToken, users) ?? throw ApiException.Unauthorized(message);
}

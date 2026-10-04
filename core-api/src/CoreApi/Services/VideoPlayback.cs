using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CoreApi.Configuration;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace CoreApi.Services;

public sealed record VideoRendition(int Width, int Height, int Bandwidth, string Name, string Playlist);

public static class VideoPlayback
{
    public static string Prefix(string key) =>
        "derived/hls/" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(key))) + "/";

    internal static (int Width, int Height) Fit(int width, int height, int shortEdge)
    {
        var longEdge = shortEdge * 16 / 9;
        var factor = Math.Min(1, Math.Min((double)shortEdge / Math.Min(width, height),
            (double)longEdge / Math.Max(width, height)));
        return (Math.Max(2, (int)(width * factor) / 2 * 2), Math.Max(2, (int)(height * factor) / 2 * 2));
    }

    // Only our encoder's flat, numeric TS names may be signed. Never interpret
    // uploader-supplied playlists, absolute URLs, paths, or key directives.
    internal static bool IsSegment(string value) =>
        System.Text.RegularExpressions.Regex.IsMatch(value, @"^v[01]_\d{5,}\.ts$");

    internal static async Task<string> SignPlaylistAsync(string playlist, Func<string, Task<string>> sign)
    {
        var lines = new List<string>();
        foreach (var raw in playlist.Split('\n'))
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            if (line.StartsWith('#'))
            {
                if (line.Contains("URI=", StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Unexpected HLS URI directive.");
                lines.Add(line);
            }
            else
            {
                if (!IsSegment(line)) throw new InvalidOperationException("Invalid HLS segment.");
                lines.Add(await sign(line));
            }
        }
        return string.Join('\n', lines) + "\n";
    }
}

/// <summary>A short-lived, video-scoped capability; never an account/session token.</summary>
public sealed class VideoPlaybackAccess(ServiceOptions options)
{
    private const string Purpose = "letschat.video-playback.v1";
    // A distinct key/purpose prevents playback grants from being session tokens.
    // Derived from the configured secret so grants survive restarts and replicas.
    private readonly SymmetricSecurityKey _key = new(HMACSHA256.HashData(
        Encoding.UTF8.GetBytes(options.JwtSecret), Encoding.UTF8.GetBytes(Purpose)));
    private readonly JsonWebTokenHandler _handler = new();

    public string Issue(string key) => _handler.CreateToken(new SecurityTokenDescriptor
    {
        Issuer = Purpose, Audience = Purpose, Expires = DateTime.UtcNow.AddHours(1),
        SigningCredentials = new SigningCredentials(_key, SecurityAlgorithms.HmacSha256),
        Claims = new Dictionary<string, object> { ["storage_key"] = key },
    });

    public async Task<(string Key, int RemainingSeconds)?> ReadAsync(string token)
    {
        if (token.Length > 4096) return null;
        var result = await _handler.ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidIssuer = Purpose, ValidAudience = Purpose, IssuerSigningKey = _key,
            ValidateIssuerSigningKey = true, ValidateLifetime = true, ClockSkew = TimeSpan.Zero,
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
        });
        if (!result.IsValid || !result.Claims.TryGetValue("storage_key", out var key) || key is not string value)
            return null;
        var remaining = (int)(result.SecurityToken.ValidTo - DateTime.UtcNow).TotalSeconds;
        return remaining > 0 && remaining <= 3600 ? (value, remaining) : null;
    }
}

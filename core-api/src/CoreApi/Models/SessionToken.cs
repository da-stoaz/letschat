namespace CoreApi.Models;

/// <summary>
/// The session token round-tripped with the desktop client.
///
/// <para>
/// The legacy service returned the <c>auth-framework</c> <c>AuthToken</c>
/// struct verbatim, and the client (see <c>src/lib/authService.ts</c>,
/// <c>AuthFrameworkToken</c>) stores the whole object and posts it back. The
/// shape below reproduces that struct field-for-field so the contract is
/// unchanged. The server only ever reads <see cref="access_token"/> (verified
/// as a JWT) and <see cref="user_id"/>; the rest is opaque to the client.
/// </para>
///
/// <para>Field names are deliberately snake_case to match the wire format —
/// the camelCase JSON policy leaves already-lower-cased names untouched.</para>
/// </summary>
public sealed class SessionToken
{
    public string token_id { get; set; } = string.Empty;
    public string user_id { get; set; } = string.Empty;
    public string access_token { get; set; } = string.Empty;
    public string? token_type { get; set; }
    public string? subject { get; set; }
    public string? issuer { get; set; }
    public string? refresh_token { get; set; }
    public string issued_at { get; set; } = string.Empty;
    public string expires_at { get; set; } = string.Empty;
    public List<string> scopes { get; set; } = [];
    public string auth_method { get; set; } = "jwt";
    public string? client_id { get; set; }
    public object? user_profile { get; set; }
    public List<string> permissions { get; set; } = [];
    public List<string> roles { get; set; } = [];
    public Dictionary<string, object> metadata { get; set; } = [];
}

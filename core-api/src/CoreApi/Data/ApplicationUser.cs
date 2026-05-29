using Microsoft.AspNetCore.Identity;

namespace CoreApi.Data;

/// <summary>
/// The LetsChat account, backed by ASP.NET Core Identity.
///
/// <para>
/// The columns below the Identity base type carry the chat-domain binding the
/// legacy <c>accounts</c> table held: each account maps to exactly one
/// SpacetimeDB <c>Identity</c>. <see cref="SpacetimeIdentityNorm"/> is the
/// lower-cased, trimmed identity and carries a unique index — it is the
/// invariant the plan calls out as the highest-risk item to preserve.
/// </para>
/// </summary>
public sealed class ApplicationUser : IdentityUser
{
    /// <summary>Human-facing name; distinct from the login <see cref="IdentityUser.UserName"/>.</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>The SpacetimeDB identity, stored exactly as the client supplied it.</summary>
    public string SpacetimeIdentity { get; set; } = string.Empty;

    /// <summary>Lower-cased/trimmed <see cref="SpacetimeIdentity"/>; unique-indexed.</summary>
    public string SpacetimeIdentityNorm { get; set; } = string.Empty;

    /// <summary>The current SpacetimeDB access token issued for this account.</summary>
    public string SpacetimeToken { get; set; } = string.Empty;

    public AccountStatus Status { get; set; } = AccountStatus.Registered;

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

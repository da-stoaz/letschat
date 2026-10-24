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

    public AccountStatus Status { get; set; } = AccountStatus.Registered;

    /// <summary>
    /// Monotonic token generation. Every token minted for this account carries
    /// it as a <c>gen</c> claim, and every credential change increments it, so a
    /// token issued before a password reset can be told apart from one issued
    /// after it — which is the whole mechanism behind revoking a stolen session.
    ///
    /// <para>
    /// Account-status changes advance this counter too, so delayed module
    /// synchronization cannot undo newer access state. HTTP and public chat
    /// admission compare against PostgreSQL; the module's replicated floor is
    /// replayed after outages and accepts only monotonic updates.
    /// </para>
    /// </summary>
    public long TokenGeneration { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

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
    /// Identity's own <c>SecurityStamp</c> already changes on a credential
    /// change, but it is an opaque random value: comparing it can only ever be
    /// an equality test. The SpacetimeDB module has to hold a copy of whatever
    /// it compares against, and that copy is pushed best-effort — so an equality
    /// test would lock the legitimate user out whenever the push failed. A
    /// counter compares with <c>&gt;=</c> and degrades to "not yet revoked"
    /// instead.
    /// </para>
    /// </summary>
    public long TokenGeneration { get; set; }

    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

using CoreApi.Data;
using Microsoft.AspNetCore.Identity;

namespace CoreApi.Services;

/// <summary>
/// Keeps the SpacetimeDB module's copy of an account's access state in step with
/// core-api's.
///
/// <para>
/// This exists because the chat client talks to SpacetimeDB <em>directly</em>.
/// core-api's sign-in checks — account disabled, password just reset — are
/// simply not on that path, so on their own they revoke nothing: a token stays
/// good for its full lifetime no matter what happens to the account behind it.
/// The module therefore holds two facts per account (suspended, and the lowest
/// token generation it still accepts) and this pushes them.
/// </para>
///
/// <para>
/// Every push is best-effort. A failure is logged and swallowed, never
/// surfaced: an admin disabling an account, or a user resetting their password,
/// must not fail because SpacetimeDB happened to be unreachable. That is safe
/// only because the module's check is written to fail open — see
/// <see cref="RevokeTokensAsync"/>.
/// </para>
/// </summary>
public sealed class AccountAccessService(
    UserManager<ApplicationUser> users,
    SpacetimeClient spacetime,
    ILogger<AccountAccessService> logger)
{
    /// <summary>
    /// Invalidates every token already issued for the account: bumps its
    /// generation, persists that, and pushes the new floor to the module. Call
    /// after any credential change.
    ///
    /// <para>
    /// Order matters. The generation is persisted <em>before</em> the push, so a
    /// failed push leaves the account at the higher generation with the module's
    /// floor lagging behind. The module compares with <c>&gt;=</c>, so that
    /// state reads as "not yet revoked" and the legitimate user — whose fresh
    /// token carries the higher generation — keeps working. The reverse order
    /// would risk a floor above any token in existence, locking them out.
    /// </para>
    ///
    /// <para>
    /// Returns the account's new generation, so the caller can mint the
    /// replacement session from it rather than re-reading the user.
    /// </para>
    /// </summary>
    public async Task<long> RevokeTokensAsync(
        ApplicationUser user, CancellationToken ct = default)
    {
        user.TokenGeneration++;
        user.UpdatedAtUtc = DateTime.UtcNow;
        var result = await users.UpdateAsync(user);
        if (!result.Succeeded)
        {
            // The bump did not persist, so the old tokens are still legitimate
            // and pushing a floor now would lock the account out of chat for
            // nothing. Leave the module alone and say so.
            logger.LogError(
                "Could not persist a token-generation bump for {User}: {Errors}. "
                + "Previously issued tokens remain valid.",
                user.UserName, string.Join("; ", result.Errors.Select(e => e.Description)));
            return user.TokenGeneration - 1;
        }

        await PushAsync(user, ct);
        return user.TokenGeneration;
    }

    /// <summary>
    /// Pushes the account's current access state without touching its
    /// generation. Call after a status change (disable, re-enable, approve,
    /// reject) — the account keeps its sessions, but a suspended one is refused
    /// by the module regardless of token.
    /// </summary>
    public Task SyncAsync(ApplicationUser user, CancellationToken ct = default) =>
        PushAsync(user, ct);

    /// <summary>
    /// An account is suspended on the chat side exactly when it may not sign in
    /// for a reason that is not going to resolve itself. <c>Registered</c> and
    /// <c>EmailVerified</c> are deliberately excluded: those are pending states
    /// on the way in, and an account in them has no session to revoke.
    /// </summary>
    private static bool IsSuspended(ApplicationUser user) =>
        user.Status is AccountStatus.Disabled or AccountStatus.Rejected;

    private async Task PushAsync(ApplicationUser user, CancellationToken ct)
    {
        try
        {
            var pushed = await spacetime.SetAccountAccessAsync(
                user.SpacetimeIdentity, IsSuspended(user), user.TokenGeneration, ct);
            if (!pushed)
            {
                logger.LogWarning(
                    "No SpacetimeDB admin credential available; access state for {User} "
                    + "was not pushed. Chat sessions stay valid until it is.",
                    user.UserName);
            }
        }
        catch (Exception ex)
        {
            logger.LogError(
                ex,
                "Could not push access state for {User} to SpacetimeDB. Chat sessions "
                + "stay valid until it is pushed again.",
                user.UserName);
        }
    }
}

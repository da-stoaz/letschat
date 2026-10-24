using CoreApi.Data;

namespace CoreApi.Services;

/// <summary>
/// Closes revoked public chat sockets immediately, then mirrors account access
/// to the module. AccountAccessReconciler replays PostgreSQL state after failures
/// or restarts; public transport authorization never relies on this replica.
/// </summary>
public sealed class AccountAccessService(
    SpacetimeClient spacetime,
    ChatSessions sessions,
    ILogger<AccountAccessService> logger)
{
    public Task SyncAsync(ApplicationUser user, CancellationToken ct = default)
    {
        sessions.Revoke(user);
        return PushAsync(user, ct);
    }

    internal async Task PushAsync(ApplicationUser user, CancellationToken ct)
    {
        try
        {
            var pushed = await spacetime.SetAccountAccessAsync(user.SpacetimeIdentity,
                user.Status != AccountStatus.Active, user.TokenGeneration, ct);
            if (!pushed)
                logger.LogWarning("Account access for {UserId} awaits module synchronization", user.Id);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Account access for {UserId} will be retried by reconciliation", user.Id);
        }
    }
}

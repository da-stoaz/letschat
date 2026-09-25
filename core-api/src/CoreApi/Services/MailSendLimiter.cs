using System.Threading.RateLimiting;

namespace CoreApi.Services;

/// <summary>
/// Caps the mails an anonymous caller can trigger for one account
/// (confirmation resend, password reset). The IP budget alone cannot: a caller
/// rotating addresses would flood the inbox, and a shared CGNAT address would
/// block everyone behind it (BUG_ANALYSIS A11). Over the cap the endpoint still
/// answers generically, so the limit reveals nothing about the account.
/// </summary>
/// <remarks>
/// ponytail: process-local, like the SystemConfigService cache (F2); needs a
/// shared store only if core-api ever runs as several replicas.
/// </remarks>
public sealed class MailSendLimiter : IDisposable
{
    public const int MailsPerAccountPerHour = 3;

    private readonly PartitionedRateLimiter<string> _limiter =
        PartitionedRateLimiter.Create<string, string>(accountId =>
            RateLimitPartition.GetFixedWindowLimiter(accountId, _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = MailsPerAccountPerHour,
                Window = TimeSpan.FromHours(1),
                QueueLimit = 0,
            }));

    public bool TryAcquire(string accountId)
    {
        using var lease = _limiter.AttemptAcquire(accountId);
        return lease.IsAcquired;
    }

    public void Dispose() => _limiter.Dispose();
}

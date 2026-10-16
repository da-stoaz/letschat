using Microsoft.Extensions.Caching.Memory;

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
public sealed class MailSendLimiter(IMemoryCache cache, TimeProvider? clock = null)
{
    public const int MailsPerAccountPerHour = 3;
    public const int CooldownSeconds = 60;
    public const int InitialCooldownSeconds = 30;
    private readonly object gate = new();

    public bool TryAcquire(string accountId, bool initialConfirmation = false, bool correctingAddress = false)
    {
        // Serialize the short read/check/reserve step, never the mail delivery.
        // A rejected attempt does not extend the cooldown.
        lock (gate)
        {
            var now = (clock ?? TimeProvider.System).GetUtcNow();
            var key = (nameof(MailSendLimiter), accountId);
            var sent = cache.Get<Queue<(DateTimeOffset At, bool Initial)>>(key) ?? new();
            while (sent.TryPeek(out var oldest) && oldest.At <= now.AddHours(-1)) sent.Dequeue();
            var last = sent.LastOrDefault();
            var cooldown = last.Initial ? InitialCooldownSeconds : CooldownSeconds;
            if (sent.Count >= MailsPerAccountPerHour ||
                (sent.Count > 0 && !(correctingAddress && last.Initial) &&
                 now - last.At < TimeSpan.FromSeconds(cooldown)))
                return false;
            sent.Enqueue((now, initialConfirmation));
            cache.Set(key, sent, TimeSpan.FromHours(1));
            return true;
        }
    }
}

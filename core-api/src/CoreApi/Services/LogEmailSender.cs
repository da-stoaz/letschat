namespace CoreApi.Services;

/// <summary>
/// Development email transport — records that an email would have been sent,
/// without logging the recipient address or the body (the body carries
/// tokenised confirmation/reset links). Selected when <c>EMAIL_SENDER</c> is
/// <c>log</c>; needs no SMTP server. To inspect real email content in dev, use
/// Mailpit (<c>EMAIL_SENDER=smtp</c>).
/// </summary>
public sealed class LogEmailSender(ILogger<LogEmailSender> logger) : IEmailSender
{
    public Task SendAsync(
        string toAddress, string subject, string htmlBody, CancellationToken ct = default)
    {
        logger.LogInformation(
            "[dev email — not actually sent] subject: {Subject} ({BodyLength} chars)",
            subject, htmlBody.Length);
        return Task.CompletedTask;
    }
}

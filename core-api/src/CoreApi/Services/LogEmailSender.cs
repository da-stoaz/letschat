namespace CoreApi.Services;

/// <summary>
/// Development email transport — writes the message (including any tokenised
/// links) to the logs instead of sending it. Selected when <c>EMAIL_SENDER</c>
/// is <c>log</c>; needs no SMTP server.
/// </summary>
public sealed class LogEmailSender(ILogger<LogEmailSender> logger) : IEmailSender
{
    public Task SendAsync(
        string toAddress, string subject, string htmlBody, CancellationToken ct = default)
    {
        logger.LogInformation(
            "[dev email — not actually sent]\n  To: {To}\n  Subject: {Subject}\n  Body:\n{Body}",
            toAddress, subject, htmlBody);
        return Task.CompletedTask;
    }
}

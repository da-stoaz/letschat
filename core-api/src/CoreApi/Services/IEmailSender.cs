namespace CoreApi.Services;

/// <summary>
/// Transactional email transport. Two implementations are wired by config
/// (<c>EMAIL_SENDER</c>): <see cref="SmtpEmailSender"/> for real delivery and
/// <see cref="LogEmailSender"/> for local development.
/// </summary>
public interface IEmailSender
{
    Task SendAsync(string toAddress, string subject, string htmlBody, CancellationToken ct = default);
}

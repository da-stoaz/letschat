using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace CoreApi.Services;

/// <summary>
/// Sends email over SMTP via MailKit — the default, self-hosting-friendly
/// transport. Connection details are read from the runtime
/// <see cref="SystemConfigService"/> so they can be edited from the control
/// panel without a restart. A fresh connection is opened per message.
/// </summary>
public sealed class SmtpEmailSender(SystemConfigService config, ILogger<SmtpEmailSender> logger)
    : IEmailSender
{
    public async Task SendAsync(
        string toAddress, string subject, string htmlBody, CancellationToken ct = default)
    {
        var settings = config.Current;

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(settings.EmailFromName, settings.EmailFromAddress));
        message.To.Add(MailboxAddress.Parse(toAddress));
        message.Subject = subject;
        message.Body = new BodyBuilder { HtmlBody = htmlBody }.ToMessageBody();

        using var client = new SmtpClient();
        var socketOptions = settings.SmtpUseStartTls
            ? SecureSocketOptions.StartTls
            : SecureSocketOptions.None;

        await client.ConnectAsync(settings.SmtpHost, settings.SmtpPort, socketOptions, ct);
        if (!string.IsNullOrEmpty(settings.SmtpUser))
        {
            await client.AuthenticateAsync(settings.SmtpUser, settings.SmtpPassword ?? string.Empty, ct);
        }

        await client.SendAsync(message, ct);
        await client.DisconnectAsync(quit: true, ct);

        logger.LogInformation("Sent email to {To} (subject: {Subject})", toAddress, subject);
    }
}

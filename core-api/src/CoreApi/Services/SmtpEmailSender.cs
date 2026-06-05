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

        try
        {
            await client.ConnectAsync(settings.SmtpHost, settings.SmtpPort, socketOptions, ct);
            if (!string.IsNullOrEmpty(settings.SmtpUser))
            {
                await client.AuthenticateAsync(settings.SmtpUser, settings.SmtpPassword ?? string.Empty, ct);
            }

            await client.SendAsync(message, ct);
            await client.DisconnectAsync(quit: true, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not EmailDeliveryException)
        {
            // Surface transport failures (refused connection, wrong port, auth
            // rejected, …) as a typed error so the API answers 503 with a clear
            // message instead of a raw 500 — and callers can react.
            logger.LogError(
                ex, "SMTP delivery failed via {Host}:{Port}",
                settings.SmtpHost, settings.SmtpPort);
            throw new EmailDeliveryException(
                $"Could not send email: the SMTP server at {settings.SmtpHost}:{settings.SmtpPort} " +
                "is unreachable or rejected the message.", ex);
        }

        logger.LogInformation(
            "Sent email via {Host}:{Port} (subject: {Subject})",
            settings.SmtpHost, settings.SmtpPort, subject);
    }
}

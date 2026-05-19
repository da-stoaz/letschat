using CoreApi.Configuration;
using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace CoreApi.Services;

/// <summary>
/// Sends email over SMTP via MailKit — the default, self-hosting-friendly
/// transport. Works against a real provider relay or a local dev catcher
/// (Mailpit). A fresh connection is opened per message; volume here is low
/// (confirmation / reset mails only).
/// </summary>
public sealed class SmtpEmailSender(ServiceOptions options, ILogger<SmtpEmailSender> logger)
    : IEmailSender
{
    public async Task SendAsync(
        string toAddress, string subject, string htmlBody, CancellationToken ct = default)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(options.EmailFromName, options.EmailFromAddress));
        message.To.Add(MailboxAddress.Parse(toAddress));
        message.Subject = subject;
        message.Body = new BodyBuilder { HtmlBody = htmlBody }.ToMessageBody();

        using var client = new SmtpClient();
        var socketOptions = options.SmtpUseStartTls
            ? SecureSocketOptions.StartTls
            : SecureSocketOptions.None;

        await client.ConnectAsync(options.SmtpHost, options.SmtpPort, socketOptions, ct);
        if (!string.IsNullOrEmpty(options.SmtpUser))
        {
            await client.AuthenticateAsync(options.SmtpUser, options.SmtpPassword ?? string.Empty, ct);
        }

        await client.SendAsync(message, ct);
        await client.DisconnectAsync(quit: true, ct);

        logger.LogInformation("Sent email to {To} (subject: {Subject})", toAddress, subject);
    }
}

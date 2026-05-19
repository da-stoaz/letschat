using CoreApi.Configuration;
using CoreApi.Data;
using Microsoft.AspNetCore.Identity;

namespace CoreApi.Services;

/// <summary>
/// Generates ASP.NET Core Identity tokens and sends the corresponding
/// account emails (email confirmation, password reset). The tokenised links
/// point back at <c>core-api</c>'s public URL (<c>DISCOVERY_AUTH_URL</c>).
/// </summary>
public sealed class AccountEmailService(
    UserManager<ApplicationUser> users,
    IEmailSender email,
    ServiceOptions options)
{
    public async Task SendConfirmationEmailAsync(ApplicationUser user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            return;
        }

        var token = await users.GenerateEmailConfirmationTokenAsync(user);
        var url = Link("/auth/confirm-email", user.Id, token);
        var (subject, body) = EmailTemplates.EmailConfirmation(user.DisplayName, url);
        await email.SendAsync(user.Email, subject, body);
    }

    private string Link(string path, string userId, string token) =>
        $"{options.DiscoveryAuthUrl.TrimEnd('/')}{path}" +
        $"?userId={Uri.EscapeDataString(userId)}&token={Uri.EscapeDataString(token)}";
}

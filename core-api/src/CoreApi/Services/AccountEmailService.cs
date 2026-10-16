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
    ServiceOptions options,
    AccountAccessService access,
    ILogger<AccountEmailService> logger)
{
    // The caller must authorize the change (admin, or password-verified pending
    // registration). Save address, token revocation and confirmation state in
    // one optimistic-concurrency-checked write so stale requests cannot undo it.
    public async Task<bool> ChangeAddressAsync(ApplicationUser user, string email)
    {
        email = Validation.NormalizeEmail(email);
        if (email.Length > 256) throw ApiException.BadRequest("Email address is too long.");
        if (string.Equals(user.Email, email, StringComparison.OrdinalIgnoreCase))
            throw ApiException.BadRequest("Enter a different email address.");
        if (await users.FindByEmailAsync(email) is { } owner && owner.Id != user.Id)
            throw ApiException.Conflict("That email address is unavailable.");

        user.Email = email;
        user.EmailConfirmed = false;
        user.SecurityStamp = Guid.NewGuid().ToString();
        user.TokenGeneration++;
        user.UpdatedAtUtc = DateTime.UtcNow;
        if (user.Status == AccountStatus.EmailVerified) user.Status = AccountStatus.Registered;
        var result = await users.UpdateAsync(user);
        if (!result.Succeeded)
            throw ApiException.Conflict("Could not update the email address. Reload and try again.");

        await access.SyncAsync(user);
        try
        {
            await SendConfirmationEmailAsync(user);
            return true;
        }
        catch (EmailDeliveryException ex)
        {
            logger.LogWarning(ex, "Email address updated, but confirmation delivery failed for {UserId}", user.Id);
            return false;
        }
    }

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

    public async Task SendPasswordResetEmailAsync(ApplicationUser user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            return;
        }

        var token = await users.GeneratePasswordResetTokenAsync(user);
        var url = Link("/auth/reset-password", user.Id, token);
        var (subject, body) = EmailTemplates.PasswordReset(user.DisplayName, url);
        await email.SendAsync(user.Email, subject, body);
    }

    /// <summary>Tells an address's owner that someone tried to register it again (BUG_ANALYSIS A9).</summary>
    public async Task SendExistingAccountNoticeAsync(ApplicationUser user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            return;
        }

        var (subject, body) = EmailTemplates.ExistingAccount(user.DisplayName, user.UserName ?? string.Empty);
        await email.SendAsync(user.Email, subject, body);
    }

    public async Task SendApprovalEmailAsync(ApplicationUser user)
    {
        if (string.IsNullOrWhiteSpace(user.Email))
        {
            return;
        }

        var (subject, body) = EmailTemplates.AccountApproved(user.DisplayName);
        await email.SendAsync(user.Email, subject, body);
    }

    private string Link(string path, string userId, string token) =>
        $"{options.DiscoveryAuthUrl.TrimEnd('/')}{path}" +
        $"?userId={Uri.EscapeDataString(userId)}&token={Uri.EscapeDataString(token)}";
}

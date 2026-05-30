using System.Security.Claims;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CoreApi.Pages.Admin;

[Authorize(Roles = DbInitializer.AdminRole)]
public sealed class UserDetailModel(
    UserManager<ApplicationUser> users,
    AccountEmailService accountEmail,
    AuditService audit) : PageModel
{
    public ApplicationUser Target { get; private set; } = null!;
    public bool TargetIsAdmin { get; private set; }
    public bool IsSelf { get; private set; }

    [TempData] public string? Message { get; set; }
    [TempData] public string? Error { get; set; }

    public async Task<IActionResult> OnGetAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is null)
        {
            return NotFound();
        }

        Target = user;
        TargetIsAdmin = await users.IsInRoleAsync(user, DbInitializer.AdminRole);
        IsSelf = id == CurrentUserId();
        return Page();
    }

    public async Task<IActionResult> OnPostApproveAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is null) return NotFound();

        if (user.Status != AccountStatus.EmailVerified)
        {
            Error = "Account is not awaiting approval.";
            return Back(id);
        }

        await SetStatusAsync(user, AccountStatus.Active);
        await AuditAsync("user.approve", user, $"Approved {user.UserName}");
        try
        {
            await accountEmail.SendApprovalEmailAsync(user);
            Message = $"Approved {user.UserName}.";
        }
        catch (EmailDeliveryException ex)
        {
            // The approval itself stuck — only the notification email failed.
            Error = $"Approved {user.UserName}, but the approval email could not be sent — {ex.Message}";
        }
        return Back(id);
    }

    public async Task<IActionResult> OnPostRejectAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is null) return NotFound();

        if (user.Status != AccountStatus.EmailVerified)
        {
            Error = "Account is not awaiting approval.";
            return Back(id);
        }

        await SetStatusAsync(user, AccountStatus.Rejected);
        await AuditAsync("user.reject", user, $"Rejected {user.UserName}");
        Message = $"Rejected {user.UserName}.";
        return Back(id);
    }

    public async Task<IActionResult> OnPostDisableAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is null) return NotFound();

        if (id == CurrentUserId())
        {
            Error = "You cannot disable your own account.";
            return Back(id);
        }

        await SetStatusAsync(user, AccountStatus.Disabled);
        await AuditAsync("user.disable", user, $"Disabled {user.UserName}");
        Message = $"Disabled {user.UserName}.";
        return Back(id);
    }

    public async Task<IActionResult> OnPostEnableAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is null) return NotFound();

        await SetStatusAsync(user, AccountStatus.Active);
        await AuditAsync("user.enable", user, $"Enabled {user.UserName}");
        Message = $"Enabled {user.UserName}.";
        return Back(id);
    }

    public async Task<IActionResult> OnPostSendPasswordResetAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is null) return NotFound();

        if (string.IsNullOrWhiteSpace(user.Email))
        {
            Error = "This account has no email address to send a reset link to.";
            return Back(id);
        }

        try
        {
            await accountEmail.SendPasswordResetEmailAsync(user);
        }
        catch (EmailDeliveryException ex)
        {
            // The whole point of this action is the email — don't claim success.
            Error = $"Could not send the password-reset email — {ex.Message}";
            return Back(id);
        }

        await AuditAsync("user.password-reset", user, $"Sent password-reset email to {user.UserName}");
        Message = $"Sent a password-reset email to {user.UserName}.";
        return Back(id);
    }

    public async Task<IActionResult> OnPostGrantAdminAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is null) return NotFound();

        if (!await users.IsInRoleAsync(user, DbInitializer.AdminRole))
        {
            await users.AddToRoleAsync(user, DbInitializer.AdminRole);
            await AuditAsync("user.grant-admin", user, $"Granted Admin to {user.UserName}");
        }

        Message = $"{user.UserName} is now an administrator.";
        return Back(id);
    }

    public async Task<IActionResult> OnPostRevokeAdminAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is null) return NotFound();

        if (id == CurrentUserId())
        {
            Error = "You cannot revoke your own administrator role.";
            return Back(id);
        }

        if (await users.IsInRoleAsync(user, DbInitializer.AdminRole))
        {
            await users.RemoveFromRoleAsync(user, DbInitializer.AdminRole);
            await AuditAsync("user.revoke-admin", user, $"Revoked Admin from {user.UserName}");
        }

        Message = $"{user.UserName} is no longer an administrator.";
        return Back(id);
    }

    private async Task SetStatusAsync(ApplicationUser user, AccountStatus status)
    {
        user.Status = status;
        user.UpdatedAtUtc = DateTime.UtcNow;
        await users.UpdateAsync(user);
    }

    private Task AuditAsync(string action, ApplicationUser user, string detail) =>
        audit.RecordAsync(User.Identity?.Name ?? "admin", action, "user", user.Id, detail);

    private string? CurrentUserId() => User.FindFirstValue(ClaimTypes.NameIdentifier);

    private IActionResult Back(string id) => Redirect($"/admin/users/{id}");
}

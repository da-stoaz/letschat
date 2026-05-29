using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Pages.Admin;

[Authorize(Roles = DbInitializer.AdminRole)]
public sealed class PendingModel(
    UserManager<ApplicationUser> users,
    AccountEmailService accountEmail,
    AuditService audit) : PageModel
{
    public List<ApplicationUser> Pending { get; private set; } = [];

    [TempData] public string? Message { get; set; }

    public async Task OnGetAsync()
    {
        Pending = await users.Users
            .Where(u => u.Status == AccountStatus.EmailVerified)
            .OrderBy(u => u.CreatedAtUtc)
            .ToListAsync();
    }

    public async Task<IActionResult> OnPostApproveAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is { Status: AccountStatus.EmailVerified })
        {
            user.Status = AccountStatus.Active;
            user.UpdatedAtUtc = DateTime.UtcNow;
            await users.UpdateAsync(user);
            await accountEmail.SendApprovalEmailAsync(user);
            await audit.RecordAsync(
                User.Identity?.Name ?? "admin", "user.approve", "user", user.Id,
                $"Approved {user.UserName}");
            Message = $"Approved {user.UserName}.";
        }

        return Redirect("/admin/pending");
    }

    public async Task<IActionResult> OnPostRejectAsync(string id)
    {
        var user = await users.FindByIdAsync(id);
        if (user is { Status: AccountStatus.EmailVerified })
        {
            user.Status = AccountStatus.Rejected;
            user.UpdatedAtUtc = DateTime.UtcNow;
            await users.UpdateAsync(user);
            await audit.RecordAsync(
                User.Identity?.Name ?? "admin", "user.reject", "user", user.Id,
                $"Rejected {user.UserName}");
            Message = $"Rejected {user.UserName}.";
        }

        return Redirect("/admin/pending");
    }
}

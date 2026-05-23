using CoreApi.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Pages.Admin;

[Authorize(Roles = DbInitializer.AdminRole)]
public sealed class IndexModel(UserManager<ApplicationUser> users) : PageModel
{
    public int Total { get; private set; }
    public int Active { get; private set; }
    public int PendingApproval { get; private set; }
    public int Unconfirmed { get; private set; }
    public int Disabled { get; private set; }
    public int Rejected { get; private set; }
    public int Admins { get; private set; }

    public async Task OnGetAsync()
    {
        Total = await users.Users.CountAsync();
        Active = await users.Users.CountAsync(u => u.Status == AccountStatus.Active);
        PendingApproval = await users.Users.CountAsync(u => u.Status == AccountStatus.EmailVerified);
        Unconfirmed = await users.Users.CountAsync(u => u.Status == AccountStatus.Registered);
        Disabled = await users.Users.CountAsync(u => u.Status == AccountStatus.Disabled);
        Rejected = await users.Users.CountAsync(u => u.Status == AccountStatus.Rejected);
        Admins = (await users.GetUsersInRoleAsync(DbInitializer.AdminRole)).Count;
    }
}

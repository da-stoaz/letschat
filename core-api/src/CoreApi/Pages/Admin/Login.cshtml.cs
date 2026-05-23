using CoreApi.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CoreApi.Pages.Admin;

[AllowAnonymous]
public sealed class LoginModel(
    SignInManager<ApplicationUser> signInManager,
    UserManager<ApplicationUser> userManager) : PageModel
{
    [BindProperty]
    public string Username { get; set; } = string.Empty;

    [BindProperty]
    public string Password { get; set; } = string.Empty;

    public string? Error { get; set; }

    public IActionResult OnGet()
    {
        if (User.Identity?.IsAuthenticated == true && User.IsInRole(DbInitializer.AdminRole))
        {
            return Redirect("/admin");
        }

        return Page();
    }

    public async Task<IActionResult> OnPostAsync()
    {
        var username = (Username ?? string.Empty).Trim().ToLowerInvariant();
        var user = await userManager.FindByNameAsync(username);

        if (user is null || !await userManager.CheckPasswordAsync(user, Password ?? string.Empty))
        {
            Error = "Invalid username or password.";
            return Page();
        }

        if (!await userManager.IsInRoleAsync(user, DbInitializer.AdminRole))
        {
            Error = "This account is not an administrator.";
            return Page();
        }

        if (user.Status != AccountStatus.Active)
        {
            Error = "This administrator account is not active.";
            return Page();
        }

        await signInManager.SignInAsync(user, isPersistent: true);
        return Redirect("/admin");
    }
}

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

        if (user is null)
        {
            Error = "Invalid username or password.";
            return Page();
        }

        // Counts failures and applies the lockout from Program.cs, same as the
        // API sign-in (BUG_ANALYSIS A7). This page sits outside the rate limiter
        // (Razor Pages are not covered by RequireRateLimiting), so the lockout is
        // the only brake on guessing here besides ADMIN_BIND being non-public.
        var check = await signInManager.CheckPasswordSignInAsync(
            user, Password ?? string.Empty, lockoutOnFailure: true);
        if (check.IsLockedOut)
        {
            Error = Endpoints.AuthEndpoints.LockedOutMessage;
            return Page();
        }
        if (!check.Succeeded)
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

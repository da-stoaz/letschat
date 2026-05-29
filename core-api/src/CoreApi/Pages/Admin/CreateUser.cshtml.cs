using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CoreApi.Pages.Admin;

/// <summary>
/// Admin-creates-account flow (Phase 4). The form captures username, display
/// name, email, password and an "is administrator" flag; the account is saved
/// straight to <see cref="AccountStatus.Active"/> with email already confirmed —
/// the admin is the approval, per the plan.
///
/// <para>
/// The chat-domain SpacetimeDB identity does not exist yet when an admin
/// creates an account, so the record is seeded with a <c>pending:{guid}</c>
/// placeholder. The login endpoint detects this prefix on first sign-in and
/// swaps in the real identity supplied by the client, so the admin only has
/// to hand the user their username + password out of band.
/// </para>
/// </summary>
[Authorize(Roles = DbInitializer.AdminRole)]
public sealed class CreateUserModel(
    UserManager<ApplicationUser> users,
    AuditService audit) : PageModel
{
    public const string PendingIdentityPrefix = "pending:";

    [BindProperty] public string Username { get; set; } = string.Empty;
    [BindProperty] public string DisplayName { get; set; } = string.Empty;
    [BindProperty] public string Email { get; set; } = string.Empty;
    [BindProperty] public string Password { get; set; } = string.Empty;
    [BindProperty] public bool IsAdmin { get; set; }

    [TempData] public string? Error { get; set; }

    public void OnGet() { }

    public async Task<IActionResult> OnPostAsync()
    {
        var username = (Username ?? string.Empty).Trim().ToLowerInvariant();
        var displayName = (DisplayName ?? string.Empty).Trim();
        var email = (Email ?? string.Empty).Trim().ToLowerInvariant();
        var password = Password ?? string.Empty;

        if (username.Length < 2 || username.Length > 32
            || !username.All(c => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_'))
        {
            Error = "Username must be 2–32 chars, lower-case a–z, 0–9, or underscore.";
            return Page();
        }
        if (displayName.Length == 0)
        {
            Error = "Display name is required.";
            return Page();
        }
        if (string.IsNullOrEmpty(email) || !System.Net.Mail.MailAddress.TryCreate(email, out _))
        {
            Error = "A valid email address is required.";
            return Page();
        }
        if (password.Length < 8)
        {
            Error = "Password must be at least 8 characters.";
            return Page();
        }

        if (await users.FindByNameAsync(username) is not null)
        {
            Error = "Username is already taken.";
            return Page();
        }
        if (await users.FindByEmailAsync(email) is not null)
        {
            Error = "Email address is already registered.";
            return Page();
        }

        // Placeholder identity — the login endpoint replaces this with the
        // client's real SpacetimeDB identity on first sign-in.
        var placeholder = PendingIdentityPrefix + Guid.NewGuid().ToString("N");

        var user = new ApplicationUser
        {
            UserName = username,
            Email = email,
            DisplayName = displayName,
            SpacetimeIdentity = placeholder,
            SpacetimeIdentityNorm = placeholder,
            SpacetimeToken = string.Empty,
            Status = AccountStatus.Active,
            EmailConfirmed = true,
        };

        var created = await users.CreateAsync(user, password);
        if (!created.Succeeded)
        {
            Error = string.Join(" ", created.Errors.Select(e => e.Description));
            return Page();
        }

        if (IsAdmin)
        {
            await users.AddToRoleAsync(user, DbInitializer.AdminRole);
        }

        await audit.RecordAsync(
            User.Identity?.Name ?? "admin",
            "user.create",
            "user",
            user.Id,
            $"Created {user.UserName}{(IsAdmin ? " (admin)" : string.Empty)}");

        return Redirect($"/admin/users/{user.Id}");
    }
}

using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CoreApi.Pages.Admin;

[Authorize(Roles = DbInitializer.AdminRole)]
public sealed class ConfigModel(SystemConfigService configService, AuditService audit) : PageModel
{
    [BindProperty] public bool RegistrationOpen { get; set; }
    [BindProperty] public bool RequireEmailConfirmation { get; set; }
    [BindProperty] public bool RequireAdminApproval { get; set; }
    [BindProperty] public int RateLimitPermitLimit { get; set; }
    [BindProperty] public int RateLimitWindowSeconds { get; set; }
    [BindProperty] public string SmtpHost { get; set; } = string.Empty;
    [BindProperty] public int SmtpPort { get; set; }
    [BindProperty] public string? SmtpUser { get; set; }
    /// <summary>Left blank on load; only applied on save when non-empty.</summary>
    [BindProperty] public string? SmtpPassword { get; set; }
    [BindProperty] public bool SmtpUseStartTls { get; set; }
    [BindProperty] public string EmailFromAddress { get; set; } = string.Empty;
    [BindProperty] public string EmailFromName { get; set; } = string.Empty;

    public bool SmtpPasswordSet { get; private set; }

    [TempData] public string? Message { get; set; }
    public string? Error { get; set; }

    public void OnGet()
    {
        var c = configService.Current;
        RegistrationOpen = c.RegistrationOpen;
        RequireEmailConfirmation = c.RequireEmailConfirmation;
        RequireAdminApproval = c.RequireAdminApproval;
        RateLimitPermitLimit = c.RateLimitPermitLimit;
        RateLimitWindowSeconds = c.RateLimitWindowSeconds;
        SmtpHost = c.SmtpHost;
        SmtpPort = c.SmtpPort;
        SmtpUser = c.SmtpUser;
        SmtpUseStartTls = c.SmtpUseStartTls;
        EmailFromAddress = c.EmailFromAddress;
        EmailFromName = c.EmailFromName;
        SmtpPasswordSet = !string.IsNullOrEmpty(c.SmtpPassword);
    }

    public async Task<IActionResult> OnPostAsync()
    {
        if (RateLimitPermitLimit < 1 || RateLimitWindowSeconds < 1)
        {
            Error = "Rate-limit values must be at least 1.";
            SmtpPasswordSet = !string.IsNullOrEmpty(configService.Current.SmtpPassword);
            return Page();
        }

        await configService.UpdateAsync(c =>
        {
            c.RegistrationOpen = RegistrationOpen;
            c.RequireEmailConfirmation = RequireEmailConfirmation;
            c.RequireAdminApproval = RequireAdminApproval;
            c.RateLimitPermitLimit = RateLimitPermitLimit;
            c.RateLimitWindowSeconds = RateLimitWindowSeconds;
            c.SmtpHost = SmtpHost.Trim();
            c.SmtpPort = SmtpPort;
            c.SmtpUser = string.IsNullOrWhiteSpace(SmtpUser) ? null : SmtpUser.Trim();
            c.SmtpUseStartTls = SmtpUseStartTls;
            c.EmailFromAddress = EmailFromAddress.Trim();
            c.EmailFromName = EmailFromName.Trim();
            // Only overwrite the stored password when a new one was entered.
            if (!string.IsNullOrEmpty(SmtpPassword))
            {
                c.SmtpPassword = SmtpPassword;
            }
        });

        await audit.RecordAsync(
            User.Identity?.Name ?? "admin", "config.update", "config", null,
            "System configuration updated");

        Message = "Configuration saved.";
        return Redirect("/admin/config");
    }
}

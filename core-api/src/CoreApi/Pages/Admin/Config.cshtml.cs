using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace CoreApi.Pages.Admin;

[Authorize(Roles = DbInitializer.AdminRole)]
public sealed class ConfigModel(
    SystemConfigService configService,
    AuditService audit,
    SpacetimeClient spacetime) : PageModel
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

    /// <summary>Space-create policy on the SpacetimeDB module (plan 1.5).</summary>
    [BindProperty] public string SpaceCreatePolicy { get; set; } = "Anyone";

    public bool SmtpPasswordSet { get; private set; }

    /// <summary>True when SPACETIMEDB_SERVICE_TOKEN is set; gates the space-policy form.</summary>
    public bool SpacetimeWriteEnabled => spacetime.IsConfigured;

    [TempData] public string? Message { get; set; }
    public string? Error { get; set; }

    public async Task OnGetAsync()
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

        try
        {
            SpaceCreatePolicy = (await spacetime.GetSpaceCreatePolicyAsync()).ToString();
        }
        catch
        {
            // Module unreachable / not yet published — fall back to default
            // so the page still renders. The card will explain the situation.
            SpaceCreatePolicy = "Anyone";
        }
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

        // Space-create policy lives on the SpacetimeDB module. Push only when
        // the form's value differs from what's currently set there — keeps
        // the audit log meaningful and avoids a no-op reducer call.
        if (spacetime.IsConfigured && !string.IsNullOrWhiteSpace(SpaceCreatePolicy))
        {
            var requested = SpaceCreatePolicy.Equals("AdminsOnly", StringComparison.OrdinalIgnoreCase)
                ? Services.SpaceCreatePolicy.AdminsOnly
                : Services.SpaceCreatePolicy.Anyone;
            try
            {
                var current = await spacetime.GetSpaceCreatePolicyAsync();
                if (current != requested)
                {
                    await spacetime.SetSpaceCreatePolicyAsync(requested);
                    await audit.RecordAsync(
                        User.Identity?.Name ?? "admin",
                        "config.update.space_create_policy",
                        "spacetimedb",
                        null,
                        $"Space-create policy set to {requested}");
                }
            }
            catch (Exception ex)
            {
                Error = $"Saved core-api settings, but could not update SpacetimeDB space policy: {ex.Message}";
                SmtpPasswordSet = !string.IsNullOrEmpty(configService.Current.SmtpPassword);
                return Page();
            }
        }

        Message = "Configuration saved.";
        return Redirect("/admin/config");
    }
}

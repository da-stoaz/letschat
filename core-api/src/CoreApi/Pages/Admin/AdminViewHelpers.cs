using CoreApi.Data;

namespace CoreApi.Pages.Admin;

/// <summary>Small presentation helpers shared by the admin Razor pages.</summary>
public static class AdminViewHelpers
{
    /// <summary>Maps an account status to a badge CSS class and a display label.</summary>
    public static (string Css, string Text) StatusBadge(AccountStatus status) => status switch
    {
        AccountStatus.Active => ("badge-active", "Active"),
        AccountStatus.Registered => ("badge-registered", "Email unconfirmed"),
        AccountStatus.EmailVerified => ("badge-emailverified", "Pending approval"),
        AccountStatus.Disabled => ("badge-disabled", "Disabled"),
        AccountStatus.Rejected => ("badge-rejected", "Rejected"),
        _ => ("badge-disabled", status.ToString()),
    };
}

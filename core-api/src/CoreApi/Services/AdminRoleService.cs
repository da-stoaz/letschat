using CoreApi.Data;
using Microsoft.AspNetCore.Identity;

namespace CoreApi.Services;

public sealed record AdminRoleChangeResult(bool Succeeded, bool Changed, string? Error);

/// <summary>
/// Keeps the Core admin role and SpacetimeDB's matching flag together without
/// adding a background queue to an operation that happens only in the panel.
/// </summary>
public sealed class AdminRoleService(
    UserManager<ApplicationUser> users,
    SpacetimeClient spacetime)
{
    public async Task<AdminRoleChangeResult> SetAsync(ApplicationUser user, bool isAdmin)
    {
        var wasAdmin = await users.IsInRoleAsync(user, DbInitializer.AdminRole);
        if (wasAdmin != isAdmin)
        {
            var changed = await SetCoreRoleAsync(user, isAdmin);
            if (!changed.Succeeded)
            {
                return Failed(
                    $"Could not {(isAdmin ? "grant" : "revoke")} the administrator role — "
                    + IdentityErrors(changed));
            }
        }

        var syncError = await SyncErrorAsync(user, isAdmin);
        if (syncError is null)
        {
            return new(true, wasAdmin != isAdmin, null);
        }

        if (wasAdmin == isAdmin)
        {
            return Failed(syncError);
        }

        var rolledBack = await SetCoreRoleAsync(user, wasAdmin);
        if (!rolledBack.Succeeded)
        {
            return Failed($"{syncError} The Core role rollback also failed "
                + $"({IdentityErrors(rolledBack)}). Manual reconciliation is required.");
        }

        // A timeout is ambiguous: SpacetimeDB may have committed even though no
        // response arrived. Restore its previous value after the Core rollback.
        var restoreError = await SyncErrorAsync(user, wasAdmin);
        return restoreError is null
            ? Failed($"{syncError} The Core role was rolled back and SpacetimeDB was restored; "
                + "retry the action.")
            : Failed($"{syncError} The Core role was rolled back, but SpacetimeDB's previous "
                + $"state could not be confirmed ({restoreError}). Retry the action; if it "
                + "keeps failing, manual reconciliation is required.");
    }

    private Task<IdentityResult> SetCoreRoleAsync(ApplicationUser user, bool isAdmin) =>
        isAdmin
            ? users.AddToRoleAsync(user, DbInitializer.AdminRole)
            : users.RemoveFromRoleAsync(user, DbInitializer.AdminRole);

    private async Task<string?> SyncErrorAsync(ApplicationUser user, bool isAdmin)
    {
        try
        {
            return await spacetime.SyncUserAdminAsync(user.SpacetimeIdentity, isAdmin)
                ? null
                : "SpacetimeDB admin synchronization is unavailable; the role change was not completed.";
        }
        catch (Exception ex)
        {
            return $"The SpacetimeDB admin flag could not be "
                + $"{(isAdmin ? "set" : "cleared")} — {ex.Message}";
        }
    }

    private static AdminRoleChangeResult Failed(string error) => new(false, false, error);

    private static string IdentityErrors(IdentityResult result) =>
        string.Join("; ", result.Errors.Select(error => error.Description));
}

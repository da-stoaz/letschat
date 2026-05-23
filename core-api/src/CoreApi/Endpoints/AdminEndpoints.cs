using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Models;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Endpoints;

/// <summary>
/// <c>/admin/users/*</c> — the Phase 3 approval workflow: list the pending
/// queue and approve / reject accounts.
///
/// <para>
/// Gated by the shared <c>AUTH_ADMIN_API_KEY</c> supplied in the
/// <c>X-Admin-Api-Key</c> header. Phase 4's control panel will front these with
/// the <c>Admin</c> role and a non-public listener; until then the API key is
/// the gate.
/// </para>
/// </summary>
public static class AdminEndpoints
{
    private const string AdminApiKeyHeader = "X-Admin-Api-Key";

    public static void MapAdminEndpoints(this IEndpointRouteBuilder routes)
    {
        var users = routes.MapGroup("/admin/users");
        users.MapGet("/pending", ListPending);
        users.MapPost("/{userId}/approve", Approve);
        users.MapPost("/{userId}/reject", Reject);
    }

    /// <summary>Lists accounts in <see cref="AccountStatus.EmailVerified"/> — the approval queue.</summary>
    private static async Task<PendingUsersResponse> ListPending(
        HttpContext http, ServiceOptions options, UserManager<ApplicationUser> users)
    {
        RequireAdminKey(http, options);

        var pending = await users.Users
            .Where(u => u.Status == AccountStatus.EmailVerified)
            .OrderBy(u => u.CreatedAtUtc)
            .ToListAsync();

        return new PendingUsersResponse([.. pending.Select(u => new PendingUserDto(
            u.Id,
            u.UserName!,
            u.DisplayName,
            u.Email,
            u.CreatedAtUtc.ToString("o", System.Globalization.CultureInfo.InvariantCulture)))]);
    }

    /// <summary>Approves a pending account — <c>EmailVerified</c> → <c>Active</c>.</summary>
    private static async Task<IResult> Approve(
        string userId,
        HttpContext http,
        ServiceOptions options,
        UserManager<ApplicationUser> users,
        AccountEmailService accountEmail,
        AuditService audit)
    {
        RequireAdminKey(http, options);
        var user = await RequirePendingUser(userId, users);

        user.Status = AccountStatus.Active;
        user.UpdatedAtUtc = DateTime.UtcNow;
        var update = await users.UpdateAsync(user);
        if (!update.Succeeded)
        {
            throw ApiException.BadRequest("Could not approve the account.");
        }

        await accountEmail.SendApprovalEmailAsync(user);
        await audit.RecordAsync(
            "admin (api key)", "user.approve", "user", user.Id, $"Approved {user.UserName}");
        return Results.Json(new { status = "approved", username = user.UserName });
    }

    /// <summary>Rejects a pending account — <c>EmailVerified</c> → <c>Rejected</c>.</summary>
    private static async Task<IResult> Reject(
        string userId,
        HttpContext http,
        ServiceOptions options,
        UserManager<ApplicationUser> users,
        AuditService audit)
    {
        RequireAdminKey(http, options);
        var user = await RequirePendingUser(userId, users);

        user.Status = AccountStatus.Rejected;
        user.UpdatedAtUtc = DateTime.UtcNow;
        var update = await users.UpdateAsync(user);
        if (!update.Succeeded)
        {
            throw ApiException.BadRequest("Could not reject the account.");
        }

        await audit.RecordAsync(
            "admin (api key)", "user.reject", "user", user.Id, $"Rejected {user.UserName}");
        return Results.Json(new { status = "rejected", username = user.UserName });
    }

    private static void RequireAdminKey(HttpContext http, ServiceOptions options)
    {
        var configured = options.AdminApiKey
            ?? throw ApiException.Unauthorized("Admin endpoints are disabled.");

        var provided = http.Request.Headers[AdminApiKeyHeader].ToString().Trim();
        if (!string.Equals(provided, configured, StringComparison.Ordinal))
        {
            throw ApiException.Unauthorized("Invalid or missing admin API key.");
        }
    }

    private static async Task<ApplicationUser> RequirePendingUser(
        string userId, UserManager<ApplicationUser> users)
    {
        var user = await users.FindByIdAsync(userId)
            ?? throw ApiException.BadRequest("Account was not found.");

        if (user.Status != AccountStatus.EmailVerified)
        {
            throw ApiException.BadRequest(
                $"Account is not awaiting approval (current status: {user.Status}).");
        }

        return user;
    }
}

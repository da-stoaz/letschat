using System.Globalization;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Pages.Admin;

[Authorize(Roles = DbInitializer.AdminRole)]
public sealed class IndexModel(
    UserManager<ApplicationUser> users, AppDbContext db,
    SystemConfigService config, StorageInventoryState inventory) : PageModel
{
    public Dictionary<AccountStatus, int> Accounts { get; private set; } = [];
    public int Total => Accounts.Values.Sum();
    public int PendingApproval => Accounts.GetValueOrDefault(AccountStatus.EmailVerified);
    public int Admins { get; private set; }
    public List<(DateTime Date, int Count)> Signups { get; private set; } = [];
    public List<ApplicationUser> PendingUsers { get; private set; } = [];
    public List<AuditLogEntry> RecentActivity { get; private set; } = [];
    public int StoredFiles { get; private set; }
    public int PendingUploads { get; private set; }
    public long StoredBytes { get; private set; }
    public long ReservedBytes { get; private set; }
    public bool InventoryReady => inventory.IsReady;
    public SystemConfig Settings => config.Current;
    public DateTime UpdatedAt { get; private set; }
    public decimal StoragePercent => Settings.InstanceStorageLimitMiB > 0
        ? (StoredBytes + (decimal)ReservedBytes) / (Settings.InstanceStorageLimitMiB * 1048576m) * 100 : 0;

    public static string Bytes(long bytes) => bytes switch
    {
        >= 1073741824 => $"{bytes / 1073741824d:0.#} GiB",
        >= 1048576 => $"{bytes / 1048576d:0.#} MiB",
        >= 1024 => $"{bytes / 1024d:0.#} KiB",
        _ => $"{bytes} B"
    };
    public static string Percent(decimal value) => Math.Clamp(value, 0, 100).ToString("0.##", CultureInfo.InvariantCulture);

    public async Task OnGetAsync()
    {
        UpdatedAt = DateTime.UtcNow;
        var start = UpdatedAt.Date.AddDays(-13);
        var end = UpdatedAt.Date.AddDays(1);
        Accounts = await users.Users.GroupBy(u => u.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Status, g => g.Count);
        Admins = await (from role in db.Roles
                        join membership in db.UserRoles on role.Id equals membership.RoleId
                        where role.Name == DbInitializer.AdminRole
                        select membership).CountAsync();
        var daily = await users.Users.Where(u => u.CreatedAtUtc >= start && u.CreatedAtUtc < end)
            .GroupBy(u => u.CreatedAtUtc.Date)
            .Select(g => new { Date = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.Date, g => g.Count);
        Signups = Enumerable.Range(0, 14).Select(i =>
            (start.AddDays(i), daily.GetValueOrDefault(start.AddDays(i)))).ToList();
        PendingUsers = await users.Users.AsNoTracking().Where(u => u.Status == AccountStatus.EmailVerified)
            .OrderBy(u => u.CreatedAtUtc).Take(4).ToListAsync();
        RecentActivity = await db.AuditLog.AsNoTracking().OrderByDescending(a => a.TimestampUtc)
            .ThenByDescending(a => a.Id).Take(5).ToListAsync();
        if (InventoryReady)
        {
            StoredFiles = await db.ConfirmedUploads.CountAsync();
            StoredBytes = await db.ConfirmedUploads.SumAsync(u => u.FileSize);
            PendingUploads = await db.PendingUploads.CountAsync();
            ReservedBytes = await db.PendingUploads.SumAsync(u => u.FileSize);
        }
    }
}

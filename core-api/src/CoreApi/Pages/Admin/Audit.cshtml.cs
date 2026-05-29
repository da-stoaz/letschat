using CoreApi.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Pages.Admin;

[Authorize(Roles = DbInitializer.AdminRole)]
public sealed class AuditModel(AppDbContext db) : PageModel
{
    private const int MaxRows = 200;

    public List<AuditLogEntry> Entries { get; private set; } = [];

    public async Task OnGetAsync()
    {
        Entries = await db.AuditLog
            .OrderByDescending(e => e.TimestampUtc)
            .Take(MaxRows)
            .ToListAsync();
    }
}

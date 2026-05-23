using CoreApi.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Pages.Admin;

[Authorize(Roles = DbInitializer.AdminRole)]
public sealed class UsersModel(UserManager<ApplicationUser> users) : PageModel
{
    private const int MaxResults = 200;

    [BindProperty(SupportsGet = true)]
    public string? Q { get; set; }

    public List<ApplicationUser> Results { get; private set; } = [];
    public HashSet<string> AdminIds { get; private set; } = [];
    public bool Truncated { get; private set; }

    public async Task OnGetAsync()
    {
        var query = users.Users.AsQueryable();

        if (!string.IsNullOrWhiteSpace(Q))
        {
            var term = Q.Trim().ToLowerInvariant();
            var upper = term.ToUpperInvariant();
            query = query.Where(u =>
                u.NormalizedUserName!.Contains(upper)
                || u.DisplayName.ToLower().Contains(term)
                || (u.Email != null && u.Email.ToLower().Contains(term)));
        }

        Results = await query
            .OrderBy(u => u.UserName)
            .Take(MaxResults + 1)
            .ToListAsync();

        Truncated = Results.Count > MaxResults;
        if (Truncated)
        {
            Results.RemoveAt(Results.Count - 1);
        }

        AdminIds = (await users.GetUsersInRoleAsync(DbInitializer.AdminRole))
            .Select(u => u.Id)
            .ToHashSet();
    }
}

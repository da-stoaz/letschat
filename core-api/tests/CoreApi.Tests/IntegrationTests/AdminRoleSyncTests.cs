using System.Net;
using System.Security.Claims;
using System.Text;
using CoreApi.Data;
using CoreApi.Endpoints;
using CoreApi.Pages.Admin;
using CoreApi.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.Extensions.DependencyInjection;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// Admin roles live in PostgreSQL while the matching chat permission lives in
/// SpacetimeDB. A failed second write must not leave the two stores disagreeing.
/// </summary>
public sealed class AdminRoleSyncTests
{
    [Fact]
    public async Task Grant_Commits_Only_After_Spacetime_Accepts_It()
    {
        using var spacetime = new ReducerStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var (users, actor, target) = await SeedUsersAsync(scope.ServiceProvider, targetIsAdmin: false);
        var page = CreatePage(scope.ServiceProvider, actor);

        await page.OnPostGrantAdminAsync(target.Id);

        Assert.True(await users.IsInRoleAsync(target, DbInitializer.AdminRole));
        Assert.Null(page.Error);
        Assert.Equal($"{target.UserName} is now an administrator.", page.Message);
        Assert.Contains("/call/set_user_admin", spacetime.LastPath);
        Assert.EndsWith(",true]", spacetime.LastBody);
    }

    [Fact]
    public async Task Failed_Grant_Rolls_Back_Core_Role()
    {
        using var spacetime = new ReducerStub();
        spacetime.Statuses.Enqueue(HttpStatusCode.InternalServerError);
        spacetime.Statuses.Enqueue(HttpStatusCode.OK);
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var (users, actor, target) = await SeedUsersAsync(scope.ServiceProvider, targetIsAdmin: false);
        var page = CreatePage(scope.ServiceProvider, actor);

        await page.OnPostGrantAdminAsync(target.Id);

        Assert.False(await users.IsInRoleAsync(target, DbInitializer.AdminRole));
        Assert.Null(page.Message);
        Assert.Contains("Core role was rolled back", page.Error);
        Assert.Contains("SpacetimeDB was restored", page.Error);
        Assert.Equal(2, spacetime.AdminCalls);
        Assert.EndsWith(",false]", spacetime.LastBody);
    }

    [Fact]
    public async Task Failed_Revoke_Restores_Core_Role()
    {
        using var spacetime = new ReducerStub { Status = HttpStatusCode.InternalServerError };
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var (users, actor, target) = await SeedUsersAsync(scope.ServiceProvider, targetIsAdmin: true);
        var page = CreatePage(scope.ServiceProvider, actor);

        await page.OnPostRevokeAdminAsync(target.Id);

        Assert.True(await users.IsInRoleAsync(target, DbInitializer.AdminRole));
        Assert.Null(page.Message);
        Assert.Contains("Core role was rolled back", page.Error);
    }

    [Fact]
    public async Task Failed_Admin_Setup_During_User_Creation_Leaves_A_Retryable_Member()
    {
        using var spacetime = new ReducerStub { Status = HttpStatusCode.InternalServerError };
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        _ = factory.CreateClient();
        using var scope = factory.Services.CreateScope();
        var (users, actor, _) = await SeedUsersAsync(scope.ServiceProvider, targetIsAdmin: false);
        var page = ActivatorUtilities.CreateInstance<CreateUserModel>(scope.ServiceProvider);
        SetPrincipal(page, actor);
        page.Username = "created_admin";
        page.DisplayName = "Created Admin";
        page.Email = "created_admin@test.local";
        page.Password = "supersecret-test-1";
        page.IsAdmin = true;

        await page.OnPostAsync();

        var created = await users.FindByNameAsync(page.Username);
        Assert.NotNull(created);
        Assert.False(await users.IsInRoleAsync(created, DbInitializer.AdminRole));
        Assert.Contains("administrator setup failed", page.Error);
        Assert.Contains("Core role was rolled back", page.Error);
    }

    private static async Task<(UserManager<ApplicationUser> Users, ApplicationUser Actor,
        ApplicationUser Target)> SeedUsersAsync(IServiceProvider services, bool targetIsAdmin)
    {
        var users = services.GetRequiredService<UserManager<ApplicationUser>>();
        var spacetimeTokens = services.GetRequiredService<SpacetimeTokenService>();

        var actor = await CreateUserAsync(users, spacetimeTokens, "role_actor");
        Assert.True((await users.AddToRoleAsync(actor, DbInitializer.AdminRole)).Succeeded);

        var target = await CreateUserAsync(users, spacetimeTokens, "role_target");
        if (targetIsAdmin)
        {
            Assert.True((await users.AddToRoleAsync(target, DbInitializer.AdminRole)).Succeeded);
        }

        return (users, actor, target);
    }

    private static async Task<ApplicationUser> CreateUserAsync(
        UserManager<ApplicationUser> users,
        SpacetimeTokenService spacetimeTokens,
        string username)
    {
        var user = new ApplicationUser
        {
            UserName = username,
            Email = $"{username}@test.local",
            DisplayName = username,
            Status = AccountStatus.Active,
            EmailConfirmed = true,
        };
        AuthEndpoints.AssignDerivedIdentity(user, spacetimeTokens);
        Assert.True((await users.CreateAsync(user, "supersecret-test-1")).Succeeded);
        return user;
    }

    private static UserDetailModel CreatePage(IServiceProvider services, ApplicationUser actor)
    {
        var page = ActivatorUtilities.CreateInstance<UserDetailModel>(services);
        SetPrincipal(page, actor);
        return page;
    }

    private static void SetPrincipal(PageModel page, ApplicationUser actor)
    {
        page.PageContext = new PageContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(
                [
                    new Claim(ClaimTypes.NameIdentifier, actor.Id),
                    new Claim(ClaimTypes.Name, actor.UserName!),
                ], "test")),
            },
        };
    }

    private sealed class ReducerStub : HttpMessageHandler
    {
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
        public Queue<HttpStatusCode> Statuses { get; } = new();
        public string LastPath { get; private set; } = string.Empty;
        public string LastBody { get; private set; } = string.Empty;
        public int AdminCalls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath ?? string.Empty;
            var status = Status;
            if (path.EndsWith("/call/set_user_admin", StringComparison.Ordinal))
            {
                AdminCalls++;
                LastPath = path;
                LastBody = request.Content is null
                    ? string.Empty
                    : await request.Content.ReadAsStringAsync(cancellationToken);
                if (Statuses.TryDequeue(out var nextStatus))
                {
                    status = nextStatus;
                }
            }

            return new HttpResponseMessage(status)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json"),
            };
        }
    }
}

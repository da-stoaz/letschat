using System.Net;
using CoreApi.Data;
using CoreApi.Endpoints;
using CoreApi.Models;
using CoreApi.Pages.Admin;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CoreApi.Tests.IntegrationTests;

public sealed class EmailCorrectionTests : IDisposable
{
    private const string Password = "supersecret-test-1";
    private readonly LetsChatWebApplicationFactory root = new();
    private readonly WebApplicationFactory<Program> factory;
    private readonly Sender sender = new();
    private readonly HttpClient client;

    public EmailCorrectionTests()
    {
        factory = root.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IEmailSender>();
            services.AddSingleton<IEmailSender>(sender);
            services.AddSingleton<TimeProvider>(sender.Clock);
        }));
        client = factory.CreateClient();
    }

    private sealed class Sender : IEmailSender
    {
        public List<string> Addresses { get; } = [];
        public TestClock Clock { get; } = new();
        public bool Fail { get; set; }
        public Task SendAsync(string toAddress, string subject, string htmlBody, CancellationToken ct = default)
        {
            if (Fail) throw new EmailDeliveryException("SMTP unavailable");
            Addresses.Add(toAddress);
            return Task.CompletedTask;
        }
    }

    private async Task<ApplicationUser> Seed(string name = "typo_user", AccountStatus status = AccountStatus.Registered)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = new ApplicationUser
        {
            UserName = name,
            DisplayName = name,
            Email = $"{name}@wrong.test",
            Status = status,
            EmailConfirmed = status == AccountStatus.Active,
        };
        AuthEndpoints.AssignDerivedIdentity(user, scope.ServiceProvider.GetRequiredService<SpacetimeTokenService>());
        Assert.True((await users.CreateAsync(user, Password)).Succeeded);
        return user;
    }

    private Task<HttpResponseMessage> Correct(string email = "correct@example.test", string password = Password) =>
        LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/correct-registration-email",
            new { username = "typo_user", password, email });

    [Fact]
    public async Task Correction_Preserves_Account_And_Invalidates_Old_Confirmation_Link()
    {
        var original = await Seed();
        string oldToken;
        using (var scope = factory.Services.CreateScope())
        {
            Assert.True(scope.ServiceProvider.GetRequiredService<MailSendLimiter>()
                .TryAcquire(original.Id, initialConfirmation: true));
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            oldToken = await users.GenerateEmailConfirmationTokenAsync((await users.FindByIdAsync(original.Id))!);
        }
        Assert.Equal(HttpStatusCode.OK, (await Correct()).StatusCode);
        Assert.Equal(["correct@example.test"], sender.Addresses);
        using var checkScope = factory.Services.CreateScope();
        var manager = checkScope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var user = (await manager.FindByIdAsync(original.Id))!;
        Assert.Equal(original.SpacetimeIdentity, user.SpacetimeIdentity);
        Assert.Equal(original.UserName, user.UserName);
        Assert.Equal(AccountStatus.Registered, user.Status);
        Assert.False(user.EmailConfirmed);
        Assert.False((await manager.ConfirmEmailAsync(user, oldToken)).Succeeded);
        var newToken = await manager.GenerateEmailConfirmationTokenAsync(user);
        await client.GetAsync($"/auth/confirm-email?userId={user.Id}&token={Uri.EscapeDataString(newToken)}");
        using var finalScope = factory.Services.CreateScope();
        var confirmed = await finalScope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByIdAsync(user.Id);
        Assert.Equal(AccountStatus.Active, confirmed!.Status);
        Assert.True(confirmed.EmailConfirmed);
    }

    [Fact]
    public async Task Wrong_Password_And_Lockout_Cannot_Change_Address()
    {
        var original = await Seed();
        for (var i = 0; i < 5; i++)
            Assert.Equal(HttpStatusCode.Unauthorized, (await Correct(password: "wrong-password")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Correct()).StatusCode);
        using var scope = factory.Services.CreateScope();
        var user = await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByIdAsync(original.Id);
        Assert.Equal(original.Email, user!.Email);
        Assert.Empty(sender.Addresses);
    }

    [Theory]
    [InlineData(AccountStatus.Active)]
    [InlineData(AccountStatus.Disabled)]
    [InlineData(AccountStatus.Rejected)]
    [InlineData(AccountStatus.EmailVerified)]
    public async Task Correction_Cannot_Bypass_Account_State(AccountStatus status)
    {
        await Seed(status: status);
        Assert.Equal(HttpStatusCode.Forbidden, (await Correct()).StatusCode);
        Assert.Empty(sender.Addresses);
    }

    [Theory]
    [InlineData("other@wrong.test", HttpStatusCode.Conflict)]
    [InlineData("invalid", HttpStatusCode.BadRequest)]
    public async Task Invalid_Or_Duplicate_Address_Leaves_Original_Intact(string email, HttpStatusCode expected)
    {
        var original = await Seed();
        await Seed("other");
        Assert.Equal(expected, (await Correct(email)).StatusCode);
        using var scope = factory.Services.CreateScope();
        var user = await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByIdAsync(original.Id);
        Assert.Equal(original.Email, user!.Email);
        Assert.Equal(original.SecurityStamp, user.SecurityStamp);
    }

    [Fact]
    public async Task Failed_Delivery_Keeps_Corrected_Address_And_Allows_Resend()
    {
        await Seed();
        sender.Fail = true;
        var response = await Correct();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = await LetsChatWebApplicationFactory.ReadJsonAsync<CorrectRegistrationEmailResponse>(response);
        Assert.False(result.ConfirmationSent);
        Assert.Equal("correct@example.test", result.Email);
        sender.Fail = false;
        sender.Clock.Advance(TimeSpan.FromSeconds(MailSendLimiter.CooldownSeconds));
        await LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/resend-confirmation", new { username = "typo_user" });
        Assert.Equal([result.Email], sender.Addresses);
    }

    [Fact]
    public async Task Admin_Change_Is_Audited_And_Revokes_Credentials_Without_Enabling_Disabled_User()
    {
        var original = await Seed(status: AccountStatus.Disabled);
        using var scope = factory.Services.CreateScope();
        var page = ActivatorUtilities.CreateInstance<UserDetailModel>(scope.ServiceProvider);
        page.PageContext = new Microsoft.AspNetCore.Mvc.RazorPages.PageContext
        {
            HttpContext = new Microsoft.AspNetCore.Http.DefaultHttpContext(),
        };
        page.Email = "correct@example.test";
        await page.OnPostChangeEmailAsync(original.Id);
        Assert.Null(page.Error);
        using var check = factory.Services.CreateScope();
        var user = await check.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByIdAsync(original.Id);
        Assert.Equal(AccountStatus.Disabled, user!.Status);
        Assert.False(user.EmailConfirmed);
        Assert.Equal(original.TokenGeneration + 1, user.TokenGeneration);
        Assert.NotEqual(original.SecurityStamp, user.SecurityStamp);
        Assert.True(await check.ServiceProvider.GetRequiredService<AppDbContext>().AuditLog
            .AnyAsync(entry => entry.TargetId == original.Id && entry.Action == "user.change-email"));
    }

    [Fact]
    public async Task Corrections_Share_The_Account_Mail_Budget()
    {
        var original = await Seed();
        for (var i = 0; i < MailSendLimiter.MailsPerAccountPerHour; i++)
        {
            Assert.Equal(HttpStatusCode.OK, (await Correct($"correct{i}@example.test")).StatusCode);
            sender.Clock.Advance(TimeSpan.FromSeconds(MailSendLimiter.CooldownSeconds));
        }
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Correct()).StatusCode);
        using var scope = factory.Services.CreateScope();
        var user = await scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByIdAsync(original.Id);
        Assert.Equal($"correct{MailSendLimiter.MailsPerAccountPerHour - 1}@example.test", user!.Email);
        Assert.Equal(MailSendLimiter.MailsPerAccountPerHour, sender.Addresses.Count);
    }

    [Fact]
    public async Task Stale_Update_Cannot_Overwrite_A_New_Address()
    {
        var original = await Seed();
        using var staleScope = factory.Services.CreateScope();
        var stale = (await staleScope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByIdAsync(original.Id))!;
        Assert.Equal(HttpStatusCode.OK, (await Correct()).StatusCode);
        await Assert.ThrowsAsync<ApiException>(() => staleScope.ServiceProvider.GetRequiredService<AccountEmailService>()
            .ChangeAddressAsync(stale, "stale@example.test"));
        using var check = factory.Services.CreateScope();
        var user = await check.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>().FindByIdAsync(original.Id);
        Assert.Equal("correct@example.test", user!.Email);
        Assert.Single(sender.Addresses);
    }

    public void Dispose()
    {
        client.Dispose();
        factory.Dispose();
        root.Dispose();
    }
}

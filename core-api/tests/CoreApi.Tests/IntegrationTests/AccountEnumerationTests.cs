using System.Net;
using System.Text.Json;
using CoreApi.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// BUG_ANALYSIS A9: <c>/auth/register</c> answered "Email address is already
/// registered", and a failed resend answered 503 where a missing account got
/// 200 — both told a stranger which addresses have accounts.
/// </summary>
public sealed class AccountEnumerationTests
{
    private sealed class RecordingSender(bool fail) : IEmailSender
    {
        public List<(string To, string Subject)> Sent { get; } = [];

        public Task SendAsync(string toAddress, string subject, string htmlBody, CancellationToken ct = default)
        {
            if (fail) throw new EmailDeliveryException("smtp down", new InvalidOperationException());
            lock (Sent) Sent.Add((toAddress, subject));
            return Task.CompletedTask;
        }
    }

    private static (WebApplicationFactory<Program> Factory, RecordingSender Mail) Factory(bool mailFails = false)
    {
        var mail = new RecordingSender(mailFails);
        var factory = new LetsChatWebApplicationFactory().WithWebHostBuilder(builder =>
        {
            builder.ConfigureAppConfiguration(config => config.AddInMemoryCollection(
                new Dictionary<string, string?> { ["REQUIRE_EMAIL_CONFIRMATION"] = "true" }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<IEmailSender>();
                services.AddSingleton<IEmailSender>(mail);
            });
        });
        return (factory, mail);
    }

    private static Task<HttpResponseMessage> Register(HttpClient client, string username, string email) =>
        LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/register",
            new { username, displayName = username, password = "supersecret-test-1", email });

    [Fact]
    public async Task A_Taken_Address_Answers_Like_A_Fresh_Sign_Up_And_Tells_The_Owner()
    {
        var (factory, mail) = Factory();
        using var _ = factory;
        var client = factory.CreateClient();

        var first = await Register(client, "enum_owner", "taken@test.local");
        var second = await Register(client, "enum_stranger", "taken@test.local");

        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var a = JsonDocument.Parse(await first.Content.ReadAsStringAsync()).RootElement;
        var b = JsonDocument.Parse(await second.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(a.GetProperty("status").GetString(), b.GetProperty("status").GetString());
        Assert.NotEqual(a.GetProperty("identity").GetString(), b.GetProperty("identity").GetString());

        Assert.Equal(2, mail.Sent.Count);
        Assert.Equal("You already have a LetsChat account", mail.Sent[1].Subject);
        Assert.Equal("taken@test.local", mail.Sent[1].To);
    }

    [Fact]
    public async Task A_Failed_Resend_Answers_Like_A_Missing_Account()
    {
        var (factory, _) = Factory(mailFails: true);
        using var _factory = factory;
        var client = factory.CreateClient();
        // Registration itself needs the mail, so seed the account directly.
        using (var scope = factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<Microsoft.AspNetCore.Identity.UserManager<CoreApi.Data.ApplicationUser>>();
            await users.CreateAsync(new CoreApi.Data.ApplicationUser
            {
                UserName = "enum_unconfirmed",
                Email = "unconfirmed@test.local",
                DisplayName = "x",
                Status = CoreApi.Data.AccountStatus.Registered,
            }, "supersecret-test-1");
        }

        var existing = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/resend-confirmation", new { username = "enum_unconfirmed" });
        var missing = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/resend-confirmation", new { username = "enum_nobody" });

        Assert.Equal(missing.StatusCode, existing.StatusCode);
        Assert.Equal(await missing.Content.ReadAsStringAsync(), await existing.Content.ReadAsStringAsync());
    }
}

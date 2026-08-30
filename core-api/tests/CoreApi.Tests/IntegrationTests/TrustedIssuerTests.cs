using System.Net;
using System.Text;
using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// core-api's half of the anonymous-identity fix (BUG_ANALYSIS A1).
///
/// <para>
/// The SpacetimeDB module refuses to register an account unless the caller's
/// token came from a pinned OIDC issuer — and the only thing that knows the
/// right issuer is core-api, which signs those tokens. So core-api pushes it
/// with the <c>set_trusted_issuer</c> reducer. Get the wire format wrong and the
/// call fails silently at startup, leaving the module's check switched off and
/// the chat WebSocket open to anyone; these pin the format and the behaviour.
/// </para>
///
/// <para>
/// The module side (that it accepts this encoding, and what it then enforces)
/// is covered by <c>tests/security/anonymous-identity.test.ts</c> against a real
/// SpacetimeDB instance.
/// </para>
/// </summary>
public sealed class TrustedIssuerTests
{
    /// <summary>
    /// Gives the instance an <c>Admin</c> account, which is what
    /// <c>ResolveAdminTokensAsync</c> mints the reducer credential from. A
    /// brand-new instance has none — that is the state the startup pin runs in,
    /// and why the pin is retried on every admin sign-in.
    /// </summary>
    private static async Task SeedAdminAsync(LetsChatWebApplicationFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var admin = new ApplicationUser
        {
            UserName = "issuer_admin",
            Email = "issuer_admin@test.local",
            DisplayName = "Issuer Admin",
            Status = AccountStatus.Active,
            EmailConfirmed = true,
        };
        Assert.True((await users.CreateAsync(admin, "supersecret-test-1")).Succeeded);
        Assert.True((await users.AddToRoleAsync(admin, DbInitializer.AdminRole)).Succeeded);
    }

    [Fact]
    public async Task Pins_The_Configured_Issuer_As_A_Sats_Option()
    {
        using var spacetime = new ReducerStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        // Force the host to build so DI (and the startup pin) is live.
        _ = factory.CreateClient();
        await SeedAdminAsync(factory);

        var client = factory.Services.GetRequiredService<SpacetimeClient>();
        var options = factory.Services.GetRequiredService<ServiceOptions>();

        Assert.True(await client.PinTrustedIssuerAsync());

        Assert.Contains("/call/set_trusted_issuer", spacetime.LastPath);
        // set_trusted_issuer(Option<String>) — SATS-JSON wraps `Some(v)` as
        // `{"some": v}`. A bare string, or `{"none": []}`, would either be
        // rejected by the module or quietly clear the pin.
        Assert.Equal($"[{{\"some\":\"{options.SpacetimeOidcIssuer}\"}}]", spacetime.LastBody);
    }

    [Fact]
    public async Task Pins_Once_And_Then_Stops_Calling()
    {
        using var spacetime = new ReducerStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        _ = factory.CreateClient();
        await SeedAdminAsync(factory);

        var client = factory.Services.GetRequiredService<SpacetimeClient>();

        Assert.True(await client.PinTrustedIssuerAsync());
        var afterFirst = spacetime.Calls;

        // Every admin sign-in retries the pin; on a configured instance that must
        // not turn into a SpacetimeDB round trip per login.
        Assert.True(await client.PinTrustedIssuerAsync());
        Assert.True(await client.PinTrustedIssuerAsync());

        Assert.Equal(afterFirst, spacetime.Calls);
    }

    [Fact]
    public async Task Reports_Not_Pinned_When_The_Module_Refuses_Rather_Than_Claiming_Success()
    {
        // A module that rejects the call (e.g. the caller is not an instance
        // admin yet, which is the state of every brand-new instance) must leave
        // the client unpinned so the next admin sign-in retries. Silently
        // recording success here would strand the instance with the check off.
        using var spacetime = new ReducerStub { Status = HttpStatusCode.Unauthorized };
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        _ = factory.CreateClient();
        await SeedAdminAsync(factory);

        var client = factory.Services.GetRequiredService<SpacetimeClient>();

        await Assert.ThrowsAsync<InvalidOperationException>(() => client.PinTrustedIssuerAsync());

        spacetime.Status = HttpStatusCode.OK;
        Assert.True(await client.PinTrustedIssuerAsync());
        Assert.Contains("/call/set_trusted_issuer", spacetime.LastPath);
    }

    /// <summary>Stands in for SpacetimeDB's reducer <c>/call</c> endpoint.</summary>
    private sealed class ReducerStub : HttpMessageHandler
    {
        public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
        public string LastPath { get; private set; } = string.Empty;
        public string? LastBody { get; private set; }
        public int Calls { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls++;
            LastPath = request.RequestUri?.AbsolutePath ?? string.Empty;
            if (request.Content is not null)
            {
                LastBody = await request.Content.ReadAsStringAsync(cancellationToken);
            }

            return new HttpResponseMessage(Status)
            {
                Content = new StringContent("{}", Encoding.UTF8, "application/json"),
            };
        }
    }
}

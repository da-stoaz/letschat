using CoreApi.Services;
using Microsoft.Extensions.DependencyInjection;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <see cref="SpacetimeClient.SyncUserAdminAsync"/> must degrade gracefully when
/// the module integration isn't configured (no <c>SPACETIMEDB_SERVICE_TOKEN</c>,
/// as in tests/CI and any deployment that hasn't opted in) or when the account
/// has no real SpacetimeDB identity yet — returning <c>false</c> without making
/// a network call or throwing, so admin role changes still succeed.
/// </summary>
public sealed class SpacetimeClientTests : IClassFixture<LetsChatWebApplicationFactory>
{
    private readonly LetsChatWebApplicationFactory _factory;

    public SpacetimeClientTests(LetsChatWebApplicationFactory factory) => _factory = factory;

    [Fact]
    public async Task SyncUserAdmin_NoOps_When_Service_Token_Unset()
    {
        using var scope = _factory.Services.CreateScope();
        var spacetime = scope.ServiceProvider.GetRequiredService<SpacetimeClient>();

        Assert.False(spacetime.IsConfigured);

        // No token configured → every call short-circuits to false, no throw.
        Assert.False(await spacetime.SyncUserAdminAsync("0xabc123", true));
        Assert.False(await spacetime.SyncUserAdminAsync("pending:whatever", true));
        Assert.False(await spacetime.SyncUserAdminAsync(null, true));
        Assert.False(await spacetime.SyncUserAdminAsync("", false));
    }
}

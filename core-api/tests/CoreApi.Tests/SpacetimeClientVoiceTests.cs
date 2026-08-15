using System.Net;
using System.Text;
using CoreApi.Configuration;
using CoreApi.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;

namespace CoreApi.Tests;

/// <summary>
/// An <see cref="IServiceScopeFactory"/> with nothing registered — the admin
/// credential resolver finds no Identity store and falls back to the configured
/// token, which is all these transport-level tests need.
/// </summary>
internal static class TestScopes
{
    public static IServiceScopeFactory Empty { get; } =
        new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>();
}

/// <summary>
/// <see cref="SpacetimeClient.HasVoicePresenceAsync"/> — the room-authorization
/// gate on <c>/livekit/token</c>. Drives a stub transport so the SQL it issues
/// and its fail-closed behaviour are pinned without a live SpacetimeDB.
/// </summary>
public sealed class SpacetimeClientVoiceTests
{
    private const string AccountId = "account-1";

    private static ServiceOptions Options() =>
        ServiceOptions.FromConfiguration(new ConfigurationBuilder().Build());

    private static SpacetimeClient Client(StubHandler handler)
    {
        var options = Options();
        return new SpacetimeClient(
            new StubFactory(handler), options, new SpacetimeTokenService(options), TestScopes.Empty);
    }

    private static StubHandler Json(string body) => new(_ =>
        new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        });

    // SpacetimeDB /sql shape: [{ "rows": [[<col>, …], …] }] where an Identity
    // column is wrapped as a single-element array, e.g. ["0x<hex>"].
    [Fact]
    public async Task ChannelRoom_WithAMatchingPresenceRow_IsAuthorized()
    {
        var handler = Json("[{\"rows\":[[[\"0xabc\"]]]}]");
        VoiceRoom.TryParse("42", out var room);

        var ok = await Client(handler).HasVoicePresenceAsync(AccountId, "0xABC", room);

        Assert.True(ok);
        Assert.Contains("my_voice_participants", handler.LastBody);
        Assert.Contains("channel_id = 42", handler.LastBody);
    }

    [Fact]
    public async Task DmRoom_WithAMatchingPresenceRow_IsAuthorized()
    {
        var handler = Json("[{\"rows\":[[[\"0xA\"]]]}]");
        VoiceRoom.TryParse("dm:0xa:0xb", out var room);

        var ok = await Client(handler).HasVoicePresenceAsync(AccountId, "0xa", room);

        Assert.True(ok);
        Assert.Contains("my_dm_voice_participants", handler.LastBody);
        // The module's room_key is "<identity>:<identity>" — the "dm:" prefix and
        // any "0x" belong to the LiveKit room name, not to the stored key. Asserting
        // the prefixed form here is what let the mismatch ship: the query never
        // matched a row, so DM voice was refused for everyone.
        Assert.Contains("room_key = 'a:b'", handler.LastBody);
    }

    [Fact]
    public async Task PresenceRowsForOtherUsersOnly_AreNotAuthorized()
    {
        // The room has participants, but none of them is this user.
        var handler = Json("[{\"rows\":[[[\"0xother1\"]],[[\"0xother2\"]]]}]");
        VoiceRoom.TryParse("42", out var room);

        var ok = await Client(handler).HasVoicePresenceAsync(AccountId, "0xabc", room);

        Assert.False(ok);
    }

    [Fact]
    public async Task EmptyResultSet_IsNotAuthorized()
    {
        var handler = Json("[{\"rows\":[]}]");
        VoiceRoom.TryParse("42", out var room);

        Assert.False(await Client(handler).HasVoicePresenceAsync(AccountId, "0xabc", room));
    }

    [Fact]
    public async Task FailsClosed_OnNonSuccessResponse()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized));
        VoiceRoom.TryParse("42", out var room);

        Assert.False(await Client(handler).HasVoicePresenceAsync(AccountId, "0xabc", room));
    }

    [Fact]
    public async Task FailsClosed_OnTransportError()
    {
        var handler = new StubHandler(_ => throw new HttpRequestException("connection refused"));
        VoiceRoom.TryParse("42", out var room);

        Assert.False(await Client(handler).HasVoicePresenceAsync(AccountId, "0xabc", room));
    }

    /// <summary>
    /// Regression guard. This query used to be signed with a token persisted on
    /// the account row — a field that is always empty since core-api became the
    /// OIDC issuer, so every room check failed closed and nobody could join
    /// voice at all. The credential is minted here now; there is no stored field
    /// left to go stale.
    /// </summary>
    [Fact]
    public async Task QueriesAsTheAccount_WithAFreshlyMintedToken()
    {
        var handler = Json("[{\"rows\":[]}]");
        VoiceRoom.TryParse("42", out var room);

        await Client(handler).HasVoicePresenceAsync(AccountId, "0xabc", room);

        Assert.NotNull(handler.LastBearer);
        Assert.Equal(AccountId, new JsonWebToken(handler.LastBearer!).Subject);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder)
        : HttpMessageHandler
    {
        public string? LastBody { get; private set; }
        public string? LastBearer { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastBearer = request.Headers.Authorization?.Parameter;
            if (request.Content is not null)
            {
                LastBody = await request.Content.ReadAsStringAsync(cancellationToken);
            }
            return responder(request);
        }
    }

    private sealed class StubFactory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }
}

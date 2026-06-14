using System.Net;
using System.Text;
using CoreApi.Configuration;
using CoreApi.Services;
using Microsoft.Extensions.Configuration;

namespace CoreApi.Tests;

/// <summary>
/// <see cref="SpacetimeClient.HasVoicePresenceAsync"/> — the room-authorization
/// gate on <c>/livekit/token</c>. Drives a stub transport so the SQL it issues
/// and its fail-closed behaviour are pinned without a live SpacetimeDB.
/// </summary>
public sealed class SpacetimeClientVoiceTests
{
    private static ServiceOptions Options() =>
        ServiceOptions.FromConfiguration(new ConfigurationBuilder().Build());

    private static SpacetimeClient Client(StubHandler handler) =>
        new(new StubFactory(handler), Options());

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

        var ok = await Client(handler).HasVoicePresenceAsync("user-token", "0xABC", room);

        Assert.True(ok);
        Assert.Contains("my_voice_participants", handler.LastBody);
        Assert.Contains("channel_id = 42", handler.LastBody);
    }

    [Fact]
    public async Task DmRoom_WithAMatchingPresenceRow_IsAuthorized()
    {
        var handler = Json("[{\"rows\":[[[\"0xA\"]]]}]");
        VoiceRoom.TryParse("dm:0xa:0xb", out var room);

        var ok = await Client(handler).HasVoicePresenceAsync("user-token", "0xa", room);

        Assert.True(ok);
        Assert.Contains("my_dm_voice_participants", handler.LastBody);
        Assert.Contains("room_key = 'dm:0xa:0xb'", handler.LastBody);
    }

    [Fact]
    public async Task PresenceRowsForOtherUsersOnly_AreNotAuthorized()
    {
        // The room has participants, but none of them is this user.
        var handler = Json("[{\"rows\":[[[\"0xother1\"]],[[\"0xother2\"]]]}]");
        VoiceRoom.TryParse("42", out var room);

        var ok = await Client(handler).HasVoicePresenceAsync("user-token", "0xabc", room);

        Assert.False(ok);
    }

    [Fact]
    public async Task EmptyResultSet_IsNotAuthorized()
    {
        var handler = Json("[{\"rows\":[]}]");
        VoiceRoom.TryParse("42", out var room);

        Assert.False(await Client(handler).HasVoicePresenceAsync("user-token", "0xabc", room));
    }

    [Fact]
    public async Task FailsClosed_OnNonSuccessResponse()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.Unauthorized));
        VoiceRoom.TryParse("42", out var room);

        Assert.False(await Client(handler).HasVoicePresenceAsync("user-token", "0xabc", room));
    }

    [Fact]
    public async Task FailsClosed_OnTransportError()
    {
        var handler = new StubHandler(_ => throw new HttpRequestException("connection refused"));
        VoiceRoom.TryParse("42", out var room);

        Assert.False(await Client(handler).HasVoicePresenceAsync("user-token", "0xabc", room));
    }

    [Fact]
    public async Task FailsClosed_AndDoesNotCallSpacetime_WhenTheUserHasNoToken()
    {
        var handler = Json("[[\"0xabc\"]]");
        VoiceRoom.TryParse("42", out var room);

        var ok = await Client(handler).HasVoicePresenceAsync("  ", "0xabc", room);

        Assert.False(ok);
        Assert.False(handler.WasCalled);
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responder)
        : HttpMessageHandler
    {
        public bool WasCalled { get; private set; }
        public string? LastBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            WasCalled = true;
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

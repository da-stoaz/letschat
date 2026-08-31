using System.Net;
using System.Text;
using System.Text.Json;
using CoreApi.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/livekit/token</c> end to end: a real registered account, a stubbed
/// SpacetimeDB <c>/sql</c> transport standing in for the module's voice-presence
/// views, and the endpoint's own authorization gate in between.
///
/// <para>
/// <see cref="SpacetimeClientVoiceTests"/> covers the query in isolation; these
/// cover the wiring around it. The gap between the two is where the OIDC cutover
/// broke voice — the query was correct, but the endpoint handed it a credential
/// that no longer existed, so every request failed closed.
/// </para>
/// </summary>
public sealed class LiveKitTokenTests
{
    /// <summary>Registers an account and returns its session token and identity.</summary>
    private static async Task<(JsonElement SessionToken, string Identity)> RegisterAsync(
        HttpClient client, string username)
    {
        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new
            {
                username,
                displayName = username,
                password = "supersecret-test-1",
                email = $"{username}@test.local",
            });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var auth = doc.RootElement.GetProperty("auth");
        // The session token is the opaque auth-framework object the client posts
        // back verbatim; clone it out of the document before it is disposed.
        return (auth.GetProperty("sessionToken").Clone(),
                auth.GetProperty("spacetimeIdentity").GetString()!);
    }

    private static Task<HttpResponseMessage> RequestTokenAsync(
        HttpClient client, string room, string identity, JsonElement sessionToken) =>
        LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/livekit/token", new { room, identity, sessionToken });

    [Fact]
    public async Task Issues_A_Token_When_The_Module_Shows_The_Caller_In_The_Room()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();

        var (sessionToken, identity) = await RegisterAsync(client, "voicer");

        // The module admitted this account to channel 42, so its presence row is
        // visible through my_voice_participants.
        spacetime.Rows = $"[[[\"{identity}\"]]]";

        var response = await RequestTokenAsync(client, "42", identity, sessionToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("token").GetString()));

        Assert.Contains("my_voice_participants", spacetime.LastBody);

        // The authorization query must run AS THE CALLER, so row visibility is
        // exactly the caller's. Signing it with a service credential, a stale
        // stored token, or nothing at all would silently widen or void the gate,
        // so pin that the bearer resolves to this account's identity.
        Assert.NotNull(spacetime.LastBearer);
        var subject = new JsonWebToken(spacetime.LastBearer!).Subject;
        var spacetimeTokens = factory.Services.GetRequiredService<SpacetimeTokenService>();
        Assert.Equal(identity, spacetimeTokens.ComputeIdentityHex(subject));
    }

    /// <summary>
    /// DM rooms go through a different key than channel rooms, and that difference
    /// is where the second voice bug lived: the LiveKit room name is
    /// <c>dm:&lt;a&gt;:&lt;b&gt;</c>, but the module's stored <c>room_key</c> is just
    /// <c>&lt;a&gt;:&lt;b&gt;</c>. Querying with the prefix matched nothing, so DM
    /// voice was refused for everyone while channel voice worked.
    /// </summary>
    [Fact]
    public async Task Dm_Room_Queries_The_Module_Key_Without_The_Livekit_Prefix()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();

        var (sessionToken, identity) = await RegisterAsync(client, "caller");
        // The partner half of the pair; ordering in the room name is the client's job.
        const string partner = "c200ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        var room = string.CompareOrdinal(identity, partner) <= 0
            ? $"dm:{identity}:{partner}"
            : $"dm:{partner}:{identity}";

        spacetime.Rows = $"[[[\"{identity}\"]]]";

        var response = await RequestTokenAsync(client, room, identity, sessionToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("my_dm_voice_participants", spacetime.LastBody);
        Assert.Contains($"room_key = '{room["dm:".Length..]}'", spacetime.LastBody);
        Assert.DoesNotContain("room_key = 'dm:", spacetime.LastBody);
    }

    [Fact]
    public async Task Refuses_A_Room_The_Module_Never_Admitted_The_Caller_To()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();

        var (sessionToken, identity) = await RegisterAsync(client, "lurker");

        // Room exists and has participants, but none of them is this account.
        spacetime.Rows = "[[[\"0xsomeoneelse\"]]]";

        var response = await RequestTokenAsync(client, "42", identity, sessionToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Refuses_An_Identity_That_Is_Not_The_Session_Owners()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();

        var (sessionToken, _) = await RegisterAsync(client, "impostor");
        var (_, victimIdentity) = await RegisterAsync(client, "victim");

        // Even a room the victim is genuinely in must not yield them a token.
        spacetime.Rows = $"[[[\"{victimIdentity}\"]]]";

        var response = await RequestTokenAsync(client, "42", victimIdentity, sessionToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// The production regression. <c>docker-compose.prod.base.yml</c> never passed
    /// <c>SPACETIMEDB_HTTP_URL</c> to core-api, so it fell back to its dev default
    /// (<c>localhost:4300</c> — inside the core-api container) and every /sql call
    /// died in transport. That was reported to users as 403 "You are not a
    /// participant in this voice room": a confident, wrong claim about their own
    /// permissions, which sent debugging at the permission model instead of at the
    /// unreachable database.
    ///
    /// <para>
    /// The gate still fails closed — no token is minted — but an unanswered gate
    /// must report as an outage, and as a retryable one.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Reports_Unavailable_Rather_Than_Denied_When_The_Module_Is_Unreachable()
    {
        using var spacetime = new UnreachableStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();

        var (sessionToken, identity) = await RegisterAsync(client, "stranded");

        var response = await RequestTokenAsync(client, "42", identity, sessionToken);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);

        // And it must not say anything about the caller's membership, because it
        // does not know anything about the caller's membership.
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("not a participant", body, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>A SpacetimeDB that cannot be reached at all — no response, ever.</summary>
    private sealed class UnreachableStub : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken) =>
            throw new HttpRequestException("Connection refused (127.0.0.1:4300)");
    }

    /// <summary>
    /// Stands in for SpacetimeDB's <c>/sql</c> endpoint. <see cref="Rows"/> is the
    /// row array of the single statement result, settable per case because the
    /// account's identity is only known after registration.
    /// </summary>
    private sealed class SqlStub : HttpMessageHandler
    {
        /// <summary>SATS-JSON rows; an Identity column is a single-element array.</summary>
        public string Rows { get; set; } = "[]";

        public string? LastBearer { get; private set; }
        public string? LastBody { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastBearer = request.Headers.Authorization?.Parameter;
            if (request.Content is not null)
            {
                LastBody = await request.Content.ReadAsStringAsync(cancellationToken);
            }

            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    $"[{{\"rows\":{Rows}}}]", Encoding.UTF8, "application/json"),
            };
        }
    }
}

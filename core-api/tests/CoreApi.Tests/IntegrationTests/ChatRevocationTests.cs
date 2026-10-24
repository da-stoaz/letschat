using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace CoreApi.Tests.IntegrationTests;

public sealed class ChatRevocationTests
{
    private const string Password = "original-password-123";

    [Fact]
    public async Task Password_Change_Closes_Existing_Socket_And_Rejects_Old_Tickets_Even_When_Module_Push_Fails()
    {
        await using var upstream = await StartUpstream();
        using var transport = new AccessTransport { Fail = true };
        using var factory = Factory(transport, upstream.Urls.Single());
        using var client = factory.CreateClient();
        var auth = await Register(client, "chat_revoke");
        var token = auth.GetProperty("spacetimeToken").GetString()!;
        var first = await Ticket(client, token);
        var parked = await Ticket(client, token);
        var sockets = factory.Server.CreateWebSocketClient();
        sockets.SubProtocols.Add("test-protocol");
        using var old = await sockets.ConnectAsync(SocketUrl(first), CancellationToken.None);
        Assert.Equal("test-protocol", old.SubProtocol);
        await RoundTrip(old);

        var invalidChange = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/change-password", new
        {
            sessionToken = auth.GetProperty("sessionToken"),
            currentPassword = "incorrect-password",
            newPassword = "replacement-password-123",
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalidChange.StatusCode);
        // A failed Identity write must not persist the speculative generation bump.
        Assert.Equal(HttpStatusCode.OK, (await Exchange(client, token)).StatusCode);
        await RoundTrip(old);

        var change = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/change-password", new
        {
            sessionToken = auth.GetProperty("sessionToken"),
            currentPassword = Password,
            newPassword = "replacement-password-123",
        });
        Assert.Equal(HttpStatusCode.NoContent, change.StatusCode);
        await AssertClosed(old, TimeSpan.FromSeconds(2));
        Assert.Equal(HttpStatusCode.Unauthorized, (await Exchange(client, token)).StatusCode);
        var rejected = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            sockets.ConnectAsync(SocketUrl(parked), CancellationToken.None));
        Assert.Contains("401", rejected.Message);
        // A consumed ticket and a raw JWT in the query cannot bypass admission.
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.GetAsync($"/v1/database/letschat/subscribe?token={first}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await client.GetAsync($"/v1/database/letschat/subscribe?token={token}")).StatusCode);

        var login = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/login", new
        { username = "chat_revoke", password = "replacement-password-123" });
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
        var fresh = JsonDocument.Parse(await login.Content.ReadAsStringAsync()).RootElement;
        using var replacement = await sockets.ConnectAsync(
            SocketUrl(await Ticket(client, fresh.GetProperty("spacetimeToken").GetString()!)), CancellationToken.None);
        await RoundTrip(replacement);
    }

    [Fact]
    public async Task Account_Check_Catches_External_Suspension_Without_A_Local_Notification()
    {
        await using var upstream = await StartUpstream();
        using var transport = new AccessTransport();
        using var factory = Factory(transport, upstream.Urls.Single());
        using var client = factory.CreateClient();
        var auth = await Register(client, "chat_suspend");
        var token = auth.GetProperty("spacetimeToken").GetString()!;
        var sockets = factory.Server.CreateWebSocketClient();
        sockets.SubProtocols.Add("test-protocol");
        using var socket = await sockets.ConnectAsync(SocketUrl(await Ticket(client, token)), CancellationToken.None);
        await RoundTrip(socket);
        using (var scope = factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = (await users.FindByNameAsync("chat_suspend"))!;
            user.Status = AccountStatus.Disabled;
            Assert.True((await users.UpdateAsync(user)).Succeeded);
        }
        await AssertClosed(socket, TimeSpan.FromSeconds(8));
        Assert.Equal(HttpStatusCode.Unauthorized, (await Exchange(client, token)).StatusCode);
    }

    [Fact]
    public async Task Reconciliation_After_Restart_Replays_The_Latest_Durable_State()
    {
        using var transport = new AccessTransport { Fail = true };
        using var factory = Factory(transport, "http://127.0.0.1:1");
        using var client = factory.CreateClient();
        await Register(client, "chat_retry");
        string identity;
        using (var scope = factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var user = (await users.FindByNameAsync("chat_retry"))!;
            identity = user.SpacetimeIdentity;
            user.TokenGeneration = 2;
            user.Status = AccountStatus.Disabled;
            Assert.True((await users.UpdateAsync(user)).Succeeded);
            await scope.ServiceProvider.GetRequiredService<AccountAccessService>().SyncAsync(user);
        }
        Assert.Contains(transport.Calls, call => call.Identity == identity && call.Generation == 2 && call.Suspended);
        transport.Fail = false;
        transport.Calls.Clear();
        // A new worker has no process-local retry queue to recover. PostgreSQL
        // is sufficient, including changes made while the old worker was down.
        var worker = new AccountAccessReconciler(factory.Services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<AccountAccessReconciler>.Instance);
        await worker.ReconcileBatchAsync(CancellationToken.None);
        Assert.Contains(transport.Calls, call => call.Identity == identity && call.Generation == 2 && call.Suspended);
    }

    [Fact]
    public async Task Invalid_Foreign_And_Expired_Credentials_Are_Rejected()
    {
        using var transport = new AccessTransport();
        using var factory = Factory(transport, "http://127.0.0.1:1");
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Exchange(client, "not-a-token")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/v1/identity/websocket-token", null)).StatusCode);
        var auth = await Register(client, "chat_expire");
        var sessions = factory.Services.GetRequiredService<ChatSessions>();
        var credential = await sessions.AuthenticateAsync(auth.GetProperty("spacetimeToken").GetString(), CancellationToken.None);
        Assert.NotNull(credential);
        Assert.False(await sessions.IsCurrentAsync(credential with { ExpiresAt = DateTime.UtcNow.AddSeconds(-1) }, CancellationToken.None));
        // HTTP session JWTs have the wrong issuer/signature for the chat gateway.
        Assert.Equal(HttpStatusCode.Unauthorized,
            (await Exchange(client, auth.GetProperty("sessionToken").GetProperty("access_token").GetString()!)).StatusCode);
    }

    private static LetsChatWebApplicationFactory Factory(AccessTransport transport, string upstream) => new()
    {
        SpacetimeTransport = transport,
        ExtraConfig = new()
        {
            ["SPACETIMEDB_HTTP_URL"] = upstream,
            ["SPACETIMEDB_SERVICE_TOKEN"] = "test-service-token",
        },
    };

    private static async Task<JsonElement> Register(HttpClient client, string username)
    {
        var response = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/register", new
        { username, displayName = username, email = $"{username}@test.local", password = Password });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("auth").Clone();
    }

    private static Task<HttpResponseMessage> Exchange(HttpClient client, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/v1/identity/websocket-token");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client.SendAsync(request);
    }

    private static async Task<string> Ticket(HttpClient client, string token)
    {
        using var response = await Exchange(client, token);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.GetProperty("token").GetString()!;
    }

    private static Uri SocketUrl(string ticket) => new($"ws://localhost/v1/database/letschat/subscribe?token={ticket}&compression=None");

    private static async Task RoundTrip(WebSocket socket)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        await socket.SendAsync("read history"u8.ToArray(), WebSocketMessageType.Binary, true, timeout.Token);
        var buffer = new byte[100];
        var received = await socket.ReceiveAsync(buffer.AsMemory(), timeout.Token);
        Assert.Equal("read history", Encoding.UTF8.GetString(buffer, 0, received.Count));
    }

    private static async Task AssertClosed(WebSocket socket, TimeSpan timeout)
    {
        using var deadline = new CancellationTokenSource(timeout);
        try
        {
            var result = await socket.ReceiveAsync(new byte[100].AsMemory(), deadline.Token);
            Assert.Equal(WebSocketMessageType.Close, result.MessageType);
        }
        catch (WebSocketException) { }
        catch (IOException) { } // TestHost represents an aborted socket as EOF.
        catch (OperationCanceledException) when (!deadline.IsCancellationRequested) { }
    }

    private static async Task<WebApplication> StartUpstream()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseKestrel().UseUrls("http://127.0.0.1:0");
        var app = builder.Build();
        app.UseWebSockets();
        app.MapGet("/v1/database/letschat/subscribe", async (HttpContext http) =>
        {
            Assert.StartsWith("Bearer ", http.Request.Headers.Authorization.ToString());
            Assert.False(http.Request.Query.ContainsKey("token"));
            using var socket = await http.WebSockets.AcceptWebSocketAsync("test-protocol");
            var buffer = new byte[100];
            try
            {
                while (true)
                {
                    var received = await socket.ReceiveAsync(buffer.AsMemory(), http.RequestAborted);
                    if (received.MessageType == WebSocketMessageType.Close) break;
                    await socket.SendAsync(buffer.AsMemory(0, received.Count), received.MessageType, received.EndOfMessage, http.RequestAborted);
                }
            }
            catch (Exception ex) when (ex is WebSocketException or OperationCanceledException) { }
        });
        await app.StartAsync();
        return app;
    }

    private sealed class AccessTransport : HttpMessageHandler
    {
        public bool Fail { get; set; }
        public ConcurrentQueue<(string Identity, bool Suspended, long Generation)> Calls { get; } = new();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/call/admin_set_account_access", StringComparison.Ordinal))
            {
                var args = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct)).RootElement;
                Calls.Enqueue((args[0][0].GetString()![2..], args[1].GetBoolean(), args[2].GetInt64()));
                return new HttpResponseMessage(Fail ? HttpStatusCode.ServiceUnavailable : HttpStatusCode.OK)
                { Content = new StringContent("{}") };
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") };
        }
    }
}

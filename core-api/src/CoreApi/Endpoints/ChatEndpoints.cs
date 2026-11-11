using System.Net.WebSockets;
using CoreApi.Configuration;
using CoreApi.Services;

namespace CoreApi.Endpoints;

public static class ChatEndpoints
{
    public static void MapChatEndpoints(this WebApplication app)
    {
        // Same SDK wire contract; the short-lived query credential belongs to
        // this gateway, so a backend-issued ticket cannot bypass account checks.
        app.MapPost("/v1/identity/websocket-token", async (HttpContext http, ChatSessions sessions) =>
        {
            var credential = await sessions.AuthenticateAsync(Bearer(http), http.RequestAborted);
            if (credential is null) return Results.Unauthorized();
            http.Response.Headers.CacheControl = "no-store";
            return Results.Ok(new { token = sessions.IssueTicket(credential) });
        }).RequireRateLimiting(AuthEndpoints.LoginRateLimitPolicy);
        app.MapGet("/v1/database/{database}/subscribe", Subscribe);
    }

    private static string? Bearer(HttpContext http)
    {
        var header = http.Request.Headers.Authorization.ToString();
        return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..] : null;
    }

    private static async Task Subscribe(HttpContext http, string database, ChatSessions sessions,
        ServiceOptions options, ILoggerFactory logs)
    {
        if (database != options.SpacetimeModuleName)
        {
            http.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        var ticket = http.Request.Query["token"].ToString();
        var credential = ticket.Length > 0 ? sessions.TakeTicket(ticket)
            : await sessions.AuthenticateAsync(Bearer(http), http.RequestAborted);
        if (credential is null)
        {
            http.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }
        if (!http.WebSockets.IsWebSocketRequest)
        {
            http.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }

        using var stop = CancellationTokenSource.CreateLinkedTokenSource(http.RequestAborted);
        var id = sessions.Register(credential, stop);
        using var upstream = new ClientWebSocket();
        WebSocket? downstream = null;
        try
        {
            // Register before checking again: a password change between ticket
            // creation and socket admission must neither escape nor close a new session.
            if (!await sessions.IsCurrentAsync(credential, stop.Token))
            {
                http.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }
            var uri = new UriBuilder(options.SpacetimeHttpUrl)
            {
                Scheme = options.SpacetimeHttpUrl.StartsWith("https:", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws",
                Path = $"/v1/database/{Uri.EscapeDataString(database)}/subscribe",
                Query = QueryString.Create(http.Request.Query
                    .Where(pair => pair.Key is "compression" or "light" or "confirmed" or "connection_id")
                    .SelectMany(pair => pair.Value.Select(value => new KeyValuePair<string, string?>(pair.Key, value)))).ToString(),
            };
            upstream.Options.SetRequestHeader("Authorization", $"Bearer {credential.Token}");
            foreach (var protocol in http.WebSockets.WebSocketRequestedProtocols)
                upstream.Options.AddSubProtocol(protocol);
            using (var connect = CancellationTokenSource.CreateLinkedTokenSource(stop.Token))
            {
                connect.CancelAfter(TimeSpan.FromSeconds(10));
                await upstream.ConnectAsync(uri.Uri, connect.Token);
            }
            downstream = await http.WebSockets.AcceptWebSocketAsync(upstream.SubProtocol);
            using var abort = stop.Token.Register(() => { upstream.Abort(); downstream.Abort(); });
            var outgoing = Relay(downstream, upstream, stop.Token);
            var incoming = Relay(upstream, downstream, stop.Token);
            var watch = WatchAccount(sessions, credential, stop);
            await Task.WhenAny(outgoing, incoming, watch);
            stop.Cancel();
            await Task.WhenAll(outgoing, incoming, watch);
        }
        catch (Exception ex) when (ex is OperationCanceledException or WebSocketException)
        {
            if (!http.Response.HasStarted) http.Response.StatusCode = StatusCodes.Status502BadGateway;
        }
        finally
        {
            sessions.Remove(id);
            stop.Cancel();
            downstream?.Dispose();
        }

        async Task WatchAccount(ChatSessions registry, ChatSessions.Credential account, CancellationTokenSource cancellation)
        {
            try
            {
                // Local account changes cancel immediately. This also catches
                // changes from another process, token expiry and lost DB access.
                using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
                while (await timer.WaitForNextTickAsync(cancellation.Token))
                {
                    using var check = CancellationTokenSource.CreateLinkedTokenSource(cancellation.Token);
                    check.CancelAfter(TimeSpan.FromSeconds(3));
                    if (!await registry.IsCurrentAsync(account, check.Token)) break;
                }
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { }
            catch (Exception ex)
            {
                logs.CreateLogger("ChatGateway").LogWarning(ex, "Closing chat connection: account validation unavailable");
            }
            finally { cancellation.Cancel(); }
        }
    }

    private static async Task Relay(WebSocket source, WebSocket destination, CancellationToken ct)
    {
        var buffer = new byte[64 * 1024];
        while (!ct.IsCancellationRequested)
        {
            var received = await source.ReceiveAsync(buffer.AsMemory(), ct);
            if (received.MessageType == WebSocketMessageType.Close) return;
            // Preserve fragments and the negotiated SDK protocol. No parsing or
            // buffering of whole messages, including compressed subscription data.
            await destination.SendAsync(buffer.AsMemory(0, received.Count), received.MessageType, received.EndOfMessage, ct);
        }
    }
}

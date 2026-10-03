using System.Net;
using System.Text;
using ArchiveWorker;
using Microsoft.Extensions.Logging.Abstractions;

namespace CoreApi.Tests.IntegrationTests;

public sealed class ArchiveCredentialsTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("archive-credentials-").FullName;
    public void Dispose() => Directory.Delete(_dir, true);

    [Theory]
    [InlineData(HttpStatusCode.OK, false)]
    [InlineData(HttpStatusCode.Unauthorized, true)]
    public async Task Keeps_valid_tokens_and_replaces_rejected_managed_tokens(HttpStatusCode status, bool replaced)
    {
        var path = Path.Combine(_dir, "worker.token");
        await File.WriteAllTextAsync(path, "old.worker.token");
        var requests = new List<string>();
        using var http = new HttpClient(new Stub(request =>
        {
            requests.Add(request.RequestUri!.AbsolutePath);
            if (requests.Count == 1)
            {
                Assert.Equal("Bearer old.worker.token", request.Headers.Authorization!.ToString());
                // Never persist the short-lived websocket exchange response.
                return Reply(status, "{\"token\":\"temporary.websocket.token\"}");
            }
            Assert.Null(request.Headers.Authorization);
            return Reply(HttpStatusCode.OK, "{\"token\":\"new.worker.token\"}");
        }));
        var credentials = new ArchiveCredentials(Options(path), http, NullLogger<ArchiveCredentials>.Instance);
        var token = await credentials.GetTokenAsync(default);
        Assert.Equal(replaced ? "new.worker.token" : "old.worker.token", token);
        Assert.Equal(token, await File.ReadAllTextAsync(path));
        Assert.Equal(replaced ? 2 : 1, requests.Count);
        Assert.Equal("/v1/identity/websocket-token", requests[0]);
        if (replaced)
        {
            Assert.Equal("/v1/identity", requests[1]);
            if (!OperatingSystem.IsWindows())
                Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
        }
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.Forbidden)]
    public async Task Server_errors_do_not_rotate_identity(HttpStatusCode status)
    {
        var path = Path.Combine(_dir, "worker.token");
        await File.WriteAllTextAsync(path, "old.worker.token");
        var calls = 0;
        using var http = new HttpClient(new Stub(_ => { calls++; return Reply(status, "unavailable"); }));
        var credentials = new ArchiveCredentials(Options(path), http, NullLogger<ArchiveCredentials>.Instance);
        await Assert.ThrowsAsync<HttpRequestException>(() => credentials.GetTokenAsync(default));
        Assert.Equal(1, calls);
        Assert.Equal("old.worker.token", await File.ReadAllTextAsync(path));
    }

    [Fact]
    public async Task Failed_replacement_keeps_the_previous_file()
    {
        var path = Path.Combine(_dir, "worker.token");
        await File.WriteAllTextAsync(path, "old.worker.token");
        var calls = 0;
        using var http = new HttpClient(new Stub(_ => ++calls == 1
            ? Reply(HttpStatusCode.Unauthorized, "InvalidSignature")
            : Reply(HttpStatusCode.ServiceUnavailable, "unavailable")));
        var credentials = new ArchiveCredentials(Options(path), http, NullLogger<ArchiveCredentials>.Instance);
        await Assert.ThrowsAsync<HttpRequestException>(() => credentials.GetTokenAsync(default));
        Assert.Equal("old.worker.token", await File.ReadAllTextAsync(path));
    }

    [Fact]
    public async Task Explicit_credentials_are_never_replaced()
    {
        var path = Path.Combine(_dir, "worker.token");
        using var http = new HttpClient(new Stub(_ => throw new Exception("Must not request a new identity")));
        var credentials = new ArchiveCredentials(Options(path, "operator.token.override"), http,
            NullLogger<ArchiveCredentials>.Instance);
        Assert.Equal("operator.token.override", await credentials.GetTokenAsync(default));
        Assert.False(File.Exists(path));
    }

    private static WorkerOptions Options(string path, string? token = null) => new()
    {
        SpacetimeUri = "ws://spacetimedb:3000", SpacetimeModule = "letschat",
        TokenFile = path, Token = token, ArchiveConnectionString = "unused",
    };

    private static HttpResponseMessage Reply(HttpStatusCode status, string body) => new(status)
    {
        Content = new StringContent(body, Encoding.UTF8, "application/json"),
    };

    private sealed class Stub(Func<HttpRequestMessage, HttpResponseMessage> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
            => Task.FromResult(reply(request));
    }
}

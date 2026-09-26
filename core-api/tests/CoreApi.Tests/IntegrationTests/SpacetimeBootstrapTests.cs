using System.Collections.Concurrent;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.IdentityModel.Tokens;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// The install finishes itself: core-api reads the module owner's credential
/// and the archive-worker's identity from the files module-init and the worker
/// persist, pins its issuer and registers the worker — no operator copying
/// tokens into .env, and no window where the module is open.
/// </summary>
public sealed class SpacetimeBootstrapTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("letschat-bootstrap-").FullName;

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    /// <summary>The shape of a real <c>spacetime</c> CLI config.</summary>
    private static string CliToml(string token) =>
        $"default_server = \"maincloud\"\nspacetimedb_token = \"{token}\"\n\n"
        + "[[server_configs]]\nnickname = \"local\"\nhost = \"127.0.0.1:3000\"\nprotocol = \"http\"\n";

    /// <summary>A SpacetimeDB-shaped token; only its payload is ever read here.</summary>
    private static string WorkerToken(string hexIdentity) =>
        "eyJhbGciOiJFUzI1NiJ9."
        + Base64UrlEncoder.Encode($"{{\"hex_identity\":\"{hexIdentity}\",\"iss\":\"localhost\"}}")
        + ".c2ln";

    [Fact]
    public void Reads_the_owner_token_from_a_spacetime_cli_config()
    {
        Assert.Equal("eyJ.owner.token", SpacetimeClient.ParseCliToken(CliToml("eyJ.owner.token")));
        Assert.Null(SpacetimeClient.ParseCliToken("spacetimedb_token_backup = \"old\"\n"));
        Assert.Null(SpacetimeClient.ParseCliToken("default_server = \"local\"\n"));
        Assert.Null(SpacetimeClient.ParseCliToken("spacetimedb_token = \"\"\n"));
    }

    [Fact]
    public void Reads_the_identity_from_a_spacetime_token()
    {
        var hex = new string('a', 64);
        Assert.Equal(hex, SpacetimeClient.IdentityOfToken(WorkerToken(hex)));
        Assert.Null(SpacetimeClient.IdentityOfToken("not-a-token"));
        Assert.Null(SpacetimeClient.IdentityOfToken("e30." + Base64UrlEncoder.Encode("{\"hex_identity\":123}") + ".sig"));
        Assert.Null(SpacetimeClient.IdentityOfToken(WorkerToken("0xnothex")));
    }

    [Fact]
    public void A_generated_signing_key_is_persisted_once_and_reused()
    {
        var path = Path.Combine(_dir, "core-api", "oidc-key.pem");
        using var first = RSA.Create(2048);
        using var second = RSA.Create(2048);

        var created = SpacetimeTokenService.LoadOrCreateKeyFile(path, first);
        var reloaded = SpacetimeTokenService.LoadOrCreateKeyFile(path, second);

        Assert.Equal(created, reloaded); // the second, different key was not written
        Assert.Contains("BEGIN PRIVATE KEY", created);
        if (!OperatingSystem.IsWindows())
        {
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(path));
        }
    }

    [Fact]
    public void A_key_file_satisfies_the_production_key_requirement()
    {
        var options = ServiceOptions.FromConfiguration(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["SPACETIME_OIDC_KEY_FILE"] = Path.Combine(_dir, "oidc-key.pem"),
            })
            .Build());

        Assert.DoesNotContain("SPACETIME_OIDC_PRIVATE_KEY", options.FindInsecureDefaults());
    }

    [Fact]
    public async Task Pins_the_issuer_and_registers_the_worker_from_the_persisted_files()
    {
        var workerIdentity = new string('b', 64);
        var ownerToken = Path.Combine(_dir, "cli.toml");
        var workerToken = Path.Combine(_dir, "archive-worker.token");
        await File.WriteAllTextAsync(ownerToken, CliToml("eyJ.owner.token"));
        await File.WriteAllTextAsync(workerToken, WorkerToken(workerIdentity));

        var stub = new RecordingStub();
        await using var factory = new LetsChatWebApplicationFactory
        {
            SpacetimeTransport = stub,
            ExtraConfig =
            {
                ["SPACETIMEDB_SERVICE_TOKEN_FILE"] = ownerToken,
                ["ARCHIVE_WORKER_TOKEN_FILE"] = workerToken,
            },
        };
        _ = factory.CreateClient(); // boots the host, which starts the bootstrapper

        var pin = await stub.WaitForAsync("set_trusted_issuer");
        Assert.Equal("Bearer eyJ.owner.token", pin.Authorization);
        Assert.Contains("https://issuer.test", pin.Body);

        var register = await stub.WaitForAsync("set_archive_service_identity");
        Assert.Contains($"0x{workerIdentity}", register.Body);
    }

    [Fact]
    public async Task Retries_when_files_appear_after_startup_and_the_first_pin_fails()
    {
        var ownerToken = Path.Combine(_dir, "late-cli.toml");
        var workerToken = Path.Combine(_dir, "late-worker.token");
        var stub = new RecordingStub { RejectFirstPin = true };
        await using var factory = new LetsChatWebApplicationFactory
        {
            SpacetimeTransport = stub,
            ExtraConfig =
            {
                ["SPACETIMEDB_SERVICE_TOKEN_FILE"] = ownerToken,
                ["ARCHIVE_WORKER_TOKEN_FILE"] = workerToken,
            },
        };
        _ = factory.CreateClient();
        await File.WriteAllTextAsync(ownerToken, CliToml("eyJ.late.token"));
        await File.WriteAllTextAsync(workerToken, WorkerToken(new string('c', 64)));

        var pin = await stub.WaitForAsync("set_trusted_issuer");
        Assert.Equal("Bearer eyJ.late.token", pin.Authorization);
        Assert.True(stub.PinAttempts >= 2);
        await stub.WaitForAsync("set_archive_service_identity");
    }

    [Fact]
    public async Task The_bootstrap_admin_is_not_recreated_once_any_admin_exists()
    {
        await using var factory = new LetsChatWebApplicationFactory
        {
            ExtraConfig =
            {
                ["ADMIN_BOOTSTRAP_USERNAME"] = "bootstrap_admin",
                ["ADMIN_BOOTSTRAP_PASSWORD"] = "a-long-bootstrap-password-123",
            },
        };
        _ = factory.CreateClient();

        using var scope = factory.Services.CreateScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();

        // The first start created it. An operator then replaces it with their own
        // admin and deletes it — the next start must not bring it back.
        var bootstrap = await users.FindByNameAsync("bootstrap_admin");
        Assert.NotNull(bootstrap);
        var replacement = new ApplicationUser
        {
            UserName = "real_admin",
            Email = "real@test.local",
            DisplayName = "Real Admin",
            Status = AccountStatus.Active,
            EmailConfirmed = true,
        };
        Assert.True((await users.CreateAsync(replacement, "another-long-password-456")).Succeeded);
        Assert.True((await users.AddToRoleAsync(replacement, DbInitializer.AdminRole)).Succeeded);
        Assert.True((await users.DeleteAsync(bootstrap!)).Succeeded);

        await DbInitializer.SeedBootstrapAdminAsync(scope.ServiceProvider, NullLogger.Instance);

        Assert.Null(await users.FindByNameAsync("bootstrap_admin"));
    }

    private sealed record Call(string Authorization, string Body);

    private sealed class RecordingStub : HttpMessageHandler
    {
        private readonly ConcurrentDictionary<string, TaskCompletionSource<Call>> _calls = new();
        public bool RejectFirstPin { get; init; }
        public int PinAttempts;

        private TaskCompletionSource<Call> Slot(string reducer) =>
            _calls.GetOrAdd(reducer, _ => new(TaskCreationOptions.RunContinuationsAsynchronously));

        public Task<Call> WaitForAsync(string reducer) =>
            Slot(reducer).Task.WaitAsync(TimeSpan.FromSeconds(35));

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri?.AbsolutePath ?? string.Empty;
            var marker = path.LastIndexOf("/call/", StringComparison.Ordinal);
            if (marker >= 0)
            {
                if (path.EndsWith("/set_trusted_issuer", StringComparison.Ordinal)
                    && Interlocked.Increment(ref PinAttempts) == 1 && RejectFirstPin)
                {
                    return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
                }
                var body = request.Content is null
                    ? string.Empty
                    : await request.Content.ReadAsStringAsync(cancellationToken);
                Slot(path[(marker + "/call/".Length)..]).TrySetResult(
                    new Call(request.Headers.Authorization?.ToString() ?? string.Empty, body));
            }
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("[]", Encoding.UTF8, "application/json"),
            };
        }
    }
}

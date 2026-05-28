using CoreApi.Configuration;
using CoreApi.Models;
using CoreApi.Services;

namespace CoreApi.Tests;

/// <summary>
/// Verifies session-token issuance and validation: a freshly issued token
/// round-trips, and tampered / wrong-secret / malformed tokens are rejected.
/// </summary>
public sealed class TokenServiceTests
{
    private static ServiceOptions Options(string secret) => new()
    {
        ConnectionString = "Host=localhost;Database=test;Username=t;Password=t",
        Bind = "127.0.0.1:8787",
        AdminBind = "127.0.0.1:8788",
        JwtSecret = secret,
        MinioAccessKey = "x",
        MinioSecretKey = "x",
        MinioBucket = "b",
        MinioInternalEndpoint = "http://localhost:1",
        MinioPublicEndpoint = "http://localhost:1",
        LiveKitApiKey = "k",
        LiveKitApiSecret = "this-is-a-sufficiently-long-livekit-secret",
        DiscoverySpacetimeDbUri = "ws://x",
        DiscoveryAuthUrl = "http://x",
        DiscoveryLiveKitUrl = "ws://x",
        DiscoveryDatabase = "letschat",
        RequireEmailConfirmation = true,
        RequireAdminApproval = false,
        EmailSenderKind = "log",
        SmtpHost = "localhost",
        SmtpPort = 1025,
        SmtpUseStartTls = false,
        EmailFromAddress = "no-reply@test.local",
        EmailFromName = "Test",
        RateLimitPermitLimit = 10,
        RateLimitWindowSeconds = 300,
        BootstrapAdminEmail = "admin@test.local",
    };

    private const string Secret = "this-is-a-sufficiently-long-test-jwt-secret-value";

    [Fact]
    public void IssueSession_PopulatesTheClientContract()
    {
        var service = new TokenService(Options(Secret));

        var token = service.IssueSession("alice", ["Member"]);

        Assert.Equal("alice", token.user_id);
        Assert.NotEmpty(token.access_token);
        Assert.NotEmpty(token.refresh_token!);
        Assert.Equal("jwt", token.auth_method);
        Assert.Contains("chat:use", token.scopes);
        Assert.Contains("chat:voice", token.scopes);
        Assert.Contains("Member", token.roles);
    }

    [Fact]
    public async Task ValidateAsync_AcceptsAFreshlyIssuedToken()
    {
        var service = new TokenService(Options(Secret));
        var token = service.IssueSession("bob", []);

        var username = await service.ValidateAsync(token);

        Assert.Equal("bob", username);
    }

    [Fact]
    public async Task ValidateAsync_NormalisesTheUsername()
    {
        var service = new TokenService(Options(Secret));
        var token = service.IssueSession("MixedCase", []);

        Assert.Equal("mixedcase", await service.ValidateAsync(token));
    }

    [Fact]
    public async Task ValidateAsync_RejectsATokenSignedWithADifferentSecret()
    {
        var issuer = new TokenService(Options(Secret));
        var token = issuer.IssueSession("carol", []);

        var validator = new TokenService(Options("a-completely-different-secret-value-here"));

        Assert.Null(await validator.ValidateAsync(token));
    }

    [Fact]
    public async Task ValidateAsync_RejectsATamperedAccessToken()
    {
        var service = new TokenService(Options(Secret));
        var token = service.IssueSession("dave", []);
        token.access_token = token.access_token[..^4] + "AAAA";

        Assert.Null(await service.ValidateAsync(token));
    }

    [Fact]
    public async Task ValidateAsync_RejectsNullAndEmptyTokens()
    {
        var service = new TokenService(Options(Secret));

        Assert.Null(await service.ValidateAsync(null));
        Assert.Null(await service.ValidateAsync(new SessionToken()));
    }
}

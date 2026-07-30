using CoreApi.Configuration;
using CoreApi.Services;
using Microsoft.Extensions.Configuration;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// The identity derivation (blake3 port) and the mint → verify round-trip.
///
/// <para>
/// Correctness of the derivation against SpacetimeDB 2.5 was proven end-to-end
/// by minting a token here, connecting a raw client, and asserting
/// <c>ctx.sender</c> equalled this <c>ComputeIdentityHex</c> output. The frozen
/// vector below is a <b>regression guard</b> on that proven behaviour — if it
/// ever changes, every existing account silently re-hashes to a new identity.
/// </para>
/// </summary>
public sealed class SpacetimeTokenServiceTests
{
    private static SpacetimeTokenService Service(string issuer = "https://issuer.example", string module = "letschat")
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SPACETIME_OIDC_ISSUER"] = issuer,
            ["SPACETIMEDB_MODULE_NAME"] = module,
        }).Build();
        return new SpacetimeTokenService(ServiceOptions.FromConfiguration(config));
    }

    [Fact]
    public void ComputeIdentity_Is_Deterministic_And_Well_Formed()
    {
        var svc = Service();
        var a = svc.ComputeIdentityHex("account-1");
        var b = svc.ComputeIdentityHex("account-1");

        Assert.Equal(a, b);
        Assert.Equal(64, a.Length);                 // 32 bytes hex
        Assert.StartsWith("c200", a);               // SpacetimeDB identity prefix
        Assert.Matches("^[0-9a-f]{64}$", a);        // lower-case hex only
        Assert.NotEqual(a, svc.ComputeIdentityHex("account-2"));
    }

    [Fact]
    public void ComputeIdentity_Depends_On_Issuer()
    {
        // The issuer is baked into the hash — the same sub under a different
        // issuer must resolve to a different identity.
        Assert.NotEqual(
            Service("https://issuer.one").ComputeIdentityHex("sub"),
            Service("https://issuer.two").ComputeIdentityHex("sub"));
    }

    [Fact]
    public void ComputeIdentity_Matches_Frozen_Vector()
    {
        // Regression guard — freezing the proven-correct output for a fixed
        // (issuer, sub). Do NOT update this casually; a change orphans accounts.
        var svc = Service("https://issuer.example");
        Assert.Equal(
            "c2007c7caa404e1220f6c0e80b22af8edd4483722771cf1565238f741fa72fea",
            svc.ComputeIdentityHex("00000000-0000-0000-0000-000000000001"));
    }

    [Fact]
    public async Task Configured_Base64_Pem_Key_Is_Actually_Used()
    {
        // Production supplies the signing key base64-encoded, because a PEM is
        // multi-line and .env values are not. Two independent services given the
        // SAME key must accept each other's tokens — which they only can if the
        // configured key was loaded rather than a fresh random one generated.
        using var rsa = System.Security.Cryptography.RSA.Create(2048);
        var base64Pem = Convert.ToBase64String(
            System.Text.Encoding.UTF8.GetBytes(rsa.ExportPkcs8PrivateKeyPem()));

        var minted = KeyedService(base64Pem).Mint("shared-account");
        Assert.Equal("shared-account", await KeyedService(base64Pem).ValidateAndGetSubjectAsync(minted));

        // Sanity check on the assertion itself: a service with a *different* key
        // must reject that same token.
        using var other = System.Security.Cryptography.RSA.Create(2048);
        var otherKey = Convert.ToBase64String(
            System.Text.Encoding.UTF8.GetBytes(other.ExportPkcs8PrivateKeyPem()));
        Assert.Null(await KeyedService(otherKey).ValidateAndGetSubjectAsync(minted));
    }

    [Fact]
    public void Unusable_Key_Fails_Loudly_Rather_Than_Falling_Back()
    {
        // Silently generating a random key here would "work" until a restart
        // logged every user out, so a bad value must stop startup instead.
        var ex = Assert.Throws<InvalidOperationException>(() => KeyedService("not-a-key"));
        Assert.Contains("SPACETIME_OIDC_PRIVATE_KEY", ex.Message);
    }

    private static SpacetimeTokenService KeyedService(string key)
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["SPACETIME_OIDC_ISSUER"] = "https://issuer.example",
            ["SPACETIMEDB_MODULE_NAME"] = "letschat",
            ["SPACETIME_OIDC_PRIVATE_KEY"] = key,
        }).Build();
        return new SpacetimeTokenService(ServiceOptions.FromConfiguration(config));
    }

    [Fact]
    public async Task Mint_Then_Validate_RoundTrips_The_Subject()
    {
        var svc = Service();
        var token = svc.Mint("the-account-id");
        Assert.Equal("the-account-id", await svc.ValidateAndGetSubjectAsync(token));
    }

    [Fact]
    public async Task Validate_Rejects_Garbage_And_Foreign_Tokens()
    {
        var svc = Service();
        Assert.Null(await svc.ValidateAndGetSubjectAsync("not.a.jwt"));
        Assert.Null(await svc.ValidateAndGetSubjectAsync(""));

        // A token minted under a different issuer must not validate.
        var foreign = Service("https://someone-else.example").Mint("x");
        Assert.Null(await svc.ValidateAndGetSubjectAsync(foreign));
    }
}

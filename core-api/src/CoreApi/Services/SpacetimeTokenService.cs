using System.Security.Cryptography;
using System.Text;
using CoreApi.Configuration;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace CoreApi.Services;

/// <summary>
/// core-api as the OIDC issuer for SpacetimeDB. Owns the signing keypair, mints
/// the RS256 JWT the client presents to SpacetimeDB, and — crucially — computes
/// the SpacetimeDB <c>Identity</c> that JWT will resolve to, entirely
/// server-side.
///
/// <para>
/// The identity is a deterministic hash of <c>iss</c> + <c>sub</c>, so it is
/// wipe-proof: the same account (<c>sub = user.Id</c>) always maps to the same
/// identity regardless of how many times SpacetimeDB's data is reset. See the
/// identity-authority-inversion plan and https://spacetimedb.com/blog/who-are-you.
/// </para>
///
/// <para>
/// Trust is discovery-driven: SpacetimeDB reads the token's <c>iss</c>, fetches
/// <c>{iss}/.well-known/openid-configuration</c> → the JWKS → the public key, and
/// verifies the signature. So <see cref="Issuer"/> must be byte-identical between
/// the minted token and the URL SpacetimeDB fetches, and reachable
/// server-to-server from the SpacetimeDB process.
/// </para>
/// </summary>
public sealed class SpacetimeTokenService
{
    // A SpacetimeDB access token long enough to outlive many 1h session tokens,
    // so the app can renew its session (via RenewSession, which re-verifies this
    // token) without a full re-login. On expiry the user signs in again and a
    // fresh one is minted — the identity is unchanged, so nothing is lost.
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromDays(30);

    private readonly RSA _rsa;
    private readonly RsaSecurityKey _key;
    private readonly SigningCredentials _credentials;
    private readonly JsonWebTokenHandler _handler = new();

    public string Issuer { get; }
    public string Audience { get; }

    public SpacetimeTokenService(ServiceOptions options)
    {
        Issuer = options.SpacetimeOidcIssuer;
        Audience = options.SpacetimeModuleName;

        _rsa = RSA.Create(2048);
        if (!string.IsNullOrWhiteSpace(options.SpacetimeOidcPrivateKey))
        {
            // Accept either an inline PEM or a path to one.
            var pem = options.SpacetimeOidcPrivateKey.Contains("BEGIN", StringComparison.Ordinal)
                ? options.SpacetimeOidcPrivateKey
                : File.ReadAllText(options.SpacetimeOidcPrivateKey);
            _rsa.ImportFromPem(pem);
        }
        // else: dev — a freshly generated in-memory key. Identities are unaffected
        // (they hash iss+sub only, never the key), and JWKS is fetched live so
        // SpacetimeDB verifies against this process's public key.
        //
        // The trade-off, and why prod must set a key: tokens minted by a previous
        // process no longer verify after a restart, so clients holding a stored
        // SpacetimeDB token have to sign in again. Harmless in dev; in prod it
        // would log everyone out on every deploy (and break outright across
        // multiple instances), which is what FindInsecureDefaults enforces.

        _key = new RsaSecurityKey(_rsa);
        _key.KeyId = Base64UrlEncoder.Encode(_key.ComputeJwkThumbprint());
        _credentials = new SigningCredentials(_key, SecurityAlgorithms.RsaSha256);
    }

    /// <summary>Mints the RS256 JWT the client hands to SpacetimeDB.</summary>
    public string Mint(string subject)
    {
        var now = DateTime.UtcNow;
        return _handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            IssuedAt = now,
            NotBefore = now,
            Expires = now.Add(TokenLifetime),
            SigningCredentials = _credentials,
            Claims = new Dictionary<string, object> { ["sub"] = subject },
        });
    }

    /// <summary>
    /// Verifies a SpacetimeDB token this service minted (signature + lifetime +
    /// issuer) and returns its <c>sub</c> — the account's <c>user.Id</c>. Returns
    /// <c>null</c> for anything missing, malformed, expired or foreign-signed.
    /// A real cryptographic check: no database lookup involved.
    /// </summary>
    public async Task<string?> ValidateAndGetSubjectAsync(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        var result = await _handler.ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = Issuer,
            ValidateAudience = false,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = _key,
            ClockSkew = TimeSpan.FromSeconds(30),
        });

        if (!result.IsValid) return null;
        return result.Claims.TryGetValue("sub", out var sub) ? sub?.ToString() : null;
    }

    /// <summary>
    /// Computes the SpacetimeDB identity (lower-case hex) an <c>(iss, sub)</c>
    /// pair resolves to. Ported from SpacetimeDB 2.5's derivation:
    /// <code>
    /// idHash   = blake3(iss + "|" + sub)[..26]
    /// checksum = blake3([0xC2, 0x00] ++ idHash)[..4]
    /// identity = [0xC2, 0x00] ++ checksum ++ idHash   // 32 bytes
    /// </code>
    /// </summary>
    public string ComputeIdentityHex(string subject)
    {
        var input = Encoding.UTF8.GetBytes($"{Issuer}|{subject}");
        var idHash = Blake3.Hasher.Hash(input).AsSpan()[..26].ToArray();

        var checksumInput = new byte[2 + 26];
        checksumInput[0] = 0xC2;
        checksumInput[1] = 0x00;
        idHash.CopyTo(checksumInput, 2);
        var checksum = Blake3.Hasher.Hash(checksumInput).AsSpan()[..4].ToArray();

        var identity = new byte[32];
        identity[0] = 0xC2;
        identity[1] = 0x00;
        checksum.CopyTo(identity, 2);
        idHash.CopyTo(identity, 6);
        return Convert.ToHexStringLower(identity);
    }

    /// <summary>The OIDC discovery document SpacetimeDB fetches to learn the JWKS URL.</summary>
    public object OpenIdConfiguration() => new
    {
        issuer = Issuer,
        jwks_uri = $"{Issuer.TrimEnd('/')}/.well-known/jwks.json",
        response_types_supported = new[] { "id_token" },
        subject_types_supported = new[] { "public" },
        id_token_signing_alg_values_supported = new[] { "RS256" },
    };

    /// <summary>The public half of the signing key as a JWK set.</summary>
    public object Jwks()
    {
        var p = _rsa.ExportParameters(false);
        return new
        {
            keys = new[]
            {
                new
                {
                    kty = "RSA",
                    use = "sig",
                    alg = "RS256",
                    kid = _key.KeyId,
                    n = Base64UrlEncoder.Encode(p.Modulus),
                    e = Base64UrlEncoder.Encode(p.Exponent),
                },
            },
        };
    }
}

using CoreApi.Identity;

namespace CoreApi.Tests;

/// <summary>
/// Verifies the Argon2id PHC hasher — the data-migration crux. Round-trip and
/// edge-case coverage, plus a regression vector produced by the legacy Rust
/// <c>argon2</c> crate to prove cross-implementation compatibility.
/// </summary>
public sealed class Argon2PhcTests
{
    [Fact]
    public void Hash_ProducesArgon2idPhcString()
    {
        var hash = Argon2Phc.Hash("correct horse battery staple");

        Assert.StartsWith("$argon2id$v=19$", hash);
        Assert.Equal(6, hash.Split('$').Length);
    }

    [Fact]
    public void Verify_AcceptsCorrectPassword()
    {
        const string password = "s3cret-passw0rd";
        var hash = Argon2Phc.Hash(password);

        Assert.True(Argon2Phc.Verify(hash, password));
    }

    [Fact]
    public void Verify_RejectsWrongPassword()
    {
        var hash = Argon2Phc.Hash("the-right-one");

        Assert.False(Argon2Phc.Verify(hash, "the-wrong-one"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not-a-phc-string")]
    [InlineData("$argon2id$v=19$m=19456,t=2,p=1$onlyfourparts")]
    [InlineData("$pbkdf2$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA")]
    public void Verify_RejectsMalformedHashes(string malformed)
    {
        Assert.False(Argon2Phc.Verify(malformed, "anything"));
    }

    [Fact]
    public void Verify_RejectsTamperedHash()
    {
        var hash = Argon2Phc.Hash("original");
        var tampered = hash[..^4] + (hash[^4] == 'A' ? "BBBB" : "AAAA");

        Assert.False(Argon2Phc.Verify(tampered, "original"));
    }

    [Fact]
    public void Verify_AcceptsHashFromLegacyRustService()
    {
        // Captured from the legacy Rust auth-service: this is the exact
        // `password_hash` the `argon2` crate wrote for the password below.
        // Verifying it under Konscious proves migrated hashes work unchanged —
        // the cross-implementation guarantee the data migration relies on.
        const string legacyHash =
            "$argon2id$v=19$m=19456,t=2,p=1$cBz6SMPumcB9OBZqP/bzZQ$M7Eb8Y6ceqc5WcQiwSqfRp6e+Z3wO+M1y0Kn+AChGFM";
        const string legacyPassword = "MigratePass123";

        Assert.True(Argon2Phc.Verify(legacyHash, legacyPassword));
        Assert.False(Argon2Phc.Verify(legacyHash, "WrongPassword999"));
    }
}

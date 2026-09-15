using CoreApi.Data;
using CoreApi.Identity;
using Microsoft.AspNetCore.Identity;

namespace CoreApi.Tests;

/// <summary>
/// The hasher is the one place every password hash and check passes through,
/// so the length ceiling has to hold there regardless of which caller forgot
/// it (BUG_ANALYSIS A7).
/// </summary>
public sealed class Argon2PasswordHasherTests
{
    private static readonly ApplicationUser User = new() { UserName = "u" };

    [Fact]
    public void Verify_RefusesAnOversizedPasswordWithoutHashing()
    {
        var hasher = new Argon2PasswordHasher();
        var stored = hasher.HashPassword(User, "a real password");

        // Not a hash comparison: a valid PHC string against garbage input would
        // also fail, so pin it on the other side — garbage stored, oversized
        // provided, still a clean Failed rather than a parse error from Argon2.
        var result = hasher.VerifyHashedPassword(
            User, "not-even-a-hash", new string('x', Validation.MaxPasswordLength + 1));
        Assert.Equal(PasswordVerificationResult.Failed, result);

        Assert.Equal(PasswordVerificationResult.Failed, hasher.VerifyHashedPassword(
            User, stored, new string('x', Validation.MaxPasswordLength + 1)));
        Assert.Equal(PasswordVerificationResult.Success, hasher.VerifyHashedPassword(
            User, stored, "a real password"));
    }

    [Fact]
    public void Hash_RefusesAnOversizedPassword()
    {
        var hasher = new Argon2PasswordHasher();

        Assert.Throws<ArgumentException>(() =>
            hasher.HashPassword(User, new string('x', Validation.MaxPasswordLength + 1)));
        Assert.StartsWith("$argon2id$", hasher.HashPassword(User, new string('x', Validation.MaxPasswordLength)));
    }
}

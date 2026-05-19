using CoreApi.Data;
using Microsoft.AspNetCore.Identity;

namespace CoreApi.Identity;

/// <summary>
/// Plugs <see cref="Argon2Phc"/> into ASP.NET Core Identity in place of the
/// stock PBKDF2 <see cref="PasswordHasher{TUser}"/>. Registered after
/// <c>AddIdentity</c> so it wins the DI resolution.
/// </summary>
public sealed class Argon2PasswordHasher : IPasswordHasher<ApplicationUser>
{
    public string HashPassword(ApplicationUser user, string password) =>
        Argon2Phc.Hash(password);

    public PasswordVerificationResult VerifyHashedPassword(
        ApplicationUser user, string hashedPassword, string providedPassword) =>
        Argon2Phc.Verify(hashedPassword, providedPassword)
            ? PasswordVerificationResult.Success
            : PasswordVerificationResult.Failed;
}

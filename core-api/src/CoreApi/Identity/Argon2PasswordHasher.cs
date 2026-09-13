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
    // The length ceiling is enforced where passwords come in
    // (Validation.ValidatePassword, the admin form). It is repeated here because
    // this is the one place every hash and every verify goes through, and Argon2
    // is the expensive step a too-long input is meant to reach (BUG_ANALYSIS A7).
    public string HashPassword(ApplicationUser user, string password)
    {
        if (password.Length > Validation.MaxPasswordLength)
        {
            throw new ArgumentException(
                $"Password exceeds {Validation.MaxPasswordLength} characters.", nameof(password));
        }
        return Argon2Phc.Hash(password);
    }

    public PasswordVerificationResult VerifyHashedPassword(
        ApplicationUser user, string hashedPassword, string providedPassword)
    {
        // No stored password can be this long, so the answer is known without
        // hashing — and hashing is exactly what the attacker is after.
        if (providedPassword.Length > Validation.MaxPasswordLength)
        {
            return PasswordVerificationResult.Failed;
        }
        return Argon2Phc.Verify(hashedPassword, providedPassword)
            ? PasswordVerificationResult.Success
            : PasswordVerificationResult.Failed;
    }
}

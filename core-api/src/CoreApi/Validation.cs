namespace CoreApi;

/// <summary>
/// Input validation and normalisation, ported from the legacy
/// <c>security.rs</c> so the rules the client already satisfies are unchanged.
/// </summary>
public static class Validation
{
    public static string NormalizeUsername(string username) =>
        username.Trim().ToLowerInvariant();

    public static string NormalizeIdentity(string identity) =>
        identity.Trim().ToLowerInvariant();

    /// <summary>
    /// The username grammar, as a predicate. Also what makes a username safe to
    /// splice into a storage key path segment or a SpacetimeDB SQL literal.
    /// </summary>
    public static bool IsUsername(string username) =>
        username.Length is >= 2 and <= 32
        && username.All(c => char.IsAsciiLetterOrDigit(c) || c == '_');

    /// <summary>Throws <see cref="ApiException"/> (400) if the username is invalid.</summary>
    public static void ValidateUsername(string username)
    {
        if (!IsUsername(username))
        {
            throw ApiException.BadRequest(
                "Username must be 2-32 characters using [a-z0-9_] only.");
        }
    }

    /// <summary>
    /// Longest password accepted anywhere. Argon2id hashes whatever it is
    /// given, so without a ceiling a handful of multi-megabyte "passwords" pin
    /// the CPU and memory of the process (BUG_ANALYSIS A7). 128 is far past any
    /// real passphrase and still nothing to hash.
    /// </summary>
    public const int MaxPasswordLength = 128;

    /// <summary>Throws <see cref="ApiException"/> (400) if the password is too short or too long.</summary>
    public static void ValidatePassword(string password)
    {
        if (password.Length < 8)
        {
            throw ApiException.BadRequest("Password must be at least 8 characters.");
        }

        if (password.Length > MaxPasswordLength)
        {
            throw ApiException.BadRequest($"Password must be at most {MaxPasswordLength} characters.");
        }
    }

    /// <summary>Validates and normalises an email address; throws 400 if invalid.</summary>
    public static string NormalizeEmail(string? email)
    {
        var trimmed = email?.Trim() ?? string.Empty;
        if (trimmed.Length == 0 || !System.Net.Mail.MailAddress.TryCreate(trimmed, out _))
        {
            throw ApiException.BadRequest("A valid email address is required.");
        }

        return trimmed.ToLowerInvariant();
    }

    /// <summary>
    /// Returns the trimmed value or throws 400 with a field-named message. Also
    /// caps the length — a display name or room key has no business being a
    /// paragraph, and an unbounded string would otherwise go straight to the
    /// database.
    /// </summary>
    public static string Required(string? value, string fieldMessage, int maxLength = 256)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
        {
            throw ApiException.BadRequest(fieldMessage);
        }

        if (trimmed.Length > maxLength)
        {
            throw ApiException.BadRequest($"Value must be at most {maxLength} characters.");
        }

        return trimmed;
    }
}

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

    /// <summary>Throws <see cref="ApiException"/> (400) if the username is invalid.</summary>
    public static void ValidateUsername(string username)
    {
        var validLength = username.Length is >= 2 and <= 32;
        var validChars = username.All(c => char.IsAsciiLetterOrDigit(c) || c == '_');
        if (!validLength || !validChars)
        {
            throw ApiException.BadRequest(
                "Username must be 2-32 characters using [a-z0-9_] only.");
        }
    }

    /// <summary>Throws <see cref="ApiException"/> (400) if the password is too short.</summary>
    public static void ValidatePassword(string password)
    {
        if (password.Length < 8)
        {
            throw ApiException.BadRequest("Password must be at least 8 characters.");
        }
    }

    /// <summary>Returns the trimmed value or throws 400 with a field-named message.</summary>
    public static string Required(string? value, string fieldMessage)
    {
        var trimmed = value?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
        {
            throw ApiException.BadRequest(fieldMessage);
        }

        return trimmed;
    }
}

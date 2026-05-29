using System.Security.Cryptography;
using System.Text;
using Konscious.Security.Cryptography;

namespace CoreApi.Identity;

/// <summary>
/// Hashes and verifies passwords in the PHC <c>$argon2id$…</c> string format.
///
/// <para>
/// This is the crux of the data migration: the legacy Rust service hashed
/// passwords with the <c>argon2</c> crate (Argon2id, PHC-encoded). Identity's
/// stock <c>PasswordHasher</c> only understands its own PBKDF2 format, so
/// migrated users would be unable to sign in. Keeping Argon2id as the one
/// format for both legacy and freshly created accounts means every migrated
/// hash verifies as-is and no rehash dance is needed.
/// </para>
/// </summary>
public static class Argon2Phc
{
    // OWASP-recommended Argon2id parameters; also the defaults the Rust
    // `argon2` 0.5 crate produced, so legacy and new hashes are consistent.
    private const int MemoryKib = 19_456;
    private const int Iterations = 2;
    private const int Parallelism = 1;
    private const int SaltLength = 16;
    private const int HashLength = 32;
    private const int Argon2Version = 19;

    /// <summary>Produces a fresh <c>$argon2id$</c> PHC string for the password.</summary>
    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltLength);
        var hash = Derive(password, salt, MemoryKib, Iterations, Parallelism, HashLength);

        return string.Create(
            System.Globalization.CultureInfo.InvariantCulture,
            $"$argon2id$v={Argon2Version}$m={MemoryKib},t={Iterations},p={Parallelism}$" +
            $"{B64Encode(salt)}${B64Encode(hash)}");
    }

    /// <summary>
    /// Constant-time verification of <paramref name="password"/> against a
    /// PHC-encoded Argon2id hash. Returns false (rather than throwing) for any
    /// malformed or non-Argon2id input.
    /// </summary>
    public static bool Verify(string phc, string password)
    {
        if (string.IsNullOrEmpty(phc))
        {
            return false;
        }

        // $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
        var parts = phc.Split('$');
        if (parts.Length != 6 || parts[0].Length != 0)
        {
            return false;
        }

        if (!parts[1].Equals("argon2id", StringComparison.Ordinal))
        {
            return false;
        }

        if (!TryParseParameters(parts[3], out var memory, out var iterations, out var parallelism))
        {
            return false;
        }

        byte[] salt;
        byte[] expected;
        try
        {
            salt = B64Decode(parts[4]);
            expected = B64Decode(parts[5]);
        }
        catch (FormatException)
        {
            return false;
        }

        if (salt.Length == 0 || expected.Length == 0)
        {
            return false;
        }

        var actual = Derive(password, salt, memory, iterations, parallelism, expected.Length);
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }

    private static byte[] Derive(
        string password, byte[] salt, int memoryKib, int iterations, int parallelism, int length)
    {
        using var argon2 = new Argon2id(Encoding.UTF8.GetBytes(password))
        {
            Salt = salt,
            MemorySize = memoryKib,
            Iterations = iterations,
            DegreeOfParallelism = parallelism,
        };
        return argon2.GetBytes(length);
    }

    private static bool TryParseParameters(
        string segment, out int memory, out int iterations, out int parallelism)
    {
        memory = iterations = parallelism = 0;
        foreach (var pair in segment.Split(','))
        {
            var kv = pair.Split('=');
            if (kv.Length != 2 || !int.TryParse(kv[1], out var value))
            {
                return false;
            }

            switch (kv[0])
            {
                case "m": memory = value; break;
                case "t": iterations = value; break;
                case "p": parallelism = value; break;
                default: return false;
            }
        }

        return memory > 0 && iterations > 0 && parallelism > 0;
    }

    // PHC base64: standard alphabet, no padding.
    private static string B64Encode(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=');

    private static byte[] B64Decode(string value)
    {
        var padded = (value.Length % 4) switch
        {
            2 => value + "==",
            3 => value + "=",
            0 => value,
            _ => throw new FormatException("Invalid base64 length."),
        };
        return Convert.FromBase64String(padded);
    }
}

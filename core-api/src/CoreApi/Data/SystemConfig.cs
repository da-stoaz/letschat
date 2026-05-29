namespace CoreApi.Data;

/// <summary>
/// Server-wide configuration, editable from the admin control panel — a single
/// row (<see cref="SingletonId"/>). Settings that an operator tunes at runtime
/// live here; immutable infrastructure config (DB connection, JWT secret,
/// bind addresses) stays in environment variables / <c>ServiceOptions</c>.
///
/// <para>
/// On first run the row is seeded from <c>ServiceOptions</c> so the values an
/// operator already set via environment carry over.
/// </para>
/// </summary>
public sealed class SystemConfig
{
    /// <summary>Fixed primary key — there is only ever one row.</summary>
    public const int SingletonId = 1;

    public int Id { get; set; } = SingletonId;

    // ── Registration ─────────────────────────────────────────────────────────

    /// <summary>When false, new self-registration is refused outright.</summary>
    public bool RegistrationOpen { get; set; } = true;

    /// <summary>Require email confirmation before an account can sign in.</summary>
    public bool RequireEmailConfirmation { get; set; } = true;

    /// <summary>Require admin approval after email confirmation.</summary>
    public bool RequireAdminApproval { get; set; }

    // ── Rate limiting ────────────────────────────────────────────────────────

    public int RateLimitPermitLimit { get; set; } = 10;
    public int RateLimitWindowSeconds { get; set; } = 300;

    // ── Email / SMTP ─────────────────────────────────────────────────────────

    public string SmtpHost { get; set; } = "localhost";
    public int SmtpPort { get; set; } = 1025;
    public string? SmtpUser { get; set; }
    public string? SmtpPassword { get; set; }
    public bool SmtpUseStartTls { get; set; }
    public string EmailFromAddress { get; set; } = "no-reply@letschat.local";
    public string EmailFromName { get; set; } = "LetsChat";

    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

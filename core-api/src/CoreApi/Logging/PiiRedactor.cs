namespace CoreApi.Logging;

/// <summary>
/// Masks personally-identifiable values before they are written to logs, so log
/// output can't expose private data (CWE-359, "exposure of private
/// information"). Always log the masked result — never the original value
/// alongside it.
/// </summary>
public static class PiiRedactor
{
    /// <summary>
    /// Masks an email address for safe logging, e.g. <c>john@gmail.com</c> →
    /// <c>j***@g***.com</c>. Only the first character of the local part and of
    /// the domain label is kept (the top-level domain is preserved to help with
    /// delivery debugging); everything else is redacted. Returns
    /// <c>(no address)</c> for null/empty input and <c>***</c> for anything that
    /// isn't shaped like an address.
    /// </summary>
    public static string MaskEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
        {
            return "(no address)";
        }

        var at = email.IndexOf('@');
        if (at <= 0 || at == email.Length - 1)
        {
            return "***";
        }

        var local = MaskLabel(email[..at]);
        var domain = email[(at + 1)..];
        var lastDot = domain.LastIndexOf('.');
        var maskedDomain = lastDot <= 0
            ? MaskLabel(domain)
            : $"{MaskLabel(domain[..lastDot])}{domain[lastDot..]}";

        return $"{local}@{maskedDomain}";
    }

    /// <summary>Keeps the first character of a label and redacts the rest.</summary>
    private static string MaskLabel(string value) =>
        value.Length == 0 ? "*" : $"{value[0]}***";
}

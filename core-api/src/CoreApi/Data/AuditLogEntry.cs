namespace CoreApi.Data;

/// <summary>
/// An immutable record of an administrative action — approvals, rejections,
/// account changes, config edits. Written by <c>AuditService</c> and shown in
/// the control panel's audit-log page.
/// </summary>
public sealed class AuditLogEntry
{
    public long Id { get; set; }

    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    /// <summary>Who performed the action — an admin username, or an API-key label.</summary>
    public string Actor { get; set; } = string.Empty;

    /// <summary>Dotted action name, e.g. <c>user.approve</c>, <c>config.update</c>.</summary>
    public string Action { get; set; } = string.Empty;

    /// <summary>Kind of entity acted on, e.g. <c>user</c>, <c>config</c>.</summary>
    public string TargetType { get; set; } = string.Empty;

    /// <summary>Identifier of the target (a user id / username), if applicable.</summary>
    public string? TargetId { get; set; }

    /// <summary>Free-text detail — what changed.</summary>
    public string? Detail { get; set; }
}

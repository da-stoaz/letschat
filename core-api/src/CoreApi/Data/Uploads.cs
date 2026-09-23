namespace CoreApi.Data;

/// <summary>
/// A presigned upload that has been handed out but not yet confirmed.
/// Mirrors the legacy <c>pending_uploads</c> table; rows are short-lived
/// (15 min TTL) and swept on startup.
/// </summary>
public sealed class PendingUpload
{
    public string Id { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string StorageKey { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public string MimeType { get; set; } = string.Empty;

    /// <summary>UTC day whose quota this upload reserves until confirmation or cleanup.</summary>
    public string QuotaDate { get; set; } = string.Empty;

    /// <summary>Unix epoch seconds after which the pending record is invalid.</summary>
    public long ExpiresAt { get; set; }

    /// <summary>Null for legacy single PUT; set after MinIO initiates multipart.</summary>
    public string? MultipartUploadId { get; set; }

    /// <summary>Frozen at request time so admin edits do not alter an in-flight session.</summary>
    public long PartSize { get; set; }
}

/// <summary>
/// Per-user, per-day uploaded-byte counter. Mirrors the legacy
/// <c>upload_quota</c> table; the composite key is (Username, QuotaDate).
/// </summary>
public sealed class UploadQuota
{
    public string Username { get; set; } = string.Empty;

    /// <summary>Calendar day in <c>yyyy-MM-dd</c> (UTC).</summary>
    public string QuotaDate { get; set; } = string.Empty;

    public long BytesUploaded { get; set; }
}

/// <summary>
/// A verified MinIO object. Rows survive confirmation so every object remains
/// known until the chat domain references it or the lifecycle collector has
/// successfully removed it from storage.
/// </summary>
public sealed class ConfirmedUpload
{
    /// <summary>Allows an interrupted /confirm response to be retried idempotently.</summary>
    public string? UploadId { get; set; }
    public string StorageKey { get; set; } = string.Empty;
    public string Username { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public long FileSize { get; set; }
    public string MimeType { get; set; } = string.Empty;
    public long ConfirmedAt { get; set; }
    /// <summary>Poster-frame job for videos; see <c>VideoThumbnailWorker</c>.</summary>
    public ThumbnailState ThumbnailState { get; set; }
    public int ThumbnailAttempts { get; set; }
}

public enum ThumbnailState
{
    None = 0,
    Pending = 1,
    Done = 2,
    Failed = 3,
}

namespace CoreApi.Models;

// ── Request / response DTOs ──────────────────────────────────────────────────
//
// Property names are PascalCase; the camelCase JSON policy maps them to the
// camelCase wire format the desktop client already sends and expects. These
// shapes mirror the legacy Rust handlers exactly.

public sealed record RegisterRequest(
    string Username,
    string DisplayName,
    string Password,
    string SpacetimeToken,
    string SpacetimeIdentity);

public sealed record LinkRequest(
    string Username,
    string DisplayName,
    string Password,
    string SpacetimeToken,
    string SpacetimeIdentity);

public sealed record LoginRequest(string Username, string Password);

public sealed record VerifyRequest(SessionToken SessionToken);

public sealed record RenewSessionRequest(string SpacetimeToken, string SpacetimeIdentity);

public sealed record RefreshSpacetimeTokenRequest(SessionToken SessionToken, string SpacetimeToken);

public sealed record AuthResponse(
    string Username,
    string DisplayName,
    string SpacetimeToken,
    string SpacetimeIdentity,
    SessionToken SessionToken);

public sealed record VerifyResponse(bool Valid);

public sealed record RenewSessionResponse(SessionToken SessionToken);

// ── LiveKit ──────────────────────────────────────────────────────────────────

public sealed record LivekitTokenRequest(string Room, string Identity, SessionToken SessionToken);

public sealed record LivekitTokenResponse(string Token);

// ── Admin ────────────────────────────────────────────────────────────────────

public sealed record AdminRebindAccountRequest(
    string AdminApiKey,
    string Username,
    string SpacetimeIdentity,
    string? SpacetimeToken,
    string? DisplayName);

public sealed record AdminRebindAccountResponse(string Username, string SpacetimeIdentity);

// ── Uploads ──────────────────────────────────────────────────────────────────

public sealed record UploadRequestPayload(
    SessionToken SessionToken,
    string FileName,
    long FileSize,
    string MimeType);

public sealed record UploadRequestResponse(string UploadId, string UploadUrl, int ExpiresIn);

public sealed record UploadConfirmPayload(SessionToken SessionToken, string UploadId);

public sealed record UploadConfirmResponse(
    string StorageKey,
    string FileName,
    long FileSize,
    string MimeType);

public sealed record DownloadUrlPayload(SessionToken SessionToken, string StorageKey);

public sealed record DownloadUrlsPayload(SessionToken SessionToken, List<string> StorageKeys);

public sealed record DownloadUrlResponse(string Url, int ExpiresIn);

public sealed record DownloadUrlItem(string StorageKey, string Url, int ExpiresIn);

public sealed record DownloadUrlsResponse(List<DownloadUrlItem> Items);

// ── Discovery ────────────────────────────────────────────────────────────────

// Single-word PascalCase members so the camelCase policy yields the exact
// lowercase keys the client's discovery parser requires
// (spacetimedb / auth / livekit / database).
public sealed record WellKnownResponse(
    string Spacetimedb,
    string Auth,
    string Livekit,
    string Database);

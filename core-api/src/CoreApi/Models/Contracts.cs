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
    string SpacetimeIdentity,
    string? Email = null);

/// <summary>
/// Register result. <c>Status</c> is <c>"active"</c> (account usable now,
/// <c>Auth</c> populated) or <c>"pending_email_verification"</c> (a
/// confirmation email was sent to <c>Email</c>, <c>Auth</c> is null).
/// </summary>
public sealed record RegisterResponse(string Status, AuthResponse? Auth, string? Email);

/// <summary>
/// Re-send the confirmation email. Identify the account by <c>Email</c> (the
/// post-registration screen) or <c>Username</c> (the blocked-login screen, which
/// only knows the username the user typed). Answered generically either way.
/// </summary>
public sealed record ResendConfirmationRequest(string? Email = null, string? Username = null);

/// <summary>
/// Kicks off the password-reset flow. Always answered generically so the
/// endpoint can't be used to probe which addresses have accounts.
/// </summary>
public sealed record ForgotPasswordRequest(string Email);

/// <summary>
/// Polled by the client's "confirm your email" screen to detect when the
/// account has advanced. The SpacetimeDB identity must match the account's
/// binding — this prevents username enumeration via the endpoint.
/// </summary>
public sealed record RegistrationStatusRequest(string Username, string SpacetimeIdentity);

public sealed record RegistrationStatusResponse(string Status);

public sealed record LinkRequest(
    string Username,
    string DisplayName,
    string Password,
    string SpacetimeToken,
    string SpacetimeIdentity,
    string? Email = null);

/// <summary>
/// Login payload. <c>SpacetimeIdentity</c> and <c>SpacetimeToken</c> are optional
/// — when the stored account still carries an <c>admin-created</c> placeholder
/// identity (see <c>CreateUser</c> in the admin panel), the login endpoint
/// swaps in the real values from the client transparently on first sign-in.
/// For normal accounts these are ignored.
/// </summary>
public sealed record LoginRequest(
    string Username,
    string Password,
    string? SpacetimeIdentity = null,
    string? SpacetimeToken = null);

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

/// <summary>An account awaiting admin approval (status <c>EmailVerified</c>).</summary>
public sealed record PendingUserDto(
    string Id,
    string Username,
    string DisplayName,
    string? Email,
    string CreatedAtUtc);

public sealed record PendingUsersResponse(List<PendingUserDto> Users);

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
// (spacetimedb / auth / livekit / database). The version triple uses
// camelCase keys (serverVersion / recommendedClient / minClient) so the
// landing page and future client-side update gating can read them.
public sealed record WellKnownResponse(
    string Spacetimedb,
    string Auth,
    string Livekit,
    string Database,
    string ServerVersion,
    string RecommendedClient,
    string MinClient);

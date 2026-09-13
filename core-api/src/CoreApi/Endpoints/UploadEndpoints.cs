using System.Globalization;
using System.Text.Json;
using CoreApi.Data;
using CoreApi.Models;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Endpoints;

/// <summary>
/// <c>/uploads/*</c> — presigned-URL upload/download flow against MinIO.
/// Ports <c>uploads.rs</c>: request a presigned PUT, confirm the object
/// landed, and mint short-lived presigned GET URLs.
/// </summary>
public static class UploadEndpoints
{
    private const long MaxFileSize = 500L * 1024 * 1024;       // 500 MB
    private const long DailyQuota = 2L * 1024 * 1024 * 1024;   // 2 GB / user / day
    private const int PresignUploadSeconds = 600;              // 10 min to PUT
    private const int PresignDownloadSeconds = 3600;           // 1 h GET lifetime
    private const long PendingUploadTtlSeconds = 900;          // 15 min to /confirm
    private const int MaxBatchKeys = 128;

    private static readonly string[] BlockedMimePrefixes =
    [
        "application/x-msdownload",
        "application/x-executable",
        "application/x-sh",
        "application/x-bat",
        "application/x-msdos-program",
        "application/x-dosexec",
    ];

    public static void MapUploadEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/uploads/request", RequestUpload);
        routes.MapPost("/uploads/confirm", ConfirmUpload);
        routes.MapPost("/uploads/download-url", DownloadUrl);
        routes.MapPost("/uploads/download-urls", DownloadUrls);
    }

    private static async Task<UploadRequestResponse> RequestUpload(
        UploadRequestPayload payload,
        TokenService tokens,
        UserManager<ApplicationUser> users,
        AppDbContext db,
        StorageService storage)
    {
        var username = await RequireSession(payload.SessionToken, tokens, users);

        var fileName = payload.FileName.Trim();
        if (fileName.Length == 0)
        {
            throw ApiException.BadRequest("file_name is required.");
        }

        if (fileName.Contains("..") || fileName.Contains('/') || fileName.Contains('\\'))
        {
            throw ApiException.BadRequest("file_name contains invalid characters.");
        }

        if (payload.FileSize <= 0)
        {
            throw ApiException.BadRequest("file_size must be greater than 0.");
        }

        if (payload.FileSize > MaxFileSize)
        {
            throw ApiException.BadRequest(
                $"File exceeds the maximum allowed size of {MaxFileSize / 1024 / 1024} MB.");
        }

        var mimeType = payload.MimeType.Trim().ToLowerInvariant();
        if (mimeType.Length == 0)
        {
            throw ApiException.BadRequest("mime_type is required.");
        }

        if (BlockedMimePrefixes.Any(prefix => mimeType.StartsWith(prefix, StringComparison.Ordinal)))
        {
            throw ApiException.BadRequest("This file type is not allowed.");
        }

        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var usedToday = await db.UploadQuotas
            .Where(q => q.Username == username && q.QuotaDate == today)
            .Select(q => (long?)q.BytesUploaded)
            .FirstOrDefaultAsync() ?? 0;

        if (usedToday + payload.FileSize > DailyQuota)
        {
            throw ApiException.BadRequest(
                $"Daily upload quota of {DailyQuota / 1024 / 1024 / 1024} GB exceeded.");
        }

        var uploadId = Guid.NewGuid().ToString();
        var extension = Path.GetExtension(fileName).TrimStart('.');
        // The key is the access rule (StorageKey): whoever may read this object
        // later is decided from the scope baked in here.
        var storageKey = StorageKey.Build(
            payload.Scope, username, extension.Length == 0 ? uploadId : $"{uploadId}.{extension}");

        var uploadUrl = await storage.PresignPutAsync(storageKey, payload.FileSize, PresignUploadSeconds);

        db.PendingUploads.Add(new PendingUpload
        {
            Id = uploadId,
            Username = username,
            StorageKey = storageKey,
            FileName = fileName,
            FileSize = payload.FileSize,
            MimeType = mimeType,
            ExpiresAt = UnixNow() + PendingUploadTtlSeconds,
        });
        await db.SaveChangesAsync();

        return new UploadRequestResponse(uploadId, uploadUrl, PresignUploadSeconds);
    }

    private static async Task<UploadConfirmResponse> ConfirmUpload(
        UploadConfirmPayload payload,
        TokenService tokens,
        UserManager<ApplicationUser> users,
        AppDbContext db,
        StorageService storage)
    {
        var username = await RequireSession(payload.SessionToken, tokens, users);

        var pending = await db.PendingUploads.FirstOrDefaultAsync(p => p.Id == payload.UploadId)
            ?? throw ApiException.BadRequest("Upload ID not found or already confirmed.");

        if (!string.Equals(pending.Username, username, StringComparison.Ordinal))
        {
            throw ApiException.Unauthorized("Upload does not belong to this session.");
        }

        if (pending.ExpiresAt < UnixNow())
        {
            db.PendingUploads.Remove(pending);
            await db.SaveChangesAsync();
            throw ApiException.BadRequest("Upload session expired. Please start over.");
        }

        var actualSize = await storage.GetObjectSizeAsync(pending.StorageKey)
            ?? throw ApiException.BadRequest(
                "File has not been uploaded yet — complete the PUT request first.");

        // Everything below is enforced against the size MinIO reports, not the
        // one the client declared (BUG_ANALYSIS A5). The presigned PUT now signs
        // Content-Length, so a mismatch should never reach here — this is the
        // second line for a storage backend that does not verify signed headers.
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var quota = await db.UploadQuotas
            .FirstOrDefaultAsync(q => q.Username == username && q.QuotaDate == today);
        var usedToday = quota?.BytesUploaded ?? 0;

        string? rejection = null;
        if (actualSize > MaxFileSize)
        {
            rejection = $"File exceeds the maximum allowed size of {MaxFileSize / 1024 / 1024} MB.";
        }
        else if (usedToday + actualSize > DailyQuota)
        {
            rejection = $"Daily upload quota of {DailyQuota / 1024 / 1024 / 1024} GB exceeded.";
        }

        if (rejection is not null)
        {
            // A rejected object must not stay behind — that is exactly the
            // storage-fill this check exists to prevent.
            await storage.DeleteObjectAsync(pending.StorageKey);
            db.PendingUploads.Remove(pending);
            await db.SaveChangesAsync();
            throw ApiException.BadRequest(rejection);
        }

        if (quota is null)
        {
            db.UploadQuotas.Add(new UploadQuota
            {
                Username = username,
                QuotaDate = today,
                BytesUploaded = actualSize,
            });
        }
        else
        {
            quota.BytesUploaded += actualSize;
        }

        db.PendingUploads.Remove(pending);
        await db.SaveChangesAsync();

        return new UploadConfirmResponse(
            pending.StorageKey, pending.FileName, actualSize, pending.MimeType);
    }

    private static async Task<DownloadUrlResponse> DownloadUrl(
        DownloadUrlPayload payload,
        TokenService tokens,
        UserManager<ApplicationUser> users,
        StorageService storage,
        SpacetimeClient spacetime,
        CancellationToken ct)
    {
        var caller = await RequireAccount(payload.SessionToken, tokens, users);

        var key = StorageKey.TryParse(payload.StorageKey)
            ?? throw ApiException.BadRequest("Invalid storage key.");
        if (!await MayReadAsync(caller, payload.StorageKey, key, spacetime, users, new(), ct))
        {
            throw ApiException.Forbidden("You do not have access to this file.");
        }

        var url = await storage.PresignGetAsync(payload.StorageKey, PresignDownloadSeconds);
        return new DownloadUrlResponse(url, PresignDownloadSeconds);
    }

    /// <summary>
    /// Batch form. Keys the caller may not read are left out of the response
    /// rather than failing the whole batch — the client falls back to the
    /// single endpoint for anything missing and gets the 403 there, so one bad
    /// key does not blank every attachment on screen.
    /// </summary>
    private static async Task<DownloadUrlsResponse> DownloadUrls(
        DownloadUrlsPayload payload,
        TokenService tokens,
        UserManager<ApplicationUser> users,
        StorageService storage,
        SpacetimeClient spacetime,
        CancellationToken ct)
    {
        var caller = await RequireAccount(payload.SessionToken, tokens, users);

        if (payload.StorageKeys is null || payload.StorageKeys.Count == 0)
        {
            throw ApiException.BadRequest("storageKeys must not be empty.");
        }

        if (payload.StorageKeys.Count > MaxBatchKeys)
        {
            throw ApiException.BadRequest("Too many storage keys requested at once.");
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var memo = new Dictionary<string, bool>(StringComparer.Ordinal);
        var items = new List<DownloadUrlItem>(payload.StorageKeys.Count);
        foreach (var rawKey in payload.StorageKeys)
        {
            var key = StorageKey.TryParse(rawKey)
                ?? throw ApiException.BadRequest("Invalid storage key.");

            if (!seen.Add(rawKey))
            {
                continue;
            }

            if (!await MayReadAsync(caller, rawKey, key, spacetime, users, memo, ct))
            {
                continue;
            }

            var url = await storage.PresignGetAsync(rawKey, PresignDownloadSeconds);
            items.Add(new DownloadUrlItem(rawKey, url, PresignDownloadSeconds));
        }

        return new DownloadUrlsResponse(items);
    }

    /// <summary>
    /// Whether <paramref name="caller"/> may read the object behind
    /// <paramref name="key"/> (BUG_ANALYSIS A6). Every rule is answered from the
    /// key's scope plus what the caller's own <c>my_*</c> views show them, so a
    /// kick, ban or leave takes effect on the next request: the module stops
    /// returning the channel or space, and with it the files posted there.
    /// </summary>
    /// <param name="memo">
    /// Per-request cache keyed by scope (<c>ch:5</c>, <c>srv:3</c>, …) so a
    /// batch of twenty images from one channel is one query, not twenty.
    /// </param>
    private static async Task<bool> MayReadAsync(
        ApplicationUser caller,
        string rawKey,
        StorageKey key,
        SpacetimeClient spacetime,
        UserManager<ApplicationUser> users,
        Dictionary<string, bool> memo,
        CancellationToken ct)
    {
        var me = caller.UserName!;
        switch (key.Scope)
        {
            case StorageScope.Avatar:
                // Profile pictures are shown to everyone the uploader shares a
                // space, a friendship or a request with — any account will do.
                return true;

            case StorageScope.DirectMessage:
                return me == key.Uploader || me == key.Partner;

            case StorageScope.Channel:
                return await Memo(memo, $"ch:{key.Id}", () => AnyRowAsync(
                    $"SELECT id FROM my_channels WHERE id = {key.Id}", $"channel {key.Id}"));

            case StorageScope.ServerIcon:
                return await Memo(memo, $"srv:{key.Id}", () => AnyRowAsync(
                    $"SELECT id FROM my_servers WHERE id = {key.Id}", $"space {key.Id}"));

            case StorageScope.Legacy:
                // Pre-scope keys record only who uploaded them. Approximation:
                // readable while the uploader is someone the caller can see —
                // a co-member, a friend, themselves. That is what a kicked user
                // loses, and what a member keeps. Not covered: a file whose
                // uploader has since left every space you share (it stops
                // loading), and a space icon uploaded by someone other than
                // the space's owner when you are not a member (see below).
                if (me == key.Uploader
                    || await Memo(memo, $"user:{key.Uploader}", () => AnyRowAsync(
                        $"SELECT username FROM my_visible_users WHERE username = '{key.Uploader}'",
                        $"uploader {key.Uploader}")))
                {
                    return true;
                }
                return await IsLegacyIconOfVisibleSpaceAsync();

            default:
                return false;
        }

        // Discover shows icons of spaces the caller has not joined; a legacy
        // icon's uploader is invisible from there, so match the key against the
        // icon of a visible space instead — but only when the space's owner is
        // the uploader, or an owner could point their own space's icon at any
        // key they remember and read it back.
        async Task<bool> IsLegacyIconOfVisibleSpaceAsync()
        {
            var rows = await spacetime.QueryAsUserAsync(
                caller.Id, "SELECT icon_url, owner_identity FROM my_servers", "visible space icons", ct)
                ?? throw Unavailable();
            var owner = rows
                .FirstOrDefault(row => row.Count == 2 && SqlText(row[0]) == rawKey)
                is { } hit ? SqlText(hit[1]) : null;
            if (owner is null)
            {
                return false;
            }
            var uploader = await users.FindByNameAsync(key.Uploader);
            return uploader is not null
                && SpacetimeClient.NormalizeIdentityHex(uploader.SpacetimeIdentity)
                    == SpacetimeClient.NormalizeIdentityHex(owner);
        }

        async Task<bool> AnyRowAsync(string sql, string what)
        {
            var rows = await spacetime.QueryAsUserAsync(caller.Id, sql, $"download access {what}", ct)
                ?? throw Unavailable();
            return rows.Count > 0;
        }
    }

    private static async Task<bool> Memo(Dictionary<string, bool> memo, string scope, Func<Task<bool>> check)
    {
        if (!memo.TryGetValue(scope, out var allowed))
        {
            allowed = await check();
            memo[scope] = allowed;
        }
        return allowed;
    }

    /// <summary>
    /// Fails closed, but as the outage it is — no URL is minted, and the client
    /// is told to retry rather than that it lacks permission.
    /// </summary>
    private static ApiException Unavailable() => ApiException.ServiceUnavailable(
        "Could not reach the chat database to confirm your access to this file. Please try again in a moment.");

    /// <summary>
    /// A SpacetimeDB SQL scalar as text: a plain string, an <c>Identity</c>
    /// (<c>["0x…"]</c>), a positional sum such as <c>Option</c>
    /// (<c>[0, "value"]</c>, <c>[1, []]</c> for none) or the named form
    /// (<c>{"some": "value"}</c>); <c>null</c> for none / anything else.
    /// </summary>
    private static string? SqlText(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Array when element.GetArrayLength() == 1 => SqlText(element[0]),
        JsonValueKind.Array when element.GetArrayLength() == 2 && element[0].ValueKind == JsonValueKind.Number
            => SqlText(element[1]),
        JsonValueKind.Object when element.EnumerateObject().Any() => SqlText(element.EnumerateObject().First().Value),
        _ => null,
    };

    private static async Task<ApplicationUser> RequireAccount(
        SessionToken token, TokenService tokens, UserManager<ApplicationUser> users) =>
        await tokens.RequireAccountAsync(token, users, "Invalid or expired session token.");

    /// <summary>
    /// The account behind a session token, or a 401. Goes through
    /// <see cref="TokenService.RequireAccountAsync"/> rather than a bare
    /// signature check so an upload cannot be made with a session that a
    /// password reset or an account disable has already revoked.
    /// </summary>
    private static async Task<string> RequireSession(
        SessionToken token, TokenService tokens, UserManager<ApplicationUser> users) =>
        (await RequireAccount(token, tokens, users)).UserName!;

    private static long UnixNow() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
}

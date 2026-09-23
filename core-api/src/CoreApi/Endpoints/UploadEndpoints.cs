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
    private const long MaxProfileImageSize = 10L * 1024 * 1024; // 10 MiB
    private const int PresignUploadSeconds = 600;              // 10 min to PUT
    private const int PresignDownloadSeconds = 3600;           // 1 h GET lifetime
    private const long PendingUploadTtlSeconds = 900;          // 15 min to /confirm
    private const long MultipartUploadTtlSeconds = 7200;       // 2 h to /confirm
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
        routes.MapPost("/uploads/part-url", PartUrl);
        routes.MapPost("/uploads/status", Status);
        routes.MapPost("/uploads/abort", AbortUpload);
        routes.MapPost("/uploads/quota", QuotaStatus);
        routes.MapPost("/uploads/download-url", DownloadUrl);
        routes.MapPost("/uploads/download-urls", DownloadUrls);
    }

    private static async Task<UploadRequestResponse> RequestUpload(
        UploadRequestPayload payload,
        TokenService tokens,
        UserManager<ApplicationUser> users,
        AppDbContext db,
        StorageService storage,
        StorageInventoryState inventory,
        CancellationToken ct)
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

        if (fileName.Length > 255)
        {
            throw ApiException.BadRequest("file_name must be at most 255 characters.");
        }

        if (payload.FileSize <= 0)
        {
            throw ApiException.BadRequest("file_size must be greater than 0.");
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

        if (payload.Scope?.Kind is "avatar" or "icon")
        {
            if (!mimeType.StartsWith("image/", StringComparison.Ordinal))
            {
                throw ApiException.BadRequest("Profile pictures and space icons must be images.");
            }
            if (payload.FileSize > MaxProfileImageSize)
            {
                throw ApiException.BadRequest("Profile pictures and space icons are limited to 10 MiB.");
            }
        }

        var uploadId = Guid.NewGuid().ToString();
        var extension = Path.GetExtension(fileName).TrimStart('.');
        // The key is the access rule (StorageKey): whoever may read this object
        // later is decided from the scope baked in here.
        var storageKey = StorageKey.Build(
            payload.Scope, username, extension.Length == 0 ? uploadId : $"{uploadId}.{extension}");

        var pendingUpload = new PendingUpload
        {
            Id = uploadId,
            Username = username,
            StorageKey = storageKey,
            FileName = fileName,
            FileSize = payload.FileSize,
            MimeType = mimeType,
        };
        var (partSize, multipart) = await ReserveAsync(
            db, pendingUpload, payload.SupportsMultipart, inventory, ct);

        if (!multipart)
        {
            try
            {
                var url = await storage.PresignPutAsync(storageKey, payload.FileSize, PresignUploadSeconds);
                return new UploadRequestResponse(uploadId, url, PresignUploadSeconds);
            }
            catch
            {
                await ReleaseUnissuedReservationAsync(db, uploadId);
                throw;
            }
        }

        string multipartId;
        try
        {
            multipartId = await storage.InitiateMultipartAsync(storageKey, mimeType, ct);
        }
        catch
        {
            await ReleaseUnissuedReservationAsync(db, uploadId);
            throw;
        }
        try
        {
            var pending = await db.PendingUploads.FindAsync([uploadId], ct)
                ?? throw new InvalidOperationException("Upload reservation disappeared during initiation.");
            pending.MultipartUploadId = multipartId;
            await db.SaveChangesAsync(ct);
        }
        catch
        {
            try
            {
                await storage.AbortMultipartAsync(storageKey, multipartId, CancellationToken.None);
                await ReleaseUnissuedReservationAsync(db, uploadId);
            }
            catch { /* MinIO's stale-multipart cleanup is the crash/failure fallback. */ }
            throw;
        }
        return new UploadRequestResponse(uploadId, null, (int)MultipartUploadTtlSeconds,
            "multipart", partSize, checked((int)((payload.FileSize + partSize - 1) / partSize)));
    }

    private static async Task ReleaseUnissuedReservationAsync(AppDbContext db, string uploadId)
    {
        try
        {
            var pending = await db.PendingUploads.FindAsync([uploadId]);
            if (pending is null) return;
            db.PendingUploads.Remove(pending);
            await db.SaveChangesAsync(CancellationToken.None);
        }
        catch { /* The expiry sweeper retains and retries tracked reservations. */ }
    }

    /// <summary>
    /// One short transaction serializes reservations across users, which is
    /// needed for the optional instance-wide limit. Confirm moves pending to
    /// confirmed atomically; one UNION ALL sum sees either side, never neither.
    /// ponytail: global row lock; shard only if measured request throughput needs it.
    /// </summary>
    internal static async Task<(long PartSize, bool Multipart)> ReserveAsync(
        AppDbContext db, PendingUpload pending, bool supportsMultipart,
        StorageInventoryState inventory, CancellationToken ct = default)
    {
        await using var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;
        var settings = db.Database.IsRelational()
            ? await db.SystemConfig.FromSqlRaw("SELECT * FROM \"SystemConfig\" WHERE \"Id\" = 1 FOR UPDATE")
                .SingleAsync(ct)
            : await db.SystemConfig.SingleAsync(ct);
        if (pending.FileSize > settings.UploadMaxFileSizeMiB * UploadLimits.MiB)
            throw ApiException.BadRequest(
                $"File exceeds the maximum allowed size of {settings.UploadMaxFileSizeMiB} MiB.");

        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var quota = await LockQuotaAsync(db, pending.Username, today);
        var reservedToday = await db.PendingUploads
            .Where(row => row.Username == pending.Username && (row.QuotaDate == today || row.QuotaDate == ""))
            .SumAsync(row => (long?)row.FileSize, ct) ?? 0;
        var dailyLimit = settings.DailyUploadQuotaMiB * UploadLimits.MiB;
        if (quota.BytesUploaded + reservedToday + pending.FileSize > dailyLimit)
            throw ApiException.BadRequest(
                $"Daily upload quota exceeded: {Math.Max(0, (dailyLimit - quota.BytesUploaded - reservedToday) / UploadLimits.MiB)} MiB remaining of {settings.DailyUploadQuotaMiB} MiB for this UTC day.");

        if (settings.UserStorageLimitMiB > 0 || settings.InstanceStorageLimitMiB > 0)
        {
            if (!inventory.IsReady)
                throw ApiException.ServiceUnavailable(
                    "Storage usage is still being checked. Please retry the upload shortly.");

            if (settings.UserStorageLimitMiB > 0)
            {
                var used = await StorageUsage.RetainedAndPendingAsync(db, pending.Username, ct);
                var limit = settings.UserStorageLimitMiB * UploadLimits.MiB;
                if (used + pending.FileSize > limit)
                    throw ApiException.BadRequest(
                        $"Your stored-file quota is exceeded: {Math.Max(0, (limit - used) / UploadLimits.MiB)} MiB remaining of {settings.UserStorageLimitMiB} MiB.");
            }
            if (settings.InstanceStorageLimitMiB > 0)
            {
                var used = await StorageUsage.RetainedAndPendingAsync(db, null, ct);
                if (used + pending.FileSize > settings.InstanceStorageLimitMiB * UploadLimits.MiB)
                    throw ApiException.BadRequest(
                        "This LetsChat instance has reached its configured storage limit. Please contact the administrator.");
            }
        }

        var partSize = settings.UploadPartSizeMiB * UploadLimits.MiB;
        // Old clients retain their single-PUT behavior (and its proxy cap).
        var multipart = supportsMultipart && pending.FileSize > partSize;
        pending.QuotaDate = today;
        pending.ExpiresAt = UnixNow() + (multipart ? MultipartUploadTtlSeconds : PendingUploadTtlSeconds);
        pending.PartSize = multipart ? partSize : 0;
        db.PendingUploads.Add(pending);
        await db.SaveChangesAsync(ct);
        if (transaction is not null) await transaction.CommitAsync(ct);
        return (partSize, multipart);
    }

    private static async Task<UploadQuotaResponse> QuotaStatus(
        UploadQuotaRequest request, TokenService tokens, UserManager<ApplicationUser> users,
        AppDbContext db, StorageInventoryState inventory, CancellationToken ct)
    {
        var username = await RequireSession(request.SessionToken, tokens, users);
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var settings = await db.SystemConfig.AsNoTracking().SingleAsync(ct);
        var charged = await db.UploadQuotas.AsNoTracking()
            .Where(row => row.Username == username && row.QuotaDate == today)
            .Select(row => (long?)row.BytesUploaded).SingleOrDefaultAsync(ct) ?? 0;
        var reserved = await db.PendingUploads.AsNoTracking()
            .Where(row => row.Username == username && (row.QuotaDate == today || row.QuotaDate == ""))
            .SumAsync(row => (long?)row.FileSize, ct) ?? 0;
        var stored = inventory.IsReady
            ? await StorageUsage.RetainedAndPendingAsync(db, username, ct)
            : (long?)null;
        return new UploadQuotaResponse(
            today, settings.DailyUploadQuotaMiB * UploadLimits.MiB, charged, reserved,
            settings.UserStorageLimitMiB * UploadLimits.MiB, stored,
            settings.InstanceStorageLimitMiB * UploadLimits.MiB);
    }

    private static async Task<UploadConfirmResponse> ConfirmUpload(
        UploadConfirmPayload payload,
        TokenService tokens,
        UserManager<ApplicationUser> users,
        AppDbContext db,
        StorageService storage,
        CancellationToken ct)
    {
        var username = await RequireSession(payload.SessionToken, tokens, users);
        await using var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(ct)
            : null;
        var pending = await LockPendingAsync(db, payload.UploadId, ct);
        if (pending is null)
        {
            var confirmed = await db.ConfirmedUploads.AsNoTracking()
                .FirstOrDefaultAsync(row => row.UploadId == payload.UploadId, ct)
                ?? throw ApiException.BadRequest("Upload ID not found.");
            if (confirmed.Username != username)
                throw ApiException.Unauthorized("Upload does not belong to this session.");
            return new UploadConfirmResponse(
                confirmed.StorageKey, confirmed.FileName, confirmed.FileSize, confirmed.MimeType);
        }
        if (!string.Equals(pending.Username, username, StringComparison.Ordinal))
        {
            throw ApiException.Unauthorized("Upload does not belong to this session.");
        }
        if (pending.ExpiresAt <= UnixNow())
        {
            if (pending.MultipartUploadId is { } expiredId)
                await storage.AbortMultipartAsync(pending.StorageKey, expiredId, ct);
            await storage.DeleteObjectAsync(pending.StorageKey);
            db.PendingUploads.Remove(pending);
            await db.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
            throw ApiException.BadRequest("Upload session expired. Please start over.");
        }

        var actualSize = await storage.GetObjectSizeAsync(pending.StorageKey);
        if (pending.PartSize > 0 && pending.MultipartUploadId is { } multipartId && actualSize is null)
        {
            var parts = await storage.ListPartsAsync(pending.StorageKey, multipartId, ct);
            var count = checked((int)((pending.FileSize + pending.PartSize - 1) / pending.PartSize));
            if (parts.Count != count || parts.Where((part, index) =>
                    part.Number != index + 1
                    || part.Size != ExpectedPartSize(pending, index + 1)
                    || string.IsNullOrEmpty(part.ETag)).Any())
            {
                throw ApiException.BadRequest("Upload is incomplete or a part has the wrong size.");
            }
            await storage.CompleteMultipartAsync(pending.StorageKey, multipartId, parts, ct);
            actualSize = await storage.GetObjectSizeAsync(pending.StorageKey);
        }
        if (actualSize is null)
        {
            throw ApiException.BadRequest("File has not been uploaded yet — complete the PUT request first.");
        }

        // Content-Length is signed, and the real object size is checked again:
        // a backend that ignored the signed header cannot turn one reservation
        // into a larger object.
        var rejection = actualSize.Value != pending.FileSize
            ? "Uploaded file size does not match the reserved size."
            : null;

        if (rejection is not null)
        {
            // A rejected object must not stay behind — that is exactly the
            // storage-fill this check exists to prevent.
            await storage.DeleteObjectAsync(pending.StorageKey);
            db.PendingUploads.Remove(pending);
            await db.SaveChangesAsync(ct);
            if (transaction is not null) await transaction.CommitAsync(ct);
            throw ApiException.BadRequest(rejection);
        }
        var quotaDate = pending.QuotaDate.Length == 0
            ? DateTimeOffset.FromUnixTimeSeconds(pending.ExpiresAt - PendingUploadTtlSeconds)
                .UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
            : pending.QuotaDate;
        var quota = await LockQuotaAsync(db, username, quotaDate);

        // Rows created by an older deployment were not reserved at request time.
        var dailyLimit = (await db.SystemConfig.AsNoTracking().SingleAsync(ct)).DailyUploadQuotaMiB
            * UploadLimits.MiB;
        if (pending.QuotaDate.Length == 0 && quota.BytesUploaded + actualSize.Value > dailyLimit)
        {
            await storage.DeleteObjectAsync(pending.StorageKey);
            db.PendingUploads.Remove(pending);
            await db.SaveChangesAsync(ct);
            if (transaction is not null)
            {
                await transaction.CommitAsync();
            }
            throw ApiException.BadRequest(
                "Daily upload quota exceeded for this UTC day.");
        }

        quota.BytesUploaded += actualSize.Value;
        db.ConfirmedUploads.Add(new ConfirmedUpload
        {
            UploadId = pending.Id,
            StorageKey = pending.StorageKey,
            Username = pending.Username,
            FileName = pending.FileName,
            FileSize = actualSize.Value,
            MimeType = pending.MimeType,
            ConfirmedAt = UnixNow(),
        });
        db.PendingUploads.Remove(pending);
        await db.SaveChangesAsync(ct);
        if (transaction is not null)
        {
            await transaction.CommitAsync();
        }

        return new UploadConfirmResponse(
            pending.StorageKey, pending.FileName, actualSize.Value, pending.MimeType);
    }

    private static async Task<UploadPartUrlResponse> PartUrl(
        UploadPartPayload payload,
        TokenService tokens,
        UserManager<ApplicationUser> users,
        AppDbContext db,
        StorageService storage)
    {
        var username = await RequireSession(payload.SessionToken, tokens, users);
        var pending = await RequireMultipartPendingAsync(db, payload.UploadId, username);
        var count = checked((int)((pending.FileSize + pending.PartSize - 1) / pending.PartSize));
        if (payload.PartNumber < 1 || payload.PartNumber > count)
        {
            throw ApiException.BadRequest("Invalid upload part number.");
        }
        var expected = ExpectedPartSize(pending, payload.PartNumber);
        var lifetime = (int)Math.Min(PresignUploadSeconds, pending.ExpiresAt - UnixNow());
        if (lifetime <= 0) throw ApiException.BadRequest("Upload session expired.");
        var url = await storage.PresignPartAsync(
            pending.StorageKey, pending.MultipartUploadId!, payload.PartNumber, expected, lifetime);
        return new UploadPartUrlResponse(url, lifetime);
    }

    private static async Task<UploadStatusResponse> Status(
        UploadSessionPayload payload,
        TokenService tokens,
        UserManager<ApplicationUser> users,
        AppDbContext db,
        StorageService storage,
        CancellationToken ct)
    {
        var username = await RequireSession(payload.SessionToken, tokens, users);
        var pending = await RequireMultipartPendingAsync(db, payload.UploadId, username);
        var count = checked((int)((pending.FileSize + pending.PartSize - 1) / pending.PartSize));
        if (await storage.GetObjectSizeAsync(pending.StorageKey) == pending.FileSize)
            return new UploadStatusResponse(Enumerable.Range(1, count).ToList());
        var parts = await storage.ListPartsAsync(pending.StorageKey, pending.MultipartUploadId!, ct);
        return new UploadStatusResponse(parts
            .Where(part => part.Number >= 1 && part.Number <= count
                && part.Size == ExpectedPartSize(pending, part.Number))
            .Select(part => part.Number).ToList());
    }

    private static async Task<IResult> AbortUpload(
        UploadSessionPayload payload,
        TokenService tokens,
        UserManager<ApplicationUser> users,
        AppDbContext db,
        StorageService storage,
        CancellationToken ct)
    {
        var username = await RequireSession(payload.SessionToken, tokens, users);
        await using var tx = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(ct) : null;
        var pending = await LockPendingAsync(db, payload.UploadId, ct)
            ?? throw ApiException.BadRequest("Upload ID not found or already confirmed.");
        if (pending.Username != username) throw ApiException.Unauthorized("Upload does not belong to this session.");
        if (pending.MultipartUploadId is { } multipartId)
        {
            await storage.AbortMultipartAsync(pending.StorageKey, multipartId, ct);
        }
        // A completion that reached MinIO but not PostgreSQL can leave a final
        // object while the pending row still exists. Both forms are cleaned.
        await storage.DeleteObjectAsync(pending.StorageKey);
        db.PendingUploads.Remove(pending);
        await db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    private static async Task<PendingUpload> RequireMultipartPendingAsync(
        AppDbContext db, string uploadId, string username)
    {
        var pending = await db.PendingUploads.AsNoTracking().FirstOrDefaultAsync(row => row.Id == uploadId)
            ?? throw ApiException.BadRequest("Upload ID not found or already confirmed.");
        if (pending.Username != username) throw ApiException.Unauthorized("Upload does not belong to this session.");
        if (pending.ExpiresAt <= UnixNow()) throw ApiException.BadRequest("Upload session expired.");
        if (pending.MultipartUploadId is null || pending.PartSize <= 0)
            throw ApiException.BadRequest("This is not a multipart upload.");
        return pending;
    }

    private static long ExpectedPartSize(PendingUpload pending, int partNumber) =>
        Math.Min(pending.PartSize, pending.FileSize - (partNumber - 1L) * pending.PartSize);

    private static async Task<PendingUpload?> LockPendingAsync(
        AppDbContext db, string uploadId, CancellationToken ct) =>
        db.Database.IsRelational()
            ? await db.PendingUploads.FromSqlInterpolated($"""
                SELECT * FROM "PendingUploads" WHERE "Id" = {uploadId} FOR UPDATE
                """).SingleOrDefaultAsync(ct)
            : await db.PendingUploads.FirstOrDefaultAsync(row => row.Id == uploadId, ct);

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
    /// Returns the user's quota row while holding its PostgreSQL row lock. Every
    /// request and confirmation for that user/day passes here, so concurrent
    /// calls cannot all observe the same remaining allowance.
    /// </summary>
    private static async Task<UploadQuota> LockQuotaAsync(
        AppDbContext db, string username, string quotaDate)
    {
        if (!db.Database.IsRelational())
        {
            var existing = await db.UploadQuotas.FindAsync(username, quotaDate);
            if (existing is not null)
            {
                return existing;
            }

            var created = new UploadQuota { Username = username, QuotaDate = quotaDate };
            db.UploadQuotas.Add(created);
            return created;
        }

        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "UploadQuotas" ("Username", "QuotaDate", "BytesUploaded")
            VALUES ({username}, {quotaDate}, 0)
            ON CONFLICT ("Username", "QuotaDate") DO NOTHING
            """);
        return await db.UploadQuotas
            .FromSqlInterpolated($"""
                SELECT * FROM "UploadQuotas"
                WHERE "Username" = {username} AND "QuotaDate" = {quotaDate}
                FOR UPDATE
                """)
            .SingleAsync();
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

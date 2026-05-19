using System.Globalization;
using CoreApi.Data;
using CoreApi.Models;
using CoreApi.Services;
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
        AppDbContext db,
        StorageService storage)
    {
        var username = await RequireSession(payload.SessionToken, tokens);

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
        var datePath = DateTime.UtcNow.ToString("yyyy/MM/dd", CultureInfo.InvariantCulture);
        var storageKey = extension.Length == 0
            ? $"uploads/{datePath}/{username}/{uploadId}"
            : $"uploads/{datePath}/{username}/{uploadId}.{extension}";

        var uploadUrl = await storage.PresignPutAsync(storageKey, PresignUploadSeconds);

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
        AppDbContext db,
        StorageService storage)
    {
        var username = await RequireSession(payload.SessionToken, tokens);

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

        if (!await storage.ObjectExistsAsync(pending.StorageKey))
        {
            throw ApiException.BadRequest(
                "File has not been uploaded yet — complete the PUT request first.");
        }

        var today = DateTime.UtcNow.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        var quota = await db.UploadQuotas
            .FirstOrDefaultAsync(q => q.Username == username && q.QuotaDate == today);
        if (quota is null)
        {
            db.UploadQuotas.Add(new UploadQuota
            {
                Username = username,
                QuotaDate = today,
                BytesUploaded = pending.FileSize,
            });
        }
        else
        {
            quota.BytesUploaded += pending.FileSize;
        }

        db.PendingUploads.Remove(pending);
        await db.SaveChangesAsync();

        return new UploadConfirmResponse(
            pending.StorageKey, pending.FileName, pending.FileSize, pending.MimeType);
    }

    private static async Task<DownloadUrlResponse> DownloadUrl(
        DownloadUrlPayload payload,
        TokenService tokens,
        StorageService storage)
    {
        await RequireSession(payload.SessionToken, tokens);

        if (!payload.StorageKey.StartsWith("uploads/", StringComparison.Ordinal))
        {
            throw ApiException.BadRequest("Invalid storage key.");
        }

        var url = await storage.PresignGetAsync(payload.StorageKey, PresignDownloadSeconds);
        return new DownloadUrlResponse(url, PresignDownloadSeconds);
    }

    private static async Task<DownloadUrlsResponse> DownloadUrls(
        DownloadUrlsPayload payload,
        TokenService tokens,
        StorageService storage)
    {
        await RequireSession(payload.SessionToken, tokens);

        if (payload.StorageKeys is null || payload.StorageKeys.Count == 0)
        {
            throw ApiException.BadRequest("storageKeys must not be empty.");
        }

        if (payload.StorageKeys.Count > MaxBatchKeys)
        {
            throw ApiException.BadRequest("Too many storage keys requested at once.");
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var items = new List<DownloadUrlItem>(payload.StorageKeys.Count);
        foreach (var key in payload.StorageKeys)
        {
            if (!key.StartsWith("uploads/", StringComparison.Ordinal))
            {
                throw ApiException.BadRequest("Invalid storage key.");
            }

            if (!seen.Add(key))
            {
                continue;
            }

            var url = await storage.PresignGetAsync(key, PresignDownloadSeconds);
            items.Add(new DownloadUrlItem(key, url, PresignDownloadSeconds));
        }

        return new DownloadUrlsResponse(items);
    }

    private static async Task<string> RequireSession(SessionToken token, TokenService tokens) =>
        await tokens.ValidateAsync(token)
        ?? throw ApiException.Unauthorized("Invalid or expired session token.");

    private static long UnixNow() => DateTimeOffset.UtcNow.ToUnixTimeSeconds();
}

using System.Text;
using System.Text.Json;
using CoreApi.Data;
using CoreApi.Models;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Endpoints;

public static class VideoPlaybackEndpoints
{
    public static void MapVideoPlaybackEndpoints(this IEndpointRouteBuilder routes)
    {
        routes.MapPost("/uploads/video-playback", Playback);
        routes.MapGet("/uploads/video/{grant}/{playlist}", Playlist);
    }

    private static async Task<IResult> Playback(DownloadUrlPayload payload, TokenService tokens,
        UserManager<ApplicationUser> users, SpacetimeClient spacetime, AppDbContext db,
        VideoPlaybackAccess access, CancellationToken ct)
    {
        var caller = await tokens.RequireAccountAsync(payload.SessionToken, users, "Invalid or expired session token.");
        var key = StorageKey.TryParse(payload.StorageKey) ?? throw ApiException.BadRequest("Invalid storage key.");
        if (!await UploadEndpoints.MayReadAsync(caller, payload.StorageKey, key, spacetime, users, new(), ct))
            throw ApiException.Forbidden("You cannot access this video.");
        var upload = await db.ConfirmedUploads.AsNoTracking()
            .SingleOrDefaultAsync(row => row.StorageKey == payload.StorageKey, ct);
        if (upload is null) return Results.NotFound();
        var ready = upload.VideoState == ThumbnailState.Done && upload.VideoManifest is not null;
        return Results.Ok(new
        {
            state = ready ? "ready" : upload.VideoState == ThumbnailState.Pending ? "processing" : "unavailable",
            manifestPath = ready ? $"/uploads/video/{access.Issue(payload.StorageKey)}/master.m3u8" : null,
            expiresIn = ready ? 3600 : 0,
        });
    }

    private static async Task<IResult> Playlist(string grant, string playlist, HttpResponse response,
        VideoPlaybackAccess access, AppDbContext db, StorageService storage, CancellationToken ct)
    {
        response.Headers.CacheControl = "private, no-store";
        response.Headers["Referrer-Policy"] = "no-referrer";
        var permission = await access.ReadAsync(grant);
        if (permission is null) return Results.Unauthorized();
        var upload = await db.ConfirmedUploads.AsNoTracking()
            .SingleOrDefaultAsync(row => row.StorageKey == permission.Value.Key, ct);
        if (upload?.VideoState != ThumbnailState.Done || upload.VideoManifest is null)
            return Results.NotFound();
        var variants = JsonSerializer.Deserialize<List<VideoRendition>>(upload.VideoManifest)!;
        string body;
        if (playlist == "master.m3u8")
        {
            var master = new StringBuilder("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n");
            foreach (var variant in variants)
            {
                master.AppendLine($"#EXT-X-STREAM-INF:BANDWIDTH={variant.Bandwidth},RESOLUTION={variant.Width}x{variant.Height}");
                master.AppendLine(variant.Name + ".m3u8");
            }
            body = master.ToString();
        }
        else
        {
            var variant = variants.SingleOrDefault(item => playlist == item.Name + ".m3u8");
            if (variant is null) return Results.NotFound();
            body = await VideoPlayback.SignPlaylistAsync(variant.Playlist, segment =>
                storage.PresignGetAsync(VideoPlayback.Prefix(upload.StorageKey) + segment, permission.Value.RemainingSeconds));
        }
        return Results.Text(body, "application/vnd.apple.mpegurl", Encoding.UTF8);
    }
}

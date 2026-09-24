using System.Diagnostics;
using CoreApi.Configuration;
using CoreApi.Data;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Services;

/// <summary>
/// Renders poster frames for confirmed videos in the background, one at a time
/// at below-normal priority, so neither the upload nor the UI waits on it.
/// ffmpeg reads the object through a presigned internal URL with range
/// requests: only the index and a few frames are fetched, never the whole file.
///
/// <para>
/// The poster lives at <c>{videoKey}.thumb.jpg</c>, so it inherits the video's
/// read rule from <see cref="StorageKey"/> and needs no message change. It is
/// not an upload: it never enters <c>ConfirmedUploads</c>, and the collector
/// deletes it together with its video.
/// </para>
/// </summary>
public sealed class VideoThumbnailWorker(
    IServiceScopeFactory scopes,
    StorageService storage,
    ServiceOptions options,
    ILogger<VideoThumbnailWorker> logger) : BackgroundService
{
    public const string KeySuffix = ".thumb.jpg";
    private const int MaxAttempts = 3;
    private const int MaxWidth = 640;
    private static readonly TimeSpan IdleDelay = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan JobTimeout = TimeSpan.FromSeconds(60);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!await FfmpegAvailableAsync(stoppingToken))
        {
            // Jobs stay pending and run once ffmpeg is installed and core-api restarts.
            logger.LogWarning("ffmpeg not found at {Path}; video thumbnails are disabled.", options.FfmpegPath);
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            var worked = false;
            try
            {
                worked = await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Video thumbnail job failed; will retry.");
            }
            if (!worked)
            {
                await Task.Delay(IdleDelay, stoppingToken);
            }
        }
    }

    /// <summary>Processes the oldest pending video. <c>false</c> when there was nothing to do.</summary>
    internal async Task<bool> RunOnceAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var job = await db.ConfirmedUploads
            .Where(upload => upload.ThumbnailState == ThumbnailState.Pending)
            .OrderBy(upload => upload.ConfirmedAt)
            .FirstOrDefaultAsync(ct);
        if (job is null)
        {
            return false;
        }

        var jpeg = await RenderAsync(storage.PresignInternalGet(job.StorageKey, 300), ct);
        var thumbnailKey = job.StorageKey + KeySuffix;
        if (jpeg is not null)
        {
            await storage.PutObjectAsync(thumbnailKey, jpeg, "image/jpeg", ct);
            job.ThumbnailState = ThumbnailState.Done;
        }
        else if (++job.ThumbnailAttempts >= MaxAttempts)
        {
            job.ThumbnailState = ThumbnailState.Failed;
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // The collector removed the video meanwhile; don't leave its poster behind.
            await storage.DeleteObjectAsync(thumbnailKey);
        }
        return true;
    }

    private async Task<byte[]?> RenderAsync(string url, CancellationToken ct)
    {
        // A second in skips black lead-ins; clips shorter than that retry at 0.
        foreach (var seek in new[] { "1", "0" })
        {
            using var process = Process.Start(Ffmpeg(
                "-nostdin", "-v", "error", "-threads", "1",
                // The file and its declared MIME type are the uploader's. Without
                // a demuxer whitelist an HLS playlist named *.m3u8 makes ffmpeg
                // fetch whatever URLs it lists from inside the Docker network
                // (BUG_ANALYSIS A14); only real video containers are opened.
                "-protocol_whitelist", "http,https,tcp,tls",
                "-format_whitelist", "mov,matroska,avi,mpegts,ogg,flv",
                "-ss", seek, "-i", url,
                "-vf", $"thumbnail=12,scale='min({MaxWidth},iw)':-2",
                "-frames:v", "1", "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "pipe:1"))!;
            try
            {
                process.PriorityClass = ProcessPriorityClass.BelowNormal;
            }
            catch (Exception)
            {
                // Best-effort: priority changes can be denied in some containers.
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(JobTimeout);
            using var output = new MemoryStream();
            var errors = process.StandardError.ReadToEndAsync(timeout.Token);
            try
            {
                await process.StandardOutput.BaseStream.CopyToAsync(output, timeout.Token);
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                process.Kill(entireProcessTree: true);
                if (ct.IsCancellationRequested) throw;
                logger.LogWarning("ffmpeg timed out rendering a video thumbnail.");
                return null;
            }

            if (process.ExitCode == 0 && output.Length > 0)
            {
                return output.ToArray();
            }
            logger.LogInformation("ffmpeg produced no thumbnail at {Seek}s: {Error}", seek, await errors);
        }
        return null;
    }

    private async Task<bool> FfmpegAvailableAsync(CancellationToken ct)
    {
        try
        {
            using var process = Process.Start(Ffmpeg("-version"))!;
            await process.StandardOutput.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);
            return process.ExitCode == 0;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return false;
        }
    }

    private ProcessStartInfo Ffmpeg(params string[] arguments)
    {
        var info = new ProcessStartInfo(options.FfmpegPath)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        return info;
    }
}

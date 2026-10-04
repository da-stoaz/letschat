using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using CoreApi.Configuration;
using CoreApi.Data;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Services;

/// <summary>One bounded VOD encoding job at a time, including across API replicas.</summary>
public sealed class VideoPlaybackWorker(IServiceScopeFactory scopes, StorageService storage,
    ServiceOptions options, StorageInventoryState inventory, ILogger<VideoPlaybackWorker> logger) : BackgroundService
{
    internal const long MaxOutputBytes = 2L * 1024 * 1024 * 1024;
    private static readonly TimeSpan JobTimeout = TimeSpan.FromMinutes(30);
    private const long WorkerLock = 0x4c4356484c53;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        // Missing local tooling must not consume every queued video's retries.
        foreach (var executable in new[] { options.FfmpegPath, options.FfprobePath })
        {
            try
            {
                using var process = Process.Start(VideoProcess.StartInfo(executable, "-version"))!;
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                timeout.CancelAfter(TimeSpan.FromSeconds(10));
                try
                {
                    var stdout = process.StandardOutput.ReadToEndAsync(timeout.Token);
                    var stderr = process.StandardError.ReadToEndAsync(timeout.Token);
                    await process.WaitForExitAsync(timeout.Token);
                    await Task.WhenAll(stdout, stderr);
                    if (process.ExitCode != 0) throw new InvalidOperationException("Video tooling is unavailable.");
                }
                finally
                {
                    if (!process.HasExited) process.Kill(entireProcessTree: true);
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception)
            {
                logger.LogWarning("Video tooling unavailable at {Path}; HLS jobs stay pending until restart.", executable);
                return;
            }
        }
        while (!ct.IsCancellationRequested)
        {
            var worked = false;
            try { worked = await RunOnceAsync(ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
            catch (Exception ex) { logger.LogWarning(ex, "Video playback preparation failed; will retry."); }
            if (worked) continue;
            try { await Task.Delay(TimeSpan.FromSeconds(10), ct); }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { return; }
        }
    }

    internal async Task<bool> RunOnceAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var relational = db.Database.IsRelational();
        if (relational)
        {
            await db.Database.OpenConnectionAsync(ct);
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = $"SELECT pg_try_advisory_lock({WorkerLock})";
            if (await command.ExecuteScalarAsync(ct) is not true) return false;
        }
        try
        {
            var job = await db.ConfirmedUploads.Where(row => row.VideoState == ThumbnailState.Pending)
                .OrderBy(row => row.VideoAttempts).ThenBy(row => row.ConfirmedAt).FirstOrDefaultAsync(ct);
            if (job is null) return false;
            var key = job.StorageKey;
            // A crashed publication is still associated with this original and
            // charged. Remove its partial output before releasing that charge.
            await storage.DeleteVideoPlaybackAsync(key, ct);
            job.VideoBytes = 0;
            job.VideoManifest = null;
            if (job.VideoAttempts >= 3)
            {
                job.VideoState = ThumbnailState.Failed;
                await db.SaveChangesAsync(ct);
                return true;
            }
            job.VideoAttempts++;
            await db.SaveChangesAsync(ct);
            var directory = Directory.CreateTempSubdirectory("letschat-hls-");
            if (!OperatingSystem.IsWindows() && Environment.IsPrivilegedProcess && File.Exists("/usr/bin/setpriv"))
                File.SetUnixFileMode(directory.FullName, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                    | UnixFileMode.GroupRead | UnixFileMode.GroupWrite | UnixFileMode.GroupExecute
                    | UnixFileMode.OtherRead | UnixFileMode.OtherWrite | UnixFileMode.OtherExecute);
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
            deadline.CancelAfter(JobTimeout);
            try
            {
                var variants = await EncodeAsync(storage.PresignInternalGet(key, 3600), directory.FullName, deadline.Token);
                var segments = Directory.GetFiles(directory.FullName, "*.ts");
                var bytes = segments.Sum(file => new FileInfo(file).Length);
                if (bytes <= 0 || bytes > MaxOutputBytes) throw new InvalidOperationException("Video output exceeds its budget.");
                if (!await ReserveAsync(db, key, bytes, deadline.Token)) return true;

                // The reservation above is committed BEFORE object writes. This
                // second row lock serializes publication with lifecycle deletion.
                // A crash leaves Pending + charged bytes; the next job cleans it.
                db.ChangeTracker.Clear();
                await using var publication = relational ? await db.Database.BeginTransactionAsync(deadline.Token) : null;
                var current = await LockUploadAsync(db, key, deadline.Token);
                if (current is null) return true;
                foreach (var segment in segments)
                    await storage.PutVideoSegmentAsync(VideoPlayback.Prefix(key) + Path.GetFileName(segment), segment, deadline.Token);
                current.VideoManifest = JsonSerializer.Serialize(variants);
                current.VideoState = ThumbnailState.Done;
                await db.SaveChangesAsync(deadline.Token);
                if (publication is not null) await publication.CommitAsync(deadline.Token);
                logger.LogInformation("Prepared {Count} HLS renditions ({Bytes} bytes).", variants.Count, bytes);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
            catch (Exception)
            {
                // Do not log ffmpeg stderr or signed input URLs. Pending jobs
                // retry up to three times; the original always remains usable.
                logger.LogWarning("Video preparation attempt {Attempt} failed; original remains available.", job.VideoAttempts);
            }
            finally { directory.Delete(recursive: true); }
            return true;
        }
        finally
        {
            if (relational)
            {
                await using var command = db.Database.GetDbConnection().CreateCommand();
                command.CommandText = $"SELECT pg_advisory_unlock({WorkerLock})";
                await command.ExecuteScalarAsync(CancellationToken.None);
            }
        }
    }

    internal static async Task<ConfirmedUpload?> LockUploadAsync(AppDbContext db, string key, CancellationToken ct) =>
        db.Database.IsRelational()
            ? await db.ConfirmedUploads.FromSqlInterpolated($"SELECT * FROM \"ConfirmedUploads\" WHERE \"StorageKey\" = {key} FOR UPDATE").SingleOrDefaultAsync(ct)
            : await db.ConfirmedUploads.FindAsync([key], ct);

    private async Task<bool> ReserveAsync(AppDbContext db, string key, long bytes, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        await using var tx = db.Database.IsRelational() ? await db.Database.BeginTransactionAsync(ct) : null;
        var settings = db.Database.IsRelational()
            ? await db.SystemConfig.FromSqlRaw("SELECT * FROM \"SystemConfig\" WHERE \"Id\" = 1 FOR UPDATE").SingleAsync(ct)
            : await db.SystemConfig.SingleAsync(ct);
        var current = await LockUploadAsync(db, key, ct);
        if (current is null) return false;
        if ((settings.UserStorageLimitMiB > 0 || settings.InstanceStorageLimitMiB > 0) && !inventory.IsReady)
            throw new InvalidOperationException("Storage inventory is not ready.");
        const long mib = 1024 * 1024;
        var fitsUser = settings.UserStorageLimitMiB == 0
            || await StorageUsage.RetainedAndPendingAsync(db, current.Username, ct) + bytes <= settings.UserStorageLimitMiB * mib;
        var fitsInstance = settings.InstanceStorageLimitMiB == 0
            || await StorageUsage.RetainedAndPendingAsync(db, null, ct) + bytes <= settings.InstanceStorageLimitMiB * mib;
        if (fitsUser && fitsInstance) current.VideoBytes = bytes;
        else current.VideoState = ThumbnailState.Failed;
        await db.SaveChangesAsync(ct);
        if (tx is not null) await tx.CommitAsync(ct);
        return fitsUser && fitsInstance;
    }

    internal async Task<List<VideoRendition>> EncodeAsync(string input, string directory, CancellationToken ct)
    {
        using var probeTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        probeTimeout.CancelAfter(TimeSpan.FromSeconds(30));
        var metadata = await RunProcessAsync(options.FfprobePath,
            ["-v", "error", "-protocol_whitelist", "http,https,tcp,tls", "-format_whitelist", VideoProcess.Formats,
             "-show_entries", "stream=codec_type,width,height,sample_aspect_ratio:stream_side_data=rotation:format=duration", "-of", "json", input], directory, probeTimeout.Token);
        using var probe = JsonDocument.Parse(metadata);
        var stream = probe.RootElement.GetProperty("streams").EnumerateArray()
            .First(item => item.GetProperty("codec_type").GetString() == "video");
        var width = stream.GetProperty("width").GetInt32();
        var height = stream.GetProperty("height").GetInt32();
        var duration = double.Parse(probe.RootElement.GetProperty("format").GetProperty("duration").GetString()!, CultureInfo.InvariantCulture);
        if (width < 2 || height < 2 || width > 16384 || height > 16384 || (long)width * height > 7680L * 4320 || !double.IsFinite(duration) || duration <= 0 || duration > 7200)
            throw new InvalidOperationException("Video dimensions or duration exceed processing limits.");
        if (stream.TryGetProperty("sample_aspect_ratio", out var aspect))
        {
            var parts = (aspect.GetString() ?? "").Split(':');
            if (parts.Length == 2 && double.TryParse(parts[0], out var numerator)
                && double.TryParse(parts[1], out var denominator) && numerator > 0 && denominator > 0)
                width = (int)Math.Clamp(width * numerator / denominator, 2, 16384);
        }
        if (stream.TryGetProperty("side_data_list", out var sideData)
            && sideData.EnumerateArray().Any(item => item.TryGetProperty("rotation", out var rotation) && Math.Abs(rotation.GetDouble()) % 180 == 90))
            (width, height) = (height, width);
        var variants = new List<VideoRendition>();
        foreach (var edge in new[] { 720, 1080 })
        {
            var size = VideoPlayback.Fit(width, height, edge);
            if (variants.Any(item => item.Width == size.Width && item.Height == size.Height)) continue;
            var name = $"v{variants.Count}";
            var bandwidth = edge == 720 ? 3_200_000 : 5_200_000;
            await RunProcessAsync(options.FfmpegPath,
                ["-nostdin", "-v", "error", "-y", "-threads", "2", "-protocol_whitelist", "http,https,tcp,tls",
                 "-format_whitelist", VideoProcess.Formats, "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
                 "-vf", $"scale={size.Width}:{size.Height},setsar=1", "-r", "30", "-c:v", "libx264", "-threads", "2",
                 "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-maxrate", (bandwidth - 200000).ToString(CultureInfo.InvariantCulture),
                 "-bufsize", (2 * bandwidth).ToString(CultureInfo.InvariantCulture), "-g", "120", "-keyint_min", "120", "-sc_threshold", "0",
                 "-force_key_frames", "expr:gte(t,n_forced*4)", "-c:a", "aac", "-b:a", "128k", "-ac", "2",
                 "-f", "hls", "-hls_time", "4", "-hls_list_size", "0", "-hls_playlist_type", "vod", "-hls_flags", "independent_segments",
                 "-hls_segment_filename", Path.Combine(directory, name + "_%05d.ts"), Path.Combine(directory, name + ".m3u8")], directory, ct);
            var playlist = await File.ReadAllTextAsync(Path.Combine(directory, name + ".m3u8"), ct);
            // Validate our generated manifest before publishing any object.
            await VideoPlayback.SignPlaylistAsync(playlist, Task.FromResult);
            variants.Add(new VideoRendition(size.Width, size.Height, bandwidth, name, playlist));
        }
        return variants;
    }

    private static async Task<string> RunProcessAsync(string executable, string[] arguments, string directory, CancellationToken ct)
    {
        using var process = Process.Start(VideoProcess.StartInfo(executable, arguments))!;
        var output = process.StandardOutput.ReadToEndAsync(ct);
        var errors = process.StandardError.ReadToEndAsync(ct);
        try
        {
            try { process.PriorityClass = ProcessPriorityClass.BelowNormal; } catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception) { }
            var exited = process.WaitForExitAsync(ct);
            while (!process.HasExited)
            {
                ct.ThrowIfCancellationRequested();
                if (Directory.GetFiles(directory).Sum(path => new FileInfo(path).Length) > MaxOutputBytes)
                    throw new InvalidOperationException("Video output exceeds its budget.");
                await Task.WhenAny(exited, Task.Delay(1000, ct));
            }
            await errors;
            if (process.ExitCode != 0) throw new InvalidOperationException("Video encoder rejected the input.");
            return await output;
        }
        finally
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
        }
    }
}

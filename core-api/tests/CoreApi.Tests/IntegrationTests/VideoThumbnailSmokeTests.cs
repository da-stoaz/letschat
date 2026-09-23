using System.Diagnostics;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CoreApi.Tests.IntegrationTests;

public sealed class VideoThumbnailSmokeTests
{
    private const string VideoKey = "uploads/ch/1/thumbuser/video.mp4";
    private const string BrokenKey = "uploads/ch/1/thumbuser/broken.mp4";

    [Fact]
    public async Task Worker_Renders_A_Poster_Next_To_The_Video_And_Gives_Up_On_Undecodable_Files()
    {
        var endpoint = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ENDPOINT");
        if (string.IsNullOrEmpty(endpoint) || !FfmpegInstalled()) return;
        var accessKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ACCESS_KEY") ?? "minioadmin";
        var secretKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_SECRET_KEY") ?? "minioadmin";
        var bucket = $"letschat-thumb-test-{Guid.NewGuid():N}";
        using var admin = new AmazonS3Client(new BasicAWSCredentials(accessKey, secretKey), new AmazonS3Config
        {
            ServiceURL = endpoint,
            ForcePathStyle = true,
            AuthenticationRegion = "us-east-1",
            UseHttp = endpoint.StartsWith("http://", StringComparison.OrdinalIgnoreCase),
        });
        using var factory = new LetsChatWebApplicationFactory
        {
            MinioEndpoint = endpoint,
            MinioBucket = bucket,
            MinioAccessKey = accessKey,
            MinioSecretKey = secretKey,
        };
        var video = Path.Combine(Path.GetTempPath(), $"{Guid.NewGuid():N}.mp4");
        await admin.PutBucketAsync(bucket);
        try
        {
            _ = factory.CreateClient();
            // Let the sweeper's one-time bucket import finish first, or it adopts the test objects.
            var inventory = factory.Services.GetRequiredService<StorageInventoryState>();
            for (var i = 0; i < 100 && !inventory.IsReady; i++) await Task.Delay(100);

            // Default mp4 muxing puts the index at the end, like camera files.
            RunFfmpeg($"-v error -f lavfi -i testsrc=duration=3:size=1280x720:rate=25 -c:v libx264 -pix_fmt yuv420p {video}");
            await admin.PutObjectAsync(new PutObjectRequest { BucketName = bucket, Key = VideoKey, FilePath = video });
            await admin.PutObjectAsync(new PutObjectRequest { BucketName = bucket, Key = BrokenKey, ContentBody = "not a video" });
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.ConfirmedUploads.Add(Row(VideoKey, 1));
                db.ConfirmedUploads.Add(Row(BrokenKey, 2));
                await db.SaveChangesAsync();
            }

            var worker = factory.Services.GetServices<IHostedService>().OfType<VideoThumbnailWorker>().Single();
            for (var i = 0; i < 4; i++) await worker.RunOnceAsync(CancellationToken.None);

            using var poster = await admin.GetObjectAsync(bucket, VideoKey + VideoThumbnailWorker.KeySuffix);
            Assert.Equal("image/jpeg", poster.Headers.ContentType);
            var header = new byte[2];
            await poster.ResponseStream.ReadExactlyAsync(header);
            Assert.Equal(new byte[] { 0xFF, 0xD8 }, header);

            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.Equal(ThumbnailState.Done, db.ConfirmedUploads.Single(row => row.StorageKey == VideoKey).ThumbnailState);
                Assert.Equal(ThumbnailState.Failed, db.ConfirmedUploads.Single(row => row.StorageKey == BrokenKey).ThumbnailState);
            }
            Assert.False(await worker.RunOnceAsync(CancellationToken.None));
        }
        finally
        {
            File.Delete(video);
            var objects = await admin.ListObjectsV2Async(new ListObjectsV2Request { BucketName = bucket });
            foreach (var item in objects.S3Objects ?? []) await admin.DeleteObjectAsync(bucket, item.Key);
            await admin.DeleteBucketAsync(bucket);
        }
    }

    private static ConfirmedUpload Row(string key, long confirmedAt) => new()
    {
        StorageKey = key,
        Username = "thumbuser",
        FileName = "video.mp4",
        FileSize = 1,
        MimeType = "video/mp4",
        ConfirmedAt = confirmedAt,
        ThumbnailState = ThumbnailState.Pending,
    };

    private static bool FfmpegInstalled()
    {
        try
        {
            RunFfmpeg("-version");
            return true;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            return false;
        }
    }

    private static void RunFfmpeg(string arguments)
    {
        using var process = Process.Start(new ProcessStartInfo("ffmpeg", arguments)
        {
            RedirectStandardOutput = true,
            UseShellExecute = false,
        })!;
        process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0) throw new InvalidOperationException($"ffmpeg {arguments} failed");
    }
}

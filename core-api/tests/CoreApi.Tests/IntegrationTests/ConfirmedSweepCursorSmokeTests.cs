using System.Net;
using System.Text;
using Amazon.Runtime;
using Amazon.S3;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CoreApi.Tests.IntegrationTests;

public sealed class ConfirmedSweepCursorSmokeTests
{
    private const string Orphan = "uploads/avatar/cursoruser/orphan.bin";

    /// <summary>
    /// Referenced objects keep their rows forever. With more than one batch of
    /// them, the collector must still move past the oldest batch to newer orphans.
    /// </summary>
    [Fact]
    public async Task Collector_Reaches_Orphans_Behind_A_Full_Batch_Of_Live_Objects()
    {
        var endpoint = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ENDPOINT");
        if (string.IsNullOrEmpty(endpoint)) return;
        var accessKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ACCESS_KEY") ?? "minioadmin";
        var secretKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_SECRET_KEY") ?? "minioadmin";
        var bucket = $"letschat-cursor-test-{Guid.NewGuid():N}";
        using var admin = new AmazonS3Client(new BasicAWSCredentials(accessKey, secretKey), new AmazonS3Config
        {
            ServiceURL = endpoint,
            ForcePathStyle = true,
            AuthenticationRegion = "us-east-1",
            UseHttp = endpoint.StartsWith("http://", StringComparison.OrdinalIgnoreCase),
        });
        using var spacetime = new ClaimOrphanStub();
        using var factory = new LetsChatWebApplicationFactory
        {
            MinioEndpoint = endpoint,
            MinioBucket = bucket,
            MinioAccessKey = accessKey,
            MinioSecretKey = secretKey,
            SpacetimeTransport = spacetime,
        };
        await admin.PutBucketAsync(bucket);
        try
        {
            _ = factory.CreateClient();
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                for (var i = 0; i < 500; i++)
                    db.ConfirmedUploads.Add(Row($"uploads/avatar/cursoruser/live-{i:D3}.bin", 1_000 + i));
                db.ConfirmedUploads.Add(Row(Orphan, 2_000));
                await db.SaveChangesAsync();
            }

            var sweeper = factory.Services.GetServices<IHostedService>().OfType<PendingUploadSweeper>().Single();
            await sweeper.SweepOnceAsync(CancellationToken.None);
            await sweeper.SweepOnceAsync(CancellationToken.None);

            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.DoesNotContain(db.ConfirmedUploads, row => row.StorageKey == Orphan);
                Assert.Equal(500, db.ConfirmedUploads.Count());
            }
        }
        finally
        {
            await admin.DeleteBucketAsync(bucket);
        }
    }

    private static ConfirmedUpload Row(string key, long confirmedAt) => new()
    {
        StorageKey = key,
        Username = "cursoruser",
        FileName = "f.bin",
        FileSize = 1,
        MimeType = "application/octet-stream",
        ConfirmedAt = confirmedAt,
    };

    /// <summary>Accepts every admin reducer; the claim view claims only the orphan.</summary>
    private sealed class ClaimOrphanStub : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.RequestUri!.AbsolutePath.EndsWith("/sql", StringComparison.Ordinal)
                ? $"[{{\"schema\":{{\"elements\":[]}},\"rows\":[[\"{SpacetimeClient.StorageCleanupAuthorizationSentinel}\"],[\"{Orphan}\"]]}}]"
                : "{}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            });
        }
    }
}

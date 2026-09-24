using System.Net;
using System.Text;
using Amazon.Runtime;
using Amazon.S3;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// BUG_ANALYSIS D7: the collector asks the module to lift the fence a fresh
/// <c>init</c> sets. A failed first attempt must not end the retries once uploads
/// exist — the module decides from the oldest object's age, so a fresh install
/// still gets released later, and the sweeper stops asking once it is settled.
/// </summary>
public sealed class InitFenceRetrySmokeTests
{
    [Fact]
    public async Task Release_Is_Retried_With_The_Oldest_Object_Until_It_Succeeds()
    {
        var endpoint = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ENDPOINT");
        if (string.IsNullOrEmpty(endpoint)) return;
        var accessKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ACCESS_KEY") ?? "minioadmin";
        var secretKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_SECRET_KEY") ?? "minioadmin";
        var bucket = $"letschat-fence-test-{Guid.NewGuid():N}";
        using var admin = new AmazonS3Client(new BasicAWSCredentials(accessKey, secretKey), new AmazonS3Config
        {
            ServiceURL = endpoint,
            ForcePathStyle = true,
            AuthenticationRegion = "us-east-1",
            UseHttp = endpoint.StartsWith("http://", StringComparison.OrdinalIgnoreCase),
        });
        using var spacetime = new ReleaseFailsWhileEmptyStub();
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
            var sweeper = factory.Services.GetServices<IHostedService>().OfType<PendingUploadSweeper>().Single();
            await sweeper.SweepOnceAsync(CancellationToken.None);

            // An upload lands before the next attempt.
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                db.ConfirmedUploads.Add(new ConfirmedUpload
                {
                    StorageKey = "uploads/avatar/fenceuser/a.png",
                    Username = "fenceuser",
                    FileName = "a.png",
                    FileSize = 1,
                    MimeType = "image/png",
                    ConfirmedAt = 1_700_000_000,
                });
                await db.SaveChangesAsync();
            }
            await sweeper.SweepOnceAsync(CancellationToken.None);
            var settledAfter = spacetime.ReleaseBodies.Count;
            await sweeper.SweepOnceAsync(CancellationToken.None);

            // The hosted sweeper also runs in the background, so count by content:
            // failed attempts while empty, one carrying the upload's age, then quiet.
            Assert.Contains(spacetime.ReleaseBodies, body => body.Contains("\"none\""));
            Assert.Contains("1700000000000000", spacetime.ReleaseBodies[^1]);
            Assert.Equal(settledAfter, spacetime.ReleaseBodies.Count);
        }
        finally
        {
            await admin.DeleteBucketAsync(bucket);
        }
    }

    /// <summary>Fails every fence release made before an upload exists, accepts everything else.</summary>
    private sealed class ReleaseFailsWhileEmptyStub : HttpMessageHandler
    {
        public List<string> ReleaseBodies { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var path = request.RequestUri!.AbsolutePath;
            if (path.EndsWith("/call/release_storage_init_fence", StringComparison.Ordinal))
            {
                var release = await request.Content!.ReadAsStringAsync(cancellationToken);
                lock (ReleaseBodies) ReleaseBodies.Add(release);
                if (release.Contains("\"none\"", StringComparison.Ordinal))
                {
                    return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
                }
            }
            var body = path.EndsWith("/sql", StringComparison.Ordinal)
                ? $"[{{\"schema\":{{\"elements\":[]}},\"rows\":[[\"{SpacetimeClient.StorageCleanupAuthorizationSentinel}\"]]}}]"
                : "{}";
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
        }
    }
}

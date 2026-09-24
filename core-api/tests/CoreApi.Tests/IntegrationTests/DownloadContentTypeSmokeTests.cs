using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using CoreApi.Services;
using Microsoft.Extensions.DependencyInjection;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// The uploader chooses the Content-Type stored with a PUT, so a download URL
/// must not serve it as-is (BUG_ANALYSIS A15). Runs against a real MinIO when
/// <c>LETSCHAT_TEST_MINIO_ENDPOINT</c> is set.
/// </summary>
public sealed class DownloadContentTypeSmokeTests
{
    [Fact]
    public async Task Download_Urls_Override_The_Uploaders_Content_Type()
    {
        var endpoint = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ENDPOINT");
        if (string.IsNullOrEmpty(endpoint)) return;
        var accessKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ACCESS_KEY") ?? "minioadmin";
        var secretKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_SECRET_KEY") ?? "minioadmin";
        var bucket = $"letschat-ctype-test-{Guid.NewGuid():N}";
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
        await admin.PutBucketAsync(bucket);
        const string disguised = "uploads/ch/1/mallory/invoice.pdf";
        const string page = "uploads/ch/1/mallory/page.html";
        try
        {
            foreach (var key in new[] { disguised, page })
            {
                await admin.PutObjectAsync(new PutObjectRequest
                {
                    BucketName = bucket,
                    Key = key,
                    ContentBody = "<script>alert(1)</script>",
                    ContentType = "text/html",
                });
            }
            _ = factory.CreateClient();
            var storage = factory.Services.GetRequiredService<StorageService>();
            using var http = new HttpClient();

            using var pdf = await http.GetAsync(await storage.PresignGetAsync(disguised, 60));
            Assert.Equal("application/pdf", pdf.Content.Headers.ContentType?.MediaType);

            using var html = await http.GetAsync(await storage.PresignGetAsync(page, 60));
            Assert.Equal("attachment", html.Content.Headers.ContentDisposition?.DispositionType);
        }
        finally
        {
            var objects = await admin.ListObjectsV2Async(new ListObjectsV2Request { BucketName = bucket });
            foreach (var item in objects.S3Objects ?? []) await admin.DeleteObjectAsync(bucket, item.Key);
            await admin.DeleteBucketAsync(bucket);
        }
    }
}

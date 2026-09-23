using Amazon.Runtime;
using Amazon.S3;
using CoreApi.Configuration;
using CoreApi.Services;
using Microsoft.Extensions.Configuration;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// Opt-in live MinIO check. Set LETSCHAT_TEST_MINIO_ENDPOINT to the dev MinIO
/// URL; this test creates and removes only its own randomly named bucket.
/// </summary>
public sealed class MinioMultipartSmokeTests
{
    [Fact]
    public async Task Presigned_Parts_Are_Exact_Sized_Completed_And_Abortable()
    {
        var endpoint = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ENDPOINT");
        if (string.IsNullOrEmpty(endpoint)) return;

        var accessKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ACCESS_KEY") ?? "minioadmin";
        var secretKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_SECRET_KEY") ?? "minioadmin";
        var bucket = $"letschat-multipart-test-{Guid.NewGuid():N}";
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["MINIO_INTERNAL_ENDPOINT"] = endpoint,
            ["MINIO_PUBLIC_ENDPOINT"] = endpoint,
            ["MINIO_ACCESS_KEY"] = accessKey,
            ["MINIO_SECRET_KEY"] = secretKey,
            ["MINIO_BUCKET"] = bucket,
        }).Build();
        var options = ServiceOptions.FromConfiguration(config);
        using var admin = new AmazonS3Client(new BasicAWSCredentials(accessKey, secretKey), new AmazonS3Config
        {
            ServiceURL = endpoint,
            ForcePathStyle = true,
            AuthenticationRegion = "us-east-1",
            UseHttp = endpoint.StartsWith("http://", StringComparison.OrdinalIgnoreCase),
        });
        using var storage = new StorageService(options);
        using var http = new HttpClient();
        const string key = "uploads/avatar/test/multipart.bin";
        string? uploadId = null;
        string? abortId = null;
        await admin.PutBucketAsync(bucket);
        try
        {
            uploadId = await storage.InitiateMultipartAsync(key, "application/octet-stream", CancellationToken.None);
            var first = new byte[5 * 1024 * 1024];
            var second = new byte[1024 * 1024];
            var firstUrl = await storage.PresignPartAsync(key, uploadId, 1, first.Length, 60);
            using (var wrong = await http.PutAsync(firstUrl, new ByteArrayContent(second)))
                Assert.False(wrong.IsSuccessStatusCode);
            using (var firstPut = await http.PutAsync(firstUrl, new ByteArrayContent(first)))
                Assert.True(firstPut.IsSuccessStatusCode, await firstPut.Content.ReadAsStringAsync());
            var secondUrl = await storage.PresignPartAsync(key, uploadId, 2, second.Length, 60);
            using (var secondPut = await http.PutAsync(secondUrl, new ByteArrayContent(second)))
                Assert.True(secondPut.IsSuccessStatusCode, await secondPut.Content.ReadAsStringAsync());

            var parts = await storage.ListPartsAsync(key, uploadId, CancellationToken.None);
            Assert.Equal([1, 2], parts.Select(part => part.Number));
            Assert.Equal([first.Length, second.Length], parts.Select(part => part.Size));
            await storage.CompleteMultipartAsync(key, uploadId, parts, CancellationToken.None);
            Assert.Equal(first.Length + second.Length, await storage.GetObjectSizeAsync(key));
            uploadId = null;

            abortId = await storage.InitiateMultipartAsync("uploads/avatar/test/aborted.bin", "application/octet-stream", CancellationToken.None);
            await storage.AbortMultipartAsync("uploads/avatar/test/aborted.bin", abortId, CancellationToken.None);
            abortId = null;
        }
        finally
        {
            if (uploadId is not null) await storage.AbortMultipartAsync(key, uploadId, CancellationToken.None);
            if (abortId is not null) await storage.AbortMultipartAsync("uploads/avatar/test/aborted.bin", abortId, CancellationToken.None);
            await storage.DeleteObjectAsync(key);
            await admin.DeleteBucketAsync(bucket);
        }
    }
}

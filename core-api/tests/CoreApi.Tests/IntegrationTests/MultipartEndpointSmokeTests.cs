using System.Net;
using System.Text.Json;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>Opt-in end-to-end API + MinIO check using only a temporary bucket.</summary>
public sealed class MultipartEndpointSmokeTests
{
    [Fact]
    public async Task Authenticated_Multipart_Status_Completion_Retry_And_Abort()
    {
        var endpoint = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ENDPOINT");
        if (string.IsNullOrEmpty(endpoint)) return;
        var accessKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_ACCESS_KEY") ?? "minioadmin";
        var secretKey = Environment.GetEnvironmentVariable("LETSCHAT_TEST_MINIO_SECRET_KEY") ?? "minioadmin";
        var bucket = $"letschat-endpoint-test-{Guid.NewGuid():N}";
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
        using var storageHttp = new HttpClient();
        await admin.PutBucketAsync(bucket);
        try
        {
            var client = factory.CreateClient();
            var register = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/register", new
            {
                username = "multipart_smoke",
                displayName = "Multipart Smoke",
                password = "supersecret-test-1",
                email = "multipart-smoke@test.local",
            });
            Assert.Equal(HttpStatusCode.OK, register.StatusCode);
            using var registration = JsonDocument.Parse(await register.Content.ReadAsStringAsync());
            var token = registration.RootElement.GetProperty("auth").GetProperty("sessionToken").Clone();
            await factory.Services.GetRequiredService<SystemConfigService>().UpdateAsync(row =>
            {
                row.UploadPartSizeMiB = 5;
                row.UploadMaxFileSizeMiB = 12;
            });

            var request = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
            {
                sessionToken = token,
                fileName = "test.bin",
                fileSize = 6L * 1024 * 1024,
                mimeType = "application/octet-stream",
                scope = new { kind = "channel", channelId = 1 },
                supportsMultipart = true,
            });
            Assert.True(request.StatusCode == HttpStatusCode.OK, await request.Content.ReadAsStringAsync());
            using var requested = JsonDocument.Parse(await request.Content.ReadAsStringAsync());
            var uploadId = requested.RootElement.GetProperty("uploadId").GetString()!;
            Assert.Equal("multipart", requested.RootElement.GetProperty("mode").GetString());
            Assert.Equal(2, requested.RootElement.GetProperty("partCount").GetInt32());

            var otherRegister = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/register", new
            {
                username = "other_smoke",
                displayName = "Other Smoke",
                password = "supersecret-test-1",
                email = "other-smoke@test.local",
            });
            using var otherJson = JsonDocument.Parse(await otherRegister.Content.ReadAsStringAsync());
            var otherToken = otherJson.RootElement.GetProperty("auth").GetProperty("sessionToken").Clone();
            var stolenPart = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/part-url", new
            {
                sessionToken = otherToken,
                uploadId,
                partNumber = 1,
            });
            Assert.Equal(HttpStatusCode.Unauthorized, stolenPart.StatusCode);

            var firstUrl = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/part-url", new
            {
                sessionToken = token,
                uploadId,
                partNumber = 1,
            });
            Assert.Equal(HttpStatusCode.OK, firstUrl.StatusCode);
            using var firstUrlJson = JsonDocument.Parse(await firstUrl.Content.ReadAsStringAsync());
            var url1 = firstUrlJson.RootElement.GetProperty("url").GetString()!;
            using (var put = await storageHttp.PutAsync(url1, new ByteArrayContent(new byte[5 * 1024 * 1024])))
                Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());

            var incomplete = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/confirm", new
            {
                sessionToken = token,
                uploadId,
            });
            Assert.Equal(HttpStatusCode.BadRequest, incomplete.StatusCode);

            var status = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/status", new
            {
                sessionToken = token,
                uploadId,
            });
            using (var statusJson = JsonDocument.Parse(await status.Content.ReadAsStringAsync()))
                Assert.Equal([1], statusJson.RootElement.GetProperty("completedParts")
                    .EnumerateArray().Select(part => part.GetInt32()));

            var secondUrl = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/part-url", new
            {
                sessionToken = token,
                uploadId,
                partNumber = 2,
            });
            using var secondUrlJson = JsonDocument.Parse(await secondUrl.Content.ReadAsStringAsync());
            var url2 = secondUrlJson.RootElement.GetProperty("url").GetString()!;
            using (var put = await storageHttp.PutAsync(url2, new ByteArrayContent(new byte[1024 * 1024])))
                Assert.True(put.IsSuccessStatusCode, await put.Content.ReadAsStringAsync());

            var confirmed = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/confirm", new
            {
                sessionToken = token,
                uploadId,
            });
            Assert.Equal(HttpStatusCode.OK, confirmed.StatusCode);
            using var confirmedJson = JsonDocument.Parse(await confirmed.Content.ReadAsStringAsync());
            Assert.NotNull(confirmedJson.RootElement.GetProperty("storageKey").GetString());
            var retry = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/confirm", new
            {
                sessionToken = token,
                uploadId,
            });
            Assert.Equal(HttpStatusCode.OK, retry.StatusCode);

            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.Single(db.ConfirmedUploads.Where(row => row.UploadId == uploadId));
                Assert.Equal(6L * 1024 * 1024, db.UploadQuotas.Single().BytesUploaded);
            }

            var toAbort = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
            {
                sessionToken = token,
                fileName = "cancel.bin",
                fileSize = 6L * 1024 * 1024,
                mimeType = "application/octet-stream",
                scope = new { kind = "channel", channelId = 1 },
                supportsMultipart = true,
            });
            using var abortJson = JsonDocument.Parse(await toAbort.Content.ReadAsStringAsync());
            var abortId = abortJson.RootElement.GetProperty("uploadId").GetString()!;
            var aborted = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/abort", new
            {
                sessionToken = token,
                uploadId = abortId,
            });
            Assert.Equal(HttpStatusCode.NoContent, aborted.StatusCode);

            var toExpire = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
            {
                sessionToken = token,
                fileName = "expire.bin",
                fileSize = 6L * 1024 * 1024,
                mimeType = "application/octet-stream",
                scope = new { kind = "channel", channelId = 1 },
                supportsMultipart = true,
            });
            using var expireJson = JsonDocument.Parse(await toExpire.Content.ReadAsStringAsync());
            var expireId = expireJson.RootElement.GetProperty("uploadId").GetString()!;
            string expireKey;
            string multipartId;
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var pending = db.PendingUploads.Single(row => row.Id == expireId);
                expireKey = pending.StorageKey;
                multipartId = pending.MultipartUploadId!;
                pending.ExpiresAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 120;
                await db.SaveChangesAsync();
            }
            var sweeper = factory.Services.GetServices<IHostedService>().OfType<PendingUploadSweeper>().Single();
            await sweeper.SweepOnceAsync(CancellationToken.None);
            using (var scope = factory.Services.CreateScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                Assert.DoesNotContain(db.PendingUploads, row => row.Id == expireId);
            }
            var storage = factory.Services.GetRequiredService<StorageService>();
            await Assert.ThrowsAsync<AmazonS3Exception>(() =>
                storage.ListPartsAsync(expireKey, multipartId, CancellationToken.None));
        }
        finally
        {
            var incomplete = await admin.ListMultipartUploadsAsync(new ListMultipartUploadsRequest
            {
                BucketName = bucket,
            });
            foreach (var upload in incomplete.MultipartUploads ?? [])
                await admin.AbortMultipartUploadAsync(bucket, upload.Key, upload.UploadId);
            var objects = await admin.ListObjectsV2Async(new ListObjectsV2Request { BucketName = bucket });
            foreach (var item in objects.S3Objects ?? [])
                await admin.DeleteObjectAsync(bucket, item.Key);
            await admin.DeleteBucketAsync(bucket);
        }
    }
}

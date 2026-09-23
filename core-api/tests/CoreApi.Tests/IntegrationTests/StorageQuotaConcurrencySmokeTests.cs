using CoreApi.Data;
using CoreApi.Endpoints;
using CoreApi.Services;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>Opt-in real-PostgreSQL check of the reservation row lock.</summary>
public sealed class StorageQuotaConcurrencySmokeTests
{
    [Fact]
    public async Task Parallel_Users_Cannot_Overbook_Instance_Or_User_Storage()
    {
        var adminConnection = Environment.GetEnvironmentVariable("LETSCHAT_TEST_POSTGRES_URL");
        if (string.IsNullOrEmpty(adminConnection)) return;
        var database = $"letschat_quota_test_{Guid.NewGuid():N}";
        var builder = new NpgsqlConnectionStringBuilder(adminConnection) { Database = database };
        await using var admin = new NpgsqlConnection(adminConnection);
        await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{database}\"", admin))
            await create.ExecuteNonQueryAsync();
        try
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseNpgsql(builder.ConnectionString).Options;
            await using (var db = new AppDbContext(options))
            {
                await db.Database.MigrateAsync();
                db.SystemConfig.Add(new SystemConfig
                {
                    Id = SystemConfig.SingletonId,
                    UploadPartSizeMiB = 5,
                    UploadMaxFileSizeMiB = 500,
                    DailyUploadQuotaMiB = 100,
                    UserStorageLimitMiB = 10,
                    InstanceStorageLimitMiB = 10,
                });
                await db.SaveChangesAsync();
            }
            var inventory = new StorageInventoryState();
            inventory.MarkReady();

            async Task<bool> TryReserve(string username)
            {
                await using var db = new AppDbContext(options);
                try
                {
                    var id = Guid.NewGuid().ToString();
                    await UploadEndpoints.ReserveAsync(db, new PendingUpload
                    {
                        Id = id, Username = username,
                        StorageKey = $"uploads/avatar/{username}/{id}.bin",
                        FileName = "test.bin", MimeType = "application/octet-stream",
                        FileSize = 7 * UploadLimits.MiB,
                    }, false, inventory);
                    return true;
                }
                catch (ApiException ex) when (ex.Status == System.Net.HttpStatusCode.BadRequest)
                {
                    return false;
                }
            }

            var acrossUsers = await Task.WhenAll(TryReserve("alice"), TryReserve("bob"));
            Assert.Single(acrossUsers, accepted => accepted);
            await using (var db = new AppDbContext(options))
            {
                Assert.Equal(7 * UploadLimits.MiB,
                    await StorageUsage.RetainedAndPendingAsync(db, null));
                await db.PendingUploads.ExecuteDeleteAsync();
                var config = await db.SystemConfig.SingleAsync();
                config.InstanceStorageLimitMiB = 0;
                await db.SaveChangesAsync();
            }

            var sameUser = await Task.WhenAll(TryReserve("carol"), TryReserve("carol"));
            Assert.Single(sameUser, accepted => accepted);
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{database}\" WITH (FORCE)", admin);
            await drop.ExecuteNonQueryAsync();
        }
    }
}

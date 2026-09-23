using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>Opt-in upgrade test against a disposable PostgreSQL database.</summary>
public sealed class MultipartMigrationSmokeTests
{
    [Fact]
    public async Task Existing_Config_Seeds_New_Upload_Fields_Once()
    {
        var adminConnection = Environment.GetEnvironmentVariable("LETSCHAT_TEST_POSTGRES_URL");
        if (string.IsNullOrEmpty(adminConnection)) return;
        var database = $"letschat_multipart_test_{Guid.NewGuid():N}";
        var testBuilder = new NpgsqlConnectionStringBuilder(adminConnection) { Database = database };
        await using var admin = new NpgsqlConnection(adminConnection);
        await admin.OpenAsync();
        await using (var create = new NpgsqlCommand($"CREATE DATABASE \"{database}\"", admin))
            await create.ExecuteNonQueryAsync();
        try
        {
            var dbOptions = new DbContextOptionsBuilder<AppDbContext>()
                .UseNpgsql(testBuilder.ConnectionString).Options;
            await using (var db = new AppDbContext(dbOptions))
            {
                await db.Database.GetService<IMigrator>()
                    .MigrateAsync("20260919150000_TrackConfirmedUploads");
                await db.Database.ExecuteSqlRawAsync("""
                    INSERT INTO "SystemConfig" ("Id", "RegistrationOpen", "RequireEmailConfirmation",
                      "RequireAdminApproval", "RateLimitPermitLimit", "RateLimitWindowSeconds",
                      "SmtpHost", "SmtpPort", "SmtpUseStartTls", "EmailFromAddress",
                      "EmailFromName", "UpdatedAtUtc")
                    VALUES (1, true, true, false, 10, 300, 'localhost', 1025, false,
                      'test@example.com', 'Test', NOW())
                    """);
                await db.Database.MigrateAsync();
                var row = await db.SystemConfig.SingleAsync();
                Assert.Equal(0, row.UploadPartSizeMiB);
                Assert.Equal(0, row.UploadMaxFileSizeMiB);
                Assert.False(row.UploadQuotaSettingsSeeded);
            }

            var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["UPLOAD_PART_SIZE_MIB"] = "32",
                ["UPLOAD_MAX_FILE_SIZE_MIB"] = "400",
                ["DAILY_UPLOAD_QUOTA_MIB"] = "4096",
                ["USER_STORAGE_LIMIT_MIB"] = "8192",
                ["INSTANCE_STORAGE_LIMIT_MIB"] = "0",
            }).Build();
            var options = ServiceOptions.FromConfiguration(config);
            var services = new ServiceCollection()
                .AddDbContext<AppDbContext>(db => db.UseNpgsql(testBuilder.ConnectionString))
                .AddSingleton(options)
                .AddSingleton<SystemConfigService>()
                .BuildServiceProvider();
            await using (services)
            {
                var system = services.GetRequiredService<SystemConfigService>();
                await system.InitializeAsync();
                Assert.Equal(32, system.Current.UploadPartSizeMiB);
                Assert.Equal(400, system.Current.UploadMaxFileSizeMiB);
                Assert.Equal(4096, system.Current.DailyUploadQuotaMiB);
                Assert.Equal(8192, system.Current.UserStorageLimitMiB);
                Assert.True(system.Current.UploadQuotaSettingsSeeded);
                await system.UpdateAsync(row =>
                {
                    row.UploadPartSizeMiB = 16;
                    row.UserStorageLimitMiB = 500;
                });
                await system.InitializeAsync();
                Assert.Equal(16, system.Current.UploadPartSizeMiB);
                Assert.Equal(500, system.Current.UserStorageLimitMiB);
            }
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await using var drop = new NpgsqlCommand($"DROP DATABASE \"{database}\" WITH (FORCE)", admin);
            await drop.ExecuteNonQueryAsync();
        }
    }
}

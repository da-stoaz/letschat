using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CoreApi.Data.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260923190000_StorageQuotaSettings")]
public sealed class StorageQuotaSettings : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<long>(
            name: "DailyUploadQuotaMiB", table: "SystemConfig",
            type: "bigint", nullable: false, defaultValue: 0L);
        migrationBuilder.AddColumn<long>(
            name: "UserStorageLimitMiB", table: "SystemConfig",
            type: "bigint", nullable: false, defaultValue: 0L);
        migrationBuilder.AddColumn<long>(
            name: "InstanceStorageLimitMiB", table: "SystemConfig",
            type: "bigint", nullable: false, defaultValue: 0L);
        migrationBuilder.AddColumn<bool>(
            name: "UploadQuotaSettingsSeeded", table: "SystemConfig",
            type: "boolean", nullable: false, defaultValue: false);
        migrationBuilder.CreateIndex(
            name: "IX_ConfirmedUploads_Username", table: "ConfirmedUploads", column: "Username");
        migrationBuilder.CreateIndex(
            name: "IX_PendingUploads_Username", table: "PendingUploads", column: "Username");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(name: "IX_ConfirmedUploads_Username", table: "ConfirmedUploads");
        migrationBuilder.DropIndex(name: "IX_PendingUploads_Username", table: "PendingUploads");
        migrationBuilder.DropColumn(name: "DailyUploadQuotaMiB", table: "SystemConfig");
        migrationBuilder.DropColumn(name: "UserStorageLimitMiB", table: "SystemConfig");
        migrationBuilder.DropColumn(name: "InstanceStorageLimitMiB", table: "SystemConfig");
        migrationBuilder.DropColumn(name: "UploadQuotaSettingsSeeded", table: "SystemConfig");
    }
}

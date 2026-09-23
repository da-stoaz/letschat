using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CoreApi.Data.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260923120000_MultipartUploadSettings")]
public sealed class MultipartUploadSettings : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "UploadId", table: "ConfirmedUploads",
            type: "character varying(64)", maxLength: 64, nullable: true);
        migrationBuilder.CreateIndex(
            name: "IX_ConfirmedUploads_UploadId", table: "ConfirmedUploads",
            column: "UploadId", unique: true, filter: "\"UploadId\" IS NOT NULL");
        migrationBuilder.AddColumn<string>(
            name: "MultipartUploadId", table: "PendingUploads",
            type: "character varying(512)", maxLength: 512, nullable: true);
        migrationBuilder.AddColumn<long>(
            name: "PartSize", table: "PendingUploads",
            type: "bigint", nullable: false, defaultValue: 0L);
        migrationBuilder.AddColumn<int>(
            name: "UploadPartSizeMiB", table: "SystemConfig",
            type: "integer", nullable: false, defaultValue: 0);
        migrationBuilder.AddColumn<int>(
            name: "UploadMaxFileSizeMiB", table: "SystemConfig",
            type: "integer", nullable: false, defaultValue: 0);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(name: "IX_ConfirmedUploads_UploadId", table: "ConfirmedUploads");
        migrationBuilder.DropColumn(name: "UploadId", table: "ConfirmedUploads");
        migrationBuilder.DropColumn(name: "MultipartUploadId", table: "PendingUploads");
        migrationBuilder.DropColumn(name: "PartSize", table: "PendingUploads");
        migrationBuilder.DropColumn(name: "UploadPartSizeMiB", table: "SystemConfig");
        migrationBuilder.DropColumn(name: "UploadMaxFileSizeMiB", table: "SystemConfig");
    }
}

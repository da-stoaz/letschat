using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CoreApi.Data.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260924100000_VideoThumbnails")]
public sealed class VideoThumbnails : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "ThumbnailState", table: "ConfirmedUploads",
            type: "integer", nullable: false, defaultValue: 0);
        migrationBuilder.AddColumn<int>(
            name: "ThumbnailAttempts", table: "ConfirmedUploads",
            type: "integer", nullable: false, defaultValue: 0);
        // Backfill: every existing video gets a poster job (1 = Pending).
        migrationBuilder.Sql("""
            UPDATE "ConfirmedUploads" SET "ThumbnailState" = 1
            WHERE "MimeType" LIKE 'video/%'
               OR lower("StorageKey") ~ '\.(mp4|m4v|mov|webm|mkv)$'
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "ThumbnailState", table: "ConfirmedUploads");
        migrationBuilder.DropColumn(name: "ThumbnailAttempts", table: "ConfirmedUploads");
    }
}

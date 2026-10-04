using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CoreApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class VideoPlayback : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "VideoAttempts",
                table: "ConfirmedUploads",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<long>(
                name: "VideoBytes",
                table: "ConfirmedUploads",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "VideoManifest",
                table: "ConfirmedUploads",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "VideoState",
                table: "ConfirmedUploads",
                type: "integer",
                nullable: false,
                defaultValue: 0);
            // Existing uploads enter the same bounded queue as new videos.
            migrationBuilder.Sql("""
                UPDATE "ConfirmedUploads" SET "VideoState" = 1
                WHERE "MimeType" LIKE 'video/%'
                   OR lower("StorageKey") ~ '\.(mp4|m4v|mov|webm|mkv)$'
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "VideoAttempts",
                table: "ConfirmedUploads");

            migrationBuilder.DropColumn(
                name: "VideoBytes",
                table: "ConfirmedUploads");

            migrationBuilder.DropColumn(
                name: "VideoManifest",
                table: "ConfirmedUploads");

            migrationBuilder.DropColumn(
                name: "VideoState",
                table: "ConfirmedUploads");
        }
    }
}

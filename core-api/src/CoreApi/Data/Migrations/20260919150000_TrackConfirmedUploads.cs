using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CoreApi.Data.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260919150000_TrackConfirmedUploads")]
public sealed class TrackConfirmedUploads : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "ConfirmedUploads",
            columns: table => new
            {
                StorageKey = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                Username = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                FileName = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                FileSize = table.Column<long>(type: "bigint", nullable: false),
                MimeType = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                ConfirmedAt = table.Column<long>(type: "bigint", nullable: false),
            },
            constraints: table => table.PrimaryKey("PK_ConfirmedUploads", row => row.StorageKey));

        migrationBuilder.CreateIndex(
            name: "IX_ConfirmedUploads_ConfirmedAt",
            table: "ConfirmedUploads",
            column: "ConfirmedAt");
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropTable(name: "ConfirmedUploads");
}

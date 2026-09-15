using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CoreApi.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPendingUploadQuotaDate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "QuotaDate",
                table: "PendingUploads",
                type: "character varying(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "QuotaDate",
                table: "PendingUploads");
        }
    }
}

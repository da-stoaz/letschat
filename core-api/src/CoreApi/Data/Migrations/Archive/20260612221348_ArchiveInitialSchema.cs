using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CoreApi.Data.Migrations.Archive
{
    /// <inheritdoc />
    public partial class ArchiveInitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "archive_ban",
                columns: table => new
                {
                    ban_key = table.Column<string>(type: "text", nullable: false),
                    server_id = table.Column<long>(type: "bigint", nullable: false),
                    user_identity = table.Column<string>(type: "text", nullable: false),
                    banned_by = table.Column<string>(type: "text", nullable: false),
                    reason = table.Column<string>(type: "text", nullable: true),
                    banned_at = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_ban", x => x.ban_key);
                });

            migrationBuilder.CreateTable(
                name: "archive_block",
                columns: table => new
                {
                    block_key = table.Column<string>(type: "text", nullable: false),
                    blocker = table.Column<string>(type: "text", nullable: false),
                    blocked = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_block", x => x.block_key);
                });

            migrationBuilder.CreateTable(
                name: "archive_channel",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false),
                    server_id = table.Column<long>(type: "bigint", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    kind = table.Column<string>(type: "text", nullable: false),
                    position = table.Column<long>(type: "bigint", nullable: false),
                    moderator_only = table.Column<bool>(type: "boolean", nullable: false),
                    section = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_channel", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "archive_direct_message",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false),
                    sender_identity = table.Column<string>(type: "text", nullable: false),
                    recipient_identity = table.Column<string>(type: "text", nullable: false),
                    content = table.Column<string>(type: "text", nullable: false),
                    sent_at = table.Column<long>(type: "bigint", nullable: false),
                    edited_at = table.Column<long>(type: "bigint", nullable: true),
                    deleted_by_sender = table.Column<bool>(type: "boolean", nullable: false),
                    deleted_by_recipient = table.Column<bool>(type: "boolean", nullable: false),
                    conversation_key = table.Column<string>(type: "text", nullable: true, computedColumnSql: "LEAST(sender_identity, recipient_identity) || ':' || GREATEST(sender_identity, recipient_identity)", stored: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_direct_message", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "archive_dm_server_invite",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false),
                    server_id = table.Column<long>(type: "bigint", nullable: false),
                    invite_token = table.Column<string>(type: "text", nullable: false),
                    sender_identity = table.Column<string>(type: "text", nullable: false),
                    recipient_identity = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_dm_server_invite", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "archive_friend",
                columns: table => new
                {
                    pair_key = table.Column<string>(type: "text", nullable: false),
                    user_a = table.Column<string>(type: "text", nullable: false),
                    user_b = table.Column<string>(type: "text", nullable: false),
                    status = table.Column<string>(type: "text", nullable: false),
                    requested_by = table.Column<string>(type: "text", nullable: false),
                    updated_at = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_friend", x => x.pair_key);
                });

            migrationBuilder.CreateTable(
                name: "archive_invite",
                columns: table => new
                {
                    token = table.Column<string>(type: "text", nullable: false),
                    server_id = table.Column<long>(type: "bigint", nullable: false),
                    created_by = table.Column<string>(type: "text", nullable: false),
                    expires_at = table.Column<long>(type: "bigint", nullable: false),
                    max_uses = table.Column<long>(type: "bigint", nullable: true),
                    use_count = table.Column<long>(type: "bigint", nullable: false),
                    allowed_usernames = table.Column<string[]>(type: "text[]", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_invite", x => x.token);
                });

            migrationBuilder.CreateTable(
                name: "archive_join_request",
                columns: table => new
                {
                    request_key = table.Column<string>(type: "text", nullable: false),
                    server_id = table.Column<long>(type: "bigint", nullable: false),
                    user_identity = table.Column<string>(type: "text", nullable: false),
                    created_at = table.Column<long>(type: "bigint", nullable: false),
                    declined = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_join_request", x => x.request_key);
                });

            migrationBuilder.CreateTable(
                name: "archive_message",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false),
                    channel_id = table.Column<long>(type: "bigint", nullable: false),
                    sender_identity = table.Column<string>(type: "text", nullable: false),
                    content = table.Column<string>(type: "text", nullable: false),
                    sent_at = table.Column<long>(type: "bigint", nullable: false),
                    edited_at = table.Column<long>(type: "bigint", nullable: true),
                    deleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_message", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "archive_read_state",
                columns: table => new
                {
                    read_key = table.Column<string>(type: "text", nullable: false),
                    scope_key = table.Column<string>(type: "text", nullable: false),
                    user_identity = table.Column<string>(type: "text", nullable: false),
                    last_read_at = table.Column<long>(type: "bigint", nullable: false),
                    updated_at = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_read_state", x => x.read_key);
                });

            migrationBuilder.CreateTable(
                name: "archive_server",
                columns: table => new
                {
                    id = table.Column<long>(type: "bigint", nullable: false),
                    name = table.Column<string>(type: "text", nullable: false),
                    owner_identity = table.Column<string>(type: "text", nullable: false),
                    invite_policy = table.Column<string>(type: "text", nullable: false),
                    icon_url = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<long>(type: "bigint", nullable: false),
                    is_discoverable = table.Column<bool>(type: "boolean", nullable: false),
                    description = table.Column<string>(type: "text", nullable: true),
                    tags = table.Column<string[]>(type: "text[]", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_server", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "archive_server_member",
                columns: table => new
                {
                    member_key = table.Column<string>(type: "text", nullable: false),
                    server_id = table.Column<long>(type: "bigint", nullable: false),
                    user_identity = table.Column<string>(type: "text", nullable: false),
                    role = table.Column<string>(type: "text", nullable: false),
                    joined_at = table.Column<long>(type: "bigint", nullable: false),
                    timeout_until = table.Column<long>(type: "bigint", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_server_member", x => x.member_key);
                });

            migrationBuilder.CreateTable(
                name: "archive_user",
                columns: table => new
                {
                    identity = table.Column<string>(type: "text", nullable: false),
                    username = table.Column<string>(type: "text", nullable: false),
                    display_name = table.Column<string>(type: "text", nullable: false),
                    avatar_url = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<long>(type: "bigint", nullable: false),
                    is_admin = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_archive_user", x => x.identity);
                });

            migrationBuilder.CreateTable(
                name: "replication_state",
                columns: table => new
                {
                    table_name = table.Column<string>(type: "text", nullable: false),
                    last_full_sync_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    last_reconcile_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    row_count = table.Column<long>(type: "bigint", nullable: false, defaultValue: 0L),
                    updated_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_replication_state", x => x.table_name);
                });

            migrationBuilder.CreateIndex(
                name: "IX_archive_ban_server_id",
                table: "archive_ban",
                column: "server_id");

            migrationBuilder.CreateIndex(
                name: "IX_archive_channel_server_id",
                table: "archive_channel",
                column: "server_id");

            migrationBuilder.CreateIndex(
                name: "IX_archive_direct_message_conversation_key_sent_at",
                table: "archive_direct_message",
                columns: new[] { "conversation_key", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "IX_archive_invite_server_id",
                table: "archive_invite",
                column: "server_id");

            migrationBuilder.CreateIndex(
                name: "IX_archive_join_request_server_id",
                table: "archive_join_request",
                column: "server_id");

            migrationBuilder.CreateIndex(
                name: "IX_archive_message_channel_id_sent_at",
                table: "archive_message",
                columns: new[] { "channel_id", "sent_at" });

            migrationBuilder.CreateIndex(
                name: "IX_archive_server_member_server_id",
                table: "archive_server_member",
                column: "server_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "archive_ban");

            migrationBuilder.DropTable(
                name: "archive_block");

            migrationBuilder.DropTable(
                name: "archive_channel");

            migrationBuilder.DropTable(
                name: "archive_direct_message");

            migrationBuilder.DropTable(
                name: "archive_dm_server_invite");

            migrationBuilder.DropTable(
                name: "archive_friend");

            migrationBuilder.DropTable(
                name: "archive_invite");

            migrationBuilder.DropTable(
                name: "archive_join_request");

            migrationBuilder.DropTable(
                name: "archive_message");

            migrationBuilder.DropTable(
                name: "archive_read_state");

            migrationBuilder.DropTable(
                name: "archive_server");

            migrationBuilder.DropTable(
                name: "archive_server_member");

            migrationBuilder.DropTable(
                name: "archive_user");

            migrationBuilder.DropTable(
                name: "replication_state");
        }
    }
}

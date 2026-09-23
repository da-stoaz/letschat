using System.Net;
using System.Text;
using System.Text.Json;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// <c>/uploads/download-url(s)</c> authorization (BUG_ANALYSIS A6): a real
/// registered account, a stubbed SpacetimeDB <c>/sql</c> transport standing in
/// for the caller's <c>my_*</c> views, and the key-scope rules in between.
/// Also pins that <c>/uploads/request</c> writes the scope into the key.
/// </summary>
public sealed class UploadAccessTests
{
    private static async Task<(JsonElement SessionToken, string Identity)> RegisterAsync(
        HttpClient client, string username)
    {
        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/auth/register",
            new
            {
                username,
                displayName = username,
                password = "supersecret-test-1",
                email = $"{username}@test.local",
            });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var auth = doc.RootElement.GetProperty("auth");
        return (auth.GetProperty("sessionToken").Clone(),
                auth.GetProperty("spacetimeIdentity").GetString()!);
    }

    private static Task<HttpResponseMessage> DownloadUrlAsync(
        HttpClient client, JsonElement sessionToken, string storageKey) =>
        LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/uploads/download-url", new { sessionToken, storageKey });

    private static async Task<List<string>> DownloadUrlsAsync(
        HttpClient client, JsonElement sessionToken, params string[] storageKeys)
    {
        var response = await LetsChatWebApplicationFactory.PostJsonAsync(
            client, "/uploads/download-urls", new { sessionToken, storageKeys });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("items").EnumerateArray()
            .Select(item => item.GetProperty("storageKey").GetString()!)
            .ToList();
    }

    // ── Scoped keys ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Dm_Key_Is_Readable_By_Both_Parties_And_Nobody_Else_Without_Asking_The_Module()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "alice");
        var (bob, _) = await RegisterAsync(client, "bob");
        var (carol, _) = await RegisterAsync(client, "carol");

        const string key = "uploads/dm/alice/bob/11111111-1111-1111-1111-111111111111.png";

        Assert.Equal(HttpStatusCode.OK, (await DownloadUrlAsync(client, alice, key)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await DownloadUrlAsync(client, bob, key)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await DownloadUrlAsync(client, carol, key)).StatusCode);
        Assert.Empty(spacetime.Queries);
    }

    [Fact]
    public async Task Avatar_Key_Is_Readable_By_Any_Account()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        var (stranger, _) = await RegisterAsync(client, "stranger");

        var response = await DownloadUrlAsync(client, stranger, "uploads/avatar/someone/x.png");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(spacetime.Queries);
    }

    [Fact]
    public async Task Channel_Key_Is_Readable_Only_While_The_Module_Shows_The_Caller_The_Channel()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        var (member, identity) = await RegisterAsync(client, "member");

        const string key = "uploads/ch/5/poster/x.pdf";

        spacetime.Respond = sql => sql.Contains("my_channels WHERE id = 5") ? "[[5]]" : "[]";
        var admitted = await DownloadUrlAsync(client, member, key);
        Assert.Equal(HttpStatusCode.OK, admitted.StatusCode);

        // The query must run AS THE CALLER: that is the whole gate.
        var subject = new JsonWebToken(spacetime.LastBearer!).Subject;
        var tokens = factory.Services.GetRequiredService<SpacetimeTokenService>();
        Assert.Equal(identity, tokens.ComputeIdentityHex(subject));

        // Kicked: the view no longer returns the channel.
        spacetime.Respond = _ => "[]";
        var kicked = await DownloadUrlAsync(client, member, key);
        Assert.Equal(HttpStatusCode.Forbidden, kicked.StatusCode);
    }

    [Fact]
    public async Task Icon_Key_Is_Readable_While_The_Space_Is_Visible()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        var (viewer, _) = await RegisterAsync(client, "viewer");

        const string key = "uploads/icon/3/owner/x.png";

        spacetime.Respond = sql => sql.Contains("my_servers WHERE id = 3") ? "[[3]]" : "[]";
        Assert.Equal(HttpStatusCode.OK, (await DownloadUrlAsync(client, viewer, key)).StatusCode);

        spacetime.Respond = _ => "[]";
        Assert.Equal(HttpStatusCode.Forbidden, (await DownloadUrlAsync(client, viewer, key)).StatusCode);
    }

    [Fact]
    public async Task An_Unreachable_Module_Is_A_503_Not_A_403()
    {
        using var spacetime = new SqlStub { Status = HttpStatusCode.BadGateway };
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        var (member, _) = await RegisterAsync(client, "member");

        var response = await DownloadUrlAsync(client, member, "uploads/ch/5/poster/x.pdf");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    // ── Legacy keys ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Legacy_Key_Is_Readable_By_Its_Uploader_And_By_Whoever_Can_See_Them()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "alice");
        var (bob, _) = await RegisterAsync(client, "bob");

        const string key = "uploads/2026/01/02/alice/x.png";

        Assert.Equal(HttpStatusCode.OK, (await DownloadUrlAsync(client, alice, key)).StatusCode);
        Assert.Empty(spacetime.Queries);

        spacetime.Respond = sql => sql.Contains("my_visible_users WHERE username = 'alice'") ? "[[\"alice\"]]" : "[]";
        Assert.Equal(HttpStatusCode.OK, (await DownloadUrlAsync(client, bob, key)).StatusCode);

        // Banned from every space they shared: alice is no longer visible.
        spacetime.Respond = _ => "[]";
        Assert.Equal(HttpStatusCode.Forbidden, (await DownloadUrlAsync(client, bob, key)).StatusCode);
    }

    [Fact]
    public async Task Legacy_Icon_Of_A_Visible_Space_Is_Readable_Only_When_The_Owner_Uploaded_It()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        var (browser, _) = await RegisterAsync(client, "browser");
        var (_, ownerIdentity) = await RegisterAsync(client, "owner");
        var (_, impostorIdentity) = await RegisterAsync(client, "impostor");

        const string key = "uploads/2026/01/02/owner/icon.png";

        // Discover: the space is visible, its owner is invisible, and the icon
        // is the owner's own upload. Row shape as the module really returns it:
        // Option positional ([0, value] is `some`), Identity 0x-prefixed.
        spacetime.Respond = sql => sql.Contains("icon_url, owner_identity FROM my_servers")
            ? $"[[[0, \"{key}\"], [\"0x{ownerIdentity}\"]]]"
            : "[]";
        Assert.Equal(HttpStatusCode.OK, (await DownloadUrlAsync(client, browser, key)).StatusCode);

        // Someone else's space pointing its icon at the owner's key must not
        // read it back through this rule.
        spacetime.Respond = sql => sql.Contains("icon_url, owner_identity FROM my_servers")
            ? $"[[[0, \"{key}\"], [\"{impostorIdentity}\"]]]"
            : "[]";
        Assert.Equal(HttpStatusCode.Forbidden, (await DownloadUrlAsync(client, browser, key)).StatusCode);
    }

    // ── Shape ────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("uploads/x.png")]
    [InlineData("other/ch/5/poster/x.png")]
    [InlineData("uploads/ch/notanumber/poster/x.png")]
    [InlineData("uploads/ch/5/po'ster/x.png")]
    [InlineData("uploads/dm/alice/x.png")]
    [InlineData("uploads/2026/01/02/alice/")]
    public async Task A_Key_Outside_The_Known_Shapes_Is_Rejected(string key)
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        var (user, _) = await RegisterAsync(client, "user");

        var response = await DownloadUrlAsync(client, user, key);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(spacetime.Queries);
    }

    [Fact]
    public async Task Batch_Leaves_Out_Denied_Keys_And_Asks_Once_Per_Scope()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        var (bob, _) = await RegisterAsync(client, "bob");

        spacetime.Respond = sql => sql.Contains("my_channels WHERE id = 5") ? "[[5]]" : "[]";

        var items = await DownloadUrlsAsync(client, bob,
            "uploads/ch/5/amy/1.png",
            "uploads/ch/5/amy/2.png",
            "uploads/ch/9/amy/3.png",
            "uploads/dm/alice/bob/4.png",
            "uploads/dm/alice/carol/5.png",
            "uploads/avatar/zed/6.png");

        Assert.Equal(
            ["uploads/ch/5/amy/1.png", "uploads/ch/5/amy/2.png", "uploads/dm/alice/bob/4.png", "uploads/avatar/zed/6.png"],
            items);
        Assert.Equal(2, spacetime.Queries.Count); // ch:5 once, ch:9 once
    }

    // ── /uploads/request ─────────────────────────────────────────────────────

    [Theory]
    [InlineData("channel", "uploads/ch/5/alice/")]
    [InlineData("dm", "uploads/dm/alice/bob/")]
    [InlineData("avatar", "uploads/avatar/alice/")]
    [InlineData("icon", "uploads/icon/3/alice/")]
    public async Task Request_Writes_The_Scope_Into_The_Key(string kind, string prefix)
    {
        using var factory = new LetsChatWebApplicationFactory();
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "alice");

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
        {
            sessionToken = alice,
            fileName = "photo.png",
            fileSize = 16,
            mimeType = "image/png",
            scope = new { kind, channelId = 5, partner = "Bob", serverId = 3 },
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var uploadUrl = doc.RootElement.GetProperty("uploadUrl").GetString()!;
        Assert.Contains($"/{prefix}", uploadUrl);
        Assert.EndsWith(".png", new Uri(uploadUrl).AbsolutePath);
    }

    [Fact]
    public async Task Request_Without_A_Scope_Still_Yields_A_Legacy_Key()
    {
        using var factory = new LetsChatWebApplicationFactory();
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "alice");

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
        {
            sessionToken = alice,
            fileName = "photo.png",
            fileSize = 16,
            mimeType = "image/png",
        });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var path = new Uri(doc.RootElement.GetProperty("uploadUrl").GetString()!).AbsolutePath;
        Assert.NotNull(StorageKey.TryParse(path[(path.IndexOf("uploads/", StringComparison.Ordinal))..]));
        Assert.Equal(StorageScope.Legacy, StorageKey.TryParse(path[(path.IndexOf("uploads/", StringComparison.Ordinal))..])!.Scope);
    }

    [Fact]
    public async Task Pending_Uploads_Reserve_The_Daily_Quota_Without_Confirm()
    {
        using var factory = new LetsChatWebApplicationFactory();
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "quotauser");

        for (var requestNumber = 0; requestNumber < 32; requestNumber++)
        {
            var accepted = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
            {
                sessionToken = alice,
                fileName = $"large-{requestNumber}.bin",
                fileSize = 64L * 1024 * 1024,
                mimeType = "application/octet-stream",
                scope = new { kind = "channel", channelId = 1 },
            });
            Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        }

        var rejected = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
        {
            sessionToken = alice,
            fileName = "one-too-many.bin",
            fileSize = 64L * 1024 * 1024,
            mimeType = "application/octet-stream",
            scope = new { kind = "channel", channelId = 1 },
        });

        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
    }

    [Fact]
    public async Task Configured_Daily_User_And_Instance_Limits_Count_Pending_And_Confirmed_Objects()
    {
        using var factory = new LetsChatWebApplicationFactory();
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "storagealice");
        var (bob, _) = await RegisterAsync(client, "storagebob");
        factory.Services.GetRequiredService<StorageInventoryState>().MarkReady();
        var config = factory.Services.GetRequiredService<SystemConfigService>();
        await config.UpdateAsync(row =>
        {
            row.DailyUploadQuotaMiB = 10;
            row.UserStorageLimitMiB = 12;
            row.InstanceStorageLimitMiB = 20;
        });

        Task<HttpResponseMessage> Request(JsonElement token, int mib, string name) =>
            LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
            {
                sessionToken = token,
                fileName = name,
                fileSize = mib * UploadLimits.MiB,
                mimeType = "application/octet-stream",
            });

        Assert.Equal(HttpStatusCode.OK, (await Request(alice, 6, "alice-first.bin")).StatusCode);
        var daily = await Request(alice, 6, "alice-daily.bin");
        Assert.Equal(HttpStatusCode.BadRequest, daily.StatusCode);
        Assert.Contains("Daily upload quota", await daily.Content.ReadAsStringAsync());

        await config.UpdateAsync(row => row.DailyUploadQuotaMiB = 30);
        Assert.Equal(HttpStatusCode.OK, (await Request(alice, 6, "alice-second.bin")).StatusCode);
        var user = await Request(alice, 1, "alice-stored.bin");
        Assert.Equal(HttpStatusCode.BadRequest, user.StatusCode);
        Assert.Contains("stored-file quota", await user.Content.ReadAsStringAsync());

        Assert.Equal(HttpStatusCode.OK, (await Request(bob, 7, "bob-first.bin")).StatusCode);
        var instance = await Request(bob, 2, "bob-instance.bin");
        Assert.Equal(HttpStatusCode.BadRequest, instance.StatusCode);
        Assert.Contains("instance", await instance.Content.ReadAsStringAsync());

        var usage = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/quota",
            new { sessionToken = alice });
        Assert.Equal(HttpStatusCode.OK, usage.StatusCode);
        using var doc = JsonDocument.Parse(await usage.Content.ReadAsStringAsync());
        Assert.Equal(12 * UploadLimits.MiB,
            doc.RootElement.GetProperty("userStoredAndPendingBytes").GetInt64());
        Assert.Equal(12 * UploadLimits.MiB,
            doc.RootElement.GetProperty("dailyReservedBytes").GetInt64());

        using var scope = factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var promoted = db.PendingUploads.Single(row => row.FileName == "alice-first.bin");
        db.ConfirmedUploads.Add(new ConfirmedUpload
        {
            StorageKey = promoted.StorageKey, Username = promoted.Username,
            FileName = promoted.FileName, FileSize = promoted.FileSize,
            MimeType = promoted.MimeType, ConfirmedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        });
        db.PendingUploads.Remove(promoted);
        await db.SaveChangesAsync();
        Assert.Equal(19 * UploadLimits.MiB, await StorageUsage.RetainedAndPendingAsync(db, null));

        // A failed object deletion leaves the row charged; only successful
        // MinIO deletion followed by registry removal releases the allowance.
        db.ConfirmedUploads.Remove(db.ConfirmedUploads.Single());
        await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.OK, (await Request(bob, 2, "bob-after-cleanup.bin")).StatusCode);
    }

    [Fact]
    public async Task Stored_Quota_Rejects_New_Reservations_Until_Inventory_Is_Complete()
    {
        using var factory = new LetsChatWebApplicationFactory();
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "inventorystatus");
        await factory.Services.GetRequiredService<SystemConfigService>()
            .UpdateAsync(row => row.UserStorageLimitMiB = 10);

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
        {
            sessionToken = alice,
            fileName = "test.bin",
            fileSize = 1,
            mimeType = "application/octet-stream",
        });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
        Assert.Contains("Storage usage is still being checked", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Admin_Limits_Appear_In_Discovery_And_Gate_New_Uploads()
    {
        using var factory = new LetsChatWebApplicationFactory();
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "uploadlimits");
        var config = factory.Services.GetRequiredService<SystemConfigService>();
        await config.UpdateAsync(row =>
        {
            row.UploadPartSizeMiB = 8;
            row.UploadMaxFileSizeMiB = 16;
        });

        using var discovery = JsonDocument.Parse(await client.GetStringAsync("/.well-known/letschat.json"));
        Assert.Equal(8L * 1024 * 1024,
            discovery.RootElement.GetProperty("uploadPartSizeBytes").GetInt64());
        Assert.Equal(16L * 1024 * 1024,
            discovery.RootElement.GetProperty("uploadMaxFileSizeBytes").GetInt64());

        var oversized = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
        {
            sessionToken = alice,
            fileName = "too-large.bin",
            fileSize = 17L * 1024 * 1024,
            mimeType = "application/octet-stream",
        });
        Assert.Equal(HttpStatusCode.BadRequest, oversized.StatusCode);

        var oldClient = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
        {
            sessionToken = alice,
            fileName = "needs-multipart.bin",
            fileSize = 9L * 1024 * 1024,
            mimeType = "application/octet-stream",
        });
        Assert.Equal(HttpStatusCode.OK, oldClient.StatusCode);
        using (var oldResponse = JsonDocument.Parse(await oldClient.Content.ReadAsStringAsync()))
            Assert.Equal("single", oldResponse.RootElement.GetProperty("mode").GetString());

        var small = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
        {
            sessionToken = alice,
            fileName = "small.bin",
            fileSize = 8L * 1024 * 1024,
            mimeType = "application/octet-stream",
        });
        Assert.Equal(HttpStatusCode.OK, small.StatusCode);
    }

    [Fact]
    public async Task Avatar_Limit_Is_Enforced_By_The_Server()
    {
        using var factory = new LetsChatWebApplicationFactory();
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "avatarowner");

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
        {
            sessionToken = alice,
            fileName = "oversized.png",
            fileSize = 10L * 1024 * 1024 + 1,
            mimeType = "image/png",
            scope = new { kind = "avatar" },
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Storage_Deletion_Claims_Require_The_Admin_View_Sentinel()
    {
        using var spacetime = new SqlStub();
        using var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime };
        var client = factory.CreateClient();
        await RegisterAsync(client, "cleanupadmin");

        using (var scope = factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var admin = await users.FindByNameAsync("cleanupadmin");
            Assert.NotNull(admin);
            Assert.True((await users.AddToRoleAsync(admin, DbInitializer.AdminRole)).Succeeded);
        }

        var service = factory.Services.GetRequiredService<SpacetimeClient>();
        var keys = new[] { "uploads/avatar/cleanupadmin/live.png" };

        // A valid HTTP response from a non-admin token is deliberately empty.
        // It must remain "unknown", never be interpreted as "delete all".
        spacetime.Respond = _ => "[]";
        Assert.Null(await service.ClaimUnreferencedStorageAsync(keys));

        const string sentinel = "__letschat_cleanup_authorized__";
        spacetime.Respond = _ => $"[[\"{sentinel}\"],[\"{keys[0]}\"]]";
        var claimed = await service.ClaimUnreferencedStorageAsync(keys);
        Assert.NotNull(claimed);
        Assert.Contains(keys[0], claimed);
        Assert.DoesNotContain(sentinel, claimed);
        var claimCalls = spacetime.ReducerCalls
            .Where(call => call.Path.EndsWith(
                "/call/claim_unreferenced_storage", StringComparison.Ordinal))
            .ToList();
        Assert.Equal(2, claimCalls.Count);
        var claimCall = claimCalls[^1];
        using var claimArgs = JsonDocument.Parse(claimCall.Body);
        Assert.Equal(32, claimArgs.RootElement[0].GetString()!.Length);
        Assert.Equal(keys[0], claimArgs.RootElement[1][0].GetString());
        Assert.Equal(spacetime.LastClaimBearer, spacetime.LastBearer);
        Assert.Contains(spacetime.Queries,
            query => query.Contains("storage_deletion_claims_for_cleanup", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("dm", "no partner")]
    [InlineData("channel", "no channel")]
    [InlineData("bogus", "unknown kind")]
    public async Task Request_With_An_Incomplete_Scope_Is_Rejected(string kind, string _)
    {
        using var factory = new LetsChatWebApplicationFactory();
        var client = factory.CreateClient();
        var (alice, _) = await RegisterAsync(client, "alice");

        var response = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/request", new
        {
            sessionToken = alice,
            fileName = "photo.png",
            fileSize = 16,
            mimeType = "image/png",
            scope = new { kind },
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// SpacetimeDB <c>/sql</c> stand-in: answers each statement through
    /// <see cref="Respond"/> and records what was asked, and by whom.
    /// </summary>
    private sealed class SqlStub : HttpMessageHandler
    {
        public HttpStatusCode Status { get; init; } = HttpStatusCode.OK;
        public Func<string, string> Respond { get; set; } = _ => "[]";
        public List<string> Queries { get; } = [];
        public List<(string Path, string Body)> ReducerCalls { get; } = [];
        public string? LastBearer { get; private set; }
        public string? LastClaimBearer { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var sql = request.Content is null ? string.Empty : await request.Content.ReadAsStringAsync(cancellationToken);
            // Registration also drives reducer calls (admin sync, issuer pin)
            // through this client; only the /sql reads are the gate under test.
            if (request.RequestUri!.AbsolutePath.EndsWith("/sql", StringComparison.Ordinal))
            {
                LastBearer = request.Headers.Authorization?.Parameter;
                Queries.Add(sql);
            }
            else if (request.RequestUri.AbsolutePath.Contains("/call/", StringComparison.Ordinal))
            {
                ReducerCalls.Add((request.RequestUri.AbsolutePath, sql));
                if (request.RequestUri.AbsolutePath.EndsWith(
                    "/call/claim_unreferenced_storage", StringComparison.Ordinal))
                {
                    LastClaimBearer = request.Headers.Authorization?.Parameter;
                }
            }
            return new HttpResponseMessage(Status)
            {
                Content = new StringContent(
                    $"[{{\"rows\":{Respond(sql)}}}]", Encoding.UTF8, "application/json"),
            };
        }
    }
}

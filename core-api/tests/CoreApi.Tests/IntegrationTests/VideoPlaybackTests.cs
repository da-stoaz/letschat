using System.Net;
using System.Text.Json;
using CoreApi.Configuration;
using CoreApi.Data;
using CoreApi.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;

namespace CoreApi.Tests.IntegrationTests;

public sealed class VideoPlaybackTests
{
    [Theory]
    [InlineData(3840, 2160, 720, 1280, 720)]
    [InlineData(2160, 3840, 1080, 1080, 1920)]
    [InlineData(1920, 800, 720, 1280, 532)]
    [InlineData(640, 359, 1080, 640, 358)]
    public void Renditions_Preserve_Aspect_And_Do_Not_Upscale(int w, int h, int edge, int expectedW, int expectedH) =>
        Assert.Equal((expectedW, expectedH), VideoPlayback.Fit(w, h, edge));

    [Theory]
    [InlineData("../original.mp4")]
    [InlineData("https://evil.test/file")]
    [InlineData("file:///etc/passwd")]
    [InlineData("#EXT-X-KEY:METHOD=AES-128,URI=\"https://evil.test/key\"")]
    public async Task Manifest_Cannot_Sign_Foreign_Objects_Or_Fetch_Uploaded_Urls(string line) =>
        await Assert.ThrowsAsync<InvalidOperationException>(() => VideoPlayback.SignPlaylistAsync("#EXTM3U\n" + line, Task.FromResult));

    [Fact]
    public async Task Grants_Are_Video_Scoped_And_Survive_A_New_Api_Instance()
    {
        var options = ServiceOptions.FromConfiguration(new ConfigurationBuilder().Build());
        var first = new VideoPlaybackAccess(options);
        var second = new VideoPlaybackAccess(options);
        var token = first.Issue("uploads/dm/alice/bob/video.mp4");
        var grant = await second.ReadAsync(token);
        Assert.Equal("uploads/dm/alice/bob/video.mp4", grant?.Key);
        Assert.InRange(grant!.Value.RemainingSeconds, 3500, 3600);
        Assert.Null(await second.ReadAsync(token + "invalid"));
        Assert.Null(await second.ReadAsync("not-a-token"));
        var session = new TokenService(options).IssueSession("alice", [], 0);
        Assert.Null(await second.ReadAsync(session.access_token));
    }

    [Fact]
    public async Task Playback_Requires_Original_Access_And_Only_Signs_That_Videos_Segments()
    {
        using var factory = new LetsChatWebApplicationFactory();
        var client = factory.CreateClient();
        async Task<JsonElement> Register(string username)
        {
            var response = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/auth/register", new
            {
                username, displayName = username, password = "supersecret-test-1", email = username + "@test.local",
            });
            response.EnsureSuccessStatusCode();
            using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            return doc.RootElement.GetProperty("auth").GetProperty("sessionToken").Clone();
        }
        var alice = await Register("alice");
        var carol = await Register("carol");
        const string key = "uploads/dm/alice/bob/video.mp4";
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.ConfirmedUploads.Add(new ConfirmedUpload
            {
                StorageKey = key, Username = "alice", FileName = "video.mp4", FileSize = 100, MimeType = "video/mp4",
                VideoState = ThumbnailState.Done, VideoBytes = 50,
                VideoManifest = JsonSerializer.Serialize(new[] { new VideoRendition(1280, 720, 3200000, "v0",
                    "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nv0_00000.ts\n#EXT-X-ENDLIST\n") }),
            });
            await db.SaveChangesAsync();
            Assert.Equal(150, await StorageUsage.RetainedAndPendingAsync(db, "alice"));
        }
        var denied = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/video-playback", new { sessionToken = carol, storageKey = key });
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        var allowed = await LetsChatWebApplicationFactory.PostJsonAsync(client, "/uploads/video-playback", new { sessionToken = alice, storageKey = key });
        allowed.EnsureSuccessStatusCode();
        using var result = JsonDocument.Parse(await allowed.Content.ReadAsStringAsync());
        var masterPath = result.RootElement.GetProperty("manifestPath").GetString()!;
        var master = await client.GetAsync(masterPath);
        Assert.Equal("application/vnd.apple.mpegurl", master.Content.Headers.ContentType?.MediaType);
        Assert.True(master.Headers.CacheControl?.NoStore);
        Assert.Contains("RESOLUTION=1280x720\nv0.m3u8", await master.Content.ReadAsStringAsync());
        var variant = await client.GetStringAsync(masterPath.Replace("master.m3u8", "v0.m3u8"));
        Assert.Contains(VideoPlayback.Prefix(key) + "v0_00000.ts", variant);
        Assert.Contains("X-Amz-Signature", variant);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(masterPath.Replace("master.m3u8", "other.m3u8"))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/uploads/video/invalid/master.m3u8")).StatusCode);
        using (var scope = factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.ConfirmedUploads.Remove(await db.ConfirmedUploads.SingleAsync());
            await db.SaveChangesAsync();
        }
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(masterPath)).StatusCode);
    }
}

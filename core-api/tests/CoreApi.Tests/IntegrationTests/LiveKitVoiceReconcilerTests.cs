using System.Net;
using System.Text;
using CoreApi.Data;
using CoreApi.Endpoints;
using CoreApi.Services;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CoreApi.Tests.IntegrationTests;

/// <summary>
/// BUG_ANALYSIS A10: a kicked or banned user lost their presence row but stayed
/// in the LiveKit room. The reconciler removes a participant after two rounds
/// without presence, never one that still has it, and does nothing while the
/// module is unreachable.
/// </summary>
public sealed class LiveKitVoiceReconcilerTests
{
    private const string Room = "42";

    [Fact]
    public async Task Removes_Only_Participants_Without_Presence_After_Two_Rounds()
    {
        var (factory, livekit, reconciler, present, absent) = await Setup(spacetimeReachable: true);
        using var _ = factory;

        await reconciler.ReconcileOnceAsync(CancellationToken.None);
        Assert.Empty(livekit.Removed); // one miss is tolerated (e.g. a reconnect)

        await reconciler.ReconcileOnceAsync(CancellationToken.None);
        Assert.Equal([absent], livekit.Removed);
        Assert.DoesNotContain(present, livekit.Removed);
    }

    [Fact]
    public async Task Removes_Nobody_While_The_Module_Is_Unreachable()
    {
        var (factory, livekit, reconciler, _, _) = await Setup(spacetimeReachable: false);
        using var _factory = factory;

        for (var i = 0; i < 3; i++) await reconciler.ReconcileOnceAsync(CancellationToken.None);

        Assert.Empty(livekit.Removed);
    }

    private static async Task<(LetsChatWebApplicationFactory, LiveKitStub, LiveKitVoiceReconciler, string Present, string Absent)> Setup(bool spacetimeReachable)
    {
        string present, absent;
        var livekit = new LiveKitStub();
        var spacetime = new PresenceStub(spacetimeReachable);
        var factory = new LetsChatWebApplicationFactory { SpacetimeTransport = spacetime, LiveKitTransport = livekit };
        _ = factory.CreateClient();
        using (var scope = factory.Services.CreateScope())
        {
            var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
            var tokens = scope.ServiceProvider.GetRequiredService<SpacetimeTokenService>();
            async Task<string> Create(string name)
            {
                var user = new ApplicationUser { UserName = name, Email = $"{name}@test.local", DisplayName = name };
                AuthEndpoints.AssignDerivedIdentity(user, tokens);
                await users.CreateAsync(user);
                return user.SpacetimeIdentity!;
            }
            present = await Create("lk_present");
            absent = await Create("lk_absent");
        }
        livekit.Participants = [present, absent];
        spacetime.PresentIdentity = present;
        var reconciler = factory.Services.GetServices<IHostedService>().OfType<LiveKitVoiceReconciler>().Single();
        return (factory, livekit, reconciler, present, absent);
    }

    private sealed class LiveKitStub : HttpMessageHandler
    {
        public string[] Participants { get; set; } = [];
        public List<string> Removed { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var method = request.RequestUri!.Segments[^1];
            var body = method switch
            {
                "ListRooms" => $"{{\"rooms\":[{{\"name\":\"{Room}\"}}]}}",
                "ListParticipants" => "{\"participants\":["
                    + string.Join(",", Participants.Select(id => $"{{\"identity\":\"{id}\"}}")) + "]}",
                _ => "{}",
            };
            if (method == "RemoveParticipant")
            {
                var sent = await request.Content!.ReadAsStringAsync(ct);
                Removed.Add(Participants.Single(id => sent.Contains(id, StringComparison.Ordinal)));
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    /// <summary>The room's presence view holds only <see cref="PresentIdentity"/>.</summary>
    private sealed class PresenceStub(bool reachable) : HttpMessageHandler
    {
        public string PresentIdentity { get; set; } = "";

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
            Task.FromResult(reachable
                ? new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        $"[{{\"rows\":[[[\"0x{PresentIdentity}\"]]]}}]", Encoding.UTF8, "application/json"),
                }
                : new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
    }
}

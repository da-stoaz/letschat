using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using CoreApi.Configuration;
using CoreApi.Data;
using Microsoft.EntityFrameworkCore;

namespace CoreApi.Services;

/// <summary>
/// Removes LiveKit participants who no longer hold voice presence in the chat
/// module (BUG_ANALYSIS A10). A kick or ban deletes the presence row, but
/// LiveKit only ever checks a token's signature: without this, a removed user
/// stayed in the call, and could rejoin with the same token, for up to an hour.
///
/// <para>
/// Presence always exists before a token is minted (<c>/livekit/token</c> checks
/// it), so a participant without it has been removed or has left. A participant
/// is removed only after two consecutive rounds without presence, so a brief
/// SpacetimeDB reconnect — which sweeps and then restores the row — never drops
/// a call. An unreachable module skips the round entirely.
/// </para>
/// </summary>
public sealed class LiveKitVoiceReconciler(
    IServiceScopeFactory scopes,
    IHttpClientFactory httpFactory,
    LiveKitTokenService livekit,
    SpacetimeClient spacetime,
    ServiceOptions options,
    ILogger<LiveKitVoiceReconciler> logger) : BackgroundService
{
    public const string HttpClientName = "livekit";
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(20);
    private const int StrikesBeforeRemoval = 2;

    /// <summary>Consecutive rounds each <c>room|identity</c> was seen without presence.</summary>
    private readonly Dictionary<string, int> _strikes = [];

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await ReconcileOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Could not reconcile LiveKit rooms with voice presence; will retry.");
            }
        }
    }

    internal async Task ReconcileOnceAsync(CancellationToken ct)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var room in await ListAsync("ListRooms", new { }, null, "rooms", "name", ct))
        {
            if (!VoiceRoom.TryParse(room, out var voiceRoom))
            {
                continue;
            }
            foreach (var identity in await ListAsync("ListParticipants", new { room }, room, "participants", "identity", ct))
            {
                var key = $"{room}|{identity}";
                seen.Add(key);
                var norm = Validation.NormalizeIdentity(identity);
                var account = await db.Users.AsNoTracking()
                    .FirstOrDefaultAsync(user => user.SpacetimeIdentityNorm == norm, ct);
                var presence = account is null
                    ? VoicePresence.Denied
                    : await spacetime.HasVoicePresenceAsync(account.Id, account.SpacetimeIdentity, voiceRoom, ct);
                if (presence == VoicePresence.Unavailable)
                {
                    return; // no answer to act on; keep the strikes for next round
                }
                if (presence == VoicePresence.Admitted)
                {
                    _strikes.Remove(key);
                    continue;
                }
                var strikes = _strikes.GetValueOrDefault(key) + 1;
                if (strikes < StrikesBeforeRemoval)
                {
                    _strikes[key] = strikes;
                    continue;
                }
                try
                {
                    using (await PostAsync("RemoveParticipant", new { room, identity }, room, ct)) { }
                }
                catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
                {
                    // Left between the listing and now — the outcome we wanted.
                }
                _strikes.Remove(key);
                logger.LogInformation(
                    "Removed a LiveKit participant without voice presence: identity={IdentityPrefix}… room={Room}",
                    norm[..Math.Min(8, norm.Length)], room);
            }
        }

        foreach (var stale in _strikes.Keys.Where(key => !seen.Contains(key)).ToList())
        {
            _strikes.Remove(stale);
        }
    }

    private async Task<List<string>> ListAsync(
        string method, object body, string? room, string arrayName, string field, CancellationToken ct)
    {
        using var response = await PostAsync(method, body, room, ct);
        using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return json.RootElement.TryGetProperty(arrayName, out var items)
            ? items.EnumerateArray()
                .Select(item => item.TryGetProperty(field, out var value) ? value.GetString() : null)
                .OfType<string>()
                .ToList()
            : [];
    }

    private async Task<HttpResponseMessage> PostAsync(string method, object body, string? room, CancellationToken ct)
    {
        var http = httpFactory.CreateClient(HttpClientName);
        using var request = new HttpRequestMessage(
            HttpMethod.Post, $"{options.LiveKitInternalUrl.TrimEnd('/')}/twirp/livekit.RoomService/{method}")
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.Authorization = new("Bearer", livekit.ServerToken(room));
        var response = await http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return response;
    }
}

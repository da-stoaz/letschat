using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using CoreApi.Configuration;

namespace CoreApi.Services;

/// <summary>
/// Thin HTTP wrapper that lets core-api read tables and call reducers on the
/// SpacetimeDB chat-domain module. Used by the admin panel for instance-admin
/// surfaces (currently: space-create-policy) where the source of truth lives
/// in SpacetimeDB rather than Postgres.
///
/// <para>
/// Authenticates with a long-lived bearer token configured via
/// <see cref="ServiceOptions.SpacetimeServiceToken"/>. The token's Identity
/// must be promoted to <c>is_admin = true</c> via the publisher's CLI before
/// reducer calls succeed — see the <c>SPACETIMEDB_SERVICE_TOKEN</c> doc
/// comment on <see cref="ServiceOptions"/>.
/// </para>
/// </summary>
public sealed class SpacetimeClient(IHttpClientFactory httpFactory, ServiceOptions options)
{
    private const string ClientName = "spacetimedb";

    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>
    /// Serialises reducer args as a JSON body with a bare <c>application/json</c>
    /// content type. SpacetimeDB's <c>/call</c> endpoint returns 415 when the
    /// media type carries a <c>charset</c> parameter (which <c>JsonContent</c>
    /// adds by default), so it's stripped here.
    /// </summary>
    private static JsonContent ReducerArgs(object args)
    {
        var content = JsonContent.Create(args, options: JsonOpts);
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        return content;
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(options.SpacetimeServiceToken);

    /// <summary>
    /// Authorizes a LiveKit voice room by checking — <em>as the user</em> — that
    /// the module admitted them. The <c>join_voice_channel</c> /
    /// <c>join_dm_voice</c> reducers enforce membership, moderator-only, friend
    /// and block rules and insert a voice-presence row only for callers they
    /// admit; that row is visible to the user through the public
    /// <c>my_voice_participants</c> / <c>my_dm_voice_participants</c> views. No
    /// row → the user was never admitted, so no token is minted.
    ///
    /// <para>
    /// Queries SpacetimeDB's <c>/sql</c> endpoint with the user's own access
    /// token so row-level visibility is exactly what the client sees. Fails
    /// closed (returns <c>false</c>) on any missing token, transport error or
    /// non-success response — we never issue a token we couldn't authorize.
    /// </para>
    /// </summary>
    public async Task<bool> HasVoicePresenceAsync(
        string? userSpacetimeToken,
        string userIdentity,
        VoiceRoom room,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(userSpacetimeToken))
        {
            return false;
        }

        // room.ChannelId is numeric and room.RoomKey is validated by VoiceRoom,
        // so neither can carry SQL injection.
        var sql = room.IsDm
            ? $"SELECT user_identity FROM my_dm_voice_participants WHERE room_key = '{room.RoomKey}'"
            : $"SELECT user_identity FROM my_voice_participants WHERE channel_id = {room.ChannelId}";

        var http = httpFactory.CreateClient(ClientName);
        var url = $"{options.SpacetimeHttpUrl.TrimEnd('/')}/v1/database/{options.SpacetimeModuleName}/sql";
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(sql),
        };
        request.Headers.Authorization = new("Bearer", userSpacetimeToken);

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch
        {
            return false;
        }

        if (!response.IsSuccessStatusCode)
        {
            return false;
        }

        var rows = await ReadSqlRowsAsync(response, ct);
        if (rows is null)
        {
            return false;
        }

        var me = NormalizeIdentityHex(userIdentity);
        foreach (var row in rows)
        {
            if (row.Count > 0 && NormalizeIdentityHex(IdentityText(row[0])) == me)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>One statement's result from the SpacetimeDB <c>/sql</c> endpoint.</summary>
    private sealed record SqlStatementResult(List<List<JsonElement>>? Rows);

    /// <summary>
    /// Reads the first statement's rows from a SpacetimeDB <c>/sql</c> response,
    /// which is <c>[{ "schema": …, "rows": [[<col>, …], …], … }]</c>. Returns
    /// <c>null</c> (so callers fail safe) on a malformed body.
    /// </summary>
    private static async Task<List<List<JsonElement>>?> ReadSqlRowsAsync(
        HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var results = await response.Content.ReadFromJsonAsync<List<SqlStatementResult>>(JsonOpts, ct);
            return results?.FirstOrDefault()?.Rows;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Pulls the hex string out of a SpacetimeDB <c>Identity</c> SQL value, which
    /// arrives wrapped as a single-element array (<c>["0x.."]</c>); also tolerant
    /// of a bare string or object-wrapped form.
    /// </summary>
    private static string IdentityText(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.String:
                return element.GetString() ?? string.Empty;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    var text = IdentityText(item);
                    if (text.Length > 0)
                    {
                        return text;
                    }
                }
                return string.Empty;
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    var text = IdentityText(property.Value);
                    if (text.Length > 0)
                    {
                        return text;
                    }
                }
                return string.Empty;
            default:
                return element.GetRawText();
        }
    }

    /// <summary>Lower-cases, trims and drops a leading <c>0x</c> so identities compare regardless of form.</summary>
    private static string NormalizeIdentityHex(string raw)
    {
        var value = raw.Trim().ToLowerInvariant();
        return value.StartsWith("0x", StringComparison.Ordinal) ? value[2..] : value;
    }

    /// <summary>Reads the current <c>space_create_policy</c> from the module's settings row.</summary>
    public async Task<SpaceCreatePolicy> GetSpaceCreatePolicyAsync(CancellationToken ct = default)
    {
        // system_settings is a public table — readable without auth.
        var http = httpFactory.CreateClient(ClientName);
        var url = $"{options.SpacetimeHttpUrl.TrimEnd('/')}/v1/database/{options.SpacetimeModuleName}/sql";
        HttpResponseMessage response;
        try
        {
            response = await http.PostAsync(
                url,
                new StringContent("SELECT space_create_policy FROM system_settings"),
                ct);
        }
        catch
        {
            return SpaceCreatePolicy.Anyone;
        }

        if (!response.IsSuccessStatusCode)
        {
            return SpaceCreatePolicy.Anyone;
        }

        var rows = await ReadSqlRowsAsync(response, ct);
        var value = rows?.FirstOrDefault()?.FirstOrDefault();
        return value is null ? SpaceCreatePolicy.Anyone : ParseSpaceCreatePolicy(value.Value);
    }

    /// <summary>
    /// Decodes the <c>space_create_policy</c> column. SpacetimeDB's SATS-JSON
    /// encodes a sum (enum) value as <c>[tag, body]</c>, and the module declares
    /// the variants in the order <c>[anyone, adminsOnly]</c> — so tag 1 is
    /// admins-only. Older SpacetimeDB builds used a named-object form
    /// (<c>{ "adminsOnly": [] }</c>), which is still accepted.
    /// </summary>
    private static SpaceCreatePolicy ParseSpaceCreatePolicy(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var tag in value.EnumerateArray())
            {
                if (tag.ValueKind == JsonValueKind.Number && tag.TryGetInt32(out var index))
                {
                    return index == 1 ? SpaceCreatePolicy.AdminsOnly : SpaceCreatePolicy.Anyone;
                }

                break;
            }
        }
        else if (value.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in value.EnumerateObject())
            {
                if (prop.NameEquals("adminsOnly")) return SpaceCreatePolicy.AdminsOnly;
                if (prop.NameEquals("anyone")) return SpaceCreatePolicy.Anyone;
            }
        }

        return SpaceCreatePolicy.Anyone;
    }

    /// <summary>
    /// Calls the <c>set_space_create_policy</c> reducer. Throws if the service
    /// token is unset or if SpacetimeDB rejects the call (e.g. the token's
    /// identity isn't admin).
    /// </summary>
    public async Task SetSpaceCreatePolicyAsync(SpaceCreatePolicy policy, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(options.SpacetimeServiceToken))
        {
            throw new InvalidOperationException(
                "SPACETIMEDB_SERVICE_TOKEN is not configured. See ServiceOptions for the bootstrap.");
        }

        // SpacetimeDB's reducer-call body is a JSON array of args, one per
        // parameter. The enum variant is `{ "anyone": [] }` or `{ "adminsOnly": [] }`.
        var variantName = policy == SpaceCreatePolicy.AdminsOnly ? "adminsOnly" : "anyone";
        var args = new List<object> { new Dictionary<string, object>
        {
            [variantName] = Array.Empty<object>(),
        }};

        var http = httpFactory.CreateClient(ClientName);
        var url = $"{options.SpacetimeHttpUrl.TrimEnd('/')}/v1/database/{options.SpacetimeModuleName}/call/set_space_create_policy";
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = ReducerArgs(args),
        };
        request.Headers.Authorization = new("Bearer", options.SpacetimeServiceToken);

        var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"SpacetimeDB rejected set_space_create_policy ({(int)response.StatusCode}): {body}");
        }
    }

    /// <summary>Placeholder prefix on accounts that haven't bound a real SpacetimeDB identity yet.</summary>
    private const string PendingIdentityPrefix = "pending:";

    /// <summary>
    /// Pushes a user's instance-admin flag onto their SpacetimeDB <c>User</c> row
    /// via the <c>set_user_admin</c> reducer, keeping the chat-domain admin gate
    /// in sync with the ASP.NET Identity <c>Admin</c> role.
    ///
    /// <para>
    /// No-ops (returns <c>false</c>) when the service token isn't configured or
    /// the account has no real SpacetimeDB identity yet — admin-created accounts
    /// carry a <c>pending:</c> placeholder until first sign-in, when the login
    /// path retries this. Returns <c>true</c> when the reducer was called;
    /// throws if SpacetimeDB rejects it (e.g. the service identity isn't admin,
    /// or the target hasn't registered a <c>User</c> row yet).
    /// </para>
    /// </summary>
    public async Task<bool> SyncUserAdminAsync(
        string? spacetimeIdentity, bool isAdmin, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(options.SpacetimeServiceToken)
            || string.IsNullOrWhiteSpace(spacetimeIdentity)
            || spacetimeIdentity.StartsWith(PendingIdentityPrefix, StringComparison.Ordinal))
        {
            return false;
        }

        // SpacetimeDB encodes an `Identity` arg as a 1-element tuple of its hex
        // string: set_user_admin(target, is_admin) → [["0x<hex>"], <bool>].
        var hex = spacetimeIdentity.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            ? spacetimeIdentity
            : "0x" + spacetimeIdentity;
        var args = new List<object> { new[] { hex }, isAdmin };

        var http = httpFactory.CreateClient(ClientName);
        var url = $"{options.SpacetimeHttpUrl.TrimEnd('/')}/v1/database/{options.SpacetimeModuleName}/call/set_user_admin";
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = ReducerArgs(args),
        };
        request.Headers.Authorization = new("Bearer", options.SpacetimeServiceToken);

        var response = await http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"SpacetimeDB rejected set_user_admin ({(int)response.StatusCode}): {body}");
        }

        return true;
    }
}

/// <summary>Mirrors the SpacetimeDB <c>SpaceCreatePolicy</c> enum.</summary>
public enum SpaceCreatePolicy
{
    Anyone,
    AdminsOnly,
}

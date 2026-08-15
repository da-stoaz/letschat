using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using CoreApi.Configuration;
using Microsoft.AspNetCore.Identity;

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
public sealed class SpacetimeClient(
    IHttpClientFactory httpFactory,
    ServiceOptions options,
    SpacetimeTokenService tokens,
    IServiceScopeFactory scopes)
{
    private const string ClientName = "spacetimedb";

    /// <summary>
    /// Builds the ordered list of credentials an admin reducer call may be signed
    /// with. Which one actually holds admin changes across the OIDC identity
    /// migration, so both are offered and the caller tries them in turn.
    ///
    /// <para>
    /// <b>1. The configured <see cref="ServiceOptions.SpacetimeServiceToken"/></b>
    /// — the explicitly provisioned bootstrap credential. It is the one that holds
    /// admin <em>before</em> the migration runs, and indefinitely if it belongs to
    /// a dedicated service identity rather than a user account.
    /// </para>
    ///
    /// <para>
    /// <b>2. Freshly minted tokens for ASP.NET <c>Admin</c>-role accounts</b> —
    /// core-api is the OIDC issuer, so it can mint for any account; the resulting
    /// identity is <c>derive(account.Id)</c>, exactly what that account's module
    /// <c>User</c> row carries <em>after</em> the re-key. This is what survives the
    /// migration stranding a static token that was minted against a user's
    /// pre-OIDC identity (that identity loses its <c>User</c> row, so it is no
    /// longer admin). Every admin is offered because only those that have actually
    /// signed into the client have a module <c>User</c> row at all.
    /// </para>
    ///
    /// <para>Empty when neither exists — callers no-op rather than firing an
    /// unauthenticated call.</para>
    /// </summary>
    private async Task<IReadOnlyList<string>> ResolveAdminTokensAsync()
    {
        var candidates = new List<string>();

        // 1. The explicitly provisioned bootstrap credential. Correct before the
        //    identity migration (and forever, if it's a dedicated service identity
        //    rather than a user account's token).
        if (!string.IsNullOrWhiteSpace(options.SpacetimeServiceToken))
        {
            candidates.Add(options.SpacetimeServiceToken);
        }

        // 2. Freshly minted tokens for accounts holding the ASP.NET Admin role.
        //    Their identity is derive(account.Id) — the identity that account's
        //    module User row carries after the migration — so this is the path
        //    that keeps working once a re-key strands a user-account-derived
        //    static token. Several admins may exist and only some have a module
        //    User row (an admin-panel-only account never registered one), so all
        //    are offered.
        try
        {
            using var scope = scopes.CreateScope();
            var users = scope.ServiceProvider
                .GetRequiredService<UserManager<Data.ApplicationUser>>();
            foreach (var admin in await users.GetUsersInRoleAsync(DbInitializer.AdminRole))
            {
                candidates.Add(tokens.Mint(admin.Id));
            }
        }
        catch
        {
            // Identity store unavailable (e.g. very early startup) — the
            // configured token above still stands on its own.
        }

        return candidates;
    }

    /// <summary>
    /// Calls an admin-gated reducer, trying each available admin credential until
    /// one is accepted. A credential the module rejects as non-admin (401/403) is
    /// skipped rather than surfaced — this is what makes admin operations
    /// self-healing across the identity migration, where which credential holds
    /// admin changes. Any other failure, or exhausting all credentials, throws.
    /// </summary>
    private async Task PostAdminReducerAsync(string reducer, object args, CancellationToken ct)
    {
        var candidates = await ResolveAdminTokensAsync();
        if (candidates.Count == 0)
        {
            throw new InvalidOperationException(
                $"No SpacetimeDB admin credential available for {reducer} (no Admin account to "
                + "mint for, and SPACETIMEDB_SERVICE_TOKEN is unset). See ServiceOptions.");
        }

        var http = httpFactory.CreateClient(ClientName);
        var url = $"{options.SpacetimeHttpUrl.TrimEnd('/')}/v1/database/{options.SpacetimeModuleName}/call/{reducer}";
        string lastBody = string.Empty;
        var lastStatus = 0;

        foreach (var token in candidates)
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = ReducerArgs(args),
            };
            request.Headers.Authorization = new("Bearer", token);

            var response = await http.SendAsync(request, ct);
            if (response.IsSuccessStatusCode)
            {
                return;
            }

            lastStatus = (int)response.StatusCode;
            lastBody = await response.Content.ReadAsStringAsync(ct);

            // Only retry the next credential when THIS one was rejected for lack
            // of permission. Matching is deliberately narrow — the module answers
            // a failed `require_system_admin` with "instance admin permission
            // required" (as a 530 reducer error, not a 401). A broader match (e.g.
            // any body containing "admin") would treat a genuine failure of
            // `set_user_admin` as an auth problem and burn every credential on it.
            var isAuthFailure = lastStatus is 401 or 403
                || lastBody.Contains("permission required", StringComparison.OrdinalIgnoreCase);
            if (!isAuthFailure)
            {
                break;
            }
        }

        throw new InvalidOperationException(
            $"SpacetimeDB rejected {reducer} ({lastStatus}) with all {candidates.Count} "
            + $"admin credential(s): {lastBody}");
    }

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
    /// Queries SpacetimeDB's <c>/sql</c> endpoint as the account itself, so
    /// row-level visibility is exactly what the client sees. The access token is
    /// minted here from <paramref name="accountId"/> rather than taken from the
    /// caller: core-api is the OIDC issuer, tokens are never stored, and minting
    /// in one place means no caller can authorize a room against the wrong
    /// credential. Fails closed (returns <c>false</c>) on any transport error or
    /// non-success response — we never issue a token we couldn't authorize.
    /// </para>
    /// </summary>
    /// <param name="accountId">
    /// The ASP.NET Identity account id. <c>derive(accountId)</c> is the
    /// SpacetimeDB identity the minted token resolves to, so it must be the same
    /// account <paramref name="userIdentity"/> belongs to.
    /// </param>
    public async Task<bool> HasVoicePresenceAsync(
        string accountId,
        string userIdentity,
        VoiceRoom room,
        CancellationToken ct = default)
    {
        // The client awaits the join reducer's commit before asking for a token, but
        // committed is not the same as readable: this /sql view can still be a beat
        // behind, so the very first join legitimately finds no row and gets refused.
        // That refusal is worse than it looks — the client's failure path deletes its
        // presence row, and if the user immediately retries, that late cleanup lands
        // on the retry's row and leaves them connected to LiveKit with no presence at
        // all. Re-read a few times before concluding the row isn't there. This does
        // not weaken the gate: a user who was never admitted still finds nothing, no
        // matter how often we look.
        for (var attempt = 0; ; attempt++)
        {
            if (await QueryVoicePresenceAsync(accountId, userIdentity, room, ct))
            {
                return true;
            }
            if (attempt >= PresenceReadAttempts - 1)
            {
                return false;
            }
            await Task.Delay(PresenceReadRetryDelay, ct);
        }
    }

    /// <summary>Total reads before refusing; see <see cref="HasVoicePresenceAsync"/>.</summary>
    private const int PresenceReadAttempts = 3;

    /// <summary>Gap between reads — comfortably over the observed replication lag.</summary>
    private static readonly TimeSpan PresenceReadRetryDelay = TimeSpan.FromMilliseconds(120);

    private async Task<bool> QueryVoicePresenceAsync(
        string accountId,
        string userIdentity,
        VoiceRoom room,
        CancellationToken ct)
    {
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
        request.Headers.Authorization = new("Bearer", tokens.Mint(accountId));

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
    /// Calls the <c>set_space_create_policy</c> reducer. Throws if no admin
    /// credential is available or SpacetimeDB rejects the call with all of them.
    /// </summary>
    public async Task SetSpaceCreatePolicyAsync(SpaceCreatePolicy policy, CancellationToken ct = default)
    {
        // SpacetimeDB's reducer-call body is a JSON array of args, one per
        // parameter. The enum variant is `{ "anyone": [] }` or `{ "adminsOnly": [] }`.
        var variantName = policy == SpaceCreatePolicy.AdminsOnly ? "adminsOnly" : "anyone";
        var args = new List<object> { new Dictionary<string, object>
        {
            [variantName] = Array.Empty<object>(),
        }};

        await PostAdminReducerAsync("set_space_create_policy", args, ct);
    }

    /// <summary>
    /// Pushes a user's instance-admin flag onto their SpacetimeDB <c>User</c> row
    /// via the <c>set_user_admin</c> reducer, keeping the chat-domain admin gate
    /// in sync with the ASP.NET Identity <c>Admin</c> role.
    ///
    /// <para>
    /// No-ops (returns <c>false</c>) when no admin credential is available.
    /// Returns <c>true</c> when the reducer was called; throws if SpacetimeDB
    /// rejects it with every credential (e.g. none is admin, or the target
    /// hasn't registered a <c>User</c> row yet).
    /// </para>
    /// </summary>
    public async Task<bool> SyncUserAdminAsync(
        string? spacetimeIdentity, bool isAdmin, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(spacetimeIdentity))
        {
            return false;
        }

        if ((await ResolveAdminTokensAsync()).Count == 0)
        {
            return false;
        }

        // SpacetimeDB encodes an `Identity` arg as a 1-element tuple of its hex
        // string: set_user_admin(target, is_admin) → [["0x<hex>"], <bool>].
        var hex = spacetimeIdentity.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            ? spacetimeIdentity
            : "0x" + spacetimeIdentity;
        var args = new List<object> { new[] { hex }, isAdmin };

        await PostAdminReducerAsync("set_user_admin", args, ct);
        return true;
    }

    /// <summary>
    /// Drives the OIDC identity-inversion migration in SpacetimeDB: re-keys every
    /// durable row from each <c>old</c> identity to its <c>new</c> derived one via
    /// the admin-gated <c>rekey_identities</c> reducer, in a single transaction.
    /// Throws if the service token is unset or SpacetimeDB rejects the call, so the
    /// caller can defer (and retry) rather than half-migrate.
    /// </summary>
    public async Task RekeyIdentitiesAsync(
        IReadOnlyCollection<(string OldHex, string NewHex)> pairs, CancellationToken ct = default)
    {
        // Deliberately the STATIC token, not ResolveAdminTokenAsync(): before the
        // migration runs, the module's admin User row still sits on the account's
        // pre-OIDC identity, so a freshly minted (derived-identity) token isn't
        // admin yet. The configured bootstrap token is the credential that still
        // holds admin at this moment. Afterwards, admin ops switch to minted
        // tokens automatically and this token is no longer needed.
        if (string.IsNullOrWhiteSpace(options.SpacetimeServiceToken))
        {
            throw new InvalidOperationException(
                "SPACETIMEDB_SERVICE_TOKEN is not configured; cannot run the identity migration.");
        }
        if (pairs.Count == 0)
        {
            return;
        }

        static string Hex(string h) =>
            h.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? h : "0x" + h;

        // rekey_identities(Vec<IdentityRemap{old,new}>). SATS-JSON: an Identity is
        // a 1-field product -> ["0x<hex>"]; IdentityRemap is a 2-field product ->
        // [old, new]; the single Vec arg wraps the list.
        var remaps = pairs
            .Select(p => new object[] { new[] { Hex(p.OldHex) }, new[] { Hex(p.NewHex) } })
            .ToList();
        var args = new List<object> { remaps };

        var http = httpFactory.CreateClient(ClientName);
        var url = $"{options.SpacetimeHttpUrl.TrimEnd('/')}/v1/database/{options.SpacetimeModuleName}/call/rekey_identities";
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
                $"SpacetimeDB rejected rekey_identities ({(int)response.StatusCode}): {body}");
        }
    }
}

/// <summary>Mirrors the SpacetimeDB <c>SpaceCreatePolicy</c> enum.</summary>
public enum SpaceCreatePolicy
{
    Anyone,
    AdminsOnly,
}

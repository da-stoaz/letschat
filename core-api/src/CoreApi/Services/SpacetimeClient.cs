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

    /// <summary>Reads the current <c>space_create_policy</c> from the module's settings row.</summary>
    public async Task<SpaceCreatePolicy> GetSpaceCreatePolicyAsync(CancellationToken ct = default)
    {
        // system_settings is a public table — readable without auth.
        var http = httpFactory.CreateClient(ClientName);
        var url = $"{options.SpacetimeHttpUrl.TrimEnd('/')}/v1/database/{options.SpacetimeModuleName}/sql";
        var response = await http.PostAsync(
            url,
            new StringContent("SELECT space_create_policy FROM system_settings"),
            ct);
        if (!response.IsSuccessStatusCode)
        {
            return SpaceCreatePolicy.Anyone;
        }

        var rows = await response.Content.ReadFromJsonAsync<List<List<JsonElement>>>(JsonOpts, ct);
        var raw = rows?.FirstOrDefault()?.FirstOrDefault();
        if (raw is null) return SpaceCreatePolicy.Anyone;

        // The enum comes back as `{ "anyone": [] }` or `{ "adminsOnly": [] }`
        // under SpacetimeDB's algebraic-type JSON encoding.
        if (raw.Value.ValueKind == JsonValueKind.Object)
        {
            foreach (var prop in raw.Value.EnumerateObject())
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

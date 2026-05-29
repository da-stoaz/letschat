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
            Content = JsonContent.Create(args, options: JsonOpts),
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
}

/// <summary>Mirrors the SpacetimeDB <c>SpaceCreatePolicy</c> enum.</summary>
public enum SpaceCreatePolicy
{
    Anyone,
    AdminsOnly,
}

using System.Globalization;
using CoreApi.Models;

namespace CoreApi.Services;

public enum StorageScope
{
    /// <summary><c>uploads/ch/{channelId}/{uploader}/{file}</c> — readable by the channel's current members.</summary>
    Channel,
    /// <summary><c>uploads/dm/{uploader}/{partner}/{file}</c> — readable by the two parties.</summary>
    DirectMessage,
    /// <summary><c>uploads/avatar/{uploader}/{file}</c> — readable by any account.</summary>
    Avatar,
    /// <summary><c>uploads/icon/{serverId}/{uploader}/{file}</c> — readable by whoever can see the space.</summary>
    ServerIcon,
    /// <summary>
    /// <c>uploads/{yyyy}/{MM}/{dd}/{uploader}/{file}</c> — every object from
    /// before keys carried a scope. Readable by whoever can see the uploader.
    /// </summary>
    Legacy,
}

/// <summary>
/// A storage key, parsed. The path remains the authorization record for who may
/// read the object (BUG_ANALYSIS A6): the scope is fixed when the upload is
/// requested and <c>/uploads/download-url</c> decides from the key plus the
/// caller's row visibility. SpacetimeDB separately stores normalized references
/// for lifecycle cleanup; those references never widen read access.
///
/// <para>
/// A scope only ever narrows who may read; it cannot widen what the module
/// already lets the uploader share. Naming a channel you are not in, or a
/// partner you cannot DM, produces a key that people <em>you</em> chose can
/// read — which the uploader could do anyway by sending them the file.
/// </para>
/// </summary>
public sealed record StorageKey(StorageScope Scope, string Uploader, ulong Id = 0, string? Partner = null)
{
    /// <summary>
    /// <c>null</c> for anything that is not one of the five shapes above. The
    /// segments that end up inside SQL (usernames, ids) are validated here so the
    /// authorizer can splice them in as-is.
    /// </summary>
    public static StorageKey? TryParse(string key)
    {
        var parts = key.Split('/');
        if (parts.Length < 4 || parts[0] != "uploads" || parts[^1].Length == 0)
        {
            return null;
        }

        return parts[1] switch
        {
            "ch" when parts.Length == 5 && ulong.TryParse(parts[2], out var channel) && Validation.IsUsername(parts[3])
                => new StorageKey(StorageScope.Channel, parts[3], channel),
            "dm" when parts.Length == 5 && Validation.IsUsername(parts[2]) && Validation.IsUsername(parts[3])
                => new StorageKey(StorageScope.DirectMessage, parts[2], Partner: parts[3]),
            "avatar" when parts.Length == 4 && Validation.IsUsername(parts[2])
                => new StorageKey(StorageScope.Avatar, parts[2]),
            "icon" when parts.Length == 5 && ulong.TryParse(parts[2], out var server) && Validation.IsUsername(parts[3])
                => new StorageKey(StorageScope.ServerIcon, parts[3], server),
            _ when parts.Length == 6 && parts[1].Length == 4 && parts[1].All(char.IsAsciiDigit) && Validation.IsUsername(parts[4])
                => new StorageKey(StorageScope.Legacy, parts[4]),
            _ => null,
        };
    }

    /// <summary>
    /// The key for a new upload. A missing scope means a client from before
    /// scopes existed — it gets the legacy shape, which still downloads under
    /// the legacy rule.
    /// </summary>
    public static string Build(UploadScope? scope, string uploader, string file)
    {
        if (scope is null)
        {
            var datePath = DateTime.UtcNow.ToString("yyyy/MM/dd", CultureInfo.InvariantCulture);
            return $"uploads/{datePath}/{uploader}/{file}";
        }

        switch (scope.Kind)
        {
            case "channel":
                return $"uploads/ch/{Require(scope.ChannelId, "scope.channelId")}/{uploader}/{file}";
            case "dm":
                var partner = Validation.NormalizeUsername(scope.Partner ?? string.Empty);
                if (!Validation.IsUsername(partner))
                {
                    throw ApiException.BadRequest("scope.partner must be a username.");
                }
                return $"uploads/dm/{uploader}/{partner}/{file}";
            case "avatar":
                return $"uploads/avatar/{uploader}/{file}";
            case "icon":
                return $"uploads/icon/{Require(scope.ServerId, "scope.serverId")}/{uploader}/{file}";
            default:
                throw ApiException.BadRequest("scope.kind must be channel, dm, avatar or icon.");
        }
    }

    private static ulong Require(ulong? id, string field) =>
        id ?? throw ApiException.BadRequest($"{field} is required.");
}

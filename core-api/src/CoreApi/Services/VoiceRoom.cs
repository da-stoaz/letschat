namespace CoreApi.Services;

/// <summary>
/// A parsed LiveKit voice room name. Rooms are either a space voice channel
/// (the channel id as a decimal string, e.g. <c>"42"</c>) or a direct-message
/// pair (<c>"dm:&lt;identity&gt;:&lt;identity&gt;"</c>), matching the names the
/// client builds in <c>src/lib/livekit.ts</c>.
///
/// <para>
/// Parsing is strict: the channel form must be a plain unsigned integer and the
/// DM identities must be hex. Because the DM <see cref="RoomKey"/> is later
/// interpolated into a SpacetimeDB SQL query, rejecting anything that isn't a
/// well-formed identity is also the SQL-injection guard.
/// </para>
/// </summary>
public readonly struct VoiceRoom
{
    public bool IsDm { get; private init; }

    /// <summary>Channel id when <see cref="IsDm"/> is false.</summary>
    public ulong ChannelId { get; private init; }

    /// <summary>
    /// For a DM, the module's <c>room_key</c> — the two identities joined by a
    /// colon, <b>without</b> the <c>dm:</c> prefix the LiveKit room name carries,
    /// lower-cased and with any <c>0x</c> stripped. That is exactly what
    /// <c>dm_room_key()</c> stores (see <c>server/src/helpers.rs</c>), so it can be
    /// compared directly against the <c>my_dm_voice_participants</c> view.
    /// For a channel, the validated room name; the query uses
    /// <see cref="ChannelId"/> instead.
    /// </summary>
    public string RoomKey { get; private init; }

    public static bool TryParse(string? room, out VoiceRoom parsed)
    {
        parsed = default;
        if (string.IsNullOrWhiteSpace(room))
        {
            return false;
        }

        var value = room.Trim();

        if (value.StartsWith("dm:", StringComparison.Ordinal))
        {
            // dm:<identity>:<identity> — exactly two hex identities.
            var parts = value.Split(':');
            if (parts.Length != 3 || !IsHexIdentity(parts[1]) || !IsHexIdentity(parts[2]))
            {
                return false;
            }

            // Drop the "dm:" prefix: it belongs to the LiveKit room name, not to
            // the module's room_key, which is just "<identity>:<identity>".
            parsed = new VoiceRoom
            {
                IsDm = true,
                RoomKey = $"{NormalizeIdentity(parts[1])}:{NormalizeIdentity(parts[2])}",
            };
            return true;
        }

        if (ulong.TryParse(value, out var channelId))
        {
            parsed = new VoiceRoom { IsDm = false, ChannelId = channelId, RoomKey = value };
            return true;
        }

        return false;
    }

    private static bool IsHexIdentity(string segment) =>
        NormalizeIdentity(segment) is { Length: > 0 and <= 128 } hex && hex.All(Uri.IsHexDigit);

    /// <summary>
    /// Strips an optional <c>0x</c> and lower-cases — the form the module stores,
    /// since identities there are written as bare lower-case hex.
    /// </summary>
    private static string NormalizeIdentity(string segment) =>
        (segment.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? segment[2..] : segment)
            .ToLowerInvariant();
}

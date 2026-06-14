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

    /// <summary>The validated room name (the DM room key when <see cref="IsDm"/> is true).</summary>
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

            parsed = new VoiceRoom { IsDm = true, RoomKey = value };
            return true;
        }

        if (ulong.TryParse(value, out var channelId))
        {
            parsed = new VoiceRoom { IsDm = false, ChannelId = channelId, RoomKey = value };
            return true;
        }

        return false;
    }

    private static bool IsHexIdentity(string segment)
    {
        var hex = segment.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? segment[2..] : segment;
        return hex.Length is > 0 and <= 128 && hex.All(Uri.IsHexDigit);
    }
}

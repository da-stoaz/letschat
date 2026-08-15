using CoreApi.Services;

namespace CoreApi.Tests;

/// <summary>
/// Parsing of LiveKit room names. Strictness here doubles as the SQL-injection
/// guard for the DM room key that <see cref="SpacetimeClient.HasVoicePresenceAsync"/>
/// interpolates into a query.
/// </summary>
public sealed class VoiceRoomTests
{
    [Theory]
    [InlineData("42", 42UL)]
    [InlineData("0", 0UL)]
    [InlineData(" 7 ", 7UL)]
    public void TryParse_AcceptsChannelIds(string room, ulong expected)
    {
        Assert.True(VoiceRoom.TryParse(room, out var parsed));
        Assert.False(parsed.IsDm);
        Assert.Equal(expected, parsed.ChannelId);
    }

    /// <summary>
    /// The room key must equal what <c>dm_room_key()</c> stores in the module
    /// (<c>server/src/helpers.rs</c>): the two identities joined by a colon, bare
    /// lower-case hex — no <c>dm:</c> prefix and no <c>0x</c>. Those belong to the
    /// LiveKit room name only. Carrying them into the key made the presence query
    /// compare <c>'dm:a:b'</c> against a stored <c>'a:b'</c>, so it matched nothing
    /// and DM voice was refused for everyone.
    /// </summary>
    [Theory]
    [InlineData("dm:0xabc:0xdef", "abc:def")]
    [InlineData("dm:abc123:def456", "abc123:def456")]
    [InlineData(" dm:ABC:DEF ", "abc:def")]
    public void TryParse_AcceptsDmRooms_AndYieldsTheModulesRoomKey(string room, string expectedKey)
    {
        Assert.True(VoiceRoom.TryParse(room, out var parsed));
        Assert.True(parsed.IsDm);
        Assert.Equal(expectedKey, parsed.RoomKey);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("-1")]
    [InlineData("12; DROP TABLE users")]
    [InlineData("dm:abc")]                  // too few segments
    [InlineData("dm:abc:def:ghi")]          // too many segments
    [InlineData("dm:xyz:abc")]              // non-hex identity
    [InlineData("dm:abc:de'f")]             // quote would break out of the SQL literal
    [InlineData("dm::abc")]                 // empty identity
    public void TryParse_RejectsMalformedRooms(string? room)
    {
        Assert.False(VoiceRoom.TryParse(room, out _));
    }
}

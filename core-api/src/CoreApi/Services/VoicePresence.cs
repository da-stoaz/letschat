namespace CoreApi.Services;

/// <summary>
/// The outcome of the voice-room authorization read in
/// <see cref="SpacetimeClient.HasVoicePresenceAsync"/>.
///
/// <para>
/// This is three states rather than a <c>bool</c> for one reason: "the module
/// says you are not in this room" and "the module never answered" are different
/// facts, and only the first is an authorization decision. Reporting the second
/// as the first tells the user something untrue about their own permissions and
/// sends whoever debugs it looking at the permission model instead of at the
/// unreachable database.
/// </para>
/// </summary>
public enum VoicePresence
{
    /// <summary>The module answered and the caller holds a presence row.</summary>
    Admitted,

    /// <summary>The module answered and the caller holds no presence row.</summary>
    Denied,

    /// <summary>
    /// The module could not be reached or returned an unusable response, so
    /// there is no authorization decision. Retryable; not the caller's fault.
    /// </summary>
    Unavailable,
}

namespace CoreApi.Data;

/// <summary>
/// Account lifecycle state. Phase 1 grandfathers every user to <see cref="Active"/>
/// and new self-registrations are created <see cref="Active"/> as well, preserving
/// the legacy service's behaviour. The remaining states are wired up by the
/// email-verification (Phase 2) and approval (Phase 3) work.
/// </summary>
public enum AccountStatus
{
    /// <summary>Self-registered, email not yet confirmed.</summary>
    Registered = 0,

    /// <summary>Email confirmed, awaiting admin approval (if approval is required).</summary>
    EmailVerified = 1,

    /// <summary>Fully usable — sign-in permitted.</summary>
    Active = 2,

    /// <summary>Admin disabled an active account — sign-in blocked.</summary>
    Disabled = 3,

    /// <summary>Admin rejected a pending account — sign-in blocked.</summary>
    Rejected = 4,
}

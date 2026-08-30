use spacetimedb::{Identity, ReducerContext, Table};

use crate::schema::*;

pub(crate) fn assert_or_err(condition: bool, message: &str) -> Result<(), String> {
    if condition {
        Ok(())
    } else {
        Err(message.to_string())
    }
}

pub(crate) fn is_valid_username(username: &str) -> bool {
    let len_ok = (2..=32).contains(&username.len());
    len_ok
        && username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub(crate) fn normalize_username(username: &str) -> String {
    username.trim().to_lowercase()
}

pub(crate) fn normalize_identity_string(identity: &str) -> String {
    identity.trim().to_lowercase()
}

pub(crate) fn member_key(server_id: u64, user_identity: Identity) -> String {
    format!("{server_id}:{user_identity}")
}

pub(crate) fn ban_key(server_id: u64, user_identity: Identity) -> String {
    format!("{server_id}:{user_identity}")
}

pub(crate) fn join_request_key(server_id: u64, user_identity: Identity) -> String {
    format!("{server_id}:{user_identity}")
}

pub(crate) fn voice_key(channel_id: u64, user_identity: Identity) -> String {
    format!("{channel_id}:{user_identity}")
}

pub(crate) fn dm_room_key(a: Identity, b: Identity) -> String {
    let (x, y) = ordered_pair(a, b);
    format!("{x}:{y}")
}

pub(crate) fn dm_voice_key(room_key: &str, user_identity: Identity) -> String {
    format!("{room_key}:{user_identity}")
}

pub(crate) fn ordered_pair(a: Identity, b: Identity) -> (Identity, Identity) {
    if a <= b { (a, b) } else { (b, a) }
}

pub(crate) fn friend_pair_key(a: Identity, b: Identity) -> String {
    let (x, y) = ordered_pair(a, b);
    format!("{x}:{y}")
}

pub(crate) fn block_key(blocker: Identity, blocked: Identity) -> String {
    format!("{blocker}:{blocked}")
}

pub(crate) fn has_member_role(
    ctx: &ReducerContext,
    server_id: u64,
    user_identity: Identity,
) -> Option<Role> {
    ctx.db
        .server_member()
        .member_key()
        .find(member_key(server_id, user_identity))
        .map(|m| m.role)
}

pub(crate) fn require_member_role(
    ctx: &ReducerContext,
    server_id: u64,
    user_identity: Identity,
) -> Result<Role, String> {
    has_member_role(ctx, server_id, user_identity).ok_or_else(|| "not a server member".to_string())
}

pub(crate) fn require_mod_or_owner(
    ctx: &ReducerContext,
    server_id: u64,
    user_identity: Identity,
) -> Result<Role, String> {
    match require_member_role(ctx, server_id, user_identity)? {
        Role::Moderator => Ok(Role::Moderator),
        Role::Owner => Ok(Role::Owner),
        Role::Member => Err("insufficient permissions".to_string()),
    }
}

pub(crate) fn require_owner(
    ctx: &ReducerContext,
    server_id: u64,
    user_identity: Identity,
) -> Result<(), String> {
    let role = require_member_role(ctx, server_id, user_identity)?;
    assert_or_err(role == Role::Owner, "owner permission required")
}

pub(crate) fn require_invite_permission(
    ctx: &ReducerContext,
    server_id: u64,
    user_identity: Identity,
) -> Result<(), String> {
    let role = require_member_role(ctx, server_id, user_identity)?;
    let server_row = ctx
        .db
        .server()
        .id()
        .find(server_id)
        .ok_or_else(|| "server not found".to_string())?;

    let allowed = match server_row.invite_policy {
        InvitePolicy::Everyone => true,
        InvitePolicy::ModeratorsOnly => matches!(role, Role::Owner | Role::Moderator),
    };

    assert_or_err(allowed, "insufficient permissions to invite users")
}

/// The gate every client-callable reducer opens with: the caller must have a
/// `User` row, i.e. a registered account on this instance.
///
/// This is the load-bearing half of the anonymous-identity fix. SpacetimeDB
/// hands out an identity to anyone who asks (`POST /v1/identity`) and the
/// module only ever sees `ctx.sender()`, so without this check any stranger
/// could connect over the public WebSocket and call reducers directly —
/// bypassing every account control core-api enforces on the HTTP path
/// (registration open/closed, e-mail confirmation, admin approval, disabled
/// accounts). Requiring an account here, plus `require_trusted_issuer` on
/// `register_user` (the one reducer that *creates* an account), means the only
/// way to obtain standing in the module is through core-api.
///
/// Deliberately a point lookup on the primary key rather than a JWT inspection:
/// it costs one index probe per call, and because a `User` row can only be
/// created by a trusted-issuer caller, it enforces the issuer transitively.
///
/// Not for the reducers with their own, stricter trust boundary — the
/// `archive_*` restores (registered worker identity) and the lifecycle
/// reducers (`init`, `client_disconnected`), which the host invokes with no
/// caller at all.
pub(crate) fn require_account(ctx: &ReducerContext) -> Result<(), String> {
    let user = ctx
        .db
        .user()
        .identity()
        .find(ctx.sender())
        .ok_or_else(|| "no account for this identity".to_string())?;

    // An admin disabled the account. Refusing here rather than at token expiry
    // is the whole point: the SpacetimeDB token is long-lived and the client
    // talks to this module directly, so core-api's sign-in check never sees
    // these calls.
    assert_or_err(!user.suspended, "this account has been disabled")?;

    require_current_token(ctx, &user)
}

/// Rejects a token minted before the account's last credential change.
///
/// core-api increments the account's token generation on every password reset
/// or change and pushes the new floor onto the `User` row, so a token stolen
/// beforehand — minted at a lower generation — stops working on the very next
/// reducer call. Without this, "I was compromised, so I reset my password" does
/// nothing: the client talks to this module directly, so nothing in the chat
/// path ever consults core-api again and the stolen token keeps full access for
/// its entire lifetime.
///
/// Fails **open** by construction, in two ways that both matter:
///
/// - A floor of `0` (never revoked — every account's starting state, and what
///   an upgraded instance arrives with) skips the check for one integer
///   compare.
/// - `>=`, not `==`. The push from core-api is best-effort, so the floor can
///   lag behind the generation the user's fresh token already carries. `>=`
///   still admits them; an equality test would lock the legitimate user out of
///   chat because SpacetimeDB happened to be unreachable during their reset.
///
/// ponytail: parses the JWT payload per call, but only for accounts that have
/// actually been revoked at least once. If that ever shows up in a profile,
/// cache it per connection id.
fn require_current_token(ctx: &ReducerContext, user: &User) -> Result<(), String> {
    if user.min_token_generation == 0 {
        return Ok(());
    }

    let payload = ctx
        .sender_auth()
        .jwt()
        .map(|claims| claims.raw_payload().to_string())
        .ok_or_else(|| "session is no longer valid; sign in again".to_string())?;

    let generation = serde_json::from_str::<serde_json::Value>(&payload)
        .ok()
        .and_then(|claims| claims.get("gen")?.as_u64())
        .unwrap_or(0);

    assert_or_err(
        generation >= user.min_token_generation,
        "session is no longer valid; sign in again",
    )
}

/// True if `identity` has a `User` row with `is_admin = true`. Used by the
/// instance-level admin gate (distinct from per-server Owner/Moderator).
pub(crate) fn is_system_admin(ctx: &ReducerContext, identity: Identity) -> bool {
    ctx.db
        .user()
        .identity()
        .find(identity)
        .map(|u| u.is_admin)
        .unwrap_or(false)
}

pub(crate) fn require_system_admin(
    ctx: &ReducerContext,
    identity: Identity,
) -> Result<(), String> {
    assert_or_err(is_system_admin(ctx, identity), "instance admin permission required")
}

// ─── Module-managed id allocation (see `IdCounter` in schema.rs) ───────────────

/// Allocate the next id for an `#[auto_inc]` table.
///
/// Returns `0` when no counter row exists — `0` is auto-inc's "generate one"
/// sentinel, so a never-rebuilt instance keeps the stock behaviour and this
/// costs one point lookup. Once a counter exists (seeded by an archive restore
/// or `archive_reseed_id_counters`), ids come from the counter instead, which
/// is the only way to hand out ids above the stale sequence without colliding.
///
/// `taken` reports whether an id is already present in the table: the counter
/// skips over occupied ids rather than letting the insert panic. In practice
/// it never loops — it is the guard for a counter that has fallen behind
/// (a partially replayed rebuild, or a new insert site that forgot to call
/// this helper). Reducers are serialised, so no locking is involved.
pub(crate) fn alloc_id(
    ctx: &ReducerContext,
    table_name: &str,
    taken: impl Fn(u64) -> bool,
) -> u64 {
    let Some(mut counter) = ctx.db.id_counter().table_name().find(table_name.to_string()) else {
        return 0;
    };
    while taken(counter.next_id) {
        counter.next_id += 1;
    }
    let id = counter.next_id;
    counter.next_id += 1;
    ctx.db.id_counter().table_name().update(counter);
    id
}

/// Raise a table's counter so the next allocation lands above `max_id`.
///
/// Monotonic: an existing counter is never lowered, so replaying a rebuild or
/// restoring an out-of-order batch cannot hand out an id that is already in
/// use. Called by the archive restore reducers and by
/// `archive_reseed_id_counters`.
///
/// `max_id == 0` means there is nothing to protect (an empty table, or an empty
/// restore batch — auto-inc ids start at 1). No counter is created in that
/// case, which deliberately leaves the table on auto-inc: a sequence never
/// reuses an id, whereas a counter seeded from an empty table would restart at
/// 1 and could hand out ids that older rows once used.
pub(crate) fn raise_id_counter(ctx: &ReducerContext, table_name: &str, max_id: u64) {
    if max_id == 0 {
        return;
    }
    let next_id = max_id.saturating_add(1);
    match ctx.db.id_counter().table_name().find(table_name.to_string()) {
        Some(existing) if existing.next_id >= next_id => {}
        Some(existing) => {
            ctx.db.id_counter().table_name().update(IdCounter {
                next_id,
                ..existing
            });
        }
        None => {
            ctx.db.id_counter().insert(IdCounter {
                table_name: table_name.to_string(),
                next_id,
            });
        }
    }
}

/// `next_id!(ctx, message, id)` — the id to insert into `message`, using the
/// table's own name as the counter key so allocation and seeding can never
/// drift apart.
macro_rules! next_id {
    ($ctx:expr, $tbl:ident, $pk:ident) => {
        crate::helpers::alloc_id($ctx, stringify!($tbl), |id| {
            $ctx.db.$tbl().$pk().find(id).is_some()
        })
    };
}
pub(crate) use next_id;

pub(crate) fn find_channel(ctx: &ReducerContext, channel_id: u64) -> Result<Channel, String> {
    ctx.db
        .channel()
        .id()
        .find(channel_id)
        .ok_or_else(|| "channel not found".to_string())
}

pub(crate) fn is_banned(ctx: &ReducerContext, server_id: u64, user_identity: Identity) -> bool {
    ctx.db
        .ban()
        .ban_key()
        .find(ban_key(server_id, user_identity))
        .is_some()
}

pub(crate) fn find_friend_row(ctx: &ReducerContext, a: Identity, b: Identity) -> Option<Friend> {
    ctx.db.friend().pair_key().find(friend_pair_key(a, b))
}

pub(crate) fn has_block_either_direction(ctx: &ReducerContext, a: Identity, b: Identity) -> bool {
    ctx.db.block().block_key().find(block_key(a, b)).is_some()
        || ctx.db.block().block_key().find(block_key(b, a)).is_some()
}

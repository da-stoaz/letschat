use std::collections::HashMap;

use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table};

use crate::helpers::{
    ban_key, block_key, friend_pair_key, join_request_key, member_key, ordered_pair,
    require_system_admin,
};
use crate::schema::*;

/// One old→new identity substitution for [`rekey_identities`].
#[derive(SpacetimeType, Clone)]
pub struct IdentityRemap {
    pub old: Identity,
    pub new: Identity,
}

/// Re-key every durable row from a set of old identities to new ones, in one
/// transaction. This is the SpacetimeDB half of the OIDC identity-inversion
/// migration: core-api drives it once on upgrade with `(old anonymous identity →
/// new derived identity)` for every existing account, so a live production
/// database moves to deterministic identities with no wipe and no manual steps.
///
/// - **Admin-gated, checked once at entry.** The whole re-key — including the
///   caller's own account — happens in this single transaction, so the caller
///   can't lose admin mid-flight.
/// - **Idempotent.** Re-running with the same pairs is a no-op: rows already
///   carry the new identities, so nothing matches the old ones.
/// - **Verbatim.** All non-identity fields are preserved; only identity columns
///   and the primary/composite keys that embed an identity change.
///
/// Ephemeral tables (presence, typing, voice) are intentionally skipped — they
/// regenerate on reconnect, so re-keying them would be wasted work.
#[spacetimedb::reducer]
pub fn rekey_identities(ctx: &ReducerContext, pairs: Vec<IdentityRemap>) -> Result<(), String> {
    require_system_admin(ctx, ctx.sender())?;

    let map: HashMap<Identity, Identity> = pairs.iter().map(|p| (p.old, p.new)).collect();
    if map.is_empty() {
        return Ok(());
    }
    // Lower-case hex forms, for the one place identities live inside a string
    // rather than a column: read-state DM scope keys ("dm:{a}:{b}").
    let hexmap: HashMap<String, String> = pairs
        .iter()
        .map(|p| (p.old.to_string(), p.new.to_string()))
        .collect();

    let remap = |id: Identity| -> Identity { map.get(&id).copied().unwrap_or(id) };

    // ── user (primary key IS the identity) ──────────────────────────────────
    for row in ctx.db.user().iter().collect::<Vec<_>>() {
        let new_id = remap(row.identity);
        if new_id == row.identity {
            continue;
        }
        ctx.db.user().identity().delete(row.identity);
        // The old row is authoritative; drop any placeholder new-id row (e.g.
        // one a login created before the migration) so its data wins.
        if ctx.db.user().identity().find(new_id).is_some() {
            ctx.db.user().identity().delete(new_id);
        }
        let mut nu = row;
        nu.identity = new_id;
        ctx.db.user().insert(nu);
    }

    // ── identity-in-column tables (numeric PK, update in place) ──────────────
    for row in ctx.db.server().iter().collect::<Vec<_>>() {
        let owner = remap(row.owner_identity);
        if owner != row.owner_identity {
            let mut n = row;
            n.owner_identity = owner;
            ctx.db.server().id().update(n);
        }
    }
    for row in ctx.db.message().iter().collect::<Vec<_>>() {
        let sender = remap(row.sender_identity);
        if sender != row.sender_identity {
            let mut n = row;
            n.sender_identity = sender;
            ctx.db.message().id().update(n);
        }
    }
    for row in ctx.db.direct_message().iter().collect::<Vec<_>>() {
        let s = remap(row.sender_identity);
        let r = remap(row.recipient_identity);
        if s != row.sender_identity || r != row.recipient_identity {
            let mut n = row;
            n.sender_identity = s;
            n.recipient_identity = r;
            ctx.db.direct_message().id().update(n);
        }
    }
    for row in ctx.db.pinned_message().iter().collect::<Vec<_>>() {
        let by = remap(row.pinned_by);
        if by != row.pinned_by {
            let mut n = row;
            n.pinned_by = by;
            ctx.db.pinned_message().pin_id().update(n);
        }
    }
    for row in ctx.db.invite().iter().collect::<Vec<_>>() {
        let by = remap(row.created_by);
        if by != row.created_by {
            let mut n = row;
            n.created_by = by;
            ctx.db.invite().token().update(n);
        }
    }
    for row in ctx.db.dm_server_invite().iter().collect::<Vec<_>>() {
        let s = remap(row.sender_identity);
        let r = remap(row.recipient_identity);
        if s != row.sender_identity || r != row.recipient_identity {
            let mut n = row;
            n.sender_identity = s;
            n.recipient_identity = r;
            ctx.db.dm_server_invite().id().update(n);
        }
    }

    // ── composite-string-PK tables (key embeds an identity → delete+reinsert) ─
    for row in ctx.db.server_member().iter().collect::<Vec<_>>() {
        let uid = remap(row.user_identity);
        if uid == row.user_identity {
            continue;
        }
        ctx.db.server_member().member_key().delete(&row.member_key);
        let mut n = row;
        n.user_identity = uid;
        n.member_key = member_key(n.server_id, uid);
        ctx.db.server_member().insert(n);
    }
    for row in ctx.db.ban().iter().collect::<Vec<_>>() {
        let uid = remap(row.user_identity);
        let by = remap(row.banned_by);
        if uid == row.user_identity && by == row.banned_by {
            continue;
        }
        ctx.db.ban().ban_key().delete(&row.ban_key);
        let mut n = row;
        n.user_identity = uid;
        n.banned_by = by;
        n.ban_key = ban_key(n.server_id, uid);
        ctx.db.ban().insert(n);
    }
    for row in ctx.db.join_request().iter().collect::<Vec<_>>() {
        let uid = remap(row.user_identity);
        if uid == row.user_identity {
            continue;
        }
        ctx.db.join_request().request_key().delete(&row.request_key);
        let mut n = row;
        n.user_identity = uid;
        n.request_key = join_request_key(n.server_id, uid);
        ctx.db.join_request().insert(n);
    }
    for row in ctx.db.friend().iter().collect::<Vec<_>>() {
        let a = remap(row.user_a);
        let b = remap(row.user_b);
        let req = remap(row.requested_by);
        if a == row.user_a && b == row.user_b && req == row.requested_by {
            continue;
        }
        ctx.db.friend().pair_key().delete(&row.pair_key);
        let (x, y) = ordered_pair(a, b);
        let mut n = row;
        n.user_a = x;
        n.user_b = y;
        n.requested_by = req;
        n.pair_key = friend_pair_key(a, b);
        ctx.db.friend().insert(n);
    }
    for row in ctx.db.block().iter().collect::<Vec<_>>() {
        let blocker = remap(row.blocker);
        let blocked = remap(row.blocked);
        if blocker == row.blocker && blocked == row.blocked {
            continue;
        }
        ctx.db.block().block_key().delete(&row.block_key);
        let mut n = row;
        n.blocker = blocker;
        n.blocked = blocked;
        n.block_key = block_key(blocker, blocked);
        ctx.db.block().insert(n);
    }
    for row in ctx.db.read_state().iter().collect::<Vec<_>>() {
        let uid = remap(row.user_identity);
        let scope = remap_scope(&row.scope_key, &hexmap);
        if uid == row.user_identity && scope == row.scope_key {
            continue;
        }
        ctx.db.read_state().read_key().delete(&row.read_key);
        let mut n = row;
        n.user_identity = uid;
        n.read_key = format!("{scope}:{uid}");
        n.scope_key = scope;
        ctx.db.read_state().insert(n);
    }

    Ok(())
}

/// Rewrites any identities embedded in a read-state scope key. Only DM scopes
/// ("dm:{a}:{b}", sorted) carry identities; channel/server scopes pass through.
/// After substitution the pair is re-sorted so it still matches what the client
/// recomputes.
fn remap_scope(scope: &str, hexmap: &HashMap<String, String>) -> String {
    let Some(rest) = scope.strip_prefix("dm:") else {
        return scope.to_string();
    };
    let parts: Vec<&str> = rest.split(':').collect();
    if parts.len() != 2 {
        return scope.to_string();
    }
    let sub = |h: &str| -> String { hexmap.get(h).cloned().unwrap_or_else(|| h.to_string()) };
    let (a, b) = (sub(parts[0]), sub(parts[1]));
    let (x, y) = if a <= b { (a, b) } else { (b, a) };
    format!("dm:{x}:{y}")
}

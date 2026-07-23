use spacetimedb::{Identity, ReducerContext, Table};

use crate::helpers::require_system_admin;
use crate::schema::*;

/// Singleton primary key for the `ArchiveService` row.
const ARCHIVE_SERVICE_ID: u8 = 1;

/// Registers (or re-points) the identity of the archive replication worker.
/// Instance-admin gated — same trust boundary as `set_user_admin` /
/// `set_space_create_policy`.
///
/// Bootstrap flow (storage-tiering plan 2, phase 1):
///   1. Start the worker with its dedicated token; it connects and logs its
///      identity (the `onConnect` identity hex).
///   2. An instance admin calls this reducer with that identity.
///   3. The `archive_*` views now return the full dataset to the worker, so it
///      can backfill and replicate.
///
/// Idempotent: calling again with the same identity is a no-op; with a new
/// identity it re-points the singleton (e.g. after rotating the worker token).
#[spacetimedb::reducer]
pub fn set_archive_service_identity(
    ctx: &ReducerContext,
    service_identity: Identity,
) -> Result<(), String> {
    require_system_admin(ctx, ctx.sender())?;

    let row = ArchiveService {
        id: ARCHIVE_SERVICE_ID,
        service_identity,
    };
    if ctx
        .db
        .archive_service()
        .id()
        .find(ARCHIVE_SERVICE_ID)
        .is_some()
    {
        ctx.db.archive_service().id().update(row);
    } else {
        ctx.db.archive_service().insert(row);
    }
    Ok(())
}

/// True if `identity` is the registered archive worker. Used by the reducer-side
/// archive surfaces (eviction / restore, landing in later phases). The view-side
/// equivalent lives in `views.rs` because it takes a `ViewContext`.
pub(crate) fn is_archive_service(ctx: &ReducerContext, identity: Identity) -> bool {
    ctx.db
        .archive_service()
        .id()
        .find(ARCHIVE_SERVICE_ID)
        .map(|row| row.service_identity == identity)
        .unwrap_or(false)
}

// ─── Rebuild from cold archive (storage-tiering plan 2, A2) ────────────────────
//
// After an unavoidable destructive SpacetimeDB migration (`spacetime publish
// --delete-data` wipes ALL data), these reducers reload the durable tables from
// the PostgreSQL cold archive. The archive-worker's rebuild mode reads each
// archive table and calls the matching reducer here with the rows verbatim.
//
// Verbatim means: explicit primary keys are preserved (an `#[auto_inc]` id only
// auto-generates when it is `0`, so a non-zero restored id is kept as-is),
// explicit timestamps are kept, and NO validation / permission / business logic
// runs — this is a raw reload, not a user action. Gated to the registered
// archive worker identity. Idempotent per primary key (upsert), so a rebuild
// that dies partway can be re-run safely.
//
// Scope note: message + direct_message are implemented here — the unbounded
// bulk tables storage-tiering exists to protect, and the exact tables the E2EE
// plan's Phase-7 column drop touches. A full-DB rebuild (after --delete-data,
// which wipes every table) also needs the bounded tables (user, server, channel,
// server_member, ban, block, friend, invite, join_request, dm_server_invite,
// read_state) restored the same way; that is mechanical follow-on to add before
// scheduling a real whole-database migration.

/// Batch-restore `message` rows verbatim. Worker-only. See module note above.
#[spacetimedb::reducer]
pub fn archive_restore_message(ctx: &ReducerContext, rows: Vec<Message>) -> Result<(), String> {
    if !is_archive_service(ctx, ctx.sender()) {
        return Err("archive service identity only".into());
    }
    for row in rows {
        if ctx.db.message().id().find(row.id).is_some() {
            ctx.db.message().id().update(row);
        } else {
            ctx.db.message().insert(row);
        }
    }
    Ok(())
}

/// Batch-restore `direct_message` rows verbatim. Worker-only. See module note above.
#[spacetimedb::reducer]
pub fn archive_restore_direct_message(
    ctx: &ReducerContext,
    rows: Vec<DirectMessage>,
) -> Result<(), String> {
    if !is_archive_service(ctx, ctx.sender()) {
        return Err("archive service identity only".into());
    }
    for row in rows {
        if ctx.db.direct_message().id().find(row.id).is_some() {
            ctx.db.direct_message().id().update(row);
        } else {
            ctx.db.direct_message().insert(row);
        }
    }
    Ok(())
}

// The bounded durable tables. Same verbatim-upsert restore as message/dm; a
// whole-database rebuild (after `--delete-data` wipes everything) needs these
// alongside the two above. `byval` = Copy primary key (u64 / Identity), `byref`
// = String primary key (find takes a reference).
macro_rules! archive_restore {
    ($fn:ident, $row:ty, $tbl:ident, $pk:ident, byval) => {
        #[spacetimedb::reducer]
        pub fn $fn(ctx: &ReducerContext, rows: Vec<$row>) -> Result<(), String> {
            if !is_archive_service(ctx, ctx.sender()) {
                return Err("archive service identity only".into());
            }
            for row in rows {
                if ctx.db.$tbl().$pk().find(row.$pk).is_some() {
                    ctx.db.$tbl().$pk().update(row);
                } else {
                    ctx.db.$tbl().insert(row);
                }
            }
            Ok(())
        }
    };
    ($fn:ident, $row:ty, $tbl:ident, $pk:ident, byref) => {
        #[spacetimedb::reducer]
        pub fn $fn(ctx: &ReducerContext, rows: Vec<$row>) -> Result<(), String> {
            if !is_archive_service(ctx, ctx.sender()) {
                return Err("archive service identity only".into());
            }
            for row in rows {
                if ctx.db.$tbl().$pk().find(&row.$pk).is_some() {
                    ctx.db.$tbl().$pk().update(row);
                } else {
                    ctx.db.$tbl().insert(row);
                }
            }
            Ok(())
        }
    };
}

archive_restore!(archive_restore_user, User, user, identity, byval);
archive_restore!(archive_restore_server, Server, server, id, byval);
archive_restore!(archive_restore_channel, Channel, channel, id, byval);
archive_restore!(archive_restore_dm_server_invite, DmServerInvite, dm_server_invite, id, byval);
archive_restore!(archive_restore_server_member, ServerMember, server_member, member_key, byref);
archive_restore!(archive_restore_ban, Ban, ban, ban_key, byref);
archive_restore!(archive_restore_join_request, JoinRequest, join_request, request_key, byref);
archive_restore!(archive_restore_invite, Invite, invite, token, byref);
archive_restore!(archive_restore_friend, Friend, friend, pair_key, byref);
archive_restore!(archive_restore_block, Block, block, block_key, byref);
archive_restore!(archive_restore_read_state, ReadState, read_state, read_key, byref);
archive_restore!(archive_restore_pinned_message, PinnedMessage, pinned_message, pin_id, byval);

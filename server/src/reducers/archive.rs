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
#[allow(dead_code)]
pub(crate) fn is_archive_service(ctx: &ReducerContext, identity: Identity) -> bool {
    ctx.db
        .archive_service()
        .id()
        .find(ARCHIVE_SERVICE_ID)
        .map(|row| row.service_identity == identity)
        .unwrap_or(false)
}

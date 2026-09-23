use std::collections::HashSet;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use spacetimedb::{Identity, ReducerContext, Table, TimeDuration};

use crate::helpers::require_system_admin;
use crate::schema::*;

const MARKER_PREFIX: &str = "[[LC_ATTACHMENTS_V1:";
const MARKER_SUFFIX: &str = "]]";
const MAX_ATTACHMENTS_PER_MESSAGE: usize = 20;
const REFERENCE_STATE_ID: u8 = 1;
/// Quiet period after the last archive restore batch before a rebuild is trusted.
const RESTORE_QUIET_MICROS: i64 = 10 * 60 * 1_000_000;

#[derive(Deserialize)]
struct AttachmentPayload {
    v: u8,
    attachments: Vec<Attachment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Attachment {
    storage_key: String,
}

#[derive(Clone, Copy)]
pub(crate) enum AttachmentScope {
    Channel(u64),
    DirectMessage(Identity),
}

pub(crate) fn message_owner_key(message_id: u64) -> String {
    format!("message:{message_id}")
}

pub(crate) fn direct_message_owner_key(message_id: u64) -> String {
    format!("dm:{message_id}")
}

pub(crate) fn avatar_owner_key(username: &str) -> String {
    format!("avatar:{username}")
}

pub(crate) fn icon_owner_key(server_id: u64) -> String {
    format!("icon:{server_id}")
}

pub(crate) fn sync_message_references(
    ctx: &ReducerContext,
    owner_key: String,
    content: &str,
    sender: Identity,
    scope: AttachmentScope,
) -> Result<(), String> {
    let keys = attachment_keys(content)?;
    let sender_name = username(ctx, sender)?;
    let partner_name = match scope {
        AttachmentScope::DirectMessage(partner) => Some(username(ctx, partner)?),
        AttachmentScope::Channel(_) => None,
    };

    for key in &keys {
        ensure_not_claimed(ctx, key)?;
        let valid = match scope {
            AttachmentScope::Channel(channel_id) => {
                is_channel_key(key, channel_id, &sender_name) || is_legacy_key(key, &sender_name)
            }
            AttachmentScope::DirectMessage(_) => {
                is_dm_key(
                    key,
                    &sender_name,
                    partner_name.as_deref().unwrap_or_default(),
                ) || is_legacy_key(key, &sender_name)
            }
        };
        if !valid {
            return Err("attachment storage key does not match this message".into());
        }
    }

    replace_references(ctx, &owner_key, keys);
    Ok(())
}

/// Rebuild helper: archive rows were already accepted by the live reducers, so
/// recreate every syntactically valid reference without re-running current
/// scope rules that may have changed since the message was written. Never
/// fails: one legacy row with unparsable metadata, or a key whose object was
/// already collected, must not abort a whole restore batch or the rebuild.
pub(crate) fn restore_message_references(ctx: &ReducerContext, owner_key: String, content: &str) {
    let keys = attachment_keys(content).unwrap_or_default();
    replace_references(ctx, &owner_key, unclaimed(ctx, keys));
}

pub(crate) fn restore_single_reference(
    ctx: &ReducerContext,
    owner_key: String,
    storage_key: Option<&str>,
) {
    let keys = storage_key
        .filter(|key| key.starts_with("uploads/") && !key.contains(".."))
        .map(|key| vec![key.to_string()])
        .unwrap_or_default();
    replace_references(ctx, &owner_key, unclaimed(ctx, keys));
}

fn unclaimed(ctx: &ReducerContext, keys: Vec<String>) -> Vec<String> {
    keys.into_iter()
        .filter(|key| ensure_not_claimed(ctx, key).is_ok())
        .collect()
}

/// Called by the archive restore reducers: cleanup stops trusting the
/// reference table until a rebuild runs after the restore has gone quiet.
pub(crate) fn fence_archive_restore(ctx: &ReducerContext) {
    if let Some(mut state) = ctx
        .db
        .storage_reference_state()
        .id()
        .find(REFERENCE_STATE_ID)
    {
        state.ready = false;
        ctx.db.storage_reference_state().id().update(state);
    }
    let fence = StorageRestoreFence {
        id: REFERENCE_STATE_ID,
        last_restore_at: ctx.timestamp,
    };
    if ctx
        .db
        .storage_restore_fence()
        .id()
        .find(REFERENCE_STATE_ID)
        .is_some()
    {
        ctx.db.storage_restore_fence().id().update(fence);
    } else {
        ctx.db.storage_restore_fence().insert(fence);
    }
}

pub(crate) fn sync_avatar_reference(
    ctx: &ReducerContext,
    username: &str,
    storage_key: Option<&str>,
) -> Result<(), String> {
    let keys = match storage_key.filter(|key| !key.is_empty()) {
        Some(key) if is_avatar_key(key, username) || is_legacy_key(key, username) => {
            ensure_not_claimed(ctx, key)?;
            vec![key.to_string()]
        }
        Some(_) => return Err("avatar storage key does not belong to this account".into()),
        None => Vec::new(),
    };
    replace_references(ctx, &avatar_owner_key(username), keys);
    Ok(())
}

pub(crate) fn sync_icon_reference(
    ctx: &ReducerContext,
    server_id: u64,
    uploader: &str,
    storage_key: Option<&str>,
) -> Result<(), String> {
    let keys = match storage_key.filter(|key| !key.is_empty()) {
        Some(key) if is_icon_key(key, server_id, uploader) || is_legacy_key(key, uploader) => {
            ensure_not_claimed(ctx, key)?;
            vec![key.to_string()]
        }
        Some(_) => return Err("space icon storage key does not belong to this space".into()),
        None => Vec::new(),
    };
    replace_references(ctx, &icon_owner_key(server_id), keys);
    Ok(())
}

pub(crate) fn remove_references(ctx: &ReducerContext, owner_key: &str) {
    let keys: Vec<String> = ctx
        .db
        .storage_reference()
        .by_owner_key()
        .filter(owner_key)
        .map(|row| row.reference_key)
        .collect();
    for key in keys {
        ctx.db.storage_reference().reference_key().delete(&key);
    }
}

/// Rebuilds the derived table from live authoritative rows. Core-api calls this
/// before its collector trusts an empty reference result, covering additive
/// upgrades, a core-api/module rolling-deploy window, and destructive restores.
#[spacetimedb::reducer]
pub fn rebuild_storage_references(ctx: &ReducerContext) -> Result<(), String> {
    require_system_admin(ctx, ctx.sender())?;
    if let Some(fence) = ctx.db.storage_restore_fence().id().find(REFERENCE_STATE_ID)
        && ctx.timestamp < fence.last_restore_at + TimeDuration::from_micros(RESTORE_QUIET_MICROS)
    {
        return Err("archive restore in progress; storage references not rebuilt yet".into());
    }

    for row in ctx.db.storage_reference().iter().collect::<Vec<_>>() {
        ctx.db
            .storage_reference()
            .reference_key()
            .delete(&row.reference_key);
    }

    for row in ctx.db.message().iter() {
        if !row.deleted {
            restore_message_references(ctx, message_owner_key(row.id), &row.content);
        }
    }
    for row in ctx.db.direct_message().iter() {
        restore_message_references(ctx, direct_message_owner_key(row.id), &row.content);
    }
    for row in ctx.db.user().iter() {
        restore_single_reference(
            ctx,
            avatar_owner_key(&row.username),
            row.avatar_url.as_deref(),
        );
    }
    for row in ctx.db.server().iter() {
        restore_single_reference(ctx, icon_owner_key(row.id), row.icon_url.as_deref());
    }

    let state = StorageReferenceState {
        id: REFERENCE_STATE_ID,
        ready: true,
    };
    if ctx
        .db
        .storage_reference_state()
        .id()
        .find(REFERENCE_STATE_ID)
        .is_some()
    {
        ctx.db.storage_reference_state().id().update(state);
    } else {
        ctx.db.storage_reference_state().insert(state);
    }
    Ok(())
}

/// Atomically tombstones only keys which still have no reference. Reducers that
/// create references check the same table, so claim-vs-attach has one serial
/// winner and cleanup can never delete an object that was attached afterwards.
#[spacetimedb::reducer]
pub fn claim_unreferenced_storage(
    ctx: &ReducerContext,
    batch_id: String,
    storage_keys: Vec<String>,
) -> Result<(), String> {
    require_system_admin(ctx, ctx.sender())?;
    if batch_id.len() != 32 || !batch_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("invalid storage cleanup batch id".into());
    }
    if storage_keys.len() > 500 {
        return Err("too many storage keys".into());
    }
    let ready = ctx
        .db
        .storage_reference_state()
        .id()
        .find(REFERENCE_STATE_ID)
        .map(|state| state.ready)
        .unwrap_or(false);
    if !ready {
        return Err("storage references are not ready".into());
    }

    let batch = StorageCleanupBatch {
        requester: ctx.sender(),
        batch_id: batch_id.clone(),
    };
    if ctx
        .db
        .storage_cleanup_batch()
        .requester()
        .find(ctx.sender())
        .is_some()
    {
        ctx.db.storage_cleanup_batch().requester().update(batch);
    } else {
        ctx.db.storage_cleanup_batch().insert(batch);
    }

    let mut seen = HashSet::new();
    for storage_key in storage_keys {
        if !seen.insert(storage_key.clone())
            || ctx
                .db
                .storage_reference()
                .by_storage_key()
                .filter(&storage_key)
                .next()
                .is_some()
        {
            continue;
        }
        if let Some(mut claim) = ctx
            .db
            .storage_deletion_claim()
            .storage_key()
            .find(&storage_key)
        {
            claim.batch_id = batch_id.clone();
            ctx.db.storage_deletion_claim().storage_key().update(claim);
            continue;
        }
        ctx.db
            .storage_deletion_claim()
            .insert(StorageDeletionClaim {
                storage_key,
                claimed_at: ctx.timestamp,
                batch_id: batch_id.clone(),
            });
    }
    Ok(())
}

fn ensure_not_claimed(ctx: &ReducerContext, storage_key: &str) -> Result<(), String> {
    if ctx
        .db
        .storage_deletion_claim()
        .storage_key()
        .find(storage_key.to_owned())
        .is_some()
    {
        return Err("attachment upload expired; upload the file again".into());
    }
    Ok(())
}

fn replace_references(ctx: &ReducerContext, owner_key: &str, storage_keys: Vec<String>) {
    remove_references(ctx, owner_key);
    for storage_key in storage_keys {
        ctx.db.storage_reference().insert(StorageReference {
            reference_key: format!("{owner_key}:{storage_key}"),
            owner_key: owner_key.to_string(),
            storage_key,
        });
    }
}

fn attachment_keys(content: &str) -> Result<Vec<String>, String> {
    let Some(start) = content.rfind(MARKER_PREFIX) else {
        return Ok(Vec::new());
    };
    if !content.ends_with(MARKER_SUFFIX) {
        return Err("invalid attachment metadata".into());
    }
    let encoded = &content[start + MARKER_PREFIX.len()..content.len() - MARKER_SUFFIX.len()];
    let decoded = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| "invalid attachment metadata")?;
    let payload: AttachmentPayload =
        serde_json::from_slice(&decoded).map_err(|_| "invalid attachment metadata")?;
    if payload.v != 1 || payload.attachments.len() > MAX_ATTACHMENTS_PER_MESSAGE {
        return Err("invalid attachment metadata".into());
    }

    let mut seen = HashSet::new();
    let mut keys = Vec::with_capacity(payload.attachments.len());
    for attachment in payload.attachments {
        let key = attachment.storage_key.trim().to_string();
        if !key.starts_with("uploads/") || !seen.insert(key.clone()) {
            if key.starts_with("uploads/") {
                continue;
            }
            return Err("invalid attachment storage key".into());
        }
        keys.push(key);
    }
    Ok(keys)
}

fn username(ctx: &ReducerContext, identity: Identity) -> Result<String, String> {
    ctx.db
        .user()
        .identity()
        .find(identity)
        .map(|user| user.username)
        .ok_or_else(|| "attachment owner account not found".to_string())
}

fn parts(key: &str) -> Vec<&str> {
    key.split('/').collect()
}

fn is_channel_key(key: &str, channel_id: u64, uploader: &str) -> bool {
    let p = parts(key);
    p.len() == 5
        && p[0] == "uploads"
        && p[1] == "ch"
        && p[2] == channel_id.to_string()
        && p[3] == uploader
        && !p[4].is_empty()
}

fn is_dm_key(key: &str, uploader: &str, partner: &str) -> bool {
    let p = parts(key);
    p.len() == 5
        && p[0] == "uploads"
        && p[1] == "dm"
        && p[2] == uploader
        && p[3] == partner
        && !p[4].is_empty()
}

fn is_avatar_key(key: &str, uploader: &str) -> bool {
    let p = parts(key);
    p.len() == 4 && p[0] == "uploads" && p[1] == "avatar" && p[2] == uploader && !p[3].is_empty()
}

fn is_icon_key(key: &str, server_id: u64, uploader: &str) -> bool {
    let p = parts(key);
    p.len() == 5
        && p[0] == "uploads"
        && p[1] == "icon"
        && p[2] == server_id.to_string()
        && p[3] == uploader
        && !p[4].is_empty()
}

fn is_legacy_key(key: &str, uploader: &str) -> bool {
    let p = parts(key);
    p.len() == 6
        && p[0] == "uploads"
        && p[1].len() == 4
        && p[1].bytes().all(|b| b.is_ascii_digit())
        && p[4] == uploader
        && !p[5].is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_browser_attachment_marker_and_deduplicates_keys() {
        let json = br#"{"v":1,"attachments":[{"storageKey":"uploads/ch/5/alice/a.png"},{"storageKey":"uploads/ch/5/alice/a.png"}]}"#;
        let marker = format!(
            "hello\n\n{MARKER_PREFIX}{}{MARKER_SUFFIX}",
            URL_SAFE_NO_PAD.encode(json)
        );
        assert_eq!(
            attachment_keys(&marker).unwrap(),
            ["uploads/ch/5/alice/a.png"]
        );
    }

    #[test]
    fn rejects_a_truncated_marker_instead_of_losing_its_reference() {
        assert!(attachment_keys("[[LC_ATTACHMENTS_V1:not-base64]]").is_err());
    }
}

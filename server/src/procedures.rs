//! Read-only paging over history the subscription views deliberately leave out.
//!
//! `my_channel_messages` and `my_direct_messages` carry only the newest
//! `RECENT_MESSAGE_WINDOW` rows per channel / per conversation (BUG_ANALYSIS
//! C3). Everything older lives here: the client asks for one page at a time, so
//! a long-lived space costs a scroll, not a connect.
//!
//! Procedures rather than views because a view in SpacetimeDB 2.10 takes no
//! parameters (`Views do not take parameters other than &ViewContext`), so
//! "older than X" cannot be expressed as one. Procedures return their rows to
//! the caller only — nothing is written, nothing is broadcast.

use std::collections::HashSet;

use spacetimedb::{Identity, ProcedureContext, Timestamp, TxContext, log};

use crate::helpers::require_channel_access;
use crate::schema::*;
use crate::views::RECENT_MESSAGE_WINDOW;

/// Upper bound on one page, whatever the client asks for.
const MAX_PAGE: usize = RECENT_MESSAGE_WINDOW;

/// Resolve a bearer invite before use_invite can consume a single-use token.
/// Only its destination ID is returned; the reducer still authorizes joining.
#[spacetimedb::procedure]
pub fn resolve_invite_server(ctx: &mut ProcedureContext, token: String) -> Option<u64> {
    let caller = ctx.sender();
    ctx.with_tx(|tx| {
        require_readable_account(tx, caller).ok()?;
        let invite = tx.db.invite().token().find(&token)?;
        if tx.timestamp > invite.expires_at || invite.max_uses.is_some_and(|max| invite.use_count >= max) {
            return None;
        }
        if !invite.allowed_usernames.is_empty() {
            let user = tx.db.user().identity().find(caller)?;
            if !invite.allowed_usernames.contains(&user.username.trim().to_lowercase()) {
                return None;
            }
        }
        tx.db.server().id().find(invite.server_id).map(|server| server.id)
    })
}

/// Pinned content is independent of the caller's recent history window.
/// Match history authorization and never expose another channel's messages.
#[spacetimedb::procedure]
pub fn load_pinned_channel_messages(ctx: &mut ProcedureContext, channel_id: u64) -> Vec<Message> {
    let caller = ctx.sender();
    ctx.with_tx(|tx| {
        if require_readable_account(tx, caller).is_err() {
            return Vec::new();
        }
        let Some(channel) = tx.db.channel().id().find(channel_id) else {
            return Vec::new();
        };
        if require_channel_access(tx, &channel, caller).is_err() {
            return Vec::new();
        }
        tx.db.pinned_message().channel_id().filter(channel_id)
            .filter_map(|pin| tx.db.message().id().find(pin.message_id))
            .filter(|message| message.channel_id == channel_id && !message.deleted)
            .collect()
    })
}

fn page_size(limit: u32) -> usize {
    (limit as usize).clamp(1, MAX_PAGE)
}

/// Revalidate only history already cached by the caller. Missing or inaccessible
/// IDs are omitted so clients can remove hard-deleted and no-longer-readable rows.
#[spacetimedb::procedure]
pub fn refresh_channel_messages(
    ctx: &mut ProcedureContext,
    channel_id: u64,
    message_ids: Vec<u64>,
) -> Vec<Message> {
    let caller = ctx.sender();
    ctx.with_tx(|tx| {
        if require_readable_account(tx, caller).is_err() {
            return Vec::new();
        }
        let Some(channel) = tx.db.channel().id().find(channel_id) else {
            return Vec::new();
        };
        if require_channel_access(tx, &channel, caller).is_err() {
            return Vec::new();
        }
        message_ids.iter().copied().take(MAX_PAGE)
            .filter_map(|id| tx.db.message().id().find(id))
            .filter(|message| message.channel_id == channel_id)
            .collect()
    })
}

/// DM history uses the same per-conversation authorization as paging and views.
#[spacetimedb::procedure]
pub fn refresh_direct_messages(
    ctx: &mut ProcedureContext,
    partner: Identity,
    message_ids: Vec<u64>,
) -> Vec<DirectMessage> {
    let caller = ctx.sender();
    ctx.with_tx(|tx| {
        if require_readable_account(tx, caller).is_err() {
            return Vec::new();
        }
        message_ids.iter().copied().take(MAX_PAGE)
            .filter_map(|id| tx.db.direct_message().id().find(id))
            .filter(|message| (message.sender_identity == caller && message.recipient_identity == partner)
                || (message.recipient_identity == caller && message.sender_identity == partner))
            .collect()
    })
}

/// The caller must have an account, and it must not be disabled — the read-side
/// half of `require_account`.
///
/// The token-generation floor that `require_account` also enforces cannot be
/// checked here: inside `with_tx` the sender is `Identity::ZERO` and no JWT is
/// in scope, so there are no claims to read. Public reads must pass through the
/// core-api chat gateway, which checks the generation and closes revoked
/// sockets. The raw SpacetimeDB API is a private operator/service boundary.
fn require_readable_account(tx: &TxContext, caller: Identity) -> Result<(), String> {
    let user = tx
        .db
        .user()
        .identity()
        .find(caller)
        .ok_or_else(|| "no account for this identity".to_string())?;
    if user.suspended {
        return Err("this account has been disabled".to_string());
    }
    Ok(())
}

/// The newest `take` of `rows` that are older than `before`, oldest first.
///
/// ponytail: filters the channel's history in memory instead of using the
/// `by_channel_and_sent_at` / `by_sender_recipient_sent_at` index ranges. Same
/// scan the view does; swap in the index range scan if paging a very long
/// history ever shows up in a profile.
fn older_than<T>(mut rows: Vec<T>, before: (Timestamp, u64), key: impl Fn(&T) -> (Timestamp, u64), take: usize) -> Vec<T> {
    rows.retain(|row| key(row) < before);
    rows.sort_by_key(key);
    let start = rows.len().saturating_sub(take);
    rows.split_off(start)
}

/// One page of channel history older than `before`, oldest first.
///
/// Returns an empty page when the caller may not read the channel. The client
/// only ever asks about a channel it is already subscribed to, so an empty page
/// reads the same as "nothing older" — the denial is logged rather than
/// returned, because a procedure's return type has to be a plain
/// `SpacetimeType`.
#[spacetimedb::procedure]
pub fn load_older_channel_messages(
    ctx: &mut ProcedureContext,
    channel_id: u64,
    before: Timestamp,
    limit: u32,
) -> Vec<Message> {
    // Keep the original timestamp-only wire contract for released clients.
    load_older_channel_messages_page(ctx, channel_id, before, 0, limit)
}

/// Page by the exclusive (timestamp, id) cursor, including timestamp ties.
#[spacetimedb::procedure]
pub fn load_older_channel_messages_page(
    ctx: &mut ProcedureContext,
    channel_id: u64,
    before: Timestamp,
    before_id: u64,
    limit: u32,
) -> Vec<Message> {
    let caller = ctx.sender();
    let take = page_size(limit);

    ctx.with_tx(|tx| {
        let page = (|| -> Result<Vec<Message>, String> {
            require_readable_account(tx, caller)?;
            let channel = tx
                .db
                .channel()
                .id()
                .find(channel_id)
                .ok_or_else(|| "channel not found".to_string())?;
            require_channel_access(tx, &channel, caller)?;

            let history: Vec<Message> = tx.db.message().channel_id().filter(channel_id).collect();
            Ok(older_than(history, (before, before_id), |message| (message.sent_at, message.id), take))
        })();

        match page {
            Ok(rows) => rows,
            Err(error) => {
                log::warn!("load_older_channel_messages denied for {caller}: {error}");
                Vec::new()
            }
        }
    })
}

/// One page of a DM conversation older than `before`, oldest first.
///
/// Scoped to a conversation the caller is a party to, exactly like
/// `my_direct_messages`. Empty page on denial, as above.
#[spacetimedb::procedure]
pub fn load_older_direct_messages(
    ctx: &mut ProcedureContext,
    partner: Identity,
    before: Timestamp,
    limit: u32,
) -> Vec<DirectMessage> {
    // Keep the original timestamp-only wire contract for released clients.
    load_older_direct_messages_page(ctx, partner, before, 0, limit)
}

/// Page by the exclusive (timestamp, id) cursor, including timestamp ties.
#[spacetimedb::procedure]
pub fn load_older_direct_messages_page(
    ctx: &mut ProcedureContext,
    partner: Identity,
    before: Timestamp,
    before_id: u64,
    limit: u32,
) -> Vec<DirectMessage> {
    let caller = ctx.sender();
    let take = page_size(limit);

    ctx.with_tx(|tx| {
        if let Err(error) = require_readable_account(tx, caller) {
            log::warn!("load_older_direct_messages denied for {caller}: {error}");
            return Vec::new();
        }

        // A note to self matches both directions, so dedupe by id.
        let mut seen = HashSet::new();
        let thread: Vec<DirectMessage> = tx
            .db
            .direct_message()
            .sender_identity()
            .filter(caller)
            .filter(|row| row.recipient_identity == partner)
            .chain(
                tx.db
                    .direct_message()
                    .recipient_identity()
                    .filter(caller)
                    .filter(|row| row.sender_identity == partner),
            )
            .filter(|row| seen.insert(row.id))
            .collect();

        older_than(thread, (before, before_id), |message| (message.sent_at, message.id), take)
    })
}

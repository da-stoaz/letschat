# Plan: Group DMs

> **Status (2026-11-24): proposed, not implemented.** Scheduled ahead of
> [`3-e2ee.md`](3-e2ee.md), whose conversation model includes `group:<id>`.

## Decisions (Discord-like defaults)

| Topic | Decision |
|---|---|
| Size | 3–10 members including the creator |
| Who can be added | Only accepted friends of the person adding, with no block in either direction between them |
| Who can add | Any member |
| Owner powers | Rename, remove members, transfer ownership |
| Owner leaves | Ownership passes to the earliest-joined remaining member |
| Last member leaves | Group, messages and their storage references are deleted |
| Blocks inside a group | Do not gate group messages; the client hides a blocked person's messages (as Discord does) |
| History for new members | Full history (plaintext). Under E2EE, the conversation's `history_mode` applies |
| 1:1 DMs | Unchanged. "Add people" on a 1:1 DM creates a new group; it never converts the DM |
| Calls | One LiveKit room per group, limit = group size |

## Schema (`server/src/schema.rs`, additive)

```rust
// Private; read via `my_groups`.
#[spacetimedb::table(accessor = group_conversation)]
pub struct GroupConversation {
    #[primary_key]
    #[auto_inc]                         // allocated with next_id!
    pub id: u64,
    pub name: Option<String>,           // None = client shows member names
    pub owner_identity: Identity,
    pub created_at: Timestamp,
}

// Private; read via `my_group_members` (members of the caller's groups).
#[spacetimedb::table(
    accessor = group_member,
    index(accessor = by_group_and_user, btree(columns = [group_id, user_identity]))
)]
pub struct GroupMember {
    #[primary_key]
    pub member_key: String,             // "<group_id>:<identity>"
    #[index(btree)]
    pub group_id: u64,
    #[index(btree)]
    pub user_identity: Identity,
    pub added_by: Identity,
    pub joined_at: Timestamp,
}

// Private; read via `my_group_messages` (newest window per group, like DMs).
#[spacetimedb::table(
    accessor = group_message,
    index(accessor = by_group_and_sent_at, btree(columns = [group_id, sent_at]))
)]
pub struct GroupMessage {
    #[primary_key]
    #[auto_inc]                         // allocated with next_id!
    pub id: u64,
    #[index(btree)]
    pub group_id: u64,
    pub sender_identity: Identity,
    pub content: String,
    pub sent_at: Timestamp,
    pub edited_at: Option<Timestamp>,
}

// Private; read via `my_group_voice_participants`. Same connection-scoped
// cleanup as `VoiceParticipant` (client_disconnected sweeps it).
#[spacetimedb::table(
    accessor = group_voice_participant,
    index(accessor = by_group_and_user, btree(columns = [group_id, user_identity]))
)]
pub struct GroupVoiceParticipant {
    #[primary_key]
    pub voice_key: String,              // "<group_id>:<identity>"
    #[index(btree)]
    pub group_id: u64,
    #[index(btree)]
    pub user_identity: Identity,
    pub joined_at: Timestamp,
    pub muted: bool,
    pub deafened: bool,
    pub sharing_screen: bool,
    pub sharing_camera: bool,
    pub connection_id: Option<ConnectionId>,
}
```

Typing and read state reuse `typing_state` / `read_state` with scope
`group:<id>`; no new tables.

## Reducers (`server/src/reducers/groups.rs`, `group_voice.rs`)

- `create_group(member_identities: Vec<Identity>, name: Option<String>)`
- `add_group_member(group_id, identity)` · `remove_group_member(group_id, identity)` (owner) · `leave_group(group_id)`
- `rename_group(group_id, name: Option<String>)` (owner) · `transfer_group_ownership(group_id, identity)` (owner)
- `send_group_message(group_id, content)` · `edit_group_message(message_id, content)` (sender) · `delete_group_message(message_id)` (sender or owner; hard delete)
- `join_group_voice(group_id)` · `leave_group_voice(group_id)` · `update_group_voice_state(group_id, …)`
- Procedure `load_older_group_messages(group_id, before, limit)`, matching `load_older_direct_messages`

All gates are membership checks in the module; nothing is enforced only in the
client.

## Views (`server/src/views.rs`)

- New: `my_groups`, `my_group_members`, `my_group_messages`, `my_group_voice_participants`
- Extended: `my_visible_users` (group co-members), `my_typing_states` and `my_read_states` (`group:` scope)
- Archive: `archive_group_conversations`, `archive_group_members`, `archive_group_messages`

## Attachments

- core-api `StorageKey`: new scope `uploads/grp/{groupId}/{uploader}/{file}`, readable by current group members.
- Module `storage_refs.rs`: `AttachmentScope::Group(group_id)`, `group_message_owner_key`, `is_group_key`.
- core-api download grants check group membership through the module, as they do for channels.

## Calls

- core-api `VoiceRoom`: parse `group:<id>`; the token gate checks `group_voice_participant` presence as the user.
- `LiveKitVoiceReconciler`: compare group rooms with group voice presence.
- Client: reuse the DM call panel and ringing for groups.

## Archive

- core-api archive entities + EF migration for the three group tables.
- archive-worker replication and rebuild; `archive_restore_group_*` reducers.
- Rebuild the reference table to include group message references.

## Client

- `types/domain.ts`, `mappers.ts`, `sync.ts` subscriptions, `reducers.ts` wrappers, history paging.
- `groupStore` (or extend `dmStore`), notifications, unread state.
- UI: "New group" friend picker; groups listed with DMs; `GroupView` reusing the DM message components; members panel (add, remove, leave, rename, transfer); group calls.

## Phases

1. **Module + archive (text):** tables, reducers, views, restore, `bun run spacetime:generate`. Verify with `tests/security/` cases: non-members read and write nothing; friends-only add; size cap; owner-only actions; ownership transfer on leave.
2. **Client text UI:** create, list, chat, manage members, unread, notifications. Verify on the dev stack with three accounts.
3. **Attachments:** group storage scope end to end.
4. **Calls:** presence, core-api token + reconciler, UI. Verify with WS clients, not HTTP.
5. **Ship:** protocol/client-contract update, docs (`CODEBASE.md`, `SECURITY.md`), site roadmap, version bump.

# Security Plan: End-to-End Encryption — LetsChat

> **Status (reviewed 2026-11-19; schema section revised 2026-11-24): proposed, not implemented.** LetsChat does not
> currently provide end-to-end encryption; operators must not infer E2EE
> guarantees from this design document. The implemented security model is
> documented in [`SECURITY.md`](../../docs/SECURITY.md).

## Context
Messages and files are currently stored as plaintext; the server can read everything. This plan introduces end-to-end encryption for text messages (DMs + server channels) and file attachments. The server stores only ciphertext it can never read, plus wrapped key blobs it cannot open. All decryption happens on-device.

This plan does **not** use the Signal Protocol. Signal's Double Ratchet makes every message *decrypt-once* — message keys are destroyed after first decryption. That is incompatible with a multi-device productivity app that wants server-synced, re-readable history: a re-fetched ciphertext could never be decrypted again. Instead this plan uses a **per-conversation long-lived symmetric key**, wrapped per device. Decryption is a stateless symmetric operation that can run any number of times, on any authorized device.

The trade-off: no per-message forward secrecy. It is softened with **key epochs** — keys rotate on membership change and periodically — but a device that holds an epoch key can read all history encrypted under it. This is the standard model for E2EE team-chat tools and is the correct fit for this product.

This is **plan 3 of 4** — the `core-api` control plane and **Part A
(durability)** of `2-storage-tiering.md` are already implemented. Part A is a
prerequisite because the new key tables must be archived and restorable (see
the schema section); the schema changes themselves are all additive. Group DMs
([`group-dms.md`](group-dms.md)) land first so `group:<id>` conversations are
covered from the start. Part B (eviction) of storage-tiering
is **not** a prerequisite and may still be deferred. The companion
`4-efficiency-cache.md` (client-side local cache and search) depends on this
plan and is only sound because decryption here is repeatable. Full-history
search is scheduled **after** this plan, so it is built client-side over
decrypted messages from the start.

---

## Decisions

| Topic | Decision |
|---|---|
| Message encryption (DM + channel) | Per-conversation symmetric key `K`, XChaCha20-Poly1305 |
| Key distribution | `K` wrapped (X25519 ECDH) once per recipient **device** public key |
| Key epochs | Rotate on membership change, **and periodically** (~7 days or 2000 messages) |
| Channel history for new members | **Per-channel setting** — `JoinOnward` or `FullHistory` |
| File/attachment encryption | XChaCha20-Poly1305, per-file random key; key travels inside the encrypted message |
| Crypto implementation | RustCrypto crates in the **Tauri Rust backend**, exposed via `invoke` — no libsignal, no WASM |
| Multi-device | Each device has its own keypair; new devices authorized by an existing trusted device |
| Device authorization | Visual **verification-code comparison** (6-word phrase), no camera required; QR optional |
| Private key storage | Tauri Stronghold (OS-encrypted vault) |
| Message deletion | Hard delete — row fully removed from SpacetimeDB. DMs: delete-for-everyone |
| Backup | Local passphrase-encrypted export of device + conversation keys |

---

## Cryptographic Design

### Primitives
All crypto runs in the Tauri Rust backend (`src-tauri`), via RustCrypto crates, and is exposed to the frontend as `invoke` commands. Private key material never enters the WebView/JS heap.

| Purpose | Primitive | Crate |
|---|---|---|
| Key agreement / key wrapping | X25519 ECDH | `x25519-dalek` |
| Signatures (device trust chain) | Ed25519 | `ed25519-dalek` |
| Symmetric encryption | XChaCha20-Poly1305 | `chacha20poly1305` |
| Key derivation | HKDF-SHA256 | `hkdf` |
| Verification-code / fingerprint hashing | BLAKE2s | `blake2` |
| Backup passphrase KDF | Argon2id | `argon2` |

### Identity and devices
- The **user account** is unchanged — handled by `core-api`, username/password, JWT.
- Each **device** generates, on first run, its own:
  - Ed25519 **signing keypair** — proves device identity, signs trust attestations
  - X25519 **key-agreement keypair** — receives wrapped conversation keys
- Private halves live in Stronghold and never leave the device. Public halves are published to SpacetimeDB in the `UserDevice` table.
- A user's **device set** is the collection of their `Trusted` `UserDevice` rows. The server can insert a row but cannot forge an Ed25519 signature — so honest clients only trust devices whose authorization signature verifies (see *Device Authorization* below).

### Conversation keys and epochs
- A **conversation** is a channel or a DM pair. Its id:
  - channel: `channel:<channel_id>`
  - DM: `dm:<identityA>:<identityB>` with the two identities sorted lexicographically
- Each conversation has a current **epoch** `e` (a `u32`) with a 256-bit symmetric key `K_e`.
- A message is encrypted with `K_e` and tagged with `e`. Content stored on the server is `base64(nonce ‖ ciphertext+tag)`; AAD binds `conversation_id` and `epoch`.
- `K_e` is distributed by **wrapping** it once per recipient device:
  `wrap(K_e, deviceKexPub)` = ephemeral X25519 ECDH → HKDF → XChaCha20-Poly1305 encrypt of `K_e`.
  Each wrap is one `ConversationKey` row. Only that device's private key can unwrap it.
- Devices **retain every epoch key they receive**, so they can decrypt all history they are entitled to. A removed device simply never receives the keys for new epochs.

### Channel history modes (per-channel setting)
Each channel carries a `history_mode`:
- **`JoinOnward`** — a new member cannot read messages sent before they joined. Joining triggers an epoch rotation; the new member's devices receive only the new epoch key.
- **`FullHistory`** — a new member can read the whole backlog. On join, **all existing epoch keys** are wrapped to the new member's devices; no rotation is forced by the join itself.

Default for new channels: `JoinOnward`. Changeable any time by a moderator/owner; the change applies to future joins only. DMs have fixed two-person membership, so history modes do not apply — both participants (and their own future devices) always have full history.

### File attachments
1. Generate a random 256-bit key + 192-bit nonce per file.
2. XChaCha20-Poly1305 encrypt the file bytes client-side before PUT to MinIO.
3. MinIO stores an unreadable ciphertext blob — zero server CPU impact.
4. `{ url, key, nonce }` is embedded in the message **plaintext**, then the whole message is encrypted with `K_e`.
5. Because the message is re-decryptable on any authorized device, the file key is always recoverable — so file ciphertext can stay on MinIO indefinitely and be re-downloaded by any device. **Files do not need local persistence.**
6. A stolen presigned URL yields only undecryptable ciphertext.

### Message deletion
Hard delete — the row is fully removed from SpacetimeDB, which streams a "row removed" event to online subscribers. The server retains no content, sender, or timestamp.
- **Channel messages:** any author (or a moderator/owner) hard-deletes the row.
- **DMs:** delete-for-everyone — either participant deletes, the row is gone for both.

No "[message deleted]" placeholder — a placeholder is itself a signal that something was said. (The companion cache plan adds *tombstones* purely so offline clients can purge their local cache; that is a cache concern, not a server-retention one — see that plan.)

---

## Device Authorization Flow

Goal: a new device joins the user's device set **without trusting the server**. The server may attempt to inject a rogue device; the verification code defeats that.

1. **New device** generates its signing + kex keypairs and a random `device_id`, then calls `register_device(...)`. If the user has no existing trusted device, this device is auto-`Trusted` (trust-on-first-use anchor, self-signed). Otherwise it is registered `Pending`.
2. Both the new device and any existing trusted device independently compute a **verification code** = first 6 words of a BIP39-style wordlist mapping of `BLAKE2s(newDevice.signingPub ‖ newDevice.kexPub ‖ ownerIdentity)`.
   - The new device computes it from its own keys.
   - The existing device computes it from the keys in the `Pending` `UserDevice` row.
   - If the server swapped the keys, the two codes differ.
3. The user **visually compares** the 6-word code shown on both screens. No camera, no typing. A numeric form and an optional QR encoding are offered as conveniences but are not required.
4. On a match, the user taps **Approve** on the existing device. That device signs `device_id ‖ signingPub ‖ kexPub ‖ ownerIdentity` with its Ed25519 signing key and calls `authorize_device(device_id, signed_by_device, signature)`. The row becomes `Trusted`.
5. The authorizing device then **re-wraps every conversation/epoch key it holds** to the new device's kex public key (`publish_conversation_key` per key). The new device can now decrypt all conversations the user participates in.

**Peer verification:** when any client wraps a conversation key to another user's devices, it first verifies each target device's `authorization_signature` chains back to that user's TOFU anchor. Devices that fail verification are never wrapped to — this is what stops a server-injected device from receiving keys.

**Revocation:** `revoke_device` marks a device `Revoked`. This triggers an epoch rotation in every conversation the user belongs to, so the revoked device cannot read anything sent afterward.

---

## Key Rotation

A rotation creates epoch `e+1` with a fresh `K_{e+1}`, wrapped to the current authorized device set (excluding removed/revoked devices), and bumps `ConversationEpoch.current_epoch`.

**Triggers:**
- Channel member removed, or any device revoked → rotate (mandatory; excludes the removed devices)
- Channel member added when `history_mode = JoinOnward` → rotate (new member gets only the new epoch)
- Channel member added when `history_mode = FullHistory` → no rotation; existing epoch keys wrapped to the new member instead
- Periodic: every ~7 days or ~2000 messages per conversation, whichever first
- Manual rotation via key-management UI

Whichever client detects a trigger performs the rotation: it generates `K_{e+1}`, wraps it to every current device, calls `publish_conversation_key` per wrap, then `rotate_conversation_epoch`. Rotations are idempotent on epoch number — concurrent rotations resolve to the highest epoch.

---

## SpacetimeDB Schema Changes (`server/src/schema.rs`)

> **Revised 2026-11-24 against v1.8.0.** Follows the module's current
> conventions: base tables are private and clients read them through scoped
> `my_*` views (the archive worker through `archive_*` views); ids come from
> `next_id!` or a natural string key, never a bare `#[auto_inc]` insert; every
> change is additive, so no `--delete-data` and no archive rebuild is needed.

### Scope: E2EE is a per-conversation mode

A **conversation** is identified by the scope key the module already uses for
typing and read state:

| Kind | `conversation_id` |
|---|---|
| Space channel | `channel:<channel_id>` |
| 1:1 DM | `dm:<identityA>:<identityB>` (ordered — same as `dm_room_key`) |
| Group DM | `group:<group_id>` (see [`group-dms.md`](group-dms.md)) |

Each conversation is either **plaintext** (no `conversation_security` row — the
default, today's behaviour) or **E2EE** (a row exists). Both kinds coexist on
one instance and in one client. Device keys are per-user infrastructure that a
client creates the first time its user enters an E2EE conversation; users who
never do are unaffected.

Rules:

- **One-way switch.** `enable_conversation_e2ee` creates the row; no reducer
  removes it. History sent before the switch stays plaintext (the server
  already holds it); everything after is ciphertext.
- **The server enforces the mode on writes.** Plaintext send/edit reducers
  reject E2EE conversations, so an old client cannot leak plaintext into one;
  the encrypted reducers reject plaintext conversations.
- **Clients pin the mode.** A client that has seen a conversation as E2EE
  records that locally and refuses to send plaintext there even if the server
  later reports no row — otherwise a malicious server could downgrade it.
- **Who may enable:** 1:1 DM — either participant; group — the group owner;
  channel — a space Owner/Moderator. Channels in discoverable spaces and
  announcement channels may enable it, but the UI warns that anyone who can
  join receives the keys.

### New enums

```rust
#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum DeviceStatus { Pending, Trusted, Revoked }

#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum HistoryMode { JoinOnward, FullHistory }
```

### New tables (all private)

```rust
/// A device's public keys. Read via `my_devices` (own, every status) and
/// `my_peer_devices` (Trusted devices of people the caller shares a
/// conversation with: friends, space co-members, group co-members).
#[spacetimedb::table(accessor = user_device)]
pub struct UserDevice {
    #[primary_key]
    pub device_id: String,                 // random UUID generated on the device
    #[index(btree)]
    pub owner_identity: Identity,
    pub signing_public_key: String,        // base64 Ed25519
    pub kex_public_key: String,            // base64 X25519
    pub status: DeviceStatus,
    pub signed_by_device: String,          // authorizer's device_id (self for the TOFU anchor)
    pub authorization_signature: String,   // base64 Ed25519 over device_id ‖ keys ‖ owner
    pub display_name: String,
    pub created_at: Timestamp,
}

/// One row per E2EE conversation; absence means plaintext. Replaces the
/// earlier `ConversationEpoch` table and `Channel.history_mode` column, so the
/// existing `channel` table is not touched at all.
/// Read via `my_conversation_security` (conversations the caller belongs to).
#[spacetimedb::table(accessor = conversation_security)]
pub struct ConversationSecurity {
    #[primary_key]
    pub conversation_id: String,
    pub current_epoch: u32,
    pub history_mode: HistoryMode,          // DMs are always FullHistory
    /// Set by membership-removal and device-revocation reducers; cleared by
    /// `rotate_conversation_epoch`. The server cannot rotate (it holds no keys),
    /// so this tells the next online member's client to rotate before sending.
    pub rotation_required_since: Option<Timestamp>,
    pub enabled_by: Identity,
    pub enabled_at: Timestamp,
    pub rotated_at: Timestamp,
}

/// One epoch key wrapped to one recipient device. Read via
/// `my_conversation_keys` (rows where `recipient_identity` is the caller).
#[spacetimedb::table(
    accessor = conversation_key,
    index(accessor = by_conversation_epoch, btree(columns = [conversation_id, epoch]))
)]
pub struct ConversationKey {
    /// Natural key `"<conversation_id>|<epoch>|<recipient_device_id>"`:
    /// re-publishing the same wrap is an idempotent upsert, and there is no id
    /// to allocate or to collide after an archive rebuild.
    #[primary_key]
    pub key_id: String,
    pub conversation_id: String,
    pub epoch: u32,
    #[index(btree)]
    pub recipient_device_id: String,
    /// Denormalised so the view filters by caller without joining `user_device`.
    #[index(btree)]
    pub recipient_identity: Identity,
    pub wrapped_key: String,               // base64: ephemeralPub ‖ nonce ‖ ciphertext+tag
    /// The wrap is signed by the sending device. Without this the server could
    /// publish a key it chose itself as a "new epoch" and read everything sent
    /// under it; recipients reject wraps whose signer is not a verified
    /// Trusted device of a conversation member.
    pub wrapped_by_device: String,
    pub wrap_signature: String,            // base64 Ed25519 over key_id ‖ wrapped_key
    pub created_at: Timestamp,
}
```

### Modified tables (additive)

```rust
// Message, DirectMessage, and GroupMessage (group-dms.md) each gain:
#[default(None::<u32>)]
pub epoch: Option<u32>,   // None = plaintext; Some(e) = `content` is ciphertext under epoch e
```

`content` holds `base64(nonce ‖ ciphertext+tag)` when `epoch` is `Some`; AAD
binds `conversation_id`, `epoch`, and the sender identity.

The `deleted` / `deleted_by_*` columns are **kept** (left `false` on encrypted
rows, which are hard-deleted instead). This drops the destructive migration
from the earlier draft, and with it the dependency on a full-table archive
restore.

### Views

| View | Returns |
|---|---|
| `my_devices` | the caller's own devices, every status (key-management UI, pending approvals) |
| `my_peer_devices` | `Trusted` devices whose owner shares a conversation with the caller |
| `my_conversation_security` | rows for channels in the caller's spaces, the caller's DMs and groups |
| `my_conversation_keys` | `conversation_key` rows with `recipient_identity == caller` |
| `archive_user_devices`, `archive_conversation_security`, `archive_conversation_keys` | worker-only full tables |

The three new tables **must be replicated to the cold archive and restorable**
(`archive_restore_*` reducers, Postgres archive entities, archive-worker
replication + rebuild) before E2EE ships. The wrapped keys are the only copy
outside the devices: a rebuild that drops them leaves every encrypted message
readable only on devices that still hold the keys locally.

### New reducers

Existing reducer signatures do not change (reducers are a compatibility
boundary); encrypted traffic goes through new reducers.

```rust
pub struct WrappedKeyInput {               // SpacetimeType
    pub recipient_device_id: String,
    pub wrapped_key: String,
    pub wrapped_by_device: String,
    pub wrap_signature: String,
}
```

| Reducer | Gate |
|---|---|
| `register_device(device_id, signing_pub, kex_pub, display_name, self_signature)` | account; `Trusted` if the owner's first device, else `Pending` |
| `authorize_device(device_id, signed_by_device, signature)` | caller owns both devices; signer is `Trusted` |
| `revoke_device(device_id)` | owner; sets `rotation_required_since` on every E2EE conversation the owner is in |
| `enable_conversation_e2ee(conversation_id, history_mode, epoch0_keys: Vec<WrappedKeyInput>)` | per-kind permission above; creates the row at epoch 0 and its wraps atomically; fails if a row exists |
| `set_conversation_history_mode(conversation_id, mode)` | same permission; applies to future joins only |
| `rotate_conversation_epoch(conversation_id, new_epoch, keys: Vec<WrappedKeyInput>)` | member; `new_epoch == current + 1`; wraps and epoch bump in one transaction; clears `rotation_required_since`; a concurrent loser gets an error and re-reads |
| `publish_conversation_keys(conversation_id, epoch, keys: Vec<WrappedKeyInput>)` | member; for existing epochs only (`FullHistory` joins, a newly authorized device) |
| `send_encrypted_message(channel_id, epoch, ciphertext, attachment_keys)` | as `send_message`; conversation must be E2EE |
| `send_encrypted_direct_message(recipient, epoch, ciphertext, attachment_keys)` | as `send_direct_message` |
| `send_encrypted_group_message(group_id, epoch, ciphertext, attachment_keys)` | as `send_group_message` |
| `edit_encrypted_message` / `edit_encrypted_direct_message` / `edit_encrypted_group_message` `(message_id, epoch, ciphertext, attachment_keys)` | as the plaintext edit |

For every `WrappedKeyInput` the module checks: `wrapped_by_device` is the
caller's `Trusted` device, and the recipient device is `Trusted` and owned by a
current member. Signatures are verified by clients, not the module.

Encrypted send/edit checks: `epoch` is `current_epoch` or `current_epoch - 1`
(grace for an in-flight rotation); ciphertext ≤ 16 000 bytes.

**`attachment_keys: Vec<String>`** replaces the server-side parse of `content`
for encrypted rows. `sync_message_references` currently extracts storage keys
from the plaintext; on ciphertext it would find none, so the cleanup worker
would delete every encrypted attachment. A new
`sync_references_from_keys(owner_key, keys, sender, scope)` in
`storage_refs.rs` applies the same per-scope key validation and claim checks to
the explicit list. The list reveals only which objects a message references,
which the server already knows from the upload.

### Modified reducers

- Plaintext `send_*` / `edit_*`: reject when the conversation has a
  `conversation_security` row.
- `delete_message` / `delete_direct_message` / `delete_group_message`: an
  encrypted row (`epoch.is_some()`) is hard-deleted for everyone, with its
  storage references. Plaintext rows keep today's behaviour.
- Membership removal (kick, ban, leave space, group remove/leave): set
  `rotation_required_since` on the affected E2EE conversations.

### Calls (no schema)

A call in an E2EE conversation derives its LiveKit frame key from the current
epoch key: `HKDF(K_e, "letschat-call-v1" ‖ room)` fed to LiveKit's
`ExternalE2EEKeyProvider`. A rotation mid-call re-keys the call. No table, and
no core-api change: the token and presence gates stay as they are.

### Open decision, schema-independent

The **web client** has no Tauri backend or Stronghold. Decide before Phase 1:
WebCrypto/WASM with keys in IndexedDB, or E2EE conversations desktop-only
(the web client shows "open in the desktop app"). The per-conversation mode
makes the second option degrade gracefully.

### Rollout gate

Older clients decode the new `epoch` column only after regenerating bindings,
and would render ciphertext as text. Bump the client protocol with this
release, and refuse `enable_conversation_e2ee` until the instance's minimum
client protocol includes E2EE support.

---

## SpacetimeDB Constraints & Risks

E2EE blinds the server, so this plan uses SpacetimeDB outside its server-readable-data sweet spot. The following are known edges — not blockers, but they shape the design and should be watched during implementation:

1. **Reducers cannot return data to the caller.** Reducers only mutate tables; clients observe results via subscriptions. This plan already accommodates that — `register_device`, `authorize_device`, `publish_conversation_key`, `rotate_conversation_epoch` all write rows that clients pick up by subscribing to `UserDevice` / `ConversationEpoch` / `ConversationKey`. Keep it that way: any future "fetch X" step must be a subscription, never a reducer return value.

2. **Key metadata is visible to the server, not to other users.** `conversation_key` is private and each user reads only their own rows through `my_conversation_keys`. The server (and the archive) still sees which device holds keys for which conversation. Accepted: membership is server-visible already.

3. **Destructive migrations.** None are needed: the schema section keeps the `deleted*` columns. Keep it that way (`Option<T>` / `#[default]`).

4. **No server-side content logic.** The server cannot validate, search, or moderate message content — it sees only ciphertext. Length checks become loose ciphertext-size bounds; any content moderation must be client-side.

If Phases 3–4 keep fighting these edges, treat that as a signal to re-evaluate the datastore — a single migration prompt is not.

---

## Key Lifecycle

### First run on a device
1. Generate Ed25519 signing keypair + X25519 kex keypair.
2. Store private keys in Stronghold (vault unlocked by the account password at login).
3. `register_device(...)` → `Trusted` (first device) or `Pending` (awaiting approval).
4. If `Trusted` first device: nothing else. If `Pending`: run the Device Authorization Flow.

### Key storage

| Material | Where |
|---|---|
| Device signing private key | Tauri Stronghold |
| Device kex private key | Tauri Stronghold |
| Conversation epoch keys (`K_e`, all epochs held) | Tauri Stronghold |
| Device public keys, wrapped epoch keys | SpacetimeDB (public — no secrets) |

### Account-password coupling
The Stronghold vault is unlocked with the account password. A password **change** must re-key the vault in the same flow. A server-side password **reset** cannot recover the vault — keys are then only recoverable from a device that is still unlocked, or from a backup. This is correct E2EE behavior and must be surfaced in the UI.

### Backup
- Manual export: `LetsChat-backup-YYYY-MM-DD.enc` to a user-chosen folder.
- Contents: device keypairs + all held conversation epoch keys.
- Encrypted with a user-chosen passphrase: Argon2id → XChaCha20-Poly1305.
- Import on a fresh install restores key material; the device still registers and (if not the first device) goes through authorization.

---

## Encryption — Send Path

### Messages (`src/lib/spacetimedb/reducers.ts`)
```
1. Resolve conversation_id and read ConversationEpoch.current_epoch
2. Ensure the current epoch key exists locally:
   - if missing, unwrap it from this device's ConversationKey row
   - if no epoch key exists at all (new conversation), generate K_0,
     wrap to every member device, publish_conversation_key, rotate_conversation_epoch
3. invoke('crypto_encrypt_message', { conversationId, epoch, plaintext }) -> base64
4. Call send_message / send_direct_message with { content: base64, encrypted: true, epoch }
```

### File attachments (`src/lib/crypto/files.ts`)
```
1. invoke('crypto_encrypt_file', { bytes }) -> { ciphertext, key, nonce }
2. PUT ciphertext to MinIO via the existing presigned-URL flow
3. Embed { url, key, nonce } into the message plaintext
4. Plaintext is then encrypted via the message send path above
```

---

## Decryption — Receive Path

### Messages (`src/lib/spacetimedb/mappers.ts`)
```
1. If encrypted === false: return content as-is (legacy plaintext)
2. Ensure the epoch key for { conversation_id, epoch } is held locally;
   if missing, unwrap it from this device's ConversationKey row
3. invoke('crypto_decrypt_message', { conversationId, epoch, content }) -> plaintext
4. Return plaintext to the Zustand store
```
Decryption is async (an `invoke` call) — `mapMessage` / `mapDirectMessage` become async, and `sync.ts`'s subscription handler must await them.

### File attachments
```
1. Fetch the encrypted blob from MinIO
2. Take { key, nonce } from the decrypted message content
3. invoke('crypto_decrypt_file', { ciphertext, key, nonce }) -> file bytes
```

### Missing epoch key
If a message references an epoch this device has no `ConversationKey` row for (e.g. the distribution row has not synced yet), render a transient "decrypting…" state and retry when new `ConversationKey` rows arrive. Do not show an error permanently.

---

## New Files

| File | Purpose |
|---|---|
| `src-tauri/src/crypto.rs` | All crypto primitives + Stronghold-backed key store, exposed as `invoke` commands |
| `src/lib/crypto/devices.ts` | Device registration, authorization flow, verification-code computation |
| `src/lib/crypto/conversations.ts` | Conversation key lifecycle: create, rotate, wrap to devices, fetch & unwrap |
| `src/lib/crypto/messages.ts` | Thin wrappers over `crypto_encrypt_message` / `crypto_decrypt_message` |
| `src/lib/crypto/files.ts` | Thin wrappers over `crypto_encrypt_file` / `crypto_decrypt_file` |
| `src/lib/crypto/backup.ts` | Passphrase-encrypted export/import |
| `src/features/settings/KeyManagement.tsx` | Device list, authorization UI, verification-code compare, backup, revoke |

---

## Modified Files

| File | Change |
|---|---|
| `server/src/schema.rs` | New enums + `user_device` / `conversation_security` / `conversation_key`; add `epoch: Option<u32>` to message tables |
| `server/src/reducers/messages.rs` | New encrypted send/edit reducers; plaintext ones reject E2EE channels; hard delete for encrypted rows |
| `server/src/reducers/direct_messages.rs` | Same for DMs (and `group_messages.rs` for groups) |
| `server/src/storage_refs.rs` | `sync_references_from_keys` for explicit attachment keys |
| `server/src/views.rs` | `my_devices`, `my_peer_devices`, `my_conversation_security`, `my_conversation_keys`, `archive_*` |
| `core-api` archive entities + `archive-worker` | Replicate and restore the three new tables |
| `server/src/reducers/` (new file) | `devices.rs` + `keys.rs` for the new reducers |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-stronghold` + RustCrypto crates |
| `src-tauri/src/lib.rs` | Register Stronghold plugin + `crypto.rs` commands |
| `src-tauri/tauri.conf.json` | Stronghold capability |
| `src/lib/spacetimedb/reducers.ts` | Encrypt before calling send reducers |
| `src/lib/spacetimedb/mappers.ts` | Async decrypt in `mapMessage` / `mapDirectMessage` |
| `src/lib/spacetimedb/sync.ts` | Subscribe to the four new views; await async mappers |

---

## Implementation Phases

### Phase 1 — Crypto foundation (days 1–3)
- Add RustCrypto crates + `tauri-plugin-stronghold`; wire Stronghold open/close to login/logout.
- `crypto.rs`: device keygen, conversation-key gen, wrap/unwrap, message + file encrypt/decrypt, verification-code hashing — all as `invoke` commands.
- Add the new SpacetimeDB enums/tables/views and the `epoch` fields (additive publish); archive replication + restore for the new tables.

### Phase 2 — Device identity & multi-device (days 4–8)
- `devices.ts`: `register_device`, authorization flow, verification-code computation.
- `KeyManagement.tsx`: device list, pending-device approval, side-by-side verification-code compare (+ numeric / optional QR).
- `authorize_device` / `revoke_device` reducers; peer signature-chain verification.
- Verify: second device registers `Pending`, codes match across screens, approval makes it `Trusted`.

### Phase 3 — DM encryption (days 9–12)
- `conversations.ts`: epoch-key lifecycle for DMs (fixed membership, full history).
- Wire encrypt into `sendDirectMessage`, async decrypt into `mapDirectMessage`.
- Verify: two clients exchange DMs; `spacetime sql` on `direct_message` shows base64 ciphertext only.

### Phase 4 — Channel encryption & history modes (days 13–18)
- Channel epoch keys; `set_channel_history_mode`; `JoinOnward` vs `FullHistory` join handling.
- Rotation on member removal / device revoke.
- Verify: 3-client channel holds ciphertext only; a `JoinOnward` joiner cannot read prior messages; a `FullHistory` joiner can.

### Phase 5 — Periodic rotation (days 19–20)
- Time/message-count rotation triggers; idempotent concurrent-rotation handling.
- Verify: epoch advances after the threshold; old messages still decrypt with retained old keys.

### Phase 6 — File encryption (days 21–23)
- `files.ts` + `crypto_encrypt_file`/`crypto_decrypt_file`; encrypt before MinIO PUT, decrypt after download.
- Verify: a raw MinIO object is undecryptable without the in-message key.

### Phase 7 — Hard delete (days 24–25)
- Hard-delete encrypted rows in `delete_message` / `delete_direct_message` / `delete_group_message`; client handles "row removed" events.
- Verify: deleted row is gone from SpacetimeDB — no sender, timestamp, or content retained.

### Phase 8 — Backup (days 26–28)
- `backup.ts`: passphrase-encrypted export/import; backup UI in `KeyManagement.tsx`.
- Verify: export, fresh install, import → device keys + conversation keys restored.

---

## Verification Checklist

1. **DM ciphertext** — `spacetime sql` on `direct_message`: content is base64, not plaintext.
2. **Channel ciphertext** — same for `message`.
3. **Re-decryptable** — disconnect, reconnect, re-fetch the same ciphertext → still decrypts (the property Signal lacked).
4. **File ciphertext** — raw MinIO object is unreadable without the in-message key.
5. **File key hidden** — key/nonce are not in MinIO or SpacetimeDB, only inside the encrypted message.
6. **Multi-device** — authorize a second device via code compare → it decrypts all existing conversations.
7. **Server cannot inject a device** — a `UserDevice` row with a bad signature is rejected by peers; no keys wrapped to it.
8. **`JoinOnward`** — a new channel member cannot decrypt pre-join messages.
9. **`FullHistory`** — a new channel member decrypts the full backlog.
10. **Member removal** — removed member's next-epoch decryption fails.
11. **Periodic rotation** — epoch advances on threshold; retained old epoch keys still decrypt old messages.
12. **Hard delete** — deleted row is gone from SpacetimeDB; DM delete removes it for both participants.
13. **Legacy messages** — `encrypted = false` rows render as plaintext, no decryption attempted.
14. **Backup restore** — import on a fresh install restores device + conversation keys.

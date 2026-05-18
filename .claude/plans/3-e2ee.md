# Security Plan: End-to-End Encryption — LetsChat

## Context
Messages and files are currently stored as plaintext; the server can read everything. This plan introduces end-to-end encryption for text messages (DMs + server channels) and file attachments. The server stores only ciphertext it can never read, plus wrapped key blobs it cannot open. All decryption happens on-device.

This plan does **not** use the Signal Protocol. Signal's Double Ratchet makes every message *decrypt-once* — message keys are destroyed after first decryption. That is incompatible with a multi-device productivity app that wants server-synced, re-readable history: a re-fetched ciphertext could never be decrypted again. Instead this plan uses a **per-conversation long-lived symmetric key**, wrapped per device. Decryption is a stateless symmetric operation that can run any number of times, on any authorized device.

The trade-off: no per-message forward secrecy. It is softened with **key epochs** — keys rotate on membership change and periodically — but a device that holds an epoch key can read all history encrypted under it. This is the standard model for E2EE team-chat tools and is the correct fit for this product.

This is **plan 3 of 4** — implemented after `1-control-panel.md` and `2-storage-tiering.md`. The companion `4-efficiency-cache.md` (client-side local cache and search) depends on this plan and is only sound because decryption here is repeatable.

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

### New enums

```rust
#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum DeviceStatus { Pending, Trusted, Revoked }

#[derive(SpacetimeType, Clone, PartialEq, Eq)]
pub enum HistoryMode { JoinOnward, FullHistory }
```

### New tables

```rust
// A device belonging to a user. Public keys only — world-readable so peers can encrypt to it.
#[spacetimedb::table(accessor = user_device, public,
    index(accessor = by_owner, btree(columns = [owner_identity])))]
pub struct UserDevice {
    #[primary_key]
    pub device_id: String,                 // random UUID generated on the device
    pub owner_identity: Identity,
    pub signing_public_key: String,         // base64 Ed25519
    pub kex_public_key: String,             // base64 X25519
    pub status: DeviceStatus,
    pub signed_by_device: String,           // device_id of the authorizer (self for TOFU anchor)
    pub authorization_signature: String,    // base64 Ed25519 signature over the device's keys
    pub display_name: String,               // e.g. "Felix's Laptop"
    pub created_at: Timestamp,
}

// Current epoch for a conversation (channel or DM).
#[spacetimedb::table(accessor = conversation_epoch, public)]
pub struct ConversationEpoch {
    #[primary_key]
    pub conversation_id: String,            // "channel:<id>" | "dm:<idA>:<idB>"
    pub current_epoch: u32,
    pub rotated_at: Timestamp,
}

// One epoch key wrapped to one recipient device. Ciphertext only — safe to be public.
#[spacetimedb::table(accessor = conversation_key, public,
    index(accessor = by_recipient_device, btree(columns = [recipient_device_id])),
    index(accessor = by_conversation, btree(columns = [conversation_id])))]
pub struct ConversationKey {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub conversation_id: String,
    pub epoch: u32,
    pub recipient_device_id: String,
    pub wrapped_key: String,                // base64: ephemeralPub ‖ nonce ‖ ciphertext+tag
    pub created_at: Timestamp,
}
```

### Modified tables

```rust
// Channel — add history mode (migration-safe default)
#[default(HistoryMode::JoinOnward)]
pub history_mode: HistoryMode,

// Message — add epoch + encrypted flag, DROP `deleted`
#[default(false)]
pub encrypted: bool,
#[default(0)]
pub epoch: u32,

// DirectMessage — add epoch + encrypted flag, DROP `deleted_by_sender` and `deleted_by_recipient`
#[default(false)]
pub encrypted: bool,
#[default(0)]
pub epoch: u32,
```

Legacy rows keep `encrypted = false`, `epoch = 0`, and render as plaintext — no decryption attempted.

> **Migration note — needs a decision at implementation time.** Adding fields with `#[default(...)]` is non-destructive. **Dropping** `deleted` / `deleted_by_sender` / `deleted_by_recipient` is a destructive migration; `spacetime publish` will halt on the "requires deleting data" prompt. Two options: (a) since the app is pre-release (v0.3.1), accept a one-time `bun run spacetime:reset`; (b) leave the old columns in place, unused, and drop them in a later deliberate migration. Confirm which before running Phase 1's publish. If `#[default(HistoryMode::JoinOnward)]` is rejected by the toolchain, fall back to `Option<HistoryMode>` with `None` treated as `JoinOnward`.

### New reducers
- `register_device(device_id, signing_pub, kex_pub, display_name)` — insert `UserDevice`; status `Trusted` if it is the owner's first device, else `Pending`
- `authorize_device(device_id, signed_by_device, signature)` — caller's identity must own the device; set `Trusted`, store signature
- `revoke_device(device_id)` — owner only; set `Revoked`
- `rotate_conversation_epoch(conversation_id, new_epoch)` — upsert `ConversationEpoch`; only accepts a strictly higher epoch
- `publish_conversation_key(conversation_id, epoch, recipient_device_id, wrapped_key)` — insert a `ConversationKey` row (caller must be a conversation member)
- `set_channel_history_mode(channel_id, mode)` — moderator/owner only

### Modified reducers
- `send_message` / `send_direct_message` — accept `encrypted: bool` and `epoch: u32`; relax content length from `1..=4000` (ciphertext is longer — allow up to `~16000`)
- `edit_message` / `edit_direct_message` — same length relaxation (edited ciphertext)
- `delete_message` — hard delete: `ctx.db.message().id().delete(message_id)`
- `delete_direct_message` — hard delete (delete-for-everyone); drop the per-participant soft-delete logic

---

## SpacetimeDB Constraints & Risks

E2EE blinds the server, so this plan uses SpacetimeDB outside its server-readable-data sweet spot. The following are known edges — not blockers, but they shape the design and should be watched during implementation:

1. **Reducers cannot return data to the caller.** Reducers only mutate tables; clients observe results via subscriptions. This plan already accommodates that — `register_device`, `authorize_device`, `publish_conversation_key`, `rotate_conversation_epoch` all write rows that clients pick up by subscribing to `UserDevice` / `ConversationEpoch` / `ConversationKey`. Keep it that way: any future "fetch X" step must be a subscription, never a reducer return value.

2. **`ConversationKey` is world-readable metadata.** The table is `public` so a device can fetch its wrapped keys. The `wrapped_key` blobs are ciphertext (safe), but the rows still leak *which device has access to which conversation* (`recipient_device_id` ↔ `conversation_id`). For channels this is already implied by public `ServerMember`; for DMs it is largely redundant too. Accepted for now. If SpacetimeDB row-level security matures, restrict `ConversationKey` so a device sees only rows addressed to it. Call this out in any security review.

3. **Destructive migrations.** Column removal and other non-additive schema changes wipe table data (see the Migration note above). Keep schema changes additive (`Option<T>` / `#[default]`); batch any unavoidable destructive change into a deliberate reset.

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
| `server/src/schema.rs` | New enums + tables; add `history_mode`/`encrypted`/`epoch`; drop `deleted*` fields |
| `server/src/reducers/messages.rs` | Hard delete; accept `encrypted`/`epoch`; relax length on send + edit |
| `server/src/reducers/direct_messages.rs` | Hard delete (delete-for-everyone); accept `encrypted`/`epoch`; relax length |
| `server/src/reducers/` (new file) | `devices.rs` + `keys.rs` for the new reducers |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-stronghold` + RustCrypto crates |
| `src-tauri/src/lib.rs` | Register Stronghold plugin + `crypto.rs` commands |
| `src-tauri/tauri.conf.json` | Stronghold capability |
| `src/lib/spacetimedb/reducers.ts` | Encrypt before calling send reducers |
| `src/lib/spacetimedb/mappers.ts` | Async decrypt in `mapMessage` / `mapDirectMessage` |
| `src/lib/spacetimedb/sync.ts` | Subscribe to `UserDevice`, `ConversationEpoch`, `ConversationKey`; await async mappers |

---

## Implementation Phases

### Phase 1 — Crypto foundation (days 1–3)
- Add RustCrypto crates + `tauri-plugin-stronghold`; wire Stronghold open/close to login/logout.
- `crypto.rs`: device keygen, conversation-key gen, wrap/unwrap, message + file encrypt/decrypt, verification-code hashing — all as `invoke` commands.
- Add new SpacetimeDB enums/tables and the modified fields; resolve the migration note; publish.

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
- Hard-delete `delete_message` / `delete_direct_message`; client handles "row removed" events.
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

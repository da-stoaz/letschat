# Tasks: Finish the half-implemented features ("runs great for the friend group")

**Goal:** make LetsChat feel *finished* for private, self-hosted use by a small
group — no ambition to ship to the world, no product-scale infra. Just: nothing
looks broken, nothing greyed-out with no explanation.

## Verified state (2026-07-11) — most of the old audit is already DONE

Fresh verification against current code. The 59-day-old audit was stale:

- ✅ **File attachments — DONE end-to-end.** `ChatComposer` has the paperclip +
  file-queue UI ([ChatComposer.tsx](src/features/chat/ChatComposer.tsx)), uploads
  go through `uploads.ts` → core-api `/uploads/*`
  ([UploadEndpoints.cs](core-api/src/CoreApi/Endpoints/UploadEndpoints.cs)) → MinIO
  presigned URLs, attachments are encoded into the message content via
  `composeMessageWithAttachments` / `parseMessageAttachments`
  ([attachmentPayload.ts](src/features/chat/attachmentPayload.ts)) and rendered by
  `MessageBubble` through `useAttachmentResolver`. Working.
- ✅ **DM message editing — DONE** (`allowEditOwn` true).
- ✅ **Server voice controls — DONE** (`patchVoiceState` wired in
  [useVoiceControlActions.ts](src/features/voice/hooks/useVoiceControlActions.ts)).

**Remaining, and that's the whole list:**

| # | Task | User-visible? | Effort | Value for a friend group |
|---|---|---|---|---|
| 1 | Pinned messages | ✅ greyed button | ~1–2 days | High — genuinely useful daily |
| 2 | Message search | ✅ greyed button | ~0.5 day (MVP) / ~1 day (server) | Medium–High |
| 3 | Remove dead legacy call-controls hook | ❌ code only | ~1–2 h | Low (tidiness) |

---

## Task 1 — Pinned messages

**Why:** the pin button at [TextChannelView.tsx:91-93](src/features/channels/TextChannelView.tsx#L91-L93)
is rendered `disabled`. Pinning is a real, wanted feature for a group (pin the
server rules, the game night poll, the important link).

**Backend (`server/`):**
1. Add a `PinnedMessage` table to [schema.rs](server/src/schema.rs). Fields:
   `pin_id: u64` (auto-inc PK), `channel_id: u64`, `message_id: u64`,
   `pinned_by: Identity`, `pinned_at: Timestamp`. **Additive** → no destructive
   migration (safe with `bun run spacetime:publish`).
2. Add reducers in [reducers/messages.rs](server/src/reducers/messages.rs) (or a new
   `pins.rs`): `pin_message(channel_id, message_id)` and
   `unpin_message(channel_id, message_id)`.
   - **Permission decision:** gate to channel moderators / server owner (reuse the
     existing `canModerate` / moderator logic), OR allow any channel member for a
     casual group. **Recommend: moderators-only** (matches Discord, avoids pin spam).
   - Validate the message exists and belongs to the channel; cap pins per channel
     (e.g. 50) to bound the table.
3. **Table visibility:** per the security lockdown (all sensitive tables are private
   with scoped `my_*` views), expose `PinnedMessage` only for channels the caller
   can see — mirror how `Message` visibility is scoped. Don't make it public.
4. `bun run spacetime:generate` to regenerate TS bindings.

**Client (`src/`):**
5. Subscribe to the pins view; add a small `pinsStore` (or fold into an existing
   channel store) keyed by `channel_id`.
6. Wire the pin button in [TextChannelView.tsx:91-93](src/features/channels/TextChannelView.tsx#L91-L93):
   remove `disabled`, on click open a **pins panel/popover** listing the channel's
   pinned messages (jump-to-message on click).
7. Add "Pin / Unpin message" to the message hover/context menu in
   [MessageBubble.tsx](src/features/channels/MessageBubble.tsx) (moderators only,
   matching the reducer gate).

**Done when:** a moderator can pin/unpin; the pin button opens a working list;
pins persist across restart; a non-moderator sees no pin action (if gated).

---

## Task 2 — Message search

**Why:** the search button at [TextChannelView.tsx:88-90](src/features/channels/TextChannelView.tsx#L88-L90)
is rendered `disabled`.

**Scope decision (pick one):**

- **2A — Client-side MVP (recommended first).** Filter messages already loaded in
  the store for the current channel by substring; render a results list with
  jump-to-message. **No schema, no reducer.** ~0.5 day.
  - Honest limit: only searches messages currently subscribed/loaded. Today, with
    no storage-tiering, that's effectively the full channel history for a small
    group — so for the friend-group case this covers ~everything. Upgrade later if
    tiering ever lands.
- **2B — Server-side search.** A `search_channel_messages(channel_id, query)`
  reducer doing a `contains`/`LIKE` scan over `Message` for that channel, returning
  matches. SpacetimeDB has no full-text index, so it's a linear scan — fine at
  friend-group scale. ~1 day. Choose this only if 2A's "loaded messages" limit
  actually bites.

**Client (both):** remove `disabled`, open a search input (popover or right panel),
show results with channel/author/timestamp, click to jump.

**Done when:** typing a term shows matching messages in the channel and clicking a
result scrolls to it.

---

## Task 3 — Remove dead legacy call-controls hook

**Why:** [useLegacyCallControls.ts](src/features/voice/hooks/useLegacyCallControls.ts)
returns `!activeCallDockVisible`; the modern dock is the real UI. The legacy
branches likely never render.

**Steps:**
1. **Verify first:** check whether `activeCallDockVisible` is ever `false` in
   `uiStore` (default + any setter). If it's always `true`, the legacy branch is
   dead.
2. If confirmed dead, delete: the hook file, its imports/usages in
   [VoiceChannelView.tsx:125,359](src/features/voice/VoiceChannelView.tsx#L125) and
   [DmVoicePanel.tsx:63,251](src/features/dm/DmVoicePanel.tsx#L63), and the now-dead
   legacy JSX branches. Keep only the modern dock path.
3. `bun run lint` + `bun run build` to confirm nothing else referenced it.

**Done when:** no `useLegacyCallControlsVisible` references remain; voice UI
unchanged at runtime.

---

## Fallback for any task we choose NOT to do

If you decide a feature isn't worth building, **don't leave the greyed button** —
remove it (or add a "Coming soon" tooltip). A missing button reads as finished; a
permanently-disabled one reads as broken.

## Suggested order

1. **Task 3** first (quick, tidies the code, ~1–2 h warm-up).
2. **Task 2A** (fast visible win — a working search button).
3. **Task 1** (the real feature; most value, most work).

## Verification per task

- `bun run lint`, `bun run build`
- `bun run test` (Vitest) where logic is added
- Manual: run `bun run tauri dev` against local services and click through the
  feature.

# Half-implemented feature cleanup — completion record

> **Status (reviewed 2026-09-16): complete.** The remaining user-visible work
> shipped in PR #56; this is no longer a task list.

## Completed features

- Attachments upload through `core-api` and MinIO, are encoded in message
  payloads, and render in channel and DM feeds.
- Direct messages support editing.
- Server voice controls use the shared live call-control actions.
- Moderators can pin and unpin messages; pins use a scoped SpacetimeDB view and
  a channel popover.
- Channel search filters the currently loaded message window and can jump to a
  result.
- The dead legacy call-controls hook and its duplicate UI path were removed.

## Current implementation map

- [`ChatComposer.tsx`](../../src/features/chat/ChatComposer.tsx) and
  [`attachmentPayload.ts`](../../src/features/chat/attachmentPayload.ts)
- [`UploadEndpoints.cs`](../../core-api/src/CoreApi/Endpoints/UploadEndpoints.cs)
- [`pins.rs`](../../server/src/reducers/pins.rs),
  [`ChannelPinsPopover.tsx`](../../src/features/channels/ChannelPinsPopover.tsx)
- [`ChannelMessageSearch.tsx`](../../src/features/channels/ChannelMessageSearch.tsx)
- [`useVoiceControlActions.ts`](../../src/features/voice/hooks/useVoiceControlActions.ts)

This completion record does not define the current bug backlog. Use
[`BUG_ANALYSIS.md`](../../BUG_ANALYSIS.md) for open findings and
[`CODEBASE.md`](../../CODEBASE.md) for the current architecture.

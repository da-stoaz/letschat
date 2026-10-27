# Remaining work

|index| Area | Actual state / next work |
|-|---|---|
|1| Search | Searches **loaded channel messages only**, capped at 50 results. Full-history, cross-space, and DM search remain missing. [Code](../src/features/channels/ChannelMessageSearch.tsx#L21) |
|2| Transfers | Multipart uploads exist. Cross-restart continuation and resumable downloads remain unfinished; browser downloads buffer the whole file in memory. [Code](../src/lib/attachmentDownload.ts#L58) |
|3| Storage acceptance | Plans still leave deployed Cloudflare transfers, production credentials, and packaged-client interruption checks unchecked. Confirm whether these were performed and record the evidence. [Checklist](../.claude/plans/object-storage.md#L281) |
|4| Audio volume | Implemented on `feat/call-volume-controls`: saved master volume and separate per-person voice/stream levels (0–200%), with deafen preserving the mix. Verified in Chrome over UDP/TCP, including reconnects and DM playback. Pending merge and headset testing with the group. [Controls](../src/features/voice/components/CallVolumeMixer.tsx) |
|5| Desktop updates | No Tauri updater integration is present. Updates remain manual. [Dependencies](../src-tauri/Cargo.toml#L8) |
|6|Planned features | Custom roles, per-space storage quotas, group DMs, E2EE, offline cache, and simultaneous multi-instance use remain future work. |
|7| Storage tiering | Archive/rebuild exists; eviction and cold-history serving do not. **Keep this deferred until memory/latency measurements justify it.** [Plan](../.claude/plans/2-storage-tiering.md#L26) |

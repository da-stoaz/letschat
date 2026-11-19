# Plan: App sounds

> **Status (2026-11-19): proposed, not started.** Today the app has a single
> sound: the incoming DM call ring, a synthesized oscillator beep in
> `src/features/dm/hooks/useIncomingDmRing.ts`. Revalidate the hook points below
> against the code before implementing.

## Goal

Short, quiet sounds that confirm what just happened without looking at the
screen:

- **Voice:** joining or leaving a call, yourself or someone else.
- **Your controls:** mute, deafen, camera and screen share.
- **Calls:** incoming and outgoing calls ringing.
- **Notifications:** new notifications.

Every sound can be turned off, and all of them share one volume control.

## Cues

Every cue has its own file. The on/off pairs use distinct sounds, so you can
tell which way a toggle went without looking.

| Cue | Plays when | Hook point |
|---|---|---|
| `join` | You finish joining a voice channel or DM call. | End of a successful `startCall` in `src/lib/livekit.ts` (channel and DM share it). |
| `join` | Someone else joins the call you are in. | Diff of the joined room's participant rows (`voiceStore.participantsByChannel`, `dmVoiceStore.participantsByRoom`). |
| `leave` | You leave or are disconnected. | `endCall` in `src/lib/livekit.ts`; check whether an unexpected disconnect reaches it. |
| `leave` | Someone else leaves the call you are in. | Same participant diff, after a grace period (see Pitfalls). |
| `mute` / `unmute` | You toggle your microphone. | `onToggleMute` in `useVoiceControlActions.ts`, after it succeeds. |
| `deafen` / `undeafen` | You toggle deafen. | `onToggleDeafen`, after it succeeds. |
| `camera-on` / `camera-off` | You toggle your camera. | `onToggleCamera`, after it succeeds. |
| `share-start` / `share-stop` | Your screen share starts or stops, including the OS "Stop sharing" button. | LiveKit local track published or unpublished with source `screen_share`. |
| `ringback` (loop) | Your outgoing DM call shows "Calling…". | `joined && isDm && !dm.answered` in `useActiveCall.ts`. Stops when answered or ended. |
| `ring` (loop) | Someone calls you. | Replaces `startRingtoneLoop` in `useIncomingDmRing.ts`, which keeps its current rules. |
| `notification` | `notify()` decides to show a notification. | Inside `notify()` in `src/lib/notifications.ts`, after the dedupe and rate-limit checks and before `showNotification`. |

All mute, deafen, camera and screen-share buttons already go through
`useVoiceControlActions`, from both `useActiveCall` and `ActiveCallCard`, so
each control cue has exactly one trigger.

Out of scope: sounds for other people's mute, camera or screen share; separate
sounds for mentions or DMs; custom user sounds.

## Decisions

| Topic | Decision |
|---|---|
| Source | Short audio files under `src/assets/sounds/`, imported through Vite (hashed URLs, used by the desktop and web clients). |
| Format | Mono WAV, under ~1 s per cue, with seamless loops for `ring` and `ringback`. WAV decodes everywhere the app runs; Ogg is not reliable in WebKit. Total under 1 MB. |
| Origin | Original sounds made for LetsChat, or CC0. Record each file's origin and license in a notices file, like `public/audio-filter-notices.txt`. Never copy another app's sounds (for example Discord's). |
| Player | One small module, `src/lib/sounds.ts`, exposing `playSound(cue)` and `loopSound(cue) → stop()`. It keeps one preloaded `HTMLAudioElement` per cue. Rejected `play()` promises (autoplay before the first user gesture, mainly in the web client) are ignored. |
| Output device | Play on the selected call output (`mediaDeviceStore.audioOutputId`) via `HTMLMediaElement.setSinkId` where it exists (WebView2 and Chromium browsers). WebKit has no `setSinkId`, but call audio also goes to the system default there, so the two stay together. |
| Settings | New persisted `soundSettings` in `uiStore`: `enabled`, `volume` (default 50%), and four groups: *People joining and leaving*, *Your mic, deafen, camera and screen share*, *Calls ringing*, *Notifications*. One toggle per cue would be too much. |
| Settings UI | A "Sounds" card in Settings → Audio (`AudioTab.tsx`), with a preview button per group. |
| Notifications | The notification sound follows `notify()`'s existing rules: master switch, per-event toggles, quiet hours, the focused active view, dedupe and rate limit. It plays even when the OS notification permission is denied. |
| Quiet hours | Silence the notification sound and the incoming `ring` (the toast still appears). Call cues still play, because during a call you are present. This is a behavior change for the ring, which ignores quiet hours today. |
| Deafen | While deafened, play only your own control cues (including `undeafen`). Everything else is silent. |

## Pitfalls

1. **Presence flaps.** Voice presence rows are connection-scoped. A remote
   user's network blip deletes their row and recreates it, so a naive diff
   would play `leave` then `join`. Delay `leave` by ~2 s, and skip both cues
   if the same identity is back within that time.
2. **Snapshots are not events.** When you join a call or your subscription
   resyncs, the participant list arrives all at once. Diff only against a
   previous snapshot of the same room, never against an empty one.
3. **Device switching toggles the mic.** Switching the input device runs
   `setMicrophoneEnabled(false/true)` (in `ActiveCallCard` and `CallOptions`).
   So mute cues come from the toggle action, never from LiveKit mute events.
4. **Hanging up while sharing** unpublishes the screen track. Do not play
   `share-stop` on top of `leave`: skip it once the call is ending.
5. **StrictMode.** Trigger cues from actions and from one module-level store
   subscription that is started once (idempotent start and stop), never from an
   effect body that runs again on remount.
6. **Two sounds per notification on Windows.** Windows toast notifications
   play the system sound by default. In `tauri-plugin-notification` 2.8 the
   desktop builder supports `sound(...)` but not `silent()` (that one is for
   mobile). Make sure each notification makes exactly one sound: either silence
   the toast, or skip the in-app sound when a toast was shown on Windows. Check
   macOS and Linux too.
7. **Linux codecs.** The `.deb` and AppImage play media through the host's
   GStreamer. Confirm that WAV plays in both packages.
8. **Persisted settings merge shallowly.** A cue group added later is missing
   from saved `soundSettings`, so read every group with its default
   (`?? true`).

## Phases

1. **Foundation.** Sound files with their notices, `src/lib/sounds.ts`,
   `soundSettings` with the Audio-tab card, and the `notification` cue.
2. **Call cues.** Your own controls (`mute`, `deafen`, camera) and your own
   `join`/`leave`; the participant diff with the leave grace period; screen
   share from LiveKit track events.
3. **Ringing.** `ring` moves onto the sound module (the oscillator code is
   deleted), and `ringback` is new.

## Verification

- Unit tests (Vitest, `tests/ui` or next to the module) for the pure parts:
  - the participant diff, covering snapshot, join, leave, and a flap within
    the grace period;
  - the cue rules, covering settings, deafen and quiet hours.
- On the running dev stack, with two accounts:
  - join, leave and flap (kill one client's network briefly);
  - each control;
  - an outgoing and an incoming DM call;
  - notifications with the app focused on another view, in the active view,
    and in the background.
- Desktop builds: macOS, Windows (the double-sound check), and Linux `.deb`
  and AppImage, plus the web client in Chromium and Safari.
- Output device: on Windows, pick a non-default output and confirm cues play
  there.

## Effort

About 2 weeks, including making or sourcing the sounds.

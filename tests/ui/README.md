# Responsive UI verification

Run `bun run dev`, then open `/tests/ui/responsive.html` on the local Vite server.
The fixture uses the actual layout and messaging components with in-memory storage
and seeded data. It never initializes a backend connection. The width matrix checks
320, 390, 430, 768, 844, 1024, and 1440px across eight routes for page overflow and
composer clipping. These checks do not substitute for visual review.

Check manually in the fixture:

- On phone widths, verify Spaces/Messages and list actions stay at the bottom
  while the list scrolls, and the navigation menu opens upward.
- Open Spaces → Channels → Conversation and return with Back.
- Type a draft, return to the list, and reopen it. Change widths while typing.
- Open Message actions → Edit message. The first Save deliberately fails; the
  editor must retain its text. The next Save succeeds and closes the editor.
- Open Members, Search messages, and Pinned messages from Channel actions.
- Select files with Attach, navigate away, and return; the selected files remain.
- Scroll to older messages, return to the list, and reopen the same conversation.
- Resize a desktop conversation with Members open; narrower widths use a sheet.

Use a real development instance for sending attachments, DM sends, calls, sign-in,
invite links, and reconnects. The fixture only simulates text-channel sending and
editing. It is excluded from the production build.

Before calling the mobile milestone complete, review on a physical iPhone in Safari
against an HTTPS instance: portrait and landscape, keyboard opening/closing,
multiline input and IME, text zoom, image/PDF/video previews, upload retries, normal
browser Back/Forward and refresh/deep links, plus reduced motion. Separately verify
existing calls and pane resizing in the Tauri app.

Open `/tests/ui/chat-history.html` for the conversation reconciliation regression
check. It switches between populated and empty channels, then repeatedly rerenders
a DM. Every step must report PASS with exactly one message feed and no duplicate
message IDs. It uses the real channel/DM views with isolated in-memory storage.

Open `/tests/ui/noise-filter.html` and click **Run audio verification**. This uses
real RNNoise WASM, a real LiveKit local audio track and two local WebRTC peers.
Add `?deepfilter` to measure DeepFilterNet3 instead. Each run also switches to the
other model and back, verifying the WebRTC sender uses the selected processor.
It generates fan-like noise at 44.1 kHz, measures it at the remote receiver with
the filter off/on, and requires at least 10 dB reduction plus a working bypass.
Add `?broadband` to repeat with broadband noise (at least 3 dB / half the noise
energy). Add `?local` to measure the processor directly without WebRTC/ICE. It uses no microphone, backend,
Cloud service, or audible playback. Headless Chromium may need
`--disable-features=WebRtcHideLocalIpsWithMdns` for the two local peers to resolve
each other's ICE candidates. After PASS, use both noise buttons to check the
popover, toggle, active style, Escape/focus return and narrow-screen positioning.
The Audio settings card uses the same persisted controls; confirm model changes
are reflected in both places and switching off hides the filter selection.
A synthetic signal check does not replace a headset/speech quality test.

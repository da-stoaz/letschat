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

Run `bunx vite --config tests/ui/call-reload.vite.ts` and open
`http://127.0.0.1:5174/tests/ui/call-reload.html`. Its dedicated Vite config
replaces LiveKit with a transport fake, leaving the normal app server unchanged.
Click **Reload this fixture**, and expect PASS
with one restored muted call. Repeat the reload, then click **Hang up and reload**
and expect PASS with no restored call. This exercises the real call controller,
lifecycle hook, unload events and tab session storage with simulated transport;
it opens no microphone and sends no backend requests.

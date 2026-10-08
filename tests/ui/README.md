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

# Coding Rules

- There is no such thing as backwards compatibility of a user-facing graphical
  interface. Backwards compatibility can only ever apply to **data, API
  endpoints, and SpacetimeDB reducers** — never to `.tsx` component names, file
  names, or UI structure. Rename components and files freely.
- Never edit `src/generated/` by hand; regenerate it from `server/` with
  `bun run spacetime:generate`.
- Treat the client as untrusted. UI checks do not replace authorization in a
  `core-api` endpoint or SpacetimeDB reducer. See [`SECURITY.md`](SECURITY.md).
- Use additive SpacetimeDB schema changes unless a tested archive rebuild is
  part of the migration. Never bypass a destructive publish prompt casually.

## Frontend UI

- Hide or collapse fields that are inactive because their controlling toggle
  is off.
- Do not repeat an adjacent control's state in a badge. If a button already
  says “Joining…”, a nearby “Joining…” badge is noise; reserve badges for state
  the control cannot express, such as “In call” for a call the viewer has not
  joined.
- Put actions about one person on that person: right-click (long-press on
  touch) them wherever they appear. Don't make users hunt for them in a list of
  everyone, e.g. per-person call volume lives in their context menu, not in a
  mixer listing every participant.
- No filler descriptions. Only add helper text when it tells the user something
  the title, label or control doesn't: a consequence ("Your other devices will
  be signed out"), why something is disabled, or an error/loading state. Text
  that restates the heading or what a switch obviously does gets cut.
- Tell "not right now" apart from "can't here". A control that will work in a
  moment (call still connecting) uses plain `disabled` and fades. A control
  this device or runtime can never use (no camera, no screen-capture API) uses
  `UnavailableButton`: dashed outline, the crossed-out icon, text that names
  the state ("No camera"), and the reason in a tooltip and to screen readers.
  Never leave such a control clickable only to fail.

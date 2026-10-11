# Claude Code & Agents guidance

Use the repository's canonical documents instead of copying their content into
this file:

- [`README.md`](README.md) — local setup and common commands
- [`CODEBASE.md`](CODEBASE.md) — current architecture, request flows, repository
  map, trust boundaries, security invariants, and verification matrix
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — production configuration and operations
- [`BUG_ANALYSIS.md`](Findings/BUG_ANALYSIS.md) — open findings and remediation status
- [`core-api/README.md`](core-api/README.md) — control-plane development

Apply the document relevant to the code being changed. In particular:

- `core-api` is the sole identity and control-plane backend. The removed Rust
  `auth-service` is relevant only to the retained legacy import tool.
- Never edit `src/generated/` manually; change the SpacetimeDB module and run
  `bun run spacetime:generate`.
- Preserve compatibility for persisted data, HTTP APIs, and SpacetimeDB
  reducers. UI component and file names are not compatibility boundaries.
- Treat client checks as UX only. Authorization belongs in `core-api` or a
  SpacetimeDB reducer.
- Do not bypass a destructive SpacetimeDB publish prompt. Prefer additive
  schema changes unless a tested archive rebuild is explicitly part of the
  migration.

Plans under `.claude/plans/` are proposals, not descriptions of current
behavior. Check each plan's status and revalidate it against the current code
before implementing it.

# Coding Rules

- There is no such thing as backwards compatibility of a user-facing graphical
  interface. Backwards compatibility can only ever apply to **data, API
  endpoints, and SpacetimeDB reducers** — never to `.tsx` component names, file
  names, or UI structure. Rename components and files freely.
- Never edit `src/generated/` by hand; regenerate it from `server/` with
  `bun run spacetime:generate`.
- Treat the client as untrusted. UI checks do not replace authorization in a
  `core-api` endpoint or SpacetimeDB reducer. See [`CODEBASE.md`](CODEBASE.md#trust-boundaries).
- Use additive SpacetimeDB schema changes unless a tested archive rebuild is
  part of the migration. Never bypass a destructive publish prompt casually.

## Frontend UI

- Hide or collapse fields that are inactive because their controlling toggle
  is off.
- Do not repeat an adjacent control's state in a badge. If a button already
  says “Joining…”, a nearby “Joining…” badge is noise; reserve badges for state
  the control cannot express, such as “In call” for a call the viewer has not
  joined.

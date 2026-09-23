# Claude Code guidance

Use the repository's canonical documents instead of copying their content into
this file:

- [`README.md`](README.md) — local setup and common commands
- [`CODEBASE.md`](CODEBASE.md) — current architecture, request flows, repository
  map, and verification matrix
- [`SECURITY.md`](SECURITY.md) — trust boundaries and security invariants
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — production configuration and operations
- [`CODING_RULES.md`](CODING_RULES.md) — implementation and UI rules
- [`BUG_ANALYSIS.md`](BUG_ANALYSIS.md) — open findings and remediation status
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

# LetsChat

LetsChat is a self-hosted desktop and web chat application. Identity and
control-plane HTTP APIs run in ASP.NET Core, chat state lives in SpacetimeDB,
LiveKit carries voice/video, and MinIO stores attachments.

## Architecture

| Component | Responsibility |
|---|---|
| `src/` | React 19 + TypeScript client |
| `src-tauri/` | Tauri 2 desktop shell |
| `core-api/` | ASP.NET Core Identity, OIDC, sessions, admin UI, LiveKit tokens, uploads |
| `server/` | SpacetimeDB Rust module: chat schema, authorization, and reducers |
| `archive-worker/` | Exports archived chat data from SpacetimeDB |
| `site/` | Static Astro marketing and self-hosting site |

The client discovers service URLs through `/.well-known/letschat.json`; the
production backend is `core-api`. The removed Rust `auth-service` is only
relevant to historical migrations.

For data ownership, request flows, and trust boundaries, see
[`CODEBASE.md`](CODEBASE.md) and [`SECURITY.md`](SECURITY.md).

## Local development

Prerequisites: Bun, Rust, the .NET 10 SDK, Docker, and the Tauri platform
dependencies.

```bash
bun install
bun run services:up
bun run spacetime:publish
bun run core-api:dev
```

In a second terminal:

```bash
bun run tauri dev
```

Useful service commands:

```bash
bun run services:logs
bun run services:down
bun run services:reset   # destructive: removes local service data
```

## Verification

```bash
bun run build
bun run lint
bun run test:unit
bun run core-api:test
cargo test --manifest-path server/Cargo.toml
```

`bun run test:security` runs the integration security suite and requires its
documented local stack.

## Production and documentation

Production uses `docker-compose.prod.base.yml` with either the tunnel or Caddy
overlay. Follow [`DEPLOYMENT.md`](DEPLOYMENT.md); do not expose internal service
ports directly.

| Document | Purpose |
|---|---|
| [`CODEBASE.md`](CODEBASE.md) | Current architecture and repository map |
| [`SECURITY.md`](SECURITY.md) | Security model, invariants, and review workflow |
| [`BUG_ANALYSIS.md`](BUG_ANALYSIS.md) | Finding register and remediation status |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Production deployment and operations |
| [`core-api/README.md`](core-api/README.md) | Control-plane API development and configuration |
| [`CLAUDE.md`](CLAUDE.md) | Repository-specific implementation guidance |

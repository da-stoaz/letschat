# Feature Plan: Admin Control Panel & Identity System — LetsChat

## Context

The backend services are being built in **.NET Core** (see `[[project-backend-language]]` in memory). This plan covers two coupled pieces of work:

1. **Rebuild the auth-service in .NET** (renamed **`core-api`**) on **ASP.NET Core Identity** + PostgreSQL. This is the foundation — `2-storage-tiering.md` depends on it for the `/archive/*` endpoints.
2. **Add a server-administrator control panel** and harden user registration: admin approval of users, admin-created users, system configuration, **email verification**, and **signup rate limiting**.

ASP.NET Core Identity is a first-party membership framework (users, roles, claims, lockout, email-confirmation tokens, password management) — most of part (2) is configuration on top of it, not code from scratch. This plan is independent of the E2EE plan.

## Sequencing

This is **plan 1 of 4** — implemented in full before the next. Roadmap: `1-control-panel.md` → `2-storage-tiering.md` → `3-e2ee.md` → `4-efficiency-cache.md` (optional). Nothing here depends on the later plans; they all depend on this one — it builds the `core-api` service and stands up PostgreSQL.

---

## Decisions

| Topic | Decision |
|---|---|
| Backend | .NET Core / ASP.NET Core |
| Identity framework | ASP.NET Core Identity |
| Database | PostgreSQL — the `auth` database (shared instance with the cold archive; see `2-storage-tiering.md`) |
| Email delivery | SMTP by default (self-hosted friendly); pluggable to a provider (SendGrid / Azure Communication Services) via config |
| Rate limiting | ASP.NET Core built-in rate-limiting middleware |
| Admin UI | `core-api`-served ASP.NET Core **Razor Pages**, browser-accessed (not the desktop app); **Tailwind CSS**, responsive; on a non-public listener |
| System admin role | Identity role `Admin` — distinct from per-server chat roles (`Member`/`Moderator`/`Owner` in SpacetimeDB) |
| First admin | Bootstrapped via configuration/seed at deploy time |

---

## User lifecycle

**Self-registered ("default") user:**
`Registered` → confirms email → `EmailVerified` → admin approves → `Active`.
A user can sign in only when `Active`; otherwise sign-in is blocked with a clear reason (unverified / awaiting approval).

**Admin-created user:** the admin creates the account and either sets it `Active` directly or sends an invite / set-password email. Admin-created users skip the approval queue — the admin is the approval.

**Rejected / disabled:** the admin can reject a pending user or disable an `Active` one (`Disabled`) — sign-in blocked, sessions revoked.

Whether admin approval is required at all is a **system-config flag** — a server can run open registration (email-verified is enough) or gated (admin approval required).

---

## Phase 1 — .NET rebuild on ASP.NET Core Identity

- New ASP.NET Core solution for the service. ASP.NET Core Identity backed by the PostgreSQL `auth` database (`Microsoft.AspNetCore.Identity.EntityFrameworkCore` + Npgsql).
- **Re-implement all current integration points** in .NET:
  - JWT issuance + refresh tokens
  - LiveKit access-token generation
  - MinIO presigned-URL generation
- **Account ↔ SpacetimeDB Identity binding — highest-risk item.** The chat domain authenticates connections to SpacetimeDB by `Identity`. The current binding (spanning the auth-service store and the SpacetimeDB `AuthCredential` table) must be **audited and preserved**: each Identity-framework user maps to exactly one SpacetimeDB `Identity`. Specify this precisely before writing code.
- **Data migration**: existing users/credentials → ASP.NET Core Identity's schema (`AspNetUsers`, `AspNetRoles`, …) in the `auth` database. One-time, scripted. The current custom `auth-framework` model is retired.
- Adopting Identity means adopting its schema and conventions — a deliberate, accepted tradeoff.

## Phase 2 — Registration hardening

**Email verification:**
- ASP.NET Core Identity email-confirmation tokens.
- An email-sender abstraction; SMTP implementation by default, provider implementation optional (config-selected).
- Flow: register → confirmation email with a tokenized link → link hits a `core-api` endpoint → token validated → `EmailVerified`. Links expire; a (rate-limited) resend endpoint is provided.

**Rate limiting:**
- ASP.NET Core rate-limiting middleware, per-IP, on: registration, login (brute-force defense), resend-confirmation, password-reset.
- Strategy: sliding window or token bucket; parameters are part of system config.
- Out of scope (notable, not built): CAPTCHA — add later only if rate limiting proves insufficient.

## Phase 3 — Approval workflow

- A pending-approval queue: users in `EmailVerified` awaiting an admin decision.
- Admin actions: approve (`→ Active`) or reject.
- The approval-required behavior is governed by the system-config flag.

## Phase 4 — Admin control panel

A browser-accessed admin area served by `core-api` itself — an ASP.NET Core **Razor Pages** area, **not** part of the Tauri desktop app. Gated by authentication + the `Admin` role; its *reachability* is restricted at the deployment layer (see *Exposure* below).

- **User management**: list/search users and status; approve/reject pending; create users; enable/disable; trigger password reset; grant/revoke `Admin`.
- **System configuration**: registration open/closed; approval-required toggle; rate-limit parameters; email/SMTP settings. Stored in a config table in the `auth` database; changes audited.
- **Audit log**: admin actions (approvals, user creation, config changes) recorded and viewable.

### Look & feel

Responsive and modern is a **hard requirement**. Razor Pages only controls the markup — the look is pure CSS, independent of the page model:

- Styled with **Tailwind CSS** — the same framework and version (Tailwind 4) the chat app already uses, for visual consistency and a toolchain the team knows. The Tailwind CLI runs as a `core-api` build step, generating the stylesheet from the `.cshtml` markup.
- Responsive via Tailwind's responsive utilities — usable from desktop down to smaller screens.
- For snappy interactions without page-reload jank (inline approve/reject, modal dialogs), use lightweight progressive enhancement — **htmx** or Alpine.js — not a full SPA framework.

### Exposure — keeping the admin area off the public surface

Authorization (auth + `Admin` role) is the real protection — every `/admin` request from a non-admin gets 401/403, and security never depends on the URL being secret. But the panel should also not be *reachable* from the open internet, as defense-in-depth:

- `core-api` binds the admin area on a **separate Kestrel listener/port** that the public reverse proxy (Caddy / Cloudflare Tunnel) does **not** expose. The administrator reaches it over the LAN, a VPN, or an SSH tunnel.
- If it must be internet-reachable, instead put an **IP allowlist or Cloudflare Access policy** on the `/admin` path at the proxy.
- Either way, the public endpoints advertised via `/.well-known/letschat.json` never include the admin area.

*(Rejected: `/admin` inside the Tauri app — admin code would ship in every user's binary and need a desktop release to change. Rejected: a separate standalone web app — an extra frontend project to build and host, when `core-api` can serve the area directly.)*

---

## New / modified components

| Path | Change |
|---|---|
| `auth-service/` → `core-api/` | Rebuilt as a .NET / ASP.NET Core solution on ASP.NET Core Identity; directory renamed |
| PostgreSQL `auth` database | Identity schema + a system-config table + an audit-log table |
| `core-api` admin area | New ASP.NET Core Razor Pages area (Tailwind CSS) + admin-only endpoints; bound to a non-public Kestrel listener |
| `docker-compose*.yml` / proxy config | `core-api` image → .NET; SMTP / email config; reverse-proxy rule keeping the admin listener off the public surface |
| SpacetimeDB module | Unchanged — but the account↔Identity binding must be preserved |

---

## Verification Checklist

1. Existing users migrate and can still sign in; JWT, refresh, LiveKit tokens, and presigned URLs all still work.
2. Each user maps to exactly one SpacetimeDB `Identity`; chat connections authenticate as before.
3. A self-registered user cannot sign in until email-verified and (if required) approved.
4. Admin-created users can be set `Active` directly.
5. Registration/login endpoints reject traffic over the rate limit.
6. The email confirmation link verifies the account; expired links are rejected; resend works.
7. Admin can approve/reject/create/disable users and change config; non-admins get 401/403; the admin area is not reachable from the public API surface.
8. Admin actions appear in the audit log.
9. The admin panel is responsive and cleanly styled (Tailwind), usable from desktop down to smaller screens.

---

## Effort

~5.5–7 weeks (one developer): .NET rebuild on Identity + data migration ~2–3 weeks · email + rate limiting ~1 week · approval workflow ~1 week · control panel UI + endpoints ~1.5–2 weeks.

---

## Relationship to other plans

- **This is plan 1 of 4** — implemented in full before the next.
- **Foundation for `2-storage-tiering.md`** — that plan's `/archive/*` endpoints are added to this `core-api` service, and it reuses the PostgreSQL instance stood up here.
- **Independent of `3-e2ee.md`** — no cryptographic dependency either way.
- **Roadmap:** `1-control-panel.md` (this) → `2-storage-tiering.md` → `3-e2ee.md` → `4-efficiency-cache.md` (optional, last).

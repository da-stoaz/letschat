# Settings and account rework — completion record

> **Status (reviewed 2026-09-16): implemented in PR #64.** This file records the
> completed outcome; it is not an active implementation plan.

## Outcome

The former mixed Identity/Security settings screen is split into four focused
tabs:

- **Account** — username, email, membership date, display name, and avatar
- **Security** — password change and sign-out
- **Connection** — discovered backend endpoints, SpacetimeDB identity, known
  host checks, and join-link copy
- **Notifications** — event preferences, previews, quiet hours, permission, and
  test notification

`POST /auth/account` is the authenticated source for account metadata that does
not belong in SpacetimeDB. It resolves the full application account from the
stored session, so callers cannot request another user's email.

## Implementation map

- [`AuthEndpoints.cs`](../../core-api/src/CoreApi/Endpoints/AuthEndpoints.cs) —
  `/auth/account`
- [`Contracts.cs`](../../core-api/src/CoreApi/Models/Contracts.cs) — account
  request/response contracts
- [`AccountTests.cs`](../../core-api/tests/CoreApi.Tests/IntegrationTests/AccountTests.cs)
  — authorized and invalid-session coverage
- [`authService.ts`](../../src/lib/authService.ts) — typed client function
- [`SettingsPanel.tsx`](../../src/features/settings/SettingsPanel.tsx) — tab shell
- [`AccountTab.tsx`](../../src/features/settings/AccountTab.tsx)
- [`SecurityTab.tsx`](../../src/features/settings/SecurityTab.tsx)
- [`ConnectionTab.tsx`](../../src/features/settings/ConnectionTab.tsx)
- [`NotificationsTab.tsx`](../../src/features/settings/NotificationsTab.tsx)

Current security and account-session guarantees are documented in
[`SECURITY.md`](../../SECURITY.md), not in this historical record.

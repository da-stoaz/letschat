# Plan: Rebuild the Settings page into a real Account/Settings surface

## Context

The Settings page ([src/features/settings/SettingsPanel.tsx](src/features/settings/SettingsPanel.tsx),
~725 lines) is structurally incoherent. Three tabs — **Identity / Security /
Notifications** — but "Security" is a junk drawer holding four unrelated things:

- **Identity Binding** — dumps the raw SpacetimeDB identity hash on the user (dev debug info)
- **Backend** — SpacetimeDB/Auth/LiveKit/Database URLs (this is *connection* info, not security)
- **Password Login** — the "random password thing." Worded as "Links this identity to
  username/password sign in" — a relic of the old passwordless-identity era. It calls
  [`/auth/link`](core-api/src/CoreApi/Endpoints/AuthEndpoints.cs#L131-L177), which just
  resets the password. Today everyone has email+password, so this is simply "Change password."
- **Session Actions** — Sign out, buried at the bottom.

Two more problems:
- **Email is invisible.** A user cannot see their own email. It's not in the SpacetimeDB
  `User` ([src/types/domain.ts:9](src/types/domain.ts#L9)) nor the session token
  ([TokenService.cs:73](core-api/src/CoreApi/Services/TokenService.cs#L73)) — it lives only
  in core-api's Identity store, with no endpoint to read it back.
- The **Identity tab is padded** — splits one job (edit profile) across a "Profile Preview"
  card and an "Edit Identity" card.

**Outcome:** a coherent four-tab surface — **Account / Security / Connection /
Notifications** — where the user can actually see and manage their identity (email,
username, display name, avatar), change their password in a sensible place, and inspect
the server connection on its own tab. Notifications is already fine and stays as-is.

## Decisions (confirmed with user)
- Add the backend endpoint so email is visible. ✓
- Connection info gets its own tab. ✓

---

## Part 1 — Backend: `POST /auth/account`

Email/username live only in core-api, so the client needs an authenticated read endpoint.

1. **Contract** — [core-api/src/CoreApi/Models/Contracts.cs](core-api/src/CoreApi/Models/Contracts.cs),
   next to `VerifyRequest`:
   ```csharp
   public sealed record AccountRequest(SessionToken SessionToken);
   public sealed record AccountResponse(
       string Username, string DisplayName, string Email,
       string Status, bool EmailConfirmed, string CreatedAt);
   ```

2. **Endpoint + handler** — [core-api/src/CoreApi/Endpoints/AuthEndpoints.cs](core-api/src/CoreApi/Endpoints/AuthEndpoints.cs):
   - Register `routes.MapPost("/auth/account", Account);` alongside `/auth/verify`.
   - `Account` handler: `tokens.ValidateAsync(request.SessionToken)` → username (401 if
     null, like [RefreshSpacetimeToken](core-api/src/CoreApi/Endpoints/AuthEndpoints.cs#L330-L341)),
     then `users.FindByNameAsync` → map to `AccountResponse`.
     `CreatedAt` = `user.CreatedAtUtc.ToString("o", CultureInfo.InvariantCulture)`.
   - Extract the existing status→string `switch` (currently inline in
     [`RegistrationStatus`](core-api/src/CoreApi/Endpoints/AuthEndpoints.cs#L436-L444)) into
     a private `StatusToString(AccountStatus)` helper and reuse it in both places (DRY).
   - Add `using System.Globalization;`.
   - Gated by the session token only — there is no path to read another account's email.

3. **Integration test** — new `core-api/tests/CoreApi.Tests/IntegrationTests/AccountTests.cs`
   (per memory: C# tests, not throwaway scripts). Two cases, using the existing
   `LetsChatWebApplicationFactory.PostJsonAsync` helper:
   - register → take `auth.sessionToken` → `POST /auth/account` returns the right
     username/displayName/**email**/status=active.
   - a bogus session token → **401**.

## Part 2 — Frontend client function

[src/lib/authService.ts](src/lib/authService.ts) — add alongside `authServiceVerify`:
```ts
export interface AccountDetails {
  username: string; displayName: string; email: string;
  status: string; emailConfirmed: boolean; createdAt: string;
}
export async function authServiceAccount(): Promise<AccountDetails | null>
```
Reads the stored token via existing `getStoredAuthSessionToken()`, POSTs `{ sessionToken }`
through the existing `postJson` helper, returns `null` if no token.

## Part 3 — Restructure the Settings UI

Rewrite [src/features/settings/SettingsPanel.tsx](src/features/settings/SettingsPanel.tsx)
into four tabs. Reuse all existing handlers/state — this is reorganization + the new
Account-data fetch, not new mechanics. To keep the file maintainable, split each tab body
into its own component under `src/features/settings/` (e.g. `AccountTab.tsx`,
`SecurityTab.tsx`, `ConnectionTab.tsx`, `NotificationsTab.tsx`), with `SettingsPanel.tsx`
owning only the header + `Tabs` shell.

- **Account tab** (was "Identity") — merge the two redundant cards into one. Editable
  avatar (keep existing upload flow: `handleAvatarFilePicked` → `uploadSingleFile`) +
  display name + Save (existing `reducers.updateProfile`). Read-only rows: **Username**,
  **Email**, **Status** badge, **Member since** — fetched via `authServiceAccount()` in a
  `useEffect` on mount (loading skeleton; if the fetch fails, show username/display name
  from `useSelfStore` and a muted "couldn't load email" line — never block the tab).

- **Security tab** — just two things:
  - **Change password** — the current "Password Login" card, reworded ("Change your
    password" / "Used to sign in with your username on another device"). Same
    `authServiceLink` call and validation. *(Known limitation, preserved: the underlying
    `/auth/link` does not verify the current password — it's gated by the live Spacetime
    session. Out of scope to change here; noted so it isn't a surprise.)*
  - **Sign out** — existing destructive card.

- **Connection tab** (new, pulls the "Backend" + "Identity Binding" cards out of Security) —
  read-only SpacetimeDB / Auth / LiveKit / Database rows (from `useServerConfigStore`),
  the identity hash row, and a **Copy join link** button reusing the existing
  [`buildJoinLink(config)`](src/stores/serverConfigStore.ts#L38) helper. No
  switch-server/destructive action in this pass.

- **Notifications tab** — moved verbatim, no behavior change.

Update the `TabsList` triggers/icons to `Account` (UserRoundIcon) / `Security`
(ShieldCheckIcon) / `Connection` (a plug/server icon, e.g. `ServerIcon`) / `Notifications`
(BellIcon). `SettingsPage.tsx` and the `/app/settings` route are unchanged.

## Verification

1. `dotnet build core-api/CoreApi.slnx` — compiles.
2. `dotnet test core-api/CoreApi.slnx --filter "FullyQualifiedName~AccountTests"` — both pass.
3. `bun run lint` — frontend clean.
4. Manual (`bun run tauri dev`, services + core-api running): open Settings →
   - **Account** shows real email + username + member-since; edit display name/avatar →
     Save → persists.
   - **Security** → change password succeeds; Sign out works.
   - **Connection** shows the backend URLs + identity; Copy join link copies a valid
     `letschat://join?…`.
   - **Notifications** unchanged.

## Files
- `core-api/src/CoreApi/Models/Contracts.cs` (edit)
- `core-api/src/CoreApi/Endpoints/AuthEndpoints.cs` (edit)
- `core-api/tests/CoreApi.Tests/IntegrationTests/AccountTests.cs` (new)
- `src/lib/authService.ts` (edit)
- `src/features/settings/SettingsPanel.tsx` (rewrite → shell)
- `src/features/settings/AccountTab.tsx`, `SecurityTab.tsx`, `ConnectionTab.tsx`, `NotificationsTab.tsx` (new)

# Plan: Project Rename (LetsChat → `<NEWNAME>`)

## Why now

"LetsChat" collides with a well-known unmaintained OSS project ("Let's Chat",
`sdelements/lets-chat`) and is generically un-searchable. The cheapest moment to
rename is **pre-1.0, before establishing a signed Windows publisher identity** —
SmartScreen/AV reputation accrues to a publisher+binary, so renaming *after*
signing throws that reputation away. Therefore: **rename before the SignPath
Foundation application** (see `0-windows-code-signing.md`).

Placeholder in this doc: `<NEWNAME>` (e.g. `Stoara`), `<newname>` (lowercase
slug), `net.stoaz.<newname>` (bundle id — keep the existing `net.stoaz.` org
prefix to minimise churn).

## Scope at a glance

~359 occurrences of `letschat`/`LetsChat` across the repo (excluding generated
bindings, `target/`, `dist/`, lockfiles). They fall into two buckets:

- **Bucket A — blind find/replace (the vast majority):** UI strings, log
  prefixes, comments, docs, `productName`, window title, README/site copy.
- **Bucket B — identity / protocol / data (careful, needs migration handling):**
  the items below. Per CLAUDE.md, backwards-compat applies to **data, API
  endpoints, and SpacetimeDB reducers** — these touch those.

---

## Bucket B — the careful touchpoints

### 1. Tauri app identifier — `net.stoaz.letschat`
- `src-tauri/tauri.conf.json:4` (`identifier`)
- `src-tauri/Info.plist:13` (`net.stoaz.letschat.deeplink`)
- Crate output names (`letschat_tauri`) derive from `productName`/crate name.

**Impact:** the identifier is the OS-level app identity. Changing it means an
installed "LetsChat" will not in-place-upgrade to `<NEWNAME>` — it's a new app.
**Cheap now (manual installs, pre-1.0); a migration later.** Keep `net.stoaz.`
prefix; change only the leaf → `net.stoaz.<newname>`.

### 2. Deep-link scheme — `letschat://`
- `src-tauri/tauri.conf.json:46` (`schemes`)
- `src-tauri/Info.plist` (`CFBundleURLSchemes`)
- `src-tauri/src/main.rs:207,216,236` (OS scheme registration + arg parsing)
- `src/stores/serverConfigStore.ts:37-52` (build + parse `letschat://join?…`)
- `src/hooks/useDeepLink.ts`, `src/pages/WebJoinPage.tsx`,
  `src/pages/setup/JoinLinkTab.tsx`, `src/features/settings/ConnectionTab.tsx`

**Impact:** invite/join links already shared in the wild use `letschat://…`.
Hard-renaming breaks them.
**Migration:** register **both** schemes during a transition window — new links
emit `<newname>://`, but the parser in `serverConfigStore.ts` and the OS
registration in `main.rs` continue to accept `letschat://` too. Drop the old
scheme in a later release.

### 3. Discovery endpoint — `/.well-known/letschat.json`
- Server: `core-api/src/CoreApi/Endpoints/MiscEndpoints.cs:19`
- Client: `src/lib/discovery.ts:25` (and error strings 27/34)
- Tests: `core-api/tests/.../DiscoveryTests.cs:35`
- Docs/infra: `DEPLOYMENT.md`, `README.md`, `CLAUDE.md`, `deploy/caddy/Caddyfile`,
  `.env.*.example`, `site/src/pages/self-hosting*`, `core-api/README.md`,
  `scripts/core-api-lan.ts`

**Impact:** this is an **API endpoint** (CLAUDE.md backwards-compat applies).
Deployed servers serve this path; older clients fetch it. A hard rename breaks
the older-client ↔ newer-server and newer-client ↔ older-server combinations.
**Migration:** core-api serves **both** `/.well-known/letschat.json` and
`/.well-known/<newname>.json` (same handler) for a transition window; the client
tries the new path, falls back to the old. Remove the alias once the fleet has
upgraded. Update Caddyfile/docs to mention both during transition.

### 4. DM system-message prefix — `__letschat_system__:` (DATA)
- `src/features/dm/systemMessages.ts:9` (writes the prefix)
- `src/lib/spacetimedb/events.ts:84` (reads/strips the prefix)

**Impact:** this string is **embedded in stored message rows** to mark system
messages. It is persisted data. Changing the literal means previously-stored
system messages are no longer recognised as system messages.
**Migration:** keep **reading** both `__letschat_system__:` and
`__<newname>_system__:`; only **write** the new one. (Or leave the internal
sentinel as-is — it's never user-visible, so renaming it buys nothing and only
risks data mismatch. Recommended: **leave this one unchanged.**)

### 5. localStorage keys (client-only persistence)
- `src/lib/authService.ts:4` — `letschat.auth_session_token`
- `src/features/auth/state.ts:7` — `letschat.pending_registration`
- `src/layouts/AppLayout.tsx:41` — `letschat.channel-bar-width`
- `src/features/web/DesktopAppBanner.tsx:7` — `letschat.web.desktopBannerDismissed`

**Impact:** renaming the auth-session key **logs every user out** on upgrade;
others silently reset a preference. Low stakes but avoidable.
**Migration:** on read, fall back to the old key and re-write under the new one
(one-time migration helper), or simply leave these keys as-is — they're internal
strings, not brand-facing.

### 6. Package / crate names
- `package.json` `name`, `src-tauri/Cargo.toml`, `server/Cargo.toml`, core-api
  project/solution names (`CoreApi.slnx`).

**Impact:** internal build identifiers; safe to rename, but touches CI scopes
(`rust-cache` workspaces, docker image names `letschat-core-api`,
`letschat-module`, `letschat-core-api-migrator` in `.github/workflows/release.yml`).
Rename image names deliberately (old image tags stay in the registry).

---

## Bucket A — safe find/replace

Everything else: `productName`/window title in `tauri.conf.json`, splash/UI copy,
log prefixes, code comments, `README.md`/`DEPLOYMENT.md`/`CLAUDE.md` prose,
`site/` marketing copy, GitHub repo description. Case-aware replace:
`LetsChat`→`<NEWNAME>`, `letschat`→`<newname>`. **Exclude**: `src/generated/`,
`*/target/`, `dist/`, lockfiles, `.git/`.

---

## Execution order

1. **Decide the final name** + confirm npm/GitHub/domain/trademark clear.
2. **Rename the GitHub repo** (GitHub auto-redirects the old URL; update `origin`).
   Update the memory note about PR URLs (`feedback_no_gh_pr_workflow`).
3. **Bucket A** sweep (scripted case-aware replace, excluding generated/build).
4. **Bucket B** with migrations:
   - Identifier + crate/package/image names (one pass; accept new-app identity).
   - Deep-link scheme: dual-accept old+new.
   - Discovery endpoint: dual-serve old+new.
   - Leave the system-message sentinel and localStorage keys as-is (recommended)
     or add read-fallbacks.
5. **Rebuild bindings / verify**: `bun run build`, `bun run lint`,
   `cargo build` (server + src-tauri), `bun run core-api:test`, `bun run test`.
   Manually verify a `letschat://` AND `<newname>://` deep link both resolve, and
   both `/.well-known/*.json` paths serve.
6. **Then** proceed with the SignPath Foundation application under `<NEWNAME>`.

## Transition-window cleanup (later release)

Once the fleet + clients have upgraded: drop the `letschat://` scheme acceptance
and the `/.well-known/letschat.json` alias. Track as a follow-up.

## Status

- [ ] Final name chosen + availability/trademark confirmed
- [ ] GitHub repo renamed, `origin` updated
- [ ] Bucket A sweep
- [ ] Identifier + package/crate/image renames
- [ ] Deep-link dual-scheme
- [ ] Discovery dual-endpoint
- [ ] Build + lint + tests + deep-link/discovery manual verify
- [ ] SignPath application uses the new name
- [ ] (Later) drop old scheme + endpoint alias

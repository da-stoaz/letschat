# P0 Plan: Windows Code Signing (via SignPath Foundation)

> **Status (reviewed 2026-11-14): not started; application material prepared
> below.** The owner cannot pay for a certificate (Azure ~$10/mo, Certum ~€25/yr),
> so SignPath Foundation is the only route. Desktop auto-update (branch
> `feat/desktop-auto-update`) does **not** depend on this. Current operational
> documentation lives in [`DEPLOYMENT.md`](../../docs/DEPLOYMENT.md).

## Context

Unsigned Windows installers trigger SmartScreen "unknown publisher" warnings and
AV false-positive quarantines. A first-time Windows user sees a malware-style
warning before the app even launches — the single highest-leverage adoption
blocker. macOS already ships signed + notarized (see the macOS steps in
`.github/workflows/release.yml`); Windows must reach parity.

This was originally sequenced before Plan 2, but storage-tiering Part A has
since shipped while Windows signing remains open. It is still a pure
build/release change — no app or frontend code.

### Current state (verified)

- **macOS signing + notarization is fully wired** in `.github/workflows/release.yml`
  (Apple cert import, API-key notarization, identity detection, and a post-build
  `codesign --verify` + `spctl --assess` gate).
- **Windows builds two artifacts but signs neither.** The release matrix produces
  Windows x64 (`.msi` + NSIS `.exe`) and ARM64 (`.msi`), shipped unsigned.
- `src-tauri/tauri.conf.json` has **no `bundle.windows` block** — no signing config.
- Releases are **drafts** (`releaseDraft: true`), so an operator verifies before publishing.

## Goal

Every Windows artifact produced by the release pipeline (`.msi` and `.exe`, x64
and ARM64) is **Authenticode-signed and RFC-3161 timestamped** with a publisher
certificate, automatically in CI, with a verification gate mirroring the macOS one.

## Non-goals

- OTA / auto-updater feed signing — that's P1 (OTA Updates); builds on this but is separate.
- macOS/Linux changes — macOS is done; Linux stays unsigned (AppImage/deb norms).
- Instant SmartScreen reputation — see the OV trade-off below.

---

## Decision: signing provider = SignPath Foundation

### Why not the obvious options

Since **June 2023**, every publicly-trusted code-signing certificate (OV *and*
EV) must keep its private key on certified hardware (USB token or cloud HSM). The
old "download a `.pfx` for €60" option is **gone**. Consequently:

- **Azure Trusted Signing** — ~$10/mo. Rejected: monthly cost.
- **Certum Open Source Code Signing** — ~€25/yr + ~€20 one-time card/reader.
  Rejected: recurring, over budget.
- **Self-signed cert** — €0 but **does nothing for SmartScreen** (not chained to a
  trusted root → still "unknown publisher"). Pointless for the goal.

### Why SignPath Foundation

The repo is **GPL-3.0** (OSI-approved) and **public** on GitHub — which qualifies
it for **SignPath Foundation**, a program that provides **free** code-signing
certificates + signing infrastructure to qualifying open-source projects. €0,
no recurring cost. The cost is *eligibility*: OSI license (✓), public source repo
(✓), public CI builds (✓ `release.yml`), and a short application/review.

### Honest expectation-setting

SignPath Foundation issues an **OV** (organization-validated) cert, not EV:

- ✅ "Unknown publisher" → replaced with the verified publisher name.
- ✅ AV false-positive quarantines drop sharply (signed binary).
- ⚠️ **SmartScreen reputation still ramps** — early downloads may still show
  "Windows protected your PC" until enough installs accrue. Only EV avoids this
  ramp, and EV is not free. This is the unavoidable trade for €0.

---

## How SignPath changes the pipeline

SignPath signs on **their** cloud HSM — no certificate material ever touches CI.
Signing therefore happens **between build and release-publish**, not inline during
Tauri bundling (unlike macOS, where Tauri signs during the build):

```
build (unsigned .msi/.exe)
  → submit to SignPath
  → SignPath signs on HSM
  → download signed artifacts
  → signtool verify
  → attach to draft release
```

`tauri-action` must **stop auto-publishing the Windows artifacts**; the Windows
legs build only, then a signing + upload step runs. macOS/Linux legs are untouched.

---

## Prerequisites (manual — the long pole, outside CI)

1. **Repo public** — required by SignPath Foundation. ✓ Confirmed public.
2. **Apply to SignPath Foundation** and pass eligibility review. They set up the
   org, a signing policy, and issue the cert. *Cannot be automated — account/review step.*
3. Once approved: install SignPath's GitHub App and add the secrets/inputs it
   needs (`SIGNPATH_API_TOKEN` secret; org / project / signing-policy slugs as
   workflow env).

**Do the CI wiring only after approval** — it can't be tested against a real
signing policy until the org exists.

---

## Application prep (checked against https://signpath.org/terms, 2026-11-14)

| Requirement | State |
|---|---|
| OSI license, no commercial dual-licensing | ✓ GPL-3.0 |
| Actively maintained, already released in the signed form | ✓ GitHub releases since v0.1.0 |
| Functionality documented on a download page | ✓ site `/download` |
| No malware/PUP, no proprietary code | ✓ (vendored glib is LGPL) |
| Verifiable automated build from the repo | ✓ `release.yml` on GitHub-hosted runners |
| Every release manually approved before signing | ✓ releases are drafts; owner publishes |
| Team roles: Authors, Reviewers, Approvers | Owner holds all three (single maintainer) |
| MFA on GitHub and SignPath for every member | Confirm GitHub MFA is on before applying |
| Product name + version metadata on binaries | ✓ Tauri sets `ProductName`/`FileVersion` from `tauri.conf.json` (LetsChat, package version); verify on the signed `.exe` |
| "Code signing policy" section on the project home page | **To publish when applying** — draft below |

### Draft: code signing policy section (site, e.g. `/download` or a `/code-signing` page)

> **Code signing policy.** Free code signing for Windows provided by
> [SignPath.io](https://about.signpath.io), certificate by
> [SignPath Foundation](https://signpath.org).
> Committers and reviewers: [da-stoaz](https://github.com/da-stoaz).
> Approvers: [da-stoaz](https://github.com/da-stoaz).
> Every signed release is built by GitHub Actions from this repository and approved
> manually before signing.
> **Privacy.** LetsChat transfers no data to any system unless a user connects it
> to a server they choose. The desktop app checks GitHub releases for updates.

Publish it only once the application is submitted: it states that SignPath signs
the builds.

### Interaction with the desktop updater

The updater's `.sig` (Tauri Ed25519) covers the exact installer bytes. Authenticode
signing changes the file, so once SignPath signs `.msi`/`.exe`, **re-run
`tauri signer sign` on the signed files and attach the new `.sig` files** before the
`updater-feed` job runs (it builds `latest.json` from the attached `.sig` files), or
every Windows update fails verification.

## Implementation surface

| Path | Change |
|---|---|
| `.github/workflows/release.yml` (two `windows-latest` legs) | Build Windows artifacts **without publishing** them; add a SignPath signing-request step (official action / API) that uploads each `.msi`/`.exe`, polls, and downloads the signed result; add a `signtool verify /pa /v` gate; re-sign them for the updater (see above); upload the **signed** artifacts to the existing draft release. |
| `src-tauri/tauri.conf.json` | **No change** — signing is external, not Tauri-inline; no `bundle.windows` block needed. |
| `production` GitHub environment secrets | Add `SIGNPATH_API_TOKEN` (+ org/project/signing-policy slugs, which can be plain workflow env, not secret). |
| App / frontend code | **No change.** |

---

## Acceptance criteria

1. Every Windows artifact on a release run is Authenticode-signed via SignPath;
   `signtool verify /pa` passes on each.
2. CI fails loudly if any Windows artifact comes back unsigned (no silent skip).
3. On a clean Windows VM, the installer shows the verified publisher name (no
   "unknown publisher"); AV does not quarantine.
4. Signature carries a valid RFC 3161 timestamp (SignPath timestamps server-side).
5. No certificate material in the repo or CI; signing is HSM-side at SignPath.
6. macOS and Linux release behavior unchanged.
7. The expected SmartScreen reputation ramp for early OV-signed downloads is
   documented (release notes / README).

---

## Effort

Config + CI wiring: **hours.** Gated on **SignPath Foundation approval**
(application + review — days to weeks, outside our control). Everything except the
approval is implementable here.

## Status

- [x] Application material prepared (2026-11-14, above)
- [ ] SignPath Foundation application submitted
- [ ] Approved + org/policy/cert provisioned
- [ ] GitHub App installed, secrets added to `production` environment
- [ ] `release.yml` Windows legs: build-only + sign + verify + upload
- [ ] Test release run validated on a clean Windows VM
- [ ] SmartScreen reputation-ramp note documented

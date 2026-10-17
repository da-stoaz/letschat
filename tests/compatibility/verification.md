# Compatibility verification — 2026-10-17

Candidate: 1.6.1, protocol 1, branch `feat/backend-compatibility`.

## Deployed legacy backend (read-only)

Fetched `https://lc-auth.stoaz.net/.well-known/letschat.json`. It returned
`serverVersion`, `recommendedClient`, and `minClient` equal to `1.5.0`, with no
`clientProtocol`. The candidate's actual discovery parser accepted its service
URLs; the actual compatibility evaluator returned `unknown`, requiring explicit
acknowledgment. No credentials, authentication requests, sockets, messages, or
other mutations were sent to this deployment. This is a discovery/admission check,
not a claim that all candidate features interoperate with v1.5.0.

## Automated local checks

| Check | Result |
| --- | --- |
| `bun run test:unit` | 233 passed, 39 files |
| `dotnet test core-api/CoreApi.slnx --no-restore -m:1` | 230 passed, no skips |
| `bun run lint` | Passed |
| `bun run build` | Passed |
| Native Tauri development build, offline | Passed |
| `python3 tests/compatibility/matrix.py` | Candidate/candidate passed |

The disposable backend test used real sign-in, the candidate client's generated bindings
and complete subscriptions, channel message send/read, DM send/read, and voice-token
issuance. Its Compose project and volumes were removed afterward. Unit coverage
includes blocked authentication/socket creation, refresh before sign-in,
concurrent/abandoned checks, protocol changes on reconnect, endpoint trust,
credential retention, acknowledgment reset, legacy metadata, and saved-state migration.

Existing build warnings remain: frontend chunk size/static-dynamic Tauri imports,
NuGet advisories for System.Security.Cryptography.Pkcs 10.0.0, and an xUnit analyzer
warning in MailSendLimiterTests. These checks did not change those dependencies.

## Interactive local checks

Used the real app components in the isolated compatibility fixture. Chrome tests
used local fake discovery; Tauri tests ran the candidate desktop binary with a
separate QA application identifier. Fixture storage is in memory, backend HTTP
calls are blocked, sockets deliberately fail after admission, and external links
record their target instead of opening a destination.

| Scenario | Result |
| --- | --- |
| Browser incompatible protocol | Blocks, shows explanation/version details, retry remains blocked |
| Browser download/web recovery | Selects the specific server landing/web URLs and shows the cross-server version warning |
| Browser cancel/choose another server | Returns to setup; saved server remains listed |
| Browser legacy discovery 404 | Requires acknowledgment; explicit acceptance admits; reload asks again |
| Restored startup with v1.5-style metadata | Shows unknown warning before authentication UI |
| Saved-host selection | Cannot bypass an incompatible protocol |
| Manual setup discovery then Connect | Compatibility check blocks incompatible connection |
| Browser join link | Host-trust confirmation followed by compatibility acknowledgment; auth form mounts only after acceptance |
| Hosted incompatible startup | Operator explanation; Escape cannot dismiss; retry/reload remain locked to instance |
| Hosted legacy metadata | Explicit acknowledgment admits; no server-picker control on sign-in |
| Discovery HTTP 503 | Retry/cancel, no Connect anyway bypass |
| Native Tauri legacy 404 | Explicit acknowledgment admits |
| Native Tauri unsupported protocol | Blocks; details/link target/retry/choose-another-server work |
| Native Tauri supported protocol with newer server release | Admits despite differing release/recommendation numbers |
| Native Tauri discovery HTTP 503 | Retry/cancel, no bypass |
| Browser layout at 390px | Warning, disclosure, download explanation, and recovery buttons fit |

Editing the fixture while open exposed a fixture-only React hot-reload issue
(multiple roots). Making the entry module reload fully fixed it; the hosted
acknowledgment flow then passed on a fresh load.

## Remaining coverage limits

- Protocol 1 has no published baseline yet. The oldest/latest released-client/backend
  matrix is implemented but cannot run until those releases exist.
- OS-delivered desktop cold/warm deep links and the real OS external-link opener
  were not exercised; browser join routing and the shared admission were tested.
- Real authentication/messaging ran through the disposable integration harness;
  the interactive UI fixture intentionally disables transport. This does not replace
  an installed-release end-to-end UI session or media-transport testing.
- The checks establish observed regression coverage, not a guarantee that every
  deployment or connection succeeds.

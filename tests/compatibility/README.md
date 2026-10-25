# Client/backend compatibility

Protocol 1 begins at **1.6.1**. The protocol covers required HTTP APIs, SpacetimeDB
views/reducers and generated bindings, plus connection behavior. It is independent
of release numbers. UI-only changes do not change the protocol. Additive changes
must work in both directions before retaining the same family; requiring a new
field/reducer/transport without a fallback requires a new family. This phase
supports protocol 1 only.

History pagination adds `load_older_*_messages_page` alongside the original
timestamp-only procedures. New clients fall back to the original calls only on
`No such procedure`; network and authorization errors remain retryable failures.
Older modules retain their equal-timestamp paging limitation until upgraded.

`VersionInfo.ClientProtocol` declares the server contract;
`SUPPORTED_CLIENT_PROTOCOLS` declares client support. The protocol is compiled in,
not an operator override. `FirstCompatibleClient` stays 1.6.1 for protocol 1.
`MIN_CLIENT_VERSION` can raise the operator's minimum (for example, to require a
security fix); `RECOMMENDED_CLIENT_VERSION` only recommends a manual download.
Neither a newer server release nor a different recommendation alone blocks access.

## Local real-backend test

Requires Docker, Bun, Rust with `wasm32-unknown-unknown`, and Python 3.12+.

```sh
cargo build --manifest-path server/Cargo.toml --target wasm32-unknown-unknown --release --locked
docker build -f server/Dockerfile.module -t letschat-compat-module:candidate server
docker build -f core-api/Dockerfile -t letschat-compat-core:candidate core-api
python3 tests/compatibility/run.py
```

The runner renders production Compose without loading `.env`, assigns a random
project name, fresh volumes/networks, and random loopback ports. It removes only
that project on exit. Authentication, generated bindings, the client's complete
subscription list, channel messages, DMs, and voice-token issuance are real.
No production or existing development database is used. It does not test actual
media transport; the existing RTC suite covers that separately.

Candidate backends with `chat-edge` exercise the public gateway. Add
`--check-revocation` to verify compressed subscriptions, password-change socket
closure, stale credential/ticket rejection and fresh-login recovery against the
real stack. Older backend source trees without `chat-edge` retain direct access
for the historical compatibility matrix.

## Real app UI testing

To keep the disposable stack alive after its smoke test:

```sh
python3 tests/compatibility/run.py --session-file /tmp/letschat-compat-ui-session.json
```

The private session file contains the local discovery URL and generated test-account
credentials. Use a fresh local frontend origin or isolated desktop QA application;
connect to that URL through normal setup. The runner pins both published ports so
container restarts preserve the selected endpoints. Removing the session file ends
the runner and removes its containers and volumes. Never commit the session file.
This mode supports authentication and messaging UI checks; it does not start a
media server for voice calls.

## Release gate

The reusable Backend compatibility workflow runs on PRs and before **both** backend
image publication and desktop release creation. It runs unit/discovery checks and
`matrix.py`: candidate/candidate first, then candidate client against the oldest
and latest published backend in the declared family, and those released clients
against the candidate backend. Each released client uses its own SDK and generated
bindings. Missing baselines or unavailable GitHub metadata fail the gate rather
than silently reducing coverage. The first family release runs candidate/candidate
only because no released family baseline exists yet.

For the matrix, fetch all git tags and provide `GITHUB_TOKEN` if needed for the
read-only Releases API. These release queries exist only in test tooling. The app
has no GitHub-latest update feed and performs no automatic installation.

## Admission and recovery

All connection entry points use the same preflight. Known incompatibility blocks
credentials and realtime connections. Missing/malformed compatibility metadata or
a legacy discovery 404 requires explicit “Connect anyway”; the acknowledgment is
in memory only and resets with host/metadata changes or reload. Timeouts/5xx errors
never count as permission. Original discovery roots are retained for saved hosts;
older entries fall back to their auth URL. Endpoint changes still require trust
confirmation. A failed proposed switch retains the current session.

Manual recovery links lead to the selected backend's download page or advertised
HTTP(S) web client. Installing its recommended desktop release may affect other
saved backends; this phase does not assess that global update decision.

UI verification: use `tests/ui/compatibility.html` on the local Vite server. Check
legacy acknowledgment/cancel, incompatible download messaging, retry, hosted-web
recovery, narrow screens and keyboard focus. The fixture isolates storage and
never contacts a backend.

Fixture parameters: `state=compatible|incompatible|legacy|legacy-metadata|unreachable`
(`legacy` returns 404; `legacy-metadata` models the v1.5.0 discovery response without
`clientProtocol`). Add `hosted` to exercise hosted-web startup. Use `entry=saved`,
`entry=startup`, or `entry=setup` for saved selection, restored connection startup,
or manual discovery. For browser join links, use `entry=join` and the normal
`s`, `a`, `l`, `d` query parameters pointing to the fixture endpoints.

See [verification.md](verification.md) for the executed checks and remaining gaps.

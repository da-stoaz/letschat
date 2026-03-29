# LetsChat

Desktop chat app built with:

- `server/`: SpacetimeDB Rust module (chat data + permissions)
- `auth-service/`: Rust auth API (`auth-framework` + SQLite)
- `src-tauri/`: Tauri shell
- `src/`: React + TypeScript frontend

## Dev Run Order

1. Start SpacetimeDB server:

```bash
spacetime start
```

2. Publish the Spacetime module:

```bash
spacetime publish --server http://localhost:3000 letschat --module-path server --yes
```

3. Start auth service (SQLite):

```bash
npm run auth:dev
```

4. Start LiveKit:

```bash
docker compose -f livekit/docker-compose.yml up -d
```

5. Start the desktop app:

```bash
npm run tauri dev
```

## Auth Service Environment

- `AUTH_BIND` (default: `127.0.0.1:8787`)
- `AUTH_DATABASE_URL` (default: `sqlite://auth-service/auth.db`)
- `AUTH_JWT_SECRET` (set this in real deployments)

Frontend auth API URL:

- `VITE_AUTH_SERVICE_URL` (default: `http://127.0.0.1:8787`)

## Push Notifications (Unified Backend Core)

LetsChat now uses a provider-agnostic push architecture in `auth-service`:

- Unified queue/outbox tables in SQLite
- Unified device registry API
- Background dispatcher worker
- Provider adapters (APNs implemented first, Windows/Web stubbed)

### Implemented now

- APNs Sandbox delivery adapter (`apns_sandbox`)
- Routes:
  - `POST /push/devices/register`
  - `POST /push/devices/unregister`
  - `POST /push/events/enqueue`
  - `POST /push/events/test`

### Required APNs sandbox env vars

```bash
APNS_SANDBOX_ENABLED=true
APNS_TEAM_ID=YOUR_APPLE_TEAM_ID
APNS_KEY_ID=YOUR_APNS_KEY_ID
APNS_BUNDLE_ID=net.stoaz.letschat
# choose one:
APNS_PRIVATE_KEY_PATH=/absolute/path/to/AuthKey_XXXX.p8
# or:
APNS_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

### Not implemented yet (documented stubs)

- `windows_wns` adapter:
  - Intended for Windows offline push once MSIX identity + WNS credentials are configured.
  - Currently returns "not implemented yet" from dispatcher.

- `web_push` adapter:
  - Intended for Service Worker + Web Push (VAPID/subscriptions).
  - Currently returns "not implemented yet" from dispatcher.

### Current integration boundary

- Backend queue + APNs sandbox sender is implemented.
- Native APNs device-token capture in the Tauri shell is not wired yet, so device registration must currently be done by posting a known APNs token to `/push/devices/register`.
- This keeps domain notification logic platform-neutral while provider-specific token acquisition can be added as adapters later.

### Design rule

Product notification logic should not branch by OS.
Only provider adapters differ (`apns_sandbox`, later `windows_wns`, `web_push`).

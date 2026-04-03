# LetsChat

Desktop chat app built with:

- `server/`: SpacetimeDB Rust module (chat data + permissions)
- `auth-service/`: Rust auth API (`auth-framework` + SQLite)
- `src-tauri/`: Tauri shell
- `src/`: React + TypeScript frontend

## Local Dev Flow

1. Start all supporting services (SpacetimeDB, LiveKit, MinIO):

```bash
npm run services:up
```

2. Publish the SpacetimeDB module (only needed after `server/` changes):

```bash
spacetime publish --server http://localhost:4300 letschat --module-path server --yes
```

3. Start auth service (`.env.development` is loaded automatically via `APP_ENV=dev`):

```bash
npm run auth:dev
```

4. Start the app:

```bash
npm run tauri dev
```

## Service Helpers

```bash
npm run services:logs
npm run services:down
npm run services:reset
```

## Auth Service Environment

- `AUTH_BIND` (default: `127.0.0.1:8787`)
- `AUTH_DATABASE_URL` (default: `sqlite://auth-service/auth.db`)
- `AUTH_JWT_SECRET` (set this in real deployments)

Frontend auth API URL:

- `VITE_AUTH_SERVICE_URL` (default: `http://127.0.0.1:8787`)

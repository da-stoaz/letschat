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

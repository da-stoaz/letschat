# LetsChat Deployment Notes

## SpacetimeDB

```bash
PATH="$HOME/.cargo/bin:$PATH" spacetime build
PATH="$HOME/.cargo/bin:$PATH" spacetime publish --server http://localhost:3000 your-app-name
```

If Homebrew Rust is installed, keep rustup shims first in `PATH` for SpacetimeDB wasm builds:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

Publish module:

```bash
spacetime publish --server http://localhost:3000 your-app-name
```

Production baseline:

```bash
spacetime start
spacetime publish --server http://your-server:3000 your-app-name
```

## LiveKit

- Use `livekit/config.yaml` and configure STUN/TURN for production.
- Set `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
- In this implementation, JWT signing is performed by the Tauri shell command `generate_livekit_token`.
- Provide `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to the desktop app environment at build/runtime.

## Auth Service (`auth-framework` + SQLite)

Development:

```bash
cargo run --manifest-path auth-service/Cargo.toml
```

Key env vars:

- `AUTH_BIND` (default `127.0.0.1:8787`)
- `AUTH_DATABASE_URL` (default `sqlite://auth-service/auth.db`)
- `AUTH_JWT_SECRET` (must be set to a strong value in production)

Frontend uses:

- `VITE_AUTH_SERVICE_URL` (default `http://127.0.0.1:8787`)

## Tauri Build

```bash
npm run tauri build
```

Artifacts:

- macOS: `.dmg`
- Windows: `.msi`

Build env:

- `SPACETIMEDB_HOST`
- `LIVEKIT_URL`

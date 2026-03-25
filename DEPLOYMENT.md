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
spacetimedb start
spacetime publish --server http://your-server:3000 your-app-name
```

## LiveKit

- Use `livekit/config.yaml` and configure STUN/TURN for production.
- Set `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
- In this implementation, JWT signing is performed by the Tauri shell command `generate_livekit_token`.
- Provide `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to the desktop app environment at build/runtime.

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

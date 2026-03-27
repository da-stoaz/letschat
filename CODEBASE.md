# LetsChat — Codebase Analysis

> Last updated: 2026-03-27

---

## Architecture Overview

| Layer | Tech |
|---|---|
| Desktop shell | Tauri 2.8 |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui |
| Real-time DB | SpacetimeDB (Rust WASM module) |
| Auth service | Rust + Axum + SQLite (Argon2, JWT) |
| Voice/Video | LiveKit 2.15 |
| File storage | MinIO (S3-compatible) |
| State | Zustand 5 (18 stores) |

```
/
├── server/          SpacetimeDB Rust module (schema + reducers)
├── auth-service/    Rust HTTP API (auth, LiveKit token generation)
├── src-tauri/       Tauri shell + native commands
├── src/             React frontend
│   ├── features/    Channel, DM, Voice, Friends, Servers
│   ├── stores/      Zustand state (18 stores)
│   ├── lib/         SpacetimeDB client, LiveKit, auth, Tauri bridge
│   ├── generated/   Auto-generated SpacetimeDB bindings (56 files)
│   └── pages/       Auth, App, DM, Invite
└── livekit/         LiveKit config + Docker compose
```

---

## What Is Functional

### Authentication & Sessions
- Register / login with password (Argon2 hashing)
- JWT session tokens via auth-service
- SpacetimeDB token issuance and refresh
- Full session lifecycle in both Tauri and web builds

### Servers & Channels
- Create, rename, delete servers
- Role system: Owner / Moderator / Member
- Kick, ban, unban, role assignment, ownership transfer
- Invite tokens with configurable expiry and use limits
- Create, reorder, delete text and voice channels
- Moderator-only channel flag

### Messaging
- Server text channels — send, edit, delete
- Direct messages — send, delete (separate sender/recipient delete flags)
- Message grouping by sender within 7-minute windows
- Typing indicators (4.5 s TTL, scoped per channel or DM)
- Virtual scroll with 50-message pagination for large histories
- Auto-scroll to bottom; jump-to-latest button when scrolled up

### Social Graph
- Friend requests (send / accept / decline / remove)
- Block / unblock (bidirectionally enforced on the server)
- Presence tracking (online / offline / last interaction timestamp)

### DM Voice (fully working)
- Join / leave 2-person DM voice calls
- Mute, deafen, camera toggle, screen share
- Audio input / camera / speaker device selection and live switching
- Active speaker detection
- Volume control (deafen disables remote audio)

---

## Urgent / Broken

### 1. Server voice controls are completely stubbed out
Every action handler in `src/features/voice/VoiceChannelView.tsx` (lines 240–254) is a no-op:

```ts
onToggleMute={async () => { return }}
onToggleDeafen={async () => { return }}
onToggleCamera={async () => { return }}
onToggleScreenShare={async () => { return }}
onLeave={async () => { return }}
```

DM voice has full working implementations. Server voice controls were disabled mid-refactor and never reconnected. This is the most critical gap in the app.

### 2. DM message editing is disabled
`allowEditOwn={false}` is hardcoded in the DM view. Server channel messages can be edited; DM messages silently cannot. The underlying infrastructure already supports it.

### 3. LiveKit `node_ip` hardcoded to a LAN address
`livekit/config.yaml` had `node_ip: 192.168.1.10` — breaks ICE candidate advertisement on any other network. Fixed by removing the field so LiveKit auto-detects.

---

## Nice to Have (not yet started)

| Feature | Notes |
|---|---|
| Message search | Button exists in the UI but is `disabled` — no backend query |
| Pinned messages | Pin button exists in the UI but is `disabled` — no schema support |
| File attachments | MinIO is running; `uploads.rs` stub exists in auth-service; no UI |
| Emoji reactions | No reactions table in schema |
| DM message editing | Trivial — infrastructure exists, just `allowEditOwn={false}` |
| Message threads | Requires schema changes |
| User profile view | No "click user → view profile" flow |
| Notification preferences | No settings page |
| Channel categories | Schema has `position` but no grouping concept |
| Kick/ban audit log | Events not queryable in UI |
| Offline message queue | No retry/queue for failed sends |

---

## Database Schema (SpacetimeDB)

| Table | Key fields |
|---|---|
| `User` | identity (PK), username (unique), displayName, avatarUrl |
| `AuthCredential` | username (PK), identity, password_salt, password_hash, token_iv/cipher |
| `Server` | id (u64, auto-inc), name, ownerIdentity |
| `ServerMember` | memberKey (PK), serverId, userIdentity, role |
| `Ban` | banKey (PK), serverId, userIdentity, bannedBy, reason |
| `Invite` | token (PK), serverId, createdBy, expiresAt, maxUses, useCount |
| `Channel` | id (u64, auto-inc), serverId, name, kind (Text/Voice), position, moderatorOnly |
| `Message` | id (u64, auto-inc), channelId, senderIdentity, content, sentAt, editedAt, deleted |
| `VoiceParticipant` | voiceKey (PK), channelId, userIdentity, muted, deafened, sharingScreen, sharingCamera |
| `Friend` | pairKey (PK), userA/userB, status (Pending/Accepted), requestedBy |
| `Block` | blockKey (PK), blocker, blocked |
| `DirectMessage` | id (u64, auto-inc), sender/recipient identity, content, deletedBySender, deletedByRecipient |
| `DmVoiceParticipant` | dmVoiceKey (PK), roomKey, userA, userB, userIdentity, muted, deafened |
| `PresenceState` | identity (PK), online, lastInteractionAt |
| `TypingState` | typingKey (PK), scopeKey, userIdentity, updatedAt |

---

## Environment Variables

### Frontend (Vite)
```
VITE_AUTH_SERVICE_URL     default: http://127.0.0.1:8787
VITE_SPACETIMEDB_URI      default: ws://localhost:4300
VITE_SPACETIMEDB_DATABASE default: letschat
VITE_LIVEKIT_URL          default: ws://localhost:7880
```

### Auth Service
```
AUTH_BIND           default: 127.0.0.1:8787
AUTH_DATABASE_URL   default: sqlite://auth-service/auth.db
AUTH_JWT_SECRET     required in production
```

### Tauri / Native
```
LIVEKIT_URL         default: http://127.0.0.1:7880
LIVEKIT_API_KEY     default: devkey
LIVEKIT_API_SECRET  default: devsecret0123456789devsecret0123456789
```

---

## Overall Assessment

The app is a solid ~65% complete MVP. The real-time architecture (SpacetimeDB + LiveKit + Zustand) is well-structured and DMs are essentially feature-complete. The most critical gap is server voice controls — the UI renders but every button is a no-op.

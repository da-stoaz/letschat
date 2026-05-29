# Feature Plan: Multi-Instance Client — LetsChat

## Status

**Deferred / idea-stage.** Captured from the 2026-05 product-positioning
discussion. Not scheduled.

## Premise

Today the desktop app is firmly single-instance: one `serverConfigStore`
entry, one SpacetimeDB connection, one auth-service session. Switching
"servers" means tearing the current connection down and reconnecting to a
different deployment.

This plan describes the alternative where the app talks to **many
instances at the same time** — i.e., the user can be a member of
`midjourney.chat`, `rust-team.chat`, and `my-friends.chat`
simultaneously, with all their spaces visible side-by-side in one client.

Each instance stays sovereign (own users, own moderation, own data,
own admin); the client federates *its own view*, not the protocol.

## Why this is interesting

Nobody owns this niche right now:

- Discord is centralised and won't federate.
- Matrix is technically multi-homeserver but the client UX (Element)
  treats each homeserver as a primary identity; the experience is
  closer to "pick one and live there."
- Mastodon doesn't have chat.
- Self-hosted chat tools (Mattermost, Rocket.Chat, Zulip) are all
  single-instance.

A LetsChat client that browses across all your sovereign communities at
once is a genuinely new product, not a Discord clone. The pitch:
*"Every community runs their own LetsChat. The app shows them all."*

## Signal to watch for before committing

This is a meaningful engineering investment (weeks of work, see Surface
below). Defer until at least one of the following is loud and repeated:

- Operators or users complain "I have to quit LetsChat to switch between
  my $A and my $B community."
- More than a handful of users belong to >1 deployment.
- The community-per-instance positioning (Option D in the discussion)
  becomes the dominant operator pattern in the wild.

Until that signal materialises, ship the **B+** position (self-hosted,
single instance per session, polished switching via deep links) and
measure.

## Surface (sketch — not a design)

The single-instance assumption runs deep. Touch points:

| Today | Becomes |
|---|---|
| `serverConfigStore` (one config) | A map of instances keyed by stable id; tracks per-instance config, auth session, last-active state |
| `spacetimedbClient.connection` (singleton) | A registry of `DbConnection`s, one per active instance |
| `selfStore`, `connectionStore`, `usersStore`, `serversStore`, `channelsStore`, `messagesStore`, … (single-tenant) | All become instance-scoped — either keyed by instance id, or duplicated per instance |
| One identity, one session token | One identity *per instance* (SpacetimeDB identities are per-host anyway), one session token per instance |
| AppRail = space switcher only | Two-level rail: instance switcher → spaces, OR interleaved with instance grouping |
| Friends scoped to "the instance" | Per-instance friend lists; no cross-instance friend graph |
| DMs between two users on the instance | Per-instance DMs |
| Notifications from one source | Aggregated across instances |
| Settings → Connection (one config) | Connection list with add/remove/reorder |
| Deep link `letschat://join?…` | Adds a NEW instance to the active list instead of replacing the current one |
| LiveKit room joining | Per-instance LiveKit credentials; one active call at a time (cross-instance call switching is a separate UX problem) |

Crucial **non-goals** for this plan:

- **No protocol federation.** DMs, friends, and channels do not cross
  instance boundaries. The federation is client-side only — the
  multiplexing of N independent worlds into one UI.
- **No cross-instance identity.** "alice" on instance A is not the
  same person as "alice" on instance B; each has its own SpacetimeDB
  identity, session, profile.
- **No cross-instance moderation.** Each instance keeps its own admin
  panel, role assignments, bans.

## Open questions

- **Identity duplication.** A user joining four instances ends up with
  four SpacetimeDB identities. Is the UX confusing? Probably not — most
  users will only see "I'm @alice on Midjourney, @alice_dev on Rust."
- **DM with someone who's on a different instance.** Out of scope.
  Either the operator both instances trust does a manual invite, or
  users just don't DM cross-community. Acceptable for v1 of this plan.
- **Background sync cost.** N SpacetimeDB WebSocket connections held
  open simultaneously. Battery, bandwidth, and connection-keepalive
  cost grow linearly. Cap at a sane N (8? 12?) and surface "this
  instance is paused" UI for inactive ones.
- **Auth UX with mixed registration policies.** Instance A is open;
  instance B is admin-approval. The onboarding flow when you click
  invite link #2 has to handle "you're already signed in to A — sign
  up for B too?" cleanly.

## Relationship to other plans

- **Independent of `1-control-panel.md` / `2-storage-tiering.md` /
  `3-e2ee.md` / `4-efficiency-cache.md`.** Builds on top of them; does
  not require changes to any of their server-side designs.
- **E2EE (`3-e2ee.md`) becomes more interesting with multi-instance** —
  keys naturally scope to instance, and an attacker compromising
  instance A learns nothing about messages on instance B.

## Effort (rough)

~4–6 weeks for a single developer, dominated by the store/connection
refactor and the UI for multi-instance browsing. The actual networking
is straightforward (N independent connections, no federation protocol);
the cost is touching every store and every component that assumes
"the current instance."

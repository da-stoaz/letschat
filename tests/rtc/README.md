# Voice transport regression

Run `bun --no-env-file tests/rtc/run.ts` with Docker, Chrome and the installed
frontend dependencies. The test creates and removes its own Compose project
and browser profile. It never uses the application database or a deployed
instance. It uses the production LiveKit image, RTC settings and network
membership, replacing addresses, ports and credentials for the local fixture.

On macOS the defaults use Docker Desktop and Google Chrome. Overrides:
`RTC_DOCKER_CONTEXT`, `CHROME_BIN`, `RTC_TEST_IP` (a local IPv4 reachable from
Docker), and `RTC_TEST_PORT` (default 17984; also reserves the next two ports).

The check covers:

- The configured LiveKit networks, including access from both supported proxies.
- Authenticated `RoomService/ListRooms` over that network.
- The application's call manager connecting and publishing a microphone.
- A second browser peer receiving real audio packets over UDP, then TCP.
- Both peers withholding LAN candidates, so success cannot depend on LiveKit
  initiating a connection directly to a client's LAN address.

Only application authentication and SpacetimeDB presence calls are stubbed.
`tests/security/voice-lifecycle.test.ts` independently covers presence ownership
using real database connections. Media transport, LiveKit and browser WebRTC
are real. This test does not claim to emulate every iOS/Private Relay network.

## Regression and scope

With two Docker interfaces, external-IP discovery can associate the public ICE
address with an interface other than the one receiving published ports. In a
local experiment using LiveKit 1.13.5 and SDK 2.22.3, a deterministic STUN fixture
selected each interface in turn. With the non-forwarded interface selected,
the client exposing its LAN address connected, while the client withholding
LAN candidates failed ICE. Selecting the forwarded interface restored the
second client's connection without changing browser or SDK versions.

The checked-in test also failed with the previous `[default, proxy]` topology
(`could not establish pc connection`) and passed UDP and TCP after changing
only LiveKit's membership to `[proxy]`. It uses a fixed external address rather
than internet STUN so the test does not depend on external discovery services.
Keeping just one NIC removes the ambiguity for both discovery and fixed-IP
configuration. The authenticated internal API check guards against fixing
media at the cost of breaking core-api's access to LiveKit.

The production Chrome trace showed successful signalling, stable ICE
credentials and no ICE responses over UDP or TCP, including after microphone
permission and when trying the direct server LAN address. This is consistent
with the reproduced transport failure, but the production server's selected
internal ICE interface was not captured. The historical successful Windows
1.2.3 call does not establish an SDK regression: both application versions use
SDK 2.22.3 and both passed the isolated full-UI comparison. A client exposing a
reachable LAN candidate can also succeed via server-initiated ICE despite a
broken published-port path. The local regression is not a claim that the
unmodified production installation has been repaired or verified.

# Plan: HLS streaming for video attachments

> **Status (2026-09-23): Proposed, decisions settled (default on, no 30i,
> separate media-worker, 60 Mbit/s stream cap, 8K transcoded) — not
> implemented.**
> Builds on the poster worker committed in `34f6098` (`VideoThumbnailWorker`,
> `ThumbnailState`, click-to-play `InlineVideo`). Check file and type names
> against the code before starting. Nothing below describes current behaviour
> unless it says "today".

## Problem

Today a chat video plays the original upload by progressive download: the
`<video>` element reads the MP4 straight from MinIO through one presigned URL,
and the browser's media engine alone decides which byte ranges to fetch.

Measured on 2026-09-23 with the real 1.6 GB DJI clip (HEVC, 2688×2016, 60 fps,
~100 Mbit/s, index at the end of the file). The player was an off-screen
`WKWebView`, which is the same media stack Tauri uses on macOS. Each run
played 30 s:

| Link | GET requests | Bytes that reached the player |
|---|---|---|
| localhost | 2281 | 9.5 GiB |
| throttled to 200 Mbit/s | 2255 | 674 MiB |
| needed for 30 s at the source bitrate | — | ~422 MiB |

There are two separate causes:

1. **Source bitrate.** 30 s of a 100 Mbit/s original costs ~420 MB, however
   well it is streamed. Camera originals are not a web delivery format.
2. **WebKit's range pattern.** AVFoundation sends ~75 overlapping range
   requests per second and cancels most of them early.
   - Over a real link this wastes ~1.6×.
   - On localhost every response arrives before the cancel, which causes the
     23× overfetch seen in development.
   - Safari's Web Inspector shows the *requested* range size as "resource
     size". The "40 GB" figure came from there and does not measure traffic.

HLS fixes both. The player gets lower-bitrate H.264 renditions cut into short
segments, fetches them one at a time, and buffers only a bounded amount ahead.

Reference transcode of the same clip: 20 s at below-normal priority, 2 threads,
1080p output at the source's 60 fps, dev Mac. It ran at **1.0× realtime** and
produced **8.2 MB** of segments, about 3.3 Mbit/s. At that rate 30 s would
cost ~12 MB instead of ~420 MB.

## Goals and non-goals

Goals:
- Inline playback streams HLS renditions. The original stays the source of
  truth for **Save** and **Open**.
- Transcoding never blocks an upload or the UI, and it only uses spare CPU.
- Instance admins control it in `/admin/config`: a master switch, the frame
  rate, and the renditions.
- Read rules stay the same as the original's. There is no new way to reach an
  object.
- Every derived object is deleted together with its video. Nothing becomes an
  orphan.
- Playback works in Tauri/Safari (native HLS) and in Chromium/Firefox
  (hls.js). Any other client falls back to the original, but only if the
  original is at or under the stream bitrate cap.
- No inline stream ever exceeds the admin's bitrate cap (default 60 Mbit/s).

Non-goals (for now):
- Live streaming, DRM, subtitles.
- Re-encoding images or audio.
- Automatically re-transcoding existing videos when settings change (see
  *Settings changes*).

## Decisions (2026-09-23)

| Topic | Decision |
|---|---|
| Configuration | Admin panel, stored in `SystemConfig`, seeded once from env like the upload limits |
| Master switch | `VideoTranscodingEnabled`, one switch for HLS transcoding |
| Frame rate | Admin chooses **30p** or **60p**. **30i is not offered** (see below) |
| Renditions | Admin chooses **720p**, **1080p**, or both; with both, players switch adaptively |
| Storage limit | Derived bytes count against the **instance** limit only, never per user |
| Stream bitrate cap | No inline stream above **60 Mbit/s** (admin setting, default 60). HLS renditions stay far below it. An original above the cap never plays inline, only via **Save** |
| 8K sources | Transcoded like everything else (downscaled to the renditions). Clients cannot play 8K originals, so skipping them is not an option |

**Why 30i is left out:**
- Apple's HLS authoring rules call for progressive video.
- Browsers (MSE/hls.js) do not deinterlace, so moving interlaced frames show
  combing artifacts.
- 30i saves no bandwidth over 30p.

Interlaced *sources* are still supported. The worker deinterlaces them
(`bwdif`, applied only to interlaced frames) before encoding, so every output
is progressive. If an interlaced delivery format is ever really needed, that
is a separate decision.

Posters are not covered by the master switch. They take ~1 s each and the
click-to-play UI depends on them, so they keep running whenever ffmpeg is
present.

## Design

### 1. Admin settings

New `SystemConfig` fields. The first-run seed comes from env; after that, only
the admin panel controls them (see DEPLOYMENT "Configuration lifecycle").
A `VideoSettingsSeeded` marker makes the upgrade seed run once, the same
pattern as `UploadQuotaSettingsSeeded`.

| Field | Env seed | Default | Values |
|---|---|---|---|
| `VideoTranscodingEnabled` | `VIDEO_TRANSCODING_ENABLED` | `true` | on/off |
| `VideoFrameRate` | `VIDEO_TRANSCODING_FPS` | `30` | `30` or `60` |
| `VideoRenditions` | `VIDEO_TRANSCODING_RENDITIONS` | `1080` | `720`, `1080`, `720,1080` |
| `VideoMaxStreamMbps` | `VIDEO_MAX_STREAM_MBPS` | `60` | 8–500 |

- Validation: when the switch is on, at least one rendition must be selected.
  `VideoMaxStreamMbps` must be at least 8, because the largest rendition
  (1080p60) peaks at 7.5 Mbit/s video plus 128 kbit/s audio. A lower cap would
  block HLS itself.
  The panel shows this as a normal form error, the same way as the upload
  limits.
- The "File uploads" card in `/admin/config` gets a "Video streaming" section:
  the master checkbox, a 30p/60p radio group, and 720p/1080p checkboxes.
- The panel shows the queue state: pending, done, and failed HLS jobs. After a
  first enable or an upgrade the backfill can take hours, and the admin needs
  to be able to see that.

### 2. Encoding parameters

- **Frame rate** means a *cap* and never upsamples. With cap *C* and source
  rate *S*:
  - if *S* ≤ *C*, keep *S*;
  - if *S*/2 ≤ *C*, use *S*/2, so 60→30 and 50→25 drop whole frames cleanly;
  - otherwise use *C*.

  The worker reads *S* with `ffprobe` first. This is a pure function with a
  unit test.
- **Renditions** never upscale:
  - For each selected height *H* (720 or 1080), produce it only if the
    source's short side is ≥ *H*.
  - If the source is smaller than every selected rendition, produce one
    rendition at the source size.
  - Scaling targets the short side, so portrait video stays portrait. ffmpeg
    applies rotation metadata by default.

| Rendition | 30p maxrate / bufsize | 60p maxrate / bufsize |
|---|---|---|
| 720p | 2.5M / 5M | 4M / 8M |
| 1080p | 5M / 10M | 7.5M / 15M |

- Encoder settings:
  - Video: `libx264 -preset veryfast -crf 23`, `yuv420p`.
  - Keyframes: `-force_key_frames "expr:gte(t,n_forced*6)"`, so segments
    align across renditions.
  - Audio: AAC 128k stereo, optional via `-map 0:a:0?`.
  - Container: fMP4 HLS VOD with 6 s segments.
- **One ffmpeg run per video.** It decodes once and uses `split` to feed each
  rendition's scaler. The hls muxer writes all variants plus the master
  playlist (`-var_stream_map`, `-master_pl_name`). A ladder therefore costs
  ~1.5× CPU, not 2×, because decoding the 4K HEVC source is the expensive part.
- The static ffmpeg in the core-api image (`mwader/static-ffmpeg:7.1`) already
  has everything needed:
  - libx264, HEVC decoding, and HTTP input (verified in `34f6098`);
  - `bwdif`, `split`, `-readrate`, and the hls muxer's `-var_stream_map`,
    `-master_pl_name`, and fMP4 segments (verified on 2026-09-23).

### 3. Storage layout: flat derived keys

```
uploads/ch/1/alice/<uuid>.MP4                       original (unchanged)
uploads/ch/1/alice/<uuid>.MP4.thumb.jpg             poster (today)
uploads/ch/1/alice/<uuid>.MP4.hls.m3u8              master playlist, uploaded last = "ready"
uploads/ch/1/alice/<uuid>.MP4.hls.720.m3u8          variant playlist
uploads/ch/1/alice/<uuid>.MP4.hls.720.init.mp4      fMP4 init segment
uploads/ch/1/alice/<uuid>.MP4.hls.720.00000.m4s     media segments
uploads/ch/1/alice/<uuid>.MP4.hls.1080.…            same for 1080p
```

The keys stay flat on purpose. `StorageKey.TryParse` accepts exactly five
segments for the channel, DM, and icon shapes, so a nested `…/<uuid>.hls/…`
path would parse as invalid. A suffix keeps each derived key in its video's
scope, so it inherits the video's read rule without new authorization code.

Collisions are impossible. Stored names are always server-generated
`{uuid}.{ext}`, and `Path.GetExtension` only keeps the last extension, so no
upload key can contain `.hls.` or end in `.thumb.jpg`.

### 4. Job pipeline

- Rename `VideoThumbnailWorker` to `VideoProcessingWorker`. It runs in the
  media-worker container (see §5), one job at a time, and picks work in this
  order:
  1. **Prepare:** `ffprobe` plus the poster, for videos without a probe
     result or with a pending poster. This takes ~1 s, reads only the index
     and a few frames, and always runs. `ffprobe` records `DurationSeconds`,
     `BitrateKbps`, `Width`, `Height`, and `FrameRate` on the row. If the
     container reports no bitrate, it is computed as `FileSize × 8 /
     duration`. Posters that are already `Done` but have no probe result get
     probed here. This is how existing videos get their bitrate.
  2. Pending HLS jobs, oldest first, but only when `VideoTranscodingEnabled`
     is on.
- New `ConfirmedUploads` columns: `HlsState` (same enum as `ThumbnailState`),
  `HlsAttempts`, `DerivedBytes`, and the probe results (`DurationSeconds`,
  `BitrateKbps`, `Width`, `Height`, `FrameRate`, all nullable). The migration backfills `HlsState =
  Pending` for every video, using the same predicate as the poster backfill.
  Confirm sets `Pending` for `video/*`.
- With the switch off, jobs stay `Pending`. They are neither processed nor
  failed. When an admin turns the switch on, the worker works through the
  backlog, oldest first.
- Each job:
  1. Reads the current settings once and keeps that snapshot for the whole
     job.
  2. Uses the stored probe result (duration, frame rate, resolution) and
     **increments `HlsAttempts` before starting ffmpeg**. If the process or
     the whole container is killed (OOM, restart), that attempt still counts,
     so a video that always crashes the worker cannot loop forever.
  3. Transcodes into a unique temp directory with `-hls_flags temp_file`, so
     that a segment only appears under its final name once it is complete.
     **Finished segments are uploaded and deleted while the encode is still
     running.** The temp directory therefore holds a few segments per
     rendition however long the video is. Variant playlists and the master
     playlist go up last.
  4. Records `DerivedBytes` (poster plus HLS), marks the job `Done`, and
     deletes the temp directory, also on failure.
- The timeout scales with duration: `max(15 min, 6 × duration)`. A 2-minute
  clip gets 15 min and a 60-minute recording 6 h, so long videos are not
  killed three times in a row on a slow server. After 3 attempts the job is
  `Failed`, and playback keeps using the original.
- 8K sources are transcoded like any other (measured to fit, see *Resource
  sizing*). Sources with a long side above 8192 px are marked `Failed` with a
  logged reason. They are rare, and nothing here can play them.
- If the video was collected during the transcode (`DbUpdateConcurrencyException`
  on save), the worker deletes the whole `…hls.` prefix. The poster path
  already handles this case the same way.

### 5. Resource isolation: a separate media-worker container

ffmpeg does not run inside .NET. The worker starts it as a **child process**
of core-api (`Process.Start`). Its priority is set with
`ProcessPriorityClass`, which .NET maps to a Unix nice value:
`BelowNormal` = nice 10, `Idle` = nice 19 (verified on 2026-09-23).

Nice alone is not enough in Docker. Since cgroup v2, the kernel first splits
CPU time *between* containers by their `cpu.weight`. Nice values only rank
processes *within* one container. An ffmpeg at nice 19 inside the core-api
container therefore only yields to core-api itself. Against SpacetimeDB,
LiveKit, and Postgres, it competes with the full weight of the core-api
container. Posters (~1 s each) can live with that. Transcoding four cores for
minutes cannot, because voice and the single-writer SpacetimeDB must not lose
CPU to it.

Design:

- **Same image, own container.** Compose gets a `media-worker` service from
  the core-api image with `CORE_API_ROLE=media-worker`. In that role core-api
  only starts `VideoProcessingWorker`: no HTTP, no admin panel, no other
  background services. It shares the env block with `core-api` through a YAML
  anchor, because it needs the same Postgres, MinIO, and `AUTH_JWT_SECRET`
  settings.
- **Low CPU weight.** Set `cpu_shares: 128` on `media-worker`, which is ~1/8 of
  the default weight. Under load it gets CPU only after every other container.
  When the server is idle it may still use all free cores.
- **Hard caps for small servers.** Add `cpus: ${MEDIA_WORKER_CPUS:-2}` and a
  `mem_limit: ${MEDIA_WORKER_MEMORY:-2g}`. Transcoding can then never take
  more than two cores, even when idle, and a runaway decode cannot push the
  other services into swap. `-threads` does not cap ffmpeg's total CPU:
  decoder, filters, and each encoder have their own threads, and 2 × 2
  threads used ~2.8 cores. The container `cpus` limit is the real cap.
- **Inside the container:** ffmpeg runs at `Idle` (nice 19) with `-threads`
  matched to `MEDIA_WORKER_CPUS`. HTTP input is read at most at 2× realtime
  (`-readrate 2`), so a backfill does not saturate MinIO's disk and network
  while users are downloading.
- **core-api** runs with `CORE_API_ROLE=api` in compose and does no ffmpeg
  work. `bun run core-api:dev` defaults to `all` (API plus worker in one
  process), so local development needs no extra container.
- **Exactly one media-worker.** Jobs are not leased. Two workers would do
  duplicate work (idempotent, same keys) but corrupt nothing. DEPLOYMENT says
  to run one. Leasing (`LeasedUntil` + `FOR UPDATE SKIP LOCKED`) waits until
  someone actually needs to scale out.
- The admin panel's queue counters read Postgres, so they work regardless of
  which container processes the jobs.

#### Resource sizing (measured 2026-09-23)

The same 1.6 GB DJI clip (HEVC 2688×2016, 60 fps) was transcoded into both
renditions at 60p in one ffmpeg run, with 2 decoder threads and 2 threads per
encoder, reading over HTTP from MinIO:

| Encoded length | Peak RAM (RSS) | Output | CPU |
|---|---|---|---|
| 15 s | 325 MiB | 5.8 MB | 2.8 cores |
| 60 s | 328 MiB | 25 MB | 2.8 cores |

8K check: a 4 s synthetic 8K HEVC clip (7680×4320, 30 fps, 120 Mbit/s) ran
through the Linux static ffmpeg in a container limited to 1.5 GB and 2 CPUs.
Both runs succeeded. Peak cgroup memory, which includes page cache:

| Output | Peak memory |
|---|---|
| 1080 only | 889 MiB |
| 1080 + 720 | 985 MiB |

Real 8K footage is often 10-bit, which needs more frame memory. The default
`MEDIA_WORKER_MEMORY` is therefore **2 GB**.

- **RAM does not depend on file size or length.** ffmpeg streams the input
  over HTTP range requests and never holds the file. Memory is decoded frames
  plus the x264 lookahead, so it depends on the *resolution*. A 5 GB file of
  the same format needs the same ~330 MiB. 8K needs ~1 GiB, and the 2 GB
  default covers that with headroom for 10-bit sources.
- **Temp disk grows with duration.** That is why segments are uploaded
  during the encode (§4). The measured rate is ~25 MB per minute for both
  60p renditions; the worst case at maxrate is ~90 MB per minute.
- **Time grows with duration.** At 0.3–1× realtime, a 7-minute 4K clip
  (≈5 GB at 100 Mbit/s) takes 7–25 min. The duration-scaled timeout covers it.
- **When the memory limit is hit anyway**, the cgroup OOM killer ends a process
  inside media-worker and nothing outside it. That attempt was already counted
  (§4), so the job reaches `Failed` after three tries and the original plays.

### 6. Settings changes

- A change applies to jobs that start after it. A running job finishes with
  its snapshot.
- Videos that are already `Done` keep their renditions. The master switch only
  controls transcoding; playback of existing HLS output continues when it is
  off.
- Re-processing old videos with new settings is a later admin action ("requeue
  all videos": delete the `…hls.` prefixes and set `HlsState = Pending`). It is
  not part of v1.

### 7. Playback authorization: signed playlist URLs

The raw playlists cannot be served through presigned MinIO URLs. The player
resolves the relative variant and segment URIs against the playlist URL,
which drops the signature query, so every request returns 403. AVFoundation
also does not accept `blob:` or `data:` playlists. core-api therefore serves
the playlists through capability URLs:

1. The client asks the new batch endpoint `POST /uploads/playback` for its
   video keys, alongside the existing `download-urls` call for posters and
   originals.
2. core-api authorizes each key with the existing `MayReadAsync`. Keys the
   caller may not read are omitted, the same rule as `download-urls`. For
   every other key it returns one decision:

   | `mode` | When | Client shows |
   |---|---|---|
   | `hls` | `HlsState == Done` | Poster, then the HLS player (`hlsUrl`) |
   | `original` | HLS not ready, and `BitrateKbps ≤ VideoMaxStreamMbps` | Poster, then the original, as today |
   | `preparing` | Over the cap or not probed yet, HLS `Pending` and switch on | Poster, "Being prepared for streaming", **Save** only |
   | `unavailable` | Over the cap or not probed, and HLS `Failed` or switch off | Poster, "Too large to stream, save to watch", **Save** only |

   An unknown bitrate counts as over the cap. The prepare step fills it in
   within seconds, so this only affects the first moments after an upload.
3. For `hls`, core-api returns
   `{DiscoveryAuthUrl}/uploads/hls?key=…&v=master&exp=…&sig=…`:
   - `sig` = HMAC-SHA256 over `hls|key|v|exp`, using a key derived from
     `AUTH_JWT_SECRET`.
   - `exp` is the same 1 h lifetime as download URLs.
4. `GET /uploads/hls` needs no session:
   - It verifies `sig` and `exp` in constant time and reads the requested
     playlist from MinIO.
   - `v=master`: it rewrites each variant URI into a signed core-api URL for
     that variant, with the same `exp`.
   - `v=720` or `v=1080`: it rewrites the `#EXT-X-MAP` URI and every segment
     line into presigned public MinIO GET URLs, valid for 6 h.
   - It returns `application/vnd.apple.mpegurl` with `Cache-Control: no-store`.
   - It is rate-limited like the other upload routes.
   - The default CORS policy already allows any origin, which hls.js needs.
5. Segments come straight from MinIO, like downloads today. core-api never
   proxies media bytes.

This works with both deployment tracks: `auth.<domain>` already routes all
paths to core-api through Caddy and through the tunnel.

### 8. Client

- A `useVideoPlayback` resolver, the same pattern as `useAttachmentResolver`,
  calls `/uploads/playback` for the video keys in view and caches the
  decisions.
- `AttachmentListItem` renders by `mode` (see the table in §7). **Open**
  follows the same rule as inline playback, so it is disabled for `preparing`
  and `unavailable`. **Save** always downloads the original.
- The cap is a bandwidth and UX policy, not a security boundary. The original
  stays readable through **Save**, so enforcing it in the client is correct.
- `attachInlineVideo` chooses the source:
  1. `hlsUrl` and `video.canPlayType('application/vnd.apple.mpegurl')` →
     native HLS: Tauri/WebKit, Safari, and newer Chromium builds.
  2. `hlsUrl` and MSE available → `import('hls.js')` (dynamic, so Tauri never
     loads the chunk), `loadSource` + `attachMedia`. Teardown calls
     `hls.destroy()`.
  3. Otherwise → the original URL, as today.
- Resuming uses `currentTime = startAt` on `loadedmetadata` for all three
  paths, because the `#t=` fragment does not apply to HLS.
- The unload rules (end, 10 s pause, scrolled away) and the StrictMode-safe
  setup and teardown stay the same. Every path gets a unit test, including
  setup → teardown → setup.
- New dependency: **hls.js**, loaded only on demand. It is the standard MSE
  HLS player, and nothing in the repo covers this today.

### 9. Cleanup, inventory, and quotas

- The collector deletes the poster **and every object under the
  `<videoKey>.hls.` prefix** after the original. This needs
  `StorageService.DeletePrefixAsync` (list and batch delete).
- The inventory import skips derived keys. Replace the current `.thumb.jpg`
  check with one `IsDerivedKey` helper that also covers `.hls.`.
- `DerivedBytes` counts against the **instance** limit only.
  `StorageUsage.RetainedAndPendingAsync(username: null)` adds it; the per-user
  sum does not. The admin panel's "currently tracked" figure includes it.

## Phases

1. **Settings.** `SystemConfig` fields, seed marker, env seeding, validation,
   admin panel section, queue counters.
2. **Media-worker role.** `CORE_API_ROLE` (`all`/`api`/`media-worker`), the
   compose service with shared env anchor, `cpu_shares`/`cpus`/`mem_limit`,
   ffmpeg at `Idle` with `-threads` and `-readrate`. Posters move with it.
3. **Probe, transcode, storage, and cleanup.** Worker rename, the prepare
   step (ffprobe fields plus poster), frame-rate and
   rendition planning (pure functions), the single-pass ladder, migration
   with backfill, prefix delete, derived-key import skip, `DerivedBytes`.
4. **Playback and playlist endpoints.** `POST /uploads/playback` (modes, cap), signed URL
   minting, and the master and variant rewrite in `GET /uploads/hls`.
5. **Client.** `useVideoPlayback`, the four display modes, source selection
   (native, hls.js, original), resume, tests.
6. **Docs and ops.**
   - DEPLOYMENT (new env seeds and the backfill behaviour after an upgrade),
     CODEBASE, and the core-api README.
   - `.env.*.example` files and the site self-hosting pages.
   - Roadmap: Plan 3.
   - A backfill run on dev data.

## Verification

- **Unit tests (C#):**
  - Frame-rate planning: 60→30, 50→25, 24 stays 24, 30 stays 30, 120 with a
    60 cap → 60.
  - Rendition planning: a 4K source with both renditions → 720 and 1080; a
    720p source with 1080 selected → one rendition at source size; an 8K
    source → both renditions; above 8192 px → rejected.
  - Bitrate fallback: container bitrate missing → `FileSize × 8 / duration`.
  - Settings validation: the switch on with no rendition → error.
- **C# smoke tests** (MinIO + ffmpeg, like `VideoThumbnailSmokeTests`):
  - A 20 s 60 fps test clip with both renditions selected produces a master
    playlist, 2 variants, and segments at 30 fps, and the state becomes `Done`.
  - With the switch off, the job stays `Pending`.
  - A corrupt file ends in `Failed`.
  - The collector removes all derived objects.
- **C# playback tests:** `mode` for each state combination (HLS done;
  original under or over the cap; not probed; pending with the switch on;
  failed or switch off), and a non-member key omitted.
- **C# endpoint tests:**
  - The master rewrite yields signed variant URLs, and the variant rewrite
    yields only presigned segment URLs.
  - A tampered or expired `sig` returns 403.
  - `download-urls` omits the playlist key for a non-member and for a video
    that is not ready.
- **Isolation check:** on a compose stack, run a backfill while a CPU-bound
  load runs in another container. `docker stats` must show media-worker
  yielding (low weight) and never exceeding `MEDIA_WORKER_CPUS`. A voice call
  during the backfill must stay clean.
- **Client unit tests:** source choice for native, hls.js (mocked), and
  fallback; resume; StrictMode setup → teardown → setup.
- **Real-engine measurement:** repeat the `WKWebView` probe through the
  200 Mbit/s throttling proxy. Target for 30 s of playback: **≤ 25 MB
  delivered and roughly ≤ 20 requests**, down from 674 MiB and 2255. Record
  the numbers in this plan.
- **Manual checks:**
  - Tauri: poster → play → pause 10 s → resume.
  - Chrome web client: hls.js path, including a rendition switch when the
    link is throttled in DevTools.
  - A video still transcoding plays the original.
  - Toggling the settings in `/admin/config` affects only new jobs.

## Risks

- **CPU on small servers.** 1.0× realtime on a dev Mac can become 0.2–0.5×
  on a 2-vCPU VPS. A backfill of many long videos then takes hours, and the
  default is on, so an upgrade starts that backfill.
  - Mitigations: its own container with low CPU weight and a hard `cpus`
    cap (§5), one job at a time, oldest first, posters before HLS, queue
    counters in the panel, and the master switch.
  - DEPLOYMENT must say this in the upgrade notes.
- **HDR / 10-bit / log footage** (DJI D-Log, HLG). A plain `yuv420p`
  conversion looks washed out without tonemapping. Accept this for v1 and
  note it. Add a `zscale`/`tonemap` chain only if it matters.
- **Presigned URL lifetime.** Playlist URLs last 1 h and segment URLs 6 h.
  A tab left open longer needs a new resolution. The resolver does not
  refresh expired URLs today; this affects the original too. Retry on a
  media error is a small follow-up.
- **Very large files.** Today an upload is capped at 2 GiB per file
  (`UploadLimits.MaxFileMiB`), so a 5 GB video cannot arrive. If that cap is
  raised:
  - RAM stays flat, and temp disk stays at a few segments.
  - Only the time grows, and the duration-scaled timeout covers that.
  See *Resource sizing*.

# clips.oneroomgaming.com — MVP Design

**Date:** 2026-09-21
**Status:** Approved, ready for implementation planning

## Overview

A private site where a small group of friends upload, browse, and watch their
game clips together. Roughly 5–10 users, a few thousand clips eventually.
Self-hosted, behind the existing Authentik SSO gate.

The MVP has four goals, in the user's words:

1. Basic user login
2. High-performance video streaming
3. A "watch together" synced-playback feature
4. A site that feels genuinely live, built on websockets

## Non-goals for the MVP

Deliberately excluded, with the reasoning that got them excluded:

- **Adaptive bitrate / HLS.** Clips are served as remuxed originals. The job
  queue has a registered `transcode` type so this becomes a new job rather than
  a rewrite.
- **A shared queue in the theater.** The host picks one clip at a time.
- **Playhead-anchored comments.** Comments are per-clip. The `position_ms`
  column exists and is nullable so the feature is additive later.
- **Per-clip permissions.** Everyone who passes SSO sees everything.
- **Mobile as a first-class target.** Desktop Chrome/Firefox primary; mobile
  must not be broken.
- **Room persistence across restarts.** Theater state is in memory and resets.

## Decisions

| Area | Decision |
|---|---|
| Auth | Authentik SSO via the existing Caddy `forward_auth`; app trusts `X-authentik-*` |
| Ingest | Browser upload and a watched folder, converging on one media root |
| Uploads | Resumable, `tus-node-server`, ~16 MiB chunks |
| Processing | Job queue: `probe`, `thumbnail`, `remux-faststart`; `transcode` registered but stubbed |
| Playback bytes | Caddy `file_server`, opaque ULID filenames, never through Node |
| Theater | One always-on room; host picks one clip; host can hand off control |
| Sync | Hand-rolled `SyncController` (Cristian's algorithm + nudge/seek bands) |
| Realtime | Presence, live grid, upload progress, reactions, chat |
| Data | SQLite + Drizzle, in-process pubsub, no Redis |
| Topology | One image, two commands: `web` and `realtime` |
| Stack | Next 16, React 19.3, Tailwind 4, TypeScript, `ws`, ffmpeg in image |

## Architecture

Two processes built from **one Docker image**, differing only by their
`command`. This keeps the existing release pipeline (one `samikool/*` image)
while isolating latency-sensitive work.

```
                 ┌─────────────────────────────────────┐
   Caddy  ───────┤ /media/*   →  file_server (bytes)    │
 (authentik      │ /ws        →  realtime:3001          │
  gate on all)   │ /*         →  web:3000               │
                 └─────────────────────────────────────┘

   web (Next.js)                    realtime (ws only)
   ├─ SSR + app shell               ├─ holds sockets
   ├─ metadata API                  ├─ presence / chat / sync
   ├─ tus upload  ────POST /emit───▶  fan-out
   └─ job queue → ffmpeg            └─ (no disk, no ffmpeg, no SSR)
```

### Why the split

`realtime` is deliberately tiny and does nothing that can block. Everything
heavy — SSR, multi-GB upload writes, ffmpeg supervision, DB writes — lives in
`web`. A 4 GB upload therefore cannot jitter theater sync messages.

The same principle puts video bytes on Caddy: `file_server` uses `sendfile(2)`,
so bytes go page cache → socket without entering userspace, and Node never
competes with video I/O. Throughput is not the binding constraint at this
scale; **tail latency on the realtime path is**, and this protects it.

### Deferred: a third process

When real transcoding ships, the job queue should move to its own process so a
long encode cannot starve SSR. The queue is written as a separate module for
this reason; promoting it is a compose change, not a rewrite.

## Authentication

Caddy's `authentik_auth` snippet already wraps the vhost, so every request —
including the websocket upgrade and every `/media/*` byte range — is
authenticated before the app sees it. The app reads `X-authentik-username` and
upserts a `users` row on first sight. No passwords, sessions, or reset flow.

**This trust model is only safe because `web` and `realtime` are unreachable
except through Caddy.** Neither service may publish a port in the compose file;
they communicate over the internal `proxy` network only. An exposed port would
let anyone set `X-authentik-username` and impersonate any user. This constraint
must be verified at deploy time, not assumed.

The existing Caddyfile block needs `reverse_proxy` targets added, a
`file_server` for `/media/*`, and a `/ws` route. `cloudflare_tls` stays
commented out (the CF token is scoped to `morganmv.net`).

## Ingest and processing

### Paths in

Both converge after step one:

1. **Browser upload** — tus resumable, ~16 MiB chunks, written to `/media/incoming`.
2. **Watched folder** — files dropped into `/media/incoming` by any other means.

### Pipeline

A file in `/media/incoming` is picked up and run through the job queue:

| Job | Does |
|---|---|
| `probe` | `ffprobe` for duration, dimensions, codecs, bitrate |
| `thumbnail` | Single frame → `/media/thumbs/<ulid>.jpg` |
| `remux-faststart` | `ffmpeg -c copy -movflags +faststart` → `/media/clips/<ulid>.mp4` |
| `transcode` | **Registered but not implemented.** Marks the clip `needs_transcode` |

The clip row is created when `probe` runs, at status `pending`, then moves to
`processing` and `ready`.

`remux-faststart` exists because OBS writes the `moov` atom at the *end* of an
`.mp4`. A browser cannot begin playback until it has the `moov`, so without
this step the player downloads the entire clip before showing a frame. This is
the single largest cause of "why is it slow", and it costs seconds per clip
with no quality loss.

`probe` flags anything that is not H.264/AAC as `needs_transcode` rather than
letting it fail silently at play time — HEVC and AV1 do not play in Chrome on
most platforms. When `transcode` is implemented, re-running the queue over
flagged rows heals them with no migration.

Ingest **moves** files out of `/media/incoming`. Because the file leaves the
watch folder, there is no dedup bookkeeping, no inode tracking, and no content
hashing — the filesystem is the queue. `original_filename` is preserved on the
clip row.

ffmpeg concurrency is **1**. Remux is I/O-bound, so parallelism buys nothing,
and serialising means a bulk backlog import cannot saturate the box.

## Playback

Caddy's `file_server` serves `/media/clips` and `/media/thumbs` with native
range support. `/media/incoming` is **not** reachable — half-written files must
never be fetchable.

Filenames are opaque ULIDs. Since every requester has already passed SSO, the
only threat is a friend guessing another friend's URL, and with a shared grid
there is nothing being protected anyway.

**View counts come over the websocket**, not from the byte path — the client
sends `view.start` when playback actually begins. This is more accurate than
server-side counting, which would count thumbnail prefetches as views.

## Realtime layer

One socket per client to `realtime`, routed by Caddy at `/ws`. Identity comes
from the upgrade request's `X-authentik-username`; there is no auth message.

### Envelope

Plain JSON with a short discriminator key.

```ts
// client → server
{ t: "time.sync", t0 }
{ t: "sub", topics: ["grid", "room"] }
{ t: "room.join" } | { t: "room.leave" }
{ t: "room.control", action: "play"|"pause"|"seek"|"setClip", positionMs?, clipId? }
{ t: "room.giveControl", userId } | { t: "room.claimHost" }
{ t: "room.requestControl" }
{ t: "chat.send", text } | { t: "reaction.send", emoji }
{ t: "view.start", clipId }

// server → client
{ t: "hello", userId, serverTime }
{ t: "time.sync", t0, t1 }
{ t: "room", rev, state: RoomState }
{ t: "room.controlRequested", user }   // sent to the host only
{ t: "presence", online: [...], inRoom: [...] }
{ t: "chat", user, text, at } | { t: "reaction", user, emoji }
{ t: "clip.added" | "clip.updated", clip }
{ t: "upload.progress", uploadId, pct, user }
```

The clock handshake is named `time.sync`, not `ping`, because `ws` already uses
protocol-level ping/pong frames for dead-socket detection. Two unrelated
"ping"s guarantees someone debugs the wrong one.

### Topics

Three, subscribed explicitly: `grid` (clip lifecycle, upload progress), `room`
(sync, chat, reactions, room presence), `user` (per-user messages). A client on
the grid does not receive the theater's chat firehose.

### Rules

- **Every `room.*` command is authorized server-side against `hostUserId`.** A
  follower's `room.control` is dropped silently. The client disables controls
  for UX; the client is never the enforcement point.
- **`rev` counter on room state.** Clients ignore state with `rev` ≤ the last
  applied. Without this, a delayed message rewinds everyone's playhead after a
  seek — a bug that only appears under real network conditions.
- **Reconnect delivers a full snapshot**, not a delta. One code path for "get
  current state", used on first load and after every drop. No replay log, no
  gap detection. Backoff with jitter.
- **Backpressure:** past a buffer threshold, drop ephemeral messages
  (reactions, progress ticks) but never room state or chat. A slow client
  degrades; it does not desync.

### web → realtime

Internal `POST /emit` with a shared secret from an env var. This is how a
finished upload or a completed job becomes a `clip.updated` on every grid.

## The theater

One always-on room for the whole site.

### Host model

- First person in becomes host.
- The host may **give control** to any participant. Handoff is immediate with
  no accept prompt — among friends a surprise promotion is funny, and an
  accept/decline round-trip adds a pending state to the protocol for no gain.
- When the host leaves, the room becomes **hostless and pauses**. It does not
  auto-promote. A "Take control" button appears and anyone present may claim it.
- Non-hosts see **visibly disabled** transport controls with a "following
  <name>" label — disabled-and-explained, never hidden. Hidden controls make
  everyone assume the site is broken.
- **Clicking a disabled control requests control.** It sends
  `room.requestControl`, and the host gets a dismissable "sam wants control"
  prompt with a one-click grant. This turns the most likely misclick — poking a
  dead scrubber — into the action the user actually wanted. Requests are
  rate-limited per user and are not queued or persisted; an ignored request
  simply expires from the host's UI.

### Sync algorithm

**Clock offset** — Cristian's algorithm, the basis of NTP/SNTP. Client sends
`t0`, server replies with `t1`, client stamps arrival `t2`:

```
offset = ((t1 - t0) + (t1 - t2)) / 2
rtt    = t2 - t0
```

Take five samples and **keep the offset from the lowest-RTT sample** — lowest
RTT means least queuing distortion, where a median would average in bad
samples. Re-sample every 30s.

**Room state** is held in memory by `realtime` and is the sole authority:

```ts
{ clipId, hostUserId, paused, positionMs, anchorServerTime, rev }
```

`positionMs` is the playhead as of `anchorServerTime`. Each client computes:

```
serverNow = Date.now() + offset
target    = paused ? positionMs : positionMs + (serverNow - anchorServerTime)
```

**The server stamps `anchorServerTime` with its own clock** on receipt, never
from a client-supplied timestamp. A client with a wrong or dishonest clock
cannot corrupt the room.

**Drift correction**, evaluated on followers every 500 ms:

| Drift | Action |
|---|---|
| < 150 ms | Nothing — correcting here is more disruptive than the error |
| 150–750 ms | Nudge `playbackRate` to 0.95 / 1.05 until drift < 50 ms, then 1.0 |
| > 750 ms | Hard `currentTime` seek |

The middle band is what makes sync feel smooth rather than jumpy. Set
`preservesPitch = true` explicitly rather than relying on the browser default —
it is why a ±5% nudge is inaudible.

**Host-only control removes whole categories of problem:** no conflict
resolution, no last-write-wins, no seek wars, and no echo suppression, because
followers never send control messages.

**Buffering:** a stalled follower falls behind and seeks forward to catch up on
resume. **The group never waits for the slowest viewer** — the alternative lets
one person on bad wifi hold the room hostage. Show a brief "resynced" toast so
it does not read as a glitch.

**Joining and autoplay:** on join the client receives room state, loads the
clip, seeks to target, and calls `play()`. That promise **will** reject under
browser autoplay policy without a user gesture, so the join path always handles
rejection with a "Tap to sync" button. This is what breaks on iOS otherwise,
and it is why joining is a deliberate click rather than automatic on page load.

### Implementation boundary

Sync lives behind a `SyncController` interface — `attach(video)`,
`applyRoomState(state)`, `detach()`. Hand-rolled rather than using `timingsrc`,
because a TimingObject models velocity, acceleration and timeline ranges for a
general case we do not have; it does not provide transport; and threshold
tuning needs to be direct. The interface means swapping to `timingsrc` later is
one module.

## UI

### App shell

A **persistent dock** pinned to the bottom of every page, showing what the
theater is playing. This was chosen over a separate `/theater` route (invisible
— an always-on room nobody can see is a dead room) and over theater-as-homepage
(a large empty box whenever nobody is watching).

The dock has three states:

1. **Idle** — one thin muted line. Nothing to dismiss.
2. **Advertising** (playing, you have not joined) — clip title, host, watcher
   count, position, a **Join** button, and a **×**.
3. **Joined** — your transport controls and sync indicator. **No ×.** The exit
   is **Leave**, which removes you from presence. Hiding your own controls
   while still synced to someone else's playhead is a bug wearing a feature's
   clothes.

**Dismissal:** `×` collapses the dock to a small live badge in the header
(`▶ 3`) that keeps counting but stays silent. It **never auto-expands**. The
badge **pulses briefly** on new activity (a new clip, someone joining). Dock
dismissal is per-user browser state in `localStorage` — no schema, nothing to
sync. The pulse is behind a single flag so it can be removed if it grates.

### Expanded theater

Default is a **tabbed right sidebar** (Chat / Watching), which keeps presence
legible and gives the handoff buttons somewhere to live. A control in the
player switches to **fullscreen with chat overlaid** on the video.

**The fullscreen target must be the theater container, not the `<video>`
element.** The Fullscreen API renders only the fullscreened element and its
descendants, so fullscreening the video makes overlaid chat, reactions, and
custom controls impossible. The video and the overlay must both be children of
the fullscreened div. Getting this wrong cannot be fixed later without
restructuring the component tree.

Consequences to handle: `Escape` exits fullscreen, so the chat input must not
swallow it; and the overlay chat auto-hides so it does not sit on the gameplay
permanently.

### Grid

Responsive card grid, newest first. Clips in flight render as placeholder cards
driven by `upload.progress`; real cards animate in on `clip.added` and update
in place on `clip.updated`. Total disk usage is surfaced in the UI; there are no
quotas.

**Filtering is by clicking metadata, not by a filter bar.** Clicking a tag, a
game, a participant, or an uploader anywhere in the UI filters the grid to it;
active filters render as removable chips above the grid. This costs almost no
UI, is discoverable without explanation, and extends to any field added later
for free. A dedicated filter bar can come later if the click affordance turns
out not to be enough.

Filters are URL state (`/?tag=ace&game=valorant`), so a filtered grid is
linkable and survives reload.

## Data model

SQLite via Drizzle.

```
users              id, authentik_username (unique), email, display_name,
                   avatar_url, created_at, last_seen_at

clips              id (ULID), title, original_filename, uploader_id,
                   game_id, status, duration_ms, width, height,
                   video_codec, audio_codec, size_bytes, recorded_at,
                   thumb_path, error_message, created_at

media_files        id, clip_id, kind, path, container, video_codec,
                   audio_codec, width, height, bitrate, size_bytes,
                   is_default, created_at

games              id, name, slug
tags               id, name (unique)
clip_tags          clip_id, tag_id            (PK both)
clip_participants  clip_id, user_id           (PK both)

comments           id, clip_id, user_id, body, position_ms (nullable),
                   created_at, deleted_at
views              id, clip_id, user_id, started_at
jobs               id, clip_id, type, status, attempts, last_error,
                   created_at, started_at, finished_at
```

`clips.status`: `pending → processing → ready`, with `needs_transcode` and
`failed` as terminals. Every transition emits `clip.updated`, which is what
animates the grid.

There is deliberately **no `uploading` status**, because the clip row does not
exist until the upload completes. An in-flight upload is represented only by
ephemeral `upload.progress` messages on the `grid` topic, which the UI renders
as a placeholder card. The card is replaced by a real one on `clip.added`.

`media_files` is the "N renditions, MVP has one" table — a single
`kind: 'original'` row today. Transcoding adds rows rather than altering
anything; `is_default` selects what the player receives.

`comments.position_ms` is nullable and unused at MVP. It exists so
playhead-anchored comments become a UI change with no migration.

**There is no `upload_sessions` table.** `tus-node-server` keeps its own
resumable state on disk; duplicating it into SQLite creates two sources of
truth that disagree after a crash. The clip row is created when the upload
*completes*. In-flight progress goes from tus's `POST_RECEIVE` hook straight to
`/emit` and is never persisted — progress stale by the time you read it is not
worth a table.

**Indices:** `clips(created_at DESC)`, `clips(status)`, `clip_tags(tag_id)`,
`clip_participants(user_id)`, `comments(clip_id, created_at)`,
`jobs(status, created_at)`.

## Storage layout

```
/media
  /incoming/           ← tus writes here; watched folder drops here
  /clips/<ulid>.mp4
  /thumbs/<ulid>.jpg
```

Bind-mounted into `web` (read/write) and into Caddy (read-only, `/clips` and
`/thumbs` only).

## Error handling

- **Job failures** set `clips.status = 'failed'` with `last_error` on the job
  row, surfaced in the UI. Clips never sit silently in `processing`.
- **Retries** use `jobs.attempts` with a cap; exhausted jobs are terminal and
  visible.
- **Socket drops** reconnect with jittered backoff and re-request a snapshot.
- **Upload interruption** is handled by tus resume; orphaned incomplete uploads
  are swept on an expiry.
- **Missing media file** for a `ready` clip renders a broken-clip state rather
  than a dead `<video>`.
- **Autoplay rejection** always falls back to a "Tap to sync" affordance.

## Testing

- **Unit:** the clock-offset math and the drift-band decision function are pure
  functions and get tested directly — including adversarial inputs (negative
  offset, huge RTT, `rev` going backwards).
- **Unit:** job state machine transitions, including failure and retry paths.
- **Integration:** ingest end-to-end against small real fixture files — a
  non-faststart MP4 (verify `moov` moves to the front), an HEVC file (verify it
  is flagged `needs_transcode`), and a corrupt file (verify `failed`).
- **Integration:** websocket authorization — a non-host `room.control` must be
  dropped; a stale `rev` must be ignored; `room.requestControl` must reach only
  the host and must be rate-limited.
- **Manual:** two browsers joining the theater, seeking, host handoff, host
  leaving, and one client throttled to verify catch-up behaviour.

Sync quality is not meaningfully unit-testable end-to-end; the pure functions
are tested and the integrated behaviour is verified manually against a
throttled client.

## Implementation sequencing

This MVP is large enough that it should land in milestones, each independently
deployable and useful. Suggested order, for the implementation plan to refine:

1. **Skeleton + auth + deploy.** Next 16 app, Authentik header trust, user
   upsert, the two-process split, Dockerfile, CI/release workflows, compose
   folder, Caddyfile routes. Ends with an empty but real site on the domain.
2. **Storage and pipeline.** Schema, job queue, `probe` / `thumbnail` /
   `remux-faststart`, watched-folder ingest, Caddy `file_server`. Ends with
   clips dropped on disk appearing in a static grid and playing.
3. **Uploads.** tus endpoint, upload UI. Ends with the browser path working.
4. **Realtime.** Socket layer, envelope, topics, presence, live grid updates,
   live upload progress. Ends with the site feeling live.
5. **Theater.** Room state, `SyncController`, dock, expanded view, host
   handoff, fullscreen overlay. Ends with watch-together working.
6. **Social.** Comments, reactions, theater chat, tags, participants, games,
   click-to-filter, disk usage.

Milestone 4 is the riskiest and milestone 5 depends on it, so the socket layer
should not be rushed to reach the theater.

## Deployment

Follows the existing house pattern:

- Source repo with `.github/workflows/release.yml` firing on `v*` tags,
  building with `docker/build-push-action@v6`, pushing to
  `samikool/clips:<version>` and `:latest`. A `ci.yml` does a plain
  `docker build` on push/PR to `master` and `dev`.
- A compose folder in `~/git/containers` that **pulls** the published image
  (`image: samikool/clips`) rather than building locally. Two services from the
  one image, differing by `command`. Driven by `./do.sh start|stop|update|recreate`.
- Joins the external `proxy` network. **Neither service publishes a port.**
- Named volumes are external.
- Multi-stage bun Dockerfile, `output: "standalone"`, ffmpeg and ffprobe in the
  runtime layer.

The Caddyfile block at `~/git/containers/caddy/Caddyfile` gains `reverse_proxy`
targets, a `file_server` for `/media/*`, and a `/ws` route, keeping
`import authentik_auth` and leaving `cloudflare_tls` commented out.

## Verification notes

Next 16 and Tailwind 4 are current as of this date (`next@16.3.5`,
`react@19.3.0`, `tailwindcss@4.3.3`); grabarr is on Next 15 / Tailwind 3, so
config does **not** port between the two repos. Tailwind 4 uses CSS-first
`@theme` configuration with no `tailwind.config.js`.

Next 16 `output: "standalone"` behaviour and custom-server specifics must be
verified against current documentation during implementation rather than
assumed.

# Deploying milestone 1

The application half of milestone 1 is built and reviewed. What remains is
infrastructure, which touches services outside this repo — Cloudflare DNS, the
router, the shared Caddy instance, and Authentik. Do these in order; several
steps fail in confusing ways if done out of sequence.

Full step-by-step detail lives in
`docs/superpowers/plans/2026-09-21-milestone-1-skeleton-auth-deploy.md`
(Tasks 8–11). This file is the condensed checklist plus the traps found while
building.

## Blockers found during planning

Three things would have broken this deployment and are not obvious:

1. **`auth.morganmv.net` resolves to `192.168.3.54`.** Every other service on
   the box is LAN-only. When an external friend hits `clips.oneroomgaming.com`,
   `forward_auth` redirects them to the Authentik login page — which, for them,
   resolves to a private address that goes nowhere. **The SSO gate that is the
   entire login system is unreachable from outside the LAN.** Hence
   `auth.oneroomgaming.com` below.

2. **The `authentik_auth` Caddy snippet forwards no headers.** It authenticates
   but does not `copy_headers`, so `X-Authentik-Username` never reaches any app.
   The clips app cannot identify anyone until this is added. It is additive and
   safe for existing services — they ignore headers they do not read.

3. **Authentik's existing Proxy Provider sets its cookie on `morganmv.net`**,
   which cannot issue a session valid for `oneroomgaming.com`. A second Proxy
   Provider is required regardless of anything else.

## Order of operations

### 1. Before the first release tag

```bash
git branch dev && git push -u origin dev
```

`release.yml` backmerges into `dev` as its final step, **after** the image push
and the GitHub release. If `dev` is missing, the image publishes and then the
workflow reports failure. The step is now `continue-on-error`, so this is
cosmetic rather than fatal — but create `dev` anyway.

Also set repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`.

### 2. Publish the image

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Produces `samikool/clips:v0.1.0` and `:latest`. **The tag carries the `v`
prefix** — `GITHUB_REF_NAME` yields `v0.1.0`, matching every other `samikool/*`
image published from `~/git/stream-grabber`. The release is now gated on a
passing test run.

### 3. Ingress — DNS and ports

Current public IP: `curl -s https://api.ipify.org`

In Cloudflare, for `oneroomgaming.com`:

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `clips` | public IP | **DNS only (grey cloud)** |
| A | `auth` | public IP | **DNS only (grey cloud)** |

Remove the existing proxied `clips` record first — it currently points at
Cloudflare anycast (`104.21.66.194`, `172.67.163.234`).

Grey cloud is deliberate: proxying would put Cloudflare on the video byte path,
impose a 100 MB request-body cap, and route heavy media through a plan that does
not permit it. Note the tus chunk size (16 MiB) stays under that cap either way.

Then forward TCP **80 and 443** to `192.168.3.54`. Port 80 is required — it is
how Caddy completes the ACME HTTP-01 challenge, and DNS-01 is unavailable
because the Cloudflare API token is scoped to `morganmv.net`.

> **Risk: a dynamic public IP breaks this on renewal.** There is no DDNS, and
> the CF token cannot update `oneroomgaming.com` records. If the IP is not
> static, resolve that first — static IP, a second CF token scoped to this
> domain driving a DDNS updater, or a Cloudflare Tunnel.

> **Exposure note:** forwarding these ports makes every vhost in the Caddyfile
> reachable by `Host:` header, not only these two. Vhosts importing
> `private_only` stay protected by source IP. Six do not — `bazarr`, `grabarr`,
> `mealie`, `seerr`, `radarr`, `sonarr` — and become internet-reachable but
> still SSO-gated. This was accepted as out of scope; locking them down is a
> one-line-each follow-up, with the caveat that `private_only` allows only
> `192.168.0.0/16` and `172.19.0.0/16`, not Tailscale's `100.64.0.0/10`.

### 4. Compose stack

Create the external volume and the env file, then start:

```bash
docker volume create clips-data
mkdir -p "$CLIPS_MEDIA_DIR"/{clips,thumbs,incoming}
cd ~/git/containers && ./do.sh start clips
```

`~/git/containers/clips/.env` needs `EMIT_SECRET` (generate with
`openssl rand -hex 32`), `CLIPS_MEDIA_DIR` and `CLIPS_ADMINS`.

`CLIPS_ADMINS` is a comma-separated list of `authentik_username` values
allowed to delete clips. It is read by `web` only; `realtime` never
authorizes a deletion. **Unset means nobody is an admin** and the Select
button does not render — deletion fails closed, so a forgotten variable
disables the feature rather than opening it. Changing the list is a compose
change plus a container recreate, deliberately: the admin set is
configuration, not data, and nothing hand-edits production SQLite.

Set it in **both** stacks' `.env`. Staging and production have separate
files, and an admin on one is not an admin on the other.

> **`CLIPS_MEDIA_DIR` must be identical in `clips/.env` and `caddy/.env`.** If
> they diverge, Caddy serves an empty directory while the app writes elsewhere,
> and the symptom is "videos 404" rather than "config mismatch."

> **Neither service may publish a port.** Both trust `X-Authentik-*` headers,
> which is only safe because they are unreachable except through Caddy. A
> published port lets anyone on the network set those headers and become any
> user. Verify with
> `docker ps --filter name=clips --format '{{.Names}}: {{.Ports}}'` — the ports
> column must be empty.

The realtime service now **refuses to start** if `EMIT_SECRET` is unset, rather
than booting healthy and silently rejecting every `/emit`. If the container
crash-loops, read its logs first.

### 5. Caddy

Three edits to `~/git/containers/caddy/`:

- Add `copy_headers X-Authentik-Username X-Authentik-Groups X-Authentik-Email X-Authentik-Name X-Authentik-Uid`
  to the `forward_auth` block in the `(authentik_auth)` snippet.
- Add an `auth.oneroomgaming.com` vhost reverse-proxying `authentik-server:9000`,
  with no `private_only` and no `authentik_auth`.
- Fill in the `clips.oneroomgaming.com` vhost: `import authentik_auth` first,
  then a `route` containing `handle` blocks for `/media/clips/*`,
  `/media/thumbs/*`, `/ws*` → `clips-realtime:3001`, and a catch-all →
  `clips-web:3000`. Mount the media dir into Caddy read-only at `/srv/media`.

`/media/incoming/*` is deliberately **not** served — half-written uploads must
never be fetchable.

**Validate before reloading. This file fronts every service on the box.**

```bash
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy adapt --config /etc/caddy/Caddyfile --pretty | grep -A 5 "clips.oneroomgaming.com"
```

The auth handler must appear **before** the `file_server` and `reverse_proxy`
handlers. If it does not, auth is being bypassed — stop.

### 6. Authentik

- New **Proxy Provider**, mode *Forward auth (domain level)*, Authentication URL
  `https://auth.oneroomgaming.com`, **cookie domain `oneroomgaming.com`**. That
  last field is the one that silently breaks everything if wrong.
- New Application `Clips`, bound to that provider.
- Add the provider to the embedded outpost. If that outpost cannot serve two
  hostnames with different cookie domains in your Authentik version, create a
  second outpost pointed at `https://auth.oneroomgaming.com`.

### 7. Verify

From a private window, **off the LAN**:

1. `https://clips.oneroomgaming.com` → redirects to `auth.oneroomgaming.com`
2. Log in → redirected back, page reads **"Signed in as &lt;your name&gt;"**
3. Confirm the row landed:
   ```bash
   docker exec clips-web bun -e "const {Database}=require('bun:sqlite');const db=new Database('/data/clips.db');console.log(db.query('SELECT id, authentik_username FROM users').all());"
   ```
4. **The important one** — websocket auth, from the browser console:
   ```js
   const ws = new WebSocket(`wss://${location.host}/ws`);
   ws.onmessage = (e) => console.log("message:", e.data);
   ws.onclose = (e) => console.log("closed:", e.code);
   ```
   Expect `{"t":"hello","username":"...","serverTime":...}`.

   If the socket closes with 401, Caddy is not forwarding auth headers on
   upgrade requests, and the realtime design needs revisiting **before**
   milestone 4 builds presence, chat and playback sync on top of it. This is why
   it is verified now, while fixing it is cheap.

## Known follow-ups

Deferred deliberately, with reasons, none blocking:

- **Container runs as root.** Pin this to milestone 2: once `clips-data` and the
  media mount hold root-owned files, switching to `USER bun` means chowning live
  data. M2 is when the media mount lands and the uid question must be answered
  anyway.
- **No deploy-time assertion that ports stay unpublished.** The spec calls this
  the one load-bearing constraint of the trust model, and nothing in the repo
  can enforce it. A check in `do.sh` or a CI lint over `clips.yml` would close
  the loop.
- **Migrations run lazily on first request**, so a bad migration surfaces as a
  500 on a page rather than a container that fails to start.
- **`realtime` has no dev-auth fallback**, so local websocket development from
  milestone 4 needs either the fallback lifted into `src/lib/auth.ts` behind the
  same `NODE_ENV` guard, or a local Caddy.
- **`Hub` has no topics or backpressure** — correct for milestone 1, but the
  spec requires both before milestone 4.
- **Six vhosts lack `private_only`** (see the exposure note above).

## Milestone 4 verification (2026-09-24)

The realtime layer was verified end to end against a running stack. Recorded
because two of these legs had never run before.

**`EMIT_SECRET` worked for the first time.** It has been configured since
milestone 1 and nothing in `web` had ever called `POST /emit`. A real socket
subscribed to `grid`, a file was dropped into `incoming/`, and the socket
received, in order:

```
clip.added    pending     "live test"
clip.updated  processing  "live test"
clip.updated  processing  "live test"
clip.updated  ready       "live test"
```

No polling anywhere in that path.

**Realtime being down degrades rather than breaks.** With the service killed,
the page still served 200, a newly dropped clip still ingested and processed
to `ready`, and `web` logged `realtime: publish failed (...)` warnings with
**zero** unhandled rejections and zero 500s. Publishing is genuinely
fire-and-forget, not a new hard dependency on the pipeline.

**Not verified here: the `/ws` proxy hop in local dev.** Local dev went
through a Caddy on :3000 at the time, which this session could not reload.
That proxy has since been removed entirely — see "Running the dev stack"
below. Production was never affected: the `clips.oneroomgaming.com` vhost has
routed `/ws*` to `clips-realtime:3001` since milestone 1.

### Running the dev stack with realtime

Superseded — see "Running the dev stack (no Caddy needed)" below.

### Milestone 5 — the theater

Verified on 2026-09-24 against the dev stack.

**Verified by driving the live realtime service with three real identities
over real sockets** (script pattern kept in the milestone 5 plan; it connects
with distinct `X-Authentik-Username` headers and asserts on transitions):

- First person in became host; the room stayed paused with no clip.
- `presence.inRoom` tracked both members.
- Host set a clip: title and duration arrived on the wire, `paused=false`.
- **A follower's `room.control` was dropped in silence** — `rev` advanced by
  exactly one across the follower's pause and the host's seek, so the pause
  produced no snapshot at all.
- `room.controlRequested` reached the host alone; a bystander subscribed to
  `room` never saw it.
- A second request inside `REQUEST_CONTROL_COOLDOWN_MS` produced nothing.
- Handoff did not interrupt playback (`paused` stayed false).
- Host socket dropped: room went hostless and paused, and the playhead froze
  at 1804 ms — 304 ms of real wall-clock time past the 1500 ms seek, which is
  the freeze computing against the server's own clock rather than the anchor.
- Another member then claimed the empty chair.

**Verified by request:**

- `/`, `/theater`, `/upload`, `/changelog` all served 200 **with the realtime
  service stopped**, the dock rendered its idle state, the theater said
  "Nothing is playing", and the Next log showed no unhandled rejection and no
  500 across 39 subsequent requests.
- The realtime process still boots standalone (`bun src/realtime/index.ts`),
  proving the Room dragged no `web` imports across the process boundary.

**NOT verified — needs a browser, which this session had none:**

- One socket per tab. The refactor is in place and the server side is tested,
  but `/healthz` only ever read `sockets: 0` here because nothing opened a tab.
- Dock click behaviour: Join, Leave, × collapsing to the badge, and the pulse.
- Follower clicking a greyed-out control actually sending the request (the
  `readOnly`-not-`disabled` scrubber is the load-bearing detail).
- Fullscreen putting the watching list **over** the video, the overlay
  auto-hiding after 3 s, and Escape returning the button to "Fullscreen".
  The DOM nesting was checked statically: the `<video>` and the overlay panel
  are both descendants of the element passed to `requestFullscreen()`.
- Observed drift between two real players.

Room state is in memory and is **lost on every realtime restart**, by design.
A deploy that recreates the realtime container empties the theater; whoever is
watching is dropped back to a hostless, empty room and rejoins.

### Milestone 6 — social

Verified on 2026-09-24 against the dev stack. **No migration** — the whole
social schema (`tags`, `clip_tags`, `clip_participants`, `comments`, `views`,
`games`) landed in milestone 2 and had been sitting unused.

**Verified by driving the live realtime service with four identities over real
sockets:**

- A chat message reached the other socket with the right author.
- A burst of five from one user delivered **0** — that user's cooldown had
  already been spent by the preceding message, which is the rule working. The
  unit test covers the from-cold case, where a burst of five delivers 1.
- A reaction fanned out with its author; an emoji outside the allowlist was
  ignored entirely.
- A latecomer subscribing to `room` received `chat.backlog` containing the
  message sent before it connected.
- A socket subscribed only to `grid` never saw a chat frame.

**Verified end to end through the database and `/emit`:**

- A comment persisted to SQLite and its `comment.added` frame reached a `grid`
  subscriber with the matching `clipId`.
- Setting tags and a game rendered chips on the clip page linking to
  `/?tag=…` and `/?game=…`.
- Filtering narrows correctly: 3 cards unfiltered, 1 for `?tag=ace`, 1 for
  `?game=valorant`, 0 for a combination matching nothing.
- `live` flips to `false` on every filtered view, so a new clip cannot pop
  into a grid it does not match.
- A card footer renders `href="/?game=valorant"` and following it narrows the
  grid — click-to-filter works from cards, not just the clip page.
- Disk usage renders ("53.8 KB stored").

**Verified by request, with the realtime service stopped:**

- `/`, `/theater`, `/upload`, `/changelog`, `/?tag=ace` and `/clips/<id>` all
  served 200.
- A comment posted with realtime down still saved, and `announceComment` did
  not throw.
- Zero unhandled rejections in the Next log. (Three 500s appear earlier in
  that log, from a transient mid-edit window during milestone 5 when
  `/theater/page.tsx` existed before its component did; ~100 clean requests
  follow them.)

**NOT verified — needs a browser, which this session did not have:**

- The chat composer, and Escape blurring it rather than being swallowed
  (Escape is how the browser leaves fullscreen).
- Reactions actually floating up over the video, and the reduced-motion
  fallback.
- The Edit/Done toggle on the metadata panel and the three save forms.
- Comment deletion from the UI, and the optimistic tombstone.
- Filter chips being clicked to remove a filter.

The theater chat backlog is in memory alongside room state and is **lost on
every realtime restart**. A deploy empties both. Comments, tags, games and
participants are in SQLite and survive.


### Clip deletion (0.1.1)

Verified on 2026-09-25 against a scratch copy of the dev database and media
tree, so no real dev clip was destroyed to test this.

**Deletion is permanent and there is no recovery path.** No soft-delete
column, no retention window, no reaper. Once the transaction commits and the
files are unlinked, the clip is gone. The only thing between a misclick and
that is the two-step confirmation in the selection bar.

**Verified by driving a real socket while deleting:**

- A `grid` subscriber received `clip.removed` carrying the deleted id.
- The clip row, and its comments, went with it — 1 comment before, 0 after.
- The published `.mp4` and its `.jpg` thumbnail were both gone from disk.
- With the clip playing in the theater, the room published a fresh snapshot
  with `clipId: null` and `paused: true`, and **kept the host** — nobody is
  ejected from the room, they just land on an empty stage.

**Verified by request:**

- With `CLIPS_ADMINS=localdev`, `/` renders the Select button.
- With `CLIPS_ADMINS` unset, `/` serves 200 and renders **no** Select button.
- With realtime stopped, deletion still committed and unlinked the files,
  `publish` logged one `realtime: publish failed (clip.removed)` warning, and
  there were **zero** unhandled rejections.
- `/`, `/theater`, `/upload` and `/changelog` all served 200 with realtime
  down and the library empty.
- `totalDiskBytes` fell from 52048 to 0 as the last clip went. The disk
  figure needs no separate bookkeeping — it sums `clips.size_bytes`.

**Verified by unit test rather than by hand:**

- `deleteClipCascade` against a clip holding all six child row types. Worth
  noting that the pre-existing `deleteClip` could never have done this: with
  `PRAGMA foreign_keys = ON` and no `onDelete` on any FK, it raises FOREIGN
  KEY constraint failed for any clip that has been through the pipeline. It
  had one caller, a test, which deleted a childless clip.
- Deleting a clip whose job is mid-flight is safe: every handler ignores the
  row returned by `applyProbe`/`setClipStatus`/`setClipThumb`, so those
  updates become no-ops against zero rows, `failJob` already guards on a
  missing job, and `announceClipUpdated` returns early. Worst case is one
  logged job error. This matters because deleting `failed` and
  `needs_transcode` clips is the main use for the feature.

**NOT verified — needs a browser, which this session did not have:**

- Entering and leaving select mode, and the card tiles becoming buttons
  rather than links while selecting.
- The two-step confirmation, and that changing the selection cancels a
  confirmation already on screen.
- A second tab's card vanishing when the first tab deletes it, and the
  selection count staying honest when a selected card disappears.
- The selection bar's stacking against the theater dock (both are fixed to
  the bottom; the bar is z-45, the dock z-40).


## Running the dev stack (no Caddy needed)

Two processes. Next serves everything, including media.

```bash
# 1. realtime — the socket service
DEV_AUTH_USERNAME=localdev EMIT_SECRET=devsecret REALTIME_PORT=3001 \
  bun src/realtime/index.ts

# 2. web — Next, bound externally so another machine can reach it
NEXT_PUBLIC_REALTIME_WS_URL=ws://<this-host>:3001/ws \
DEV_AUTH_USERNAME=localdev EMIT_SECRET=devsecret \
REALTIME_URL=http://127.0.0.1:3001 \
CLIPS_ADMINS=localdev \
  bun --bun next dev -H 0.0.0.0 -p 3002
```

Browse `http://<this-host>:3002`.

### There is no proxy in front of local dev

Port 3000 used to run a `caddy:2` container called `clips-dev-preview`,
bind-mounting `dev/Caddyfile`. **Both are gone.** Next serves everything the
dev stack needs, so the proxy earned nothing and cost three things: a container
to recreate whenever the Caddyfile changed (Docker binds single files by inode,
so a restart re-read nothing), a `dev/` directory that made `dev` ambiguous to
git — `git log master..dev` errors with "ambiguous argument", and silently in a
`&&` chain — and a name one character away from the `clips-dev-*` staging stack.

Fidelity to production is now covered properly by real staging at
dev.clips.oneroomgaming.com, which runs the same image behind the same Caddy
and the same Authentik.

Next covers both jobs the proxy used to do:

- `/media/*` is served by Next from `public/media`, a gitignored symlink to
  `data/media`. Next handles Range requests (verified: `206`), so seeking
  works. Production still uses Caddy's `file_server`, which is the
  load-bearing performance property — bytes never go through Node there.
- The socket connects straight to the realtime process via
  `NEXT_PUBLIC_REALTIME_WS_URL`. Unset in production, where the browser uses
  same-origin `/ws` and Caddy routes it.

Create the symlink once if it is missing:

```bash
ln -sfn ../data/media public/media
```

**Two identities on one machine.** Everything social needs more than one
person. `?user=<name>` on the socket URL overrides the identity, so a second
tab can be someone else:

```
NEXT_PUBLIC_REALTIME_WS_URL=ws://<host>:3001/ws?user=dave
```

Or open a second browser with that env set. The override and the
`DEV_AUTH_USERNAME` fallback are both dead in production: `NODE_ENV=production`
is set in the Dockerfile and in both compose services, and a request with no
`X-Authentik-Username` throws there regardless of what the query string says.

## Staging — dev.clips.oneroomgaming.com

Rolling deployment of the `dev` branch. Design:
`docs/superpowers/specs/2026-09-24-staging-environment-design.md`.

### The flow

```
branch off dev ──▶ merge to dev as feat:/fix:/docs: ──▶ staging (auto, ~60s)
                        │
                        ├─ manual: bump package.json + content/changelog/<v>.md
                        └─ tag v0.2.0 on dev ──▶ release.yml
                                                  ├─ verify tag == package.json
                                                  ├─ push :0.2.0 and :latest
                                                  ├─ GitHub release
                                                  └─ fast-forward master
                                                          │
                                        ./do.sh update clips   (manual)
```

**`master` is always exactly what production is running.** `git diff master..dev`
is "on staging, not yet released". The release pushes master **without
`--force`**, so a direct commit to master makes it fail loudly rather than be
clobbered.

There are **no dev tags**. Pushing to `dev` republishes the fixed image tag
`samikool/clips:dev`, overwriting it. Git tags are only ever releases.

### Two stacks

| | production | staging |
|---|---|---|
| folder | `containers/clips` | `containers/clips-dev` |
| image | `samikool/clips:latest` | `samikool/clips:dev` |
| containers | `clips-web`, `clips-realtime` | `clips-dev-web`, `clips-dev-realtime` |
| volume | `clips-data` | `clips-dev-data` |
| media | `/home/sam/clips-media` | `/home/sam/clips-media-dev` |
| updated by | `./do.sh update clips` (manual) | watchtower (60s) |

Production is **never** auto-updated: watchtower only touches containers
carrying `com.centurylinklabs.watchtower.enable=true`, and production has no
such label. Opt-in by label, so a container added later is safe by default.

### Naming

- `clips-dev-web` / `clips-dev-realtime` — **staging**, behind
  `dev.clips.oneroomgaming.com`.
- `clips-web` / `clips-realtime` — **production**.

There was briefly a third, `clips-dev-preview`, one character away from the
staging stack. Removing it was part of why the local proxy went.

### Gotchas

- `CLIPS_DEV_MEDIA_DIR` must be identical in **both** `clips-dev/.env` and
  `caddy/.env` — compose reads `.env` per-folder. A mismatch does not error;
  Caddy just 404s every video while the app reports clips as `ready`.
- The staging Caddy vhost roots media at **`/srv-dev`**, not `/srv`. The app
  emits `/media/clips/<id>` in both environments, so only the root
  distinguishes them. `/srv` there would serve production's video on staging.
- Staging has its **own `EMIT_SECRET`**. Both stacks share the `proxy` network,
  so a shared secret would let a broken staging build inject events into
  production's sockets.
- Staging's room state and chat backlog are wiped on every deploy. In-memory by
  design; just more visible here.

### One-time setup (done)

DNS: `dev.clips.oneroomgaming.com` A record, grey cloud.

Authentik, in the UI:
1. group `clips-dev`
2. Proxy Provider for `https://dev.clips.oneroomgaming.com`, forward-auth
   single application
3. Application bound to it, policy binding to the `clips-dev` group
4. add the provider to the existing `oneroomgaming` outpost

Bound to a **group**, not a user, so inviting a friend to test later is a
membership change with no config edit.

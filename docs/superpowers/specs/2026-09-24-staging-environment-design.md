# Rolling staging environment — design

**Status:** approved in conversation 2026-09-24, not yet implemented.

## Purpose

A staging deployment at `dev.clips.oneroomgaming.com` that always runs the tip
of the `dev` branch, so a change can be exercised against a real deployment —
real Authentik, real Caddy, real containers — before it reaches the friends who
use the site.

Modelled on QEMU's staging branch: an integration branch is continuously
deployed and only promoted once it looks good.

## Success criteria

1. Merging a branch into `dev` puts it on `dev.clips.oneroomgaming.com` within
   about a minute, with no manual step.
2. Staging cannot affect production — not its database, not its media, not its
   realtime sockets.
3. Tagging a version publishes production and leaves `master` exactly equal to
   what production is running.
4. Production is never auto-updated. It moves only when a tag is pushed.

## Branch model

```
feature/fix branch
      │  merged as feat:/fix:/docs: …
      ▼
    dev ──────────────────────────────▶ staging  (automatic, ~60s)
      │
      ├─ manual: bump package.json + add content/changelog/<version>.md
      │
      └─ tag v0.2.0 on dev
                │
                ▼
          release.yml
                ├─ tests
                ├─ verify tag matches package.json
                ├─ push samikool/clips:0.2.0 and :latest
                ├─ GitHub release
                └─ fast-forward master to the tagged commit
                          │
                          ▼
                     production  (manual ./do.sh update clips)
```

**The invariant: `master` is always exactly what production is running.**
`git diff master..dev` is therefore "what is on staging but not released".

`master` only ever advances to a commit that is already on `dev`, so the
release pushes it as a **plain fast-forward with no `--force`**. A direct
commit to `master` would make that push fail, which is the desired outcome —
the invariant is broken and a human should look, rather than have it silently
clobbered.

There is no backmerge step. `master` is never ahead of `dev`, so there is
nothing to merge back. This differs from `samikool/vscode-translate-llm`,
whose workflow backmerges `master` into `dev` because it tags on `master`.

## The two stacks

Both run the same image, built from the same Dockerfile. They differ only in
tag and in what they are wired to.

| | production | staging |
|---|---|---|
| compose folder | `~/git/containers/clips` | `~/git/containers/clips-dev` |
| image | `samikool/clips:latest` | `samikool/clips:dev` |
| containers | `clips-web`, `clips-realtime` | `clips-dev-web`, `clips-dev-realtime` |
| database volume | `clips-data` (external) | `clips-dev-data` (external) |
| media bind mount | `${CLIPS_MEDIA_DIR}` | `${CLIPS_DEV_MEDIA_DIR}` |
| suggested host path | `/home/sam/clips-media` | `/home/sam/clips-media-dev` |
| host | `clips.oneroomgaming.com` | `dev.clips.oneroomgaming.com` |
| `EMIT_SECRET` | production value | **its own distinct value** |
| watchtower label | absent | `com.centurylinklabs.watchtower.enable=true` |
| updated by | `./do.sh update clips` (manual) | watchtower (automatic) |

Neither stack publishes a port. That constraint is load-bearing and unchanged:
both trust `X-Authentik-*` headers injected by Caddy, which is only safe while
they are unreachable except through Caddy.

### Why the data is fully isolated

`createDb()` calls `migrate()` on **every process start**. A staging container
pointed at production's database would apply unreleased migrations to
production automatically, with no prompt and no record. Isolation is not
tidiness here; it is the only safe arrangement.

Staging starts empty. Seeding it is a manual one-off — upload a couple of test
clips through the UI. No seeding script is in scope.

### Why staging gets its own `EMIT_SECRET`

Both stacks share the `proxy` docker network, so `clips-dev-web` can reach
`clips-realtime:3001`. If they shared a secret, a broken staging build could
inject `clip.added` or `chat` events into production's sockets. Distinct
secrets make that impossible rather than merely unlikely.

## Watchtower

New compose folder `~/git/containers/watchtower`, driven by `do.sh` like every
other service.

- `WATCHTOWER_POLL_INTERVAL=60`
- `WATCHTOWER_LABEL_ENABLE=true` — only containers carrying
  `com.centurylinklabs.watchtower.enable=true` are considered
- `WATCHTOWER_CLEANUP=true` — remove superseded images, or every staging build
  accumulates layers on disk
- mounts `/var/run/docker.sock`

**Production carries no label, so watchtower cannot touch it.** Opt-in by
label rather than opt-out by exclusion list: a future container is safe by
default, and forgetting to exclude something cannot cause an unwanted update.

### Rate limits are not a concern

Docker Hub's limit is 100 pulls per 6 hours unauthenticated, 200 authenticated,
per IP. Watchtower checks for new images with **HEAD requests**, and Docker Hub
excludes version checks from the quota — only GETs count. A 60-second poll
therefore costs nothing; a real pull happens only when a new image genuinely
exists, which is when one was pushed anyway.

Watchtower's `--warn-on-head-failure` defaults to warning for registries that
rate-limit the GET fallback, `docker.io` among them. If that warning ever
appears in the logs, HEAD has stopped working and the poll interval needs
raising.

## Authentik

Staging is a separate application in the **same trust domain**, so it reuses
the existing outpost rather than adding another. Friends (clips) and family
(Plex and the rest) remain separate trust domains; nothing about that changes.

Manual steps in the Authentik UI, once:

1. Create a group `clips-dev`, with Sam as the only member initially.
2. Create a Proxy Provider for `https://dev.clips.oneroomgaming.com`,
   forward-auth (single application) mode, same as the production provider.
3. Create an Application bound to that provider, with a policy binding to the
   `clips-dev` group.
4. Add the new provider to the existing `oneroomgaming` outpost.

Binding to a **group** rather than to a user directly is deliberate: inviting a
friend to test later is then a membership change in the UI, with no config edit
anywhere.

## Caddy

A new vhost in `~/git/containers/caddy/Caddyfile`, structurally identical to
the production one — `import authentik_auth_clips` first, then a `route`
containing the `handle` blocks, for the reasons already documented there.

It differs only in upstreams and media root:

- `/ws*` → `clips-dev-realtime:3001`
- everything else → `clips-dev-web:3000`
- `/media/clips/*` and `/media/thumbs/*` → `file_server` with `root * /srv-dev`

The root matters and is easy to get wrong. The app emits
`/media/clips/<id>.mp4` in **both** environments — `clipPublicPath` knows
nothing about which deployment it is in — so the request paths are identical
and only the root can distinguish them. Production mounts
`${CLIPS_MEDIA_DIR}:/srv/media:ro` and roots at `/srv`; staging mounts
`${CLIPS_DEV_MEDIA_DIR}:/srv-dev/media:ro` and roots at `/srv-dev`. Rooting
both at `/srv` would serve production's video on the staging host.

`/media/incoming` stays absent, as in production: half-written uploads must
never be fetchable.

**Editing that file requires `./do.sh recreate caddy`, not `restart`.** Docker
binds single files by inode, so a restart re-reads nothing.

### The env var has to be set twice

`docker compose` reads `.env` from the directory it runs in, so
`CLIPS_DEV_MEDIA_DIR` must be defined in **both** `clips-dev/.env` and
`caddy/.env`, with identical values. `CLIPS_MEDIA_DIR` already works this way,
and `caddy/caddy.yml` carries a comment warning about exactly this. A mismatch
does not error — Caddy simply serves 404s for every video on the staging host
while the app reports the clips as `ready`.

## DNS

`dev.clips.oneroomgaming.com` needs an A record in Cloudflare, proxy disabled
("grey cloud"), matching how `clips` and `auth` are configured.

## CI changes

### `ci.yml`

Add a job that builds and pushes `samikool/clips:dev` on push to `dev` only.
The existing test and plain-build jobs are unchanged and still run on pull
requests.

### `release.yml`

Two changes:

1. **Verify the tag matches `package.json`.** A manual bump invites the mistake
   of tagging `v0.2.0` while `package.json` still says `0.1.0`, which would
   publish a mislabelled image with no warning. The job fails before building.
2. **Replace the backmerge step** with a fast-forward of `master` to the tagged
   commit, pushed without `--force`.

The tag-name-to-image-tag transformation (`${GITHUB_REF_NAME#v}`, so `v0.2.0`
publishes `0.2.0`) already exists and is unchanged.

## Testing

There is nothing unit-testable here — the deliverables are compose files, a
Caddy vhost and workflow YAML. Verification is by exercise:

1. `caddy adapt` accepts the new Caddyfile before recreating the container.
2. `docker compose config` accepts both compose files.
3. Push a trivial commit to `dev`; confirm CI pushes `:dev`, watchtower picks
   it up within ~90s, and `dev.clips.oneroomgaming.com` serves it.
4. Confirm a non-member of `clips-dev` is bounced at login.
5. Confirm production's containers and image digest are **unchanged**
   throughout — this is the property that matters most.
6. Tag a throwaway version on `dev`; confirm the image publishes, `master`
   fast-forwards, and production still does not update until
   `./do.sh update clips` is run by hand.

## Out of scope

- Seeding staging from production data. Manual uploads suffice.
- A self-hosted GitHub runner. Evaluated and rejected: the build is ~2 minutes
  on hosted runners against a 2,000 minute monthly allowance, and a persistent
  runner with Docker socket access is a broadly-privileged service to maintain
  for no gain here.
- Automating the version bump. It is deliberately a human decision.
- Moving the stacks off the shared `proxy` network. Worth doing — any of the 26
  containers on it can reach either app directly and forge identity headers —
  but it is a separate change affecting production, not part of this one.
- Auto-updating production. Production moves on a tag and a deliberate
  `./do.sh update clips`.

## Consequences accepted

- Staging is often broken. That is its job. Only `clips-dev` members see it.
- Staging's room state and chat backlog are lost on every deploy, which with a
  60-second poll means frequently. Room state has always been in-memory by
  design; on staging it is simply more visible.
- Watchtower holds the Docker socket, which is root-equivalent. The cron
  alternative has identical blast radius, so this is not a regression — but it
  is a privileged service and worth knowing about.
- A second media directory and database volume consume disk. Both hold only
  test content.

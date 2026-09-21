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
`openssl rand -hex 32`) and `CLIPS_MEDIA_DIR`.

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

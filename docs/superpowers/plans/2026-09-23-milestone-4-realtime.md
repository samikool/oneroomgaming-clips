# Milestone 4: The Realtime Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The site stops sampling state and starts being told: clips appear and change in the grid live, you can see who else is here, and upload progress is pushed rather than polled.

**Architecture:** `web` mutates SQLite, then fire-and-forgets an event to `realtime` over the existing internal `POST /emit`. `realtime` fans it out to sockets subscribed to the relevant topic. The browser holds one socket and merges events into server-rendered state. Publishing must never block or break a request, and the realtime process must keep doing nothing that can block.

**Tech Stack:** Next 16.3.5, React 19.3.0, TypeScript, bun 1.4.2, `ws` 8.21.3, `@tus/server` 2.4.5, Tailwind 4.3.3.

**Spec:** `docs/superpowers/specs/2026-09-21-clips-site-design.md`

## Global Constraints

- Runtime is **bun 1.4.2**. Tests are `bun test` importing from `"bun:test"`. **No Vitest.**
- No new dependencies. This milestone needs none.
- `src/realtime/*` must **never** import from `next/*`, `src/db/*`, `src/lib/media/*`, `src/lib/jobs/*` or `src/lib/ingest/*`. It is bundled separately by `bun build --target=bun` and must stay tiny: it holds sockets and fans out messages, and **does nothing that can block**. No disk, no database, no ffmpeg.
- **Wire identity is the Authentik username**, never the ULID. The spec is explicit: `realtime` holds no database connection, so it cannot resolve one.
- Every `room.*` message and the `room` topic belong to **milestone 5**. Reserve the topic name; implement nothing for it.
- Tailwind 4 `@theme` token utilities (`bg-surface-raised`, `text-ink`, `text-ink-muted`). Never arbitrary `[var(--color-…)]`.
- Neither container publishes a port; `web` reaches `realtime` at `REALTIME_URL` (already `http://clips-realtime:3001` in the compose file) with `EMIT_SECRET`.
- Suite is **115 tests across 20 files**, all passing; `bun run build` clean. Report real counts, never predicted ones.
- Test output must stay as clean as it is. Known pre-existing noise: `realtime listening on :3099` and `job transcode failed …` from `runner.test.ts`.
- Every task ends with a commit.

## Dev environment — read before running anything

A dev stack is already running and **must be left alone**: Next on port **3002**, a local Caddy on **3000** (`dev/Caddyfile`) which serves `/media/*` off disk and proxies everything else to Next. Browse the site at `:3000`, not `:3002`. An unrelated project's `next-server` (PID 3613202) also runs on this machine — **never use broad `pkill` patterns**; kill only a PID you have identified.

## What already exists

Milestone 1 built `src/realtime/`: an HTTP server with `/healthz` and an `EMIT_SECRET`-guarded `POST /emit`, a `Hub` with untargeted `broadcast`, and an upgrade handler that authenticates from `X-Authentik-Username` and sends `{t:"hello", username, serverTime}`. It has been tested in isolation since milestone 1 and **nothing in `web` has ever called `/emit`** — so `EMIT_SECRET` has never been exercised end to end. Task 11 verifies that explicitly.

## File Structure

```
src/lib/realtime/
  envelope.ts          NEW — message types + topic constants. Pure, shared by both processes.
  envelope.test.ts     NEW
  publish.ts           NEW — web → realtime POST /emit. Fire-and-forget, never throws.
  publish.test.ts      NEW
  client.ts            NEW — browser socket: reconnect, backoff, subscriptions. No React.
  client.test.ts       NEW
  use-realtime.ts      NEW — thin React binding over client.ts
  merge.ts             NEW — pure grid reducer, no React
  merge.test.ts        NEW
src/realtime/
  hub.ts               MODIFY — topic subscriptions + backpressure
  hub.test.ts          MODIFY
  index.ts             MODIFY — `sub` handling, presence, time.sync
  index.test.ts        MODIFY
src/lib/events/
  clips.ts             NEW — emit points: clipAdded / clipUpdated / uploadProgress
  clips.test.ts        NEW
src/components/
  live-grid.tsx        NEW — client wrapper merging events into SSR'd clips
  clip-card.tsx        MODIFY — prop type narrowed to what it reads
  clip-grid.tsx        MODIFY — prop type follows
  presence-bar.tsx     NEW
  upload-panel.tsx     MODIFY — socket instead of polling
src/app/
  page.tsx             MODIFY — render LiveGrid + PresenceBar
  api/clips/[id]/      DELETE — the polling endpoint this milestone retires
```

**Boundary rule:** `envelope.ts` is pure types and constants with no imports, which is what lets both processes share it without dragging anything across the boundary. `publish.ts` runs only in `web`; `client.ts` runs only in the browser; `hub.ts` and `index.ts` run only in `realtime`.

---

### Task 1: The message envelope

**Files:**
- Create: `src/lib/realtime/envelope.ts`, `src/lib/realtime/envelope.test.ts`

**Interfaces:**
- Produces:
  - `const TOPICS = ["grid", "user", "room"] as const`; `type Topic = (typeof TOPICS)[number]`
  - `type ServerMessage` — a discriminated union on `t`
  - `type ClientMessage` — a discriminated union on `t`
  - `type ClipSummary = { id: string; title: string; status: string; thumbPath: string | null; durationMs: number | null; createdAt: number }`
  - `function topicFor(message: ServerMessage): Topic`
  - `function isEphemeral(message: ServerMessage): boolean`
  - `function parseClientMessage(raw: string): ClientMessage | null`

The spec's envelope, minus everything `room.*`. `createdAt` is a number, not a `Date`: this crosses a JSON boundary and a `Date` would silently arrive as a string.

`isEphemeral` is what makes backpressure safe in Task 2 — the spec requires dropping ephemeral messages under pressure but **never** room state or clip lifecycle.

- [ ] **Step 1: Write the failing test**

Create `src/lib/realtime/envelope.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  isEphemeral, parseClientMessage, topicFor, TOPICS,
  type ServerMessage,
} from "@/lib/realtime/envelope";

const clip = {
  id: "01ABC", title: "ace", status: "ready",
  thumbPath: "/media/thumbs/01ABC.jpg", durationMs: 4200, createdAt: 1_700_000_000_000,
};

describe("topicFor", () => {
  it("routes clip lifecycle to the grid topic", () => {
    expect(topicFor({ t: "clip.added", clip })).toBe("grid");
    expect(topicFor({ t: "clip.updated", clip })).toBe("grid");
  });

  it("routes upload progress to the grid topic", () => {
    expect(topicFor({ t: "upload.progress", uploadId: "u1", pct: 40, user: "sam" })).toBe("grid");
  });

  it("routes presence to the grid topic", () => {
    expect(topicFor({ t: "presence", online: ["sam"] })).toBe("grid");
  });

  it("routes per-connection messages to the user topic", () => {
    expect(topicFor({ t: "hello", username: "sam", serverTime: 1 })).toBe("user");
    expect(topicFor({ t: "time.sync", t0: 1, t1: 2 })).toBe("user");
  });
});

describe("isEphemeral", () => {
  it("treats progress and presence as droppable", () => {
    expect(isEphemeral({ t: "upload.progress", uploadId: "u1", pct: 1, user: "sam" })).toBe(true);
    expect(isEphemeral({ t: "presence", online: [] })).toBe(true);
  });

  it("never treats clip lifecycle as droppable", () => {
    expect(isEphemeral({ t: "clip.added", clip })).toBe(false);
    expect(isEphemeral({ t: "clip.updated", clip })).toBe(false);
  });
});

describe("parseClientMessage", () => {
  it("accepts a subscribe message", () => {
    expect(parseClientMessage('{"t":"sub","topics":["grid"]}')).toEqual({
      t: "sub", topics: ["grid"],
    });
  });

  it("accepts a time.sync message", () => {
    expect(parseClientMessage('{"t":"time.sync","t0":123}')).toEqual({ t: "time.sync", t0: 123 });
  });

  it("rejects malformed JSON", () => {
    expect(parseClientMessage("not json")).toBeNull();
  });

  it("rejects an unknown message type", () => {
    expect(parseClientMessage('{"t":"room.control","action":"play"}')).toBeNull();
  });

  it("rejects a subscribe naming an unknown topic", () => {
    expect(parseClientMessage('{"t":"sub","topics":["grid","hacker"]}')).toBeNull();
  });

  it("rejects a subscribe whose topics is not an array", () => {
    expect(parseClientMessage('{"t":"sub","topics":"grid"}')).toBeNull();
  });
});
```

Rejecting `room.control` matters: it is a real message in the spec that this milestone does not implement, and silently accepting it would look like it worked.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/realtime/envelope.test.ts`
Expected: FAIL — the module `@/lib/realtime/envelope` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/realtime/envelope.ts`:

```ts
export const TOPICS = ["grid", "user", "room"] as const;
export type Topic = (typeof TOPICS)[number];

export type ClipSummary = {
  id: string;
  title: string;
  status: string;
  thumbPath: string | null;
  durationMs: number | null;
  createdAt: number;
};

export type ServerMessage =
  | { t: "hello"; username: string; serverTime: number }
  | { t: "time.sync"; t0: number; t1: number }
  | { t: "presence"; online: string[] }
  | { t: "clip.added"; clip: ClipSummary }
  | { t: "clip.updated"; clip: ClipSummary }
  | { t: "upload.progress"; uploadId: string; pct: number; user: string };

export type ClientMessage =
  | { t: "sub"; topics: Topic[] }
  | { t: "time.sync"; t0: number };

export function topicFor(message: ServerMessage): Topic {
  switch (message.t) {
    case "hello":
    case "time.sync":
      return "user";
    default:
      return "grid";
  }
}

export function isEphemeral(message: ServerMessage): boolean {
  return message.t === "upload.progress" || message.t === "presence";
}

function isTopic(value: unknown): value is Topic {
  return typeof value === "string" && (TOPICS as readonly string[]).includes(value);
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const message = parsed as Record<string, unknown>;

  if (message.t === "sub") {
    if (!Array.isArray(message.topics) || !message.topics.every(isTopic)) {
      return null;
    }
    return { t: "sub", topics: message.topics as Topic[] };
  }

  if (message.t === "time.sync" && typeof message.t0 === "number") {
    return { t: "time.sync", t0: message.t0 };
  }

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/realtime/envelope.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/envelope.ts src/lib/realtime/envelope.test.ts
git commit -m "feat: add the realtime message envelope"
```

---

### Task 2: Hub topics and backpressure

**Files:**
- Modify: `src/realtime/hub.ts`, `src/realtime/hub.test.ts`

**Interfaces:**
- Consumes: `Topic`, `ServerMessage`, `topicFor`, `isEphemeral` from Task 1.
- Produces:
  - `type Sendable = { send(data: string): void; readonly bufferedAmount?: number }`
  - `class Hub` with `add(socket, username)`, `remove(socket)`, `subscribe(socket, topics)`, `publish(message: ServerMessage): number`, `get size`, `get online(): string[]`
  - `const MAX_BUFFERED_BYTES = 1_048_576`

`publish` replaces the old untargeted `broadcast`. Two rules from the spec:

1. A socket receives a message only if it subscribed to that message's topic. A client sitting on the grid should not receive the theater's firehose when milestone 5 lands.
2. **Under backpressure, drop ephemeral messages but never clip lifecycle.** A slow client should degrade — miss some progress ticks — not desync by losing the event that says a clip is ready.

`bufferedAmount` is optional on `Sendable` so tests can supply a plain object, and is how a real `ws` socket reports its queue depth.

- [ ] **Step 1: Write the failing test**

Replace the contents of `src/realtime/hub.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { Hub, MAX_BUFFERED_BYTES, type Sendable } from "@/realtime/hub";
import type { ServerMessage } from "@/lib/realtime/envelope";

const clip = {
  id: "01ABC", title: "ace", status: "ready",
  thumbPath: null, durationMs: null, createdAt: 1,
};
const clipAdded: ServerMessage = { t: "clip.added", clip };
const progress: ServerMessage = { t: "upload.progress", uploadId: "u1", pct: 5, user: "sam" };

function fakeSocket(bufferedAmount = 0) {
  const sent: string[] = [];
  return {
    sent,
    socket: { send: (data: string) => sent.push(data), bufferedAmount } satisfies Sendable,
  };
}

describe("Hub", () => {
  it("starts empty", () => {
    expect(new Hub().size).toBe(0);
  });

  it("does not deliver to a socket that subscribed to nothing", () => {
    const hub = new Hub();
    const a = fakeSocket();
    hub.add(a.socket, "sam");

    expect(hub.publish(clipAdded)).toBe(0);
    expect(a.sent).toEqual([]);
  });

  it("delivers only to sockets subscribed to the message's topic", () => {
    const hub = new Hub();
    const grid = fakeSocket();
    const userOnly = fakeSocket();
    hub.add(grid.socket, "sam");
    hub.add(userOnly.socket, "dave");
    hub.subscribe(grid.socket, ["grid"]);
    hub.subscribe(userOnly.socket, ["user"]);

    expect(hub.publish(clipAdded)).toBe(1);
    expect(grid.sent).toHaveLength(1);
    expect(userOnly.sent).toEqual([]);
  });

  it("replaces subscriptions rather than accumulating them", () => {
    const hub = new Hub();
    const a = fakeSocket();
    hub.add(a.socket, "sam");
    hub.subscribe(a.socket, ["grid"]);
    hub.subscribe(a.socket, ["user"]);

    expect(hub.publish(clipAdded)).toBe(0);
  });

  it("drops ephemeral messages to a backed-up socket", () => {
    const hub = new Hub();
    const slow = fakeSocket(MAX_BUFFERED_BYTES + 1);
    hub.add(slow.socket, "sam");
    hub.subscribe(slow.socket, ["grid"]);

    expect(hub.publish(progress)).toBe(0);
    expect(slow.sent).toEqual([]);
  });

  it("still delivers clip lifecycle to a backed-up socket", () => {
    const hub = new Hub();
    const slow = fakeSocket(MAX_BUFFERED_BYTES + 1);
    hub.add(slow.socket, "sam");
    hub.subscribe(slow.socket, ["grid"]);

    expect(hub.publish(clipAdded)).toBe(1);
    expect(slow.sent).toHaveLength(1);
  });

  it("keeps delivering to healthy sockets when one throws, and evicts the thrower", () => {
    const hub = new Hub();
    const healthy = fakeSocket();
    const broken: Sendable = { send: () => { throw new Error("closed"); } };
    hub.add(broken, "broken");
    hub.add(healthy.socket, "sam");
    hub.subscribe(broken, ["grid"]);
    hub.subscribe(healthy.socket, ["grid"]);

    expect(hub.publish(clipAdded)).toBe(1);
    expect(healthy.sent).toHaveLength(1);
    expect(hub.size).toBe(1);
  });

  it("reports distinct usernames as online", () => {
    const hub = new Hub();
    hub.add(fakeSocket().socket, "sam");
    hub.add(fakeSocket().socket, "sam");
    hub.add(fakeSocket().socket, "dave");

    expect(hub.online.sort()).toEqual(["dave", "sam"]);
  });

  it("forgets a username once its last socket goes", () => {
    const hub = new Hub();
    const first = fakeSocket();
    const second = fakeSocket();
    hub.add(first.socket, "sam");
    hub.add(second.socket, "sam");

    hub.remove(first.socket);
    expect(hub.online).toEqual(["sam"]);

    hub.remove(second.socket);
    expect(hub.online).toEqual([]);
  });
});
```

The last two matter: one person with the site open in two tabs is one person, and presence must not claim they left when they close one.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/realtime/hub.test.ts`
Expected: FAIL — `subscribe`, `publish`, `online` and `MAX_BUFFERED_BYTES` do not exist.

- [ ] **Step 3: Implement**

Replace `src/realtime/hub.ts`:

```ts
import { isEphemeral, topicFor, type ServerMessage, type Topic } from "@/lib/realtime/envelope";

export type Sendable = {
  send(data: string): void;
  readonly bufferedAmount?: number;
};

/**
 * Past this queue depth a socket is treated as backed up. Ephemeral messages
 * are dropped for it; clip lifecycle is still delivered, because a client that
 * misses "this clip is ready" never recovers on its own.
 */
export const MAX_BUFFERED_BYTES = 1_048_576;

type Entry = { username: string; topics: Set<Topic> };

export class Hub {
  readonly #sockets = new Map<Sendable, Entry>();

  add(socket: Sendable, username: string): void {
    this.#sockets.set(socket, { username, topics: new Set() });
  }

  remove(socket: Sendable): void {
    this.#sockets.delete(socket);
  }

  subscribe(socket: Sendable, topics: Topic[]): void {
    const entry = this.#sockets.get(socket);

    if (entry) {
      entry.topics = new Set(topics);
    }
  }

  get size(): number {
    return this.#sockets.size;
  }

  get online(): string[] {
    return [...new Set([...this.#sockets.values()].map((e) => e.username))];
  }

  publish(message: ServerMessage): number {
    const topic = topicFor(message);
    const droppable = isEphemeral(message);
    const payload = JSON.stringify(message);
    let delivered = 0;

    for (const [socket, entry] of [...this.#sockets.entries()]) {
      if (!entry.topics.has(topic)) {
        continue;
      }

      if (droppable && (socket.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
        continue;
      }

      try {
        socket.send(payload);
        delivered += 1;
      } catch {
        this.#sockets.delete(socket);
      }
    }

    return delivered;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/realtime/hub.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/realtime/hub.ts src/realtime/hub.test.ts
git commit -m "feat: give the hub topics and backpressure"
```

---

### Task 3: Subscriptions, presence and clock sync in the service

**Files:**
- Modify: `src/realtime/index.ts`, `src/realtime/index.test.ts`

**Interfaces:**
- Consumes: `Hub` (Task 2), `parseClientMessage`, `ServerMessage` (Task 1).
- Produces: a service that handles `sub` and `time.sync` from clients, publishes `presence` on connect and disconnect, and routes `/emit` bodies through `hub.publish`.

Changes to `index.ts`:

1. On `message`, run it through `parseClientMessage`. **Ignore anything that returns `null`** — never throw inside the handler; a malformed frame from one client must not disturb the process.
2. `sub` → `hub.subscribe(ws, topics)`, then immediately send that socket the current `presence` so a fresh subscriber is not blind until the next change.
3. `time.sync` → reply `{t:"time.sync", t0, t1: Date.now()}`, stamping `t1` with the server's clock. Milestone 5's playback sync depends on this; wiring it now costs three lines and means M5 inherits a tested handshake.
4. On connect (after `hello`) and on close, `hub.publish({t:"presence", online: hub.online})`.
5. `/emit` parses the body, validates it is an object with a string `t`, and calls `hub.publish`. Respond `400` if not.

Everything else — the `EMIT_SECRET` guard, the body cap, the 401 on unauthenticated upgrade — stays exactly as it is.

- [ ] **Step 1: Write the failing test**

Append to `src/realtime/index.test.ts`, keeping the existing `/emit` tests:

```ts
import { WebSocket } from "ws";

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(String(data))));
  });
}

function connect(): WebSocket {
  return new WebSocket(`ws://localhost:${PORT}/ws`, {
    headers: { "X-Authentik-Username": "sam" },
  });
}

describe("websocket protocol", () => {
  it("greets a new socket with hello", async () => {
    const ws = connect();
    const hello = await nextMessage(ws);

    expect(hello.t).toBe("hello");
    expect(hello.username).toBe("sam");
    ws.close();
  });

  it("answers time.sync with the server clock", async () => {
    const ws = connect();
    await nextMessage(ws);
    ws.send(JSON.stringify({ t: "time.sync", t0: 111 }));

    const reply = await nextMessage(ws);
    expect(reply.t).toBe("time.sync");
    expect(reply.t0).toBe(111);
    expect(typeof reply.t1).toBe("number");
    ws.close();
  });

  it("sends presence immediately on subscribe", async () => {
    const ws = connect();
    await nextMessage(ws);
    ws.send(JSON.stringify({ t: "sub", topics: ["grid"] }));

    const presence = await nextMessage(ws);
    expect(presence.t).toBe("presence");
    expect(presence.online).toContain("sam");
    ws.close();
  });

  it("delivers an emitted clip event to a grid subscriber", async () => {
    const ws = connect();
    await nextMessage(ws);
    ws.send(JSON.stringify({ t: "sub", topics: ["grid"] }));
    await nextMessage(ws); // presence

    const received = nextMessage(ws);
    await fetch(`http://localhost:${PORT}/emit`, {
      method: "POST",
      headers: { "X-Emit-Secret": "test-secret", "content-type": "application/json" },
      body: JSON.stringify({
        t: "clip.added",
        clip: { id: "01ABC", title: "ace", status: "pending", thumbPath: null, durationMs: null, createdAt: 1 },
      }),
    });

    const message = await received;
    expect(message.t).toBe("clip.added");
    ws.close();
  });

  it("survives a malformed frame without dropping the connection", async () => {
    const ws = connect();
    await nextMessage(ws);
    ws.send("not json at all");
    ws.send(JSON.stringify({ t: "time.sync", t0: 222 }));

    const reply = await nextMessage(ws);
    expect(reply.t0).toBe(222);
    ws.close();
  });

  it("rejects an upgrade with no identity", async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const code = await new Promise<number>((resolve) => {
      ws.on("error", () => resolve(401));
      ws.on("open", () => { ws.close(); resolve(0); });
    });

    expect(code).toBe(401);
  });
});
```

The malformed-frame test is the important one: it proves one client sending junk cannot take down the socket everyone else is on.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/realtime/index.test.ts`
Expected: FAIL — no `time.sync` reply, no presence on subscribe, and the emit is not delivered because nothing subscribes yet.

- [ ] **Step 3: Implement**

In `src/realtime/index.ts`, add the import:

```ts
import { parseClientMessage, type ServerMessage } from "@/lib/realtime/envelope";
```

Replace the body of `handleEmit`'s `try` block with a validated publish:

```ts
  try {
    const parsed: unknown = JSON.parse(await readBody(request));

    if (typeof parsed !== "object" || parsed === null || typeof (parsed as { t?: unknown }).t !== "string") {
      response.writeHead(400, { connection: "close" }).end();
      return;
    }

    const delivered = hub.publish(parsed as ServerMessage);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ delivered }));
  } catch (error) {
```

Replace the `wss.handleUpgrade` callback:

```ts
  wss.handleUpgrade(request, socket, head, (ws) => {
    hub.add(ws, username);
    ws.send(JSON.stringify({ t: "hello", username, serverTime: Date.now() }));
    hub.publish({ t: "presence", online: hub.online });

    ws.on("message", (data) => {
      // A malformed frame from one client must never disturb the process or
      // the other sockets, so parse failures are ignored rather than thrown.
      const message = parseClientMessage(String(data));

      if (message === null) {
        return;
      }

      if (message.t === "sub") {
        hub.subscribe(ws, message.topics);
        // Send this socket presence straight away; otherwise a fresh
        // subscriber sees nobody until the next join or leave.
        ws.send(JSON.stringify({ t: "presence", online: hub.online }));
        return;
      }

      // t1 is stamped with the server's clock. Milestone 5's playback sync
      // computes its offset from this; a client-supplied t1 would be useless.
      ws.send(JSON.stringify({ t: "time.sync", t0: message.t0, t1: Date.now() }));
    });

    const drop = () => {
      hub.remove(ws);
      hub.publish({ t: "presence", online: hub.online });
    };

    ws.on("close", drop);
    ws.on("error", drop);
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/realtime/index.test.ts`
Expected: PASS — the pre-existing `/emit` tests plus 6 new ones.

- [ ] **Step 5: Confirm the boundary still holds**

Run: `grep -rn "next/\|@/db\|@/lib/media\|@/lib/jobs\|@/lib/ingest" src/realtime/`
Expected: no matches. `@/lib/realtime/envelope` is fine — it is pure types and constants.

- [ ] **Step 6: Commit**

```bash
git add src/realtime/index.ts src/realtime/index.test.ts
git commit -m "feat: handle subscriptions, presence and clock sync"
```

---

### Task 4: Publishing from web

**Files:**
- Create: `src/lib/realtime/publish.ts`, `src/lib/realtime/publish.test.ts`

**Interfaces:**
- Consumes: `ServerMessage` (Task 1).
- Produces: `function publish(message: ServerMessage, env?: Partial<NodeJS.ProcessEnv>): Promise<boolean>`

**This function must never throw and never delay a request.** It sits on the path of every upload completion and every job transition. If `realtime` is down, restarting, or slow, the clip must still be created and the job must still complete — the user simply misses a live update. Failure is logged once and swallowed.

It takes a timeout for the same reason: a hung connection to `realtime` must not hold a job handler open.

- [ ] **Step 1: Write the failing test**

Create `src/lib/realtime/publish.test.ts`:

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { publish } from "@/lib/realtime/publish";
import type { ServerMessage } from "@/lib/realtime/envelope";

const clip = {
  id: "01ABC", title: "ace", status: "ready",
  thumbPath: null, durationMs: null, createdAt: 1,
};
const message: ServerMessage = { t: "clip.updated", clip };

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("publish", () => {
  it("posts the message to REALTIME_URL with the emit secret", async () => {
    let seen: { url: string; secret: string | null; body: unknown } | undefined;

    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = {
        url: String(url),
        secret: new Headers(init.headers).get("X-Emit-Secret"),
        body: JSON.parse(String(init.body)),
      };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const ok = await publish(message, {
      REALTIME_URL: "http://realtime:3001",
      EMIT_SECRET: "s3cret",
    });

    expect(ok).toBe(true);
    expect(seen?.url).toBe("http://realtime:3001/emit");
    expect(seen?.secret).toBe("s3cret");
    expect(seen?.body).toEqual(message);
  });

  it("returns false and does not throw when realtime is unreachable", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    expect(await publish(message, {
      REALTIME_URL: "http://realtime:3001", EMIT_SECRET: "s3cret",
    })).toBe(false);
  });

  it("returns false on a non-2xx response without throwing", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;

    expect(await publish(message, {
      REALTIME_URL: "http://realtime:3001", EMIT_SECRET: "s3cret",
    })).toBe(false);
  });

  it("skips silently when EMIT_SECRET is not configured", async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;

    expect(await publish(message, { REALTIME_URL: "http://realtime:3001" })).toBe(false);
    expect(called).toBe(false);
  });

  it("skips silently when REALTIME_URL is not configured", async () => {
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;

    expect(await publish(message, { EMIT_SECRET: "s3cret" })).toBe(false);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/realtime/publish.test.ts`
Expected: FAIL — the module `@/lib/realtime/publish` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/realtime/publish.ts`:

```ts
import type { ServerMessage } from "./envelope";

const TIMEOUT_MS = 2000;

let warned = false;

/**
 * Fire-and-forget a message to the realtime service.
 *
 * This runs on the path of every upload completion and every job transition,
 * so it must never throw and never block for long: if realtime is down or
 * slow, the clip is still created and the job still completes — the user just
 * misses a live update until their next page load.
 */
export async function publish(
  message: ServerMessage,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<boolean> {
  const base = env.REALTIME_URL;
  const secret = env.EMIT_SECRET;

  if (!base || !secret) {
    if (!warned) {
      warned = true;
      console.warn("realtime: REALTIME_URL or EMIT_SECRET unset — live updates are disabled");
    }
    return false;
  }

  try {
    const response = await fetch(`${base}/emit`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Emit-Secret": secret },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    return response.ok;
  } catch (error) {
    console.warn(`realtime: publish failed (${message.t})`, error);
    return false;
  }
}
```

The `warned` flag exists so a deployment with realtime disabled logs once rather than on every single job.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/realtime/publish.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/publish.ts src/lib/realtime/publish.test.ts
git commit -m "feat: publish events from web to realtime"
```

---

### Task 5: Emit points

**Files:**
- Create: `src/lib/events/clips.ts`, `src/lib/events/clips.test.ts`
- Modify: `src/lib/jobs/runner.ts`, `src/lib/ingest/scan.ts`, `src/lib/uploads/server.ts`

**Interfaces:**
- Consumes: `publish` (Task 4), `ClipSummary` (Task 1), `Clip` from `@/db/schema`, `getClip` from `@/db/clips`.
- Produces:
  - `function toSummary(clip: Clip): ClipSummary`
  - `function announceClipAdded(db: Db, clipId: string, env?): Promise<void>`
  - `function announceClipUpdated(db: Db, clipId: string, env?): Promise<void>`

Rather than instrumenting every status setter, announce at the three points where a clip's visible state settles:

| Where | Event | Why there |
|---|---|---|
| `scan.ts` after the ingest transaction commits | `clip.added` | The row and its job exist; the grid can show it as Queued |
| `uploads/server.ts` after `finish()` commits | `clip.added` | Same, for the browser upload path |
| `runner.ts` at the end of `runOnce`, after complete-or-fail | `clip.updated` | Covers every pipeline transition — processing, ready, needs_transcode, failed — in one place |

`announceClipUpdated` re-reads the clip rather than taking a snapshot argument, so it always publishes what the database actually holds after the handler's writes.

**These calls must be awaited but must never fail the operation.** `publish` already swallows its own errors; do not add a `try` around it and do not use `void` — an unawaited promise in a job handler can outlive the process shutdown.

- [ ] **Step 1: Write the failing test**

Create `src/lib/events/clips.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { createClip, setClipStatus } from "@/db/clips";
import { announceClipAdded, announceClipUpdated, toSummary } from "@/lib/events/clips";

let db: Db;
const env = { REALTIME_URL: "http://realtime:3001", EMIT_SECRET: "s3cret" };
const originalFetch = globalThis.fetch;

function captureFetch() {
  const bodies: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return bodies;
}

beforeEach(() => {
  db = createDb(":memory:");
  globalThis.fetch = originalFetch;
});

describe("toSummary", () => {
  it("serialises createdAt as a number for the wire", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    const summary = toSummary(clip);

    expect(typeof summary.createdAt).toBe("number");
    expect(summary.createdAt).toBe(clip.createdAt.getTime());
    expect(summary.id).toBe(clip.id);
  });
});

describe("announceClipAdded", () => {
  it("publishes clip.added with the current row", async () => {
    const clip = createClip(db, { title: "ace", originalFilename: "a.mp4", sizeBytes: 1 });
    const bodies = captureFetch();

    await announceClipAdded(db, clip.id, env);

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ t: "clip.added" });
    expect((bodies[0] as { clip: { title: string } }).clip.title).toBe("ace");
  });
});

describe("announceClipUpdated", () => {
  it("publishes the status as it stands after the write", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    setClipStatus(db, clip.id, "ready");
    const bodies = captureFetch();

    await announceClipUpdated(db, clip.id, env);

    expect((bodies[0] as { clip: { status: string } }).clip.status).toBe("ready");
  });

  it("publishes nothing for a clip that no longer exists", async () => {
    const bodies = captureFetch();

    await announceClipUpdated(db, "01MISSING", env);

    expect(bodies).toEqual([]);
  });

  it("does not throw when realtime is unreachable", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;

    expect(announceClipUpdated(db, clip.id, env)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/events/clips.test.ts`
Expected: FAIL — the module `@/lib/events/clips` cannot be resolved.

- [ ] **Step 3: Implement the announcer**

Create `src/lib/events/clips.ts`:

```ts
import { getClip } from "@/db/clips";
import type { Db } from "@/db/client";
import type { Clip } from "@/db/schema";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { publish } from "@/lib/realtime/publish";

export function toSummary(clip: Clip): ClipSummary {
  return {
    id: clip.id,
    title: clip.title,
    status: clip.status,
    thumbPath: clip.thumbPath,
    durationMs: clip.durationMs,
    // A Date would arrive as a string on the other side of JSON.
    createdAt: clip.createdAt.getTime(),
  };
}

async function announce(
  db: Db,
  clipId: string,
  t: "clip.added" | "clip.updated",
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<void> {
  const clip = getClip(db, clipId);

  if (!clip) {
    return;
  }

  await publish({ t, clip: toSummary(clip) }, env);
}

export function announceClipAdded(
  db: Db,
  clipId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<void> {
  return announce(db, clipId, "clip.added", env);
}

export function announceClipUpdated(
  db: Db,
  clipId: string,
  env?: Partial<NodeJS.ProcessEnv>,
): Promise<void> {
  return announce(db, clipId, "clip.updated", env);
}
```

- [ ] **Step 4: Wire the three call sites**

In `src/lib/jobs/runner.ts`, at the very end of `runOnce` — after the `try`/`catch` that completes or fails the job, immediately before `return true`:

```ts
  await announceClipUpdated(ctx.db, job.clipId, ctx.env);

  return true;
```

In `src/lib/ingest/scan.ts`, after the ingest transaction commits and the id is pushed to `created` — announce each newly created clip before returning. Because the loop body is synchronous, collect the ids and announce after the loop:

```ts
  for (const id of created) {
    await announceClipAdded(ctx.db, id, ctx.env);
  }

  return created;
```

In `src/lib/uploads/server.ts`, after `finish()` has committed the clip and job, announce it. Place the call where the completed clip id is in scope and the transaction has returned; do not put it inside the transaction.

- [ ] **Step 5: Run the full suite**

Run: `bun test`
Expected: PASS. Report the real count. Existing tests that exercise `runOnce`, `scanIncoming` and upload completion now also call `publish`, which returns `false` early because those tests set no `REALTIME_URL` — so they must not gain any network calls or new console noise. **If `publish`'s "live updates are disabled" warning appears in test output, that is a finding**: silence it by having the tests pass an env without those keys, not by removing the warning.

- [ ] **Step 6: Commit**

```bash
git add src/lib/events/ src/lib/jobs/runner.ts src/lib/ingest/scan.ts src/lib/uploads/server.ts
git commit -m "feat: announce clip lifecycle to realtime"
```

---

### Task 6: Upload progress

**Files:**
- Modify: `src/lib/uploads/server.ts`

**Interfaces:**
- Consumes: `publish` (Task 4).
- Produces: `upload.progress` messages while a file is arriving.

`@tus/server` exposes `EVENTS.POST_RECEIVE` (confirmed present in the installed 2.4.5). Subscribe to it and publish `{t:"upload.progress", uploadId, pct, user}`.

**Throttle to at most one message per upload per second.** `POST_RECEIVE` can fire far more often than a person can read, and each message fans out to every connected socket. Progress is ephemeral, so the hub will also drop it for backed-up clients — but that is the safety net, not the design.

- [ ] **Step 1: Confirm the event name in the installed package**

Run: `grep -rn "POST_RECEIVE" node_modules/@tus/server/dist/constants.* node_modules/@tus/server/dist/types.d.ts | head`
Expected: the constant exists. **If the shape differs from what this task assumes, stop and report it rather than guessing** — the surrounding upload code is settled and correct, and a wrong event wiring would be worse than no progress.

- [ ] **Step 2: Write the failing test**

Add to `src/lib/uploads/server.test.ts`:

```ts
describe("upload progress", () => {
  it("publishes at most one progress message per second per upload", async () => {
    const published: Record<string, unknown>[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      published.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const emit = makeProgressEmitter({
        REALTIME_URL: "http://realtime:3001",
        EMIT_SECRET: "s3cret",
      });

      await emit("u1", 10, 100, "sam", 1000);
      await emit("u1", 20, 100, "sam", 1200); // throttled
      await emit("u1", 50, 100, "sam", 2100); // a second later, allowed

      expect(published).toHaveLength(2);
      expect(published[0]).toMatchObject({ t: "upload.progress", uploadId: "u1", pct: 10, user: "sam" });
      expect(published[1]).toMatchObject({ pct: 50 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("always lets a different upload through", async () => {
    const published: Record<string, unknown>[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      published.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const emit = makeProgressEmitter({
        REALTIME_URL: "http://realtime:3001", EMIT_SECRET: "s3cret",
      });

      await emit("u1", 10, 100, "sam", 1000);
      await emit("u2", 10, 100, "dave", 1000);

      expect(published).toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bun test src/lib/uploads/server.test.ts`
Expected: FAIL — `makeProgressEmitter` is not exported.

- [ ] **Step 4: Implement**

Add to `src/lib/uploads/server.ts` — the throttle is a factory so the test can drive it with an explicit clock instead of sleeping:

```ts
const PROGRESS_INTERVAL_MS = 1000;

/**
 * POST_RECEIVE fires far more often than anyone can read, and every message
 * fans out to every connected socket. One per upload per second is plenty.
 */
export function makeProgressEmitter(env: Partial<NodeJS.ProcessEnv> = process.env) {
  const lastSent = new Map<string, number>();

  return async function emitProgress(
    uploadId: string,
    offset: number,
    size: number,
    user: string,
    now: number = Date.now(),
  ): Promise<void> {
    const previous = lastSent.get(uploadId) ?? -Infinity;

    if (now - previous < PROGRESS_INTERVAL_MS) {
      return;
    }

    lastSent.set(uploadId, now);
    const pct = size > 0 ? Math.round((offset / size) * 100) : 0;
    await publish({ t: "upload.progress", uploadId, pct, user }, env);
  };
}
```

Then wire it to the tus server's `POST_RECEIVE` event where the server instance is constructed, reading the owner from the upload's metadata. Remove the entry from `lastSent` when an upload finishes so the map cannot grow without bound across a long-lived process.

- [ ] **Step 5: Run the tests**

Run: `bun test src/lib/uploads/`
Expected: PASS, including the pre-existing upload tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/uploads/server.ts src/lib/uploads/server.test.ts
git commit -m "feat: publish throttled upload progress"
```

---

### Task 7: The browser socket

**Files:**
- Create: `src/lib/realtime/client.ts`, `src/lib/realtime/client.test.ts`, `src/lib/realtime/use-realtime.ts`

**Interfaces:**
- Consumes: `ServerMessage`, `Topic`, `ClientMessage` (Task 1).
- Produces:
  - `type RealtimeClient = { subscribe(topics: Topic[]): void; on(handler: (m: ServerMessage) => void): () => void; close(): void }`
  - `function createRealtimeClient(options: { url: string; topics: Topic[]; socketFactory?: (url: string) => SocketLike; now?: () => number }): RealtimeClient`
  - `function backoffDelay(attempt: number, random?: () => number): number`
  - `function useRealtime(topics: Topic[], handler: (m: ServerMessage) => void): void`

`client.ts` holds no React so its reconnect logic is testable with a fake socket. `use-realtime.ts` is the thin React binding.

**Reconnect is backoff with jitter, and every reconnect re-subscribes.** The spec requires a full snapshot on reconnect rather than a delta — here the page's server-rendered data is that snapshot, so re-subscribing plus a fresh `presence` is sufficient. Jitter matters because a realtime restart disconnects everyone simultaneously; without it they would all retry in lockstep.

- [ ] **Step 1: Write the failing test**

Create `src/lib/realtime/client.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { backoffDelay, createRealtimeClient } from "@/lib/realtime/client";
import type { ServerMessage } from "@/lib/realtime/envelope";

class FakeSocket {
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; this.onclose?.(); }
  open() { this.onopen?.(); }
  deliver(message: ServerMessage) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

describe("backoffDelay", () => {
  it("grows with each attempt", () => {
    expect(backoffDelay(0, () => 0)).toBeLessThan(backoffDelay(3, () => 0));
  });

  it("is capped", () => {
    expect(backoffDelay(50, () => 1)).toBeLessThanOrEqual(30_000);
  });

  it("applies jitter so a mass reconnect does not stampede", () => {
    expect(backoffDelay(3, () => 0)).not.toBe(backoffDelay(3, () => 1));
  });
});

describe("createRealtimeClient", () => {
  it("subscribes on open", () => {
    const socket = new FakeSocket();
    createRealtimeClient({ url: "ws://x/ws", topics: ["grid"], socketFactory: () => socket });
    socket.open();

    expect(JSON.parse(socket.sent[0])).toEqual({ t: "sub", topics: ["grid"] });
  });

  it("delivers parsed messages to handlers", () => {
    const socket = new FakeSocket();
    const client = createRealtimeClient({ url: "ws://x/ws", topics: ["grid"], socketFactory: () => socket });
    const seen: ServerMessage[] = [];
    client.on((m) => seen.push(m));
    socket.open();
    socket.deliver({ t: "presence", online: ["sam"] });

    expect(seen).toEqual([{ t: "presence", online: ["sam"] }]);
  });

  it("ignores an unparseable frame rather than throwing", () => {
    const socket = new FakeSocket();
    const client = createRealtimeClient({ url: "ws://x/ws", topics: ["grid"], socketFactory: () => socket });
    const seen: ServerMessage[] = [];
    client.on((m) => seen.push(m));
    socket.open();

    expect(() => socket.onmessage?.({ data: "not json" })).not.toThrow();
    expect(seen).toEqual([]);
  });

  it("stops delivering to an unsubscribed handler", () => {
    const socket = new FakeSocket();
    const client = createRealtimeClient({ url: "ws://x/ws", topics: ["grid"], socketFactory: () => socket });
    const seen: ServerMessage[] = [];
    const off = client.on((m) => seen.push(m));
    socket.open();
    off();
    socket.deliver({ t: "presence", online: ["sam"] });

    expect(seen).toEqual([]);
  });

  it("re-subscribes after a reconnect", () => {
    const sockets: FakeSocket[] = [];
    createRealtimeClient({
      url: "ws://x/ws",
      topics: ["grid"],
      socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    });

    sockets[0].open();
    sockets[0].close();
    // The client schedules a reconnect; drive it by creating the next socket.
    expect(sockets.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(sockets[0].sent[0])).toEqual({ t: "sub", topics: ["grid"] });
  });

  it("does not reconnect after close() is called", () => {
    const sockets: FakeSocket[] = [];
    const client = createRealtimeClient({
      url: "ws://x/ws",
      topics: ["grid"],
      socketFactory: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    });

    socketsOpenAndClose(sockets, client);

    function socketsOpenAndClose(list: FakeSocket[], c: { close(): void }) {
      list[0].open();
      c.close();
      list[0].close();
    }

    expect(sockets).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/realtime/client.test.ts`
Expected: FAIL — the module `@/lib/realtime/client` cannot be resolved.

- [ ] **Step 3: Implement the client**

Create `src/lib/realtime/client.ts`:

```ts
import type { ServerMessage, Topic } from "./envelope";

export type SocketLike = {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
};

export type RealtimeClient = {
  subscribe(topics: Topic[]): void;
  on(handler: (message: ServerMessage) => void): () => void;
  close(): void;
};

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

/**
 * Exponential backoff with jitter. The jitter is not decoration: a realtime
 * restart disconnects every client at the same instant, and without it they
 * would all retry in lockstep and restart the stampede on every failure.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export function createRealtimeClient(options: {
  url: string;
  topics: Topic[];
  socketFactory?: (url: string) => SocketLike;
}): RealtimeClient {
  const factory = options.socketFactory ?? ((url) => new WebSocket(url) as unknown as SocketLike);
  const handlers = new Set<(message: ServerMessage) => void>();

  let topics = options.topics;
  let socket: SocketLike | null = null;
  let attempt = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function connect(): void {
    if (stopped) {
      return;
    }

    const next = factory(options.url);
    socket = next;

    next.onopen = () => {
      attempt = 0;
      next.send(JSON.stringify({ t: "sub", topics }));
    };

    next.onmessage = (event) => {
      let message: ServerMessage;

      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      for (const handler of [...handlers]) {
        handler(message);
      }
    };

    next.onclose = () => {
      if (stopped) {
        return;
      }

      timer = setTimeout(connect, backoffDelay(attempt));
      attempt += 1;
    };
  }

  connect();

  return {
    subscribe(next: Topic[]) {
      topics = next;
      socket?.send(JSON.stringify({ t: "sub", topics }));
    },
    on(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close() {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    },
  };
}
```

- [ ] **Step 4: Implement the React binding**

Create `src/lib/realtime/use-realtime.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import { createRealtimeClient } from "./client";
import type { ServerMessage, Topic } from "./envelope";

export function useRealtime(
  topics: Topic[],
  handler: (message: ServerMessage) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const key = topics.join(",");

  useEffect(() => {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
    const client = createRealtimeClient({ url, topics: key.split(",") as Topic[] });
    const off = client.on((message) => handlerRef.current(message));

    return () => {
      off();
      client.close();
    };
  }, [key]);
}
```

The handler lives in a ref so a caller passing an inline arrow does not tear down and rebuild the socket on every render.

- [ ] **Step 5: Run the tests and commit**

Run: `bun test src/lib/realtime/`
Expected: PASS.

```bash
git add src/lib/realtime/client.ts src/lib/realtime/client.test.ts src/lib/realtime/use-realtime.ts
git commit -m "feat: add the browser realtime client"
```

---

### Task 8: The live grid and presence

**Files:**
- Create: `src/lib/realtime/merge.ts`, `src/lib/realtime/merge.test.ts`, `src/components/live-grid.tsx`, `src/components/presence-bar.tsx`
- Modify: `src/app/page.tsx`, `src/components/clip-card.tsx`, `src/components/clip-grid.tsx`

**Interfaces:**
- Consumes: `useRealtime` (Task 7), `ClipSummary` (Task 1), `ClipGrid` and `ClipCard` (existing).

`ClipGrid` is a server component taking `Clip[]`. `LiveGrid` is a client component that takes the server-rendered clips as its initial state and merges `clip.added` / `clip.updated` on top. The SSR'd list **is** the snapshot — there is no separate fetch on connect.

Merge rules:
- `clip.added` — prepend if absent; ignore if already present. The upload path announces on completion and the page may already have it.
- `clip.updated` — replace in place; ignore if unknown, since a clip created before this browser loaded belongs to the next page load.

`ClipCard` takes a `Clip`. Rather than reshaping it, `LiveGrid` keeps a map of `ClipSummary` and renders through an adapter, so the card component is untouched.

- [ ] **Step 1: Write the failing test for the merge**

The merge reducer lives in its own **pure module**, `src/lib/realtime/merge.ts`, not inside the component. A `"use client"` `.tsx` file pulls React and `useRealtime` in with it, and a test that only wants a reducer should not have to import a component tree to get one.

Create `src/lib/realtime/merge.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { mergeClip, type ClipMap } from "@/lib/realtime/merge";

const a = { id: "a", title: "A", status: "pending", thumbPath: null, durationMs: null, createdAt: 2 };
const b = { id: "b", title: "B", status: "ready", thumbPath: null, durationMs: null, createdAt: 1 };

describe("mergeClip", () => {
  it("adds an unseen clip", () => {
    const next = mergeClip({} as ClipMap, { t: "clip.added", clip: a });
    expect(Object.keys(next)).toEqual(["a"]);
  });

  it("ignores a duplicate add", () => {
    const first = mergeClip({} as ClipMap, { t: "clip.added", clip: a });
    const second = mergeClip(first, { t: "clip.added", clip: { ...a, title: "changed" } });
    expect(second.a.title).toBe("A");
  });

  it("replaces a known clip on update", () => {
    const first = mergeClip({} as ClipMap, { t: "clip.added", clip: a });
    const next = mergeClip(first, { t: "clip.updated", clip: { ...a, status: "ready" } });
    expect(next.a.status).toBe("ready");
  });

  it("ignores an update for a clip it has never seen", () => {
    const next = mergeClip({ b } as ClipMap, { t: "clip.updated", clip: a });
    expect(next).toEqual({ b });
  });

  it("returns the same object when nothing changed, so React can skip a render", () => {
    const state = { a } as ClipMap;
    expect(mergeClip(state, { t: "clip.added", clip: a })).toBe(state);
  });
});
```

That last assertion matters: returning a fresh object for a no-op re-renders the whole grid on every duplicate event.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/realtime/merge.test.ts`
Expected: FAIL — the module `@/lib/realtime/merge` cannot be resolved.

- [ ] **Step 3: Implement the reducer**

Create `src/lib/realtime/merge.ts`:

```ts
import type { ClipSummary, ServerMessage } from "./envelope";

export type ClipMap = Record<string, ClipSummary>;

export function mergeClip(state: ClipMap, message: ServerMessage): ClipMap {
  if (message.t === "clip.added") {
    return state[message.clip.id] ? state : { ...state, [message.clip.id]: message.clip };
  }

  if (message.t === "clip.updated") {
    return state[message.clip.id] ? { ...state, [message.clip.id]: message.clip } : state;
  }

  return state;
}
```

- [ ] **Step 4: Narrow the card's prop type instead of faking a `Clip`**

`ClipCard` currently takes a full `Clip`, but it only reads `id`, `title`, `status`, `thumbPath` and `durationMs`. A `ClipSummary` has all five — but casting one to a `Clip` would be a lie the compiler may well reject, and would silently break the day the card starts reading another column.

Change `ClipCard`'s signature to accept exactly what it uses. `Clip` remains assignable to it, so the server-rendered path is unaffected:

```tsx
export type ClipCardData = {
  id: string;
  title: string;
  status: string;
  thumbPath: string | null;
  durationMs: number | null;
};

export function ClipCard({ clip }: { clip: ClipCardData }) {
```

Make the matching one-line change to `ClipGrid`'s prop type (`clips: ClipCardData[]`). Do not change either component's markup or behaviour.

- [ ] **Step 5: Implement `LiveGrid`**

Create `src/components/live-grid.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { mergeClip, type ClipMap } from "@/lib/realtime/merge";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { ClipGrid } from "./clip-grid";

export function LiveGrid({ initial }: { initial: ClipSummary[] }) {
  const [clips, setClips] = useState<ClipMap>(
    () => Object.fromEntries(initial.map((c) => [c.id, c])),
  );

  useRealtime(["grid"], (message) => {
    setClips((state) => mergeClip(state, message));
  });

  const ordered = useMemo(
    () => Object.values(clips).sort((x, y) => y.createdAt - x.createdAt),
    [clips],
  );

  return <ClipGrid clips={ordered} />;
}
```

`ClipSummary` satisfies `ClipCardData` structurally, so nothing needs converting.

- [ ] **Step 6: Implement `PresenceBar`**

Create `src/components/presence-bar.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRealtime } from "@/lib/realtime/use-realtime";

export function PresenceBar({ me }: { me: string }) {
  const [online, setOnline] = useState<string[]>([me]);

  useRealtime(["grid"], (message) => {
    if (message.t === "presence") {
      setOnline(message.online);
    }
  });

  const others = online.filter((name) => name !== me);

  return (
    <p className="text-sm text-ink-muted">
      {others.length === 0
        ? "You're the only one here"
        : `Here now: ${others.join(", ")}`}
    </p>
  );
}
```

- [ ] **Step 7: Wire the home page**

Modify `src/app/page.tsx` to map its clips to summaries and render the two client components. It stays a server component; only the mapping and the two elements change:

```tsx
import { toSummary } from "@/lib/events/clips";
import { LiveGrid } from "@/components/live-grid";
import { PresenceBar } from "@/components/presence-bar";
```

Replace `<ClipGrid clips={clips} />` with `<LiveGrid initial={clips.map(toSummary)} />`, and render `<PresenceBar me={user.authentikUsername} />` in the header area beside the existing signed-in text.

- [ ] **Step 8: Run the suite and build, then commit**

Run: `bun test && bun run build`
Expected: both pass. Report real counts.

```bash
git add src/lib/realtime/merge.ts src/lib/realtime/merge.test.ts src/components/live-grid.tsx src/components/presence-bar.tsx src/components/clip-card.tsx src/components/clip-grid.tsx src/app/page.tsx
git commit -m "feat: live grid and presence"
```

---

### Task 9: Retire the upload polling

**Files:**
- Modify: `src/components/upload-panel.tsx`
- Delete: `src/app/api/clips/[id]/route.ts` (and the now-empty directories)

**Interfaces:**
- Consumes: `useRealtime` (Task 7).

`upload-panel.tsx` currently polls `GET /api/clips/${clipId}` every 2 seconds while `phase === "processing"` (the effect at roughly lines 42–67). Replace that effect with a `clip.updated` subscription.

**This is what fixes the bug the final review found in milestone 2/3.** Polling sampled a status that is momentarily `failed` during a retry and treated it as terminal. Pushed events carry the same risk if the client treats any `failed` as final — but the runner now only writes `failed` once retries are exhausted, so a pushed `failed` is genuinely terminal.

Keep every other phase, the beforeunload guard, and all the existing copy. Only the status-watching effect changes.

- [ ] **Step 1: Replace the polling effect**

Remove the `useEffect` that creates the `setTimeout`/`fetch` loop, and add in its place:

```tsx
  useRealtime(["grid"], (message) => {
    if (message.t !== "clip.updated" || message.clip.id !== clipId) {
      return;
    }

    if (message.clip.status === "ready") {
      transition("ready");
    } else if (message.clip.status === "failed" || message.clip.status === "needs_transcode") {
      transition("failed");
    }
  });
```

Place it with the component's other hooks, unconditionally — hooks cannot be called conditionally, and the handler's own guard is what makes it a no-op before `clipId` exists.

- [ ] **Step 2: Delete the polling endpoint**

```bash
git rm -r "src/app/api/clips"
```

Then confirm nothing still references it:

```bash
grep -rn "api/clips" src/ || echo "no references remain"
```

Expected: no references.

- [ ] **Step 3: Verify the suite and build**

Run: `bun test && bun run build`
Expected: both pass, with no route listed for `/api/clips/[id]` in the build output.

- [ ] **Step 4: Commit**

```bash
git add -A src/components/upload-panel.tsx src/app/api
git commit -m "feat: push upload status instead of polling"
```

---

### Task 10: Route the socket through Caddy

**Files:**
- Modify: `dev/Caddyfile`
- Create: `content/changelog/0.0.4.md`

The production Caddyfile in `~/git/containers` already routes `/ws*` to `clips-realtime:3001` — that was configured in milestone 1 and **must not be touched here**. But `dev/Caddyfile` proxies everything to Next on 3002, so in local development the browser's socket never reaches the realtime service.

- [ ] **Step 1: Add the `/ws` route to the dev Caddyfile**

In `dev/Caddyfile`, add a handler **before** the catch-all, matching the production layout:

```
  handle /ws* {
    reverse_proxy 127.0.0.1:3001
  }
```

Order matters: a catch-all placed first would swallow it.

- [ ] **Step 2: Write the changelog entry**

Create `content/changelog/0.0.4.md`, in plain language for Sam's friends — no "websocket", no "realtime service", no component names:

```markdown
---
version: 0.0.4
date: 2026-09-23
title: See it happen
---

- New clips appear in the library as they finish, without reloading the page.
- See who else is here right now.
- Upload progress and processing updates arrive live instead of on a delay.
```

- [ ] **Step 3: Commit**

```bash
git add dev/Caddyfile content/changelog/0.0.4.md
git commit -m "feat: route the dev socket and announce the release"
```

---

### Task 11: End-to-end verification

**Files:** none. This is the check that the milestone actually works.

The realtime service has been tested in isolation since milestone 1 and **`EMIT_SECRET` has never been exercised end to end**. This task is where that finally happens.

- [ ] **Step 1: Restart the dev stack with realtime running**

Three processes are needed: Next on 3002, the realtime service on 3001, and the dev Caddy on 3000. Identify and stop only the PIDs you started — **never a broad `pkill`**; an unrelated `next-server` (PID 3613202) runs on this machine.

```bash
ss -ltnp | grep -E ':(3000|3001|3002) '
```

Start the realtime service with a secret, and Next with the same one:

```bash
EMIT_SECRET=devsecret REALTIME_PORT=3001 bun src/realtime/index.ts
DEV_AUTH_USERNAME=localdev EMIT_SECRET=devsecret REALTIME_URL=http://127.0.0.1:3001 bun run dev
```

Reload the dev Caddy so it picks up the new `/ws` route.

- [ ] **Step 2: Confirm the socket connects through Caddy**

In the browser console at `http://192.168.3.54:3000`:

```js
const ws = new WebSocket(`ws://${location.host}/ws`);
ws.onmessage = (e) => console.log("←", e.data);
ws.onopen = () => ws.send(JSON.stringify({ t: "sub", topics: ["grid"] }));
```

Expected: a `hello` then a `presence` naming `localdev`.

- [ ] **Step 3: Watch a clip appear live**

With the site open and **not** reloading it, drop a video into `./data/media/incoming`:

```bash
ffmpeg -loglevel error -f lavfi -i testsrc=duration=3:size=640x360:rate=30 \
  -c:v libx264 "./data/media/incoming/live test.mp4"
```

Wait past the scanner's mtime gate (~15s). Expected: a card appears in the grid on its own, moves through Processing, and becomes playable with a thumbnail — with no reload at any point.

- [ ] **Step 4: Watch an upload push its own status**

Upload a file through `/upload`. Expected: progress advances, then the panel flips to "Watch clip" when processing finishes — driven by the pushed event, not a poll. Confirm in the Network tab that **no requests to `/api/clips/` occur**, because that endpoint no longer exists.

- [ ] **Step 5: Confirm presence across two browsers**

Open the site in a second browser or a private window. Expected: each reports the other under "Here now". Close one; the other updates within a second.

- [ ] **Step 6: Confirm realtime being down does not break the site**

Stop the realtime process. Expected: the page still loads, clips still process to completion, uploads still work — only live updates stop. The `web` logs show a publish warning, not an error, and nothing 500s. **This is the most important check in the task**: it proves the publisher is genuinely fire-and-forget rather than a new hard dependency on the critical path.

Restart realtime and confirm the browser reconnects on its own.

- [ ] **Step 7: Record what you observed**

Append a short note to the plan or `docs/DEPLOYMENT.md` capturing whether the socket survived a realtime restart, and whether anything in `web` degraded when realtime was down.

```bash
git add -A docs/
git commit -m "docs: record milestone 4 verification"
```

---

## Definition of done

- [ ] `bun test` passes; `bun run build` clean
- [ ] A clip dropped on disk appears in an open grid with no reload
- [ ] An upload's status reaches the panel by push; `/api/clips/[id]` no longer exists
- [ ] Two browsers see each other in presence, and a disconnect updates it
- [ ] `realtime` being down degrades to "no live updates" — uploads and processing still work, nothing 500s
- [ ] Nothing in `src/realtime/` imports from `next/*`, `@/db`, `@/lib/media`, `@/lib/jobs` or `@/lib/ingest`
- [ ] No `room.*` handling exists; the `room` topic name is reserved and unused

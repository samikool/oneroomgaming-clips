# Milestone 5: The Theater — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One always-on room where the host picks a clip and everyone else's playhead follows it within 150 ms, with a dock on every page that shows what is playing and a one-click join.

**Architecture:** `realtime` holds the room state in memory and is the sole authority — it stamps `anchorServerTime` with its own clock, authorizes every `room.*` command against `hostUserId`, and fans out a full snapshot on every change. The browser computes a clock offset with Cristian's algorithm, derives a target playhead from the snapshot, and feeds it to a `SyncController` that corrects drift on a 500 ms tick. The room's authority never reaches into the database: what realtime knows about the playing clip is whatever the host's browser told it.

**Tech Stack:** Next 16.3.5, React 19.3.0, TypeScript, bun 1.4.2, `ws` 8.21.3, Tailwind 4.3.3.

**Spec:** `docs/superpowers/specs/2026-09-21-clips-site-design.md`

## Global Constraints

- Runtime is **bun 1.4.2**. Tests are `bun test` importing from `"bun:test"`. **No Vitest** — it runs under Node, where `bun:sqlite` cannot resolve.
- **No new dependencies.** This milestone needs none.
- `src/realtime/*` must **never** import from `next/*`, `src/db/*`, `src/lib/media/*`, `src/lib/jobs/*` or `src/lib/ingest/*`. It is bundled separately with `bun build --target=bun` and **does nothing that can block**. No disk, no database, no ffmpeg. It may import from `src/lib/realtime/*`, which is pure.
- **Wire identity is the Authentik username**, never the ULID. Every `userId` and every name in room state is `users.authentik_username`.
- **Every `room.*` command is authorized server-side against `hostUserId`.** A follower's `room.control` is dropped silently. The client disables controls for UX; the client is never the enforcement point.
- **The server stamps `anchorServerTime` with its own clock**, never from a client-supplied timestamp.
- Tailwind 4 `@theme` token utilities (`bg-surface-raised`, `text-ink`, `text-ink-muted`). Never arbitrary `[var(--color-…)]`. There is no `tailwind.config.js`.
- Suite is **166 tests across 25 files**, all passing; `bun run build` clean. Report real counts, never predicted ones.
- Test output must stay as clean as it is. Known pre-existing noise: `realtime listening on :3099` from `index.test.ts` and `job transcode failed …` from `runner.test.ts`.
- **Theater chat and reactions are milestone 6.** Reserve the Chat tab and the overlay slot; implement no `chat.*` or `reaction.*` message.
- Every task ends with a commit.

## Dev environment — read before running anything

A dev stack is already running and **must be left alone**:

- `realtime` on **3001** (`EMIT_SECRET=devsecret`)
- Next on **3002** (`DEV_AUTH_USERNAME=localdev`, `REALTIME_URL=http://127.0.0.1:3001`, `EMIT_SECRET=devsecret`)
- A **root-owned** Caddy on **3000** from `dev/Caddyfile`, which serves `/media/*` off disk, proxies `/ws*` to 3001 and everything else to 3002.

Browse the site at **:3000**, not :3002 — the socket only works through Caddy. An agent session cannot restart that Caddy; if `dev/Caddyfile` changes, ask Sam.

Restarting `realtime` wipes the room. That is by design (Task 4) but it will surprise you mid-test.

An unrelated project's `next-server` also runs on this machine — **never use broad `pkill` patterns**; kill only a PID you have identified.

## What already exists

Milestone 4 built the socket layer: `src/lib/realtime/envelope.ts` (pure, shared by both processes), a `Hub` with topic routing and backpressure, `createRealtimeClient` with reconnect and jittered backoff, and a `useRealtime` React binding. The `room` topic name is reserved in `TOPICS` and routed nowhere. The `time.sync` handshake is **already answered server-side** — `src/realtime/index.ts` replies with the server's own `Date.now()` — and nothing has ever consumed it. This milestone is its first caller.

Three things that milestone 4 left as they were, which this milestone must change:

1. **`useRealtime` opens its own socket per call.** The home page already holds three (`LiveGrid`, `PresenceBar`, `UploadPanel`). The spec says one socket per client. Task 1 fixes it, because the dock and the theater must see room messages in the same order as each other.
2. **`RealtimeClient` has no way to send an arbitrary message.** It can only `subscribe`. The theater has to send `room.*`.
3. **`presence` carries only `online`.** The dock needs to know who is *in the room*, not just who has the site open.

## Deliberate deviations from the spec, and why

Record these in the commit messages so a later reader does not think they were accidents.

- **`RoomState` carries the clip's title and duration, not just `clipId`.** `realtime` holds no database connection, so it cannot turn an id into a title for the dock or a duration for end-of-clip clamping. The host's browser already has both, so `room.control`/`setClip` carries them and realtime stores them opaquely. The alternative — a lookup round-trip to `web` on every `setClip` — is exactly the latency coupling the two-process split exists to avoid.
- **The `room` server message is `{ t: "room", state }`, with `rev` inside `state`.** The spec writes `{ t: "room", rev, state: RoomState }` *and* puts `rev` in `RoomState`. Two copies of one counter is a desync bug waiting to happen. One copy, inside the state.
- **`presence` stays on the `grid` topic** even though it now carries `inRoom`. After Task 1 every page subscribes to the union of what its components ask for, and the app shell always asks for `["grid", "room"]`, so moving it would change nothing except break existing tests.
- **The expanded theater is a `/theater` route.** The spec rejects "a separate `/theater` route" as the *only* surface — an always-on room nobody can see is a dead room. The dock solves discoverability; the expanded view still needs somewhere to live, and the dock links to it.

## File Structure

```
src/lib/realtime/
  envelope.ts            MODIFY — RoomState, room.* client and server messages, topic routing
  room-state.ts          NEW    — pure playhead math, shared by realtime and the browser
  room-state.test.ts     NEW
  client.ts              MODIFY — add send(message)
  provider.tsx           NEW    — one socket per client; refcounted topic union
  topics.ts              NEW    — unionTopics, pure
  topics.test.ts         NEW
  use-realtime.ts        MODIFY — consume the provider instead of opening a socket

src/realtime/
  room.ts                NEW    — the authoritative Room. Pure, injected clock. No I/O.
  room.test.ts           NEW
  hub.ts                 MODIFY — sendTo(username, message)
  index.ts               MODIFY — route room.* into Room, snapshot on sub, inRoom in presence

src/lib/theater/
  clock.ts               NEW    — Cristian's algorithm: offsetFromSamples + ServerClock
  clock.test.ts          NEW
  sampler.ts             NEW    — drives the handshake; browser-side, injectable timers
  sampler.test.ts        NEW
  sync-controller.ts     NEW    — decideCorrection (pure) + createSyncController
  sync-controller.test.ts NEW
  room-store.ts          NEW    — reduceRoom: rev guard, inRoom, control requests. Pure.
  room-store.test.ts     NEW
  use-room.ts            NEW    — React binding over room-store + the provider
  use-dock-dismissed.ts  NEW    — localStorage, SSR-safe
  flags.ts               NEW    — DOCK_PULSE_ENABLED

src/components/
  app-shell.tsx          NEW    — wraps children in RealtimeProvider, renders the dock
  dock.tsx               NEW    — idle / advertising / joined, × to a badge
  dock-badge.tsx         NEW    — the collapsed live badge
  theater.tsx            NEW    — the expanded view: video, sidebar, fullscreen
  theater-transport.tsx  NEW    — transport controls, disabled-and-explained for followers
  watching-list.tsx      NEW    — participants, host marker, give-control buttons

src/app/
  layout.tsx             MODIFY — render AppShell
  theater/page.tsx       NEW    — server component: identity + the ready clip list
  globals.css            MODIFY — dock, badge pulse, fullscreen overlay

content/changelog/0.0.5.md  NEW
docs/DEPLOYMENT.md          MODIFY — theater verification notes
```

---

### Task 1: One socket per client

`useRealtime` opens a socket per call site. The dock is global and the theater needs ordered room messages, so this has to become one socket that many components share. The client also gains a generic `send`, which every later task needs.

**Files:**
- Create: `src/lib/realtime/topics.ts`
- Create: `src/lib/realtime/topics.test.ts`
- Create: `src/lib/realtime/provider.tsx`
- Modify: `src/lib/realtime/client.ts`
- Modify: `src/lib/realtime/client.test.ts`
- Modify: `src/lib/realtime/use-realtime.ts`
- Create: `src/components/app-shell.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: `createRealtimeClient({url, topics, socketFactory?, delayFor?})`, `Topic`, `ServerMessage`, `ClientMessage` from milestone 4.
- Produces:
  - `unionTopics(groups: Topic[][]): Topic[]` — sorted, deduped.
  - `RealtimeClient.send(message: ClientMessage): void`
  - `<RealtimeProvider>{children}</RealtimeProvider>` (client component)
  - `useRealtimeContext(): { register, send }`
  - `useRealtimeSend(): (message: ClientMessage) => void`
  - `useRealtime(topics, handler)` — same signature, now backed by the shared socket.
  - `<AppShell me={string}>{children}</AppShell>`

- [ ] **Step 1: Write the failing test for `unionTopics`**

Create `src/lib/realtime/topics.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { unionTopics } from "@/lib/realtime/topics";

describe("unionTopics", () => {
  it("returns an empty list when nothing is registered", () => {
    expect(unionTopics([])).toEqual([]);
  });

  it("merges overlapping groups without duplicates", () => {
    expect(unionTopics([["grid"], ["grid", "room"]])).toEqual(["grid", "room"]);
  });

  it("sorts so the same set always produces the same subscribe frame", () => {
    expect(unionTopics([["room", "grid"]])).toEqual(unionTopics([["grid", "room"]]));
  });
});
```

The sort is not tidiness. The provider compares the union to the last one it sent to decide whether to re-subscribe; unsorted, `["room","grid"]` and `["grid","room"]` would look different and send a redundant frame on every mount.

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/realtime/topics.test.ts`
Expected: FAIL — `Cannot find module '@/lib/realtime/topics'`

- [ ] **Step 3: Implement `unionTopics`**

Create `src/lib/realtime/topics.ts`:

```ts
import { TOPICS, type Topic } from "./envelope";

/**
 * The set of topics the shared socket should hold, given what every mounted
 * component has asked for.
 *
 * Sorted, so that the provider can compare a new union to the last one it sent
 * with a plain string join and skip a redundant `sub` frame.
 */
export function unionTopics(groups: Topic[][]): Topic[] {
  const wanted = new Set(groups.flat());
  return TOPICS.filter((topic) => wanted.has(topic));
}
```

Filtering `TOPICS` rather than sorting the set gives a stable order for free and drops anything that is not a real topic.

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/lib/realtime/topics.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing test for `client.send`**

Append to `src/lib/realtime/client.test.ts`. Match the fake-socket helper already in that file rather than inventing a second one.

```ts
it("sends an arbitrary client message over the open socket", () => {
  const sent: string[] = [];
  const socket = {
    send: (data: string) => sent.push(data),
    close: () => {},
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    onclose: null as (() => void) | null,
  };
  const client = createRealtimeClient({
    url: "ws://x/ws",
    topics: ["room"],
    socketFactory: () => socket,
    delayFor: () => 1,
  });
  socket.onopen?.();
  sent.length = 0;

  client.send({ t: "sub", topics: ["room"] });

  expect(JSON.parse(sent[0]!)).toEqual({ t: "sub", topics: ["room"] });
});

it("drops a send while the socket is down rather than throwing", () => {
  const client = createRealtimeClient({
    url: "ws://x/ws",
    topics: ["room"],
    socketFactory: () => {
      throw new Error("cannot connect");
    },
    delayFor: () => 1,
  });

  expect(() => client.send({ t: "sub", topics: ["room"] })).not.toThrow();
  client.close();
});
```

The second test is the point of the task. A user clicking Play during a reconnect must not get an exception in the console; the next snapshot corrects them anyway.

Task 2 step 6 switches both of these to `{ t: "room.join" }`, which is the real payload and does not typecheck until then.

- [ ] **Step 6: Run it and watch it fail**

Run: `bun test src/lib/realtime/client.test.ts`
Expected: FAIL — `client.send is not a function`.

- [ ] **Step 7: Implement `send` and survive a throwing factory**

In `src/lib/realtime/client.ts`, add to the `RealtimeClient` type:

```ts
export type RealtimeClient = {
  subscribe(topics: Topic[]): void;
  send(message: ClientMessage): void;
  on(handler: (message: ServerMessage) => void): () => void;
  close(): void;
};
```

Import `ClientMessage` alongside the existing type imports. Wrap the body of `connect()` so a factory that throws schedules a retry instead of propagating:

```ts
  function connect(): void {
    if (stopped) {
      return;
    }

    let next: SocketLike;

    try {
      next = factory(options.url);
    } catch {
      // A constructor that throws (blocked URL, no network) must behave like a
      // socket that opened and closed: retry, never propagate to the caller.
      timer = setTimeout(connect, delayFor(attempt));
      attempt += 1;
      return;
    }

    socket = next;
    // ...the rest of the existing body, unchanged
  }
```

And in the returned object, beside `subscribe`:

```ts
    send(message: ClientMessage) {
      // Best effort by design. The socket may be mid-reconnect; the snapshot
      // that follows a reconnect makes a dropped command self-correcting.
      try {
        socket?.send(JSON.stringify(message));
      } catch {
        // The socket is closing. The reconnect path already handles it.
      }
    },
```

- [ ] **Step 8: Run the realtime tests**

Run: `bun test src/lib/realtime/`
Expected: PASS, no regressions.

- [ ] **Step 9: Write the provider and rewire `useRealtime`**

Create `src/lib/realtime/provider.tsx`:

```tsx
"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRealtimeClient, type RealtimeClient } from "./client";
import type { ClientMessage, ServerMessage, Topic } from "./envelope";
import { unionTopics } from "./topics";

type Registration = { topics: Topic[]; handler: (message: ServerMessage) => void };

type RealtimeContextValue = {
  register(registration: Registration): () => void;
  send(message: ClientMessage): void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

/**
 * Holds the one socket for the whole tab.
 *
 * Milestone 4 gave every `useRealtime` call its own socket, which was three on
 * the home page alone. The theater cannot work that way: the dock and the
 * expanded view must see room snapshots in the same order, and two sockets
 * reconnecting independently do not guarantee that.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const registrations = useRef(new Set<Registration>());
  const clientRef = useRef<RealtimeClient | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const client = createRealtimeClient({
      url: `${scheme}://${location.host}/ws`,
      topics: unionTopics([...registrations.current].map((entry) => entry.topics)),
    });
    clientRef.current = client;

    const off = client.on((message) => {
      // Snapshot: a handler may unregister during the loop.
      for (const entry of [...registrations.current]) {
        entry.handler(message);
      }
    });

    // Components that mounted before this effect ran registered against a null
    // client; now there is one, push the union they asked for.
    client.subscribe(unionTopics([...registrations.current].map((entry) => entry.topics)));
    force((n) => n + 1);

    return () => {
      off();
      client.close();
      clientRef.current = null;
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({
      register(registration) {
        registrations.current.add(registration);
        clientRef.current?.subscribe(
          unionTopics([...registrations.current].map((entry) => entry.topics)),
        );

        return () => {
          registrations.current.delete(registration);
          clientRef.current?.subscribe(
            unionTopics([...registrations.current].map((entry) => entry.topics)),
          );
        };
      },
      send(message) {
        clientRef.current?.send(message);
      },
    }),
    [],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeContext(): RealtimeContextValue {
  const value = useContext(RealtimeContext);

  if (!value) {
    throw new Error("useRealtime must be used inside <RealtimeProvider>");
  }

  return value;
}

export function useRealtimeSend(): (message: ClientMessage) => void {
  return useRealtimeContext().send;
}
```

Replace the body of `src/lib/realtime/use-realtime.ts`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { ServerMessage, Topic } from "./envelope";
import { useRealtimeContext } from "./provider";

/**
 * Subscribes this component to the tab's shared socket for as long as it is
 * mounted.
 *
 * The handler lives in a ref so a caller passing an inline arrow — which is
 * every caller — does not re-register on each render.
 */
export function useRealtime(topics: Topic[], handler: (message: ServerMessage) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  const { register } = useRealtimeContext();
  const key = topics.join(",");

  useEffect(
    () =>
      register({
        topics: key.split(",") as Topic[],
        handler: (message) => handlerRef.current(message),
      }),
    [register, key],
  );
}
```

- [ ] **Step 10: Add the shell and mount it**

Create `src/components/app-shell.tsx`:

```tsx
import { RealtimeProvider } from "@/lib/realtime/provider";

/**
 * Everything that needs the shared socket lives inside here. The dock joins it
 * in Task 9; for now the shell exists so that wiring lands in one commit
 * rather than being threaded through the layout twice.
 */
export function AppShell({ children }: { me: string; children: React.ReactNode }) {
  return <RealtimeProvider>{children}</RealtimeProvider>;
}
```

`me` is accepted but unused until Task 9. Keeping it in the signature now means Task 9 touches one file instead of three.

In `src/app/layout.tsx`, import `AppShell` and `requireUser`, make the component `async`, and wrap the children:

```tsx
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [latest] = getChangelogEntries();
  const user = await requireUser();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AppShell me={user.authentikUsername}>{children}</AppShell>
        {latest && (
          <ChangelogModal
            version={latest.version}
            title={latest.title}
            date={formatEntryDate(latest.date.toISOString())}
            html={latest.html}
          />
        )}
      </body>
    </html>
  );
}
```

`requireUser` reads `headers()`, which makes the layout dynamic. That is already true of every page in this app (`export const dynamic = "force-dynamic"`), so nothing regresses.

- [ ] **Step 11: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: PASS at 169 tests, clean build. Report the real number.

- [ ] **Step 12: Verify one socket in the browser**

With the dev stack running, load `http://<host>:3000/` and then:

```bash
curl -s http://127.0.0.1:3001/healthz
```

Expected: `sockets` equal to the number of open tabs, not three times it.

- [ ] **Step 13: Commit**

```bash
git add src/lib/realtime/topics.ts src/lib/realtime/topics.test.ts \
  src/lib/realtime/provider.tsx src/lib/realtime/client.ts \
  src/lib/realtime/client.test.ts src/lib/realtime/use-realtime.ts \
  src/components/app-shell.tsx src/app/layout.tsx
git commit -m "refactor: hold one socket per tab

Milestone 4 opened a socket per useRealtime call — three on the home page.
The dock and the theater must see room snapshots in the same order, which
two independently reconnecting sockets do not guarantee.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The room envelope

Every `room.*` message, and the `RoomState` shape both processes agree on. Pure, no behaviour — but everything downstream depends on these names, so it lands on its own.

**Files:**
- Modify: `src/lib/realtime/envelope.ts`
- Modify: `src/lib/realtime/envelope.test.ts`
- Modify: `src/lib/realtime/client.test.ts` (finish Task 1's note)
- Modify: `src/realtime/index.ts` (placeholder `inRoom`)

**Interfaces:**
- Produces:
  - `type RoomState = { clipId, clipTitle, clipDurationMs, hostUserId, paused, positionMs, anchorServerTime, rev }`
  - `ROOM_ACTIONS`, `type RoomAction = "play" | "pause" | "seek" | "setClip"`
  - Client messages `room.join`, `room.leave`, `room.claimHost`, `room.requestControl`, `room.giveControl`, `room.control`
  - Server messages `{ t: "room"; state: RoomState }`, `{ t: "room.controlRequested"; user: string }`
  - `presence` gains `inRoom: string[]`

- [ ] **Step 1: Write the failing parser tests**

Append to `src/lib/realtime/envelope.test.ts` (add `topicFor` to the imports if it is not already there):

```ts
describe("parseClientMessage — room commands", () => {
  it("accepts a bare room.join", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.join" }))).toEqual({ t: "room.join" });
  });

  it("accepts room.leave and room.claimHost and room.requestControl", () => {
    for (const t of ["room.leave", "room.claimHost", "room.requestControl"]) {
      expect(parseClientMessage(JSON.stringify({ t }))).toEqual({ t } as never);
    }
  });

  it("accepts room.giveControl with a userId", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.giveControl", userId: "sam" })))
      .toEqual({ t: "room.giveControl", userId: "sam" });
  });

  it("rejects room.giveControl without a usable userId", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.giveControl" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "room.giveControl", userId: 7 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "room.giveControl", userId: "" }))).toBeNull();
  });

  it("accepts a seek carrying a position", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "seek", positionMs: 4200 })))
      .toEqual({ t: "room.control", action: "seek", positionMs: 4200 });
  });

  it("rejects a seek with no position", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "seek" }))).toBeNull();
  });

  it("rejects a negative seek", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "seek", positionMs: -1 })))
      .toBeNull();
  });

  it("accepts setClip carrying the metadata realtime cannot look up", () => {
    const raw = JSON.stringify({
      t: "room.control",
      action: "setClip",
      clipId: "01ABC",
      title: "ace",
      durationMs: 9000,
    });

    expect(parseClientMessage(raw)).toEqual({
      t: "room.control",
      action: "setClip",
      clipId: "01ABC",
      title: "ace",
      durationMs: 9000,
    });
  });

  it("rejects setClip without a clipId", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "setClip", title: "ace" })))
      .toBeNull();
  });

  it("rejects an unknown action", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "explode" }))).toBeNull();
  });

  it("accepts play and pause with no position", () => {
    expect(parseClientMessage(JSON.stringify({ t: "room.control", action: "play" })))
      .toEqual({ t: "room.control", action: "play" });
  });
});

describe("topicFor — room messages", () => {
  const state = {
    clipId: null, clipTitle: null, clipDurationMs: null, hostUserId: null,
    paused: true, positionMs: 0, anchorServerTime: 0, rev: 0,
  };

  it("routes a room snapshot to the room topic", () => {
    expect(topicFor({ t: "room", state })).toBe("room");
  });

  it("routes a control request to the room topic", () => {
    expect(topicFor({ t: "room.controlRequested", user: "sam" })).toBe("room");
  });
});
```

`positionMs: -1` being rejected matters: `realtime` treats what a client sends as an opaque position, and a negative one would make every follower hard-seek to a time that does not exist.

- [ ] **Step 2: Run them and watch them fail**

Run: `bun test src/lib/realtime/envelope.test.ts`
Expected: FAIL — the room cases return `null`, `topicFor` does not accept the new shapes.

- [ ] **Step 3: Extend the envelope**

In `src/lib/realtime/envelope.ts`, add above `ServerMessage`:

```ts
/**
 * The room's entire authoritative state. `realtime` owns it; everyone else
 * receives snapshots.
 *
 * It carries the clip's title and duration, not just its id, because
 * `realtime` holds no database connection and cannot resolve one. The host's
 * browser already has both and sends them with `setClip`.
 *
 * `positionMs` is the playhead as of `anchorServerTime`, which the server
 * stamps with its own clock.
 */
export type RoomState = {
  clipId: string | null;
  clipTitle: string | null;
  clipDurationMs: number | null;
  hostUserId: string | null;
  paused: boolean;
  positionMs: number;
  anchorServerTime: number;
  rev: number;
};

export const ROOM_ACTIONS = ["play", "pause", "seek", "setClip"] as const;
export type RoomAction = (typeof ROOM_ACTIONS)[number];
```

Extend `ServerMessage`:

```ts
export type ServerMessage =
  | { t: "hello"; username: string; serverTime: number }
  | { t: "time.sync"; t0: number; t1: number }
  | { t: "presence"; online: string[]; inRoom: string[] }
  | { t: "room"; state: RoomState }
  | { t: "room.controlRequested"; user: string }
  | { t: "clip.added"; clip: ClipSummary }
  | { t: "clip.updated"; clip: ClipSummary }
  | { t: "upload.progress"; uploadId: string; pct: number; user: string };
```

Extend `ClientMessage`:

```ts
export type ClientMessage =
  | { t: "sub"; topics: Topic[] }
  | { t: "time.sync"; t0: number }
  | { t: "room.join" }
  | { t: "room.leave" }
  | { t: "room.claimHost" }
  | { t: "room.requestControl" }
  | { t: "room.giveControl"; userId: string }
  | {
      t: "room.control";
      action: RoomAction;
      positionMs?: number;
      clipId?: string;
      title?: string;
      durationMs?: number | null;
    };
```

Route them:

```ts
export function topicFor(message: ServerMessage): Topic {
  switch (message.t) {
    case "hello":
    case "time.sync":
      return "user";
    case "room":
    case "room.controlRequested":
      return "room";
    default:
      return "grid";
  }
}
```

Add this helper above `parseClientMessage`:

```ts
function isRoomAction(value: unknown): value is RoomAction {
  return typeof value === "string" && (ROOM_ACTIONS as readonly string[]).includes(value);
}

function parseRoomControl(message: Record<string, unknown>): ClientMessage | null {
  const { action } = message;

  if (!isRoomAction(action)) {
    return null;
  }

  if (action === "setClip") {
    if (typeof message.clipId !== "string" || message.clipId.length === 0) {
      return null;
    }

    return {
      t: "room.control",
      action,
      clipId: message.clipId,
      title: typeof message.title === "string" ? message.title : "",
      durationMs: typeof message.durationMs === "number" ? message.durationMs : null,
    };
  }

  if (action === "seek") {
    // A negative position would make every follower hard-seek to a time that
    // does not exist, so it is rejected rather than clamped.
    return typeof message.positionMs === "number" &&
      Number.isFinite(message.positionMs) &&
      message.positionMs >= 0
      ? { t: "room.control", action, positionMs: message.positionMs }
      : null;
  }

  return { t: "room.control", action };
}
```

And inside `parseClientMessage`, after the `sub` branch:

```ts
  if (
    message.t === "room.join" ||
    message.t === "room.leave" ||
    message.t === "room.claimHost" ||
    message.t === "room.requestControl"
  ) {
    return { t: message.t };
  }

  if (message.t === "room.giveControl") {
    return typeof message.userId === "string" && message.userId.length > 0
      ? { t: "room.giveControl", userId: message.userId }
      : null;
  }

  if (message.t === "room.control") {
    return parseRoomControl(message);
  }
```

- [ ] **Step 4: Run them and watch them pass**

Run: `bun test src/lib/realtime/envelope.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix the `presence` callers**

`presence` now requires `inRoom`. TypeScript will name every site:

Run: `bunx tsc --noEmit`

Fix each one:
- `src/realtime/index.ts` — the `hub.publish({ t: "presence", online: hub.online })` calls become `hub.publish({ t: "presence", online: hub.online, inRoom: [] })`, and likewise the `ws.send(JSON.stringify({ t: "presence", online: hub.online }))`. Task 5 replaces all of them with a helper carrying the real membership; the literal `[]` lives for one task.
- `src/components/presence-bar.tsx` — no change; it reads only `message.online`.
- Any test constructing a `presence` message — add `inRoom: []`.

- [ ] **Step 6: Finish Task 1's note in `client.test.ts`**

Change the two tests added in Task 1 step 5 from `{ t: "sub", topics: ["room"] }` to `{ t: "room.join" }`, and update their assertion to `toEqual({ t: "room.join" })`. It typechecks now.

- [ ] **Step 7: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/realtime/envelope.ts src/lib/realtime/envelope.test.ts \
  src/lib/realtime/client.test.ts src/realtime/index.ts
git commit -m "feat: add the room envelope

RoomState carries the clip title and duration, not just the id: realtime
holds no database connection and cannot resolve one, and the host's browser
already has both. The room snapshot keeps rev inside the state rather than
alongside it — two copies of one counter is a desync waiting to happen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The playhead, as pure arithmetic

Where the playhead is *now*, given a snapshot and a server clock. Both processes need it — `realtime` to freeze position on pause, the browser to compute its sync target — so it lives in `src/lib/realtime/`, which both may import.

**Files:**
- Create: `src/lib/realtime/room-state.ts`
- Create: `src/lib/realtime/room-state.test.ts`

**Interfaces:**
- Consumes: `RoomState` from Task 2.
- Produces: `INITIAL_ROOM_STATE: RoomState`, `positionNow(state: RoomState, serverNow: number): number`

- [ ] **Step 1: Write the failing test**

Create `src/lib/realtime/room-state.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { RoomState } from "@/lib/realtime/envelope";
import { INITIAL_ROOM_STATE, positionNow } from "@/lib/realtime/room-state";

function playing(overrides: Partial<RoomState> = {}): RoomState {
  return {
    clipId: "01ABC",
    clipTitle: "ace",
    clipDurationMs: 30_000,
    hostUserId: "sam",
    paused: false,
    positionMs: 5_000,
    anchorServerTime: 1_000_000,
    rev: 3,
    ...overrides,
  };
}

describe("INITIAL_ROOM_STATE", () => {
  it("is an empty, hostless, paused room at rev 0", () => {
    expect(INITIAL_ROOM_STATE).toEqual({
      clipId: null,
      clipTitle: null,
      clipDurationMs: null,
      hostUserId: null,
      paused: true,
      positionMs: 0,
      anchorServerTime: 0,
      rev: 0,
    });
  });
});

describe("positionNow", () => {
  it("advances with the server clock while playing", () => {
    expect(positionNow(playing(), 1_002_000)).toBe(7_000);
  });

  it("is frozen while paused, whatever the clock says", () => {
    expect(positionNow(playing({ paused: true }), 1_999_999)).toBe(5_000);
  });

  it("is frozen when no clip is loaded", () => {
    expect(positionNow(INITIAL_ROOM_STATE, 5_000_000)).toBe(0);
  });

  it("never runs past the end of the clip", () => {
    // A room left playing overnight would otherwise compute a target hours
    // past the end, and every follower would hard-seek forever.
    expect(positionNow(playing(), 9_000_000)).toBe(30_000);
  });

  it("does not run backwards when a client's clock is behind the anchor", () => {
    expect(positionNow(playing(), 999_000)).toBe(5_000);
  });

  it("advances unbounded when the duration is unknown", () => {
    expect(positionNow(playing({ clipDurationMs: null }), 1_100_000)).toBe(105_000);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/realtime/room-state.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/lib/realtime/room-state.ts`:

```ts
import type { RoomState } from "./envelope";

export const INITIAL_ROOM_STATE: RoomState = {
  clipId: null,
  clipTitle: null,
  clipDurationMs: null,
  hostUserId: null,
  paused: true,
  positionMs: 0,
  anchorServerTime: 0,
  rev: 0,
};

/**
 * The playhead as of `serverNow`, in server time.
 *
 * Both processes use this: `realtime` to freeze the position when the room
 * pauses or loses its host, and the browser to compute the target it corrects
 * drift against. Keeping one implementation is what stops the two from
 * disagreeing about where "now" is.
 */
export function positionNow(state: RoomState, serverNow: number): number {
  if (state.paused || state.clipId === null) {
    return state.positionMs;
  }

  // A client whose offset estimate lands behind the anchor must not rewind the
  // room; clamping at zero elapsed is cheaper than trusting the sample.
  const elapsed = Math.max(0, serverNow - state.anchorServerTime);
  const raw = state.positionMs + elapsed;

  return state.clipDurationMs === null ? raw : Math.min(raw, state.clipDurationMs);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/lib/realtime/room-state.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/realtime/room-state.ts src/lib/realtime/room-state.test.ts
git commit -m "feat: add the shared playhead arithmetic

One implementation of 'where is the playhead now', imported by both
processes. Clamped at the clip duration so a room left playing overnight
does not make every follower hard-seek forever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The authoritative Room

The heart of the milestone: who the host is, where the playhead is, and which commands are allowed. No I/O, no sockets, injected clock — so the whole host model is testable without a network.

**Files:**
- Create: `src/realtime/room.ts`
- Create: `src/realtime/room.test.ts`

**Interfaces:**
- Consumes: `RoomState`, `ClientMessage` from Task 2; `INITIAL_ROOM_STATE`, `positionNow` from Task 3.
- Produces:
  - `REQUEST_CONTROL_COOLDOWN_MS = 10_000`
  - `type RoomControl = Extract<ClientMessage, { t: "room.control" }>`
  - `class Room` with `state`, `members`, `join`, `leave`, `claimHost`, `giveControl`, `control`, `requestControl`.
  - Every mutator returns `boolean` — `true` when the state changed and a snapshot should be published. `requestControl` returns `string | null`.

- [ ] **Step 1: Write the failing tests**

Create `src/realtime/room.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { REQUEST_CONTROL_COOLDOWN_MS, Room } from "@/realtime/room";

function roomAt(start = 1_000) {
  let clock = start;
  const room = new Room(() => clock);
  return {
    room,
    advance: (ms: number) => (clock += ms),
    get now() {
      return clock;
    },
  };
}

const setAce = {
  t: "room.control",
  action: "setClip",
  clipId: "01A",
  title: "ace",
  durationMs: 30_000,
} as const;

describe("Room — membership and host", () => {
  it("starts empty, hostless and paused", () => {
    const { room } = roomAt();
    expect(room.members).toEqual([]);
    expect(room.state.hostUserId).toBeNull();
    expect(room.state.paused).toBe(true);
  });

  it("makes the first person in the host", () => {
    const { room } = roomAt();
    expect(room.join("sam")).toBe(true);
    expect(room.state.hostUserId).toBe("sam");
  });

  it("does not promote the second person", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    expect(room.state.hostUserId).toBe("sam");
    expect(room.members.sort()).toEqual(["dave", "sam"]);
  });

  it("reports no change when someone joins twice", () => {
    const { room } = roomAt();
    room.join("sam");
    expect(room.join("sam")).toBe(false);
  });

  it("bumps rev on every change that happened", () => {
    const { room } = roomAt();
    room.join("sam");
    const first = room.state.rev;
    room.join("dave");
    expect(room.state.rev).toBeGreaterThan(first);
  });

  it("does not bump rev on a no-op", () => {
    const { room } = roomAt();
    room.join("sam");
    const rev = room.state.rev;
    room.join("sam");
    expect(room.state.rev).toBe(rev);
  });
});

describe("Room — the host leaving", () => {
  it("goes hostless and pauses rather than auto-promoting", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.control("sam", setAce);

    expect(room.leave("sam")).toBe(true);
    expect(room.state.hostUserId).toBeNull();
    expect(room.state.paused).toBe(true);
    expect(room.members).toEqual(["dave"]);
  });

  it("freezes the playhead where it actually was when the host left", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    advance(4_000);

    room.leave("sam");
    expect(room.state.positionMs).toBe(4_000);
  });

  it("lets anyone present claim the empty chair", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.leave("sam");

    expect(room.claimHost("dave")).toBe(true);
    expect(room.state.hostUserId).toBe("dave");
  });

  it("refuses a claim while there is a host", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");

    expect(room.claimHost("dave")).toBe(false);
    expect(room.state.hostUserId).toBe("sam");
  });

  it("refuses a claim from someone who is not in the room", () => {
    // Otherwise anyone holding a socket on the grid could seize a hostless
    // room without ever joining it.
    const { room } = roomAt();
    room.join("sam");
    room.leave("sam");

    expect(room.claimHost("stranger")).toBe(false);
    expect(room.state.hostUserId).toBeNull();
  });

  it("leaves the host and playback alone when a follower goes", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.control("sam", setAce);

    expect(room.leave("dave")).toBe(true);
    expect(room.state.hostUserId).toBe("sam");
    expect(room.state.paused).toBe(false);
  });

  it("reports no change when someone who was never in leaves", () => {
    const { room } = roomAt();
    expect(room.leave("ghost")).toBe(false);
  });
});

describe("Room — handoff", () => {
  it("hands control over immediately, with no accept step", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");

    expect(room.giveControl("sam", "dave")).toBe(true);
    expect(room.state.hostUserId).toBe("dave");
  });

  it("ignores a handoff from someone who is not the host", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");

    expect(room.giveControl("dave", "dave")).toBe(false);
    expect(room.state.hostUserId).toBe("sam");
  });

  it("ignores a handoff to someone who is not in the room", () => {
    const { room } = roomAt();
    room.join("sam");

    expect(room.giveControl("sam", "ghost")).toBe(false);
    expect(room.state.hostUserId).toBe("sam");
  });

  it("does not pause when control changes hands mid-playback", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.join("dave");
    room.control("sam", setAce);
    advance(2_000);
    room.giveControl("sam", "dave");

    expect(room.state.paused).toBe(false);
  });
});

describe("Room — control authorization", () => {
  it("drops a follower's control command silently", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.control("sam", setAce);
    const rev = room.state.rev;

    expect(room.control("dave", { t: "room.control", action: "pause" })).toBe(false);
    expect(room.state.paused).toBe(false);
    expect(room.state.rev).toBe(rev);
  });

  it("drops a control command while the room is hostless", () => {
    const { room } = roomAt();
    room.join("sam");
    room.leave("sam");
    room.join("dave");

    expect(room.control("dave", { t: "room.control", action: "play" })).toBe(false);
  });
});

describe("Room — transport", () => {
  it("starts a clip at zero and playing", () => {
    const { room } = roomAt();
    room.join("sam");
    room.control("sam", setAce);

    expect(room.state).toMatchObject({
      clipId: "01A",
      clipTitle: "ace",
      clipDurationMs: 30_000,
      positionMs: 0,
      paused: false,
    });
  });

  it("stamps the anchor with the server's own clock", () => {
    const { room, now } = roomAt(5_555);
    room.join("sam");
    room.control("sam", setAce);

    expect(room.state.anchorServerTime).toBe(now);
  });

  it("freezes the real playhead on pause", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    advance(3_500);
    room.control("sam", { t: "room.control", action: "pause" });

    expect(room.state.positionMs).toBe(3_500);
    expect(room.state.paused).toBe(true);
  });

  it("resumes from where it paused, not from where the clock is", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    advance(3_000);
    room.control("sam", { t: "room.control", action: "pause" });
    advance(60_000);
    room.control("sam", { t: "room.control", action: "play" });

    expect(room.state.positionMs).toBe(3_000);
    expect(room.state.paused).toBe(false);
  });

  it("re-anchors on seek so followers do not double-count the elapsed time", () => {
    const { room, advance, now } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    advance(3_000);
    room.control("sam", { t: "room.control", action: "seek", positionMs: 12_000 });

    expect(room.state.positionMs).toBe(12_000);
    expect(room.state.anchorServerTime).toBe(now);
  });

  it("keeps a seek while paused paused", () => {
    const { room } = roomAt();
    room.join("sam");
    room.control("sam", setAce);
    room.control("sam", { t: "room.control", action: "pause" });
    room.control("sam", { t: "room.control", action: "seek", positionMs: 8_000 });

    expect(room.state.paused).toBe(true);
    expect(room.state.positionMs).toBe(8_000);
  });

  it("reports no change for a play that is already playing", () => {
    const { room } = roomAt();
    room.join("sam");
    room.control("sam", setAce);

    expect(room.control("sam", { t: "room.control", action: "play" })).toBe(false);
  });

  it("reports no change for a play with no clip loaded", () => {
    const { room } = roomAt();
    room.join("sam");

    expect(room.control("sam", { t: "room.control", action: "play" })).toBe(false);
  });
});

describe("Room — requesting control", () => {
  it("names the host to notify", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");

    expect(room.requestControl("dave")).toBe("sam");
  });

  it("returns null when there is no host to ask", () => {
    const { room } = roomAt();
    room.join("sam");
    room.leave("sam");
    room.join("dave");

    expect(room.requestControl("dave")).toBeNull();
  });

  it("returns null when the host asks itself", () => {
    const { room } = roomAt();
    room.join("sam");

    expect(room.requestControl("sam")).toBeNull();
  });

  it("returns null for someone who is not in the room", () => {
    const { room } = roomAt();
    room.join("sam");

    expect(room.requestControl("stranger")).toBeNull();
  });

  it("rate-limits a second request inside the cooldown", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.join("dave");
    room.requestControl("dave");
    advance(REQUEST_CONTROL_COOLDOWN_MS - 1);

    expect(room.requestControl("dave")).toBeNull();
  });

  it("allows another request once the cooldown has passed", () => {
    const { room, advance } = roomAt();
    room.join("sam");
    room.join("dave");
    room.requestControl("dave");
    advance(REQUEST_CONTROL_COOLDOWN_MS);

    expect(room.requestControl("dave")).toBe("sam");
  });

  it("rate-limits per user, not globally", () => {
    const { room } = roomAt();
    room.join("sam");
    room.join("dave");
    room.join("kai");
    room.requestControl("dave");

    expect(room.requestControl("kai")).toBe("sam");
  });
});
```

The "does not double-count the elapsed time" test is the one that catches the classic seek bug: set `positionMs` without re-anchoring and every follower adds the time since the *old* anchor on top of the new position.

- [ ] **Step 2: Run them and watch them fail**

Run: `bun test src/realtime/room.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Room**

Create `src/realtime/room.ts`:

```ts
import type { ClientMessage, RoomState } from "@/lib/realtime/envelope";
import { INITIAL_ROOM_STATE, positionNow } from "@/lib/realtime/room-state";

export type RoomControl = Extract<ClientMessage, { t: "room.control" }>;

/**
 * How long a user must wait before asking for control again. Requests are not
 * queued or persisted — an ignored one simply expires from the host's UI — so
 * the only thing stopping a frustrated clicker from filling the host's screen
 * is this.
 */
export const REQUEST_CONTROL_COOLDOWN_MS = 10_000;

/**
 * The room. There is exactly one, it lives in memory, and it is the sole
 * authority on what is playing and who may change it.
 *
 * It holds no database connection and performs no I/O: every mutator is a
 * synchronous state transition against an injected clock. That is what makes
 * the whole host model testable without a socket, and what keeps the realtime
 * process non-blocking.
 *
 * State is deliberately lost on restart. A room is a thing people are in right
 * now; persisting one would mean restoring a playhead nobody is watching.
 */
export class Room {
  #state: RoomState = { ...INITIAL_ROOM_STATE };
  readonly #members = new Set<string>();
  readonly #lastRequest = new Map<string, number>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  get state(): RoomState {
    return this.#state;
  }

  get members(): string[] {
    return [...this.#members];
  }

  #commit(next: Partial<RoomState>): true {
    this.#state = { ...this.#state, ...next, rev: this.#state.rev + 1 };
    return true;
  }

  /** The playhead frozen where it actually is, as of now. */
  #frozen(): Pick<RoomState, "positionMs" | "anchorServerTime"> {
    const now = this.#now();
    return { positionMs: positionNow(this.#state, now), anchorServerTime: now };
  }

  join(user: string): boolean {
    if (this.#members.has(user)) {
      return false;
    }

    this.#members.add(user);

    // First person in takes the chair. Everyone else follows.
    // rev still moves even when only membership changed: membership rides on
    // presence, but clients apply both from the same ordered stream.
    return this.#commit(this.#state.hostUserId === null ? { hostUserId: user } : {});
  }

  leave(user: string): boolean {
    if (!this.#members.delete(user)) {
      return false;
    }

    if (this.#state.hostUserId !== user) {
      return this.#commit({});
    }

    // The room does not auto-promote: it goes hostless and pauses where it is,
    // and someone present claims it deliberately.
    return this.#commit({ ...this.#frozen(), hostUserId: null, paused: true });
  }

  claimHost(user: string): boolean {
    if (this.#state.hostUserId !== null || !this.#members.has(user)) {
      return false;
    }

    return this.#commit({ hostUserId: user });
  }

  giveControl(from: string, to: string): boolean {
    if (this.#state.hostUserId !== from || !this.#members.has(to) || from === to) {
      return false;
    }

    // Immediate, with no accept prompt. Among friends a surprise promotion is
    // funny, and an accept round-trip adds a pending state for no gain.
    return this.#commit({ hostUserId: to });
  }

  control(user: string, command: RoomControl): boolean {
    // The single enforcement point. The client disables controls for UX; this
    // is what actually stops a follower.
    if (this.#state.hostUserId !== user) {
      return false;
    }

    const now = this.#now();

    switch (command.action) {
      case "setClip":
        return this.#commit({
          clipId: command.clipId ?? null,
          clipTitle: command.title ?? "",
          clipDurationMs: command.durationMs ?? null,
          positionMs: 0,
          anchorServerTime: now,
          paused: false,
        });

      case "pause":
        return this.#state.paused ? false : this.#commit({ ...this.#frozen(), paused: true });

      case "play":
        if (!this.#state.paused || this.#state.clipId === null) {
          return false;
        }

        // Resume from where it froze, re-anchored to now.
        return this.#commit({ anchorServerTime: now, paused: false });

      case "seek":
        // Re-anchoring is not optional: leave the old anchor and every
        // follower adds the time since it on top of the new position.
        return this.#commit({ positionMs: command.positionMs ?? 0, anchorServerTime: now });
    }
  }

  /**
   * Returns the host to notify, or null when there is nobody to ask, the
   * asker is the host or not present, or they are inside the cooldown.
   */
  requestControl(user: string): string | null {
    const host = this.#state.hostUserId;

    if (host === null || host === user || !this.#members.has(user)) {
      return null;
    }

    const now = this.#now();
    const last = this.#lastRequest.get(user);

    if (last !== undefined && now - last < REQUEST_CONTROL_COOLDOWN_MS) {
      return null;
    }

    this.#lastRequest.set(user, now);
    return host;
  }
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `bun test src/realtime/room.test.ts`
Expected: PASS, 30 tests.

- [ ] **Step 5: Mutation-test the authorization check**

This is the security-relevant line in the milestone. Prove the test can see it break:

```bash
sed -i 's/if (this.#state.hostUserId !== user) {/if (false) {/' src/realtime/room.ts
bun test src/realtime/room.test.ts
```

Expected: FAIL on "drops a follower's control command silently". Then restore:

```bash
git checkout -- src/realtime/room.ts 2>/dev/null || sed -i 's/if (false) {/if (this.#state.hostUserId !== user) {/' src/realtime/room.ts
bun test src/realtime/room.test.ts
```

Expected: PASS again. If the suite stayed green with `if (false)`, the test is worthless — fix it before moving on.

- [ ] **Step 6: Commit**

```bash
git add src/realtime/room.ts src/realtime/room.test.ts
git commit -m "feat: add the authoritative room

No I/O, injected clock, every mutator a synchronous transition — the whole
host model is testable without a socket. Control is authorized against
hostUserId here and nowhere else; the client's disabled buttons are UX.

Seek re-anchors. Without it every follower adds the time since the old
anchor on top of the new position.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Wire the room into the socket server

Route `room.*` frames into the `Room`, publish snapshots, and deliver `room.controlRequested` to one person.

**Files:**
- Modify: `src/realtime/hub.ts`
- Modify: `src/realtime/hub.test.ts`
- Modify: `src/realtime/index.ts`
- Modify: `src/realtime/index.test.ts`

**Interfaces:**
- Consumes: `Room`, `RoomControl` from Task 4; `Hub` from milestone 4.
- Produces: `Hub.sendTo(username: string, message: ServerMessage): number`

- [ ] **Step 1: Write the failing test for `sendTo`**

Append to `src/realtime/hub.test.ts`:

```ts
describe("Hub.sendTo", () => {
  const requested: ServerMessage = { t: "room.controlRequested", user: "dave" };

  it("delivers to every socket of that user and nobody else", () => {
    const hub = new Hub();
    const phone = fakeSocket();
    const laptop = fakeSocket();
    const other = fakeSocket();
    hub.add(phone.socket, "sam");
    hub.add(laptop.socket, "sam");
    hub.add(other.socket, "dave");
    hub.subscribe(phone.socket, ["room"]);
    hub.subscribe(laptop.socket, ["room"]);
    hub.subscribe(other.socket, ["room"]);

    expect(hub.sendTo("sam", requested)).toBe(2);
    expect(phone.sent).toHaveLength(1);
    expect(laptop.sent).toHaveLength(1);
    expect(other.sent).toEqual([]);
  });

  it("skips a socket of that user that is not on the room topic", () => {
    const hub = new Hub();
    const gridOnly = fakeSocket();
    hub.add(gridOnly.socket, "sam");
    hub.subscribe(gridOnly.socket, ["grid"]);

    expect(hub.sendTo("sam", requested)).toBe(0);
  });

  it("delivers nothing for a user with no sockets", () => {
    expect(new Hub().sendTo("ghost", requested)).toBe(0);
  });

  it("evicts a socket that throws and keeps going", () => {
    const hub = new Hub();
    const healthy = fakeSocket();
    const broken: Sendable = {
      send: () => {
        throw new Error("closed");
      },
    };
    hub.add(broken, "sam");
    hub.add(healthy.socket, "sam");
    hub.subscribe(broken, ["room"]);
    hub.subscribe(healthy.socket, ["room"]);

    expect(hub.sendTo("sam", requested)).toBe(1);
    expect(hub.size).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/realtime/hub.test.ts`
Expected: FAIL — `hub.sendTo is not a function`.

- [ ] **Step 3: Implement `sendTo`**

Add to `src/realtime/hub.ts`, after `publish`:

```ts
  /**
   * Deliver to one person's sockets rather than a topic.
   *
   * `room.controlRequested` is the only message that has a single recipient:
   * the host. Broadcasting it on the room topic would show everyone in the
   * theater a prompt only the host can act on.
   *
   * Still gated on the message's topic — a socket that never asked for `room`
   * should not receive room messages by virtue of who is holding it.
   */
  sendTo(username: string, message: ServerMessage): number {
    const topic = topicFor(message);
    const payload = JSON.stringify(message);
    let delivered = 0;

    for (const [socket, entry] of [...this.#sockets.entries()]) {
      if (entry.username !== username || !entry.topics.has(topic)) {
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
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/realtime/hub.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing end-to-end socket test**

Append to `src/realtime/index.test.ts`. It already boots the server on port 3099 in `beforeAll`; reuse it. Add these type imports at the top of the file:

```ts
import type { ClientMessage, ServerMessage } from "@/lib/realtime/envelope";
import { WebSocket as NodeWebSocket } from "ws";
```

Then the helpers and the tests:

```ts
function connect(username: string): Promise<NodeWebSocket> {
  // `ws` on the client side lets us set the header Caddy normally injects.
  const socket = new NodeWebSocket(`ws://localhost:${PORT}/ws`, {
    headers: { "X-Authentik-Username": username },
  });

  return new Promise((resolve, reject) => {
    socket.on("open", () => resolve(socket));
    socket.on("error", reject);
  });
}

function nextMessage(
  socket: NodeWebSocket,
  predicate: (message: ServerMessage) => boolean,
): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for a message")), 2_000);

    const onMessage = (data: unknown) => {
      const message = JSON.parse(String(data)) as ServerMessage;

      if (predicate(message)) {
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(message);
      }
    };

    socket.on("message", onMessage);
  });
}

function send(socket: NodeWebSocket, message: ClientMessage): void {
  socket.send(JSON.stringify(message));
}

describe("room over the socket", () => {
  it("hands a fresh subscriber the current snapshot", async () => {
    const socket = await connect("snapshot-watcher");
    send(socket, { t: "sub", topics: ["room"] });

    const message = await nextMessage(socket, (m) => m.t === "room");
    expect(message.t).toBe("room");
    socket.close();
  });

  it("makes the first joiner host and tells everyone", async () => {
    const socket = await connect("first-in");
    send(socket, { t: "sub", topics: ["room"] });
    await nextMessage(socket, (m) => m.t === "room");
    send(socket, { t: "room.join" });

    const message = await nextMessage(
      socket,
      (m) => m.t === "room" && m.state.hostUserId === "first-in",
    );
    expect(message.t).toBe("room");
    socket.close();
  });

  it("drops a follower's control command without answering", async () => {
    const host = await connect("the-host");
    const follower = await connect("the-follower");
    send(host, { t: "sub", topics: ["room"] });
    send(follower, { t: "sub", topics: ["room"] });
    await nextMessage(host, (m) => m.t === "room");
    send(host, { t: "room.join" });
    await nextMessage(host, (m) => m.t === "room" && m.state.hostUserId === "the-host");
    send(follower, { t: "room.join" });
    await nextMessage(follower, (m) => m.t === "room");
    send(host, {
      t: "room.control", action: "setClip", clipId: "01A", title: "ace", durationMs: 30_000,
    });
    const playing = await nextMessage(follower, (m) => m.t === "room" && m.state.clipId === "01A");
    const revBefore = playing.t === "room" ? playing.state.rev : -1;

    send(follower, { t: "room.control", action: "pause" });
    await Bun.sleep(100);
    send(host, { t: "room.control", action: "seek", positionMs: 1_000 });
    const after = await nextMessage(follower, (m) => m.t === "room" && m.state.positionMs === 1_000);

    // The follower's pause produced no snapshot between the two: rev moved by
    // exactly one, for the host's seek.
    expect(after.t === "room" && after.state.rev).toBe(revBefore + 1);
    expect(after.t === "room" && after.state.paused).toBe(false);
    host.close();
    follower.close();
  });

  it("sends a control request to the host alone", async () => {
    const host = await connect("req-host");
    const asker = await connect("req-asker");
    const bystander = await connect("req-bystander");

    for (const socket of [host, asker, bystander]) {
      send(socket, { t: "sub", topics: ["room"] });
      await nextMessage(socket, (m) => m.t === "room");
    }

    send(host, { t: "room.join" });
    await nextMessage(host, (m) => m.t === "room" && m.state.hostUserId === "req-host");
    send(asker, { t: "room.join" });
    await nextMessage(asker, (m) => m.t === "room");

    const waiting = nextMessage(host, (m) => m.t === "room.controlRequested");
    let bystanderSaw = false;
    bystander.on("message", (data) => {
      if ((JSON.parse(String(data)) as ServerMessage).t === "room.controlRequested") {
        bystanderSaw = true;
      }
    });

    send(asker, { t: "room.requestControl" });
    expect(await waiting).toEqual({ t: "room.controlRequested", user: "req-asker" });
    expect(bystanderSaw).toBe(false);
    host.close();
    asker.close();
    bystander.close();
  });

  it("goes hostless and pauses when the host's socket drops", async () => {
    const host = await connect("drop-host");
    const watcher = await connect("drop-watcher");
    send(host, { t: "sub", topics: ["room"] });
    send(watcher, { t: "sub", topics: ["room"] });
    await nextMessage(watcher, (m) => m.t === "room");
    send(host, { t: "room.join" });
    await nextMessage(watcher, (m) => m.t === "room" && m.state.hostUserId === "drop-host");

    host.close();
    const message = await nextMessage(watcher, (m) => m.t === "room" && m.state.hostUserId === null);
    expect(message.t === "room" && message.state.paused).toBe(true);
    watcher.close();
  });
});
```

These tests share one long-lived `Room` across the file, so every test uses distinct usernames and asserts on *transitions* rather than absolute state. That is deliberate — a per-test reset would need an export that exists only for tests.

- [ ] **Step 6: Run them and watch them fail**

Run: `bun test src/realtime/index.test.ts`
Expected: FAIL — no snapshot arrives on `sub`, room frames are ignored.

- [ ] **Step 7: Wire it up**

In `src/realtime/index.ts`, import the Room and create one beside the hub:

```ts
import type { ClientMessage } from "@/lib/realtime/envelope";
import type { WebSocket } from "ws";
import { Hub } from "./hub";
import { Room } from "./room";

const hub = new Hub();
const room = new Room();
```

Add two helpers above `export const server`:

```ts
function publishRoom(): void {
  hub.publish({ t: "room", state: room.state });
}

function publishPresence(): void {
  hub.publish({ t: "presence", online: hub.online, inRoom: room.members });
}
```

Replace every `hub.publish({ t: "presence", online: hub.online, inRoom: [] })` with `publishPresence()`.

Add the room handler, above `export const server`:

```ts
function handleRoomMessage(ws: WebSocket, username: string, message: ClientMessage): void {
  switch (message.t) {
    case "room.join":
      if (room.join(username)) {
        publishRoom();
        publishPresence();
      }

      return;

    case "room.leave":
      if (room.leave(username)) {
        publishRoom();
        publishPresence();
      }

      return;

    case "room.claimHost":
      if (room.claimHost(username)) {
        publishRoom();
      }

      return;

    case "room.giveControl":
      if (room.giveControl(username, message.userId)) {
        publishRoom();
      }

      return;

    case "room.control":
      // An unauthorized command returns false and is dropped in silence. The
      // sender's client already shows disabled controls; a rejection message
      // would only invite the client to become the enforcement point.
      if (room.control(username, message)) {
        publishRoom();
      }

      return;

    case "room.requestControl": {
      const host = room.requestControl(username);

      if (host !== null) {
        hub.sendTo(host, { t: "room.controlRequested", user: username });
      }

      return;
    }

    default:
      return;
  }
}
```

Replace the message handler and `drop` inside `wss.handleUpgrade`:

```ts
    ws.on("message", (data) => {
      // A malformed frame from one client must never disturb the process or
      // the other sockets, so a parse failure is ignored rather than thrown.
      const message = parseClientMessage(String(data));

      if (message === null) {
        return;
      }

      if (message.t === "sub") {
        hub.subscribe(ws, message.topics);
        // Send presence and the room snapshot straight away; otherwise a fresh
        // subscriber sees nobody and an empty theater until the next change.
        ws.send(JSON.stringify({ t: "presence", online: hub.online, inRoom: room.members }));

        if (message.topics.includes("room")) {
          ws.send(JSON.stringify({ t: "room", state: room.state }));
        }

        return;
      }

      if (message.t === "time.sync") {
        // t1 is stamped with the server's clock. The browser's Cristian
        // offset is computed from this, so a client-supplied t1 is useless.
        ws.send(JSON.stringify({ t: "time.sync", t0: message.t0, t1: Date.now() }));
        return;
      }

      handleRoomMessage(ws, username, message);
    });

    const drop = () => {
      hub.remove(ws);

      // Only a person's LAST socket leaving counts as leaving the room —
      // otherwise closing a second tab drops you out of the theater.
      const changed = hub.online.includes(username) ? false : room.leave(username);

      if (changed) {
        publishRoom();
      }

      publishPresence();
    };
```

- [ ] **Step 8: Run them and watch them pass**

Run: `bun test src/realtime/`
Expected: PASS.

- [ ] **Step 9: Run the whole suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 10: Check the realtime process still starts**

```bash
EMIT_SECRET=x REALTIME_PORT=3098 timeout 3 bun src/realtime/index.ts
```

Expected: `realtime listening on :3098`, then the timeout kills it. A room that accidentally imported something from `web` would fail here, not in the tests.

- [ ] **Step 11: Commit**

```bash
git add src/realtime/hub.ts src/realtime/hub.test.ts src/realtime/index.ts src/realtime/index.test.ts
git commit -m "feat: route room commands through the socket server

Snapshot on subscribe, targeted delivery for the host's control prompt, and
a last-socket-wins leave so closing a second tab does not drop you out of
the theater.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The clock

Cristian's algorithm. Without a shared clock every other number in this milestone is meaningless.

**Files:**
- Create: `src/lib/theater/clock.ts`
- Create: `src/lib/theater/clock.test.ts`
- Create: `src/lib/theater/sampler.ts`
- Create: `src/lib/theater/sampler.test.ts`

**Interfaces:**
- Produces:
  - `type ClockSample = { t0: number; t1: number; t2: number }`
  - `offsetFromSamples(samples: ClockSample[]): number`
  - `class ServerClock` — `record(sample)`, `offset`, `sampled`, `now(localNow: number)`
  - `SAMPLE_COUNT = 5`, `RESAMPLE_INTERVAL_MS = 30_000`
  - `startClockSampler(options): { receive(message), stop() }`

- [ ] **Step 1: Write the failing clock test**

Create `src/lib/theater/clock.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { offsetFromSamples, ServerClock, type ClockSample } from "@/lib/theater/clock";

/** A sample for a client whose clock is `offset` ms behind the server. */
function sample(offset: number, rtt: number, asymmetry = 0): ClockSample {
  const t0 = 1_000;
  const t2 = t0 + rtt;
  // The server stamps t1 somewhere inside the round trip.
  const t1 = t0 + rtt / 2 + asymmetry + offset;
  return { t0, t1, t2 };
}

describe("offsetFromSamples", () => {
  it("is zero with no samples, so an unsampled clock is simply the local one", () => {
    expect(offsetFromSamples([])).toBe(0);
  });

  it("recovers a clean offset from a symmetric round trip", () => {
    expect(offsetFromSamples([sample(4_000, 40)])).toBe(4_000);
  });

  it("keeps the lowest-RTT sample, not the average", () => {
    // The long samples are badly distorted; a mean would drag the answer away.
    const samples = [sample(4_000, 500, 200), sample(4_000, 20), sample(4_000, 600, -250)];
    expect(offsetFromSamples(samples)).toBe(4_000);
  });

  it("handles a client running ahead of the server", () => {
    expect(offsetFromSamples([sample(-2_500, 30)])).toBe(-2_500);
  });
});

describe("ServerClock", () => {
  it("reports the local clock until it has a sample", () => {
    const clock = new ServerClock();
    expect(clock.sampled).toBe(false);
    expect(clock.now(1_234)).toBe(1_234);
  });

  it("shifts local time by the measured offset", () => {
    const clock = new ServerClock();
    clock.record(sample(4_000, 40));

    expect(clock.sampled).toBe(true);
    expect(clock.now(1_000)).toBe(5_000);
  });

  it("keeps only the most recent window of samples", () => {
    const clock = new ServerClock();
    // Six samples at a large offset, then five at a small one: the old ones
    // must have fallen out of the window entirely.
    for (let i = 0; i < 6; i += 1) {
      clock.record(sample(10_000, 30));
    }

    for (let i = 0; i < 5; i += 1) {
      clock.record(sample(100, 30));
    }

    expect(clock.offset).toBe(100);
  });

  it("prefers a low-RTT sample inside the window over a newer noisy one", () => {
    const clock = new ServerClock();
    clock.record(sample(4_000, 10));
    clock.record(sample(4_000, 800, 300));

    expect(clock.offset).toBe(4_000);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/theater/clock.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the clock**

Create `src/lib/theater/clock.ts`:

```ts
/** One round trip: we sent t0, the server stamped t1, we received it at t2. */
export type ClockSample = { t0: number; t1: number; t2: number };

/** How many samples the offset is chosen from. */
export const SAMPLE_COUNT = 5;

/** How often the handshake re-runs. Clocks drift; 30s keeps it honest. */
export const RESAMPLE_INTERVAL_MS = 30_000;

/**
 * Cristian's algorithm — the basis of NTP/SNTP.
 *
 *   offset = ((t1 - t0) + (t1 - t2)) / 2
 *   rtt    = t2 - t0
 *
 * Keep the offset from the LOWEST-RTT sample rather than the median. The
 * algorithm assumes a symmetric round trip, and the shortest round trip is the
 * one least distorted by queuing — a median averages the bad samples in
 * instead of discarding them.
 */
export function offsetFromSamples(samples: ClockSample[]): number {
  let best: ClockSample | null = null;
  let bestRtt = Infinity;

  for (const candidate of samples) {
    const rtt = candidate.t2 - candidate.t0;

    if (rtt < bestRtt) {
      bestRtt = rtt;
      best = candidate;
    }
  }

  if (best === null) {
    return 0;
  }

  return (best.t1 - best.t0 + (best.t1 - best.t2)) / 2;
}

/**
 * The browser's estimate of the server's clock.
 *
 * Everything in the theater is expressed in server time: `anchorServerTime` on
 * the room snapshot, and the target playhead derived from it. This is the one
 * place that converts.
 */
export class ServerClock {
  #samples: ClockSample[] = [];
  #offset = 0;

  record(sample: ClockSample): void {
    this.#samples = [...this.#samples, sample].slice(-SAMPLE_COUNT);
    this.#offset = offsetFromSamples(this.#samples);
  }

  get offset(): number {
    return this.#offset;
  }

  /** False until the first sample lands — the caller may want to wait. */
  get sampled(): boolean {
    return this.#samples.length > 0;
  }

  now(localNow: number): number {
    return localNow + this.#offset;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/lib/theater/clock.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing sampler test**

Create `src/lib/theater/sampler.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { ClientMessage } from "@/lib/realtime/envelope";
import { ServerClock } from "@/lib/theater/clock";
import { startClockSampler } from "@/lib/theater/sampler";

function harness() {
  const sent: ClientMessage[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let clock = 1_000;
  const serverClock = new ServerClock();

  const sampler = startClockSampler({
    clock: serverClock,
    send: (message) => sent.push(message),
    now: () => clock,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length - 1;
    },
    clearTimer: () => {},
  });

  return {
    sent,
    timers,
    serverClock,
    stop: sampler.stop,
    receive: sampler.receive,
    advance: (ms: number) => (clock += ms),
    fireTimers: () => {
      for (const timer of timers.splice(0, timers.length)) {
        timer.fn();
      }
    },
  };
}

describe("startClockSampler", () => {
  it("sends a first sample immediately", () => {
    const h = harness();
    expect(h.sent).toEqual([{ t: "time.sync", t0: 1_000 }]);
    h.stop();
  });

  it("feeds a reply into the clock", () => {
    const h = harness();
    h.advance(40);
    h.receive({ t: "time.sync", t0: 1_000, t1: 5_020 });

    expect(h.serverClock.sampled).toBe(true);
    expect(h.serverClock.offset).toBe(4_000);
    h.stop();
  });

  it("ignores a reply whose t0 it never sent", () => {
    // Otherwise a stray or replayed frame could inject an arbitrary offset.
    const h = harness();
    h.receive({ t: "time.sync", t0: 999_999, t1: 5_000 });

    expect(h.serverClock.sampled).toBe(false);
    h.stop();
  });

  it("ignores a second reply for the same t0", () => {
    const h = harness();
    h.advance(40);
    h.receive({ t: "time.sync", t0: 1_000, t1: 5_020 });
    h.receive({ t: "time.sync", t0: 1_000, t1: 9_999 });

    expect(h.serverClock.offset).toBe(4_000);
    h.stop();
  });

  it("ignores messages that are not time.sync", () => {
    const h = harness();
    h.receive({ t: "presence", online: ["sam"], inRoom: [] });

    expect(h.serverClock.sampled).toBe(false);
    h.stop();
  });

  it("keeps sampling through the burst", () => {
    const h = harness();
    h.advance(200);
    h.fireTimers();

    expect(h.sent).toHaveLength(2);
    h.stop();
  });

  it("stops sending once stopped", () => {
    const h = harness();
    h.stop();
    h.fireTimers();

    expect(h.sent).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `bun test src/lib/theater/sampler.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement the sampler**

Create `src/lib/theater/sampler.ts`:

```ts
import type { ClientMessage, ServerMessage } from "@/lib/realtime/envelope";
import { RESAMPLE_INTERVAL_MS, SAMPLE_COUNT, type ServerClock } from "./clock";

/** How long to wait between the five samples of one burst. */
const BURST_GAP_MS = 200;

export type ClockSampler = {
  /** Feed every server message here; it picks out the time.sync replies. */
  receive(message: ServerMessage): void;
  stop(): void;
};

/**
 * Drives the clock handshake: a burst of five samples, then another burst
 * every 30 seconds.
 *
 * Timers are injected rather than reached for, so the whole schedule is
 * testable without waiting 30 real seconds.
 */
export function startClockSampler(options: {
  clock: ServerClock;
  send(message: ClientMessage): void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): ClockSampler {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as never));

  const pending = new Set<number>();
  let remainingInBurst = SAMPLE_COUNT;
  let stopped = false;
  let handle: unknown;

  function sample(): void {
    if (stopped) {
      return;
    }

    const t0 = now();
    pending.add(t0);
    options.send({ t: "time.sync", t0 });
    remainingInBurst -= 1;

    handle =
      remainingInBurst > 0
        ? setTimer(sample, BURST_GAP_MS)
        : setTimer(() => {
            remainingInBurst = SAMPLE_COUNT;
            sample();
          }, RESAMPLE_INTERVAL_MS);
  }

  sample();

  return {
    receive(message) {
      if (message.t !== "time.sync") {
        return;
      }

      // A t0 we never sent — or already consumed — is not ours to trust. It
      // would let a stray frame inject an arbitrary offset.
      if (!pending.delete(message.t0)) {
        return;
      }

      options.clock.record({ t0: message.t0, t1: message.t1, t2: now() });
    },
    stop() {
      stopped = true;
      clearTimer(handle);
    },
  };
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `bun test src/lib/theater/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/theater/clock.ts src/lib/theater/clock.test.ts \
  src/lib/theater/sampler.ts src/lib/theater/sampler.test.ts
git commit -m "feat: add the clock handshake

Cristian's algorithm, keeping the lowest-RTT sample rather than the median:
the algorithm assumes a symmetric round trip, and the shortest trip is the
one least distorted by queuing.

The realtime process has answered time.sync since milestone 1. This is its
first caller.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The SyncController

The drift bands, behind the interface the spec names. Pure decision function first, then the controller around it.

**Files:**
- Create: `src/lib/theater/sync-controller.ts`
- Create: `src/lib/theater/sync-controller.test.ts`

**Interfaces:**
- Consumes: `RoomState`, `positionNow`.
- Produces:
  - `DRIFT_IGNORE_MS = 150`, `DRIFT_SEEK_MS = 750`, `DRIFT_SETTLE_MS = 50`, `NUDGE = 0.05`, `TICK_MS = 500`
  - `type Correction = { kind: "hold" } | { kind: "rate"; rate: number } | { kind: "seek" }`
  - `decideCorrection(driftMs: number, nudging: boolean): Correction`
  - `type VideoLike`, `type SyncController`, `createSyncController(options): SyncController`

- [ ] **Step 1: Write the failing decision tests**

Create `src/lib/theater/sync-controller.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { RoomState } from "@/lib/realtime/envelope";
import {
  createSyncController,
  decideCorrection,
  TICK_MS,
  type VideoLike,
} from "@/lib/theater/sync-controller";

describe("decideCorrection", () => {
  it("holds inside the dead band — correcting here is worse than the error", () => {
    expect(decideCorrection(0, false)).toEqual({ kind: "hold" });
    expect(decideCorrection(149, false)).toEqual({ kind: "hold" });
    expect(decideCorrection(-149, false)).toEqual({ kind: "hold" });
  });

  it("nudges faster when behind", () => {
    expect(decideCorrection(200, false)).toEqual({ kind: "rate", rate: 1.05 });
  });

  it("nudges slower when ahead", () => {
    expect(decideCorrection(-200, false)).toEqual({ kind: "rate", rate: 0.95 });
  });

  it("hard-seeks past the outer band", () => {
    expect(decideCorrection(751, false)).toEqual({ kind: "seek" });
    expect(decideCorrection(-751, false)).toEqual({ kind: "seek" });
  });

  it("keeps nudging below 150 once it has started, down to the settle band", () => {
    // Hysteresis. Stopping at 149 would leave a permanent 149ms error.
    expect(decideCorrection(100, true)).toEqual({ kind: "rate", rate: 1.05 });
    expect(decideCorrection(-100, true)).toEqual({ kind: "rate", rate: 0.95 });
  });

  it("returns to normal speed once it has settled", () => {
    expect(decideCorrection(49, true)).toEqual({ kind: "rate", rate: 1 });
    expect(decideCorrection(-49, true)).toEqual({ kind: "rate", rate: 1 });
  });

  it("switches direction if a nudge overshoots", () => {
    expect(decideCorrection(-300, true)).toEqual({ kind: "rate", rate: 0.95 });
  });
});

function fakeVideo() {
  const calls: string[] = [];
  const video: VideoLike = {
    currentTime: 0,
    playbackRate: 1,
    preservesPitch: false,
    paused: true,
    play() {
      video.paused = false;
      calls.push("play");
      return Promise.resolve();
    },
    pause() {
      video.paused = true;
      calls.push("pause");
    },
  };

  return { video, calls };
}

function playingState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    clipId: "01A",
    clipTitle: "ace",
    clipDurationMs: 600_000,
    hostUserId: "sam",
    paused: false,
    positionMs: 10_000,
    anchorServerTime: 1_000_000,
    rev: 1,
    ...overrides,
  };
}

function controllerHarness() {
  let localNow = 1_000_000;
  let scheduled: (() => void) | null = null;
  const resyncs: number[] = [];
  const blocked: number[] = [];
  const { video, calls } = fakeVideo();

  const controller = createSyncController({
    clock: { now: (n: number) => n },
    now: () => localNow,
    setTimer: (fn: () => void) => {
      scheduled = fn;
      return 1;
    },
    clearTimer: () => {
      scheduled = null;
    },
    onResync: () => resyncs.push(localNow),
    onAutoplayBlocked: () => blocked.push(localNow),
  });

  return {
    controller,
    video,
    calls,
    resyncs,
    blocked,
    advance: (ms: number) => (localNow += ms),
    tick: () => scheduled?.(),
  };
}

describe("createSyncController", () => {
  it("sets preservesPitch on attach — it is why a 5% nudge is inaudible", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);

    expect(h.video.preservesPitch).toBe(true);
    h.controller.detach();
  });

  it("does nothing before a room state arrives", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.tick();

    expect(h.calls).toEqual([]);
    h.controller.detach();
  });

  it("starts playing and seeks to the target when the room is playing", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.advance(5_000);
    h.tick();

    expect(h.calls).toContain("play");
    // 10s position plus 5s elapsed, against a video at 0 — far outside the
    // outer band, so a hard seek.
    expect(h.video.currentTime).toBeCloseTo(15, 2);
    h.controller.detach();
  });

  it("pauses and parks the playhead when the room is paused", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.video.currentTime = 40;
    h.video.paused = false;
    h.controller.applyRoomState(playingState({ paused: true, positionMs: 8_000 }));

    expect(h.calls).toContain("pause");
    expect(h.video.currentTime).toBeCloseTo(8, 2);
    h.controller.detach();
  });

  it("nudges rather than seeks for a small drift", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.currentTime = 10;
    h.video.paused = false;
    h.advance(300);
    h.tick();

    expect(h.video.playbackRate).toBe(1.05);
    expect(h.video.currentTime).toBeCloseTo(10, 2);
    h.controller.detach();
  });

  it("reports a resync when it has to hard-seek", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.currentTime = 10;
    h.video.paused = false;
    h.advance(5_000);
    h.tick();

    expect(h.resyncs).toHaveLength(1);
    h.controller.detach();
  });

  it("does not report a resync for a nudge", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.currentTime = 10;
    h.video.paused = false;
    h.advance(300);
    h.tick();

    expect(h.resyncs).toEqual([]);
    h.controller.detach();
  });

  it("reports a blocked autoplay instead of throwing", async () => {
    const h = controllerHarness();
    h.video.play = () => Promise.reject(new Error("NotAllowedError"));
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    await Bun.sleep(1);

    expect(h.blocked).toHaveLength(1);
    h.controller.detach();
  });

  it("restores normal playback rate on detach", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.video.currentTime = 10;
    h.video.paused = false;
    h.advance(300);
    h.tick();
    h.controller.detach();

    expect(h.video.playbackRate).toBe(1);
  });

  it("stops ticking after detach", () => {
    const h = controllerHarness();
    h.controller.attach(h.video);
    h.controller.applyRoomState(playingState());
    h.controller.detach();
    const before = h.calls.length;
    h.tick();

    expect(h.calls).toHaveLength(before);
  });

  it("ticks on the interval the spec names", () => {
    expect(TICK_MS).toBe(500);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bun test src/lib/theater/sync-controller.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/lib/theater/sync-controller.ts`:

```ts
import type { RoomState } from "@/lib/realtime/envelope";
import { positionNow } from "@/lib/realtime/room-state";

/** Below this, do nothing — correcting is more disruptive than the error. */
export const DRIFT_IGNORE_MS = 150;

/** Above this, the gap is too big to close smoothly. Hard seek. */
export const DRIFT_SEEK_MS = 750;

/** Once nudging, keep nudging until the drift is inside this. */
export const DRIFT_SETTLE_MS = 50;

/** How far the nudge moves playback rate from 1.0. */
export const NUDGE = 0.05;

/** How often a follower checks itself against the room. */
export const TICK_MS = 500;

export type Correction =
  | { kind: "hold" }
  | { kind: "rate"; rate: number }
  | { kind: "seek" };

/**
 * `driftMs` is target minus actual: positive means this player is BEHIND the
 * room and needs to speed up.
 *
 * `nudging` is what gives the middle band hysteresis. Without it, a nudge that
 * brings drift from 200ms to 149ms would stop and leave a permanent 149ms
 * error — under the dead band, but visible when two people are in the same
 * physical room.
 */
export function decideCorrection(driftMs: number, nudging: boolean): Correction {
  const magnitude = Math.abs(driftMs);

  if (magnitude > DRIFT_SEEK_MS) {
    return { kind: "seek" };
  }

  if (magnitude >= DRIFT_IGNORE_MS || (nudging && magnitude >= DRIFT_SETTLE_MS)) {
    return { kind: "rate", rate: driftMs > 0 ? 1 + NUDGE : 1 - NUDGE };
  }

  if (nudging) {
    return { kind: "rate", rate: 1 };
  }

  return { kind: "hold" };
}

/**
 * The subset of HTMLVideoElement this controller touches. Narrow on purpose:
 * it is what lets the drift logic be tested without a DOM.
 */
export type VideoLike = {
  currentTime: number;
  playbackRate: number;
  preservesPitch?: boolean;
  paused: boolean;
  play(): Promise<void>;
  pause(): void;
};

export type SyncController = {
  attach(video: VideoLike): void;
  applyRoomState(state: RoomState): void;
  detach(): void;
};

/**
 * Keeps a follower's video on the room's playhead.
 *
 * Hand-rolled rather than `timingsrc`: a TimingObject models velocity,
 * acceleration and timeline ranges for a general case we do not have, it does
 * not provide transport, and the thresholds above need direct tuning. The
 * interface is three methods precisely so swapping it later is one module.
 */
export function createSyncController(options: {
  clock: { now(localNow: number): number };
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onResync?: () => void;
  onAutoplayBlocked?: () => void;
}): SyncController {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearInterval(handle as never));

  let video: VideoLike | null = null;
  let state: RoomState | null = null;
  let nudging = false;
  let handle: unknown;

  function tick(): void {
    if (video === null || state === null || state.clipId === null) {
      return;
    }

    const target = positionNow(state, options.clock.now(now())) / 1_000;

    if (state.paused) {
      if (!video.paused) {
        video.pause();
      }

      if (Math.abs(video.currentTime - target) * 1_000 > DRIFT_IGNORE_MS) {
        video.currentTime = target;
      }

      if (nudging) {
        video.playbackRate = 1;
        nudging = false;
      }

      return;
    }

    if (video.paused) {
      // Autoplay policy rejects this without a user gesture, which is exactly
      // why joining is a deliberate click. The caller shows "Tap to sync".
      void video.play().catch(() => options.onAutoplayBlocked?.());
    }

    const drift = (target - video.currentTime) * 1_000;
    const correction = decideCorrection(drift, nudging);

    if (correction.kind === "seek") {
      // The group never waits for the slowest viewer. A stalled follower
      // catches up by jumping forward, not by holding everyone else.
      video.currentTime = target;
      video.playbackRate = 1;
      nudging = false;
      options.onResync?.();
      return;
    }

    if (correction.kind === "rate") {
      video.playbackRate = correction.rate;
      nudging = correction.rate !== 1;
    }
  }

  return {
    attach(next) {
      video = next;
      // Explicit rather than trusting the browser default: it is the whole
      // reason a ±5% rate change is inaudible.
      video.preservesPitch = true;
      handle = setTimer(tick, TICK_MS);
    },
    applyRoomState(next) {
      state = next;
      // Act on the change now rather than waiting up to 500ms for the tick —
      // a pause that lands half a second late reads as a broken button.
      tick();
    },
    detach() {
      clearTimer(handle);
      handle = undefined;

      if (video) {
        video.playbackRate = 1;
      }

      video = null;
      state = null;
      nudging = false;
    },
  };
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `bun test src/lib/theater/sync-controller.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Mutation-test the hysteresis**

The middle band is the part most likely to be "simplified" by a later reader:

```bash
sed -i 's/ || (nudging \&\& magnitude >= DRIFT_SETTLE_MS)//' src/lib/theater/sync-controller.ts
bun test src/lib/theater/sync-controller.test.ts
```

Expected: FAIL on "keeps nudging below 150 once it has started". Restore with `git checkout -- src/lib/theater/sync-controller.ts` and re-run to confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/theater/sync-controller.ts src/lib/theater/sync-controller.test.ts
git commit -m "feat: add the SyncController

Three drift bands: hold under 150ms, nudge playbackRate between 150 and
750, hard seek above. The middle band has hysteresis — it keeps nudging
until 50ms — or a correction would stop at 149ms and leave a permanent
error just inside the dead band.

preservesPitch is set explicitly. It is the reason a 5% nudge is inaudible.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: The browser's view of the room

The rev guard, who is in the room, and the host's pending control requests — as a pure reducer, then a hook.

**Files:**
- Create: `src/lib/theater/room-store.ts`
- Create: `src/lib/theater/room-store.test.ts`
- Create: `src/lib/theater/use-room.ts`

**Interfaces:**
- Consumes: `ServerMessage`, `RoomState`, `INITIAL_ROOM_STATE`, `useRealtimeContext` from Task 1, `ServerClock` and `startClockSampler` from Task 6.
- Produces:
  - `type ControlRequest = { user: string; at: number }`
  - `type RoomView = { state: RoomState; inRoom: string[]; requests: ControlRequest[] }`
  - `INITIAL_ROOM_VIEW`, `REQUEST_TTL_MS = 30_000`
  - `reduceRoom(view: RoomView, message: ServerMessage, now: number): RoomView`
  - `dismissRequest(view: RoomView, user: string): RoomView`
  - `useRoom(): { view: RoomView; clock: ServerClock; send(message: ClientMessage): void; dismiss(user: string): void }`

- [ ] **Step 1: Write the failing reducer test**

Create `src/lib/theater/room-store.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { RoomState, ServerMessage } from "@/lib/realtime/envelope";
import {
  dismissRequest,
  INITIAL_ROOM_VIEW,
  reduceRoom,
  REQUEST_TTL_MS,
  type RoomView,
} from "@/lib/theater/room-store";

function stateAt(rev: number, overrides: Partial<RoomState> = {}): RoomState {
  return {
    clipId: "01A",
    clipTitle: "ace",
    clipDurationMs: 30_000,
    hostUserId: "sam",
    paused: false,
    positionMs: 1_000,
    anchorServerTime: 500,
    rev,
    ...overrides,
  };
}

function snapshot(state: RoomState): ServerMessage {
  return { t: "room", state };
}

describe("reduceRoom — rev guard", () => {
  it("applies a newer snapshot", () => {
    expect(reduceRoom(INITIAL_ROOM_VIEW, snapshot(stateAt(1)), 0).state.rev).toBe(1);
  });

  it("ignores a snapshot that arrived out of order", () => {
    // This is the bug that only shows up under real network conditions: a
    // delayed message rewinding everyone's playhead after a seek.
    const applied = reduceRoom(INITIAL_ROOM_VIEW, snapshot(stateAt(5)), 0);
    const stale = reduceRoom(applied, snapshot(stateAt(3, { positionMs: 99_000 })), 0);

    expect(stale).toBe(applied);
  });

  it("ignores a repeat of the rev it already has", () => {
    const applied = reduceRoom(INITIAL_ROOM_VIEW, snapshot(stateAt(5)), 0);
    expect(reduceRoom(applied, snapshot(stateAt(5)), 0)).toBe(applied);
  });
});

describe("reduceRoom — presence", () => {
  it("records who is in the room", () => {
    const next = reduceRoom(
      INITIAL_ROOM_VIEW,
      { t: "presence", online: ["sam", "dave", "kai"], inRoom: ["sam", "dave"] },
      0,
    );

    expect(next.inRoom).toEqual(["sam", "dave"]);
  });

  it("returns the same object when the room membership has not changed", () => {
    const view = reduceRoom(
      INITIAL_ROOM_VIEW,
      { t: "presence", online: ["sam"], inRoom: ["sam"] },
      0,
    );
    const again = reduceRoom(view, { t: "presence", online: ["sam", "dave"], inRoom: ["sam"] }, 0);

    expect(again).toBe(view);
  });
});

describe("reduceRoom — control requests", () => {
  it("records a request with the time it arrived", () => {
    const next = reduceRoom(INITIAL_ROOM_VIEW, { t: "room.controlRequested", user: "dave" }, 1_000);
    expect(next.requests).toEqual([{ user: "dave", at: 1_000 }]);
  });

  it("refreshes rather than duplicating a repeat request", () => {
    const first = reduceRoom(INITIAL_ROOM_VIEW, { t: "room.controlRequested", user: "dave" }, 1_000);
    const second = reduceRoom(first, { t: "room.controlRequested", user: "dave" }, 2_000);

    expect(second.requests).toEqual([{ user: "dave", at: 2_000 }]);
  });

  it("expires a request that the host ignored", () => {
    const first = reduceRoom(INITIAL_ROOM_VIEW, { t: "room.controlRequested", user: "dave" }, 1_000);
    const later = reduceRoom(
      first,
      { t: "room.controlRequested", user: "kai" },
      1_000 + REQUEST_TTL_MS + 1,
    );

    expect(later.requests.map((request) => request.user)).toEqual(["kai"]);
  });

  it("clears a user's request once they become host", () => {
    const withRequest = reduceRoom(
      INITIAL_ROOM_VIEW,
      { t: "room.controlRequested", user: "dave" },
      1_000,
    );
    const granted = reduceRoom(withRequest, snapshot(stateAt(2, { hostUserId: "dave" })), 1_100);

    expect(granted.requests).toEqual([]);
  });
});

describe("dismissRequest", () => {
  it("drops one request and leaves the rest", () => {
    let view: RoomView = reduceRoom(
      INITIAL_ROOM_VIEW,
      { t: "room.controlRequested", user: "dave" },
      0,
    );
    view = reduceRoom(view, { t: "room.controlRequested", user: "kai" }, 0);

    expect(dismissRequest(view, "dave").requests.map((r) => r.user)).toEqual(["kai"]);
  });

  it("returns the same object when there was nothing to dismiss", () => {
    expect(dismissRequest(INITIAL_ROOM_VIEW, "nobody")).toBe(INITIAL_ROOM_VIEW);
  });
});

describe("reduceRoom — everything else", () => {
  it("passes an unrelated message through untouched", () => {
    const clip = {
      id: "01B",
      title: "x",
      status: "ready",
      thumbPath: null,
      durationMs: null,
      createdAt: 1,
    };

    expect(reduceRoom(INITIAL_ROOM_VIEW, { t: "clip.added", clip }, 0)).toBe(INITIAL_ROOM_VIEW);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/theater/room-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reducer**

Create `src/lib/theater/room-store.ts`:

```ts
import type { RoomState, ServerMessage } from "@/lib/realtime/envelope";
import { INITIAL_ROOM_STATE } from "@/lib/realtime/room-state";

export type ControlRequest = { user: string; at: number };

export type RoomView = {
  state: RoomState;
  inRoom: string[];
  requests: ControlRequest[];
};

export const INITIAL_ROOM_VIEW: RoomView = {
  state: INITIAL_ROOM_STATE,
  inRoom: [],
  requests: [],
};

/** Requests are not queued or persisted: an ignored one simply expires. */
export const REQUEST_TTL_MS = 30_000;

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Folds a server message into the browser's view of the room.
 *
 * Returns the SAME object when nothing changed. Room snapshots arrive on every
 * join, leave and transport command, and most of them do not change what a
 * given component renders — a fresh object each time would re-render the
 * theater several times a second for nothing.
 */
export function reduceRoom(view: RoomView, message: ServerMessage, now: number): RoomView {
  if (message.t === "room") {
    // Ignore anything at or below the rev already applied. Without this a
    // delayed snapshot rewinds everyone's playhead after a seek — a bug that
    // only appears under real network conditions.
    if (message.state.rev <= view.state.rev) {
      return view;
    }

    // A request answered by a handoff should vanish from the host's screen
    // without them dismissing it.
    const requests = view.requests.filter((request) => request.user !== message.state.hostUserId);

    return {
      ...view,
      state: message.state,
      requests: requests.length === view.requests.length ? view.requests : requests,
    };
  }

  if (message.t === "presence") {
    return sameList(view.inRoom, message.inRoom) ? view : { ...view, inRoom: message.inRoom };
  }

  if (message.t === "room.controlRequested") {
    const kept = view.requests.filter(
      (request) => request.user !== message.user && now - request.at < REQUEST_TTL_MS,
    );

    return { ...view, requests: [...kept, { user: message.user, at: now }] };
  }

  return view;
}

export function dismissRequest(view: RoomView, user: string): RoomView {
  const requests = view.requests.filter((request) => request.user !== user);
  return requests.length === view.requests.length ? view : { ...view, requests };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/lib/theater/room-store.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the hook**

Create `src/lib/theater/use-room.ts`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage } from "@/lib/realtime/envelope";
import { useRealtimeContext } from "@/lib/realtime/provider";
import { ServerClock } from "./clock";
import { startClockSampler } from "./sampler";
import { dismissRequest, INITIAL_ROOM_VIEW, reduceRoom, type RoomView } from "./room-store";

export type Room = {
  view: RoomView;
  clock: ServerClock;
  send(message: ClientMessage): void;
  dismiss(user: string): void;
};

/**
 * The room as this browser sees it, plus the clock that makes its numbers
 * mean anything.
 *
 * The clock sampler is started here rather than in the provider because the
 * handshake is only worth its traffic where something is actually syncing.
 */
export function useRoom(): Room {
  const { register, send } = useRealtimeContext();
  const [view, setView] = useState<RoomView>(INITIAL_ROOM_VIEW);
  const clock = useMemo(() => new ServerClock(), []);
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    const sampler = startClockSampler({
      clock,
      send: (message) => sendRef.current(message),
    });

    const unregister = register({
      topics: ["room", "grid"],
      handler: (message: ServerMessage) => {
        sampler.receive(message);
        setView((current) => reduceRoom(current, message, Date.now()));
      },
    });

    return () => {
      unregister();
      sampler.stop();
    };
  }, [register, clock]);

  const dismiss = useCallback((user: string) => {
    setView((current) => dismissRequest(current, user));
  }, []);

  return { view, clock, send, dismiss };
}
```

- [ ] **Step 6: Run the suite and typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/theater/room-store.ts src/lib/theater/room-store.test.ts src/lib/theater/use-room.ts
git commit -m "feat: add the browser's view of the room

Rev guard, room membership, and the host's pending control requests, as a
pure reducer that returns the same object when nothing changed. Snapshots
arrive on every transport command; a fresh object each time would re-render
the theater several times a second for nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The dock

Three states on every page, a × that collapses it to a badge, and a pulse on activity.

**Files:**
- Create: `src/lib/theater/flags.ts`
- Create: `src/lib/theater/use-dock-dismissed.ts`
- Create: `src/components/dock.tsx`
- Create: `src/components/dock-badge.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `useRoom` from Task 8, `positionNow`, `formatDuration` from `@/lib/format`.
- Produces: `DOCK_PULSE_ENABLED`, `useDockDismissed(): [boolean, (value: boolean) => void]`, `<DockBadge />`, `<Dock me={string} />`

- [ ] **Step 1: The flag and the dismissal hook**

Create `src/lib/theater/flags.ts`:

```ts
/**
 * The collapsed dock badge pulses briefly on new activity. Behind a flag
 * because a pulse on every page is exactly the kind of thing that grates
 * after a week — flip this to false and it is gone.
 */
export const DOCK_PULSE_ENABLED = true;
```

Create `src/lib/theater/use-dock-dismissed.ts`:

```tsx
"use client";

import { useEffect, useState } from "react";

const KEY = "clips.dock.dismissed";

/**
 * Whether this browser has collapsed the dock.
 *
 * Per-user browser state in localStorage — no schema, nothing to sync. It
 * starts false and is corrected after mount, because reading localStorage
 * during render would mismatch the server-rendered HTML.
 */
export function useDockDismissed(): [boolean, (value: boolean) => void] {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(KEY) === "1");
    } catch {
      // Private mode, or storage disabled. The dock simply stays open.
    }
  }, []);

  function update(value: boolean): void {
    setDismissed(value);

    try {
      localStorage.setItem(KEY, value ? "1" : "0");
    } catch {
      // Nothing to do; the choice lasts for this page view.
    }
  }

  return [dismissed, update];
}
```

- [ ] **Step 2: The badge**

Create `src/components/dock-badge.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { DOCK_PULSE_ENABLED } from "@/lib/theater/flags";

const PULSE_MS = 1_200;

/**
 * The collapsed dock: a live count that keeps ticking but stays silent.
 *
 * It never auto-expands. A dismissed dock that reopens itself is the reason
 * people dismiss things twice and then leave.
 */
export function DockBadge({
  watching,
  activity,
  onExpand,
}: {
  watching: number;
  /** Any value that changes when something happened worth a pulse. */
  activity: number;
  onExpand(): void;
}) {
  const [pulsing, setPulsing] = useState(false);
  const seen = useRef(activity);

  useEffect(() => {
    if (!DOCK_PULSE_ENABLED || activity === seen.current) {
      return;
    }

    seen.current = activity;
    setPulsing(true);
    const timer = setTimeout(() => setPulsing(false), PULSE_MS);

    return () => clearTimeout(timer);
  }, [activity]);

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Show the theater dock — ${watching} watching`}
      className={`dock-badge ${pulsing ? "dock-badge-pulse" : ""}`}
    >
      <span aria-hidden="true">▶</span> {watching}
    </button>
  );
}
```

- [ ] **Step 3: The dock itself**

Create `src/components/dock.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";
import { positionNow } from "@/lib/realtime/room-state";
import { useDockDismissed } from "@/lib/theater/use-dock-dismissed";
import { useRoom } from "@/lib/theater/use-room";
import { DockBadge } from "./dock-badge";

/**
 * Pinned to the bottom of every page, showing what the theater is playing.
 *
 * Chosen over a separate /theater route as the only surface — an always-on
 * room nobody can see is a dead room — and over theater-as-homepage, which is
 * a large empty box whenever nobody is watching.
 */
export function Dock({ me }: { me: string }) {
  const { view, clock, send } = useRoom();
  const [dismissed, setDismissed] = useDockDismissed();
  const [, tick] = useState(0);

  const { state } = view;
  const joined = view.inRoom.includes(me);

  // A ticking position while playing. One second is enough for a dock.
  useEffect(() => {
    if (state.paused || state.clipId === null) {
      return;
    }

    const timer = setInterval(() => tick((n) => n + 1), 1_000);

    return () => clearInterval(timer);
  }, [state.paused, state.clipId]);

  if (dismissed) {
    return (
      <div className="dock">
        <DockBadge
          watching={view.inRoom.length}
          activity={state.rev + view.inRoom.length}
          onExpand={() => setDismissed(false)}
        />
      </div>
    );
  }

  if (state.clipId === null) {
    return (
      <div className="dock dock-idle">
        <p className="text-xs text-ink-muted">
          The theater is empty.{" "}
          <Link href="/theater" className="underline hover:text-ink">
            Start something
          </Link>
          .
        </p>
      </div>
    );
  }

  const position = formatDuration(positionNow(state, clock.now(Date.now())));
  const duration = formatDuration(state.clipDurationMs);
  const host = state.hostUserId ?? "nobody";

  if (!joined) {
    return (
      <div className="dock dock-open">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink">{state.clipTitle}</p>
          <p className="text-xs text-ink-muted">
            {state.hostUserId === null ? "Nobody has control" : `${host} is hosting`} ·{" "}
            {view.inRoom.length} watching · {position} / {duration}
          </p>
        </div>
        <button type="button" className="button-primary" onClick={() => send({ t: "room.join" })}>
          Join
        </button>
        <button
          type="button"
          className="dock-dismiss"
          aria-label="Collapse the theater dock"
          onClick={() => setDismissed(true)}
        >
          ×
        </button>
      </div>
    );
  }

  // Joined. No × — the exit is Leave, which takes you out of presence. Hiding
  // your own controls while still synced to someone else's playhead is a bug
  // wearing a feature's clothes.
  return (
    <div className="dock dock-open">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">{state.clipTitle}</p>
        <p className="text-xs text-ink-muted">
          {state.hostUserId === me ? "You have control" : `Following ${host}`} ·{" "}
          {view.inRoom.length} watching · {position} / {duration}
        </p>
      </div>
      <Link href="/theater" className="button-secondary">
        Open theater
      </Link>
      <button type="button" className="button-secondary" onClick={() => send({ t: "room.leave" })}>
        Leave
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Mount it**

Replace `src/components/app-shell.tsx`:

```tsx
import { Dock } from "@/components/dock";
import { RealtimeProvider } from "@/lib/realtime/provider";

export function AppShell({ me, children }: { me: string; children: React.ReactNode }) {
  return (
    <RealtimeProvider>
      {/* Room for the fixed dock, so it never covers the last row of the grid. */}
      <div className="pb-24">{children}</div>
      <Dock me={me} />
    </RealtimeProvider>
  );
}
```

- [ ] **Step 5: Style it**

Append to `src/app/globals.css`:

```css
.dock {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
  display: flex; align-items: center; gap: 16px;
  padding: 10px 16px;
  background: #14181d; border-top: 1px solid #303b48;
}
.dock-idle { padding: 6px 16px; background: transparent; border-top-color: #222b36; }
.dock-dismiss {
  min-width: 32px; min-height: 32px; border-radius: 6px;
  background: transparent; color: #9aa4b2; font-size: 18px; cursor: pointer;
}
.dock-dismiss:hover { background: #222b36; color: #e6e9ee; }
.dock-badge {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 32px; padding: 4px 10px; border-radius: 999px;
  background: #222b36; color: #e6e9ee; font-size: 13px; cursor: pointer;
}
.dock-badge-pulse { animation: dock-pulse 1.2s ease-out 1; }
@keyframes dock-pulse {
  0% { box-shadow: 0 0 0 0 rgba(147, 197, 253, 0.6); }
  100% { box-shadow: 0 0 0 12px rgba(147, 197, 253, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .dock-badge-pulse { animation: none; }
}
```

The reduced-motion guard is not optional politeness: a pulsing element pinned to every page is precisely what that preference exists for.

- [ ] **Step 6: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green. The dock has no unit tests — its logic is `reduceRoom` and `positionNow`, both already covered. What is left is rendering, and this repo has no DOM test harness.

- [ ] **Step 7: Verify in the browser**

Load `http://<host>:3000/`. Expected: a thin line at the bottom reading "The theater is empty." with a link to the theater. There is no × in the idle state, by design — there is nothing to dismiss.

- [ ] **Step 8: Commit**

```bash
git add src/lib/theater/flags.ts src/lib/theater/use-dock-dismissed.ts \
  src/components/dock.tsx src/components/dock-badge.tsx \
  src/components/app-shell.tsx src/app/globals.css
git commit -m "feat: add the theater dock

Three states: a thin idle line, an advertising bar with Join and a dismiss,
and the joined bar whose exit is Leave rather than a dismiss — hiding your
own controls while still synced to someone else's playhead is a bug wearing
a feature's clothes.

Dismissal collapses to a badge that keeps counting, never auto-expands, and
pulses behind a flag with a reduced-motion guard.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: The theater

The expanded view: the video wired to the `SyncController`, the tabbed sidebar, and the join path that survives autoplay policy.

**Files:**
- Create: `src/app/theater/page.tsx`
- Create: `src/components/theater.tsx`
- Create: `src/components/watching-list.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `useRoom`, `createSyncController`, `clipPublicPath`, `listAllClips`, `toSummary`, `requireUser`.
- Produces: `<WatchingList inRoom hostUserId me onGiveControl onClaimHost />`, `<Theater me clips />`

- [ ] **Step 1: The route**

Create `src/app/theater/page.tsx`:

```tsx
import { Theater } from "@/components/theater";
import { getDb } from "@/db/client";
import { listAllClips } from "@/db/clips";
import { toSummary } from "@/lib/events/clips";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TheaterPage() {
  const user = await requireUser();
  // Only a finished clip can be played in sync: the pipeline has not written a
  // faststart mp4 for anything else, so a follower would stall on the moov.
  const clips = listAllClips(getDb())
    .filter((clip) => clip.status === "ready")
    .map(toSummary);

  return <Theater me={user.authentikUsername} clips={clips} />;
}
```

- [ ] **Step 2: The watching list**

Create `src/components/watching-list.tsx`:

```tsx
"use client";

/**
 * Who is in the room, who has control, and — for the host — the buttons to
 * hand it over. The handoff lives here rather than in the player because it is
 * a fact about people, not about transport.
 */
export function WatchingList({
  inRoom,
  hostUserId,
  me,
  onGiveControl,
  onClaimHost,
}: {
  inRoom: string[];
  hostUserId: string | null;
  me: string;
  onGiveControl(user: string): void;
  onClaimHost(): void;
}) {
  const iAmHost = hostUserId === me;

  if (inRoom.length === 0) {
    return <p className="p-4 text-sm text-ink-muted">Nobody is in the theater yet.</p>;
  }

  return (
    <div className="p-4">
      {hostUserId === null && inRoom.includes(me) && (
        <button type="button" className="button-primary mb-4 w-full" onClick={onClaimHost}>
          Take control
        </button>
      )}
      <ul className="flex flex-col gap-2">
        {inRoom.map((user) => (
          <li key={user} className="flex items-center gap-2">
            <span className="flex-1 truncate text-sm text-ink">
              {user === me ? `${user} (you)` : user}
            </span>
            {user === hostUserId && <span className="text-xs text-ink-muted">host</span>}
            {iAmHost && user !== me && (
              <button
                type="button"
                className="chip-button"
                onClick={() => onGiveControl(user)}
              >
                Give control
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: The theater**

Create `src/components/theater.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { clipPublicPath } from "@/lib/media/paths";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { createSyncController, type SyncController } from "@/lib/theater/sync-controller";
import { useRoom } from "@/lib/theater/use-room";
import { WatchingList } from "./watching-list";

type Tab = "chat" | "watching";

const RESYNC_TOAST_MS = 2_500;

export function Theater({ me, clips }: { me: string; clips: ClipSummary[] }) {
  const { view, clock, send } = useRoom();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controllerRef = useRef<SyncController | null>(null);
  const [tab, setTab] = useState<Tab>("watching");
  const [needsGesture, setNeedsGesture] = useState(false);
  const [resynced, setResynced] = useState(false);

  const { state } = view;
  const joined = view.inRoom.includes(me);
  const iAmHost = state.hostUserId === me;

  useEffect(() => {
    const controller = createSyncController({
      clock,
      onResync: () => setResynced(true),
      onAutoplayBlocked: () => setNeedsGesture(true),
    });
    controllerRef.current = controller;

    return () => {
      controller.detach();
      controllerRef.current = null;
    };
  }, [clock]);

  // Attach only while joined. Someone browsing the grid should not have their
  // browser quietly seeking a video they never opened.
  useEffect(() => {
    const controller = controllerRef.current;
    const video = videoRef.current;

    if (!controller || !video || !joined || state.clipId === null) {
      return;
    }

    controller.attach(video);

    return () => controller.detach();
  }, [joined, state.clipId]);

  useEffect(() => {
    if (joined) {
      controllerRef.current?.applyRoomState(state);
    }
  }, [joined, state]);

  useEffect(() => {
    if (!resynced) {
      return;
    }

    const timer = setTimeout(() => setResynced(false), RESYNC_TOAST_MS);

    return () => clearTimeout(timer);
  }, [resynced]);

  function tapToSync(): void {
    setNeedsGesture(false);
    // The gesture is the point: this call is inside a click handler, so the
    // autoplay policy allows it where the controller's own call was refused.
    void videoRef.current?.play().catch(() => setNeedsGesture(true));
  }

  return (
    <main className="mx-auto max-w-7xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-ink-muted hover:text-ink">
            ← back
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Theater</h1>
        </div>
        {joined ? (
          <button
            type="button"
            className="button-secondary"
            onClick={() => send({ t: "room.leave" })}
          >
            Leave
          </button>
        ) : (
          <button type="button" className="button-primary" onClick={() => send({ t: "room.join" })}>
            Join
          </button>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="theater-stage min-w-0 flex-1">
          {state.clipId === null ? (
            <div className="flex aspect-video items-center justify-center rounded-lg bg-black/40">
              <p className="text-sm text-ink-muted">Nothing is playing.</p>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full rounded-lg bg-black"
                src={clipPublicPath(state.clipId)}
                preload="auto"
                playsInline
                controls={false}
              />
              {needsGesture && (
                <button type="button" className="button-primary mt-4" onClick={tapToSync}>
                  Tap to sync
                </button>
              )}
              {resynced && (
                <p role="status" className="mt-2 text-xs text-ink-muted">
                  Resynced — you had fallen behind the room.
                </p>
              )}
            </>
          )}

          {iAmHost && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-ink">Play something</h2>
              <ul className="flex flex-wrap gap-2">
                {clips.map((clip) => (
                  <li key={clip.id}>
                    <button
                      type="button"
                      className="chip-button"
                      onClick={() =>
                        send({
                          t: "room.control",
                          action: "setClip",
                          clipId: clip.id,
                          title: clip.title,
                          durationMs: clip.durationMs,
                        })
                      }
                    >
                      {clip.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="w-full shrink-0 rounded-lg bg-surface-raised lg:w-80">
          <div className="flex border-b border-[#303b48]">
            <button
              type="button"
              className={`theater-tab ${tab === "chat" ? "theater-tab-active" : ""}`}
              onClick={() => setTab("chat")}
            >
              Chat
            </button>
            <button
              type="button"
              className={`theater-tab ${tab === "watching" ? "theater-tab-active" : ""}`}
              onClick={() => setTab("watching")}
            >
              Watching ({view.inRoom.length})
            </button>
          </div>
          {tab === "chat" ? (
            <p className="p-4 text-sm text-ink-muted">Chat arrives in the next release.</p>
          ) : (
            <WatchingList
              inRoom={view.inRoom}
              hostUserId={state.hostUserId}
              me={me}
              onGiveControl={(user) => send({ t: "room.giveControl", userId: user })}
              onClaimHost={() => send({ t: "room.claimHost" })}
            />
          )}
        </aside>
      </div>
    </main>
  );
}
```

The `<video>` has `controls={false}` for everyone including the host. Task 11 adds the room's own transport: the native controls would give the host a second scrubber that disagrees with the room's and sends no `room.control`.

- [ ] **Step 4: Style the tabs and chips**

Append to `src/app/globals.css`:

```css
.theater-stage { position: relative; }
.theater-tab {
  flex: 1; min-height: 40px; padding: 8px 12px;
  background: transparent; color: #9aa4b2; font-size: 13px; cursor: pointer;
}
.theater-tab:hover { color: #e6e9ee; }
.theater-tab-active { color: #e6e9ee; box-shadow: inset 0 -2px 0 #93c5fd; }
.chip-button {
  display: inline-flex; align-items: center;
  min-height: 32px; padding: 4px 10px; border-radius: 6px;
  background: #222b36; color: #e6e9ee; font-size: 12px; cursor: pointer;
}
.chip-button:hover { background: #303b48; }
```

- [ ] **Step 5: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 6: Verify two browsers actually sync**

You need a clip in `ready` and two identities. The dev fallback gives every unauthenticated request the same `DEV_AUTH_USERNAME`, so two ordinary tabs look like one person to the room. To get two identities, send the header Caddy normally injects — for example with a browser extension, or by running a second Next on another port with a different `DEV_AUTH_USERNAME`. If you cannot arrange two, say so and do the single-identity smoke test instead of claiming a two-party result.

With two identities:
1. Both click **Join**. The first becomes host; the second sees "host" beside them in the Watching tab.
2. Host clicks a clip title. Both start playing.
3. Host scrubs (after Task 11) or re-picks the clip. The follower converges within about a second.
4. Host closes the tab. The follower's room goes hostless and pauses, and **Take control** appears.

Record what you actually saw, including the drift you observed.

- [ ] **Step 7: Commit**

```bash
git add src/app/theater/page.tsx src/components/theater.tsx \
  src/components/watching-list.tsx src/app/globals.css
git commit -m "feat: add the expanded theater

Video wired to the SyncController, tabbed sidebar with the handoff buttons,
and a Tap to sync button on the join path — play() will reject under the
autoplay policy without a gesture, which is exactly why joining is a click.

The clip list is filtered to ready: nothing else has a faststart moov, so a
follower would stall.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Transport controls, and asking for them

Followers get visibly disabled controls that request control when clicked; the host gets a dismissable prompt with a one-click grant.

**Files:**
- Create: `src/components/theater-transport.tsx`
- Modify: `src/components/theater.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `RoomState`, `positionNow`, `formatDuration`, `useRoom`'s `dismiss`.
- Produces: `<TheaterTransport state clock canControl onPlay onPause onSeek onRequestControl />`

- [ ] **Step 1: Verify the server already refuses a follower**

Before building UI on top of the assumption, confirm it. Task 5 added the test:

Run: `bun test src/realtime/index.test.ts -t "drops a follower"`
Expected: PASS. If it does not, stop — the disabled buttons below are cosmetics and the enforcement is missing.

- [ ] **Step 2: Build the transport**

Create `src/components/theater-transport.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";
import type { RoomState } from "@/lib/realtime/envelope";
import { positionNow } from "@/lib/realtime/room-state";

/**
 * The room's transport.
 *
 * For a follower every control is visibly disabled with a "following <name>"
 * label — disabled-and-explained, never hidden, because hidden controls make
 * everyone assume the site is broken. Clicking one sends `room.requestControl`
 * instead of doing nothing, which turns the most likely misclick, poking a
 * dead scrubber, into the action the user actually wanted.
 */
export function TheaterTransport({
  state,
  clock,
  canControl,
  onPlay,
  onPause,
  onSeek,
  onRequestControl,
}: {
  state: RoomState;
  clock: { now(localNow: number): number };
  canControl: boolean;
  onPlay(): void;
  onPause(): void;
  onSeek(positionMs: number): void;
  onRequestControl(): void;
}) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (state.paused) {
      return;
    }

    const timer = setInterval(() => tick((n) => n + 1), 250);

    return () => clearInterval(timer);
  }, [state.paused]);

  const position = positionNow(state, clock.now(Date.now()));
  const duration = state.clipDurationMs ?? 0;
  const disabled = !canControl;

  return (
    <div className="theater-transport">
      <button
        type="button"
        className="button-secondary"
        aria-disabled={disabled}
        data-disabled={disabled ? "" : undefined}
        onClick={() => {
          if (!canControl) {
            onRequestControl();
            return;
          }

          if (state.paused) {
            onPlay();
          } else {
            onPause();
          }
        }}
      >
        {state.paused ? "Play" : "Pause"}
      </button>
      <input
        type="range"
        className="theater-scrubber"
        min={0}
        max={Math.max(duration, 1)}
        value={Math.min(position, duration || position)}
        aria-label="Position"
        aria-disabled={disabled}
        data-disabled={disabled ? "" : undefined}
        // `readOnly` rather than `disabled`: a disabled input fires no pointer
        // events at all, and for a follower the click IS the request.
        readOnly={disabled}
        onPointerDown={disabled ? onRequestControl : undefined}
        onChange={(event) => {
          if (canControl) {
            onSeek(Number(event.target.value));
          }
        }}
      />
      <span className="shrink-0 text-xs text-ink-muted">
        {formatDuration(position)} / {formatDuration(state.clipDurationMs)}
      </span>
      {disabled && (
        <span className="shrink-0 text-xs text-ink-muted">
          {state.hostUserId === null ? "Nobody has control" : `following ${state.hostUserId}`}
        </span>
      )}
    </div>
  );
}
```

`readOnly` instead of `disabled` on the range is the crux of the task: a `disabled` input fires no pointer events, so a follower's click on the scrubber would be swallowed by the browser and the request would never be sent.

- [ ] **Step 3: Wire it into the theater**

In `src/components/theater.tsx`:

Add the import: `import { TheaterTransport } from "./theater-transport";`

Pull `dismiss` out of `useRoom`: `const { view, clock, send, dismiss } = useRoom();`

Insert the transport directly after the `<video>` element, inside the same fragment:

```tsx
              <TheaterTransport
                state={state}
                clock={clock}
                canControl={iAmHost}
                onPlay={() => send({ t: "room.control", action: "play" })}
                onPause={() => send({ t: "room.control", action: "pause" })}
                onSeek={(positionMs) => send({ t: "room.control", action: "seek", positionMs })}
                onRequestControl={() => send({ t: "room.requestControl" })}
              />
```

And add the request prompts as the last child of `<main>`:

```tsx
      {iAmHost && view.requests.length > 0 && (
        <div className="theater-requests" role="status">
          {view.requests.map((request) => (
            <div key={request.user} className="theater-request">
              <span className="text-sm text-ink">{request.user} wants control</span>
              <button
                type="button"
                className="chip-button"
                onClick={() => {
                  send({ t: "room.giveControl", userId: request.user });
                  dismiss(request.user);
                }}
              >
                Give control
              </button>
              <button
                type="button"
                className="dock-dismiss"
                aria-label={`Dismiss ${request.user}'s request`}
                onClick={() => dismiss(request.user)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Style it**

Append to `src/app/globals.css`:

```css
.theater-transport {
  display: flex; align-items: center; gap: 12px;
  margin-top: 12px; padding: 8px 12px;
  border-radius: 8px; background: #14181d;
}
.theater-scrubber { flex: 1; min-width: 0; accent-color: #93c5fd; }
/* Visibly disabled, but still clickable — the click is the request. */
[data-disabled] { opacity: 0.5; cursor: not-allowed; }
.theater-requests {
  position: fixed; right: 16px; bottom: 80px; z-index: 50;
  display: flex; flex-direction: column; gap: 8px;
}
.theater-request {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px;
  background: #222b36; border: 1px solid #303b48;
}
```

- [ ] **Step 5: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 6: Verify the request path end to end**

With two identities joined:
1. As the follower, click the greyed-out **Play**. Nothing should move — the room stays as it was.
2. As the host, a "<name> wants control" prompt appears bottom-right.
3. Click **Give control**. The follower's controls become live and the host's go grey with "following <name>".
4. As the new follower, click **Play** twice within ten seconds. The second must produce no second prompt — that is `REQUEST_CONTROL_COOLDOWN_MS`.

Report what you actually observed, including step 1 leaving the room untouched.

- [ ] **Step 7: Commit**

```bash
git add src/components/theater-transport.tsx src/components/theater.tsx src/app/globals.css
git commit -m "feat: add transport controls and request-control

Followers see visibly disabled controls with a 'following <name>' label —
never hidden, because hidden controls make everyone assume the site is
broken — and clicking one sends room.requestControl.

The scrubber is readOnly rather than disabled: a disabled input fires no
pointer events, and the click IS the request.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Fullscreen, on the container

The player's fullscreen control, fullscreening the theater container so an overlay is possible at all.

**Files:**
- Modify: `src/components/theater.tsx`
- Modify: `src/app/globals.css`

**Interfaces:** no new exports.

- [ ] **Step 1: Add the fullscreen state**

In `src/components/theater.tsx`, add the ref and state beside the existing ones:

```tsx
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
```

And the effects. `Escape` exits fullscreen without going through the button, so the only reliable source of truth is the event:

```tsx
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", onChange);

    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // The overlay auto-hides so it does not sit on the gameplay permanently.
  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    let timer: ReturnType<typeof setTimeout>;

    const show = () => {
      setOverlayVisible(true);
      clearTimeout(timer);
      timer = setTimeout(() => setOverlayVisible(false), 3_000);
    };

    show();
    const stage = stageRef.current;
    stage?.addEventListener("pointermove", show);

    return () => {
      clearTimeout(timer);
      stage?.removeEventListener("pointermove", show);
    };
  }, [isFullscreen]);
```

And the toggle, beside `tapToSync`:

```tsx
  async function toggleFullscreen(): Promise<void> {
    // The target is the CONTAINER, never the <video>. The Fullscreen API
    // renders only the fullscreened element and its descendants, so
    // fullscreening the video makes an overlay impossible — and that cannot be
    // fixed later without restructuring this component tree.
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await stageRef.current?.requestFullscreen();
      }
    } catch {
      // Some browsers refuse outside a user gesture or inside an iframe. The
      // page stays usable windowed.
    }
  }
```

- [ ] **Step 2: Attach the ref and the overlay**

Change the stage div to carry the ref and the fullscreen class:

```tsx
        <div
          ref={stageRef}
          className={`theater-stage min-w-0 flex-1 ${isFullscreen ? "theater-stage-full" : ""}`}
        >
```

Add the fullscreen button immediately after `<TheaterTransport … />`:

```tsx
              <button
                type="button"
                className="button-secondary mt-2"
                onClick={() => void toggleFullscreen()}
              >
                {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              </button>
```

And the overlay as the last child of the stage div, so it is a sibling of the video inside the fullscreened element:

```tsx
          {isFullscreen && (
            <div className={`theater-overlay ${overlayVisible ? "" : "theater-overlay-hidden"}`}>
              <div className="theater-overlay-panel">
                <WatchingList
                  inRoom={view.inRoom}
                  hostUserId={state.hostUserId}
                  me={me}
                  onGiveControl={(user) => send({ t: "room.giveControl", userId: user })}
                  onClaimHost={() => send({ t: "room.claimHost" })}
                />
                {/* Chat overlays here in the next milestone. Its input must not
                    swallow Escape, which is how the browser exits fullscreen. */}
              </div>
            </div>
          )}
```

- [ ] **Step 3: Style it**

Append to `src/app/globals.css`:

```css
.theater-stage-full {
  display: flex; align-items: center; justify-content: center;
  width: 100vw; height: 100vh; background: #000;
}
.theater-stage-full video { max-height: 100vh; width: auto; border-radius: 0; }
.theater-overlay {
  position: absolute; inset: 0; z-index: 10;
  display: flex; justify-content: flex-end; padding: 24px;
  pointer-events: none;
  transition: opacity 250ms ease;
}
.theater-overlay-hidden { opacity: 0; }
.theater-overlay-panel {
  pointer-events: auto;
  width: 280px; max-height: 60vh; overflow-y: auto;
  border-radius: 8px; background: rgba(20, 24, 29, 0.85);
  backdrop-filter: blur(4px);
}
@media (prefers-reduced-motion: reduce) {
  .theater-overlay { transition: none; }
}
```

`.theater-stage { position: relative; }` already went in with Task 10 — it is what makes the absolutely-positioned overlay land on the video rather than on the document. Confirm it is there before moving on.

- [ ] **Step 4: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 5: Verify fullscreen in a browser**

1. Join the theater and start a clip.
2. Click **Fullscreen**. The video fills the screen **and the watching list is visible over it** — if the list vanishes, the fullscreen target is wrong.
3. Stop moving the mouse for three seconds. The overlay fades.
4. Move the mouse. It returns.
5. Press **Escape**. The button reads "Fullscreen" again — proving the `fullscreenchange` listener, not the click handler, drives the state.

Step 2 is the one that matters. Report it explicitly.

- [ ] **Step 6: Commit**

```bash
git add src/components/theater.tsx src/app/globals.css
git commit -m "feat: fullscreen the theater container, not the video

The Fullscreen API renders only the fullscreened element and its
descendants, so fullscreening the <video> makes an overlay impossible — and
that cannot be fixed later without restructuring the component tree.

State is driven by the fullscreenchange event rather than the click handler,
because Escape exits without going through the button.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Ship it

Changelog, docs, and an honest end-to-end verification.

**Files:**
- Create: `content/changelog/0.0.5.md`
- Modify: `docs/DEPLOYMENT.md`

- [ ] **Step 1: Write the changelog entry**

Create `content/changelog/0.0.5.md`. Match the voice of `0.0.4.md` — what a friend gets, not what was built:

```markdown
---
version: 0.0.5
date: 2026-09-24
title: Watch together
---

- The theater is open. Whoever gets there first picks what plays, and everyone else's video follows along.
- A bar at the bottom of every page shows what's on. Hit Join to drop in, or × to collapse it to a small badge.
- Poking a greyed-out control asks the host for it instead of doing nothing.
- Hand control to anyone in the room with one click.
- Fullscreen keeps the watching list on top of the video.
```

- [ ] **Step 2: Verify the changelog renders**

Run: `bun test src/lib/changelog.test.ts && bun run build`
Expected: PASS. Then load the site: the changelog modal offers 0.0.5.

- [ ] **Step 3: Run the whole suite and record the real numbers**

```bash
bun test 2>&1 | tail -5
bunx tsc --noEmit
bun run build 2>&1 | tail -20
```

Write the actual counts down. Do not carry a predicted number into the report.

- [ ] **Step 4: Verify graceful degradation**

The theater must not take the site down with it. Stop the realtime process, then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3002/theater
```

Expected: `200` for both. The dock renders its idle state and the theater says nothing is playing. Check the Next log for unhandled rejections — there must be none. Restart realtime afterwards.

- [ ] **Step 5: Record the verification in the runbook**

Append to `docs/DEPLOYMENT.md`, under the existing verification notes:

```markdown
### Milestone 5 — the theater

Verified on 2026-09-24 against the dev stack:

- Two sessions joined; the first became host, the second showed "following <host>".
- Host set a clip, scrubbed, and paused; the follower converged. Observed drift: <fill in>.
- Host's tab closed: the room went hostless and paused, and "Take control" appeared for the remaining member.
- Follower clicked a disabled control: the host got a request prompt, and a second click inside ten seconds produced none.
- Fullscreen put the watching list over the video, and Escape returned the button to "Fullscreen".
- With realtime stopped, `/` and `/theater` both served 200 and no unhandled rejection appeared in the Next log.

Room state is in memory and is **lost on every realtime restart**, by design.
A deploy that recreates the realtime container empties the theater; whoever is
watching is dropped back to a hostless, empty room and rejoins.
```

Replace `<fill in>` with what you actually measured. If a bullet could not be checked, say so on that line rather than deleting it.

- [ ] **Step 6: Commit**

```bash
git add content/changelog/0.0.5.md docs/DEPLOYMENT.md
git commit -m "docs: record milestone 5 verification

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work." Then follow `superpowers:finishing-a-development-branch`: run the full suite, present the three options, execute the choice. The base branch is `master`.

---

## Self-review

**Spec coverage.** Walked the spec's realtime, theater and UI sections against the tasks:

| Spec requirement | Task |
|---|---|
| Envelope: `room.*` client and server messages | 2 |
| Wire identity is the username | 2, 4 (the Room never touches the DB) |
| `room` topic | 2, 5 |
| Every `room.*` authorized server-side against `hostUserId` | 4 (`Room.control`), 5 (routing), 11 step 1 (verified before the UI is built on it) |
| `rev` counter; clients ignore `rev` ≤ last applied | 4 (server), 8 (client guard) |
| Reconnect delivers a full snapshot | 5 (`sub` sends the snapshot); backoff already exists from milestone 4 |
| Backpressure never drops room state | milestone 4 — `isEphemeral` covers only `upload.progress` and `presence` |
| First person in becomes host | 4 |
| Give control, immediate, no accept prompt | 4, 10 (`WatchingList`) |
| Host leaves → hostless and paused, no auto-promote | 4, 5 (socket drop) |
| "Take control" for anyone present | 4, 10 |
| Non-hosts see visibly disabled controls + "following <name>" | 11 |
| Clicking a disabled control requests control | 11 |
| Host gets a dismissable prompt with one-click grant | 11 |
| Requests rate-limited, not queued or persisted | 4 (cooldown), 8 (TTL) |
| Cristian's algorithm, lowest-RTT of five, re-sample every 30s | 6 |
| Room state in memory, sole authority | 4 |
| Server stamps `anchorServerTime` | 4 |
| Drift bands 150 / 750, nudge 0.95/1.05 until < 50 | 7 |
| `preservesPitch = true` explicitly | 7 |
| Stalled follower seeks forward; the group never waits | 7 (hard seek), "resynced" toast in 10 |
| Join handles a rejected `play()` with "Tap to sync" | 7 (`onAutoplayBlocked`), 10 |
| `SyncController`: `attach` / `applyRoomState` / `detach` | 7 |
| One socket per client | 1 |
| Dock: idle / advertising / joined, × only when advertising | 9 |
| Dismiss → badge, never auto-expands, pulses behind a flag | 9 |
| Dismissal in `localStorage` | 9 |
| Tabbed right sidebar, Chat / Watching | 10 |
| Fullscreen the container, not the video | 12 |
| Overlay auto-hides; Escape exits | 12 |

Out of scope and stated as such: theater chat, reactions, `view.start`, per-clip comments, tags, participants, games, click-to-filter, disk usage — all milestone 6.

**Gap found and closed during review:** the spec's `presence` carries `inRoom`, which milestone 4 shipped without. Added to Task 2, with the caller fix-up in Task 2 step 5 and the real value in Task 5.

**Second gap:** nothing in the spec says who may `claimHost`. Task 4 restricts it to room members and tests that a non-member is refused — otherwise anyone holding a socket on the grid could seize a hostless room without joining it.

**Third gap:** the spec says one socket per client, and milestone 4 shipped one per hook call. Task 1 was added for it rather than leaving the dock to add a fourth.

**Placeholder scan:** no TBDs, no "add error handling", no "similar to Task N". Every code step carries the code. Task 1 step 5's temporary payload and Task 2 step 6's switch-over are the one forward reference, and both ends are named.

**Type consistency.** `RoomState` field names are identical in Tasks 2, 3, 4, 7, 8 and 11. `positionNow` (never `positionAt`) throughout. `ServerClock.now(localNow)` is the shape `createSyncController`, `Dock` and `TheaterTransport` all consume. `RoomView` is `{ state, inRoom, requests }` in Tasks 8 through 12. `Room.requestControl` returns `string | null` in Task 4 and is consumed that way in Task 5. `chip-button` is defined once in Task 10's CSS and used in Tasks 10 and 11.

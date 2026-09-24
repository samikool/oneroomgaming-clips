# Milestone 6: Social — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The site stops being a place you watch things alone and becomes a place you talk about them — chat and reactions in the theater, comments on every clip, and metadata you can click to filter the library by.

**Architecture:** Two halves, theater first. The theater half is pure realtime: an in-memory chat log and reaction fan-out beside the existing `Room`, filling the Chat tab and fullscreen overlay slot milestone 5 reserved. The library half is database-backed: server actions mutate SQLite and fire the same fire-and-forget `/emit` the pipeline already uses, so a comment appears on everyone's clip page without a poll. **No migration** — the whole social schema landed in milestone 2 and has been sitting unused.

**Tech Stack:** Next 16.3.5, React 19.3.0, TypeScript, bun 1.4.2, Drizzle 0.45.3 on `bun:sqlite`, `ws` 8.21.3, Tailwind 4.3.3.

**Spec:** `docs/superpowers/specs/2026-09-21-clips-site-design.md`

## Global Constraints

- Runtime is **bun 1.4.2**. Tests are `bun test` importing from `"bun:test"`. **No Vitest** — it runs under Node, where `bun:sqlite` cannot resolve.
- **No new dependencies.** This milestone needs none.
- **No migration.** `tags`, `clip_tags`, `clip_participants`, `comments`, `views` and `games` all exist in `src/db/schema.ts` already. If you find yourself running `drizzle-kit generate`, stop and re-read the schema — you are about to duplicate a table.
- `src/realtime/*` must **never** import from `next/*`, `src/db/*`, `src/lib/media/*`, `src/lib/jobs/*` or `src/lib/ingest/*`. It is bundled separately with `bun build --target=bun` and **does nothing that can block**. It may import from `src/lib/realtime/*`, which is pure.
- **Wire identity is the Authentik username**, never the ULID. The ULID is an internal surrogate key for foreign keys inside `web`'s database.
- **Backpressure: never drop room state or chat.** Reactions and presence are droppable; chat is not. `isEphemeral` is the single place this is decided.
- Tailwind 4 `@theme` token utilities (`bg-surface-raised`, `text-ink`, `text-ink-muted`). Never arbitrary `[var(--color-…)]`. There is no `tailwind.config.js`.
- Suite is **286 tests across 32 files**, all passing; `bun run build` clean. Report real counts, never predicted ones.
- Test output must stay as clean as it is. Known pre-existing noise: `realtime listening on :3099` from `index.test.ts` and `job transcode failed …` from `runner.test.ts`.
- Every task ends with a commit.

## Dev environment — read before running anything

A dev stack is already running and **must be left alone**:

- `realtime` on **3001** (`EMIT_SECRET=devsecret`)
- Next on **3002** (`DEV_AUTH_USERNAME=localdev`, `REALTIME_URL=http://127.0.0.1:3001`, `EMIT_SECRET=devsecret`)
- A **root-owned** Caddy on **3000** from `dev/Caddyfile`, which serves `/media/*` off disk, proxies `/ws*` to 3001 and everything else to 3002.

Browse the site at **:3000**, not :3002 — the socket only works through Caddy. An agent session cannot restart that Caddy; if `dev/Caddyfile` changes, ask Sam.

**Restarting `realtime` wipes the room and the chat log.** That is by design (Task 2) but it will surprise you mid-test.

An unrelated project's `next-server` also runs on this machine — **never use broad `pkill` patterns**; kill only a PID you have identified.

**There may be no browser.** The Claude-in-Chrome extension was not connected during milestone 5. Verify protocol behaviour by driving real sockets from a `bun` script with distinct `X-Authentik-Username` headers — that is how the whole host/follower flow was verified — and state plainly which click-level checks still need a human.

## What already exists

Milestone 5 left three things deliberately unfinished, and this milestone fills all three:

1. **The Chat tab** in `src/components/theater.tsx` renders `"Chat arrives in the next release."`
2. **The fullscreen overlay panel** holds only the watching list, with a comment marking where chat goes.
3. **`chat.send` and `reaction.send`** are named in `src/lib/realtime/envelope.test.ts` as examples of message types that must be *rejected*. That test changes in Task 1.

Also relevant:

- `src/db/schema.ts` has every social table, unused. `comments.positionMs` is nullable and was put there so playhead-anchored comments are a UI change with no migration — this milestone still does not use it.
- `src/lib/realtime/publish.ts` fire-and-forgets to `/emit` and **never throws**. Every server action in the library half uses it.
- `src/realtime/room.ts` holds a `#lastRequest` map used for rate-limiting control requests. Task 1 extracts that pattern so chat and reactions can share it.
- There are **no server actions anywhere in this repo yet**. Task 6 introduces the first.
- `listAllClips(db, limit = 100)` has a hard limit of 100 with no pagination. This milestone does not fix that; it is logged as a known deferred item.

## Deliberate decisions, and why

Record these in the commit messages so a later reader does not think they were accidents.

- **`comment.added` rides the `grid` topic, filtered by `clipId` in the browser.** Topics are a fixed three-value enum; a per-clip topic would need parameterised subscriptions the hub does not have. For 5–10 friends commenting occasionally, fanning a small message to everyone and filtering client-side is the cheaper correct thing. If the fan-out ever matters, the fix is a `clip` topic, not a redesign.
- **Reactions are ephemeral and have no table.** The spec's data model lists none, and the envelope's `reaction` is a room message. They float across the video and are gone. Per-clip persistent reactions are a different feature nobody asked for.
- **Chat is ephemeral but has a bounded in-memory backlog.** The spec says theater chat is ephemeral and per-clip comments are the persistent thing. A backlog of zero means joining mid-conversation shows an empty panel, which reads as broken. `CHAT_BACKLOG` is 50 messages, in memory, lost on restart exactly like room state.
- **Reactions come from a fixed allowlist.** The envelope says `{ emoji }` with no constraint. Rendering an arbitrary user-supplied string as an "emoji" is an abuse surface for no gain, and a fixed set is better UX anyway — one tap, no picker.
- **Anyone may edit any clip's tags, game and participants; only the author may delete their own comment.** The spec sets no permission model. This is a private site for a fixed group of friends, so metadata is communal; a comment is someone's words and deleting it is theirs alone.
- **Comment deletion is a soft delete.** The `deleted_at` column already exists. A deleted comment renders as a tombstone rather than vanishing, so a thread does not become incoherent.

## File Structure

```
src/lib/realtime/
  envelope.ts            MODIFY — chat.*, reaction.*, comment.added; topics; ephemerality
  envelope.test.ts       MODIFY
  chat.ts                NEW    — pure: text/emoji validation, REACTIONS allowlist
  chat.test.ts           NEW

src/realtime/
  rate-limit.ts          NEW    — pure per-user cooldown, shared by room/chat/reactions
  rate-limit.test.ts     NEW
  chat-log.ts            NEW    — bounded in-memory backlog. No I/O.
  chat-log.test.ts       NEW
  room.ts                MODIFY — use RateLimiter instead of its own map
  index.ts               MODIFY — route chat.send / reaction.send

src/components/
  theater-chat.tsx       NEW    — message list + composer, used in tab AND overlay
  reaction-bar.tsx       NEW    — the six buttons
  reaction-stream.tsx    NEW    — floating emoji over the video
  theater.tsx            MODIFY — fill the Chat tab and the overlay
  comment-list.tsx       NEW    — comments on a clip, live
  comment-form.tsx       NEW
  clip-metadata.tsx      NEW    — tags/game/participants, clickable + editable
  filter-chips.tsx       NEW    — active filters above the grid
  disk-usage.tsx         NEW
  clip-card.tsx          MODIFY — link the uploader and game

src/db/
  comments.ts            NEW    — queries with the author joined
  comments.test.ts       NEW
  metadata.ts            NEW    — tags, games, participants read/write
  metadata.test.ts       NEW
  clips.ts               MODIFY — listClips(db, filters), totalDiskBytes

src/lib/
  filters.ts             NEW    — pure: URL searchParams <-> ClipFilters
  filters.test.ts        NEW
  format.ts              MODIFY — formatBytes
  format.test.ts         MODIFY
  events/social.ts       NEW    — announceComment

src/app/
  clips/[id]/page.tsx    MODIFY — comments + metadata
  clips/[id]/actions.ts  NEW    — the repo's first server actions
  page.tsx               MODIFY — searchParams -> filters, chips, disk usage
  globals.css            MODIFY — chat, reactions, chips

content/changelog/0.0.6.md  NEW
docs/DEPLOYMENT.md          MODIFY
```

---

## Phase A — the theater talks back

Tasks 1–4. At the end of Task 4 the theater is complete and independently shippable; that is a sensible place to stop and deploy if you want a checkpoint.

---

### Task 1: The chat and reaction envelope

Message types, validation, and the reaction allowlist. Pure — no behaviour, but everything downstream depends on these names.

**Files:**
- Create: `src/lib/realtime/chat.ts`
- Create: `src/lib/realtime/chat.test.ts`
- Modify: `src/lib/realtime/envelope.ts`
- Modify: `src/lib/realtime/envelope.test.ts`

**Interfaces:**
- Consumes: `ServerMessage`, `ClientMessage`, `Topic`, `topicsFor`, `isEphemeral`, `parseClientMessage` from milestone 5.
- Produces:
  - `MAX_CHAT_LENGTH = 500`
  - `REACTIONS: readonly string[]` and `isReaction(value: unknown): value is string`
  - `normalizeChatText(raw: unknown): string | null`
  - `type ChatMessage = { id: string; user: string; text: string; at: number }`
  - Client messages `{ t: "chat.send"; text: string }`, `{ t: "reaction.send"; emoji: string }`
  - Server messages `{ t: "chat"; message: ChatMessage }`, `{ t: "chat.backlog"; messages: ChatMessage[] }`, `{ t: "reaction"; user: string; emoji: string; at: number }`

- [ ] **Step 1: Write the failing test for chat validation**

Create `src/lib/realtime/chat.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  isReaction,
  MAX_CHAT_LENGTH,
  normalizeChatText,
  REACTIONS,
} from "@/lib/realtime/chat";

describe("normalizeChatText", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeChatText("  hello  ")).toBe("hello");
  });

  it("rejects an empty or whitespace-only message", () => {
    expect(normalizeChatText("")).toBeNull();
    expect(normalizeChatText("   \n  ")).toBeNull();
  });

  it("rejects anything that is not a string", () => {
    expect(normalizeChatText(42)).toBeNull();
    expect(normalizeChatText(null)).toBeNull();
    expect(normalizeChatText(["hi"])).toBeNull();
  });

  it("truncates rather than rejecting an over-long message", () => {
    // Rejecting would lose what someone typed. Truncating keeps it, and the
    // composer shows the limit anyway.
    const long = "x".repeat(MAX_CHAT_LENGTH + 50);
    expect(normalizeChatText(long)).toHaveLength(MAX_CHAT_LENGTH);
  });

  it("collapses newlines so one message cannot scroll the panel away", () => {
    expect(normalizeChatText("a\n\n\nb")).toBe("a b");
  });
});

describe("REACTIONS", () => {
  it("is a small fixed set", () => {
    expect(REACTIONS.length).toBeGreaterThan(0);
    expect(REACTIONS.length).toBeLessThanOrEqual(8);
  });

  it("accepts a member of the set", () => {
    expect(isReaction(REACTIONS[0])).toBe(true);
  });

  it("rejects anything outside it", () => {
    // Rendering an arbitrary user-supplied string as an "emoji" is an abuse
    // surface for no gain.
    expect(isReaction("<script>")).toBe(false);
    expect(isReaction("🦄")).toBe(false);
    expect(isReaction(7)).toBe(false);
    expect(isReaction(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/realtime/chat.test.ts`
Expected: FAIL — `Cannot find module '@/lib/realtime/chat'`

- [ ] **Step 3: Implement it**

Create `src/lib/realtime/chat.ts`:

```ts
/** Longer than anyone types in a theater, short enough not to wreck the panel. */
export const MAX_CHAT_LENGTH = 500;

/**
 * The reactions people may send.
 *
 * A fixed set rather than a free `emoji` string: rendering arbitrary
 * user-supplied text as an "emoji" is an abuse surface for no gain, and six
 * one-tap buttons are better UX than a picker.
 */
export const REACTIONS = ["🔥", "😂", "💀", "🎯", "😮", "👏"] as const;

export function isReaction(value: unknown): value is string {
  return typeof value === "string" && (REACTIONS as readonly string[]).includes(value);
}

export type ChatMessage = { id: string; user: string; text: string; at: number };

/**
 * Cleans a chat message, or returns null if there is nothing to send.
 *
 * Over-long messages are truncated rather than rejected: rejecting silently
 * loses what someone typed, and the composer already shows the limit.
 */
export function normalizeChatText(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }

  // Collapse all whitespace runs, so one message cannot scroll the panel away
  // with newlines.
  const collapsed = raw.replace(/\s+/g, " ").trim();

  if (collapsed.length === 0) {
    return null;
  }

  return collapsed.slice(0, MAX_CHAT_LENGTH);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/lib/realtime/chat.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing envelope tests**

In `src/lib/realtime/envelope.test.ts`, **replace** the existing "rejects an unknown message type" test — it currently uses `chat.send` and `reaction.send` as examples of reserved-but-unimplemented names, and both are implemented now:

```ts
  it("rejects an unknown message type", () => {
    // chat.send and reaction.send stood here while milestone 6 was
    // unimplemented. view.start is the last name still reserved.
    expect(parseClientMessage('{"t":"view.start","clipId":"01A"}')).toBeNull();
    expect(parseClientMessage('{"t":"nonsense"}')).toBeNull();
  });
```

Then append:

```ts
describe("parseClientMessage — chat and reactions", () => {
  it("accepts a chat message and trims it", () => {
    expect(parseClientMessage(JSON.stringify({ t: "chat.send", text: "  nice  " }))).toEqual({
      t: "chat.send",
      text: "nice",
    });
  });

  it("rejects an empty chat message", () => {
    expect(parseClientMessage(JSON.stringify({ t: "chat.send", text: "   " }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "chat.send" }))).toBeNull();
  });

  it("accepts a reaction from the allowlist", () => {
    expect(parseClientMessage(JSON.stringify({ t: "reaction.send", emoji: "🔥" }))).toEqual({
      t: "reaction.send",
      emoji: "🔥",
    });
  });

  it("rejects a reaction outside the allowlist", () => {
    expect(parseClientMessage(JSON.stringify({ t: "reaction.send", emoji: "🦄" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "reaction.send", emoji: "<img>" }))).toBeNull();
  });
});

describe("topicsFor — social messages", () => {
  const message = { id: "c1", user: "sam", text: "hi", at: 1 };

  it("routes chat to the room topic", () => {
    expect(topicsFor({ t: "chat", message })).toEqual(["room"]);
    expect(topicsFor({ t: "chat.backlog", messages: [message] })).toEqual(["room"]);
  });

  it("routes reactions to the room topic", () => {
    expect(topicsFor({ t: "reaction", user: "sam", emoji: "🔥", at: 1 })).toEqual(["room"]);
  });

  it("routes a new comment to the grid topic", () => {
    // Topics are a fixed enum; a per-clip topic would need parameterised
    // subscriptions the hub does not have. The browser filters by clipId.
    const comment = { id: "1", clipId: "01A", user: "sam", body: "gg", at: 1, deleted: false };
    expect(topicsFor({ t: "comment.added", comment })).toEqual(["grid"]);
  });
});

describe("isEphemeral — social messages", () => {
  it("treats reactions as droppable", () => {
    expect(isEphemeral({ t: "reaction", user: "sam", emoji: "🔥", at: 1 })).toBe(true);
  });

  it("never drops chat", () => {
    // The spec is explicit: backpressure drops reactions and progress ticks,
    // never room state or chat. A slow client degrades; it does not lose the
    // conversation.
    const message = { id: "c1", user: "sam", text: "hi", at: 1 };
    expect(isEphemeral({ t: "chat", message })).toBe(false);
    expect(isEphemeral({ t: "chat.backlog", messages: [message] })).toBe(false);
  });

  it("never drops a comment", () => {
    const comment = { id: "1", clipId: "01A", user: "sam", body: "gg", at: 1, deleted: false };
    expect(isEphemeral({ t: "comment.added", comment })).toBe(false);
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `bun test src/lib/realtime/envelope.test.ts`
Expected: FAIL — chat and reaction parses return `null`, `topicsFor` does not accept the new shapes.

- [ ] **Step 7: Extend the envelope**

In `src/lib/realtime/envelope.ts`, import from the new module and add the types.

At the top:

```ts
import { isReaction, normalizeChatText, type ChatMessage } from "./chat";

export type { ChatMessage } from "./chat";
```

Add above `ServerMessage`:

```ts
/** A comment as it travels on the wire. `user` is the Authentik username. */
export type CommentSummary = {
  id: string;
  clipId: string;
  user: string;
  body: string;
  /** Milliseconds since the epoch. A Date would arrive as a string over JSON. */
  at: number;
  deleted: boolean;
};
```

Extend `ServerMessage` with four members:

```ts
  | { t: "chat"; message: ChatMessage }
  | { t: "chat.backlog"; messages: ChatMessage[] }
  | { t: "reaction"; user: string; emoji: string; at: number }
  | { t: "comment.added"; comment: CommentSummary }
```

Extend `ClientMessage` with two:

```ts
  | { t: "chat.send"; text: string }
  | { t: "reaction.send"; emoji: string }
```

Route them in `topicsFor`, in the existing `switch`:

```ts
    case "room":
    case "room.controlRequested":
    case "chat":
    case "chat.backlog":
    case "reaction":
      return ["room"];
```

`comment.added` needs no case — it falls through to the `grid` default, which is the intent. Add a comment saying so, right above `default`:

```ts
    // comment.added falls through to grid on purpose: topics are a fixed
    // enum, and the browser filters by clipId.
    default:
      return ["grid"];
```

Extend `isEphemeral`:

```ts
export function isEphemeral(message: ServerMessage): boolean {
  return (
    message.t === "upload.progress" ||
    message.t === "presence" ||
    message.t === "reaction"
  );
}
```

And parse them, inside `parseClientMessage` after the `room.control` branch:

```ts
  if (message.t === "chat.send") {
    const text = normalizeChatText(message.text);
    return text === null ? null : { t: "chat.send", text };
  }

  if (message.t === "reaction.send") {
    return isReaction(message.emoji) ? { t: "reaction.send", emoji: message.emoji } : null;
  }
```

- [ ] **Step 8: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/realtime/chat.ts src/lib/realtime/chat.test.ts \
  src/lib/realtime/envelope.ts src/lib/realtime/envelope.test.ts
git commit -m "feat: add the chat and reaction envelope

Reactions come from a fixed allowlist rather than a free emoji string:
rendering arbitrary user text as an emoji is an abuse surface for no gain,
and six one-tap buttons beat a picker.

Chat is never dropped under backpressure; reactions are. The spec is
explicit that a slow client degrades rather than losing the conversation.

comment.added rides the grid topic and is filtered by clipId in the
browser. Topics are a fixed enum, and a per-clip topic would need
parameterised subscriptions the hub does not have.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The chat log and a shared rate limiter

`realtime` gains a bounded backlog and one rate-limiter that the room, chat and reactions all share. Both pure, both with an injected clock.

**Files:**
- Create: `src/realtime/rate-limit.ts`
- Create: `src/realtime/rate-limit.test.ts`
- Create: `src/realtime/chat-log.ts`
- Create: `src/realtime/chat-log.test.ts`
- Modify: `src/realtime/room.ts`
- Modify: `src/realtime/room.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `MAX_CHAT_LENGTH` from Task 1; `REQUEST_CONTROL_COOLDOWN_MS` and `Room` from milestone 5.
- Produces:
  - `class RateLimiter` — `constructor(cooldownMs: number, now?: () => number)`, `take(key: string): boolean`
  - `CHAT_BACKLOG = 50`, `CHAT_COOLDOWN_MS = 500`, `REACTION_COOLDOWN_MS = 400`
  - `class ChatLog` — `constructor(now?: () => number)`, `add(user: string, text: string): ChatMessage`, `get messages(): ChatMessage[]`

- [ ] **Step 1: Write the failing rate-limiter test**

Create `src/realtime/rate-limit.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { RateLimiter } from "@/realtime/rate-limit";

function limiterAt(cooldown: number, start = 1_000) {
  let clock = start;
  return { limiter: new RateLimiter(cooldown, () => clock), advance: (ms: number) => (clock += ms) };
}

describe("RateLimiter", () => {
  it("allows the first take", () => {
    expect(limiterAt(1_000).limiter.take("sam")).toBe(true);
  });

  it("refuses a second take inside the cooldown", () => {
    const { limiter, advance } = limiterAt(1_000);
    limiter.take("sam");
    advance(999);

    expect(limiter.take("sam")).toBe(false);
  });

  it("allows another take once the cooldown has elapsed", () => {
    const { limiter, advance } = limiterAt(1_000);
    limiter.take("sam");
    advance(1_000);

    expect(limiter.take("sam")).toBe(true);
  });

  it("limits per key, not globally", () => {
    const { limiter } = limiterAt(1_000);
    limiter.take("sam");

    expect(limiter.take("dave")).toBe(true);
  });

  it("does not move the clock forward on a refused take", () => {
    // A refused attempt must not extend the cooldown, or someone hammering a
    // button would never be allowed through again.
    const { limiter, advance } = limiterAt(1_000);
    limiter.take("sam");
    advance(600);
    limiter.take("sam");
    advance(400);

    expect(limiter.take("sam")).toBe(true);
  });
});
```

The last test is the one worth writing. A limiter that records the *attempt* rather than the *success* locks out anyone who double-clicks, permanently.

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/realtime/rate-limit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/realtime/rate-limit.ts`:

```ts
/**
 * A per-key cooldown.
 *
 * Extracted from `Room`, which grew one of these inline for control requests
 * and now shares it with chat and reactions. No I/O, injected clock.
 */
export class RateLimiter {
  readonly #last = new Map<string, number>();
  readonly #cooldownMs: number;
  readonly #now: () => number;

  constructor(cooldownMs: number, now: () => number = Date.now) {
    this.#cooldownMs = cooldownMs;
    this.#now = now;
  }

  /** True when the caller may proceed, and only then is the clock recorded. */
  take(key: string): boolean {
    const now = this.#now();
    const last = this.#last.get(key);

    if (last !== undefined && now - last < this.#cooldownMs) {
      // Deliberately does NOT record: recording a refused attempt would
      // extend the cooldown every time someone double-clicks, locking them
      // out for as long as they keep trying.
      return false;
    }

    this.#last.set(key, now);
    return true;
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/realtime/rate-limit.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing chat-log test**

Create `src/realtime/chat-log.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { CHAT_BACKLOG, ChatLog } from "@/realtime/chat-log";

function logAt(start = 1_000) {
  let clock = start;
  return { log: new ChatLog(() => clock), advance: (ms: number) => (clock += ms) };
}

describe("ChatLog", () => {
  it("starts empty", () => {
    expect(new ChatLog().messages).toEqual([]);
  });

  it("stamps a message with the author, the text and the server clock", () => {
    const { log } = logAt(5_000);
    const message = log.add("sam", "gg");

    expect(message).toMatchObject({ user: "sam", text: "gg", at: 5_000 });
    expect(typeof message.id).toBe("string");
    expect(message.id.length).toBeGreaterThan(0);
  });

  it("gives every message a distinct id even within one millisecond", () => {
    // React keys the list on this. Two messages sharing an id would make one
    // of them disappear.
    const { log } = logAt();
    const first = log.add("sam", "a");
    const second = log.add("sam", "b");

    expect(first.id).not.toBe(second.id);
  });

  it("keeps messages in the order they arrived", () => {
    const { log, advance } = logAt();
    log.add("sam", "first");
    advance(10);
    log.add("dave", "second");

    expect(log.messages.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("keeps only the most recent window", () => {
    const { log } = logAt();

    for (let i = 0; i < CHAT_BACKLOG + 10; i += 1) {
      log.add("sam", `message ${i}`);
    }

    expect(log.messages).toHaveLength(CHAT_BACKLOG);
    expect(log.messages[0].text).toBe("message 10");
  });

  it("hands out a copy, so a caller cannot mutate the log", () => {
    const { log } = logAt();
    log.add("sam", "gg");
    log.messages.push({ id: "x", user: "evil", text: "nope", at: 0 });

    expect(log.messages).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `bun test src/realtime/chat-log.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 7: Implement it**

Create `src/realtime/chat-log.ts`:

```ts
import type { ChatMessage } from "@/lib/realtime/chat";

/**
 * How many messages a joiner sees.
 *
 * The spec says theater chat is ephemeral and per-clip comments are the
 * persistent thing. A backlog of zero would be the most literal reading, but
 * it means joining mid-conversation shows an empty panel, which reads as
 * broken. Fifty messages in memory, lost on restart exactly like room state.
 */
export const CHAT_BACKLOG = 50;

/** Cooldowns, per user. Fast enough to feel free, slow enough to stop a flood. */
export const CHAT_COOLDOWN_MS = 500;
export const REACTION_COOLDOWN_MS = 400;

export class ChatLog {
  #messages: ChatMessage[] = [];
  #sequence = 0;
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  add(user: string, text: string): ChatMessage {
    // The id carries a counter as well as the clock: React keys the list on
    // it, and two messages in the same millisecond sharing an id would make
    // one of them disappear.
    this.#sequence += 1;
    const message: ChatMessage = {
      id: `${this.#now()}-${this.#sequence}`,
      user,
      text,
      at: this.#now(),
    };

    this.#messages = [...this.#messages, message].slice(-CHAT_BACKLOG);
    return message;
  }

  /** A copy: the caller serialises this straight onto the wire. */
  get messages(): ChatMessage[] {
    return [...this.#messages];
  }
}
```

- [ ] **Step 8: Run it and watch it pass**

Run: `bun test src/realtime/chat-log.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 9: Move `Room` onto the shared limiter**

In `src/realtime/room.ts`:

Add the import:

```ts
import { RateLimiter } from "./rate-limit";
```

Replace the field:

```ts
  readonly #lastRequest = new Map<string, number>();
```

with:

```ts
  readonly #requestLimiter: RateLimiter;
```

Set it in the constructor:

```ts
  constructor(now: () => number = Date.now) {
    this.#now = now;
    this.#requestLimiter = new RateLimiter(REQUEST_CONTROL_COOLDOWN_MS, now);
  }
```

And replace the body of the cooldown check in `requestControl`:

```ts
  requestControl(user: string): string | null {
    const host = this.#state.hostUserId;

    if (host === null || host === user || !this.#members.has(user)) {
      return null;
    }

    return this.#requestLimiter.take(user) ? host : null;
  }
```

- [ ] **Step 10: Run the room tests unchanged**

Run: `bun test src/realtime/room.test.ts`
Expected: PASS, 34 tests, **with no changes to the test file.** The rate-limiting tests written in milestone 5 are the proof this refactor preserved behaviour — if any of them fail, the extraction changed something.

- [ ] **Step 11: Run the suite and typecheck**

Run: `bun test && bunx tsc --noEmit`
Expected: all green.

- [ ] **Step 12: Commit**

```bash
git add src/realtime/rate-limit.ts src/realtime/rate-limit.test.ts \
  src/realtime/chat-log.ts src/realtime/chat-log.test.ts src/realtime/room.ts
git commit -m "feat: add the chat log and a shared rate limiter

RateLimiter records the clock only on a SUCCESSFUL take. Recording refused
attempts would extend the cooldown every time someone double-clicks,
locking them out for as long as they keep trying.

Room's inline cooldown map becomes the shared limiter, with milestone 5's
rate-limiting tests passing unchanged as proof the extraction preserved
behaviour.

The chat backlog is 50 messages in memory. Zero would be the most literal
reading of 'ephemeral', but joining mid-conversation to an empty panel
reads as broken.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Route chat and reactions through the socket server

**Files:**
- Modify: `src/realtime/index.ts`
- Modify: `src/realtime/index.test.ts`

**Interfaces:**
- Consumes: `ChatLog`, `RateLimiter`, `CHAT_COOLDOWN_MS`, `REACTION_COOLDOWN_MS` from Task 2; the envelope from Task 1.
- Produces: no new exports.

- [ ] **Step 1: Write the failing socket tests**

Append to `src/realtime/index.test.ts`. It already has `connect(username)`, `waitFor(ws, predicate)`, `joinRoomTopic(username)` and `state(message)` from milestone 5 — reuse them, do not write new ones.

```ts
describe("chat and reactions over the socket", () => {
  it("fans a chat message out to the room", async () => {
    const sender = await joinRoomTopic("chat-sender");
    const listener = await joinRoomTopic("chat-listener");
    sender.send(JSON.stringify({ t: "chat.send", text: "gg" }));

    const message = await waitFor(
      listener,
      (m) => m.t === "chat" && (m.message as Record<string, unknown>).text === "gg",
    );
    expect((message.message as Record<string, unknown>).user).toBe("chat-sender");
    sender.close();
    listener.close();
  });

  it("does not send chat to a grid-only subscriber", async () => {
    const gridOnly = connect("chat-gridonly");
    await waitFor(gridOnly, (m) => m.t === "hello");
    gridOnly.send(JSON.stringify({ t: "sub", topics: ["grid"] }));
    await waitFor(gridOnly, (m) => m.t === "presence");

    let sawChat = false;
    gridOnly.addEventListener("message", (event) => {
      if ((JSON.parse(String(event.data)) as { t: string }).t === "chat") {
        sawChat = true;
      }
    });

    const sender = await joinRoomTopic("chat-elsewhere");
    sender.send(JSON.stringify({ t: "chat.send", text: "not for the grid" }));
    await waitFor(sender, (m) => m.t === "chat");
    await Bun.sleep(100);

    expect(sawChat).toBe(false);
    gridOnly.close();
    sender.close();
  });

  it("hands a new room subscriber the backlog", async () => {
    const speaker = await joinRoomTopic("backlog-speaker");
    speaker.send(JSON.stringify({ t: "chat.send", text: "said before you arrived" }));
    await waitFor(speaker, (m) => m.t === "chat");

    const latecomer = connect("backlog-latecomer");
    await waitFor(latecomer, (m) => m.t === "hello");
    latecomer.send(JSON.stringify({ t: "sub", topics: ["room"] }));

    const backlog = await waitFor(latecomer, (m) => m.t === "chat.backlog");
    const texts = (backlog.messages as { text: string }[]).map((m) => m.text);
    expect(texts).toContain("said before you arrived");
    speaker.close();
    latecomer.close();
  });

  it("rate-limits a burst of chat from one user", async () => {
    const ws = await joinRoomTopic("chat-flooder");
    let delivered = 0;
    ws.addEventListener("message", (event) => {
      if ((JSON.parse(String(event.data)) as { t: string }).t === "chat") {
        delivered += 1;
      }
    });

    for (let i = 0; i < 5; i += 1) {
      ws.send(JSON.stringify({ t: "chat.send", text: `flood ${i}` }));
    }

    await Bun.sleep(300);
    expect(delivered).toBe(1);
    ws.close();
  });

  it("fans a reaction out with its author", async () => {
    const sender = await joinRoomTopic("react-sender");
    const listener = await joinRoomTopic("react-listener");
    sender.send(JSON.stringify({ t: "reaction.send", emoji: "🔥" }));

    const message = await waitFor(listener, (m) => m.t === "reaction");
    expect(message).toMatchObject({ t: "reaction", user: "react-sender", emoji: "🔥" });
    sender.close();
    listener.close();
  });

  it("ignores a reaction outside the allowlist", async () => {
    const ws = await joinRoomTopic("react-cheater");
    let sawReaction = false;
    ws.addEventListener("message", (event) => {
      if ((JSON.parse(String(event.data)) as { t: string }).t === "reaction") {
        sawReaction = true;
      }
    });

    ws.send(JSON.stringify({ t: "reaction.send", emoji: "<script>alert(1)</script>" }));
    await Bun.sleep(150);

    expect(sawReaction).toBe(false);
    ws.close();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bun test src/realtime/index.test.ts`
Expected: FAIL — chat and reaction frames are ignored, no backlog arrives.

- [ ] **Step 3: Wire it up**

In `src/realtime/index.ts`:

Add the imports and instances beside the existing `hub` and `room`:

```ts
import { CHAT_COOLDOWN_MS, ChatLog, REACTION_COOLDOWN_MS } from "./chat-log";
import { RateLimiter } from "./rate-limit";

const hub = new Hub();
const room = new Room();
const chatLog = new ChatLog();
const chatLimiter = new RateLimiter(CHAT_COOLDOWN_MS);
const reactionLimiter = new RateLimiter(REACTION_COOLDOWN_MS);
```

In `handleRoomMessage`, add two cases before `default`:

```ts
    case "chat.send": {
      // A refused message is dropped in silence. The sender's composer has
      // already cleared; telling them they typed too fast is noise.
      if (!chatLimiter.take(username)) {
        return;
      }

      hub.publish({ t: "chat", message: chatLog.add(username, message.text) });
      return;
    }

    case "reaction.send":
      if (!reactionLimiter.take(username)) {
        return;
      }

      hub.publish({ t: "reaction", user: username, emoji: message.emoji, at: Date.now() });
      return;
```

And in the `sub` handler, send the backlog alongside the room snapshot:

```ts
        if (message.topics.includes("room")) {
          ws.send(JSON.stringify({ t: "room", state: room.state }));
          ws.send(JSON.stringify({ t: "chat.backlog", messages: chatLog.messages }));
        }
```

- [ ] **Step 4: Run them and watch them pass**

Run: `bun test src/realtime/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm realtime still boots standalone**

```bash
EMIT_SECRET=x REALTIME_PORT=3097 timeout 3 bun src/realtime/index.ts > /tmp/rt.log 2>&1; cat /tmp/rt.log
```

Expected: `realtime listening on :3097`. A chat log that accidentally imported something from `web` would fail here, not in the tests.

- [ ] **Step 6: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/realtime/index.ts src/realtime/index.test.ts
git commit -m "feat: route chat and reactions through the socket server

Backlog goes out with the room snapshot, so joining mid-conversation is not
an empty panel. A rate-limited message is dropped in silence — the sender's
composer has already cleared, and telling them they typed too fast is
noise.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Chat and reactions in the theater

Fills both slots milestone 5 reserved: the Chat tab and the fullscreen overlay.

**Files:**
- Create: `src/components/theater-chat.tsx`
- Create: `src/components/reaction-bar.tsx`
- Create: `src/components/reaction-stream.tsx`
- Create: `src/lib/theater/chat-store.ts`
- Create: `src/lib/theater/chat-store.test.ts`
- Modify: `src/lib/theater/use-room.ts`
- Modify: `src/components/theater.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `ChatMessage`, `REACTIONS`, `MAX_CHAT_LENGTH` from Task 1; `useRoom` from milestone 5.
- Produces:
  - `reduceChat(messages: ChatMessage[], message: ServerMessage): ChatMessage[]`
  - `useRoom()` return type gains `chat: ChatMessage[]` and `reactions: FloatingReaction[]`
  - `type FloatingReaction = { key: string; emoji: string; user: string; lane: number }`
  - `<TheaterChat messages me onSend />`, `<ReactionBar onReact />`, `<ReactionStream reactions />`

- [ ] **Step 1: Write the failing chat-store test**

Create `src/lib/theater/chat-store.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import type { ChatMessage, ServerMessage } from "@/lib/realtime/envelope";
import { CHAT_VIEW_LIMIT, reduceChat } from "@/lib/theater/chat-store";

const message = (id: string, text: string): ChatMessage => ({ id, user: "sam", text, at: 1 });

describe("reduceChat", () => {
  it("appends a new message", () => {
    const next = reduceChat([], { t: "chat", message: message("1", "hi") });
    expect(next.map((m) => m.text)).toEqual(["hi"]);
  });

  it("replaces everything with a backlog", () => {
    // The backlog arrives on reconnect as well as on first subscribe. Merging
    // it would duplicate every message a client already had.
    const existing = [message("1", "old")];
    const next = reduceChat(existing, {
      t: "chat.backlog",
      messages: [message("1", "old"), message("2", "newer")],
    });

    expect(next.map((m) => m.text)).toEqual(["old", "newer"]);
  });

  it("ignores a message it already has", () => {
    const existing = [message("1", "hi")];
    expect(reduceChat(existing, { t: "chat", message: message("1", "hi") })).toBe(existing);
  });

  it("caps what it keeps in memory", () => {
    let view: ChatMessage[] = [];

    for (let i = 0; i < CHAT_VIEW_LIMIT + 20; i += 1) {
      view = reduceChat(view, { t: "chat", message: message(String(i), `m${i}`) });
    }

    expect(view).toHaveLength(CHAT_VIEW_LIMIT);
    expect(view[view.length - 1].text).toBe(`m${CHAT_VIEW_LIMIT + 19}`);
  });

  it("returns the same array for an unrelated message", () => {
    const existing = [message("1", "hi")];
    const unrelated: ServerMessage = { t: "presence", online: ["sam"], inRoom: [] };
    expect(reduceChat(existing, unrelated)).toBe(existing);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/theater/chat-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/lib/theater/chat-store.ts`:

```ts
import type { ChatMessage, ServerMessage } from "@/lib/realtime/envelope";

/** How much scrollback a browser keeps. Larger than the server's backlog. */
export const CHAT_VIEW_LIMIT = 200;

/**
 * Folds chat traffic into the browser's message list.
 *
 * Returns the SAME array when nothing changed, so a component reading it does
 * not re-render on every unrelated room snapshot.
 */
export function reduceChat(messages: ChatMessage[], message: ServerMessage): ChatMessage[] {
  if (message.t === "chat.backlog") {
    // Replace rather than merge. The backlog arrives on every reconnect, and
    // merging would duplicate everything the client already had.
    return message.messages.slice(-CHAT_VIEW_LIMIT);
  }

  if (message.t === "chat") {
    if (messages.some((existing) => existing.id === message.message.id)) {
      return messages;
    }

    return [...messages, message.message].slice(-CHAT_VIEW_LIMIT);
  }

  return messages;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/lib/theater/chat-store.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Extend `useRoom`**

In `src/lib/theater/use-room.ts`:

Add imports:

```ts
import type { ChatMessage } from "@/lib/realtime/envelope";
import { reduceChat } from "./chat-store";
```

Add to the `Room` type:

```ts
export type FloatingReaction = { key: string; emoji: string; user: string; lane: number };

export type Room = {
  view: RoomView;
  chat: ChatMessage[];
  reactions: FloatingReaction[];
  clock: ServerClock;
  send(message: ClientMessage): void;
  dismiss(user: string): void;
};
```

Add the state and a sequence ref beside the existing ones:

```ts
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const reactionSeq = useRef(0);
```

Extend the handler inside the existing `register` call:

```ts
      handler: (message: ServerMessage) => {
        sampler.receive(message);
        setView((current) => reduceRoom(current, message, Date.now()));
        setChat((current) => reduceChat(current, message));

        if (message.t === "reaction") {
          reactionSeq.current += 1;
          const key = `${message.at}-${reactionSeq.current}`;
          // A lane keeps two simultaneous reactions from drawing on top of
          // each other. Derived, not random, so a re-render does not move it.
          const lane = reactionSeq.current % 5;
          setReactions((current) => [
            ...current.slice(-20),
            { key, emoji: message.emoji, user: message.user, lane },
          ]);
          setTimeout(
            () => setReactions((current) => current.filter((r) => r.key !== key)),
            REACTION_LIFETIME_MS,
          );
        }
      },
```

Add the constant at the top of the file:

```ts
/** Long enough to read, short enough not to sit on the gameplay. */
const REACTION_LIFETIME_MS = 3_000;
```

And return the new fields:

```ts
  return { view, chat, reactions, clock, send, dismiss };
```

- [ ] **Step 6: Build the chat panel**

Create `src/components/theater-chat.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/realtime/envelope";
import { MAX_CHAT_LENGTH } from "@/lib/realtime/chat";

/**
 * Used twice: as the sidebar tab and inside the fullscreen overlay. Both need
 * the same list and composer, so it takes its messages as a prop rather than
 * calling useRoom itself.
 */
export function TheaterChat({
  messages,
  me,
  onSend,
  compact = false,
}: {
  messages: ChatMessage[];
  me: string;
  onSend(text: string): void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  // Follow the conversation. There is no scroll-position check: in a room this
  // small, chat that does not follow is chat you miss.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const text = draft.trim();

    if (text.length === 0) {
      return;
    }

    onSend(text);
    setDraft("");
  }

  return (
    <div className={`theater-chat ${compact ? "theater-chat-compact" : ""}`}>
      <ol className="theater-chat-list">
        {messages.length === 0 && (
          <li className="text-sm text-ink-muted">Nothing said yet.</li>
        )}
        {messages.map((message) => (
          <li key={message.id} className="text-sm">
            <span className={message.user === me ? "text-ink" : "text-ink-muted"}>
              {message.user}
            </span>{" "}
            <span className="text-ink">{message.text}</span>
          </li>
        ))}
        <div ref={endRef} />
      </ol>
      <form onSubmit={submit} className="theater-chat-form">
        <input
          className="title-input"
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Say something"
          aria-label="Chat message"
          onChange={(event) => setDraft(event.target.value)}
          // Escape exits fullscreen. Without this the input swallows it and
          // people get stuck in fullscreen with no way out but F11.
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.blur();
            }
          }}
        />
        <button type="submit" className="button-secondary">
          Send
        </button>
      </form>
    </div>
  );
}
```

The `Escape` handler is the spec's warning made concrete: "the chat input must not swallow it".

- [ ] **Step 7: Build the reaction bar and stream**

Create `src/components/reaction-bar.tsx`:

```tsx
"use client";

import { REACTIONS } from "@/lib/realtime/chat";

export function ReactionBar({ onReact }: { onReact(emoji: string): void }) {
  return (
    <div className="reaction-bar">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reaction-button"
          aria-label={`React with ${emoji}`}
          onClick={() => onReact(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
```

Create `src/components/reaction-stream.tsx`:

```tsx
"use client";

import type { FloatingReaction } from "@/lib/theater/use-room";

/**
 * Reactions floating up over the video.
 *
 * `pointer-events: none` throughout — this sits on top of the player and must
 * never intercept a click meant for it.
 */
export function ReactionStream({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <div className="reaction-stream" aria-hidden="true">
      {reactions.map((reaction) => (
        <span
          key={reaction.key}
          className="reaction-float"
          style={{ left: `${10 + reaction.lane * 18}%` }}
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Fill both slots in the theater**

In `src/components/theater.tsx`:

Add the imports:

```ts
import { ReactionBar } from "./reaction-bar";
import { ReactionStream } from "./reaction-stream";
import { TheaterChat } from "./theater-chat";
```

Destructure the new fields:

```ts
  const { view, chat, reactions, clock, send, dismiss } = useRoom();
```

Add a helper beside `tapToSync`:

```ts
  function sendChat(text: string): void {
    send({ t: "chat.send", text });
  }

  function react(emoji: string): void {
    send({ t: "reaction.send", emoji });
  }
```

**Replace** the Chat tab placeholder:

```tsx
          {tab === "chat" ? (
            <p className="p-4 text-sm text-ink-muted">Chat arrives in the next release.</p>
          ) : (
```

with:

```tsx
          {tab === "chat" ? (
            <TheaterChat messages={chat} me={me} onSend={sendChat} />
          ) : (
```

Add the reaction stream and bar inside the stage, immediately after the `<video>` element and before `<TheaterTransport>`:

```tsx
              <ReactionStream reactions={reactions} />
```

and immediately after `<TheaterTransport … />`:

```tsx
              <ReactionBar onReact={react} />
```

**Replace** the overlay's comment placeholder:

```tsx
                {/* Chat overlays here in the next milestone. Its input must not
                    swallow Escape, which is how the browser exits fullscreen. */}
```

with:

```tsx
                <TheaterChat messages={chat} me={me} onSend={sendChat} compact />
```

- [ ] **Step 9: Style it**

Append to `src/app/globals.css`:

```css
.theater-chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.theater-chat-list {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 6px;
  padding: 16px; margin: 0; list-style: none;
}
.theater-chat-compact .theater-chat-list { max-height: 30vh; }
.theater-chat-form {
  display: flex; gap: 8px; padding: 12px;
  border-top: 1px solid #303b48;
}
.theater-chat-form .title-input { min-width: 0; }
.reaction-bar { display: flex; gap: 6px; margin-top: 8px; }
.reaction-button {
  min-width: 40px; min-height: 40px; border-radius: 8px;
  background: #222b36; font-size: 18px; cursor: pointer; line-height: 1;
}
.reaction-button:hover { background: #303b48; }
/* Sits on top of the player, so it must never intercept a click meant for it. */
.reaction-stream { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 5; }
.reaction-float {
  position: absolute; bottom: 8%; font-size: 28px;
  animation: reaction-rise 3s ease-out forwards;
}
@keyframes reaction-rise {
  0%   { transform: translateY(0) scale(0.8); opacity: 0; }
  15%  { opacity: 1; }
  100% { transform: translateY(-220px) scale(1.2); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .reaction-float { animation: reaction-fade 3s linear forwards; }
  @keyframes reaction-fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }
}
```

- [ ] **Step 10: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 11: Verify against the live service**

Restart the dev realtime so it has the chat log, then drive it with a script (adapt the milestone 5 pattern in `docs/DEPLOYMENT.md`): two identities subscribe to `room`, one sends `chat.send`, assert the other receives `chat` with the right author; send five in a burst and assert one arrives; send a reaction and assert it arrives; connect a third socket and assert its `chat.backlog` contains the earlier message.

Report what you actually observed. The click-level checks — composer, floating emoji, Escape not swallowing fullscreen — need a browser; say so if you do not have one.

- [ ] **Step 12: Commit**

```bash
git add src/lib/theater/chat-store.ts src/lib/theater/chat-store.test.ts \
  src/lib/theater/use-room.ts src/components/theater-chat.tsx \
  src/components/reaction-bar.tsx src/components/reaction-stream.tsx \
  src/components/theater.tsx src/app/globals.css
git commit -m "feat: add theater chat and reactions

Fills both slots milestone 5 reserved: the Chat tab and the fullscreen
overlay use the same component, which is why it takes messages as a prop
instead of calling useRoom itself.

The composer blurs on Escape rather than swallowing it — the spec's warning
made concrete, since Escape is how the browser leaves fullscreen.

A backlog REPLACES the client's list rather than merging: it arrives on
every reconnect, and merging would duplicate everything already held.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Checkpoint:** the theater is complete here. Everything from Task 5 on is the library half and can ship separately.

---

## Phase B — the library

---

### Task 5: Comment queries

**Files:**
- Create: `src/db/comments.ts`
- Create: `src/db/comments.test.ts`

**Interfaces:**
- Consumes: `Db`, `comments`, `users` from the existing schema; `ulid` from the `ulid` package (already a dependency, used by `createClip`).
- Produces:
  - `type CommentRow = { id: string; clipId: string; user: string; body: string; at: number; deleted: boolean }`
  - `addComment(db, input: { clipId: string; userId: string; body: string }): CommentRow`
  - `listComments(db, clipId: string): CommentRow[]`
  - `getComment(db, id: string): CommentRow | undefined`
  - `softDeleteComment(db, id: string, userId: string): boolean`

`CommentRow` deliberately matches `CommentSummary` from Task 1 field for field, so announcing a comment needs no mapping.

- [ ] **Step 1: Write the failing test**

Create `src/db/comments.test.ts`. Follow the in-memory pattern the other db tests use — check `src/db/clips.test.ts` for how it builds a db and seeds a user, and copy that setup rather than inventing one.

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { upsertUser } from "@/db/users";
import { createClip } from "@/db/clips";
import { addComment, getComment, listComments, softDeleteComment } from "@/db/comments";

let db: Db;
let samId: string;
let daveId: string;
let clipId: string;

beforeEach(() => {
  db = createDb(":memory:");
  samId = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  daveId = upsertUser(db, { username: "dave", email: null, displayName: null }).id;
  clipId = createClip(db, {
    id: "01TESTCLIP",
    title: "ace",
    originalFilename: "ace.mp4",
    uploaderId: samId,
  }).id;
});

describe("addComment", () => {
  it("returns the comment with the author's username, not their ULID", () => {
    // The wire identity is the Authentik username. A ULID on the page would
    // be both meaningless and a leak of an internal key.
    const comment = addComment(db, { clipId, userId: samId, body: "gg" });

    expect(comment).toMatchObject({ clipId, user: "sam", body: "gg", deleted: false });
    expect(typeof comment.at).toBe("number");
  });

  it("gives each comment a distinct id", () => {
    const first = addComment(db, { clipId, userId: samId, body: "a" });
    const second = addComment(db, { clipId, userId: samId, body: "b" });

    expect(first.id).not.toBe(second.id);
  });
});

describe("listComments", () => {
  it("is empty for a clip nobody has commented on", () => {
    expect(listComments(db, clipId)).toEqual([]);
  });

  it("returns oldest first, so a thread reads top to bottom", () => {
    addComment(db, { clipId, userId: samId, body: "first" });
    addComment(db, { clipId, userId: daveId, body: "second" });

    expect(listComments(db, clipId).map((c) => c.body)).toEqual(["first", "second"]);
  });

  it("does not return another clip's comments", () => {
    const other = createClip(db, {
      id: "01OTHERCLIP",
      title: "other",
      originalFilename: "other.mp4",
      uploaderId: samId,
    }).id;
    addComment(db, { clipId: other, userId: samId, body: "elsewhere" });

    expect(listComments(db, clipId)).toEqual([]);
  });

  it("keeps a deleted comment in the list, flagged", () => {
    // A thread with holes in it is incoherent. The tombstone stays.
    const comment = addComment(db, { clipId, userId: samId, body: "oops" });
    softDeleteComment(db, comment.id, samId);

    const listed = listComments(db, clipId);
    expect(listed).toHaveLength(1);
    expect(listed[0].deleted).toBe(true);
  });

  it("does not leak the body of a deleted comment", () => {
    const comment = addComment(db, { clipId, userId: samId, body: "regrettable" });
    softDeleteComment(db, comment.id, samId);

    expect(listComments(db, clipId)[0].body).not.toContain("regrettable");
  });
});

describe("softDeleteComment", () => {
  it("lets the author delete their own comment", () => {
    const comment = addComment(db, { clipId, userId: samId, body: "mine" });

    expect(softDeleteComment(db, comment.id, samId)).toBe(true);
    expect(getComment(db, comment.id)?.deleted).toBe(true);
  });

  it("refuses to let someone delete another person's comment", () => {
    const comment = addComment(db, { clipId, userId: samId, body: "mine" });

    expect(softDeleteComment(db, comment.id, daveId)).toBe(false);
    expect(getComment(db, comment.id)?.deleted).toBe(false);
  });

  it("returns false for a comment that does not exist", () => {
    expect(softDeleteComment(db, "01NOPE", samId)).toBe(false);
  });

  it("is idempotent", () => {
    const comment = addComment(db, { clipId, userId: samId, body: "mine" });
    softDeleteComment(db, comment.id, samId);

    expect(softDeleteComment(db, comment.id, samId)).toBe(true);
  });
});
```

If `createClip` or `upsertUser` take different arguments than shown, use the real signatures — read `src/db/clips.ts` and `src/db/users.ts` first. Do not change those functions to fit the test.

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/db/comments.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/db/comments.ts`:

```ts
import { and, asc, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { comments, users } from "./schema";

/**
 * A comment as the UI and the wire both want it: the author's Authentik
 * username rather than their ULID, and a millisecond timestamp rather than a
 * Date. Matches `CommentSummary` field for field, so announcing one needs no
 * mapping.
 */
export type CommentRow = {
  id: string;
  clipId: string;
  user: string;
  body: string;
  at: number;
  deleted: boolean;
};

/** What a deleted comment says in place of its body. */
const TOMBSTONE = "[deleted]";

type Joined = {
  id: string;
  clipId: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
  username: string | null;
};

function toRow(row: Joined): CommentRow {
  const deleted = row.deletedAt !== null;

  return {
    id: row.id,
    clipId: row.clipId,
    // The body never leaves the database once deleted. Sending it with a flag
    // and hiding it in CSS is not deletion.
    body: deleted ? TOMBSTONE : row.body,
    user: row.username ?? "unknown",
    at: row.createdAt.getTime(),
    deleted,
  };
}

const SELECTION = {
  id: comments.id,
  clipId: comments.clipId,
  body: comments.body,
  createdAt: comments.createdAt,
  deletedAt: comments.deletedAt,
  username: users.authentikUsername,
};

export function addComment(
  db: Db,
  input: { clipId: string; userId: string; body: string },
): CommentRow {
  const id = ulid();
  db.insert(comments)
    .values({
      id,
      clipId: input.clipId,
      userId: input.userId,
      body: input.body,
      positionMs: null,
      createdAt: new Date(),
      deletedAt: null,
    })
    .run();

  const row = getComment(db, id);

  if (!row) {
    throw new Error(`comment ${id} vanished immediately after insert`);
  }

  return row;
}

export function getComment(db: Db, id: string): CommentRow | undefined {
  const row = db
    .select(SELECTION)
    .from(comments)
    .leftJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.id, id))
    .get();

  return row ? toRow(row as Joined) : undefined;
}

/** Oldest first, so a thread reads top to bottom. Tombstones included. */
export function listComments(db: Db, clipId: string): CommentRow[] {
  return db
    .select(SELECTION)
    .from(comments)
    .leftJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.clipId, clipId))
    .orderBy(asc(comments.createdAt))
    .all()
    .map((row) => toRow(row as Joined));
}

/**
 * Soft-deletes a comment, but only for its author.
 *
 * Metadata on this site is communal; a comment is someone's words, and
 * deleting it is theirs alone.
 */
export function softDeleteComment(db: Db, id: string, userId: string): boolean {
  const existing = db
    .select({ id: comments.id, deletedAt: comments.deletedAt })
    .from(comments)
    .where(and(eq(comments.id, id), eq(comments.userId, userId)))
    .get();

  if (!existing) {
    return false;
  }

  if (existing.deletedAt !== null) {
    return true;
  }

  db.update(comments)
    .set({ deletedAt: new Date() })
    .where(and(eq(comments.id, id), eq(comments.userId, userId), isNull(comments.deletedAt)))
    .run();

  return true;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/db/comments.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation-test the delete authorization**

```bash
sed -i 's/and(eq(comments.id, id), eq(comments.userId, userId))/eq(comments.id, id)/' src/db/comments.ts
bun test src/db/comments.test.ts
```

Expected: FAIL on "refuses to let someone delete another person's comment". Restore with `git checkout -- src/db/comments.ts` — or, since the file is not committed yet, re-apply the `and(...)` by hand — and re-run to confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/db/comments.ts src/db/comments.test.ts
git commit -m "feat: add comment queries

Returns the author's Authentik username, never their ULID — the ULID is an
internal surrogate key and has no business on a page.

Deletion is soft and the body is replaced at the query boundary. Sending
the text with a 'deleted' flag and hiding it in CSS is not deletion. The
tombstone stays in the list so a thread does not develop holes.

Only the author may delete; mutation-tested.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Comments on the clip page, live

The repo's first server actions, plus the `comment.added` announcement.

**Files:**
- Create: `src/lib/events/social.ts`
- Create: `src/lib/events/social.test.ts`
- Create: `src/app/clips/[id]/actions.ts`
- Create: `src/components/comment-form.tsx`
- Create: `src/components/comment-list.tsx`
- Modify: `src/app/clips/[id]/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `addComment`, `listComments`, `softDeleteComment`, `CommentRow` from Task 5; `publish` from `src/lib/realtime/publish.ts`; `requireUser` from `src/lib/session.ts`.
- Produces:
  - `announceComment(comment: CommentRow, env?): Promise<void>`
  - Server actions `postComment(clipId: string, formData: FormData): Promise<void>` and `removeComment(clipId: string, commentId: string): Promise<void>`
  - `<CommentList clipId initial me />`, `<CommentForm clipId />`

- [ ] **Step 1: Write the failing announce test**

Create `src/lib/events/social.test.ts`. Read `src/lib/events/clips.test.ts` first and follow its shape — it already has the pattern for asserting on a captured `publish`.

```ts
import { describe, expect, it } from "bun:test";
import { announceComment } from "@/lib/events/social";
import type { CommentRow } from "@/db/comments";

const comment: CommentRow = {
  id: "01C",
  clipId: "01A",
  user: "sam",
  body: "gg",
  at: 1_000,
  deleted: false,
};

describe("announceComment", () => {
  it("does nothing when realtime is not configured", async () => {
    // An env without REALTIME_URL is a deliberate choice by the caller, and
    // publish() already returns false rather than throwing.
    await expect(announceComment(comment, {})).resolves.toBeUndefined();
  });

  it("posts the comment to /emit", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await announceComment(comment, {
        REALTIME_URL: "http://realtime:3001",
        EMIT_SECRET: "s",
      });
    } finally {
      globalThis.fetch = original;
    }

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("http://realtime:3001/emit");
    expect(seen[0].body).toEqual({ t: "comment.added", comment });
  });

  it("does not throw when realtime is unreachable", async () => {
    // A comment that saved must not 500 because the socket service is down.
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    try {
      await expect(
        announceComment(comment, { REALTIME_URL: "http://down:3001", EMIT_SECRET: "s" }),
      ).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/events/social.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/lib/events/social.ts`:

```ts
import type { CommentRow } from "@/db/comments";
import { publish } from "@/lib/realtime/publish";

/**
 * Tells everyone about a new comment.
 *
 * `CommentRow` already matches `CommentSummary` on the wire, so there is
 * nothing to map. `publish` never throws — a comment that saved must not 500
 * because the socket service is down.
 */
export async function announceComment(
  comment: CommentRow,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<void> {
  await publish({ t: "comment.added", comment }, env);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/lib/events/social.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the server actions**

Create `src/app/clips/[id]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { addComment, softDeleteComment } from "@/db/comments";
import { getDb } from "@/db/client";
import { announceComment } from "@/lib/events/social";
import { normalizeChatText } from "@/lib/realtime/chat";
import { requireUser } from "@/lib/session";

/**
 * The first server actions in this repo.
 *
 * Every one of them calls `requireUser` itself. A server action is a public
 * HTTP endpoint with a generated name — the page having checked identity says
 * nothing about who is calling this.
 */
export async function postComment(clipId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  // The same validator the chat composer uses: trimmed, collapsed, capped.
  const body = normalizeChatText(formData.get("body"));

  if (body === null) {
    return;
  }

  const comment = addComment(getDb(), { clipId, userId: user.id, body });
  revalidatePath(`/clips/${clipId}`);
  await announceComment(comment);
}

export async function removeComment(clipId: string, commentId: string): Promise<void> {
  const user = await requireUser();
  // softDeleteComment refuses when the caller is not the author, so the
  // authorization lives in one place rather than here as well.
  softDeleteComment(getDb(), commentId, user.id);
  revalidatePath(`/clips/${clipId}`);
}
```

- [ ] **Step 6: Build the comment UI**

Create `src/components/comment-form.tsx`:

```tsx
"use client";

import { useRef } from "react";
import { postComment } from "@/app/clips/[id]/actions";
import { MAX_CHAT_LENGTH } from "@/lib/realtime/chat";

export function CommentForm({ clipId }: { clipId: string }) {
  const formRef = useRef<HTMLFormElement | null>(null);

  return (
    <form
      ref={formRef}
      className="comment-form"
      action={async (formData) => {
        // Clear optimistically: the comment arrives back over the socket, so
        // leaving the text sitting there makes it look like it failed.
        formRef.current?.reset();
        await postComment(clipId, formData);
      }}
    >
      <input
        name="body"
        className="title-input"
        maxLength={MAX_CHAT_LENGTH}
        placeholder="Add a comment"
        aria-label="Comment"
      />
      <button type="submit" className="button-secondary">
        Post
      </button>
    </form>
  );
}
```

Create `src/components/comment-list.tsx`:

```tsx
"use client";

import { useState } from "react";
import { removeComment } from "@/app/clips/[id]/actions";
import type { CommentRow } from "@/db/comments";
import { useRealtime } from "@/lib/realtime/use-realtime";

/**
 * Server-rendered comments with live ones merged on top.
 *
 * `comment.added` rides the `grid` topic because topics are a fixed enum, so
 * this filters by clipId. For a handful of friends that is cheaper than
 * parameterised subscriptions.
 */
export function CommentList({
  clipId,
  initial,
  me,
}: {
  clipId: string;
  initial: CommentRow[];
  me: string;
}) {
  const [comments, setComments] = useState<CommentRow[]>(initial);

  useRealtime(["grid"], (message) => {
    if (message.t !== "comment.added" || message.comment.clipId !== clipId) {
      return;
    }

    setComments((current) =>
      current.some((existing) => existing.id === message.comment.id)
        ? current
        : [...current, message.comment as CommentRow],
    );
  });

  if (comments.length === 0) {
    return <p className="text-sm text-ink-muted">No comments yet.</p>;
  }

  return (
    <ol className="comment-list">
      {comments.map((comment) => (
        <li key={comment.id} className="comment">
          <p className="text-xs text-ink-muted">{comment.user}</p>
          <p className={comment.deleted ? "text-sm text-ink-muted italic" : "text-sm text-ink"}>
            {comment.body}
          </p>
          {!comment.deleted && comment.user === me && (
            <button
              type="button"
              className="comment-delete"
              onClick={() => {
                setComments((current) =>
                  current.map((existing) =>
                    existing.id === comment.id
                      ? { ...existing, body: "[deleted]", deleted: true }
                      : existing,
                  ),
                );
                void removeComment(clipId, comment.id);
              }}
            >
              delete
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 7: Put them on the clip page**

In `src/app/clips/[id]/page.tsx`, add the imports:

```ts
import { CommentForm } from "@/components/comment-form";
import { CommentList } from "@/components/comment-list";
import { listComments } from "@/db/comments";
```

Change `await requireUser();` to capture the user:

```ts
  const user = await requireUser();
```

Load the comments beside the clip:

```ts
  const initialComments = listComments(getDb(), id);
```

And render them after the player:

```tsx
      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-ink">Comments</h2>
        <CommentForm clipId={clip.id} />
        <div className="mt-4">
          <CommentList
            clipId={clip.id}
            initial={initialComments}
            me={user.authentikUsername}
          />
        </div>
      </section>
```

- [ ] **Step 8: Style it**

Append to `src/app/globals.css`:

```css
.comment-form { display: flex; gap: 8px; }
.comment-form .title-input { min-width: 0; }
.comment-list { display: flex; flex-direction: column; gap: 12px; margin: 0; padding: 0; list-style: none; }
.comment { position: relative; border-left: 2px solid #303b48; padding-left: 12px; }
.comment-delete {
  position: absolute; top: 0; right: 0;
  background: transparent; color: #9aa4b2; font-size: 11px; cursor: pointer;
}
.comment-delete:hover { color: #e6e9ee; }
```

- [ ] **Step 9: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 10: Verify a comment round-trips**

With the dev stack up, post a comment on a ready clip and confirm: the page shows it, and a socket subscribed to `grid` receives `comment.added`. A `bun` script can do the second half — connect, `sub` to `grid`, then POST the server action or add a comment directly and watch the frame arrive.

Then stop `realtime` and post another comment. The page must still work and the comment must still save; only the live update is lost.

- [ ] **Step 11: Commit**

```bash
git add src/lib/events/social.ts src/lib/events/social.test.ts \
  src/app/clips/[id]/actions.ts src/app/clips/[id]/page.tsx \
  src/components/comment-form.tsx src/components/comment-list.tsx src/app/globals.css
git commit -m "feat: add live comments to the clip page

The repo's first server actions. Each one calls requireUser itself: a
server action is a public HTTP endpoint with a generated name, and the page
having checked identity says nothing about who is calling it.

Comments reuse the chat validator, and announcing one needs no mapping
because CommentRow already matches the wire shape.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Tag, game and participant queries

**Files:**
- Create: `src/db/metadata.ts`
- Create: `src/db/metadata.test.ts`

**Interfaces:**
- Consumes: `Db`, `tags`, `clipTags`, `games`, `clipParticipants`, `users` from the schema; `ulid`.
- Produces:
  - `type ClipMetadata = { tags: string[]; game: { id: string; name: string; slug: string } | null; participants: string[] }`
  - `getClipMetadata(db, clipId: string): ClipMetadata`
  - `setClipTags(db, clipId: string, names: string[]): string[]`
  - `setClipGame(db, clipId: string, name: string | null): string | null`
  - `setClipParticipants(db, clipId: string, usernames: string[]): string[]`
  - `listTags(db): string[]`, `listGames(db): { id: string; name: string; slug: string }[]`
  - `slugify(name: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/db/metadata.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import {
  getClipMetadata,
  listGames,
  listTags,
  setClipGame,
  setClipParticipants,
  setClipTags,
  slugify,
} from "@/db/metadata";
import { upsertUser } from "@/db/users";

let db: Db;
let samId: string;
let clipId: string;

beforeEach(() => {
  db = createDb(":memory:");
  samId = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
  upsertUser(db, { username: "dave", email: null, displayName: null });
  clipId = createClip(db, {
    id: "01TESTCLIP",
    title: "ace",
    originalFilename: "ace.mp4",
    uploaderId: samId,
  }).id;
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Counter Strike 2")).toBe("counter-strike-2");
  });

  it("collapses punctuation and trims the edges", () => {
    expect(slugify("  Tom's Game!!  ")).toBe("tom-s-game");
  });
});

describe("getClipMetadata", () => {
  it("is empty for a fresh clip", () => {
    expect(getClipMetadata(db, clipId)).toEqual({ tags: [], game: null, participants: [] });
  });
});

describe("setClipTags", () => {
  it("attaches tags and reads them back sorted", () => {
    setClipTags(db, clipId, ["clutch", "ace"]);
    expect(getClipMetadata(db, clipId).tags).toEqual(["ace", "clutch"]);
  });

  it("reuses an existing tag row rather than duplicating it", () => {
    const other = createClip(db, {
      id: "01OTHER",
      title: "other",
      originalFilename: "o.mp4",
      uploaderId: samId,
    }).id;
    setClipTags(db, clipId, ["ace"]);
    setClipTags(db, other, ["ace"]);

    expect(listTags(db)).toEqual(["ace"]);
  });

  it("replaces the whole set rather than adding to it", () => {
    setClipTags(db, clipId, ["ace", "clutch"]);
    setClipTags(db, clipId, ["fail"]);

    expect(getClipMetadata(db, clipId).tags).toEqual(["fail"]);
  });

  it("normalises case and whitespace so 'Ace' and 'ace' are one tag", () => {
    setClipTags(db, clipId, ["  Ace  ", "ace", "ACE"]);

    expect(getClipMetadata(db, clipId).tags).toEqual(["ace"]);
    expect(listTags(db)).toEqual(["ace"]);
  });

  it("drops empty entries", () => {
    setClipTags(db, clipId, ["ace", "", "   "]);
    expect(getClipMetadata(db, clipId).tags).toEqual(["ace"]);
  });

  it("clears every tag when given an empty list", () => {
    setClipTags(db, clipId, ["ace"]);
    setClipTags(db, clipId, []);

    expect(getClipMetadata(db, clipId).tags).toEqual([]);
  });
});

describe("setClipGame", () => {
  it("creates the game and attaches it", () => {
    setClipGame(db, clipId, "Valorant");

    expect(getClipMetadata(db, clipId).game).toMatchObject({ name: "Valorant", slug: "valorant" });
  });

  it("reuses an existing game by slug, keeping the original name", () => {
    setClipGame(db, clipId, "Valorant");
    const other = createClip(db, {
      id: "01OTHER",
      title: "other",
      originalFilename: "o.mp4",
      uploaderId: samId,
    }).id;
    setClipGame(db, other, "valorant");

    expect(listGames(db)).toHaveLength(1);
    expect(getClipMetadata(db, other).game?.name).toBe("Valorant");
  });

  it("clears the game when given null", () => {
    setClipGame(db, clipId, "Valorant");
    setClipGame(db, clipId, null);

    expect(getClipMetadata(db, clipId).game).toBeNull();
  });
});

describe("setClipParticipants", () => {
  it("attaches known users and reads them back sorted", () => {
    setClipParticipants(db, clipId, ["dave", "sam"]);
    expect(getClipMetadata(db, clipId).participants).toEqual(["dave", "sam"]);
  });

  it("silently ignores a username that is not a user here", () => {
    // Users only exist after their first login. Inventing a row for a
    // mistyped name would put a ghost in the participant filter forever.
    setClipParticipants(db, clipId, ["sam", "nobody"]);

    expect(getClipMetadata(db, clipId).participants).toEqual(["sam"]);
  });

  it("replaces the whole set", () => {
    setClipParticipants(db, clipId, ["sam", "dave"]);
    setClipParticipants(db, clipId, ["dave"]);

    expect(getClipMetadata(db, clipId).participants).toEqual(["dave"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/db/metadata.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/db/metadata.ts`:

```ts
import { asc, eq, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { clipParticipants, clips, clipTags, games, tags, users } from "./schema";

export type ClipMetadata = {
  tags: string[];
  game: { id: string; name: string; slug: string } | null;
  participants: string[];
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Tags are case-insensitive: "Ace", "ace" and "ACE" are one tag. */
function normalizeTag(name: string): string {
  return name.trim().toLowerCase();
}

export function listTags(db: Db): string[] {
  return db
    .select({ name: tags.name })
    .from(tags)
    .orderBy(asc(tags.name))
    .all()
    .map((row) => row.name);
}

export function listGames(db: Db): { id: string; name: string; slug: string }[] {
  return db.select().from(games).orderBy(asc(games.name)).all();
}

export function getClipMetadata(db: Db, clipId: string): ClipMetadata {
  const tagRows = db
    .select({ name: tags.name })
    .from(clipTags)
    .innerJoin(tags, eq(clipTags.tagId, tags.id))
    .where(eq(clipTags.clipId, clipId))
    .orderBy(asc(tags.name))
    .all();

  const participantRows = db
    .select({ name: users.authentikUsername })
    .from(clipParticipants)
    .innerJoin(users, eq(clipParticipants.userId, users.id))
    .where(eq(clipParticipants.clipId, clipId))
    .orderBy(asc(users.authentikUsername))
    .all();

  const game =
    db
      .select({ id: games.id, name: games.name, slug: games.slug })
      .from(clips)
      .innerJoin(games, eq(clips.gameId, games.id))
      .where(eq(clips.id, clipId))
      .get() ?? null;

  return {
    tags: tagRows.map((row) => row.name),
    game,
    participants: participantRows.map((row) => row.name),
  };
}

/** Replaces the clip's whole tag set. Returns what it settled on. */
export function setClipTags(db: Db, clipId: string, names: string[]): string[] {
  const wanted = [...new Set(names.map(normalizeTag).filter((name) => name.length > 0))].sort();

  db.delete(clipTags).where(eq(clipTags.clipId, clipId)).run();

  for (const name of wanted) {
    // Reuse the tag row if it exists: `tags.name` is unique, and inserting a
    // duplicate would throw rather than dedupe.
    const existing = db.select({ id: tags.id }).from(tags).where(eq(tags.name, name)).get();
    const id = existing?.id ?? ulid();

    if (!existing) {
      db.insert(tags).values({ id, name }).run();
    }

    db.insert(clipTags).values({ clipId, tagId: id }).run();
  }

  return wanted;
}

/** Sets or clears the clip's game. Returns the game's name, or null. */
export function setClipGame(db: Db, clipId: string, name: string | null): string | null {
  const trimmed = name?.trim() ?? "";

  if (trimmed.length === 0) {
    db.update(clips).set({ gameId: null }).where(eq(clips.id, clipId)).run();
    return null;
  }

  const slug = slugify(trimmed);
  const existing = db.select().from(games).where(eq(games.slug, slug)).get();
  const id = existing?.id ?? ulid();

  if (!existing) {
    db.insert(games).values({ id, name: trimmed, slug }).run();
  }

  db.update(clips).set({ gameId: id }).where(eq(clips.id, clipId)).run();

  // The first spelling wins, so "Valorant" does not become "valorant" because
  // someone typed it in lowercase later.
  return existing?.name ?? trimmed;
}

/** Replaces the clip's whole participant set. Returns the usernames it kept. */
export function setClipParticipants(db: Db, clipId: string, usernames: string[]): string[] {
  const wanted = [...new Set(usernames.map((name) => name.trim()).filter(Boolean))];

  db.delete(clipParticipants).where(eq(clipParticipants.clipId, clipId)).run();

  if (wanted.length === 0) {
    return [];
  }

  // Users only exist after their first login. A mistyped name must not create
  // a ghost row that then haunts the participant filter forever.
  const known = db
    .select({ id: users.id, name: users.authentikUsername })
    .from(users)
    .where(inArray(users.authentikUsername, wanted))
    .all();

  for (const user of known) {
    db.insert(clipParticipants).values({ clipId, userId: user.id }).run();
  }

  return known.map((user) => user.name).sort();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/db/metadata.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/metadata.ts src/db/metadata.test.ts
git commit -m "feat: add tag, game and participant queries

Tags are case-insensitive and games are keyed by slug, so 'Ace'/'ace' and
'Valorant'/'valorant' do not each become two rows. The first spelling of a
game wins.

An unknown participant username is dropped rather than created. Users only
exist after their first login, and inventing a row for a typo would put a
ghost in the participant filter forever.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Filters as pure URL state

`/?tag=ace&game=valorant` must be linkable and survive reload, so the parsing is pure and tested on its own before any query touches it.

**Files:**
- Create: `src/lib/filters.ts`
- Create: `src/lib/filters.test.ts`

**Interfaces:**
- Produces:
  - `type ClipFilters = { tag?: string; game?: string; uploader?: string; participant?: string }`
  - `parseFilters(params: Record<string, string | string[] | undefined>): ClipFilters`
  - `filtersToQuery(filters: ClipFilters): string`
  - `withFilter(filters: ClipFilters, key: keyof ClipFilters, value: string): string`
  - `withoutFilter(filters: ClipFilters, key: keyof ClipFilters): string`
  - `activeFilters(filters: ClipFilters): { key: keyof ClipFilters; value: string }[]`

- [ ] **Step 1: Write the failing test**

Create `src/lib/filters.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  activeFilters,
  filtersToQuery,
  parseFilters,
  withFilter,
  withoutFilter,
} from "@/lib/filters";

describe("parseFilters", () => {
  it("is empty for no params", () => {
    expect(parseFilters({})).toEqual({});
  });

  it("reads the four filterable fields", () => {
    expect(
      parseFilters({ tag: "ace", game: "valorant", uploader: "sam", participant: "dave" }),
    ).toEqual({ tag: "ace", game: "valorant", uploader: "sam", participant: "dave" });
  });

  it("ignores params it does not know", () => {
    expect(parseFilters({ tag: "ace", nonsense: "x" })).toEqual({ tag: "ace" });
  });

  it("takes the first value when a param is repeated", () => {
    // Next hands back an array for ?tag=a&tag=b. One filter per field keeps
    // both the query and the chips simple.
    expect(parseFilters({ tag: ["ace", "clutch"] })).toEqual({ tag: "ace" });
  });

  it("drops an empty value rather than filtering on nothing", () => {
    expect(parseFilters({ tag: "", game: "  " })).toEqual({});
  });
});

describe("filtersToQuery", () => {
  it("is empty for no filters", () => {
    expect(filtersToQuery({})).toBe("/");
  });

  it("renders a linkable query in a stable order", () => {
    // Stable order means the same filter set is always the same URL, which is
    // what makes it cacheable and comparable.
    expect(filtersToQuery({ game: "valorant", tag: "ace" })).toBe("/?tag=ace&game=valorant");
  });

  it("encodes values", () => {
    expect(filtersToQuery({ game: "counter strike" })).toBe("/?game=counter+strike");
  });
});

describe("withFilter", () => {
  it("adds to what is already there", () => {
    expect(withFilter({ tag: "ace" }, "game", "valorant")).toBe("/?tag=ace&game=valorant");
  });

  it("replaces a field rather than accumulating", () => {
    expect(withFilter({ tag: "ace" }, "tag", "clutch")).toBe("/?tag=clutch");
  });
});

describe("withoutFilter", () => {
  it("removes one and keeps the rest", () => {
    expect(withoutFilter({ tag: "ace", game: "valorant" }, "tag")).toBe("/?game=valorant");
  });

  it("goes back to the bare grid when the last one goes", () => {
    expect(withoutFilter({ tag: "ace" }, "tag")).toBe("/");
  });
});

describe("activeFilters", () => {
  it("lists what is set, in the display order", () => {
    expect(activeFilters({ game: "valorant", tag: "ace" })).toEqual([
      { key: "tag", value: "ace" },
      { key: "game", value: "valorant" },
    ]);
  });

  it("is empty when nothing is set", () => {
    expect(activeFilters({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/filters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

Create `src/lib/filters.ts`:

```ts
export type ClipFilters = {
  tag?: string;
  game?: string;
  uploader?: string;
  participant?: string;
};

/**
 * The filterable fields, in the order chips render.
 *
 * One list drives parsing, serialising and display, so a new filter is one
 * entry here plus a query clause.
 */
const KEYS = ["tag", "game", "uploader", "participant"] as const;

function first(value: string | string[] | undefined): string | undefined {
  // Next hands back an array for a repeated param. One filter per field keeps
  // both the query and the chips simple.
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): ClipFilters {
  const filters: ClipFilters = {};

  for (const key of KEYS) {
    const value = first(params[key]);

    if (value !== undefined) {
      filters[key] = value;
    }
  }

  return filters;
}

/** A linkable URL. Stable key order, so one filter set is always one URL. */
export function filtersToQuery(filters: ClipFilters): string {
  const query = new URLSearchParams();

  for (const key of KEYS) {
    const value = filters[key];

    if (value !== undefined) {
      query.set(key, value);
    }
  }

  const rendered = query.toString();
  return rendered.length === 0 ? "/" : `/?${rendered}`;
}

export function withFilter(
  filters: ClipFilters,
  key: keyof ClipFilters,
  value: string,
): string {
  return filtersToQuery({ ...filters, [key]: value });
}

export function withoutFilter(filters: ClipFilters, key: keyof ClipFilters): string {
  const next = { ...filters };
  delete next[key];
  return filtersToQuery(next);
}

export function activeFilters(
  filters: ClipFilters,
): { key: keyof ClipFilters; value: string }[] {
  return KEYS.filter((key) => filters[key] !== undefined).map((key) => ({
    key,
    value: filters[key] as string,
  }));
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bun test src/lib/filters.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/filters.ts src/lib/filters.test.ts
git commit -m "feat: add filters as pure URL state

One KEYS list drives parsing, serialising and chip display, so adding a
filter later is one entry plus a query clause. Stable key order means a
filter set is always the same URL.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The filtered clip query and disk usage

**Files:**
- Modify: `src/db/clips.ts`
- Modify: `src/db/clips.test.ts`
- Modify: `src/lib/format.ts`
- Modify: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: `ClipFilters` from Task 8.
- Produces:
  - `listClips(db: Db, filters?: ClipFilters, limit?: number): Clip[]`
  - `totalDiskBytes(db: Db): number`
  - `formatBytes(bytes: number): string`

- [ ] **Step 1: Write the failing tests**

Append to `src/db/clips.test.ts`, following the setup already in that file:

```ts
describe("listClips", () => {
  it("returns everything, newest first, when unfiltered", () => {
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    createClip(db, { id: "01A", title: "older", originalFilename: "a.mp4", uploaderId: sam });
    createClip(db, { id: "01B", title: "newer", originalFilename: "b.mp4", uploaderId: sam });

    expect(listClips(db).map((c) => c.id)).toEqual(["01B", "01A"]);
  });

  it("filters by tag", () => {
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    createClip(db, { id: "01A", title: "a", originalFilename: "a.mp4", uploaderId: sam });
    createClip(db, { id: "01B", title: "b", originalFilename: "b.mp4", uploaderId: sam });
    setClipTags(db, "01A", ["ace"]);

    expect(listClips(db, { tag: "ace" }).map((c) => c.id)).toEqual(["01A"]);
  });

  it("filters by game slug", () => {
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    createClip(db, { id: "01A", title: "a", originalFilename: "a.mp4", uploaderId: sam });
    createClip(db, { id: "01B", title: "b", originalFilename: "b.mp4", uploaderId: sam });
    setClipGame(db, "01A", "Valorant");

    expect(listClips(db, { game: "valorant" }).map((c) => c.id)).toEqual(["01A"]);
  });

  it("filters by uploader username", () => {
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    const dave = upsertUser(db, { username: "dave", email: null, displayName: null }).id;
    createClip(db, { id: "01A", title: "a", originalFilename: "a.mp4", uploaderId: sam });
    createClip(db, { id: "01B", title: "b", originalFilename: "b.mp4", uploaderId: dave });

    expect(listClips(db, { uploader: "dave" }).map((c) => c.id)).toEqual(["01B"]);
  });

  it("filters by participant", () => {
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    upsertUser(db, { username: "dave", email: null, displayName: null });
    createClip(db, { id: "01A", title: "a", originalFilename: "a.mp4", uploaderId: sam });
    createClip(db, { id: "01B", title: "b", originalFilename: "b.mp4", uploaderId: sam });
    setClipParticipants(db, "01A", ["dave"]);

    expect(listClips(db, { participant: "dave" }).map((c) => c.id)).toEqual(["01A"]);
  });

  it("ANDs filters together rather than ORing them", () => {
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    const dave = upsertUser(db, { username: "dave", email: null, displayName: null }).id;
    createClip(db, { id: "01A", title: "a", originalFilename: "a.mp4", uploaderId: sam });
    createClip(db, { id: "01B", title: "b", originalFilename: "b.mp4", uploaderId: dave });
    setClipTags(db, "01A", ["ace"]);
    setClipTags(db, "01B", ["ace"]);

    expect(listClips(db, { tag: "ace", uploader: "dave" }).map((c) => c.id)).toEqual(["01B"]);
  });

  it("returns nothing for a filter that matches nothing", () => {
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    createClip(db, { id: "01A", title: "a", originalFilename: "a.mp4", uploaderId: sam });

    expect(listClips(db, { tag: "nonexistent" })).toEqual([]);
  });

  it("does not return a clip twice when it has several tags", () => {
    // A join against clip_tags multiplies rows. Without a distinct the grid
    // renders the same card twice.
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    createClip(db, { id: "01A", title: "a", originalFilename: "a.mp4", uploaderId: sam });
    setClipTags(db, "01A", ["ace", "clutch", "funny"]);

    expect(listClips(db, { tag: "ace" })).toHaveLength(1);
  });
});

describe("totalDiskBytes", () => {
  it("is zero with no clips", () => {
    expect(totalDiskBytes(createDb(":memory:"))).toBe(0);
  });

  it("sums what the pipeline recorded", () => {
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    createClip(db, { id: "01A", title: "a", originalFilename: "a.mp4", uploaderId: sam });
    createClip(db, { id: "01B", title: "b", originalFilename: "b.mp4", uploaderId: sam });
    db.update(clips).set({ sizeBytes: 1_000 }).where(eq(clips.id, "01A")).run();
    db.update(clips).set({ sizeBytes: 2_500 }).where(eq(clips.id, "01B")).run();

    expect(totalDiskBytes(db)).toBe(3_500);
  });

  it("ignores clips whose size is not known yet", () => {
    const db = createDb(":memory:");
    const sam = upsertUser(db, { username: "sam", email: null, displayName: null }).id;
    createClip(db, { id: "01A", title: "a", originalFilename: "a.mp4", uploaderId: sam });
    db.update(clips).set({ sizeBytes: 1_000 }).where(eq(clips.id, "01A")).run();
    createClip(db, { id: "01B", title: "b", originalFilename: "b.mp4", uploaderId: sam });

    expect(totalDiskBytes(db)).toBe(1_000);
  });
});
```

Add whatever imports these need to the top of the file: `listClips`, `totalDiskBytes`, `setClipTags`, `setClipGame`, `setClipParticipants`, `upsertUser`, `clips`, and `eq` from `drizzle-orm`.

And append to `src/lib/format.test.ts`:

```ts
describe("formatBytes", () => {
  it("shows bytes below a kilobyte", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("steps up through the units", () => {
    expect(formatBytes(1_024)).toBe("1.0 KB");
    expect(formatBytes(1_048_576)).toBe("1.0 MB");
    expect(formatBytes(1_073_741_824)).toBe("1.0 GB");
  });

  it("keeps one decimal place where it is informative", () => {
    expect(formatBytes(1_610_612_736)).toBe("1.5 GB");
  });

  it("handles zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bun test src/db/clips.test.ts src/lib/format.test.ts`
Expected: FAIL — `listClips`, `totalDiskBytes` and `formatBytes` do not exist.

- [ ] **Step 3: Implement the query**

In `src/db/clips.ts`, add the imports it needs (`and`, `eq`, `inArray`, `sql` from `drizzle-orm`; `clipParticipants`, `clipTags`, `games`, `tags`, `users` from `./schema`; `ClipFilters` from `@/lib/filters`) and append:

```ts
/**
 * The grid's query. Filters AND together, newest first.
 *
 * Each filter is expressed as a subquery on the clip id rather than a join,
 * because joining against `clip_tags` multiplies rows and would render the
 * same card once per tag.
 */
export function listClips(db: Db, filters: ClipFilters = {}, limit = 100): Clip[] {
  const conditions = [];

  if (filters.tag) {
    conditions.push(
      inArray(
        clips.id,
        db
          .select({ id: clipTags.clipId })
          .from(clipTags)
          .innerJoin(tags, eq(clipTags.tagId, tags.id))
          .where(eq(tags.name, filters.tag.toLowerCase())),
      ),
    );
  }

  if (filters.game) {
    conditions.push(
      inArray(
        clips.gameId,
        db.select({ id: games.id }).from(games).where(eq(games.slug, filters.game)),
      ),
    );
  }

  if (filters.uploader) {
    conditions.push(
      inArray(
        clips.uploaderId,
        db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.authentikUsername, filters.uploader)),
      ),
    );
  }

  if (filters.participant) {
    conditions.push(
      inArray(
        clips.id,
        db
          .select({ id: clipParticipants.clipId })
          .from(clipParticipants)
          .innerJoin(users, eq(clipParticipants.userId, users.id))
          .where(eq(users.authentikUsername, filters.participant)),
      ),
    );
  }

  const query = db.select().from(clips);
  const filtered = conditions.length > 0 ? query.where(and(...conditions)) : query;

  return filtered.orderBy(desc(clips.createdAt)).limit(limit).all();
}

/**
 * Total bytes the library occupies, as recorded by the pipeline.
 *
 * Surfaced in the UI because it is useful to know; there are no quotas. A
 * clip whose probe has not run yet has no size and contributes nothing.
 */
export function totalDiskBytes(db: Db): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${clips.sizeBytes}), 0)` })
    .from(clips)
    .get();

  return row?.total ?? 0;
}
```

- [ ] **Step 4: Implement `formatBytes`**

Append to `src/lib/format.ts`:

```ts
const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Whole bytes read oddly with a decimal; everything above benefits from one.
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `bun test src/db/clips.test.ts src/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 6: Mutation-test the AND**

```bash
sed -i 's/and(\.\.\.conditions)/conditions[0]!/' src/db/clips.ts
bun test src/db/clips.test.ts
```

Expected: FAIL on "ANDs filters together rather than ORing them". Restore the `and(...conditions)` and re-run to confirm green.

- [ ] **Step 7: Commit**

```bash
git add src/db/clips.ts src/db/clips.test.ts src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: add the filtered clip query and disk usage

Each filter is a subquery on the clip id, not a join. Joining against
clip_tags multiplies rows, and the grid would render the same card once per
tag — there is a test for exactly that.

Filters AND together; mutation-tested.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Metadata on the clip page

Tags, game and participants — editable, and clickable straight through to a filtered grid.

**Files:**
- Create: `src/components/clip-metadata.tsx`
- Modify: `src/app/clips/[id]/actions.ts`
- Modify: `src/app/clips/[id]/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `getClipMetadata`, `setClipTags`, `setClipGame`, `setClipParticipants`, `ClipMetadata` from Task 7; `withFilter` from Task 8.
- Produces: server actions `saveTags`, `saveGame`, `saveParticipants`; `<ClipMetadataPanel clipId metadata knownUsers />`

- [ ] **Step 1: Add the server actions**

Append to `src/app/clips/[id]/actions.ts`:

```ts
import { setClipGame, setClipParticipants, setClipTags } from "@/db/metadata";

/**
 * Metadata is communal: anyone signed in may retag any clip.
 *
 * This is a private site for a fixed group of friends. Per-clip ownership
 * checks would cost more in friction than they could possibly prevent — but
 * `requireUser` still runs, because a server action is a public endpoint.
 */
export async function saveTags(clipId: string, formData: FormData): Promise<void> {
  await requireUser();
  const raw = String(formData.get("tags") ?? "");
  setClipTags(getDb(), clipId, raw.split(","));
  revalidatePath(`/clips/${clipId}`);
  revalidatePath("/");
}

export async function saveGame(clipId: string, formData: FormData): Promise<void> {
  await requireUser();
  const raw = String(formData.get("game") ?? "").trim();
  setClipGame(getDb(), clipId, raw.length === 0 ? null : raw);
  revalidatePath(`/clips/${clipId}`);
  revalidatePath("/");
}

export async function saveParticipants(clipId: string, formData: FormData): Promise<void> {
  await requireUser();
  const raw = String(formData.get("participants") ?? "");
  setClipParticipants(getDb(), clipId, raw.split(","));
  revalidatePath(`/clips/${clipId}`);
  revalidatePath("/");
}
```

Both `revalidatePath` calls matter: the clip page shows the metadata and the grid filters on it.

- [ ] **Step 2: Build the panel**

Create `src/components/clip-metadata.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { saveGame, saveParticipants, saveTags } from "@/app/clips/[id]/actions";
import type { ClipMetadata } from "@/db/metadata";
import { withFilter } from "@/lib/filters";

/**
 * Metadata that is both a filter affordance and an edit surface.
 *
 * Filtering is by clicking metadata, not by a filter bar: it costs almost no
 * UI, is discoverable without explanation, and extends to any field added
 * later for free.
 */
export function ClipMetadataPanel({
  clipId,
  metadata,
  knownUsers,
}: {
  clipId: string;
  metadata: ClipMetadata;
  knownUsers: string[];
}) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div className="metadata-panel">
        <form
          className="metadata-form"
          action={async (formData) => {
            await saveTags(clipId, formData);
          }}
        >
          <label className="metadata-label" htmlFor="tags">
            Tags, comma separated
          </label>
          <div className="metadata-row">
            <input
              id="tags"
              name="tags"
              className="title-input"
              defaultValue={metadata.tags.join(", ")}
              placeholder="ace, clutch"
            />
            <button type="submit" className="button-secondary">
              Save
            </button>
          </div>
        </form>

        <form
          className="metadata-form"
          action={async (formData) => {
            await saveGame(clipId, formData);
          }}
        >
          <label className="metadata-label" htmlFor="game">
            Game
          </label>
          <div className="metadata-row">
            <input
              id="game"
              name="game"
              className="title-input"
              defaultValue={metadata.game?.name ?? ""}
              placeholder="Valorant"
            />
            <button type="submit" className="button-secondary">
              Save
            </button>
          </div>
        </form>

        <form
          className="metadata-form"
          action={async (formData) => {
            await saveParticipants(clipId, formData);
          }}
        >
          <label className="metadata-label" htmlFor="participants">
            Who is in it — {knownUsers.join(", ")}
          </label>
          <div className="metadata-row">
            <input
              id="participants"
              name="participants"
              className="title-input"
              defaultValue={metadata.participants.join(", ")}
              placeholder="sam, dave"
            />
            <button type="submit" className="button-secondary">
              Save
            </button>
          </div>
        </form>

        <button type="button" className="chip-button" onClick={() => setEditing(false)}>
          Done
        </button>
      </div>
    );
  }

  const nothingSet =
    metadata.tags.length === 0 && metadata.game === null && metadata.participants.length === 0;

  return (
    <div className="metadata-panel">
      <div className="metadata-chips">
        {metadata.game && (
          <Link className="chip-button" href={withFilter({}, "game", metadata.game.slug)}>
            {metadata.game.name}
          </Link>
        )}
        {metadata.tags.map((tag) => (
          <Link key={tag} className="chip-button" href={withFilter({}, "tag", tag)}>
            #{tag}
          </Link>
        ))}
        {metadata.participants.map((user) => (
          <Link key={user} className="chip-button" href={withFilter({}, "participant", user)}>
            {user}
          </Link>
        ))}
        {nothingSet && <span className="text-sm text-ink-muted">No tags yet.</span>}
        <button type="button" className="chip-button" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Put it on the clip page**

In `src/app/clips/[id]/page.tsx`, add the imports:

```ts
import { ClipMetadataPanel } from "@/components/clip-metadata";
import { getClipMetadata } from "@/db/metadata";
import { listUsernames } from "@/db/users";
```

Load the data beside the comments:

```ts
  const metadata = getClipMetadata(getDb(), id);
  const knownUsers = listUsernames(getDb());
```

And render it between the player and the comments:

```tsx
      <div className="mt-4">
        <ClipMetadataPanel clipId={clip.id} metadata={metadata} knownUsers={knownUsers} />
      </div>
```

`listUsernames` does not exist yet. Add it to `src/db/users.ts`:

```ts
/** Every username known here, for the participant picker's hint. */
export function listUsernames(db: Db): string[] {
  return db
    .select({ name: users.authentikUsername })
    .from(users)
    .orderBy(asc(users.authentikUsername))
    .all()
    .map((row) => row.name);
}
```

with `asc` added to the `drizzle-orm` import in that file.

- [ ] **Step 4: Style it**

Append to `src/app/globals.css`:

```css
.metadata-panel { display: flex; flex-direction: column; gap: 12px; }
.metadata-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.metadata-form { display: flex; flex-direction: column; gap: 4px; }
.metadata-label { font-size: 12px; color: #9aa4b2; }
.metadata-row { display: flex; gap: 8px; }
.metadata-row .title-input { min-width: 0; }
```

- [ ] **Step 5: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 6: Verify it round-trips**

With the dev stack up, open a ready clip, click **Edit**, set tags and a game, save, and confirm the chips render and link to `/?tag=…`. Then confirm the filtered grid actually narrows.

- [ ] **Step 7: Commit**

```bash
git add src/components/clip-metadata.tsx src/app/clips/[id]/actions.ts \
  src/app/clips/[id]/page.tsx src/db/users.ts src/app/globals.css
git commit -m "feat: add editable, clickable clip metadata

Filtering is by clicking metadata rather than by a filter bar: almost no
UI, discoverable without explanation, and it extends to any field added
later for free.

Metadata is communal — anyone signed in may retag any clip. This is a
private site for a fixed group of friends, and per-clip ownership checks
would cost more in friction than they could prevent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The filtered grid, chips and disk usage

**Files:**
- Create: `src/components/filter-chips.tsx`
- Create: `src/components/disk-usage.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/clip-card.tsx`
- Modify: `src/components/clip-grid.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `parseFilters`, `activeFilters`, `withoutFilter`, `withFilter`, `ClipFilters` from Task 8; `listClips`, `totalDiskBytes` from Task 9; `formatBytes`.
- Produces: `<FilterChips filters />`, `<DiskUsage bytes />`

- [ ] **Step 1: Build the chips**

Create `src/components/filter-chips.tsx`:

```tsx
import Link from "next/link";
import { activeFilters, withoutFilter, type ClipFilters } from "@/lib/filters";

const LABEL: Record<keyof ClipFilters, string> = {
  tag: "tag",
  game: "game",
  uploader: "from",
  participant: "with",
};

/** Active filters as removable chips above the grid. */
export function FilterChips({ filters }: { filters: ClipFilters }) {
  const active = activeFilters(filters);

  if (active.length === 0) {
    return null;
  }

  return (
    <div className="filter-chips">
      {active.map(({ key, value }) => (
        <Link key={key} className="filter-chip" href={withoutFilter(filters, key)}>
          <span className="text-ink-muted">{LABEL[key]}:</span> {value}
          <span aria-hidden="true"> ×</span>
          <span className="sr-only">Remove this filter</span>
        </Link>
      ))}
      <Link className="chip-button" href="/">
        Clear all
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Build the disk usage line**

Create `src/components/disk-usage.tsx`:

```tsx
import { formatBytes } from "@/lib/format";

/** Surfaced because it is useful to know. There are no quotas. */
export function DiskUsage({ bytes }: { bytes: number }) {
  return <p className="text-xs text-ink-muted">{formatBytes(bytes)} stored</p>;
}
```

- [ ] **Step 3: Wire the home page to searchParams**

Rewrite `src/app/page.tsx`:

```tsx
import Link from "next/link";
import { listClips, totalDiskBytes } from "@/db/clips";
import { getDb } from "@/db/client";
import { DiskUsage } from "@/components/disk-usage";
import { FilterChips } from "@/components/filter-chips";
import { LiveGrid } from "@/components/live-grid";
import { PresenceBar } from "@/components/presence-bar";
import { toSummary } from "@/lib/events/clips";
import { parseFilters } from "@/lib/filters";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const filters = parseFilters(await searchParams);
  const db = getDb();
  const clips = listClips(db, filters);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-1 text-sm text-ink-muted">One Room Gaming</p>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Clips</h1>
          <DiskUsage bytes={totalDiskBytes(db)} />
        </div>
        <Link href="/upload" className="button-primary sm:ml-auto">
          Upload clips
        </Link>
        <div className="text-right">
          <p className="text-sm text-ink-muted">{user.displayName ?? user.authentikUsername}</p>
          <PresenceBar me={user.authentikUsername} />
        </div>
      </div>

      <FilterChips filters={filters} />

      {clips.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Nothing matches those filters.{" "}
          <Link href="/" className="underline hover:text-ink">
            Clear them
          </Link>
          .
        </p>
      ) : (
        // A filtered grid must not merge live clips that do not match, so the
        // live merge is only enabled on the unfiltered view.
        <LiveGrid initial={clips.map(toSummary)} live={Object.keys(filters).length === 0} />
      )}
    </main>
  );
}
```

That `live` flag is load-bearing: without it, a new clip with no tags would pop into a grid filtered to `?tag=ace`.

- [ ] **Step 4: Teach `LiveGrid` to stand down**

In `src/components/live-grid.tsx`, add the prop and guard the merge:

```tsx
export function LiveGrid({ initial, live = true }: { initial: ClipSummary[]; live?: boolean }) {
  const [clips, setClips] = useState<ClipMap>(() =>
    Object.fromEntries(initial.map((clip) => [clip.id, clip])),
  );

  useRealtime(["grid"], (message) => {
    // On a filtered grid, merging a live clip would show one that does not
    // match the filter. Status updates for clips already shown are still
    // safe, so only additions are suppressed.
    if (!live && message.t === "clip.added") {
      return;
    }

    setClips((state) => mergeClip(state, message));
  });

  const ordered = useMemo(
    () => Object.values(clips).sort((a, b) => b.createdAt - a.createdAt),
    [clips],
  );

  return <ClipGrid clips={ordered} />;
}
```

- [ ] **Step 5: Make the card's metadata clickable**

`ClipCard` currently wraps the whole tile in a `Link` to the clip. A nested link is invalid HTML, so the uploader and game go **below** the tile, outside that link.

In `src/components/clip-card.tsx`, extend `ClipCardData`:

```ts
export type ClipCardData = {
  id: string;
  title: string;
  status: string;
  thumbPath: string | null;
  durationMs: number | null;
  uploader?: string | null;
  game?: { name: string; slug: string } | null;
};
```

and render a footer after the existing `Link`, changing the final return to:

```tsx
  return (
    <div>
      <Link href={`/clips/${clip.id}`}>{tile}</Link>
      {(clip.uploader || clip.game) && (
        <p className="mt-1 flex flex-wrap gap-2 text-xs text-ink-muted">
          {clip.uploader && (
            <Link className="hover:text-ink" href={withFilter({}, "uploader", clip.uploader)}>
              {clip.uploader}
            </Link>
          )}
          {clip.game && (
            <Link className="hover:text-ink" href={withFilter({}, "game", clip.game.slug)}>
              {clip.game.name}
            </Link>
          )}
        </p>
      )}
    </div>
  );
```

with `import { withFilter } from "@/lib/filters";` added.

`uploader` and `game` are optional, so `ClipSummary` off the wire still satisfies the type and the live path is unchanged. Populating them on the server-rendered path is a follow-up, not this task — say so rather than half-doing it.

- [ ] **Step 6: Style it**

Append to `src/app/globals.css`:

```css
.filter-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
.filter-chip {
  display: inline-flex; align-items: center; gap: 4px;
  min-height: 32px; padding: 4px 10px; border-radius: 999px;
  background: #1b293b; color: #e6e9ee; font-size: 12px; text-decoration: none;
}
.filter-chip:hover { background: #24384f; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
```

- [ ] **Step 7: Run the suite and the build**

Run: `bun test && bunx tsc --noEmit && bun run build`
Expected: all green.

- [ ] **Step 8: Verify filtering by URL**

```bash
curl -s -o /dev/null -w 'plain:    %{http_code}\n' 'http://127.0.0.1:3002/'
curl -s -o /dev/null -w 'filtered: %{http_code}\n' 'http://127.0.0.1:3002/?tag=ace'
curl -s -o /dev/null -w 'nomatch:  %{http_code}\n' 'http://127.0.0.1:3002/?tag=zzzznope'
curl -s 'http://127.0.0.1:3002/?tag=zzzznope' | grep -o 'Nothing matches those filters'
curl -s 'http://127.0.0.1:3002/' | grep -oE '[0-9.]+ [KMGT]?B stored'
```

Expected: three 200s, the empty-state copy on the third, and a disk usage figure on the first.

- [ ] **Step 9: Commit**

```bash
git add src/components/filter-chips.tsx src/components/disk-usage.tsx \
  src/app/page.tsx src/components/live-grid.tsx src/components/clip-card.tsx \
  src/app/globals.css
git commit -m "feat: add the filtered grid, chips and disk usage

Filters are URL state, so a filtered grid is linkable and survives reload.

LiveGrid stops merging clip.added on a filtered view: a new clip with no
tags must not pop into a grid filtered to ?tag=ace. Status updates for
clips already shown stay live.

Card metadata sits below the tile rather than inside it — the tile is
already a link, and a nested link is invalid HTML.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Ship it — v0.1.0

Changelog, docs, verification, and the tag that makes this the MVP.

**Files:**
- Create: `content/changelog/0.0.6.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `package.json`

- [ ] **Step 1: Write the changelog entry**

Create `content/changelog/0.0.6.md`. Match the voice of the earlier entries — what a friend gets, not what was built:

```markdown
---
version: 0.0.6
date: 2026-09-24
title: Say something
---

- Chat and reactions in the theater. Reactions float up over the video.
- Comment on any clip. Comments appear for everyone without a reload.
- Tag your clips, say what game it was, and say who was in it.
- Click any tag, game, uploader or name to filter the library to it. The filtered view is a link you can send.
- The library now shows how much space it is using.
```

- [ ] **Step 2: Verify the changelog renders**

Run: `bun test src/lib/changelog.test.ts && bun run build`
Expected: PASS. Then load `/changelog` and confirm 0.0.6 is there.

- [ ] **Step 3: Run everything and record the real numbers**

```bash
bun test 2>&1 | tail -5
bunx tsc --noEmit
bun run build 2>&1 | tail -20
```

Write the actual counts down. Do not carry a predicted number into the report.

- [ ] **Step 4: Verify graceful degradation once more**

Stop `realtime`, then:

```bash
for p in / /theater /upload /changelog; do
  printf '%-12s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002$p)"
done
```

Expected: 200 for all four. Post a comment with realtime down — it must save, and the page must not 500. Check the Next log for unhandled rejections; there must be none. Restart realtime afterwards.

- [ ] **Step 5: Record the verification**

Append a `### Milestone 6 — social` section to `docs/DEPLOYMENT.md`, in the same shape as the milestone 5 section already there: what was verified by driving real sockets, what was verified by request, and **what still needs a browser**. Be specific about the last group rather than omitting it.

Include this, which is new operational knowledge:

```markdown
The theater chat backlog is in memory alongside room state and is **lost on
every realtime restart**. A deploy empties both. Comments are in SQLite and
survive.
```

- [ ] **Step 6: Set the version**

`package.json` has said `0.1.0` since milestone 1 and has never been true. It is true now:

```bash
grep '"version"' package.json
```

If it already reads `0.1.0`, leave it. If not, set it to `0.1.0`.

- [ ] **Step 7: Commit**

```bash
git add content/changelog/0.0.6.md docs/DEPLOYMENT.md package.json
git commit -m "docs: record milestone 6 verification

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work." Then follow `superpowers:finishing-a-development-branch`: run the full suite, present the three options, execute the choice. The base branch is `master`.

- [ ] **Step 9: Tag v0.1.0 — only after Sam says so**

The MVP is complete at this point. **Do not tag without asking.** Tagging fires `.github/workflows/release.yml`, which builds and pushes `samikool/clips:0.1.0` and `:latest` to Docker Hub — a public, outward-facing action.

Ask, and if Sam agrees:

```bash
git tag -a v0.1.0 -m "v0.1.0 — the MVP

Uploads, processing, playback, a live grid, a synced theater, and the
social layer."
git push origin v0.1.0
```

Then watch the workflow and report the result:

```bash
gh run list --limit 3
```

---

## Self-review

**Spec coverage.** Walked the spec's milestone 6 list, envelope, data model and Grid section against the tasks:

| Spec requirement | Task |
|---|---|
| Envelope: `chat.send`, `reaction.send`, `chat`, `reaction` | 1 |
| Backpressure drops reactions, never chat | 1 (`isEphemeral`) |
| Theater chat, ephemeral | 2 (`ChatLog`), 3, 4 |
| Reactions | 1 (allowlist), 3, 4 |
| Comments, persisted per clip | 5, 6 |
| `comments.position_ms` stays unused | 5 — inserted as `null`, noted |
| Tags | 7, 10 |
| Games | 7, 10 |
| Participants | 7, 10 |
| Click-to-filter, not a filter bar | 10 (clip page), 11 (cards, chips) |
| Filters are URL state, linkable, survive reload | 8, 11 |
| Active filters as removable chips above the grid | 11 |
| Total disk usage surfaced; no quotas | 9, 11 |
| No `upload_sessions` table, no new tables | Global constraints — no migration |

Out of scope and stated as such: `view.start` and the `views` table (the spec lists the table but no milestone uses it); playhead-anchored comments (`position_ms` exists for them, deliberately unused); pagination past `listClips`' hard limit of 100.

**Gap found during review:** `LiveGrid` would have merged `clip.added` into a filtered grid, showing a clip that does not match the filter. Added the `live` prop in Task 11 step 4, with the reasoning in the commit message.

**Second gap:** `ClipCard` wraps its whole tile in a `Link`, so putting clickable uploader/game links inside it would nest anchors — invalid HTML that browsers resolve unpredictably. Task 11 step 5 puts them in a footer outside the link and says so.

**Third gap:** the spec never says who may delete a comment or edit metadata. Task 5 restricts deletion to the author and mutation-tests it; Task 10 makes metadata communal and explains why. Both are stated as decisions rather than left implicit.

**Placeholder scan:** no TBDs, no "add error handling", no "similar to Task N". Every code step carries its code. Task 11 step 5 explicitly defers populating `uploader`/`game` on the server-rendered card path and says to report it rather than half-doing it.

**Type consistency.** `CommentRow` (Task 5) matches `CommentSummary` (Task 1) field for field, which is why `announceComment` needs no mapping — checked field by field: `id`, `clipId`, `user`, `body`, `at`, `deleted`. `ClipFilters` keys are identical in Tasks 8, 9, 10 and 11. `ClipMetadata` is `{ tags, game, participants }` in Tasks 7 and 10. `normalizeChatText` is used by both the chat path (Task 1) and the comment action (Task 6), so the two cannot drift. `RateLimiter.take` returns `boolean` in Task 2 and is consumed that way in Tasks 2 and 3.

# Milestone 2: Storage and Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clip dropped into `/media/incoming` is probed, remuxed for instant playback, thumbnailed, and appears in a browsable grid that plays it.

**Architecture:** A SQLite-backed job queue drives a sequential ffmpeg pipeline. Each handler does one thing and enqueues the next, so a failure stops at a visible point rather than half-finishing. Media files move from `incoming/` to `clips/<ulid>.mp4`, which means the filesystem is the queue and there is no dedup bookkeeping.

**Tech Stack:** Next 16.3.5, React 19.3.0, Tailwind 4.3.3, TypeScript, bun 1.4.2, `bun:sqlite` + Drizzle 0.45.3, `ulid` 3.0.2, ffmpeg/ffprobe (8.0.1 on host, 7.1.5 in image).

**Spec:** `docs/superpowers/specs/2026-09-21-clips-site-design.md`

## Global Constraints

- Runtime is **bun**. Tests are `bun test` importing from `"bun:test"`. No Vitest.
- Drizzle ORM `0.45.3`, drizzle-kit `0.31.11`, `ulid` `3.0.2`. Do not add dependencies without a stated reason; this milestone needs none.
- Tailwind 4 CSS-first config. Use `@theme` token utilities (`bg-surface-raised`, `text-ink`, `text-ink-muted`). Do **not** use arbitrary `[var(--color-…)]` values — `src/app/page.tsx` currently does, and that is a wart to fix, not copy.
- The app trusts `X-Authentik-*` headers; containers never publish ports.
- `MEDIA_ROOT` defaults to `/media` in the container, `./data/media` locally.
- **ffmpeg must never run in the `realtime` process.** It belongs to `web` only.
- Suite is 43 tests across 8 files before this milestone. Test output must stay pristine.
- Every task ends with a commit.

## Out of scope — already deployed

**Caddy's `file_server` for `/media/clips/*` and `/media/thumbs/*` is already live and verified**, including handler ordering behind `forward_auth`. Do not touch the Caddyfile. `/media/incoming` is deliberately not served.

## Deferred from milestone 1 — fold into Task 1's commit

Three reviewer-flagged minors, all one-liners:

1. `src/lib/changelog.ts` — the per-file `try/catch` swallows genuine unexpected errors alongside expected malformed frontmatter. Add `console.error` on the exception path only.
2. Date formatting is duplicated between `src/app/layout.tsx` and `src/app/changelog/page.tsx`. Extract `formatEntryDate(date: string): string` into `src/lib/changelog.ts` and use it in both.
3. `src/components/changelog-modal.tsx` double-wraps localStorage reads in try/catch. Drop the component's own wrapper; the module-level one suffices.

## File Structure

```
src/db/
  schema.ts              MODIFY — add all remaining tables
  clips.ts               NEW — clip row queries
  jobs.ts                NEW — job queue queries
src/lib/media/
  paths.ts               NEW — media root, ulid filenames. Pure.
  codecs.ts              NEW — playable vs needs-transcode. Pure.
  probe.ts               NEW — ffprobe wrapper
  transform.ts           NEW — remux + thumbnail ffmpeg wrappers
src/lib/jobs/
  types.ts               NEW — JobType, JobHandler, JobContext
  handlers.ts            NEW — the four handlers and the registry
  runner.ts              NEW — poll loop
src/lib/ingest/
  scan.ts                NEW — find files in incoming, create clips, enqueue
src/app/
  page.tsx               MODIFY — the grid
  clips/[id]/page.tsx    NEW — player page
src/components/
  clip-card.tsx          NEW
  clip-grid.tsx          NEW
src/instrumentation.ts   NEW — start runner + watcher with the web process
```

**Boundary rule:** `paths.ts` and `codecs.ts` are pure and dependency-free, so the plan's trickiest logic is testable without a filesystem or ffmpeg. `probe.ts` and `transform.ts` own all subprocess work. Handlers orchestrate; they contain no ffmpeg invocation of their own.

---

### Task 1: Schema for the whole domain

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0001_*.sql` (generated)
- Modify: `src/lib/changelog.ts`, `src/app/layout.tsx`, `src/app/changelog/page.tsx`, `src/components/changelog-modal.tsx` (deferred minors above)
- Test: `src/db/schema.test.ts`

**Interfaces:**
- Consumes: existing `users` table, `createDb` from `src/db/client.ts`.
- Produces: tables `clips`, `mediaFiles`, `games`, `tags`, `clipTags`, `clipParticipants`, `comments`, `views`, `jobs`; types `Clip`, `MediaFile`, `Job`; `type ClipStatus`; `type JobType`; `type JobStatus`.

- [ ] **Step 1: Write the failing test**

Create `src/db/schema.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { createDb } from "@/db/client";
import { clips, games, jobs } from "@/db/schema";
import { ulid } from "ulid";

describe("schema", () => {
  it("creates a clip and reads it back", () => {
    const db = createDb(":memory:");
    const now = new Date();
    const id = ulid();

    db.insert(clips).values({
      id,
      title: "ace round",
      originalFilename: "ace.mp4",
      uploaderId: null,
      gameId: null,
      status: "pending",
      durationMs: null,
      width: null,
      height: null,
      videoCodec: null,
      audioCodec: null,
      sizeBytes: 1234,
      recordedAt: null,
      thumbPath: null,
      errorMessage: null,
      createdAt: now,
    }).run();

    const row = db.select().from(clips).get();
    expect(row?.title).toBe("ace round");
    expect(row?.status).toBe("pending");
    expect(row?.createdAt.getTime()).toBe(now.getTime());
  });

  it("enqueues a job referencing a clip", () => {
    const db = createDb(":memory:");
    const clipId = ulid();
    const now = new Date();

    db.insert(clips).values({
      id: clipId, title: "t", originalFilename: "t.mp4", uploaderId: null,
      gameId: null, status: "pending", durationMs: null, width: null,
      height: null, videoCodec: null, audioCodec: null, sizeBytes: 1,
      recordedAt: null, thumbPath: null, errorMessage: null, createdAt: now,
    }).run();

    db.insert(jobs).values({
      id: ulid(), clipId, type: "probe", status: "queued", attempts: 0,
      lastError: null, createdAt: now, startedAt: null, finishedAt: null,
    }).run();

    expect(db.select().from(jobs).get()?.type).toBe("probe");
  });

  it("enforces the unique constraint on game slug", () => {
    const db = createDb(":memory:");
    db.insert(games).values({ id: ulid(), name: "Valorant", slug: "valorant" }).run();

    expect(() =>
      db.insert(games).values({ id: ulid(), name: "Valorant 2", slug: "valorant" }).run(),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/db/schema.test.ts`
Expected: FAIL — `clips`, `games`, `jobs` are not exported from `@/db/schema`.

- [ ] **Step 3: Extend the schema**

Append to `src/db/schema.ts` (keep the existing `users` table and its `User` type unchanged):

```ts
export type ClipStatus =
  | "pending"
  | "processing"
  | "ready"
  | "needs_transcode"
  | "failed";

export type JobType = "probe" | "thumbnail" | "remux" | "transcode";
export type JobStatus = "queued" | "running" | "done" | "failed";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
});

export const clips = sqliteTable("clips", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  originalFilename: text("original_filename").notNull(),
  uploaderId: text("uploader_id").references(() => users.id),
  gameId: text("game_id").references(() => games.id),
  status: text("status").$type<ClipStatus>().notNull(),
  durationMs: integer("duration_ms"),
  width: integer("width"),
  height: integer("height"),
  videoCodec: text("video_codec"),
  audioCodec: text("audio_codec"),
  sizeBytes: integer("size_bytes"),
  recordedAt: integer("recorded_at", { mode: "timestamp_ms" }),
  thumbPath: text("thumb_path"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const mediaFiles = sqliteTable("media_files", {
  id: text("id").primaryKey(),
  clipId: text("clip_id").notNull().references(() => clips.id),
  kind: text("kind").notNull(),
  path: text("path").notNull(),
  container: text("container"),
  videoCodec: text("video_codec"),
  audioCodec: text("audio_codec"),
  width: integer("width"),
  height: integer("height"),
  bitrate: integer("bitrate"),
  sizeBytes: integer("size_bytes"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const clipTags = sqliteTable(
  "clip_tags",
  {
    clipId: text("clip_id").notNull().references(() => clips.id),
    tagId: text("tag_id").notNull().references(() => tags.id),
  },
  (t) => [primaryKey({ columns: [t.clipId, t.tagId] })],
);

export const clipParticipants = sqliteTable(
  "clip_participants",
  {
    clipId: text("clip_id").notNull().references(() => clips.id),
    userId: text("user_id").notNull().references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.clipId, t.userId] })],
);

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  clipId: text("clip_id").notNull().references(() => clips.id),
  userId: text("user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  positionMs: integer("position_ms"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
});

export const views = sqliteTable("views", {
  id: text("id").primaryKey(),
  clipId: text("clip_id").notNull().references(() => clips.id),
  userId: text("user_id").notNull().references(() => users.id),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  clipId: text("clip_id").notNull().references(() => clips.id),
  type: text("type").$type<JobType>().notNull(),
  status: text("status").$type<JobStatus>().notNull(),
  attempts: integer("attempts").notNull(),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export type Clip = typeof clips.$inferSelect;
export type MediaFile = typeof mediaFiles.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Game = typeof games.$inferSelect;
```

The spec names six indices. Add them by giving the relevant tables a second
callback argument — `clips` and `jobs` shown here, and the same pattern for the
rest:

```ts
export const clips = sqliteTable(
  "clips",
  {
    /* …columns exactly as above… */
  },
  (t) => [
    index("clips_created_at_idx").on(t.createdAt),
    index("clips_status_idx").on(t.status),
  ],
);

export const jobs = sqliteTable(
  "jobs",
  {
    /* …columns exactly as above… */
  },
  (t) => [index("jobs_status_created_at_idx").on(t.status, t.createdAt)],
);
```

Also add `index("clip_tags_tag_idx").on(t.tagId)` to `clipTags`,
`index("clip_participants_user_idx").on(t.userId)` to `clipParticipants`, and
`index("comments_clip_created_idx").on(t.clipId, t.createdAt)` to `comments` —
alongside their existing `primaryKey(...)` entries in the same returned array.

`jobs_status_created_at_idx` is the one that earns its keep immediately:
`claimNextJob` filters on `status` and orders by `createdAt` on every poll.

Update the import line at the top of the file to include `primaryKey` and `index`:

```ts
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
```

`comments.positionMs` is nullable and unused this milestone. It exists so playhead-anchored comments are later a UI change with no migration.

- [ ] **Step 4: Generate the migration**

Run: `bun run db:generate`
Expected: a new `drizzle/0001_*.sql`. Open it and confirm it contains `CREATE TABLE` for all nine new tables and a unique index on `games.slug`. Commit the generated files — they are migration history, not build output.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/db/schema.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Apply the three deferred milestone-1 fixes**

In `src/lib/changelog.ts`, add an exported helper and use it from both call sites:

```ts
export function formatEntryDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
```

Replace the inline `toLocaleDateString` calls in `src/app/layout.tsx` and `src/app/changelog/page.tsx` with `formatEntryDate(...)`.

In the loader's per-file catch, log before skipping so a real bug is not silent:

```ts
    } catch (error) {
      console.error(`changelog: failed to read ${filename}`, error);
    }
```

In `src/components/changelog-modal.tsx`, remove the component-local try/catch wrapper around reading localStorage and call the shared helper from `@/lib/changelog-visibility` directly.

- [ ] **Step 7: Run the full suite and commit**

Run: `bun test`
Expected: PASS, 46 tests (43 + 3 new).

```bash
git add src/db/schema.ts src/db/schema.test.ts drizzle/ src/lib/changelog.ts src/app/layout.tsx src/app/changelog/page.tsx src/components/changelog-modal.tsx
git commit -m "feat: add clips, media, tagging and job schema"
```

---

### Task 2: Media paths

**Files:**
- Create: `src/lib/media/paths.ts`
- Test: `src/lib/media/paths.test.ts`

**Interfaces:**
- Produces:
  - `function mediaRoot(env?: NodeJS.ProcessEnv): string`
  - `function incomingDir(env?): string`, `clipsDir(env?): string`, `thumbsDir(env?): string`
  - `function clipFilename(id: string): string` → `"<id>.mp4"`
  - `function thumbFilename(id: string): string` → `"<id>.jpg"`
  - `function clipPublicPath(id: string): string` → `"/media/clips/<id>.mp4"`
  - `function thumbPublicPath(id: string): string` → `"/media/thumbs/<id>.jpg"`

Pure and dependency-free. The public paths must match the Caddy routes already deployed (`/media/clips/*`, `/media/thumbs/*`) — getting these wrong produces 404s that look like a pipeline bug.

- [ ] **Step 1: Write the failing test**

Create `src/lib/media/paths.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  clipFilename, clipPublicPath, clipsDir, incomingDir,
  mediaRoot, thumbFilename, thumbPublicPath, thumbsDir,
} from "@/lib/media/paths";

describe("media paths", () => {
  it("uses MEDIA_ROOT when set", () => {
    expect(mediaRoot({ MEDIA_ROOT: "/media" })).toBe("/media");
  });

  it("falls back to a local directory when MEDIA_ROOT is absent", () => {
    expect(mediaRoot({})).toBe("./data/media");
  });

  it("derives the three subdirectories from the root", () => {
    const env = { MEDIA_ROOT: "/media" };
    expect(incomingDir(env)).toBe("/media/incoming");
    expect(clipsDir(env)).toBe("/media/clips");
    expect(thumbsDir(env)).toBe("/media/thumbs");
  });

  it("builds opaque filenames from the clip id", () => {
    expect(clipFilename("01ABC")).toBe("01ABC.mp4");
    expect(thumbFilename("01ABC")).toBe("01ABC.jpg");
  });

  it("builds public paths matching the deployed Caddy routes", () => {
    expect(clipPublicPath("01ABC")).toBe("/media/clips/01ABC.mp4");
    expect(thumbPublicPath("01ABC")).toBe("/media/thumbs/01ABC.jpg");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/media/paths.test.ts`
Expected: FAIL — the module `@/lib/media/paths` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/media/paths.ts`:

```ts
import { join } from "node:path";

export function mediaRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.MEDIA_ROOT ?? "./data/media";
}

export function incomingDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(mediaRoot(env), "incoming");
}

export function clipsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(mediaRoot(env), "clips");
}

export function thumbsDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(mediaRoot(env), "thumbs");
}

export function clipFilename(id: string): string {
  return `${id}.mp4`;
}

export function thumbFilename(id: string): string {
  return `${id}.jpg`;
}

export function clipPublicPath(id: string): string {
  return `/media/clips/${clipFilename(id)}`;
}

export function thumbPublicPath(id: string): string {
  return `/media/thumbs/${thumbFilename(id)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/media/paths.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/paths.ts src/lib/media/paths.test.ts
git commit -m "feat: add media path helpers"
```

---

### Task 3: Codec classification

**Files:**
- Create: `src/lib/media/codecs.ts`
- Test: `src/lib/media/codecs.test.ts`

**Interfaces:**
- Produces: `function isBrowserPlayable(videoCodec: string | null, audioCodec: string | null): boolean`

Pure, so the rule is testable without encoding exotic files. HEVC and AV1 do not play in Chrome on most platforms; a clip that probes as either must be flagged rather than left to fail silently at play time.

- [ ] **Step 1: Write the failing test**

Create `src/lib/media/codecs.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { isBrowserPlayable } from "@/lib/media/codecs";

describe("isBrowserPlayable", () => {
  it("accepts h264 with aac", () => {
    expect(isBrowserPlayable("h264", "aac")).toBe(true);
  });

  it("accepts h264 with no audio track", () => {
    expect(isBrowserPlayable("h264", null)).toBe(true);
  });

  it("rejects hevc", () => {
    expect(isBrowserPlayable("hevc", "aac")).toBe(false);
  });

  it("rejects av1", () => {
    expect(isBrowserPlayable("av1", "aac")).toBe(false);
  });

  it("rejects an unsupported audio codec alongside supported video", () => {
    expect(isBrowserPlayable("h264", "opus")).toBe(false);
  });

  it("rejects when the video codec is unknown", () => {
    expect(isBrowserPlayable(null, "aac")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isBrowserPlayable("H264", "AAC")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/media/codecs.test.ts`
Expected: FAIL — the module `@/lib/media/codecs` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/media/codecs.ts`:

```ts
const PLAYABLE_VIDEO = new Set(["h264", "avc1"]);
const PLAYABLE_AUDIO = new Set(["aac", "mp3"]);

export function isBrowserPlayable(
  videoCodec: string | null,
  audioCodec: string | null,
): boolean {
  if (videoCodec === null || !PLAYABLE_VIDEO.has(videoCodec.toLowerCase())) {
    return false;
  }

  if (audioCodec === null) {
    return true;
  }

  return PLAYABLE_AUDIO.has(audioCodec.toLowerCase());
}
```

A missing audio track is playable; a present-but-unsupported one is not.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/media/codecs.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/codecs.ts src/lib/media/codecs.test.ts
git commit -m "feat: classify browser-playable codecs"
```

---

### Task 4: ffprobe wrapper

**Files:**
- Create: `src/lib/media/probe.ts`
- Test: `src/lib/media/probe.test.ts`

**Interfaces:**
- Produces:
  - `type MediaInfo = { durationMs: number | null; width: number | null; height: number | null; videoCodec: string | null; audioCodec: string | null; bitrate: number | null; container: string | null; sizeBytes: number }`
  - `function probeFile(path: string): Promise<MediaInfo>`
  - `class ProbeError extends Error`

- [ ] **Step 1: Write the failing test**

Create `src/lib/media/probe.test.ts`. It generates its own fixture with ffmpeg, so no binary lives in the repo:

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProbeError, probeFile } from "@/lib/media/probe";

let dir: string;
let sample: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "clips-probe-"));
  sample = join(dir, "sample.mp4");

  const proc = Bun.spawn([
    "ffmpeg", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=10",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t", "1", "-c:v", "libx264", "-c:a", "aac", "-shortest", sample,
  ]);
  await proc.exited;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("probeFile", () => {
  it("reads dimensions, codecs and duration from a real file", async () => {
    const info = await probeFile(sample);

    expect(info.width).toBe(320);
    expect(info.height).toBe(240);
    expect(info.videoCodec).toBe("h264");
    expect(info.audioCodec).toBe("aac");
    expect(info.durationMs).toBeGreaterThan(500);
    expect(info.sizeBytes).toBeGreaterThan(0);
  });

  it("throws ProbeError for a file that is not media", async () => {
    const junk = join(dir, "junk.mp4");
    writeFileSync(junk, "not a video");

    expect(probeFile(junk)).rejects.toThrow(ProbeError);
  });

  it("throws ProbeError for a missing file", async () => {
    expect(probeFile(join(dir, "nope.mp4"))).rejects.toThrow(ProbeError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/media/probe.test.ts`
Expected: FAIL — the module `@/lib/media/probe` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/media/probe.ts`:

```ts
import { statSync } from "node:fs";

export type MediaInfo = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  container: string | null;
  sizeBytes: number;
};

export class ProbeError extends Error {
  constructor(path: string, detail: string) {
    super(`ffprobe failed for ${path}: ${detail}`);
    this.name = "ProbeError";
  }
}

type FfStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
};

export async function probeFile(path: string): Promise<MediaInfo> {
  let sizeBytes: number;

  try {
    sizeBytes = statSync(path).size;
  } catch {
    throw new ProbeError(path, "file does not exist");
  }

  const proc = Bun.spawn(
    [
      "ffprobe", "-v", "quiet", "-print_format", "json",
      "-show_format", "-show_streams", path,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new ProbeError(path, `exit code ${exitCode}`);
  }

  let parsed: { streams?: FfStream[]; format?: Record<string, string> };

  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ProbeError(path, "output was not valid JSON");
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  if (!video) {
    throw new ProbeError(path, "no video stream found");
  }

  const duration = Number(parsed.format?.duration);
  const bitrate = Number(parsed.format?.bit_rate);

  return {
    durationMs: Number.isFinite(duration) ? Math.round(duration * 1000) : null,
    width: video.width ?? null,
    height: video.height ?? null,
    videoCodec: video.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    bitrate: Number.isFinite(bitrate) ? bitrate : null,
    container: parsed.format?.format_name ?? null,
    sizeBytes,
  };
}
```

"No video stream" is treated as a probe failure: a clips site has no use for an audio-only file, and failing here gives a clear error instead of a broken player later.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/media/probe.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/probe.ts src/lib/media/probe.test.ts
git commit -m "feat: probe media files with ffprobe"
```

---

### Task 5: Remux and thumbnail

**Files:**
- Create: `src/lib/media/transform.ts`
- Test: `src/lib/media/transform.test.ts`

**Interfaces:**
- Produces:
  - `function remuxFaststart(input: string, output: string): Promise<void>`
  - `function extractThumbnail(input: string, output: string, atSeconds?: number): Promise<void>`
  - `class TransformError extends Error`

`remuxFaststart` is the single most valuable step in this milestone. OBS writes the `moov` atom at the **end** of an `.mp4`, and a browser cannot begin playback until it has the `moov` — so without this, the player downloads the entire clip before showing a frame. `-c copy` means no re-encoding and no quality loss; it is an I/O operation, not a CPU one.

- [ ] **Step 1: Write the failing test**

Create `src/lib/media/transform.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransformError, extractThumbnail, remuxFaststart } from "@/lib/media/transform";

let dir: string;
let sample: string;

async function run(args: string[]) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "clips-transform-"));
  sample = join(dir, "sample.mp4");
  await run([
    "ffmpeg", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
    "-c:v", "libx264", sample,
  ]);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The moov atom sits at the front of a faststart file. */
function moovIsNearFront(path: string): boolean {
  const buf = readFileSync(path);
  const moov = buf.indexOf(Buffer.from("moov"));
  const mdat = buf.indexOf(Buffer.from("mdat"));
  return moov !== -1 && mdat !== -1 && moov < mdat;
}

describe("remuxFaststart", () => {
  it("moves the moov atom ahead of the media data", async () => {
    const out = join(dir, "fast.mp4");
    await remuxFaststart(sample, out);

    expect(statSync(out).size).toBeGreaterThan(0);
    expect(moovIsNearFront(out)).toBe(true);
  });

  it("throws TransformError on a file that is not media", async () => {
    const junk = join(dir, "junk.mp4");
    await Bun.write(junk, "not a video");

    expect(remuxFaststart(junk, join(dir, "out.mp4"))).rejects.toThrow(TransformError);
  });
});

describe("extractThumbnail", () => {
  it("writes a non-empty jpeg", async () => {
    const out = join(dir, "thumb.jpg");
    await extractThumbnail(sample, out, 1);

    expect(statSync(out).size).toBeGreaterThan(0);
  });

  it("still produces a thumbnail when the seek point is past the end", async () => {
    const out = join(dir, "thumb-late.jpg");
    await extractThumbnail(sample, out, 9999);

    expect(statSync(out).size).toBeGreaterThan(0);
  });
});
```

That last test matters: a 3-second clip with a hardcoded 10-second seek would otherwise produce a zero-byte thumbnail and a broken grid tile.

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/media/transform.test.ts`
Expected: FAIL — the module `@/lib/media/transform` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/lib/media/transform.ts`:

```ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class TransformError extends Error {
  constructor(action: string, input: string, detail: string) {
    super(`${action} failed for ${input}: ${detail}`);
    this.name = "TransformError";
  }
}

async function runFfmpeg(action: string, input: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["ffmpeg", "-loglevel", "error", "-y", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new TransformError(action, input, stderr.trim() || `exit code ${exitCode}`);
  }
}

export async function remuxFaststart(input: string, output: string): Promise<void> {
  mkdirSync(dirname(output), { recursive: true });
  await runFfmpeg("remux", input, [
    "-i", input, "-c", "copy", "-movflags", "+faststart", output,
  ]);
}

export async function extractThumbnail(
  input: string,
  output: string,
  atSeconds = 1,
): Promise<void> {
  mkdirSync(dirname(output), { recursive: true });

  try {
    await runFfmpeg("thumbnail", input, [
      "-ss", String(atSeconds), "-i", input, "-frames:v", "1", "-q:v", "3", output,
    ]);
  } catch {
    // Seeking past the end yields no frame. Fall back to the first frame so a
    // short clip still gets a tile rather than a broken image.
    await runFfmpeg("thumbnail", input, [
      "-i", input, "-frames:v", "1", "-q:v", "3", output,
    ]);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/media/transform.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/transform.ts src/lib/media/transform.test.ts
git commit -m "feat: remux to faststart and extract thumbnails"
```

---

### Task 6: Job queue data layer

**Files:**
- Create: `src/db/jobs.ts`
- Test: `src/db/jobs.test.ts`

**Interfaces:**
- Consumes: `Db`, `jobs`, `JobType`, `Job` from Task 1.
- Produces:
  - `function enqueueJob(db: Db, clipId: string, type: JobType, now?: Date): Job`
  - `function claimNextJob(db: Db, now?: Date): Job | undefined`
  - `function completeJob(db: Db, id: string, now?: Date): void`
  - `function failJob(db: Db, id: string, error: string, now?: Date): void`
  - `const MAX_ATTEMPTS = 3`

- [ ] **Step 1: Write the failing test**

Create `src/db/jobs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import { createDb, type Db } from "@/db/client";
import { clips, jobs } from "@/db/schema";
import { claimNextJob, completeJob, enqueueJob, failJob, MAX_ATTEMPTS } from "@/db/jobs";

let db: Db;
let clipId: string;

beforeEach(() => {
  db = createDb(":memory:");
  clipId = ulid();
  db.insert(clips).values({
    id: clipId, title: "t", originalFilename: "t.mp4", uploaderId: null,
    gameId: null, status: "pending", durationMs: null, width: null, height: null,
    videoCodec: null, audioCodec: null, sizeBytes: 1, recordedAt: null,
    thumbPath: null, errorMessage: null, createdAt: new Date(),
  }).run();
});

describe("job queue", () => {
  it("enqueues a queued job", () => {
    const job = enqueueJob(db, clipId, "probe");
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(0);
  });

  it("claims the oldest queued job and marks it running", () => {
    const first = enqueueJob(db, clipId, "probe", new Date("2026-01-01"));
    enqueueJob(db, clipId, "thumbnail", new Date("2026-01-02"));

    const claimed = claimNextJob(db);
    expect(claimed?.id).toBe(first.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
  });

  it("does not hand the same job to a second claim", () => {
    enqueueJob(db, clipId, "probe");
    claimNextJob(db);

    expect(claimNextJob(db)).toBeUndefined();
  });

  it("returns undefined when nothing is queued", () => {
    expect(claimNextJob(db)).toBeUndefined();
  });

  it("marks a job done", () => {
    const job = enqueueJob(db, clipId, "probe");
    claimNextJob(db);
    completeJob(db, job.id);

    expect(db.select().from(jobs).get()?.status).toBe("done");
  });

  it("requeues a failed job so it can be retried", () => {
    const job = enqueueJob(db, clipId, "probe");
    claimNextJob(db);
    failJob(db, job.id, "boom");

    const row = db.select().from(jobs).get();
    expect(row?.status).toBe("queued");
    expect(row?.lastError).toBe("boom");
  });

  it("gives up after MAX_ATTEMPTS instead of retrying forever", () => {
    const job = enqueueJob(db, clipId, "probe");

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      claimNextJob(db);
      failJob(db, job.id, "boom");
    }

    expect(db.select().from(jobs).get()?.status).toBe("failed");
    expect(claimNextJob(db)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/db/jobs.test.ts`
Expected: FAIL — the module `@/db/jobs` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/db/jobs.ts`:

```ts
import { and, asc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { jobs, type Job, type JobType } from "./schema";

export const MAX_ATTEMPTS = 3;

export function enqueueJob(
  db: Db,
  clipId: string,
  type: JobType,
  now: Date = new Date(),
): Job {
  return db
    .insert(jobs)
    .values({
      id: ulid(),
      clipId,
      type,
      status: "queued",
      attempts: 0,
      lastError: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
    })
    .returning()
    .get();
}

export function claimNextJob(db: Db, now: Date = new Date()): Job | undefined {
  const next = db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "queued"))
    .orderBy(asc(jobs.createdAt))
    .limit(1)
    .get();

  if (!next) {
    return undefined;
  }

  return db
    .update(jobs)
    .set({ status: "running", attempts: next.attempts + 1, startedAt: now })
    .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")))
    .returning()
    .get();
}

export function completeJob(db: Db, id: string, now: Date = new Date()): void {
  db.update(jobs)
    .set({ status: "done", finishedAt: now, lastError: null })
    .where(eq(jobs.id, id))
    .run();
}

export function failJob(
  db: Db,
  id: string,
  error: string,
  now: Date = new Date(),
): void {
  const job = db.select().from(jobs).where(eq(jobs.id, id)).get();

  if (!job) {
    return;
  }

  const exhausted = job.attempts >= MAX_ATTEMPTS;

  db.update(jobs)
    .set({
      status: exhausted ? "failed" : "queued",
      lastError: error,
      finishedAt: exhausted ? now : null,
    })
    .where(eq(jobs.id, id))
    .run();
}
```

The claim re-checks `status = 'queued'` in its `WHERE`, so a second concurrent claim gets `undefined` rather than stealing a running job. `bun:sqlite` is synchronous and only `web` runs the queue, so that guard is belt-and-braces today — and the thing that keeps it correct if a worker process is ever split out.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/db/jobs.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/jobs.ts src/db/jobs.test.ts
git commit -m "feat: add SQLite-backed job queue"
```

---

### Task 7: Clip queries

**Files:**
- Create: `src/db/clips.ts`
- Test: `src/db/clips.test.ts`

**Interfaces:**
- Consumes: `Db`, `clips`, `mediaFiles`, `Clip`, `ClipStatus`, `MediaInfo`.
- Produces:
  - `function createClip(db: Db, input: { title: string; originalFilename: string; sizeBytes: number; uploaderId?: string | null; recordedAt?: Date | null }, now?: Date): Clip`
  - `function applyProbe(db: Db, clipId: string, info: MediaInfo): Clip`
  - `function setClipStatus(db: Db, clipId: string, status: ClipStatus, errorMessage?: string | null): Clip`
  - `function setClipThumb(db: Db, clipId: string, thumbPath: string): Clip`
  - `function recordMediaFile(db: Db, clipId: string, input: { kind: string; path: string; info: MediaInfo; isDefault: boolean }, now?: Date): void`
  - `function listReadyClips(db: Db, limit?: number): Clip[]`
  - `function listAllClips(db: Db, limit?: number): Clip[]`
  - `function getClip(db: Db, id: string): Clip | undefined`

- [ ] **Step 1: Write the failing test**

Create `src/db/clips.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { mediaFiles } from "@/db/schema";
import {
  applyProbe, createClip, getClip, listAllClips, listReadyClips,
  recordMediaFile, setClipStatus, setClipThumb,
} from "@/db/clips";
import type { MediaInfo } from "@/lib/media/probe";

const info: MediaInfo = {
  durationMs: 1500, width: 1920, height: 1080, videoCodec: "h264",
  audioCodec: "aac", bitrate: 5_000_000, container: "mov,mp4", sizeBytes: 4242,
};

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("clip queries", () => {
  it("creates a pending clip", () => {
    const clip = createClip(db, { title: "ace", originalFilename: "ace.mp4", sizeBytes: 10 });
    expect(clip.status).toBe("pending");
    expect(clip.title).toBe("ace");
  });

  it("writes probe results onto the clip", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 10 });
    const updated = applyProbe(db, clip.id, info);

    expect(updated.width).toBe(1920);
    expect(updated.videoCodec).toBe("h264");
    expect(updated.durationMs).toBe(1500);
  });

  it("sets status and clears the error when succeeding", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 10 });
    setClipStatus(db, clip.id, "failed", "boom");
    const recovered = setClipStatus(db, clip.id, "ready");

    expect(recovered.status).toBe("ready");
    expect(recovered.errorMessage).toBeNull();
  });

  it("records a media file row", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 10 });
    recordMediaFile(db, clip.id, {
      kind: "original", path: "/media/clips/x.mp4", info, isDefault: true,
    });

    const row = db.select().from(mediaFiles).get();
    expect(row?.kind).toBe("original");
    expect(row?.isDefault).toBe(true);
  });

  it("lists only ready clips, newest first", () => {
    const a = createClip(db, { title: "old", originalFilename: "a.mp4", sizeBytes: 1 }, new Date("2026-01-01"));
    const b = createClip(db, { title: "new", originalFilename: "b.mp4", sizeBytes: 1 }, new Date("2026-01-02"));
    createClip(db, { title: "pending", originalFilename: "c.mp4", sizeBytes: 1 });

    setClipStatus(db, a.id, "ready");
    setClipStatus(db, b.id, "ready");

    expect(listReadyClips(db).map((c) => c.title)).toEqual(["new", "old"]);
  });

  it("lists all clips regardless of status", () => {
    createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    createClip(db, { title: "b", originalFilename: "b.mp4", sizeBytes: 1 });

    expect(listAllClips(db)).toHaveLength(2);
  });

  it("stores a thumbnail path", () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    expect(setClipThumb(db, clip.id, "/media/thumbs/x.jpg").thumbPath).toBe("/media/thumbs/x.jpg");
  });

  it("returns undefined for a clip that does not exist", () => {
    expect(getClip(db, "nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/db/clips.test.ts`
Expected: FAIL — the module `@/db/clips` cannot be resolved.

- [ ] **Step 3: Implement**

Create `src/db/clips.ts`:

```ts
import { desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import type { Db } from "./client";
import { clips, mediaFiles, type Clip, type ClipStatus } from "./schema";
import type { MediaInfo } from "@/lib/media/probe";

export function createClip(
  db: Db,
  input: {
    title: string;
    originalFilename: string;
    sizeBytes: number;
    uploaderId?: string | null;
    recordedAt?: Date | null;
  },
  now: Date = new Date(),
): Clip {
  return db
    .insert(clips)
    .values({
      id: ulid(),
      title: input.title,
      originalFilename: input.originalFilename,
      uploaderId: input.uploaderId ?? null,
      gameId: null,
      status: "pending",
      durationMs: null,
      width: null,
      height: null,
      videoCodec: null,
      audioCodec: null,
      sizeBytes: input.sizeBytes,
      recordedAt: input.recordedAt ?? null,
      thumbPath: null,
      errorMessage: null,
      createdAt: now,
    })
    .returning()
    .get();
}

export function applyProbe(db: Db, clipId: string, info: MediaInfo): Clip {
  return db
    .update(clips)
    .set({
      durationMs: info.durationMs,
      width: info.width,
      height: info.height,
      videoCodec: info.videoCodec,
      audioCodec: info.audioCodec,
      sizeBytes: info.sizeBytes,
    })
    .where(eq(clips.id, clipId))
    .returning()
    .get();
}

export function setClipStatus(
  db: Db,
  clipId: string,
  status: ClipStatus,
  errorMessage: string | null = null,
): Clip {
  return db
    .update(clips)
    .set({ status, errorMessage })
    .where(eq(clips.id, clipId))
    .returning()
    .get();
}

export function setClipThumb(db: Db, clipId: string, thumbPath: string): Clip {
  return db
    .update(clips)
    .set({ thumbPath })
    .where(eq(clips.id, clipId))
    .returning()
    .get();
}

export function recordMediaFile(
  db: Db,
  clipId: string,
  input: { kind: string; path: string; info: MediaInfo; isDefault: boolean },
  now: Date = new Date(),
): void {
  db.insert(mediaFiles)
    .values({
      id: ulid(),
      clipId,
      kind: input.kind,
      path: input.path,
      container: input.info.container,
      videoCodec: input.info.videoCodec,
      audioCodec: input.info.audioCodec,
      width: input.info.width,
      height: input.info.height,
      bitrate: input.info.bitrate,
      sizeBytes: input.info.sizeBytes,
      isDefault: input.isDefault,
      createdAt: now,
    })
    .run();
}

export function listReadyClips(db: Db, limit = 100): Clip[] {
  return db
    .select()
    .from(clips)
    .where(eq(clips.status, "ready"))
    .orderBy(desc(clips.createdAt))
    .limit(limit)
    .all();
}

export function listAllClips(db: Db, limit = 100): Clip[] {
  return db.select().from(clips).orderBy(desc(clips.createdAt)).limit(limit).all();
}

export function getClip(db: Db, id: string): Clip | undefined {
  return db.select().from(clips).where(eq(clips.id, id)).get();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/db/clips.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/clips.ts src/db/clips.test.ts
git commit -m "feat: add clip queries"
```

---

### Task 8: Job handlers

**Files:**
- Create: `src/lib/jobs/types.ts`, `src/lib/jobs/handlers.ts`
- Test: `src/lib/jobs/handlers.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces:
  - `type JobContext = { db: Db; env: NodeJS.ProcessEnv }`
  - `type JobHandler = (ctx: JobContext, job: Job) => Promise<void>`
  - `const handlers: Record<JobType, JobHandler>`
  - `class NotImplementedError extends Error`

**The pipeline is a chain — each handler enqueues the next:**

| Handler | Does | Then |
|---|---|---|
| `probe` | ffprobe the incoming file, write results, classify codecs | playable → enqueue `remux`; otherwise status `needs_transcode` and stop |
| `remux` | faststart-remux into `clips/<id>.mp4`, delete the incoming file, record a `media_files` row | enqueue `thumbnail` |
| `thumbnail` | extract a frame into `thumbs/<id>.jpg`, set `thumb_path` | status `ready` |
| `transcode` | **stubbed** — throws `NotImplementedError` | — |

Chaining rather than enqueueing all three up front means a failure stops at a visible point, and `remux` can rely on `probe` having already run.

- [ ] **Step 1: Write the failing test**

Create `src/lib/jobs/handlers.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import { claimNextJob, enqueueJob } from "@/db/jobs";
import { clips as clipsTable, jobs as jobsTable } from "@/db/schema";
import { handlers, NotImplementedError } from "@/lib/jobs/handlers";
import { eq } from "drizzle-orm";

let root: string;
let env: NodeJS.ProcessEnv;
let db: Db;

async function makeSample(path: string, extraArgs: string[] = []) {
  const proc = Bun.spawn([
    "ffmpeg", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=10",
    "-c:v", "libx264", ...extraArgs, path,
  ], { stdout: "pipe", stderr: "pipe" });
  await proc.exited;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "clips-handlers-"));
  mkdirSync(join(root, "incoming"), { recursive: true });
  env = { MEDIA_ROOT: root };
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  db = createDb(":memory:");
});

describe("probe handler", () => {
  it("writes media info and enqueues remux for a playable clip", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const input = join(root, "incoming", `${clip.id}.mp4`);
    await makeSample(input);

    const job = enqueueJob(db, clip.id, "probe");
    claimNextJob(db);
    await handlers.probe({ db, env }, job);

    const updated = db.select().from(clipsTable).where(eq(clipsTable.id, clip.id)).get();
    expect(updated?.width).toBe(320);
    expect(updated?.videoCodec).toBe("h264");
    expect(updated?.status).toBe("processing");

    const queued = db.select().from(jobsTable).where(eq(jobsTable.status, "queued")).all();
    expect(queued.map((j) => j.type)).toContain("remux");
  });
});

describe("remux handler", () => {
  it("produces a faststart clip, removes the incoming file, and queues a thumbnail", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const input = join(root, "incoming", `${clip.id}.mp4`);
    await makeSample(input);

    const probeJob = enqueueJob(db, clip.id, "probe");
    claimNextJob(db);
    await handlers.probe({ db, env }, probeJob);

    const remuxJob = db.select().from(jobsTable).where(eq(jobsTable.type, "remux")).get()!;
    await handlers.remux({ db, env }, remuxJob);

    expect(existsSync(join(root, "clips", `${clip.id}.mp4`))).toBe(true);
    expect(existsSync(input)).toBe(false);

    const queued = db.select().from(jobsTable).where(eq(jobsTable.status, "queued")).all();
    expect(queued.map((j) => j.type)).toContain("thumbnail");
  });
});

describe("thumbnail handler", () => {
  it("writes a thumbnail and marks the clip ready", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const input = join(root, "incoming", `${clip.id}.mp4`);
    await makeSample(input);

    const probeJob = enqueueJob(db, clip.id, "probe");
    claimNextJob(db);
    await handlers.probe({ db, env }, probeJob);
    const remuxJob = db.select().from(jobsTable).where(eq(jobsTable.type, "remux")).get()!;
    await handlers.remux({ db, env }, remuxJob);
    const thumbJob = db.select().from(jobsTable).where(eq(jobsTable.type, "thumbnail")).get()!;
    await handlers.thumbnail({ db, env }, thumbJob);

    expect(existsSync(join(root, "thumbs", `${clip.id}.jpg`))).toBe(true);

    const final = db.select().from(clipsTable).where(eq(clipsTable.id, clip.id)).get();
    expect(final?.status).toBe("ready");
    expect(final?.thumbPath).toBe(`/media/thumbs/${clip.id}.jpg`);
  });
});

describe("transcode handler", () => {
  it("is registered but not implemented", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 0 });
    const job = enqueueJob(db, clip.id, "transcode");

    expect(handlers.transcode({ db, env }, job)).rejects.toThrow(NotImplementedError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/jobs/handlers.test.ts`
Expected: FAIL — the module `@/lib/jobs/handlers` cannot be resolved.

- [ ] **Step 3: Create the types**

Create `src/lib/jobs/types.ts`:

```ts
import type { Db } from "@/db/client";
import type { Job } from "@/db/schema";

export type JobContext = {
  db: Db;
  env: NodeJS.ProcessEnv;
};

export type JobHandler = (ctx: JobContext, job: Job) => Promise<void>;
```

- [ ] **Step 4: Implement the handlers**

Create `src/lib/jobs/handlers.ts`:

```ts
import { rmSync } from "node:fs";
import { join } from "node:path";
import { applyProbe, recordMediaFile, setClipStatus, setClipThumb } from "@/db/clips";
import { enqueueJob } from "@/db/jobs";
import type { JobType } from "@/db/schema";
import { isBrowserPlayable } from "@/lib/media/codecs";
import {
  clipFilename, clipsDir, incomingDir, thumbFilename,
  thumbPublicPath, thumbsDir,
} from "@/lib/media/paths";
import { probeFile } from "@/lib/media/probe";
import { extractThumbnail, remuxFaststart } from "@/lib/media/transform";
import type { JobContext, JobHandler } from "./types";

export class NotImplementedError extends Error {
  constructor(what: string) {
    super(`${what} is registered but not implemented yet`);
    this.name = "NotImplementedError";
  }
}

function incomingPath(ctx: JobContext, clipId: string): string {
  return join(incomingDir(ctx.env), clipFilename(clipId));
}

const probe: JobHandler = async (ctx, job) => {
  const info = await probeFile(incomingPath(ctx, job.clipId));
  applyProbe(ctx.db, job.clipId, info);

  if (!isBrowserPlayable(info.videoCodec, info.audioCodec)) {
    setClipStatus(
      ctx.db,
      job.clipId,
      "needs_transcode",
      `unsupported codecs: ${info.videoCodec}/${info.audioCodec}`,
    );
    return;
  }

  setClipStatus(ctx.db, job.clipId, "processing");
  enqueueJob(ctx.db, job.clipId, "remux");
};

const remux: JobHandler = async (ctx, job) => {
  const input = incomingPath(ctx, job.clipId);
  const output = join(clipsDir(ctx.env), clipFilename(job.clipId));

  await remuxFaststart(input, output);

  const info = await probeFile(output);
  recordMediaFile(ctx.db, job.clipId, {
    kind: "original",
    path: output,
    info,
    isDefault: true,
  });

  rmSync(input, { force: true });
  enqueueJob(ctx.db, job.clipId, "thumbnail");
};

const thumbnail: JobHandler = async (ctx, job) => {
  const input = join(clipsDir(ctx.env), clipFilename(job.clipId));
  const output = join(thumbsDir(ctx.env), thumbFilename(job.clipId));

  await extractThumbnail(input, output);

  setClipThumb(ctx.db, job.clipId, thumbPublicPath(job.clipId));
  setClipStatus(ctx.db, job.clipId, "ready");
};

const transcode: JobHandler = async () => {
  throw new NotImplementedError("transcode");
};

export const handlers: Record<JobType, JobHandler> = {
  probe,
  remux,
  thumbnail,
  transcode,
};
```

The incoming file is removed only **after** the remuxed output has been probed successfully — if anything fails before that point, the original is still there to retry from.

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test src/lib/jobs/handlers.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/types.ts src/lib/jobs/handlers.ts src/lib/jobs/handlers.test.ts
git commit -m "feat: add probe, remux and thumbnail job handlers"
```

---

### Task 9: Job runner and ingest scan

**Files:**
- Create: `src/lib/jobs/runner.ts`, `src/lib/ingest/scan.ts`
- Test: `src/lib/jobs/runner.test.ts`, `src/lib/ingest/scan.test.ts`

**Interfaces:**
- Produces:
  - `function runOnce(ctx: JobContext): Promise<boolean>` — claim and run one job; `false` if nothing was queued
  - `function startRunner(ctx: JobContext, intervalMs?: number): () => void` — returns a stop function
  - `function scanIncoming(ctx: JobContext): Promise<string[]>` — returns ids of newly created clips
  - `const VIDEO_EXTENSIONS: ReadonlySet<string>`

`scanIncoming` renames each discovered file to `<clipId>.mp4` **inside** `incoming/` before enqueueing, so handlers can locate it from the clip id alone and a half-written file never gets a clip row.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/jobs/runner.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@/db/client";
import { createClip } from "@/db/clips";
import { enqueueJob } from "@/db/jobs";
import { jobs as jobsTable } from "@/db/schema";
import { runOnce } from "@/lib/jobs/runner";

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
});

describe("runOnce", () => {
  it("returns false when the queue is empty", async () => {
    expect(await runOnce({ db, env: {} })).toBe(false);
  });

  it("marks a job failed after exhausting attempts", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    enqueueJob(db, clip.id, "transcode");

    for (let i = 0; i < 3; i += 1) {
      expect(await runOnce({ db, env: {} })).toBe(true);
    }

    const job = db.select().from(jobsTable).get();
    expect(job?.status).toBe("failed");
    expect(job?.lastError).toContain("not implemented");
  });

  it("does not throw when a handler throws", async () => {
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    enqueueJob(db, clip.id, "transcode");

    expect(runOnce({ db, env: {} })).resolves.toBe(true);
  });
});
```

Create `src/lib/ingest/scan.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "@/db/client";
import { listAllClips } from "@/db/clips";
import { jobs as jobsTable } from "@/db/schema";
import { scanIncoming } from "@/lib/ingest/scan";

let root: string;
let db: Db;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "clips-scan-"));
  mkdirSync(join(root, "incoming"), { recursive: true });
  env = { MEDIA_ROOT: root };
  db = createDb(":memory:");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scanIncoming", () => {
  it("creates a clip and a probe job for a video file", async () => {
    writeFileSync(join(root, "incoming", "ace round.mp4"), "x");

    const created = await scanIncoming({ db, env });

    expect(created).toHaveLength(1);
    const clip = listAllClips(db)[0];
    expect(clip.title).toBe("ace round");
    expect(clip.originalFilename).toBe("ace round.mp4");
    expect(db.select().from(jobsTable).get()?.type).toBe("probe");
  });

  it("renames the file to the clip id so handlers can find it", async () => {
    writeFileSync(join(root, "incoming", "x.mp4"), "x");

    const [id] = await scanIncoming({ db, env });

    expect(existsSync(join(root, "incoming", `${id}.mp4`))).toBe(true);
    expect(existsSync(join(root, "incoming", "x.mp4"))).toBe(false);
  });

  it("ignores files that are not videos", async () => {
    writeFileSync(join(root, "incoming", "notes.txt"), "x");
    writeFileSync(join(root, "incoming", ".DS_Store"), "x");

    expect(await scanIncoming({ db, env })).toHaveLength(0);
    expect(listAllClips(db)).toHaveLength(0);
  });

  it("does not re-ingest a file it already renamed", async () => {
    writeFileSync(join(root, "incoming", "x.mp4"), "x");
    await scanIncoming({ db, env });

    expect(await scanIncoming({ db, env })).toHaveLength(0);
    expect(listAllClips(db)).toHaveLength(1);
  });

  it("returns an empty list when the incoming directory does not exist", async () => {
    rmSync(join(root, "incoming"), { recursive: true, force: true });
    expect(await scanIncoming({ db, env })).toHaveLength(0);
  });
});
```

That fourth test is the one that matters: without it, a rescan would create a second clip for a file already queued.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test src/lib/jobs/runner.test.ts src/lib/ingest/scan.test.ts`
Expected: FAIL — neither module resolves.

- [ ] **Step 3: Implement the runner**

Create `src/lib/jobs/runner.ts`:

```ts
import { claimNextJob, completeJob, failJob } from "@/db/jobs";
import { setClipStatus } from "@/db/clips";
import { handlers } from "./handlers";
import type { JobContext } from "./types";

export async function runOnce(ctx: JobContext): Promise<boolean> {
  const job = claimNextJob(ctx.db);

  if (!job) {
    return false;
  }

  try {
    await handlers[job.type](ctx, job);
    completeJob(ctx.db, job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failJob(ctx.db, job.id, message);
    setClipStatus(ctx.db, job.clipId, "failed", message);
    console.error(`job ${job.type} failed for clip ${job.clipId}: ${message}`);
  }

  return true;
}

export function startRunner(ctx: JobContext, intervalMs = 2000): () => void {
  let stopped = false;

  const tick = async () => {
    if (stopped) {
      return;
    }

    try {
      // Drain the queue rather than doing one job per interval, so a chained
      // pipeline finishes promptly instead of taking intervalMs per step.
      while (!stopped && (await runOnce(ctx))) {
        // keep going
      }
    } catch (error) {
      console.error("job runner tick failed", error);
    }

    if (!stopped) {
      setTimeout(tick, intervalMs);
    }
  };

  void tick();

  return () => {
    stopped = true;
  };
}
```

A handler throwing must never take the process down — it marks the job and the clip failed, logs, and returns.

- [ ] **Step 4: Implement the scan**

Create `src/lib/ingest/scan.ts`:

```ts
import { existsSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createClip } from "@/db/clips";
import { enqueueJob } from "@/db/jobs";
import type { JobContext } from "@/lib/jobs/types";
import { clipFilename, incomingDir } from "@/lib/media/paths";

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  ".mp4", ".mov", ".mkv", ".webm", ".avi",
]);

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export async function scanIncoming(ctx: JobContext): Promise<string[]> {
  const dir = incomingDir(ctx.env);

  if (!existsSync(dir)) {
    return [];
  }

  const created: string[] = [];

  for (const entry of readdirSync(dir)) {
    const ext = extname(entry).toLowerCase();

    if (!VIDEO_EXTENSIONS.has(ext)) {
      continue;
    }

    // A file already named after a ULID is mid-pipeline; leave it alone.
    if (ULID_PATTERN.test(basename(entry, ext))) {
      continue;
    }

    const source = join(dir, entry);

    const clip = createClip(ctx.db, {
      title: basename(entry, ext),
      originalFilename: entry,
      sizeBytes: statSync(source).size,
    });

    renameSync(source, join(dir, clipFilename(clip.id)));
    enqueueJob(ctx.db, clip.id, "probe");
    created.push(clip.id);
  }

  return created;
}
```

Note the import list has no `ulid` — the clip id comes from `createClip`, which
generates it. Renaming to `<clipId>.mp4` *before* enqueueing means a handler can
always locate its input from the job's `clipId` alone.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/lib/jobs/runner.test.ts src/lib/ingest/scan.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jobs/runner.ts src/lib/jobs/runner.test.ts src/lib/ingest/scan.ts src/lib/ingest/scan.test.ts
git commit -m "feat: add job runner and incoming folder scan"
```

---

### Task 10: The grid and the player

**Files:**
- Create: `src/components/clip-card.tsx`, `src/components/clip-grid.tsx`, `src/app/clips/[id]/page.tsx`
- Modify: `src/app/page.tsx`
- Create: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: `listAllClips`, `getClip`, `clipPublicPath`, `requireUser`.
- Produces: `function formatDuration(ms: number | null): string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/format.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { formatDuration } from "@/lib/format";

describe("formatDuration", () => {
  it("formats seconds under a minute", () => {
    expect(formatDuration(42_000)).toBe("0:42");
  });

  it("pads seconds", () => {
    expect(formatDuration(65_000)).toBe("1:05");
  });

  it("formats durations over an hour", () => {
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });

  it("renders a dash when the duration is unknown", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("renders zero as 0:00", () => {
    expect(formatDuration(0)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test src/lib/format.test.ts`
Expected: FAIL — the module `@/lib/format` cannot be resolved.

- [ ] **Step 3: Implement the formatter**

Create `src/lib/format.ts`:

```ts
export function formatDuration(ms: number | null): string {
  if (ms === null) {
    return "—";
  }

  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/lib/format.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Build the card**

Create `src/components/clip-card.tsx`:

```tsx
import Link from "next/link";
import type { Clip } from "@/db/schema";
import { formatDuration } from "@/lib/format";

const STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  processing: "Processing",
  needs_transcode: "Unsupported format",
  failed: "Failed",
};

export function ClipCard({ clip }: { clip: Clip }) {
  const label = STATUS_LABEL[clip.status];

  const tile = (
    <div className="overflow-hidden rounded-lg bg-surface-raised">
      <div className="relative flex aspect-video items-center justify-center bg-black/40">
        {clip.thumbPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.thumbPath} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-sm text-ink-muted">{label ?? "No preview"}</span>
        )}
        {clip.status === "ready" && (
          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-xs text-ink">
            {formatDuration(clip.durationMs)}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="truncate text-sm text-ink">{clip.title}</p>
        {label && <p className="text-xs text-ink-muted">{label}</p>}
      </div>
    </div>
  );

  if (clip.status !== "ready") {
    return <div className="opacity-60">{tile}</div>;
  }

  return <Link href={`/clips/${clip.id}`}>{tile}</Link>;
}
```

A clip that is not `ready` renders dimmed and is not a link — so the pipeline's progress is visible rather than clips silently appearing later.

- [ ] **Step 6: Build the grid and wire the home page**

Create `src/components/clip-grid.tsx`:

```tsx
import type { Clip } from "@/db/schema";
import { ClipCard } from "./clip-card";

export function ClipGrid({ clips }: { clips: Clip[] }) {
  if (clips.length === 0) {
    return (
      <p className="text-ink-muted">
        No clips yet. Drop a video into the incoming folder and it will appear here.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {clips.map((clip) => (
        <ClipCard key={clip.id} clip={clip} />
      ))}
    </div>
  );
}
```

Replace `src/app/page.tsx`:

```tsx
import { getDb } from "@/db/client";
import { listAllClips } from "@/db/clips";
import { ClipGrid } from "@/components/clip-grid";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const clips = listAllClips(getDb());

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink">clips</h1>
        <p className="text-sm text-ink-muted">
          {user.displayName ?? user.authentikUsername}
        </p>
      </div>
      <ClipGrid clips={clips} />
    </main>
  );
}
```

This also removes the arbitrary `[var(--color-ink-muted)]` values flagged in milestone 1's review.

- [ ] **Step 7: Build the player page**

Create `src/app/clips/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getDb } from "@/db/client";
import { getClip } from "@/db/clips";
import { clipPublicPath } from "@/lib/media/paths";
import { formatDuration } from "@/lib/format";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ClipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const clip = getClip(getDb(), id);

  if (!clip || clip.status !== "ready") {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <Link href="/" className="text-sm text-ink-muted hover:text-ink">
        ← back
      </Link>
      <h1 className="mt-4 text-xl font-semibold text-ink">{clip.title}</h1>
      <p className="mb-4 text-sm text-ink-muted">
        {formatDuration(clip.durationMs)}
        {clip.width && clip.height ? ` · ${clip.width}×${clip.height}` : ""}
      </p>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        className="w-full rounded-lg bg-black"
        src={clipPublicPath(clip.id)}
        controls
        preload="metadata"
      />
    </main>
  );
}
```

- [ ] **Step 8: Run the full suite and build, then commit**

Run: `bun test && bun run build`
Expected: suite passes and the build succeeds. Report the real test count rather than a predicted one.

```bash
git add src/lib/format.ts src/lib/format.test.ts src/components/clip-card.tsx src/components/clip-grid.tsx src/app/page.tsx src/app/clips/
git commit -m "feat: add clip grid and player page"
```

---

### Task 11: Start the pipeline with the web process

**Files:**
- Create: `src/instrumentation.ts`
- Modify: `Dockerfile` (verify only — no change expected)

**Interfaces:**
- Consumes: `startRunner`, `scanIncoming`, `getDb`.

Next calls `register()` in `src/instrumentation.ts` once per server process at startup. That is the correct hook for starting a background loop — doing it from a page or layout would start one per request.

- [ ] **Step 1: Create the instrumentation hook**

Create `src/instrumentation.ts`:

```ts
export async function register() {
  // Next runs this hook in both the node and edge runtimes; the pipeline only
  // belongs in the node one, and only in the web process.
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { getDb } = await import("@/db/client");
  const { startRunner } = await import("@/lib/jobs/runner");
  const { scanIncoming } = await import("@/lib/ingest/scan");

  const ctx = { db: getDb(), env: process.env };
  const SCAN_INTERVAL_MS = 5000;

  startRunner(ctx);

  const scan = async () => {
    try {
      const created = await scanIncoming(ctx);
      if (created.length > 0) {
        console.log(`ingest: picked up ${created.length} new clip(s)`);
      }
    } catch (error) {
      console.error("ingest scan failed", error);
    }
    setTimeout(scan, SCAN_INTERVAL_MS);
  };

  void scan();
}
```

- [ ] **Step 2: Verify the media directories exist at startup**

`extractThumbnail` and `remuxFaststart` already `mkdirSync` their output directories, and `scanIncoming` returns early when `incoming/` is absent. No extra setup is needed — confirm by reading those three functions rather than adding redundant `mkdir` calls.

- [ ] **Step 3: Verify the Dockerfile needs no change**

Run: `grep -n "ffmpeg\|MEDIA_ROOT" Dockerfile`
Expected: `ffmpeg` is installed in the runner stage (added in milestone 1, deliberately ahead of this milestone). `MEDIA_ROOT` comes from compose, not the image. No change required — confirm rather than assume.

- [ ] **Step 4: End-to-end check against the dev server**

```bash
mkdir -p ./data/media/incoming
ffmpeg -loglevel error -f lavfi -i testsrc=duration=3:size=640x360:rate=30 \
  -c:v libx264 "./data/media/incoming/test clip.mp4"
```

Wait ~10 seconds, then reload the site. Expected: a card titled "test clip" appears, moves through Processing, then becomes playable with a thumbnail. Confirm the file moved:

```bash
ls ./data/media/incoming ./data/media/clips ./data/media/thumbs
```

Expected: `incoming/` empty, one `<ulid>.mp4` in `clips/`, one `<ulid>.jpg` in `thumbs/`.

Note the dev server must be running with `MEDIA_ROOT` unset so it uses `./data/media`, and with `DEV_AUTH_USERNAME` set.

- [ ] **Step 5: Commit**

```bash
git add src/instrumentation.ts
git commit -m "feat: start the job runner and folder scan with the web process"
```

---

## Definition of done

- [ ] `bun test` green, output pristine; `bun run build` succeeds
- [ ] A video dropped in `incoming/` becomes a playable clip with a thumbnail, with no manual step
- [ ] The originating file is gone from `incoming/` and exists as `clips/<ulid>.mp4`
- [ ] A clip with unsupported codecs lands in `needs_transcode` rather than failing at play time
- [ ] A failing job stops at a visible `failed` status with a message, and does not retry forever
- [ ] The grid shows in-flight clips dimmed with their status, and ready clips as playable links
- [ ] `transcode` is registered and throws `NotImplementedError`
- [ ] No ffmpeg code reachable from `src/realtime/`

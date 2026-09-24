import { beforeEach, describe, expect, it, spyOn } from "bun:test";
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
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const clip = createClip(db, { title: "a", originalFilename: "a.mp4", sizeBytes: 1 });
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    await announceClipUpdated(db, clip.id, env);
    expect(warn).toHaveBeenCalled(); // it logged rather than threw
    warn.mockRestore();
  });
});

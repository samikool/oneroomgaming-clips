import { describe, expect, it } from "bun:test";
import {
  addFiles,
  cancelAll,
  clearFinished,
  isActive,
  nextToSend,
  pauseAll,
  processingClipIds,
  resumeAll,
  retry,
  settleProcessing,
  startBatch,
  summarize,
  type BatchItem,
  type Batch,
} from "./batch";

const file = (name: string, size = 100) => ({ key: name, name, size });
const item = (key: string, phase: BatchItem["phase"], extra: Partial<BatchItem> = {}): BatchItem => ({
  key,
  name: key,
  size: 100,
  title: key,
  phase,
  sent: 0,
  ...extra,
});
const batch = (items: BatchItem[], paused = false): Batch => ({ items, paused });

describe("addFiles", () => {
  it("stages new files with a title from the file name", () => {
    const next = addFiles(batch([]), [file("did_i_get_him.mp4")]);
    expect(next.items).toEqual([
      expect.objectContaining({ key: "did_i_get_him.mp4", title: "did_i_get_him", phase: "staged", sent: 0 }),
    ]);
  });

  it("ignores a file that is already in the list", () => {
    const start = addFiles(batch([]), [file("a.mp4")]);
    expect(addFiles(start, [file("a.mp4")]).items).toHaveLength(1);
  });

  // Once you pressed Upload, more files dropped this session join the run.
  it("queues straight away while a batch is running", () => {
    const running = batch([item("a", "uploading")]);
    expect(addFiles(running, [file("b.mp4")]).items[1].phase).toBe("queued");
  });

  it("stages again once the previous batch has finished", () => {
    const done = batch([item("a", "ready")]);
    expect(addFiles(done, [file("b.mp4")]).items[1].phase).toBe("staged");
  });
});

describe("startBatch", () => {
  it("queues every staged file and leaves the rest alone", () => {
    const next = startBatch(batch([item("a", "staged"), item("b", "ready"), item("c", "staged")]));
    expect(next.items.map((i) => i.phase)).toEqual(["queued", "ready", "queued"]);
  });
});

describe("nextToSend", () => {
  it("picks the first queued file when nothing is sending", () => {
    expect(nextToSend(batch([item("a", "processing"), item("b", "queued"), item("c", "queued")]))).toBe("b");
  });

  it("sends one at a time", () => {
    expect(nextToSend(batch([item("a", "uploading"), item("b", "queued")]))).toBeNull();
    expect(nextToSend(batch([item("a", "starting"), item("b", "queued")]))).toBeNull();
  });

  it("moves on while the previous clip is still processing", () => {
    expect(nextToSend(batch([item("a", "processing"), item("b", "queued")]))).toBe("b");
  });

  it("skips a file that errored, so one bad file cannot stall the rest", () => {
    expect(nextToSend(batch([item("a", "error"), item("b", "queued")]))).toBe("b");
  });

  it("sends nothing while the batch is paused", () => {
    expect(nextToSend(batch([item("a", "queued")], true))).toBeNull();
  });
});

describe("pause, resume, retry, cancel", () => {
  it("pauses the batch without touching queued files", () => {
    const next = pauseAll(batch([item("a", "queued")]));
    expect(next.paused).toBe(true);
    expect(next.items[0].phase).toBe("queued");
  });

  it("resumes paused files by queueing them again", () => {
    const next = resumeAll(batch([item("a", "paused"), item("b", "queued")], true));
    expect(next.paused).toBe(false);
    expect(next.items.map((i) => i.phase)).toEqual(["queued", "queued"]);
  });

  it("retries a failed upload by queueing it again", () => {
    expect(retry(batch([item("a", "error", { message: "boom" })]), "a").items[0]).toEqual(
      expect.objectContaining({ phase: "queued", message: undefined }),
    );
  });

  it("cancels everything not yet uploaded, and keeps what already made it", () => {
    const next = cancelAll(
      batch([item("a", "processing"), item("b", "uploading"), item("c", "queued"), item("d", "staged")]),
    );
    expect(next.items.map((i) => i.phase)).toEqual(["processing", "cancelled", "cancelled", "cancelled"]);
  });
});

describe("summarize", () => {
  it("counts uploads and bytes across the batch, ignoring staged and cancelled files", () => {
    const summary = summarize(
      batch([
        item("a", "ready", { sent: 100 }),
        item("b", "uploading", { sent: 50 }),
        item("c", "queued"),
        item("d", "cancelled"),
        item("e", "staged"),
      ]),
    );
    expect(summary).toEqual({ total: 3, uploaded: 1, processing: 0, percent: 50, finished: false });
  });

  it("is finished once every file has landed or stopped", () => {
    const summary = summarize(batch([item("a", "ready", { sent: 100 }), item("b", "failed", { sent: 100 })]));
    expect(summary.finished).toBe(true);
  });

  it("is not finished while a clip is still processing", () => {
    const summary = summarize(batch([item("a", "processing", { sent: 100 })]));
    expect(summary).toEqual(expect.objectContaining({ uploaded: 1, processing: 1, finished: false }));
  });
});

describe("isActive and clearFinished", () => {
  it("is active while anything would be lost by closing the tab", () => {
    expect(isActive(batch([item("a", "queued")]))).toBe(true);
    expect(isActive(batch([item("a", "paused")]))).toBe(true);
    expect(isActive(batch([item("a", "processing")]))).toBe(false);
    expect(isActive(batch([item("a", "staged")]))).toBe(false);
  });

  it("drops finished and cancelled files, keeping staged and in-flight ones", () => {
    const next = clearFinished(
      batch([item("a", "ready"), item("b", "cancelled"), item("c", "staged"), item("d", "processing")]),
    );
    expect(next.items.map((i) => i.key)).toEqual(["c", "d"]);
  });
});

describe("settleProcessing", () => {
  it("finishes processing uploads whose clip has settled", () => {
    const next = settleProcessing(
      batch([
        item("a", "processing", { clipId: "c1" }),
        item("b", "processing", { clipId: "c2" }),
        item("c", "processing", { clipId: "c3" }),
      ]),
      { c1: "ready", c2: "failed", c3: "processing" },
    );
    expect(next.items.map((i) => i.phase)).toEqual(["ready", "failed", "processing"]);
  });

  it("leaves anything not processing alone, and ignores unknown statuses", () => {
    const before = batch([item("a", "uploading", { clipId: "c1" }), item("b", "processing", { clipId: "c2" })]);
    const next = settleProcessing(before, { c1: "ready", c2: "exploded" });
    expect(next.items.map((i) => i.phase)).toEqual(["uploading", "processing"]);
  });
});

describe("processingClipIds", () => {
  it("lists the clips still being prepared", () => {
    expect(
      processingClipIds(batch([item("a", "processing", { clipId: "c1" }), item("b", "ready", { clipId: "c2" })])),
    ).toEqual(["c1"]);
  });
});

describe("duplicates", () => {
  it("counts a refused duplicate as finished, and moves on to the next file", () => {
    const b = batch([item("a", "duplicate", { clipId: "c1" }), item("b", "queued")]);
    expect(nextToSend(b)).toBe("b");
    expect(summarize(batch([item("a", "duplicate"), item("b", "ready", { sent: 100 })])).finished).toBe(true);
  });

  it("is nothing to lose on close, and clears with the finished ones", () => {
    const b = batch([item("a", "duplicate")]);
    expect(isActive(b)).toBe(false);
    expect(clearFinished(b).items).toEqual([]);
  });
});

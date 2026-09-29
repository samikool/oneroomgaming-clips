import { describe, expect, it } from "bun:test";
import {
  addFiles,
  addPicked,
  effectivePeople,
  guessGroupGame,
  metadataFor,
  endGuess,
  touchGroup,
  setGroup,
  updateItem,
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
  key, name: key, size: 100, title: key, phase, sent: 0,
  path: key, folder: "", recordedAt: null, people: [], peopleGuess: false,
  ...extra,
});
const batch = (items: BatchItem[], paused = false): Batch => ({ items, paused, groups: [] });

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

  it("marks a processing upload as retrying while the server retries it", () => {
    const next = settleProcessing(batch([item("a", "processing", { clipId: "c1" })]), { c1: "retrying" });
    expect(next.items[0]).toMatchObject({ phase: "processing", retrying: true });
  });

  it("clears retrying once the clip is processing again", () => {
    const next = settleProcessing(
      batch([item("a", "processing", { clipId: "c1", retrying: true })]),
      { c1: "processing" },
    );
    expect(next.items[0]).toMatchObject({ phase: "processing", retrying: false });
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

describe("groups", () => {
  const people = [{ username: "ben", name: "Ben" }, { username: "sam", name: "Sam" }];
  const f = (path: string, size = 10) => ({ key: path, name: path.split("/").pop()!, size, path });

  it("groups by folder, infers per file, and skips what isn't a video", () => {
    const { batch: b, skipped } = addPicked(batch([]), [
      f("Clips/War Thunder/Ben doubts my flank.mp4"),
      f("Clips/War Thunder/Valorant 2022.02.17 - 21.14.02.03.DVR.mp4"),
      f("Clips/notes.docx"),
      f("Clips/empty.mp4", 0),
      f("loose.webm"),
    ], people);
    expect(skipped).toBe(2);
    expect(b.groups.map((g) => g.folder)).toEqual(["War Thunder", ""]);
    const ben = b.items[0];
    expect(ben).toMatchObject({ folder: "War Thunder", title: "Ben doubts my flank", people: ["ben"], peopleGuess: true, recordedAt: null });
    expect(b.items[1]).toMatchObject({ title: "Valorant", recordedAt: new Date(2022, 1, 17, 21, 14, 2).getTime() });
  });

  it("stages nothing and reports every file for a folder with no videos", () => {
    const { batch: b, skipped } = addPicked(batch([]), [f("Docs/a.docx"), f("Docs/b.zip")], people);
    expect(skipped).toBe(2);
    expect(b.items).toEqual([]);
    expect(b.groups).toEqual([]);
  });

  it("keeps groups across later drops and through start/resume/cancel", () => {
    let b = addPicked(batch([]), [f("A/x.mp4")], people).batch;
    b = addPicked(b, [f("A/y.mp4"), f("B/z.mp4")], people).batch;
    expect(b.groups.map((g) => g.folder)).toEqual(["A", "B"]);
    expect(startBatch(b).groups).toHaveLength(2);
    expect(resumeAll(pauseAll(b)).groups).toHaveLength(2);
    expect(cancelAll(b).groups).toHaveLength(2);
  });

  it("never lets a late guess overwrite a game the uploader chose", () => {
    let b = addPicked(batch([]), [f("League/x.mp4")], people).batch;
    b = setGroup(b, "League", { game: { kind: "igdb", igdbId: 115, name: "League of Legends" } });
    b = guessGroupGame(b, "League", { kind: "igdb", igdbId: 999, name: "Wrong" });
    expect(b.groups[0]).toMatchObject({ game: { igdbId: 115 }, gameGuess: false, gameTouched: true });
  });

  it("marks a guess as a guess", () => {
    const b = guessGroupGame(addPicked(batch([]), [f("League/x.mp4")], people).batch, "League", { kind: "igdb", igdbId: 115, name: "LoL" });
    expect(b.groups[0]).toMatchObject({ gameGuess: true, gameTouched: false });
  });

  it("builds upload metadata from group and clip, omitting what is unset", () => {
    let b = addPicked(batch([]), [f("League/Ben doubts my flank.mp4"), f("League/plain.mp4")], people).batch;
    b = setGroup(b, "League", { game: { kind: "local", id: "01G", name: "LoL" }, tags: ["ace", "clutch"], people: ["sam"] });
    const [first, second] = b.items;
    expect(metadataFor(b, first.key)).toEqual({ game: "local:01G", tags: "ace,clutch", people: "ben,sam" });
    b = updateItem(b, second.key, { game: { kind: "text", name: "Custom" }, recordedAt: 1_700_000_000_000 });
    expect(metadataFor(b, second.key)).toEqual({ game: "text:Custom", tags: "ace,clutch", people: "sam", recordedAt: "1700000000000" });
    b = updateItem(b, second.key, { game: null, recordedAt: null });
    expect(metadataFor(b, second.key)).toEqual({ tags: "ace,clutch", people: "sam" });
  });

  it("caps people and tags at 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    const b = setGroup(addPicked(batch([]), [f("A/x.mp4")], people).batch, "A", { tags: many, people: many });
    const meta = metadataFor(b, b.items[0].key);
    expect(meta.tags.split(",")).toHaveLength(20);
    expect(meta.people.split(",")).toHaveLength(20);
    expect(effectivePeople(b, b.items[0])).toHaveLength(20);
  });
});

describe("groups, second pass", () => {
  const people: { username: string; name: string }[] = [];
  const same = (path: string) => ({ key: "x.mp4-10-1", name: "x.mp4", size: 10, path });

  it("keeps one copy of a file found in two folders and counts the other", () => {
    const { batch: b, copies } = addPicked(batch([]), [same("A/x.mp4"), same("B/x.mp4")], people);
    expect(b.items.map((i) => i.path)).toEqual(["A/x.mp4"]);
    expect(copies).toBe(1);
    const again = addPicked(b, [same("C/x.mp4")], people);
    expect(again.copies).toBe(1);
    expect(again.batch.items).toHaveLength(1);
  });

  it("holds a folder's clips until its game guess is in", () => {
    let b = addPicked(batch([]), [{ key: "a", name: "a.mp4", size: 10, path: "League/a.mp4" }, { key: "l", name: "l.mp4", size: 10, path: "l.mp4" }], people).batch;
    expect(b.groups.find((g) => g.folder === "League")?.guessing).toBe(true);
    expect(b.groups.find((g) => g.folder === "")?.guessing).toBe(false);
    b = startBatch(b);
    expect(nextToSend(b)).toBe("l");
    b = updateItem(b, "l", { phase: "processing" });
    expect(nextToSend(b)).toBeNull();
    b = guessGroupGame(b, "League", null);
    expect(nextToSend(b)).toBe("a");
  });

  it("stops holding when the guess fails", () => {
    let b = startBatch(addPicked(batch([]), [{ key: "a", name: "a.mp4", size: 10, path: "League/a.mp4" }], people).batch);
    b = endGuess(b, "League");
    expect(nextToSend(b)).toBe("a");
  });

  it("stops a late guess once someone types in the group's game box", () => {
    let b = addPicked(batch([]), [{ key: "a", name: "a.mp4", size: 10, path: "League/a.mp4" }], people).batch;
    b = touchGroup(b, "League");
    b = guessGroupGame(b, "League", { kind: "igdb", igdbId: 1, name: "Late" });
    expect(b.groups[0]).toMatchObject({ game: null, gameTouched: true, guessing: false });
  });
});

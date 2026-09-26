import { describe, expect, it } from "bun:test";
import { advanceQueue, canUploadAll, startQueue, type Phase } from "./queue";

const rows = (...phases: Phase[]) => phases.map((phase, i) => ({ key: `r${i}`, phase }));

describe("canUploadAll", () => {
  it("needs two or more waiting rows", () => {
    expect(canUploadAll(rows("queued"))).toBe(false);
    expect(canUploadAll(rows("queued", "paused"))).toBe(true);
    expect(canUploadAll(rows("error", "queued"))).toBe(true);
  });

  it("does not count cancelled or busy rows as waiting", () => {
    expect(canUploadAll(rows("queued", "cancelled"))).toBe(false);
    expect(canUploadAll(rows("queued", "uploading", "processing", "ready"))).toBe(false);
  });
});

describe("startQueue", () => {
  it("picks the first waiting row in list order", () => {
    expect(startQueue(rows("ready", "cancelled", "paused", "queued"))).toEqual({ current: "r2", errored: [] });
  });

  it("returns nothing when no row is waiting", () => {
    expect(startQueue(rows("cancelled", "ready"))).toBeNull();
  });
});

describe("advanceQueue", () => {
  it("keeps running while the current row is still uploading", () => {
    const run = { current: "r0", errored: [] };
    for (const phase of ["starting", "uploading", "pausing"] as Phase[]) {
      expect(advanceQueue(rows(phase, "queued"), run, "r0")).toBe(run);
    }
  });

  it("ignores changes to rows that are not the current one", () => {
    const run = { current: "r0", errored: [] };
    expect(advanceQueue(rows("uploading", "processing"), run, "r1")).toBe(run);
    expect(advanceQueue(rows("processing", "queued"), null, "r0")).toBeNull();
  });

  it("moves on once the current upload has been sent, without waiting for processing", () => {
    const next = advanceQueue(rows("processing", "cancelled", "queued"), { current: "r0", errored: [] }, "r0");
    expect(next).toEqual({ current: "r2", errored: [] });
  });

  it("moves on past an error and does not pick the errored row again in this run", () => {
    const next = advanceQueue(rows("error", "queued"), { current: "r0", errored: [] }, "r0");
    expect(next).toEqual({ current: "r1", errored: ["r0"] });
    expect(advanceQueue(rows("error", "error"), next, "r1")).toBeNull();
  });

  it("stops the whole queue when the current row is paused", () => {
    expect(advanceQueue(rows("paused", "queued"), { current: "r0", errored: [] }, "r0")).toBeNull();
  });

  it("resumes with the paused row first when started again", () => {
    expect(startQueue(rows("processing", "paused", "queued"))?.current).toBe("r1");
  });

  it("picks up rows appended mid-run", () => {
    const next = advanceQueue(rows("processing", "processing", "queued"), { current: "r1", errored: [] }, "r1");
    expect(next?.current).toBe("r2");
  });

  it("finishes when nothing is left waiting", () => {
    expect(advanceQueue(rows("processing", "ready"), { current: "r0", errored: [] }, "r0")).toBeNull();
  });
});

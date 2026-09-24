import { describe, expect, it } from "bun:test";
import { mergeClip, type ClipMap } from "@/lib/realtime/merge";

const a = {
  id: "a",
  title: "A",
  status: "pending",
  thumbPath: null,
  durationMs: null,
  createdAt: 2,
};
const b = {
  id: "b",
  title: "B",
  status: "ready",
  thumbPath: null,
  durationMs: null,
  createdAt: 1,
};

describe("mergeClip", () => {
  it("adds an unseen clip", () => {
    const next = mergeClip({}, { t: "clip.added", clip: a });
    expect(Object.keys(next)).toEqual(["a"]);
  });

  it("ignores a duplicate add", () => {
    const first = mergeClip({}, { t: "clip.added", clip: a });
    const second = mergeClip(first, { t: "clip.added", clip: { ...a, title: "changed" } });
    expect(second.a.title).toBe("A");
  });

  it("replaces a known clip on update", () => {
    const first = mergeClip({}, { t: "clip.added", clip: a });
    const next = mergeClip(first, { t: "clip.updated", clip: { ...a, status: "ready" } });
    expect(next.a.status).toBe("ready");
  });

  it("ignores an update for a clip it has never seen", () => {
    const state: ClipMap = { b };
    expect(mergeClip(state, { t: "clip.updated", clip: a })).toEqual({ b });
  });

  it("ignores messages that are not about clips", () => {
    const state: ClipMap = { b };
    expect(mergeClip(state, { t: "presence", online: ["sam"], inRoom: [] })).toBe(state);
  });

  it("returns the same object when nothing changed, so React can skip a render", () => {
    const state: ClipMap = { a };
    expect(mergeClip(state, { t: "clip.added", clip: a })).toBe(state);
  });
});

import { describe, expect, it } from "bun:test";
import type { ClipSummary } from "@/lib/realtime/envelope";
import { browseReducer, initialBrowseState, scopeLive, shouldLoadMore } from "./tab-state";

const clip = (id: string, extra: Partial<ClipSummary> = {}): ClipSummary => ({
  id, title: id, status: "ready", thumbPath: null, durationMs: 1000, createdAt: 1, likeCount: 0, likedByMe: false, ...extra,
});
const page = (ids: string[], next: string | null = null) => ({ clips: ids.map((id) => clip(id)), next });
const start = () =>
  initialBrowseState({ new: page(["a", "b"], "c1"), trending: page([]), top: page(["b", "a"]), random: page(["b", "a"]) });

describe("browseReducer", () => {
  it("drops responses older than the latest query", () => {
    let s = browseReducer(start(), { type: "queryChanged", seq: 1 });
    s = browseReducer(s, { type: "queryChanged", seq: 2 });
    s = browseReducer(s, { type: "tabsLoaded", seq: 1, pages: { new: page(["old"]) } });
    expect(s.tabs.new.clips.map((c) => c.id)).toEqual(["a", "b"]);
    s = browseReducer(s, { type: "tabsLoaded", seq: 2, pages: { new: page(["fresh"]) } });
    expect(s.tabs.new.clips.map((c) => c.id)).toEqual(["fresh"]);
    expect(s.tabs.new.stale).toBe(false);
  });

  it("keeps the old clips, dimmed, when a query fetch fails", () => {
    let s = browseReducer(start(), { type: "queryChanged", seq: 1 });
    s = browseReducer(s, { type: "tabsFailed", seq: 1 });
    expect(s.tabs.new.clips).toHaveLength(2);
    expect(s.tabs.new.error).toBe(true);
    expect(s.tabs.new.stale).toBe(true);
  });

  it("appends pages without duplicates", () => {
    let s = browseReducer(start(), { type: "pageRequested", sort: "new" });
    s = browseReducer(s, { type: "pageLoaded", sort: "new", page: page(["b", "c"], null) });
    expect(s.tabs.new.clips.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(s.tabs.new.next).toBeNull();
  });

  it("stops asking for more at the end or while loading or after an error", () => {
    expect(shouldLoadMore({ clips: [], next: null, loading: false, error: false, stale: false })).toBe(false);
    expect(shouldLoadMore({ clips: [], next: "x", loading: true, error: false, stale: false })).toBe(false);
    expect(shouldLoadMore({ clips: [], next: "x", loading: false, error: true, stale: false })).toBe(false);
    expect(shouldLoadMore({ clips: [], next: "x", loading: false, error: false, stale: false })).toBe(true);
  });

  it("merges a live clip into New only when unfiltered, and never twice", () => {
    let s = browseReducer(start(), { type: "live", message: { t: "clip.added", clip: clip("z") }, filtered: true });
    expect(s.tabs.new.clips.map((c) => c.id)).toEqual(["a", "b"]);
    s = browseReducer(s, { type: "live", message: { t: "clip.added", clip: clip("z") }, filtered: false });
    s = browseReducer(s, { type: "live", message: { t: "clip.added", clip: clip("z") }, filtered: false });
    expect(s.tabs.new.clips.map((c) => c.id)).toEqual(["z", "a", "b"]);
    expect(s.tabs.top.clips.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("applies updates, removals and like counts in every tab without reordering", () => {
    let s = browseReducer(start(), { type: "live", message: { t: "clip.likes", clipId: "a", count: 5 }, filtered: false });
    expect(s.tabs.top.clips.map((c) => [c.id, c.likeCount])).toEqual([["b", 0], ["a", 5]]);
    s = browseReducer(s, { type: "live", message: { t: "clip.removed", clipId: "b" }, filtered: false });
    expect(s.tabs.random.clips.map((c) => c.id)).toEqual(["a"]);
    s = browseReducer(s, { type: "live", message: { t: "clip.updated", clip: clip("a", { title: "renamed", likeCount: 5 }) }, filtered: false });
    expect(s.tabs.new.clips[0].title).toBe("renamed");
  });

  it("keeps this viewer's own like flag through a clip.updated", () => {
    const liked = initialBrowseState({
      new: { clips: [clip("a", { likedByMe: true })], next: null },
      trending: page([]),
      top: page([]),
      random: page([]),
    });
    const s = browseReducer(liked, { type: "live", message: { t: "clip.updated", clip: clip("a", { title: "x" }) }, filtered: false });
    expect(s.tabs.new.clips[0].likedByMe).toBe(true);
    expect(s.tabs.new.clips[0].title).toBe("x");
  });

  it("keeps the like count, and an uploader and game the message leaves out", () => {
    const rich = clip("a", { uploader: "sam", game: { name: "Apex", slug: "apex" }, likeCount: 3 });
    const withRich = initialBrowseState({ new: { clips: [rich], next: null }, trending: page([]), top: page([]), random: page([]) });
    // No viewer on a broadcast, so likes arrive 0; fields not sent at all are kept.
    const s = browseReducer(withRich, {
      type: "live",
      message: { t: "clip.updated", clip: clip("a", { status: "ready" }) },
      filtered: false,
    });
    expect(s.tabs.new.clips[0].uploader).toBe("sam");
    expect(s.tabs.new.clips[0].game?.slug).toBe("apex");
    expect(s.tabs.new.clips[0].likeCount).toBe(3);
  });

  it("returns the same state for a live message that touches nothing", () => {
    const s = start();
    expect(browseReducer(s, { type: "live", message: { t: "clip.removed", clipId: "nope" }, filtered: false })).toBe(s);
    expect(browseReducer(s, { type: "live", message: { t: "presence", online: [], inRoom: [] }, filtered: false })).toBe(s);
  });

  it("reseeds only the random tab, and a failed page keeps its clips", () => {
    let s = browseReducer(start(), { type: "reseed", seq: 1 });
    expect(s.tabs.random.stale).toBe(true);
    expect(s.tabs.new.stale).toBe(false);
    s = browseReducer(s, { type: "tabsLoaded", seq: 1, pages: { random: page(["a", "b"]) } });
    expect(s.tabs.random.stale).toBe(false);
    s = browseReducer(s, { type: "pageRequested", sort: "new" });
    s = browseReducer(s, { type: "pageFailed", sort: "new" });
    expect(s.tabs.new.clips).toHaveLength(2);
    expect(s.tabs.new.error).toBe(true);
    expect(s.tabs.new.loading).toBe(false);
  });
});

describe("scopeLive", () => {
  it("passes everything through on home, where New shows processing clips", () => {
    const msg = { t: "clip.added", clip: clip("p", { status: "processing" }) } as const;
    expect(scopeLive("home", msg, new Set())).toBe(msg);
  });

  it("holds a processing clip back from the theater until it is ready", () => {
    const waiting = new Set<string>();
    expect(scopeLive("theater", { t: "clip.added", clip: clip("p", { status: "processing" }) }, waiting)).toBeNull();
    expect(scopeLive("theater", { t: "clip.updated", clip: clip("p", { status: "processing" }) }, waiting)).toBeNull();
    const ready = clip("p", { status: "ready" });
    expect(scopeLive("theater", { t: "clip.updated", clip: ready }, waiting)).toEqual({ t: "clip.added", clip: ready });
    expect(waiting.size).toBe(0);
  });

  it("forgets a waiting clip that gets deleted", () => {
    const waiting = new Set<string>(["p"]);
    const msg = { t: "clip.removed", clipId: "p" } as const;
    expect(scopeLive("theater", msg, waiting)).toBe(msg);
    expect(waiting.size).toBe(0);
  });
});

describe("clip.updated and the game chip", () => {
  const withGame = () =>
    initialBrowseState({
      new: { clips: [clip("a", { game: { name: "Apex", slug: "apex" } })], next: null },
      trending: page([]), top: page([]), random: page([]),
    });

  it("shows a changed game", () => {
    const s = browseReducer(withGame(), { type: "live", message: { t: "clip.updated", clip: clip("a", { game: { name: "Valorant", slug: "valorant" } }) }, filtered: false });
    expect(s.tabs.new.clips[0].game).toEqual({ name: "Valorant", slug: "valorant" });
  });

  it("clears a game that was cleared", () => {
    const s = browseReducer(withGame(), { type: "live", message: { t: "clip.updated", clip: clip("a", { game: null }) }, filtered: false });
    expect(s.tabs.new.clips[0].game).toBeNull();
  });
});

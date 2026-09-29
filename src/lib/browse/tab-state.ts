import type { ClipSummary, ServerMessage } from "@/lib/realtime/envelope";
import { SORTS, type Sort } from "./query";

export type Page = { clips: ClipSummary[]; next: string | null };

export type TabData = {
  clips: ClipSummary[];
  next: string | null;
  loading: boolean;
  error: boolean;
  /** Showing an older query's clips (dimmed) while the new ones load. */
  stale: boolean;
};

export type BrowseState = { seq: number; tabs: Record<Sort, TabData> };

export type BrowseAction =
  | { type: "queryChanged"; seq: number }
  | { type: "tabsLoaded"; seq: number; pages: Partial<Record<Sort, Page>> }
  | { type: "tabsFailed"; seq: number }
  | { type: "pageRequested"; sort: Sort }
  | { type: "pageLoaded"; sort: Sort; page: Page }
  | { type: "pageFailed"; sort: Sort }
  | { type: "live"; message: ServerMessage; filtered: boolean }
  | { type: "reseed"; seq: number };

function fresh(page: Page): TabData {
  return { clips: page.clips, next: page.next, loading: false, error: false, stale: false };
}

export function initialBrowseState(pages: Record<Sort, Page>): BrowseState {
  return {
    seq: 0,
    tabs: Object.fromEntries(SORTS.map((sort) => [sort, fresh(pages[sort] ?? { clips: [], next: null })])) as Record<
      Sort,
      TabData
    >,
  };
}

export function shouldLoadMore(tab: TabData): boolean {
  return tab.next !== null && !tab.loading && !tab.error;
}

/** Rebuilds every tab through `fn`; the same state object when nothing changed. */
function mapTabs(state: BrowseState, fn: (tab: TabData, sort: Sort) => TabData): BrowseState {
  let changed = false;
  const tabs = {} as Record<Sort, TabData>;

  for (const sort of SORTS) {
    const next = fn(state.tabs[sort], sort);
    if (next !== state.tabs[sort]) changed = true;
    tabs[sort] = next;
  }

  return changed ? { ...state, tabs } : state;
}

function setTab(state: BrowseState, sort: Sort, tab: TabData): BrowseState {
  return { ...state, tabs: { ...state.tabs, [sort]: tab } };
}

/** Maps the clips of one tab; the same tab when no clip changed. */
function mapClips(tab: TabData, fn: (clip: ClipSummary) => ClipSummary | null): TabData {
  let changed = false;
  const clips: ClipSummary[] = [];

  for (const clip of tab.clips) {
    const next = fn(clip);
    if (next !== clip) changed = true;
    if (next) clips.push(next);
  }

  return changed ? { ...tab, clips } : tab;
}

function live(state: BrowseState, message: ServerMessage, filtered: boolean): BrowseState {
  switch (message.t) {
    case "clip.added": {
      // New only, and only with nothing narrowing the list: a new clip might not match.
      const tab = state.tabs.new;
      if (filtered || tab.clips.some((c) => c.id === message.clip.id)) return state;
      return setTab(state, "new", { ...tab, clips: [message.clip, ...tab.clips] });
    }
    case "clip.updated":
      return mapTabs(state, (tab) =>
        mapClips(tab, (c) =>
          c.id === message.clip.id
            ? {
                ...message.clip,
                // The broadcast carries the real uploader and game (null when
                // there is none), but no viewer: likes arrive 0, so the card's
                // own count stays; clip.likes is what moves it. A message
                // without the fields at all keeps what the card knows.
                uploader: message.clip.uploader !== undefined ? message.clip.uploader : c.uploader,
                game: message.clip.game !== undefined ? message.clip.game : c.game,
                likeCount: c.likeCount,
                likedByMe: c.likedByMe,
              }
            : c,
        ),
      );
    case "clip.removed":
      return mapTabs(state, (tab) => mapClips(tab, (c) => (c.id === message.clipId ? null : c)));
    case "clip.likes":
      return mapTabs(state, (tab) =>
        mapClips(tab, (c) => (c.id === message.clipId && c.likeCount !== message.count ? { ...c, likeCount: message.count } : c)),
      );
    default:
      return state;
  }
}

export function browseReducer(state: BrowseState, action: BrowseAction): BrowseState {
  switch (action.type) {
    case "queryChanged":
      return {
        seq: action.seq,
        tabs: mapTabs(state, (tab) => ({ ...tab, stale: true, loading: true, error: false })).tabs,
      };

    case "reseed":
      return {
        seq: action.seq,
        tabs: { ...state.tabs, random: { ...state.tabs.random, stale: true, loading: true, error: false } },
      };

    case "tabsLoaded": {
      if (action.seq !== state.seq) return state;
      return mapTabs(state, (tab, sort) => {
        const page = action.pages[sort];
        return page ? fresh(page) : tab;
      });
    }

    case "tabsFailed":
      if (action.seq !== state.seq) return state;
      return mapTabs(state, (tab) => (tab.loading ? { ...tab, loading: false, error: true } : tab));

    case "pageRequested":
      return setTab(state, action.sort, { ...state.tabs[action.sort], loading: true, error: false });

    case "pageLoaded": {
      const tab = state.tabs[action.sort];
      const seen = new Set(tab.clips.map((c) => c.id));
      return setTab(state, action.sort, {
        ...tab,
        clips: [...tab.clips, ...action.page.clips.filter((c) => !seen.has(c.id))],
        next: action.page.next,
        loading: false,
        error: false,
      });
    }

    case "pageFailed":
      return setTab(state, action.sort, { ...state.tabs[action.sort], loading: false, error: true });

    case "live":
      return live(state, action.message, action.filtered);
  }
}

/**
 * The theater lists ready clips only. A new upload announces itself while
 * still processing, so the theater holds its id in `waiting` and admits it,
 * as a `clip.added`, on the update that makes it ready. Home's New tab shows
 * processing clips, so home passes everything through.
 */
export function scopeLive(scope: "home" | "theater", message: ServerMessage, waiting: Set<string>): ServerMessage | null {
  if (scope === "home") return message;

  switch (message.t) {
    case "clip.added":
      if (message.clip.status === "ready") return message;
      waiting.add(message.clip.id);
      return null;
    case "clip.updated":
      if (!waiting.has(message.clip.id)) return message;
      if (message.clip.status !== "ready") return null;
      waiting.delete(message.clip.id);
      return { t: "clip.added", clip: message.clip };
    case "clip.removed":
      waiting.delete(message.clipId);
      return message;
    default:
      return message;
  }
}

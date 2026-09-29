/**
 * The upload batch as plain data, and every rule about it as a pure function.
 * `UploadsProvider` owns the tus uploads and calls these; nothing here does
 * I/O, so the whole flow is testable without a network or a DOM.
 *
 * Files send one at a time, in list order. A clip moves on to "processing"
 * the moment its bytes land, and the next file starts without waiting for the
 * server to finish preparing the previous one.
 */

import { cleanTitle, dateFromFilename, folderOf, peopleFromPath, type GameChoice } from "./infer";

export type BatchPhase =
  | "staged" // dropped, title still editable, Upload not pressed yet
  | "queued"
  | "starting"
  | "uploading"
  | "pausing"
  | "paused"
  | "error" // tus gave up after its own retries; shows Retry
  | "processing"
  | "ready"
  | "failed"
  | "needs_transcode"
  | "duplicate" // the server already has this exact file as a clip
  | "cancelled";

export type BatchItem = {
  key: string;
  name: string;
  size: number;
  title: string;
  phase: BatchPhase;
  sent: number;
  clipId?: string;
  message?: string;
  /** Processing, but the server's last attempt failed and it will try again. */
  retrying?: boolean;
  /** Relative to what was dropped or chosen; the folder groups it. */
  path: string;
  folder: string;
  recordedAt: number | null;
  /** People besides the group's; a best guess until someone edits it. */
  people: string[];
  peopleGuess: boolean;
  /** undefined inherits the group's game; null means none for this clip. */
  game?: GameChoice | null;
};

/** One folder of the review list. Its fields apply to every clip in it. */
export type Group = {
  folder: string;
  game: GameChoice | null;
  gameGuess: boolean;
  /** Someone chose the game, so a late guess must not replace it. */
  gameTouched: boolean;
  /** A guess is on its way; this folder's clips wait for it before sending. */
  guessing: boolean;
  tags: string[];
  people: string[];
};

export type Batch = { items: BatchItem[]; paused: boolean; groups: Group[] };

export const EMPTY_BATCH: Batch = { items: [], paused: false, groups: [] };

export type BatchFile = {
  key: string;
  name: string;
  size: number;
  path?: string;
  recordedAt?: number | null;
  people?: string[];
  title?: string;
};

export const VIDEO_NAME = /\.(mp4|mov|mkv|webm|avi)$/i;
const CAP = 20;

const SENDING: readonly BatchPhase[] = ["starting", "uploading", "pausing"];
const UPLOADED: readonly BatchPhase[] = ["processing", "ready", "failed", "needs_transcode", "duplicate"];
const DONE: readonly BatchPhase[] = ["ready", "failed", "needs_transcode", "duplicate"];
/** Phases that closing the tab would lose. */
const UNSENT: readonly BatchPhase[] = ["queued", ...SENDING, "paused", "error"];

const inBatch = (item: BatchItem) => item.phase !== "staged" && item.phase !== "cancelled";

function titleFrom(name: string): string {
  return name.replace(/\.[^.]+$/, "").slice(0, 200);
}

export function updateItem(batch: Batch, key: string, patch: Partial<BatchItem>): Batch {
  return { ...batch, items: batch.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) };
}

/**
 * New files are staged for titles — unless a batch is already running, in
 * which case pressing Upload once covered the session and they join the end.
 */
export function addFiles(batch: Batch, files: BatchFile[]): Batch {
  const running = batch.items.some((i) => UNSENT.includes(i.phase) || i.phase === "processing");
  const known = new Set(batch.items.map((i) => i.key));
  // The same file copied into two folders shares a key: the first one stays.
  const fresh = files
    .filter((f) => !known.has(f.key) && (known.add(f.key), true))
    .map<BatchItem>((f) => ({
      key: f.key,
      name: f.name,
      size: f.size,
      title: f.title ?? titleFrom(f.name),
      phase: running ? "queued" : "staged",
      sent: 0,
      path: f.path ?? f.name,
      folder: folderOf(f.path ?? f.name),
      recordedAt: f.recordedAt ?? null,
      people: f.people ?? [],
      peopleGuess: (f.people ?? []).length > 0,
    }));
  const folders = new Set(batch.groups.map((g) => g.folder));
  const groups = [...batch.groups];
  for (const { folder } of fresh) {
    if (!folders.has(folder)) {
      folders.add(folder);
      groups.push({ folder, game: null, gameGuess: false, gameTouched: false, guessing: folder !== "", tags: [], people: [] });
    }
  }

  return { ...batch, items: [...batch.items, ...fresh], groups };
}

export function removeStaged(batch: Batch, key: string): Batch {
  return { ...batch, items: batch.items.filter((i) => !(i.key === key && i.phase === "staged")) };
}

export function startBatch(batch: Batch): Batch {
  return {
    ...batch,
    paused: false,
    items: batch.items.map((i) => (i.phase === "staged" ? { ...i, phase: "queued" } : i)),
  };
}

/** The file to start sending now, or null. One at a time; never while paused. */
export function nextToSend(batch: Batch): string | null {
  if (batch.paused || batch.items.some((i) => SENDING.includes(i.phase))) {
    return null;
  }

  const waiting = new Set(batch.groups.filter((g) => g.guessing).map((g) => g.folder));
  return batch.items.find((i) => i.phase === "queued" && !waiting.has(i.folder))?.key ?? null;
}

/** Stops the run. The provider aborts whichever file is mid-send. */
export function pauseAll(batch: Batch): Batch {
  return { ...batch, paused: true };
}

export function resumeAll(batch: Batch): Batch {
  return {
    ...batch,
    paused: false,
    items: batch.items.map((i) => (i.phase === "paused" ? { ...i, phase: "queued" } : i)),
  };
}

export function retry(batch: Batch, key: string): Batch {
  return updateItem(batch, key, { phase: "queued", message: undefined });
}

/** What already reached the server stays; everything else stops. */
export function cancelAll(batch: Batch): Batch {
  return {
    ...batch,
    paused: false,
    items: batch.items.map((i) =>
      i.phase === "staged" || UNSENT.includes(i.phase) ? { ...i, phase: "cancelled" } : i,
    ),
  };
}

export type BatchSummary = {
  total: number;
  uploaded: number;
  processing: number;
  percent: number;
  finished: boolean;
};

export function summarize(batch: Batch): BatchSummary {
  const items = batch.items.filter(inBatch);
  const size = items.reduce((sum, i) => sum + i.size, 0);
  const sent = items.reduce((sum, i) => sum + i.sent, 0);

  return {
    total: items.length,
    uploaded: items.filter((i) => UPLOADED.includes(i.phase)).length,
    processing: items.filter((i) => i.phase === "processing").length,
    percent: size === 0 ? 0 : Math.round((sent / size) * 100),
    finished: items.length > 0 && items.every((i) => DONE.includes(i.phase)),
  };
}

/** True while closing the tab would lose an upload. */
export function isActive(batch: Batch): boolean {
  return batch.items.some((i) => UNSENT.includes(i.phase));
}

export function clearFinished(batch: Batch): Batch {
  return {
    ...batch,
    items: batch.items.filter((i) => !DONE.includes(i.phase) && i.phase !== "cancelled"),
  };
}

/** Clips this tab is still waiting on the server to prepare. */
export function processingClipIds(batch: Batch): string[] {
  return batch.items.flatMap((i) => (i.phase === "processing" && i.clipId ? [i.clipId] : []));
}

/**
 * Applies clip statuses, pushed or fetched after a missed push (the socket was
 * down at the moment a clip changed). Only a processing upload moves: to a
 * final state, or in and out of retrying while the server retries it.
 */
export function settleProcessing(batch: Batch, statuses: Record<string, string>): Batch {
  return {
    ...batch,
    items: batch.items.map((i) => {
      const status = i.clipId ? statuses[i.clipId] : undefined;

      if (i.phase !== "processing" || status === undefined) {
        return i;
      }

      if ((DONE as readonly string[]).includes(status)) {
        return { ...i, phase: status as BatchPhase, retrying: false };
      }

      if (status === "retrying" || status === "processing" || status === "pending") {
        return { ...i, retrying: status === "retrying" };
      }

      return i;
    }),
  };
}

export function addPicked(
  batch: Batch,
  files: { key: string; name: string; size: number; path: string }[],
  people: { username: string; name: string }[],
): { batch: Batch; skipped: number; copies: number } {
  const videos = files.filter((f) => VIDEO_NAME.test(f.name) && f.size > 0);
  const inferred = videos.map((f) => {
    const recordedAt = dateFromFilename(f.name);
    return { ...f, recordedAt, title: cleanTitle(f.name, recordedAt), people: peopleFromPath(f.path, people) };
  });
  const next = addFiles(batch, inferred);
  const added = next.items.length - batch.items.length;
  return { batch: next, skipped: files.length - videos.length, copies: videos.length - added };
}

function patchGroup(batch: Batch, folder: string, change: Partial<Group>): Batch {
  return { ...batch, groups: batch.groups.map((g) => (g.folder === folder ? { ...g, ...change } : g)) };
}

export function setGroup(batch: Batch, folder: string, patch: Partial<Pick<Group, "game" | "tags" | "people">>): Batch {
  const change: Partial<Group> = { ...patch };
  if ("game" in patch) {
    change.gameGuess = false;
    change.gameTouched = true;
    change.guessing = false;
  }
  return patchGroup(batch, folder, change);
}

/** A guess lands only while nobody has chosen this group's game. Either way the wait is over. */
export function guessGroupGame(batch: Batch, folder: string, game: GameChoice | null): Batch {
  const group = batch.groups.find((g) => g.folder === folder);
  if (!group) return batch;
  if (group.gameTouched || !game) return patchGroup(batch, folder, { guessing: false });
  return patchGroup(batch, folder, { game, gameGuess: true, guessing: false });
}

/** The guess failed or timed out: send without it. */
export function endGuess(batch: Batch, folder: string): Batch {
  return patchGroup(batch, folder, { guessing: false });
}

/** Someone is typing a game for this group: no guess may replace it. */
export function touchGroup(batch: Batch, folder: string): Batch {
  return patchGroup(batch, folder, { gameTouched: true, gameGuess: false, guessing: false });
}

export function effectivePeople(batch: Batch, item: BatchItem): string[] {
  const group = batch.groups.find((g) => g.folder === item.folder);
  return [...new Set([...item.people, ...(group?.people ?? [])])].sort().slice(0, CAP);
}

function gameValue(game: GameChoice): string {
  if (game.kind === "local") return `local:${game.id}`;
  if (game.kind === "igdb") return `igdb:${game.igdbId}`;
  return `text:${game.name}`;
}

export function metadataFor(batch: Batch, key: string): Record<string, string> {
  const item = batch.items.find((i) => i.key === key);
  if (!item) return {};
  const group = batch.groups.find((g) => g.folder === item.folder);
  const game = item.game !== undefined ? item.game : group?.game ?? null;
  const tags = (group?.tags ?? []).slice(0, CAP);
  const people = effectivePeople(batch, item);
  const out: Record<string, string> = {};
  if (game) out.game = gameValue(game);
  if (tags.length) out.tags = tags.join(",");
  if (people.length) out.people = people.join(",");
  if (item.recordedAt !== null) out.recordedAt = String(item.recordedAt);
  return out;
}

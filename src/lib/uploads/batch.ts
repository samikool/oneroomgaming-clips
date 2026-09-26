/**
 * The upload batch as plain data, and every rule about it as a pure function.
 * `UploadsProvider` owns the tus uploads and calls these; nothing here does
 * I/O, so the whole flow is testable without a network or a DOM.
 *
 * Files send one at a time, in list order. A clip moves on to "processing"
 * the moment its bytes land, and the next file starts without waiting for the
 * server to finish preparing the previous one.
 */

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
};

export type Batch = { items: BatchItem[]; paused: boolean };

export const EMPTY_BATCH: Batch = { items: [], paused: false };

export type BatchFile = { key: string; name: string; size: number };

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
  const fresh = files
    .filter((f) => !known.has(f.key))
    .map<BatchItem>((f) => ({
      key: f.key,
      name: f.name,
      size: f.size,
      title: titleFrom(f.name),
      phase: running ? "queued" : "staged",
      sent: 0,
    }));

  return { ...batch, items: [...batch.items, ...fresh] };
}

export function removeStaged(batch: Batch, key: string): Batch {
  return { ...batch, items: batch.items.filter((i) => !(i.key === key && i.phase === "staged")) };
}

export function startBatch(batch: Batch): Batch {
  return {
    paused: false,
    items: batch.items.map((i) => (i.phase === "staged" ? { ...i, phase: "queued" } : i)),
  };
}

/** The file to start sending now, or null. One at a time; never while paused. */
export function nextToSend(batch: Batch): string | null {
  if (batch.paused || batch.items.some((i) => SENDING.includes(i.phase))) {
    return null;
  }

  return batch.items.find((i) => i.phase === "queued")?.key ?? null;
}

/** Stops the run. The provider aborts whichever file is mid-send. */
export function pauseAll(batch: Batch): Batch {
  return { ...batch, paused: true };
}

export function resumeAll(batch: Batch): Batch {
  return {
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
 * Applies clip statuses fetched from the server, for when the pushed update
 * was missed (the socket was down at the moment a clip finished). Only a
 * processing upload moves, and only to a final state.
 */
export function settleProcessing(batch: Batch, statuses: Record<string, string>): Batch {
  return {
    ...batch,
    items: batch.items.map((i) => {
      const status = i.clipId ? statuses[i.clipId] : undefined;

      return i.phase === "processing" && (DONE as readonly string[]).includes(status ?? "")
        ? { ...i, phase: status as BatchPhase }
        : i;
    }),
  };
}

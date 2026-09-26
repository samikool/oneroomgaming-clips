export type Phase = "queued" | "starting" | "uploading" | "pausing" | "paused" | "error" | "processing" | "ready" | "failed" | "needs_transcode" | "cancelled";
export type QueueRow = { key: string; phase: Phase };
// `errored` remembers rows that failed during this run: an errored row is
// still waiting (it has a Retry), so without it one broken file would be
// picked again forever.
export type QueueRun = { current: string; errored: readonly string[] };

// Cancelled is deliberately not waiting: the user chose to stop that one.
const waiting: readonly Phase[] = ["queued", "paused", "error"];
const sending: readonly Phase[] = ["starting", "uploading", "pausing"];

export function canUploadAll(rows: readonly QueueRow[]) {
  return rows.filter(row => waiting.includes(row.phase)).length >= 2;
}

function pick(rows: readonly QueueRow[], errored: readonly string[]): QueueRun | null {
  const next = rows.find(row => waiting.includes(row.phase) && !errored.includes(row.key));
  return next ? { current: next.key, errored } : null;
}

export function startQueue(rows: readonly QueueRow[]) {
  return pick(rows, []);
}

// Called after `changed` transitions; `rows` already holds its new phase.
// Returns the same run while it continues, a new run to start another row,
// or null once the queue has stopped or run out of rows.
export function advanceQueue(rows: readonly QueueRow[], run: QueueRun | null, changed: string): QueueRun | null {
  if (!run || changed !== run.current) return run;
  const phase = rows.find(row => row.key === run.current)?.phase;
  if (phase && sending.includes(phase)) return run;
  // Pausing the running upload is how the user stops the whole queue.
  if (phase === "paused") return null;
  // Moving on at "processing" (tus finished) rather than "ready": the server
  // processes the clip in the background and the next upload need not wait.
  return pick(rows, phase === "error" ? [...run.errored, run.current] : run.errored);
}

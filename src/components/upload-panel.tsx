"use client";

import Link from "next/link";
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useRealtime } from "@/lib/realtime/use-realtime";
import type { Upload } from "tus-js-client";
import { advanceQueue, canUploadAll, startQueue, type Phase, type QueueRun } from "@/lib/uploads/queue";

const labels: Record<Phase, string> = {
  queued: "Ready to upload", starting: "Connecting…", uploading: "Uploading", pausing: "Pausing…",
  paused: "Paused", error: "Upload interrupted", processing: "Preparing your clip…", ready: "Ready to watch",
  failed: "Could not process this video", needs_transcode: "This format needs conversion before it can play", cancelled: "Cancelled",
};
function bytes(value: number) {
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
}

type RowHandle = { start(): void };
const keyOf = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

function UploadRow({ file, username, ref, onPhase }: { file: File; username: string; ref: Ref<RowHandle>; onPhase: (phase: Phase) => void }) {
  const titleId = useId();
  const [title, setTitle] = useState(file.name.replace(/\.[^.]+$/, "").slice(0, 200));
  const [phase, setPhase] = useState<Phase>("queued");
  const [sent, setSent] = useState(0);
  const [message, setMessage] = useState("");
  const [clipId, setClipId] = useState<string>();
  const upload = useRef<Upload | null>(null);
  const phaseRef = useRef<Phase>("queued");
  const mounted = useRef(true);
  // Reported synchronously, not from an effect: batched renders could merge
  // starting→error and the queue would never see the upload begin or end.
  function transition(next: Phase) {
    phaseRef.current = next;
    if (mounted.current) { setPhase(next); onPhase(next); }
  }

  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => {
      if (["starting", "uploading", "pausing"].includes(phaseRef.current)) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      mounted.current = false;
      void upload.current?.abort().catch(() => {});
      window.removeEventListener("beforeunload", warn);
    };
  }, []);

  // Processing status arrives pushed, not polled. Polling sampled a status
  // that is momentarily "failed" while a job still has retries left and
  // reported it as terminal; the runner now only writes "failed" once retries
  // are spent, so a pushed "failed" is genuinely final.
  useRealtime(["grid"], (message) => {
    if (message.t !== "clip.updated" || message.clip.id !== clipId) return;
    const status = message.clip.status;
    if (status === "ready" || status === "failed" || status === "needs_transcode") {
      setMessage("");
      transition(status);
    }
  });

  useImperativeHandle(ref, () => ({ start: () => void start() }));

  async function start() {
    if (!["queued", "paused", "error", "cancelled"].includes(phaseRef.current)) return;
    transition("starting");
    setMessage("");
    try {
      if (!upload.current) {
        const { Upload } = await import("tus-js-client");
        if (!mounted.current) return;
        const task = new Upload(file, {
          endpoint: "/api/uploads", chunkSize: 16 * 1024 * 1024,
          retryDelays: [0, 1000, 3000, 5000, 10000],
          removeFingerprintOnSuccess: true,
          metadata: { filename: file.name, title: title.trim() || file.name.replace(/\.[^.]+$/, "") },
          fingerprint: async () => JSON.stringify(["clips-upload-v1", username, file.name, file.size, file.lastModified, file.type]),
          onProgress: (uploaded) => { if (mounted.current) setSent(uploaded); },
          onError: (err) => {
            if (!mounted.current || ["paused", "pausing", "cancelled"].includes(phaseRef.current)) return;
            const status = "originalResponse" in err ? err.originalResponse?.getStatus() : undefined;
            setMessage(status === 401 || status === 403
              ? "Sign in again, then select this same file to resume."
              : "The upload stopped. Retry to continue from the last saved chunk.");
            transition("error");
          },
          onSuccess: () => {
            if (!mounted.current) return;
            setSent(file.size);
            setMessage("");
            setClipId(new URL(task.url!, location.href).pathname.split("/").at(-1));
            transition("processing");
          },
        });
        upload.current = task;
        const previous = await task.findPreviousUploads();
        if (previous.length) task.resumeFromPreviousUpload(previous[0]);
      }
      if (!mounted.current) return;
      transition("uploading");
      upload.current.start();
    } catch {
      if (mounted.current) {
        setMessage("Could not start the upload. Check your connection and try again.");
        transition("error");
      }
    }
  }

  async function pause() {
    transition("pausing");
    try { await upload.current?.abort(); transition("paused"); }
    catch { setMessage("Could not pause. Retry to reconnect."); transition("error"); }
  }
  async function cancel() {
    transition("pausing");
    try { await upload.current?.abort(true); upload.current = null; setSent(0); transition("cancelled"); }
    catch { setMessage("Could not cancel. Retry when the connection returns."); transition("error"); }
  }
  const canStart = ["queued", "paused", "error", "cancelled"].includes(phase);
  const canCancel = ["queued", "paused", "error", "uploading"].includes(phase);
  return (
    <li className="upload-row">
      <div className="min-w-0 flex-1">
        <p className="mb-3 truncate text-sm text-ink-muted" title={file.name}>{file.name} <span className="ml-2">{bytes(file.size)}</span></p>
        <label htmlFor={titleId} className="mb-1 block text-sm">Clip title</label>
        <input id={titleId} value={title} onChange={event => setTitle(event.target.value)} maxLength={200}
          disabled={!["queued", "cancelled"].includes(phase)} className="title-input" autoComplete="off" />
        <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
          <span role="status">{labels[phase]}</span>
          <span className="tabular-nums text-ink-muted">{bytes(sent)} / {bytes(file.size)}</span>
        </div>
        <progress aria-label={`Upload progress for ${file.name}`} max={file.size} value={sent} className="upload-progress" />
        {message && <p role="alert" className="mt-2 text-sm text-rose-300">{message}</p>}
        {phase === "failed" && <p className="mt-2 text-sm text-ink-muted">Check that the original video plays on your computer, then try another file.</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-start gap-2 sm:pt-8">
        {canStart && <button className="button-primary" onClick={() => void start()}>{["queued", "cancelled"].includes(phase) ? "Upload" : phase === "paused" ? "Resume" : "Retry"}</button>}
        {phase === "uploading" && <button className="button-secondary" onClick={() => void pause()}>Pause</button>}
        {canCancel && <button className="button-secondary" onClick={() => void cancel()}>Cancel</button>}
        {phase === "ready" && <Link className="button-primary" href={`/clips/${clipId}`}>Watch clip</Link>}
      </div>
    </li>
  );
}

export function UploadPanel({ username }: { username: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Refs, not state, so a row's transition sees every earlier transition at
  // once. The map's insertion order is the list order.
  const phases = useRef(new Map<string, Phase>());
  const rows = useRef(new Map<string, RowHandle>());
  const run = useRef<QueueRun | null>(null);
  const [, rerender] = useState(0);
  const queueRows = () => Array.from(phases.current, ([key, phase]) => ({ key, phase }));
  function add(selected: File[]) {
    const valid = selected.filter(file => /\.(mp4|mov|mkv|webm|avi)$/i.test(file.name) && file.size > 0);
    setError(valid.length < selected.length ? "Choose non-empty MP4, MOV, MKV, WebM, or AVI videos." : "");
    const fresh = valid.filter(file => !phases.current.has(keyOf(file)));
    for (const file of fresh) phases.current.set(keyOf(file), "queued");
    setFiles(current => [...current, ...fresh]);
  }
  function follow(next: QueueRun | null) {
    const previous = run.current;
    run.current = next;
    if (next && next.current !== previous?.current) rows.current.get(next.current)?.start();
    rerender(n => n + 1);
  }
  function onPhase(key: string, phase: Phase) {
    phases.current.set(key, phase);
    follow(advanceQueue(queueRows(), run.current, key));
  }
  const running = run.current !== null;
  return (
    <>
      <div className={`drop-area ${dragging ? "drop-active" : ""}`}
        onDragOver={event => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); add(Array.from(event.dataTransfer.files)); }}>
        <p className="mb-4 text-lg">Drop your game clips here</p>
        <button className="button-primary" onClick={() => input.current?.click()}>Choose videos</button>
        <input ref={input} type="file" multiple accept=".mp4,.mov,.mkv,.webm,.avi" className="hidden" aria-label="Choose videos"
          onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        <p className="mt-4 text-sm text-ink-muted">MP4, MOV, MKV, WebM, or AVI</p>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted">You can pause and resume uploads. If you close this page, choose the same file again within 7 days to pick up where you left off. Its original title is kept when resuming.</p>
      {error && <p role="alert" className="mt-4 text-rose-300">{error}</p>}
      {(running || canUploadAll(queueRows())) && (
        <div className="mt-8 flex justify-end">
          <button type="button" className="button-primary" disabled={running} onClick={() => follow(startQueue(queueRows()))}>
            {running ? "Uploading all…" : "Upload all"}
          </button>
        </div>
      )}
      <ul className="mt-8 space-y-4" aria-label="Your uploads">
        {files.map(file => {
          const key = keyOf(file);
          return <UploadRow key={key} file={file} username={username} onPhase={phase => onPhase(key, phase)}
            ref={handle => { if (handle) rows.current.set(key, handle); else rows.current.delete(key); }} />;
        })}
      </ul>
    </>
  );
}
